/** Production plugin on actual Harness services; deterministic adapter stops at the model boundary. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { apply, inject } from '../../src/plugin.ts'
import type { AnalysisPresentInput } from '../../src/presentation/contracts/analysis-document.ts'
import { analysisRecordId } from '../../src/presentation/contracts/analysis-document.ts'
import type { PresentationReceipt } from '../../src/presentation/contracts/types.ts'
import { presentationSha256, readPresentationAsset } from '../../src/presentation/files.ts'
import {
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../src/presentation/receipt.ts'
import { readReceiptDocument, resolvePresentation } from '../../src/presentation/reports.ts'
import {
  installConnectionFixture,
  installStorage,
} from '../../tests/semantic-reference-input/fixtures.ts'
import { TestShellEnv } from '../../tests/test-shell-env.ts'
import { inspectStoredSession } from '../harness-session.ts'

export type PresentationMode = 'native' | 'both' | 'ptc'
/** One scripted `marivo_present` creation input; updates add the previous recordId. */
export type PresentationRequest = Omit<AnalysisPresentInput, 'surface' | 'basedOnRecordId'>
export interface PresentationJourneyOptions {
  updateExistingReport?: boolean
}
export type ActualDelivery = PresentationDelivery

export class ScriptedPresentationAdapter extends LlmAdapter {
  #step = 0
  readonly mode: PresentationMode
  readonly requests: readonly PresentationRequest[]
  readonly previousReceipt?: () => PresentationReceipt | undefined
  readonly runId = randomUUID()
  constructor(
    mode: PresentationMode,
    requests: readonly PresentationRequest[],
    previousReceipt?: () => PresentationReceipt | undefined,
  ) {
    super()
    this.mode = mode
    this.requests = requests
    this.previousReceipt = previousReceipt
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
      const request = this.requests[turnIndex]
      assert.ok(request, 'Scripted model received an unexpected extra Tool request')
      const id = ToolCallId(`s4-${this.mode}-${step}`)
      const codeDispatch = this.mode === 'ptc' || (this.mode === 'both' && step === 1)
      const file = `s4-produced-${this.runId}-${turnIndex}.txt`
      const toolName = phase === 0 ? 'write' : phase === 1 ? 'marivo_present' : 'read'
      let updateTarget: { basedOnRecordId: string } | undefined
      if (phase === 1 && turnIndex > 0 && this.previousReceipt) {
        const receipt = this.previousReceipt()
        assert.ok(receipt, 'An update must use the previous actual Tool delivery')
        updateTarget = { basedOnRecordId: analysisRecordId(receipt.reportId, receipt.buildId) }
      }
      const toolArgs =
        phase === 0
          ? { file_path: file, content: 'Ordinary Harness produced file before report delivery.\n' }
          : phase === 1
            ? { ...request, ...updateTarget }
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
      // Harness links produced files when closing prose mentions their path in
      // inline code. Keep the first turn without a closing text boundary.
      const file = `s4-produced-${this.runId}-${turnIndex}.txt`
      const text = `S4 deterministic model boundary complete. Created \`${file}\`.`
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
      event.type === 'tool/ptc-dispatch' &&
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
    const value = parsePresentationDelivery(raw)
    assert.equal(value.dshSessionId, sessionId)
    assert.equal(value.schemaVersion, 2)
    result.push(value)
  }
  return result
}

export async function runPresentationJourneys(
  ctx: Context,
  workspaceRoot: string,
  outputRoot: string,
  mode: PresentationMode,
  requests: readonly PresentationRequest[],
  duplicateDispatch = false,
  options: PresentationJourneyOptions = {},
) {
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'S4 presentation validation')
  const provider = `s4-scripted-${mode}`
  const sessionId = SessionId(`presentation-s4-${mode}`)
  ctx.llm.registerAdapter(
    [provider],
    new ScriptedPresentationAdapter(
      mode,
      requests,
      options.updateExistingReport
        ? () => actualDeliveries(agent.session.snapshotEvents(), String(sessionId)).at(-1)?.receipt
        : undefined,
    ),
  )
  const agent = await ctx.agentLoop.create(
    sessionId,
    { provider, model: 'deterministic-seam' },
    { cwd: workspace.path },
  )
  // This direct AgentLoop journey does not load a Web agent preset. Install the
  // real filesystem tools in its Agent scope, just as the preset normally does.
  await agent.ctx.plugin(FilesystemTools)
  if (mode === 'both') {
    let restoreMode = agent.ctx.tools.presentAs('native')
    agent.ctx.on('session/event', (owner, event) => {
      if (owner.id !== agent.session.id || event.type !== 'tool/result') return
      const code = String(event.data.message.toolCallId).endsWith('-0')
      restoreMode()
      restoreMode = agent.ctx.tools.presentAs(code ? 'ptc' : 'native')
    })
  }
  let duplicated = false
  let duplicateError: unknown
  const stopDuplicate = agent.ctx.on('session/event', (owner, event) => {
    if (
      duplicateDispatch &&
      !duplicated &&
      owner.id === agent.session.id &&
      event.type === 'tool/ptc-dispatch' &&
      event.data.name === 'marivo_present'
    ) {
      duplicated = true
      // Replay the receipt under a distinct sub-call, with a matching start,
      // while the original Turn is active. Harness persists one settlement per start.
      queueMicrotask(() => {
        try {
          const { rootCallId, parentCallId, name, arguments: args } = event.data
          const subCallId = ToolCallId(`${event.data.subCallId}:fixture-replay`)
          owner.append('tool/ptc-dispatch-start', {
            rootCallId,
            parentCallId,
            subCallId,
            name,
            arguments: args,
          })
          owner.append('tool/ptc-dispatch', { ...event.data, subCallId })
        } catch (error) {
          duplicateError = error
        }
      })
    }
  })
  await workspace.attachSession(sessionId)
  assert.ok(workspace.sessionIds.includes(sessionId))
  for (const [index, request] of requests.entries()) {
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: `S4 presentation validation: ${request.title}` }],
        source: { kind: 'user' },
      }),
    )
    await agent.whenIdle()
    if (options.updateExistingReport) {
      const delivery = actualDeliveries(agent.session.snapshotEvents(), String(sessionId)).at(-1)
      assert.ok(delivery, 'Each update must produce an actual Tool receipt')
      assert.equal(delivery.turn, index + 1)
      assert.deepEqual(
        await resolvePresentation(workspaceRoot, String(workspace.id), delivery.receipt.reportId),
        delivery.receipt,
        'The published current pointer must equal the receipt returned by this turn',
      )
      // Read the saved version before the adapter bases its next update on that Build.
      await readReceiptDocument(workspaceRoot, delivery.receipt)
    }
  }
  stopDuplicate()
  assert.ifError(duplicateError)
  if (duplicateDispatch)
    assert.equal(
      duplicated,
      true,
      'The actual Code dispatch event did not reach its Agent-scoped validation observer',
    )
  assert.equal(await (ctx.get('sessions') as unknown as SessionStore).flush(agent.session), true)
  const stored = await inspectStoredSession(ctx.sessionPersistence, sessionId)
  assert.deepEqual(stored.events, agent.session.snapshotEvents())
  const rawDeliveries = actualDeliveries(stored.events, String(sessionId))
  assert.equal(rawDeliveries.length, requests.length + (duplicateDispatch ? 1 : 0))
  const deliveries = [
    ...new Map(
      rawDeliveries.map((item) => [JSON.stringify([item.turn, item.receipt.buildId]), item]),
    ).values(),
  ]
  assert.equal(
    deliveries.length,
    requests.length,
    JSON.stringify(stored.events.filter((event) => event.type === 'tool/result')),
  )
  assert.deepEqual(
    deliveries.map((item) => item.turn),
    requests.map((_, index) => index + 1),
  )
  assert.equal(new Set(deliveries.map((item) => item.receipt.buildId)).size, requests.length)
  assert.ok(deliveries.every((item) => item.receipt.workspaceId === String(workspace.id)))
  let reportUpdate:
    | {
        reportId: string
        buildIds: string[]
        current: PresentationReceipt
        historicalFilesMatchOriginalReceipts: true
      }
    | undefined
  if (options.updateExistingReport) {
    assert.ok(deliveries.length > 1, 'Report update validation requires multiple invocations')
    assert.equal(new Set(deliveries.map((item) => item.receipt.reportId)).size, 1)
    for (const { receipt } of deliveries) {
      await readReceiptDocument(workspaceRoot, receipt)
      for (const asset of Object.values(receipt.files)) {
        const bytes = await readPresentationAsset(
          workspaceRoot,
          receipt.reportId,
          receipt.buildId,
          asset.asset,
        )
        assert.equal(bytes.length, asset.bytes)
        assert.equal(presentationSha256(bytes), asset.sha256)
      }
    }
    const latest = deliveries.at(-1)!.receipt
    const current = await resolvePresentation(workspaceRoot, String(workspace.id), latest.reportId)
    assert.deepEqual(current, latest)
    reportUpdate = {
      reportId: latest.reportId,
      buildIds: deliveries.map((delivery) => delivery.receipt.buildId),
      current,
      historicalFilesMatchOriginalReceipts: true,
    }
  }
  const dispatches = stored.events.filter(
    (event) => event.type === 'tool/ptc-dispatch' && event.data.name === 'marivo_present',
  )
  assert.equal(
    dispatches.length,
    (mode === 'ptc' ? requests.length : mode === 'both' ? 1 : 0) + (duplicateDispatch ? 1 : 0),
  )
  const text = stored.events
    .flatMap((event) => {
      if (event.type === 'tool/ptc-dispatch')
        return event.data.content.flatMap((item) => (item.type === 'text' ? [item.text] : []))
      if (event.type === 'tool/result')
        return event.data.message.content.flatMap((item) =>
          item.type === 'text' ? [item.text] : [],
        )
      return []
    })
    .join('\n')
  for (const delivery of deliveries) {
    assert.ok(text.includes(analysisRecordId(delivery.receipt.reportId, delivery.receipt.buildId)))
    for (const file of Object.values(delivery.receipt.files))
      assert.ok(!text.includes(file.path) && !text.includes(file.sha256))
  }
  if (mode === 'ptc') assert.ok(text.includes('S4_DISPATCH_COMPLETED'))
  const firstResult = stored.events.find(
    (event) =>
      event.type === (mode === 'native' ? 'tool/result' : 'tool/ptc-dispatch') &&
      (event.type === 'tool/ptc-dispatch'
        ? event.data.name === 'marivo_present'
        : (event.data.meta as { kind?: string } | undefined)?.kind ===
          'marivo.presentation.delivery'),
  )!
  const firstEnd = stored.events.find((event) => event.type === 'turn/end')!
  assert.ok(firstResult && firstEnd)
  for (const event of stored.events) {
    if (event.type === 'tool/result')
      assert.notEqual(event.data.message.isError, true, JSON.stringify(event.data.message.content))
    if (event.type === 'tool/ptc-dispatch') assert.equal(event.data.isError, false)
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
        event.type === (mode === 'ptc' ? 'tool/ptc-dispatch' : 'tool/call') &&
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
    requests,
    sessionId: String(sessionId),
    workspaceId: String(workspace.id),
    durableSessionId: String(stored.meta.id),
    eventCount: stored.events.length,
    codeDispatches: dispatches.length,
    deliveries,
    headlessTextIncludesPathsAndDigests: true,
    firstTurnHasNoPostToolAssistantText: true,
    ordinaryWriteBeforePresentAndReadAfter: true,
    duplicatedCodeReceiptEvents: rawDeliveries.length - deliveries.length,
    receiptProducedBy: 'production plugin ToolRuntime execution; no model result printing',
    ...(reportUpdate ? { reportUpdate } : {}),
  }
  await writeFile(path.join(outputRoot, `${mode}-events.json`), JSON.stringify(stored, null, 2))
  await writeFile(path.join(outputRoot, `${mode}-evidence.json`), JSON.stringify(result, null, 2))
  return result
}

export async function validatePresentationHost(
  workspaceRoot: string,
  outputRoot: string,
  pythonExecutable: string,
  requests: readonly PresentationRequest[],
  options: PresentationJourneyOptions = {},
) {
  const modes = []
  for (const mode of ['native', 'both', 'ptc'] as const) {
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
      })
      await ctx.plugin(WorkspaceRegistry)
      await ctx.plugin(SkillRuntime)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(TestShellEnv)
      await ctx.plugin(LocalFileSystem, { cwd: workspaceRoot })
      await ctx.plugin(SubprocessLocal)
      await ctx.plugin(LocalSandbox, {})
      await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot })
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(WorkingDirectory, { defaultDirectory: process.cwd() })
      await ctx.plugin(NodePtcRuntime, { timeoutMs: 120_000 })
      await ctx.plugin(ToolRuntime, { mode: mode === 'both' ? 'native' : mode })
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
      // Every invocation creates an immutable Build, including a repeated request.
      modes.push(
        await runPresentationJourneys(
          ctx,
          workspaceRoot,
          outputRoot,
          mode,
          [...requests, requests[0]!],
          false,
          options,
        ),
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
