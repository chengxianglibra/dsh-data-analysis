/** Actual installed Harness dispatch + durable persistence; scripted model boundary only. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import LlmRuntime, {
  CallId,
  type ContentBlock,
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, {
  type JsonValue,
  type SessionEvent,
  SessionId,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { parsePresentationReceipt } from '../../src/presentation/contracts/index.ts'
import type { PresentationReceipt } from '../../src/presentation/contracts/types.ts'
import { S0FileService } from './files.ts'

export const S0_TOOL_NAME = 'marivo_present_s0_probe'
export const S0_DELIVERY_KIND = 'marivo.presentation.delivery'
export interface S0Delivery {
  kind: typeof S0_DELIVERY_KIND
  schemaVersion: 2
  dshSessionId: string
  turn: number
  receipt: PresentationReceipt
}
const wire = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
export function receiptText(receipt: PresentationReceipt): string {
  return [
    receipt.title,
    receipt.summary,
    `Workspace: ${receipt.workspaceId}`,
    `Build: ${receipt.buildId}`,
    ...Object.values(receipt.files).flatMap((file) => [
      `${file.asset}: ${file.path}`,
      `sha256: ${file.sha256}; bytes: ${file.bytes}`,
    ]),
  ].join('\n')
}

/** Register only on an isolated validation Context; no production Tool surface change. */
export function installS0ReceiptProbe(
  ctx: Context,
  receipt: PresentationReceipt,
  files: S0FileService,
): () => void {
  const pending = new Map<string, S0Delivery>()
  const unregister = ctx.tools.register(
    defineTool({
      name: S0_TOOL_NAME,
      description:
        'S0 isolation probe: read a fixed completed build and return its presentation receipt.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            receiptJson: { type: 'string', required: true },
            dshSessionId: { type: 'string', required: true },
            turn: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: receiptText(parsePresentationReceipt(JSON.parse(value.receiptJson))),
          },
        ],
        presentationMeta: (_args, value) =>
          wire({
            kind: S0_DELIVERY_KIND,
            schemaVersion: 2,
            dshSessionId: value.dshSessionId,
            turn: value.turn,
            receipt: parsePresentationReceipt(JSON.parse(value.receiptJson)),
          }),
      },
      async execute(_args, exec) {
        const owner = exec.agent
        if (!owner) throw new Error('S0 probe requires an owning Agent')
        const root = String(exec.rootCallId ?? exec.callId)
        const call = [...owner.session.events]
          .reverse()
          .find((event) => event.type === 'tool/call' && String(event.data.callId) === root)
        if (call?.type !== 'tool/call') throw new Error('S0 probe requires a live root Tool call')
        for (const file of Object.values(receipt.files)) {
          const bytes = await files.read(
            {
              workspaceId: receipt.workspaceId,
              reportId: 'report',
              buildId: receipt.buildId,
              asset: file.asset,
              sha256: file.sha256,
            },
            exec.signal,
          )
          if (bytes.bytes !== file.bytes) throw new Error('receipt-byte-count-mismatch')
        }
        return {
          receiptJson: JSON.stringify(receipt),
          dshSessionId: String(owner.session.id),
          turn: call.data.turn,
        }
      },
    }),
  )
  const stopResult = ctx.on('tools/result', (exec, result) => {
    if (exec.name !== S0_TOOL_NAME || exec.parent === undefined || result.isError) return
    const value = result.value as { receiptJson: string; dshSessionId: string; turn: number }
    pending.set(String(exec.callId), {
      kind: S0_DELIVERY_KIND,
      schemaVersion: 2,
      dshSessionId: value.dshSessionId,
      turn: value.turn,
      receipt: parsePresentationReceipt(JSON.parse(value.receiptJson)),
    })
  })
  const stopLog = ctx.on(
    'tools/code-dispatch-log',
    async (dispatch, next) => {
      const content = await next()
      if (dispatch.name !== S0_TOOL_NAME) return content
      const delivery = pending.get(String(dispatch.subCallId))
      pending.delete(String(dispatch.subCallId))
      if (
        dispatch.isError ||
        !delivery ||
        delivery.dshSessionId !== String(dispatch.agent?.session.id)
      )
        return content
      return [...content, { type: S0_DELIVERY_KIND, delivery } as unknown as ContentBlock]
    },
    { prepend: true },
  )
  return () => {
    unregister()
    stopResult()
    stopLog()
    pending.clear()
  }
}

/** Replay decoder: both Native and Code produce exactly the same envelope and receipt. */
export function collectS0Deliveries(
  events: readonly SessionEvent[],
  dshSessionId: string,
): S0Delivery[] {
  const calls = new Map<string, { name: string; turn: number }>()
  const seen = new Set<string>()
  const result: S0Delivery[] = []
  for (const event of events) {
    if (event.type === 'tool/call')
      calls.set(String(event.data.callId), { name: event.data.name, turn: event.data.turn })
    let raw: unknown
    let expectedTurn: number | undefined
    if (event.type === 'tool/result') {
      const block = event.data.message.content.find((block) => block.type === 'tool-result')
      if (block?.type !== 'tool-result' || block.isError) continue
      const call = calls.get(String(block.toolCallId))
      if (call?.name !== S0_TOOL_NAME) continue
      expectedTurn = call.turn
      raw = event.data.meta
    } else if (
      event.type === 'tool/code-dispatch' &&
      event.data.name === S0_TOOL_NAME &&
      !event.data.isError
    ) {
      const call = calls.get(String(event.data.rootCallId))
      if (call?.name !== 'run_code') continue
      expectedTurn = call.turn
      raw = event.data.content
        .map((block) => block as unknown as { type: string; delivery?: unknown })
        .find((block) => block.type === S0_DELIVERY_KIND)?.delivery
    }
    if (!raw || typeof raw !== 'object') continue
    const item = raw as S0Delivery
    if (
      item.kind !== S0_DELIVERY_KIND ||
      item.schemaVersion !== 2 ||
      item.dshSessionId !== dshSessionId ||
      item.turn !== expectedTurn
    )
      continue
    try {
      const receipt = parsePresentationReceipt(item.receipt)
      const key = JSON.stringify([
        dshSessionId,
        item.turn,
        receipt.workspaceId,
        receipt.buildId,
        receipt.files.document.sha256,
        receipt.files.html.sha256,
      ])
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        kind: S0_DELIVERY_KIND,
        schemaVersion: 2,
        dshSessionId,
        turn: item.turn,
        receipt,
      })
    } catch {
      /* Invalid saved payloads never create a card. */
    }
  }
  return result
}

class ScriptedProbeAdapter extends LlmAdapter {
  #step = 0
  readonly #mode: 'native' | 'code' | 'both'
  constructor(mode: 'native' | 'code' | 'both') {
    super()
    this.#mode = mode
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.#step++
    if (step % 2 === 0) {
      const id = CallId(`s0-call-${step}`)
      const code = this.#mode === 'code'
      const name = code ? 'run_code' : S0_TOOL_NAME
      // Deliberately discard nested result. The durable receipt must survive without printing it.
      const args = JSON.stringify(
        code
          ? {
              description: 'S0 actual worker dispatch',
              code: `await tools.${S0_TOOL_NAME}({}); console.log("S0_DISPATCH_COMPLETED");`,
            }
          : {},
      )
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = 'S0 scripted model boundary complete.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

export async function validateS0Host(
  receipt: PresentationReceipt,
  workspaceRoot: string,
  outputRoot: string,
) {
  const versions: Record<string, string> = { node: process.version }
  const require = createRequire(import.meta.url)
  for (const name of [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-code-runtime-worker-thread',
    '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-session-persistence-jsonl',
  ]) {
    let location = path.dirname(
      require.resolve(name === '@deepseek-ai/dsh' ? `${name}/package.json` : name),
    )
    while (true) {
      try {
        const manifest = JSON.parse(
          await readFile(path.join(location, 'package.json'), 'utf8'),
        ) as { name: string; version: string }
        if (manifest.name === name) {
          versions[name] = manifest.version
          break
        }
      } catch {
        /* Walk to the package manifest. */
      }
      const parent = path.dirname(location)
      if (parent === location) throw new Error(`Cannot resolve package version: ${name}`)
      location = parent
    }
  }
  const modes = []
  for (const mode of ['native', 'both', 'code'] as const) {
    const ctx = new Context()
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlSessionPersistence, {
        root: path.join(outputRoot, 'sessions', mode),
        compression: 'none',
        packChunks: false,
      })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(WorkerThreadCodeRuntime, { maxWallMs: 10000 })
      await ctx.plugin(ToolRuntime, { mode })
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(AgentLoop, { agents: [] })
      ctx.llm.registerAdapter(['s0-scripted'], new ScriptedProbeAdapter(mode))
      installS0ReceiptProbe(
        ctx,
        receipt,
        new S0FileService((id) =>
          id === receipt.workspaceId ? { id, path: workspaceRoot } : undefined,
        ),
      )
      const id = SessionId(`presentation-s0-${mode}`)
      const agent = ctx.agentLoop.create(
        id,
        { provider: 's0-scripted', model: 'deterministic-seam' },
        { cwd: workspaceRoot },
      )
      for (let turn = 1; turn <= 2; turn++) {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: 'Execute the S0 receipt seam probe.' }],
            source: { kind: 'user' },
          }),
        )
        await agent.whenIdle()
      }
      assert.equal(await ctx.sessions.flush(agent.session), true)
      const stored = await ctx.sessionPersistence.load(id)
      assert.deepEqual(stored.events, agent.session.events)
      const deliveries = collectS0Deliveries(stored.events, String(id))
      assert.deepEqual(
        deliveries.map((item) => item.turn),
        [1, 2],
      )
      assert.ok(
        deliveries.every((item) => JSON.stringify(item.receipt) === JSON.stringify(receipt)),
      )
      assert.deepEqual(
        collectS0Deliveries([...stored.events, ...stored.events], String(id)),
        deliveries,
      )
      assert.deepEqual(collectS0Deliveries(stored.events, 'wrong-session'), [])
      const raw = await ctx.sessionPersistence.readRaw(id)
      assert.ok(raw)
      const text = JSON.stringify(stored.events)
      for (const file of Object.values(receipt.files))
        assert.ok(text.includes(file.path) && text.includes(file.sha256))
      const dispatches = stored.events.filter((event) => event.type === 'tool/code-dispatch')
      assert.equal(dispatches.length, mode === 'code' ? 2 : 0)
      if (mode === 'code') assert.ok(text.includes('S0_DISPATCH_COMPLETED'))
      modes.push({
        mode,
        sessionId: String(id),
        turns: deliveries.map((item) => item.turn),
        durablePath: ctx.sessionPersistence.locate(stored.meta)?.path,
        eventCount: stored.events.length,
        codeDispatches: dispatches.length,
        receipts: deliveries.length,
        replayDeduplicated: true,
        wrongSessionRejected: true,
        headlessText: receiptText(receipt),
      })
    } finally {
      await ctx.fiber.dispose()
    }
  }
  return {
    status: 'passed',
    boundary:
      'installed Harness AgentLoop/ToolRuntime/worker dispatch and JSONL persistence; deterministic scripted model adapter, no real LLM call',
    versions,
    modes,
  }
}
