/** Native argument streams through the actual isolated Harness and packaged client. */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  type DraftDelivery,
  type PresentationDelivery,
  parsePresentationToolDelivery,
} from '../../src/presentation/receipt.ts'
import { readReportHistory } from '../../src/presentation/reports.ts'
import { registerPluginRpc } from '../../src/rpc.ts'

export async function installProbe(ctx: Context, workspaceRoot: string, outputRoot: string) {
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'Draft streaming')
  let plan: { step: number; mode: 'native' | 'ptc' } | undefined
  let phase = 'idle'
  let release: (() => void) | undefined
  const pause = async (nextPhase: string) => {
    phase = nextPhase
    await new Promise<void>((resolve) => {
      release = resolve
    })
    release = undefined
    phase = 'running'
  }
  class DraftAdapter extends LlmAdapter {
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model })
    }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.purpose === 'session-title' || !plan || plan.step === 3) {
        phase = 'idle'
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      if (plan.step > 0) await pause(plan.step === 1 ? 'next-preview' : 'save')
      const draft = [...deliveries()]
        .reverse()
        .find((item): item is DraftDelivery => item.kind === 'marivo.presentation.draft')
      const step = plan.step++
      const input = {
        stage: step === 2 ? 'save' : 'preview',
        ...(step > 0 ? { draftId: draft?.draftId, draftRevision: draft?.draftRevision } : {}),
        ...(step === 0
          ? {
              title: `${plan.mode === 'ptc' ? 'PTC' : 'Streaming'} draft`,
              locale: 'en-US',
              program:
                'root = Stack([intro, sections]);\nsections = Tabs([TabItem("summary", "Summary", [stable]), TabItem("details", "Details", [detail])]);\ndetail = TextContent("Reading state retained");\nintro = TextContent("STREAM first content before tool execution");\nstable = TextContent("Retained confirmed section");',
            }
          : step === 1
            ? {
                program:
                  'intro = TextContent("STREAM updated content before tool execution");\nextra = TextContent("New completed section");\nroot = Stack([intro, sections, extra]);',
              }
            : {}),
      }
      const name = plan.mode === 'ptc' ? 'run_code' : 'marivo_present'
      const args = JSON.stringify(
        plan.mode === 'ptc'
          ? {
              description: 'Validate report delivery',
              code: `await tools.marivo_present(${JSON.stringify(input)});`,
            }
          : input,
      )
      const id = ToolCallId(`draft-stream-${Date.now()}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      const end = plan.mode === 'native' && step < 2 ? args.indexOf('STREAM') + 14 : args.length
      yield {
        type: 'tool-call-delta',
        index: 0,
        id,
        name,
        argumentsDelta: args.slice(0, end),
      }
      if (end < args.length) {
        await pause(`stream-${step + 1}`)
        yield {
          type: 'tool-call-delta',
          index: 0,
          id,
          name,
          argumentsDelta: args.slice(end),
        }
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name, arguments: args },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['draft-scripted'], new DraftAdapter())
  const sessionId = SessionId('draft-streaming-validation')
  const agentOptions = { provider: 'draft-scripted', model: 'scripted' }
  const agent = existsSync(path.join(outputRoot, 'draft-evidence.json'))
    ? (await ctx.agentLoop.resume(ctx, { resumeSessionId: sessionId, agentOptions })).agent
    : await ctx.agentLoop.create(sessionId, agentOptions, { cwd: workspaceRoot })
  let restoreMode = agent.ctx.tools.presentAs('native')
  await workspace.attachSession(sessionId)
  const deliveries = () =>
    agent.session.snapshotEvents().flatMap<DraftDelivery | PresentationDelivery>((event) => {
      const values =
        event.type === 'tool/result'
          ? [event.data.meta]
          : event.type === 'tool/ptc-dispatch'
            ? event.data.content.flatMap((block) => ('delivery' in block ? [block.delivery] : []))
            : []
      return values.flatMap((value) => {
        try {
          return [parsePresentationToolDelivery(value)]
        } catch {
          return []
        }
      })
    })
  const status = async () => {
    const events = agent.session.snapshotEvents()
    const results = deliveries()
    const saved = [...results]
      .reverse()
      .find((result) => result.kind === 'marivo.presentation.delivery')
    const history =
      saved?.kind === 'marivo.presentation.delivery'
        ? await readReportHistory(workspaceRoot, workspace.id, saved.receipt.reportId)
        : undefined
    const evidence = {
      phase,
      plan,
      sessionId,
      workspaceId: workspace.id,
      results,
      history,
      errors: events.filter((event) => event.type === 'tool/result' && event.data.message.isError),
    }
    await writeFile(path.join(outputRoot, 'draft-evidence.json'), JSON.stringify(evidence, null, 2))
    return evidence
  }
  const stop = registerPluginRpc(
    ctx.connection,
    '/unified-ui-p2',
    ['draft-native', 'draft-ptc', 'advance', 'status'],
    async (endpoint) => {
      if (endpoint === 'advance') release?.()
      else if (endpoint.startsWith('draft-')) {
        if (agent.status === 'running') throw new Error('draft-validation-already-running')
        plan = { step: 0, mode: endpoint === 'draft-ptc' ? 'ptc' : 'native' }
        restoreMode()
        restoreMode = agent.ctx.tools.presentAs(plan.mode)
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: endpoint }],
            source: { kind: 'user' },
          }),
        )
      }
      return { ok: true, value: await status() }
    },
  )
  ctx.effect(() => stop)
  return { sessionId, workspaceId: workspace.id }
}
