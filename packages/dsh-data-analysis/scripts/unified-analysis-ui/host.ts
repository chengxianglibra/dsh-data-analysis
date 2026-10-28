/** Actual Harness AgentLoop/ToolRuntime; scripted transport, no external model. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
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
import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'
import { registerPluginRpc } from '../../src/rpc.ts'
import { program } from './fixture.ts'

export const probeName = 'marivo_ui_p0_probe'
export async function installProbe(ctx: Context, workspaceRoot: string, outputRoot: string) {
  let release: (() => void) | undefined
  let waiting = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  class ProbeAdapter extends LlmAdapter {
    step = 0
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model })
    }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.purpose === 'session-title' || this.step >= 2) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const native = this.step++ === 0
      const id = ToolCallId(native ? 'p0-native' : 'p0-code')
      const name = native ? probeName : 'run_code'
      const args = JSON.stringify(
        native
          ? { program }
          : {
              description: 'P0 real PTC dispatch',
              code: `await tools.${probeName}(${JSON.stringify({ program })});`,
            },
      )
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      // This gate is upstream of AgentLoop, persistence and the Web transport.
      // It exposes an actual incomplete argument string, never a client animation.
      const end = native ? args.indexOf('card =') : args.length
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args.slice(0, end) }
      if (native) {
        waiting = true
        await gate
      }
      if (end < args.length)
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args.slice(end) }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['p0-scripted'], new ProbeAdapter())
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, '统一分析 UI P0')
  const sessionId = SessionId('unified-analysis-ui-p0')
  const agent = await ctx.agentLoop.create(
    sessionId,
    { provider: 'p0-scripted', model: 'contract-probe' },
    { cwd: workspaceRoot },
  )
  // Harness 0.2.1 exposes two modes. Switch after the Native result, before
  // assembling the next model request; never bypass the native-call fence.
  let restoreMode = agent.ctx.tools.presentAs('native')
  agent.ctx.on('tools/result', (execution) => {
    if (String(execution.callId) === 'p0-native') {
      restoreMode()
      restoreMode = agent.ctx.tools.presentAs('ptc')
    }
  })
  agent.ctx.tools.register(
    defineTool({
      name: probeName,
      description: 'Isolated P0 seam probe, no saved UI or business reads.',
      parameters: { program: { type: 'string', required: true } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { accepted: { type: 'boolean', required: true } },
        },
        render: () => [{ type: 'text', text: 'P0 Catalog accepted' }],
      },
      async execute(args) {
        parseAnalysisProgram(args.program)
        return { accepted: true }
      },
    }),
  )
  await workspace.attachSession(sessionId)
  const save = async () => {
    const events = agent.session.snapshotEvents()
    const ptc = events.filter(
      (event) => event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch',
    )
    await writeFile(`${outputRoot}/host-events.json`, JSON.stringify(events, null, 2))
    return { waiting, events: events.length, ptc }
  }
  const stop = registerPluginRpc(
    ctx.connection,
    '/unified-ui-p0',
    ['start', 'release', 'status'],
    async (endpoint) => {
      if (endpoint === 'start')
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: 'Run P0 Native and PTC probes' }],
            source: { kind: 'user' },
          }),
        )
      if (endpoint === 'release') {
        assert.ok(waiting)
        release!()
        await agent.whenIdle()
        const results = agent.session
          .snapshotEvents()
          .filter((event) => event.type === 'tool/result')
        assert.equal(results.length, 2)
        for (const event of results) assert.equal(event.data.message.isError, false)
      }
      return { ok: true, value: await save() }
    },
  )
  ctx.effect(() => stop)
  return { sessionId, workspaceId: workspace.id }
}
