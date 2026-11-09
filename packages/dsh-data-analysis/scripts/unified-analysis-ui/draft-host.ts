/** Native argument streams through the actual isolated Harness and packaged client. */
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
  draftDeliverySchema,
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../src/presentation/receipt.ts'
import { readReportHistory } from '../../src/presentation/reports.ts'
import { registerPluginRpc } from '../../src/rpc.ts'

export async function installProbe(ctx: Context, workspaceRoot: string, outputRoot: string) {
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'Draft streaming')
  let plan: { surface: 'tool' | 'tab'; step: number } | undefined
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
      const last = [...agent.session.snapshotEvents()]
        .reverse()
        .find(
          (event) =>
            event.type === 'tool/result' && draftDeliverySchema.safeParse(event.data.meta).success,
        )
      const draft =
        last?.type === 'tool/result' ? draftDeliverySchema.parse(last.data.meta) : undefined
      const step = plan.step++
      const args = JSON.stringify({
        surface: plan.surface,
        stage: step === 2 ? 'save' : 'preview',
        ...(step > 0 ? { draftId: draft?.draftId, draftRevision: draft?.draftRevision } : {}),
        ...(step === 0
          ? {
              title: 'Streaming draft',
              locale: 'en-US',
              program:
                'root = Stack([intro, stable]);\nintro = TextContent("STREAM first content before tool execution");\nstable = TextContent("Retained confirmed section");',
            }
          : step === 1
            ? {
                program:
                  'intro = TextContent("STREAM updated content before tool execution");\nextra = TextContent("New completed section");\nroot = Stack([intro, stable, extra]);',
              }
            : {}),
      })
      const id = ToolCallId(`draft-stream-${Date.now()}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      const end = step < 2 ? args.indexOf('STREAM') + 14 : args.length
      yield {
        type: 'tool-call-delta',
        index: 0,
        id,
        name: 'marivo_present',
        argumentsDelta: args.slice(0, end),
      }
      if (end < args.length) {
        await pause(`stream-${step + 1}`)
        yield {
          type: 'tool-call-delta',
          index: 0,
          id,
          name: 'marivo_present',
          argumentsDelta: args.slice(end),
        }
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'marivo_present', arguments: args },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['draft-scripted'], new DraftAdapter())
  const sessionId = SessionId('draft-streaming-validation')
  const agent = await ctx.agentLoop.create(
    sessionId,
    { provider: 'draft-scripted', model: 'scripted' },
    { cwd: workspaceRoot },
  )
  agent.ctx.tools.presentAs('native')
  await workspace.attachSession(sessionId)
  const status = async () => {
    const events = agent.session.snapshotEvents()
    const results = events.flatMap<DraftDelivery | PresentationDelivery>((event) => {
      if (event.type !== 'tool/result') return []
      const draft = draftDeliverySchema.safeParse(event.data.meta)
      if (draft.success) return [draft.data]
      try {
        return [parsePresentationDelivery(event.data.meta)]
      } catch {
        return []
      }
    })
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
    ['draft-tool', 'draft-tab', 'advance', 'status'],
    async (endpoint) => {
      if (endpoint === 'advance') release?.()
      else if (endpoint.startsWith('draft-')) {
        if (agent.status === 'running') throw new Error('draft-validation-already-running')
        plan = { surface: endpoint === 'draft-tab' ? 'tab' : 'tool', step: 0 }
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
