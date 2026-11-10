/** Production Host, tools and composer with a scripted model; no business data is queried. */
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerPluginRpc } from '../../src/rpc.ts'
import { installDeepSeekValidationProvider } from '../deepseek-validation-provider.ts'

/** Keep the inspection pause cancellable, including during Host shutdown. */
export async function waitForNextStepsAdvance(
  signal: AbortSignal | undefined,
  setRelease: (release: (() => void) | undefined) => void,
) {
  signal?.throwIfAborted()
  let wake!: () => void
  const abort = () => wake()
  try {
    await new Promise<void>((resolve) => {
      wake = resolve
      signal?.addEventListener('abort', abort, { once: true })
      setRelease(resolve)
      if (signal?.aborted) resolve()
    })
    signal?.throwIfAborted()
  } finally {
    signal?.removeEventListener('abort', abort)
    setRelease(undefined)
  }
}

export async function installProbe(ctx: Context, workspaceRoot: string, _outputRoot: string) {
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'Next steps acceptance')
  const sessionId = SessionId('next-steps-validation')
  let plan: { mode: 'native' | 'ptc'; step: number } | undefined
  let release: (() => void) | undefined
  class Adapter extends LlmAdapter {
    override async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model }
    }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (!plan || options.purpose === 'session-title' || plan.step > 1) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const step = plan.step++
      if (step === 1)
        await waitForNextStepsAdvance(options.signal, (value) => {
          release = value
        })
      const target = step === 0 ? 'marivo_present' : 'marivo_next_steps'
      const params =
        step === 0
          ? {
              stage: 'save',
              title: '收入变化分析',
              program: 'root=TextContent("本期收入有所下降，变化主要集中在最后一周。");',
            }
          : {
              items: [
                {
                  label: '按地区拆解收入下降',
                  prompt: '请根据刚完成的收入变化分析，按地区拆解收入变化。',
                },
                { label: '对比新客与老客变化', prompt: '请比较新客和老客的收入变化及各自贡献。' },
                { label: '查看每周收入变化', prompt: '请按周比较收入变化，检查下降发生的时间。' },
              ],
            }
      const name = plan.mode === 'ptc' ? 'run_code' : target
      const args = JSON.stringify(
        plan.mode === 'ptc'
          ? {
              description: 'Analysis follow-up acceptance',
              code: `await tools.${target}(${JSON.stringify(params)});`,
            }
          : params,
      )
      const id = ToolCallId(`next-steps-${Date.now()}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['next-steps-scripted'], new Adapter())
  const agent = await ctx.agentLoop.create(
    sessionId,
    { provider: 'next-steps-scripted', model: 'scripted' },
    { cwd: workspaceRoot },
  )
  await workspace.attachSession(sessionId)
  let restore = agent.ctx.tools.presentAs('native')
  let modelAgent: typeof agent | undefined
  ctx.effect(() =>
    registerPluginRpc(
      ctx.connection,
      '/unified-ui-p2',
      [
        'native',
        'ptc',
        'advance',
        'status',
        'model-init',
        'model-run',
        'model-optout',
        'model-status',
      ],
      async (endpoint) => {
        if (endpoint.startsWith('model-')) {
          if (!modelAgent) {
            if (!process.env.DEEPSEEK_API_KEY) throw new Error('model-credential-unavailable')
            const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-pro'
            if (!ctx.llm.listProviders().some((provider) => provider.id === 'deepseek-official'))
              await installDeepSeekValidationProvider(ctx, {
                thinking: 'disabled',
                maxTokens: 4096,
                streamIdleTimeoutMs: 180_000,
                models: [{ id: model, contextWindow: 256_000, maxTokens: 4096 }],
              })
            modelAgent = await ctx.agentLoop.create(
              SessionId('next-steps-model-validation'),
              { provider: 'deepseek-official', model, maxTokens: 4096 },
              { cwd: workspaceRoot },
            )
            modelAgent.ctx.tools.presentAs('native')
            modelAgent.ctx.tools.guard((exec) =>
              ['marivo_present', 'marivo_next_steps', 'marivo_ui_read'].includes(exec.name)
                ? undefined
                : 'This acceptance probe only exercises ready report delivery and follow-up suggestions.',
            )
            await workspace.attachSession(modelAgent.session.id)
          }
          if (endpoint === 'model-run' || endpoint === 'model-optout') {
            if (modelAgent.status === 'running') throw new Error('model-already-running')
            modelAgent.followup(
              createUserMessage({
                source: { kind: 'user' },
                content: [
                  {
                    type: 'text',
                    text:
                      '本次验证已就绪报告的交付，不查询数据、不执行Python、不探索Help或文件。请直接调用 marivo_present，参数 stage=save、title=月度收入分析、locale=zh-CN、program 使用以下已验证程序：root=TextContent("2026年7月至10月收入分别为100、110、100、90万元。10月较9月减少10万元，环比下降10%。8月后连续两个月下降。只有月份和收入字段，不能判断地区、渠道或客户层面的原因。"); 只保存一次，推荐应有增量价值，不重复这些已知结论。' +
                      (endpoint === 'model-optout'
                        ? '这次明确不要提供下一步推荐。'
                        : '完成后按插件流程提供有依据的下一步推荐。'),
                  },
                ],
              }),
            )
          }
          return {
            ok: true,
            value: {
              sessionId: modelAgent.session.id,
              status: modelAgent.status,
              calls: modelAgent.session
                .snapshotEvents()
                .flatMap((event) =>
                  event.type === 'tool/call'
                    ? [{ name: event.data.name, args: JSON.parse(event.data.arguments) }]
                    : [],
                ),
              errors: modelAgent.session
                .snapshotEvents()
                .filter((event) => event.type === 'tool/result' && event.data.message.isError),
            },
          }
        }
        if (endpoint === 'advance') {
          release?.()
          release = undefined
        }
        if (endpoint === 'native' || endpoint === 'ptc') {
          if (agent.status === 'running') throw new Error('probe-already-running')
          plan = { mode: endpoint, step: 0 }
          restore()
          restore = agent.ctx.tools.presentAs(endpoint)
          agent.followup(
            createUserMessage({
              source: { kind: 'user' },
              content: [{ type: 'text', text: '生成收入变化分析' }],
            }),
          )
        }
        const events = agent.session.snapshotEvents()
        return {
          ok: true,
          value: {
            sessionId,
            status: agent.status,
            waiting: Boolean(release),
            plan,
            messages: events.flatMap((event) =>
              event.type === 'user/message' && event.data.source.kind === 'user'
                ? [event.data.content]
                : [],
            ),
            errors: events.filter(
              (event) => event.type === 'tool/result' && event.data.message.isError,
            ),
          },
        }
      },
    ),
  )
  return { sessionId, workspaceId: workspace.id }
}
