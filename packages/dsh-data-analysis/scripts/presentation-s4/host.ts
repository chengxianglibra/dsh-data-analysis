/** Production plugin on actual Harness services; deterministic adapter stops at the model boundary. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  CallId,
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { apply, inject } from '../../src/plugin.ts'
import { parsePresentationReceipt } from '../../src/presentation/contracts/index.ts'
import type { PresentationReceipt } from '../../src/presentation/contracts/types.ts'
import {
  installConnectionFixture,
  installStorage,
} from '../../tests/semantic-reference-input/fixtures.ts'
import { TestShellEnv } from '../../tests/test-shell-env.ts'

export type PresentationMode = 'native' | 'both' | 'code'
export interface ActualDelivery {
  kind: 'marivo.presentation.delivery'
  schemaVersion: 1
  dshSessionId: string
  turn: number
  receipt: PresentationReceipt
}

export class ScriptedPresentationAdapter extends LlmAdapter {
  #step = 0
  readonly mode: PresentationMode
  readonly draftPaths: readonly string[]
  readonly runId = randomUUID()
  constructor(mode: PresentationMode, draftPaths: readonly string[]) {
    super()
    this.mode = mode
    this.draftPaths = draftPaths
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Real DSH Web requests auxiliary titles through the same adapter. They must
    // not advance the deterministic conversation cursor.
    if (options.purpose === 'session-title') {
      const text = 'S4 production Tool delivery'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    assert.equal(options.purpose, undefined)
    const step = this.#step++
    const phase = step % 4
    const turnIndex = Math.floor(step / 4)
    if (phase < 3) {
      const draft = this.draftPaths[turnIndex]
      assert.ok(draft, 'Scripted model received an unexpected extra Tool request')
      const id = CallId(`s4-${this.mode}-${step}`)
      const codeDispatch = this.mode === 'code' || (this.mode === 'both' && step === 1)
      const file = `s4-produced-${this.runId}-${turnIndex}.txt`
      const toolName = phase === 0 ? 'write' : phase === 1 ? 'marivo_present' : 'read'
      const toolArgs =
        phase === 0
          ? { file_path: file, content: 'Ordinary Harness produced file before report delivery.\n' }
          : phase === 1
            ? { draft_path: draft }
            : { file_path: file }
      const name = codeDispatch ? 'run_code' : toolName
      const args = JSON.stringify(
        codeDispatch
          ? {
              description: 'Production tool through actual worker dispatch',
              code: `await tools.${toolName}(${JSON.stringify(toolArgs)}); console.log("S4_DISPATCH_COMPLETED");`,
            }
          : toolArgs,
      )
      if (step === 0) {
        const text =
          'S4 pre-tool explanation; the successful result must appear without a later assistant message.'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      }
      const index = step === 0 ? 1 : 0
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, name, argumentsDelta: args }
      yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      if (turnIndex === 0) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const text = 'S4 deterministic model boundary complete.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

/** Inspect the persisted wire evidence, without manufacturing metadata or cards. */
export function actualDeliveries(
  events: readonly SessionEvent[],
  sessionId: string,
): ActualDelivery[] {
  const result: ActualDelivery[] = []
  for (const event of events) {
    let raw: unknown
    if (event.type === 'tool/result') raw = event.data.meta
    if (
      event.type === 'tool/code-dispatch' &&
      event.data.name === 'marivo_present' &&
      !event.data.isError
    )
      raw = event.data.content
        .map((item) => item as unknown as { type: string; delivery?: unknown })
        .find((item) => item.type === 'marivo.presentation.delivery')?.delivery
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as { kind?: string }).kind !== 'marivo.presentation.delivery'
    )
      continue
    const value = raw as ActualDelivery
    assert.equal(value.dshSessionId, sessionId)
    assert.equal(value.schemaVersion, 1)
    result.push({ ...value, receipt: parsePresentationReceipt(value.receipt) })
  }
  return result
}

export async function runPresentationJourneys(
  ctx: Context,
  workspaceRoot: string,
  outputRoot: string,
  mode: PresentationMode,
  draftPaths: readonly string[],
  duplicateDispatch = false,
) {
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'S4 presentation validation')
  const provider = `s4-scripted-${mode}`
  ctx.llm.registerAdapter([provider], new ScriptedPresentationAdapter(mode, draftPaths))
  const sessionId = SessionId(`presentation-s4-${mode}`)
  const agent = ctx.agentLoop.create(
    sessionId,
    { provider, model: 'deterministic-seam' },
    { cwd: workspace.path },
  )
  // This direct AgentLoop journey does not load a Web agent preset. Install the
  // real filesystem tools in its Agent scope, just as the preset normally does.
  await agent.ctx.plugin(FilesystemTools)
  let duplicated = false
  let duplicateError: unknown
  const stopDuplicate = agent.ctx.on('session/event', (owner, event) => {
    if (
      duplicateDispatch &&
      !duplicated &&
      owner.id === agent.session.id &&
      event.type === 'tool/code-dispatch' &&
      event.data.name === 'marivo_present'
    ) {
      duplicated = true
      // Replay one actual receipt as a second durable transport event while its
      // original Turn is still active. No file or success payload is invented.
      queueMicrotask(() => {
        try {
          owner.append('tool/code-dispatch', event.data)
        } catch (error) {
          duplicateError = error
        }
      })
    }
  })
  await workspace.attachSession(sessionId)
  assert.ok(workspace.sessionIds.includes(sessionId))
  for (const draft of draftPaths) {
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: `S4 presentation validation: ${draft}` }],
        source: { kind: 'user' },
      }),
    )
    await agent.whenIdle()
  }
  stopDuplicate()
  assert.ifError(duplicateError)
  if (duplicateDispatch)
    assert.equal(
      duplicated,
      true,
      'The actual Code dispatch event did not reach its Agent-scoped validation observer',
    )
  assert.equal(await ctx.sessions.flush(agent.session), true)
  const stored = await ctx.sessionPersistence.load(sessionId)
  assert.deepEqual(stored.events, agent.session.events)
  const rawDeliveries = actualDeliveries(stored.events, String(sessionId))
  assert.equal(rawDeliveries.length, draftPaths.length + (duplicateDispatch ? 1 : 0))
  const deliveries = [
    ...new Map(
      rawDeliveries.map((item) => [JSON.stringify([item.turn, item.receipt.buildId]), item]),
    ).values(),
  ]
  assert.equal(
    deliveries.length,
    draftPaths.length,
    JSON.stringify(stored.events.filter((event) => event.type === 'tool/result')),
  )
  assert.deepEqual(
    deliveries.map((item) => item.turn),
    draftPaths.map((_, index) => index + 1),
  )
  assert.equal(new Set(deliveries.map((item) => item.receipt.buildId)).size, draftPaths.length)
  assert.ok(deliveries.every((item) => item.receipt.workspaceId === String(workspace.id)))
  const dispatches = stored.events.filter(
    (event) => event.type === 'tool/code-dispatch' && event.data.name === 'marivo_present',
  )
  assert.equal(
    dispatches.length,
    (mode === 'code' ? draftPaths.length : mode === 'both' ? 1 : 0) + (duplicateDispatch ? 1 : 0),
  )
  const text = stored.events
    .flatMap((event) => {
      if (event.type === 'tool/code-dispatch')
        return event.data.content.flatMap((item) => (item.type === 'text' ? [item.text] : []))
      if (event.type === 'tool/result')
        return event.data.message.content.flatMap((block) =>
          block.type === 'tool-result'
            ? block.content.flatMap((item) => (item.type === 'text' ? [item.text] : []))
            : [],
        )
      return []
    })
    .join('\n')
  for (const delivery of deliveries)
    for (const file of Object.values(delivery.receipt.files))
      assert.ok(text.includes(file.path) && text.includes(file.sha256))
  if (mode === 'code') assert.ok(text.includes('S4_DISPATCH_COMPLETED'))
  const firstResult = stored.events.find(
    (event) =>
      event.type === (mode === 'native' ? 'tool/result' : 'tool/code-dispatch') &&
      (event.type === 'tool/code-dispatch'
        ? event.data.name === 'marivo_present'
        : (event.data.meta as { kind?: string } | undefined)?.kind ===
          'marivo.presentation.delivery'),
  )!
  const firstEnd = stored.events.find((event) => event.type === 'turn/end')!
  assert.ok(firstResult && firstEnd)
  for (const event of stored.events) {
    if (event.type === 'tool/result')
      for (const block of event.data.message.content)
        if (block.type === 'tool-result')
          assert.notEqual(block.isError, true, JSON.stringify(block.content))
    if (event.type === 'tool/code-dispatch') assert.equal(event.data.isError, false)
  }
  for (const turn of deliveries.map((delivery) => delivery.turn)) {
    const start = stored.events.find(
      (event) => event.type === 'turn/start' && event.data.turn === turn,
    )!
    const end = stored.events.find(
      (event) => event.type === 'turn/end' && event.data.turn === turn,
    )!
    const tools = stored.events.filter(
      (event) =>
        event.type === (mode === 'code' ? 'tool/code-dispatch' : 'tool/call') &&
        event.seq > start.seq &&
        event.seq < end.seq,
    )
    const names = tools.map((event) => (event.data as { name: string }).name)
    assert.equal(names[0], 'write')
    assert.equal(names.at(-1), 'read')
    assert.ok(names.includes(mode === 'both' && turn === 1 ? 'run_code' : 'marivo_present'))
  }
  assert.equal(
    stored.events.filter(
      (event) =>
        event.seq > firstResult.seq &&
        event.seq < firstEnd.seq &&
        event.type === 'assistant/message' &&
        event.data.message.content.some((block) => block.type === 'text'),
    ).length,
    0,
  )
  const result = {
    mode,
    sessionId: String(sessionId),
    workspaceId: String(workspace.id),
    durablePath: ctx.sessionPersistence.locate(stored.meta)?.path,
    eventCount: stored.events.length,
    codeDispatches: dispatches.length,
    deliveries,
    headlessTextIncludesPathsAndDigests: true,
    firstTurnHasNoPostToolAssistantText: true,
    ordinaryWriteBeforePresentAndReadAfter: true,
    duplicatedCodeReceiptEvents: rawDeliveries.length - deliveries.length,
    receiptProducedBy: 'production plugin ToolRuntime execution; no model result printing',
  }
  await writeFile(path.join(outputRoot, `${mode}-events.json`), JSON.stringify(stored, null, 2))
  await writeFile(path.join(outputRoot, `${mode}-evidence.json`), JSON.stringify(result, null, 2))
  return result
}

export async function validatePresentationHost(
  workspaceRoot: string,
  outputRoot: string,
  pythonExecutable: string,
  draftPaths: readonly string[],
) {
  const modes = []
  for (const mode of ['native', 'both', 'code'] as const) {
    const ctx = new Context()
    try {
      installConnectionFixture(ctx)
      await installStorage(ctx, path.join(outputRoot, mode, 'storage'))
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(LocalCredentialProvider, {
        dshHome: path.join(outputRoot, mode, 'home'),
        watch: false,
      })
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlSessionPersistence, {
        root: path.join(outputRoot, mode, 'sessions'),
        compression: 'none',
        packChunks: false,
      })
      await ctx.plugin(WorkspaceRegistry)
      await ctx.plugin(SkillRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(TestShellEnv)
      await ctx.plugin(WorkerThreadCodeRuntime, { maxWallMs: 120_000 })
      await ctx.plugin(ToolRuntime, { mode })
      await ctx.plugin(LocalFileSystem, { cwd: workspaceRoot })
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(
        { name: 's4-production-plugin', inject, apply },
        {
          pythonExecutable,
          runtimeRoot: path.join(outputRoot, mode, 'runtime-marker'),
          credentialInteraction: 'none',
        },
      )
      // A duplicate draft is a new invocation and must create an independent build.
      modes.push(
        await runPresentationJourneys(ctx, workspaceRoot, outputRoot, mode, [
          ...draftPaths,
          draftPaths[0]!,
        ]),
      )
    } finally {
      await ctx.fiber.dispose()
    }
  }
  return {
    status: 'passed',
    boundary:
      'actual Harness AgentLoop, production plugin registration and Workspace attachment, ToolRuntime, worker Code dispatch and JSONL persistence; scripted model adapter, no real LLM call',
    node: process.version,
    modes,
  }
}
