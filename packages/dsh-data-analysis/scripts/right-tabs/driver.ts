/** Isolated production Agent/Tool driver. Only the model boundary is scripted. */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import { draftReportRef } from '../../src/presentation/contracts/report-ref.ts'
import { type DraftDelivery, draftDeliverySchema } from '../../src/presentation/receipt.ts'
import { listReports, readReceiptDocument } from '../../src/presentation/reports.ts'
import {
  actualDeliveries,
  type PresentationRequest,
  ScriptedPresentationAdapter,
} from '../presentation-s4/host.ts'

class CredentialAdapter extends LlmAdapter {
  #sent = false
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title' || this.#sent) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.#sent = true
    const id = ToolCallId('right-tabs-credential-test'),
      name = 'marivo_datasource_test',
      args = JSON.stringify({ name: 'protected' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

class SemanticQuestionAdapter extends LlmAdapter {
  readonly requests: { marker: boolean; text: string; reportText: string }[] = []
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== 'session-title') {
      const texts: string[] = []
      const visit = (value: unknown) => {
        if (typeof value === 'string') texts.push(value)
        else if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(options.messages)
      const text = texts.find((value) => value.includes('<marivo-semantic-ref>')) ?? ''
      this.requests.push({
        marker: !!text,
        text,
        reportText: texts.find((value) => value.includes('【报告上下文】')) ?? '',
      })
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class ReportDraftAdapter extends LlmAdapter {
  #step = 0
  #permitted = 0
  readonly #resources: () => Promise<
    NonNullable<NonNullable<PresentationRequest['resourcePatch']>['put']>
  >
  readonly #latestDraft: () => DraftDelivery | undefined
  constructor(
    resources: () => Promise<NonNullable<NonNullable<PresentationRequest['resourcePatch']>['put']>>,
    latestDraft: () => DraftDelivery | undefined,
  ) {
    super()
    this.#resources = resources
    this.#latestDraft = latestDraft
  }
  advance() {
    this.#permitted++
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title' || this.#step === 3) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const step = this.#step++
    while (this.#permitted < step) await delay(100, undefined, { signal: options.signal })
    const draft = step ? this.#latestDraft() : undefined
    assert.ok(!step || draft, 'An actual preview must return a draft identity')
    const resources = await this.#resources()
    const [first, second] = Object.keys(resources)
    assert.ok(first && second)
    const identity = draft
      ? {
          ref: draftReportRef({
            workspaceId: draft.workspaceId,
            sessionId: draft.dshSessionId,
            turn: draft.turn,
            draftId: draft.draftId,
            revision: draft.draftRevision,
          }),
        }
      : {}
    const args = JSON.stringify(
      step === 0
        ? {
            stage: 'preview',
            title: '逐步更新验收',
            resourcePatch: { put: { [first]: resources[first] } },
            program: `root = Stack([TextContent("首个指标已就绪"), AnalysisFrameView("${first}")]);`,
          }
        : step === 1
          ? {
              stage: 'preview',
              ...identity,
              resourcePatch: { put: { [second]: resources[second] } },
              program: `root = Stack([TextContent("两个指标已就绪"), AnalysisFrameView("${first}"), AnalysisFrameView("${second}")]);`,
            }
          : { stage: 'save', ...identity },
    )
    const id = ToolCallId(`report-draft-${step}`)
    const name = 'marivo_report_write'
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

export async function createRightTabsDriver(
  ctx: Context,
  workspace: any,
  requests: readonly PresentationRequest[],
  resume = false,
) {
  const agents = new Map<string, any>()
  const semantic = new SemanticQuestionAdapter()
  const reportDraft = new ReportDraftAdapter(
    async () => {
      const { reports } = await listReports(workspace.path, String(workspace.id))
      const seed = reports.find(({ receipt }) => receipt.title === requests[0]?.title)
      assert.ok(seed, 'The isolated report seed must already be saved')
      const document = await readReceiptDocument(workspace.path, seed.receipt)
      return Object.fromEntries(
        Object.entries(document.resources).map(([name, resource]) => [name, resource.declaration]),
      )
    },
    () => {
      for (const event of [...agents.get('draft').session.snapshotEvents()].reverse()) {
        if (event.type !== 'tool/result') continue
        const parsed = draftDeliverySchema.safeParse(event.data.meta)
        if (parsed.success) return parsed.data
      }
      return undefined
    },
  )
  for (const mode of ['native', 'ptc', 'cold', 'credentials', 'semantic', 'draft'] as const) {
    const id = SessionId(`right-tabs-${mode}`),
      provider = `right-tabs-${mode}`
    ctx.llm.registerAdapter(
      [provider],
      mode === 'draft'
        ? reportDraft
        : mode === 'semantic'
          ? semantic
          : mode === 'credentials'
            ? new CredentialAdapter()
            : new ScriptedPresentationAdapter(
                mode === 'cold' ? 'native' : mode,
                Array.from({ length: 12 }, (_, i) => requests[i % requests.length]!),
                () =>
                  actualDeliveries(agents.get(mode).session.snapshotEvents(), id).at(-1)?.receipt,
              ),
    )
    const agentOptions = { provider, model: 'deterministic-seam' }
    const agent = resume
      ? (await ctx.agentLoop.resume(ctx, { resumeSessionId: id, agentOptions })).agent
      : await ctx.agentLoop.create(id, agentOptions, { cwd: workspace.path })
    agents.set(mode, agent)
    await agent.ctx.plugin(FilesystemTools)
    agent.ctx.tools.presentAs(mode === 'ptc' ? 'ptc' : 'native')
    await workspace.attachSession(id)
    if (mode === 'semantic' && !resume) {
      agent.followup(
        createUserMessage({
          content: [
            { type: 'text', text: 'Initialize the isolated composer Session; do not use tools.' },
          ],
          source: { kind: 'user' },
        }),
      )
      await agent.whenIdle()
      semantic.requests.length = 0
    }
  }
  return async (payload: any) => {
    if (payload.action === 'semantic-recreate-workspace') {
      const agent = agents.get('semantic')
      await ctx.workspaceRegistry.delete(workspace.id)
      const fresh = await ctx.workspaceRegistry.create(
        workspace.path,
        'Recreated semantic Workspace',
      )
      await fresh.attachSession(agent.session.id)
      return {
        ok: true,
        value: {
          workspaceId: String(fresh.id),
          sameAgent:
            ctx.agents.list().find((item) => item.session.id === agent.session.id) === agent,
        },
      }
    }
    if (payload.action === 'semantic-requests') {
      await agents.get('semantic').whenIdle()
      return { ok: true, value: semantic.requests }
    }
    const agent = agents.get(payload?.mode)
    assert.ok(agent, 'Unknown isolated session')
    if (payload.mode === 'draft' && payload.action === 'start-draft') {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: '在一个报告草稿里逐步展示两个数据视图，然后保存。' }],
          source: { kind: 'user' },
        }),
      )
      return { ok: true }
    }
    if (payload.mode === 'draft' && payload.action === 'advance-draft') {
      reportDraft.advance()
      return { ok: true }
    }
    if (payload.action === 'detach') {
      await workspace.detachSession(agent.session.id)
      return { ok: true }
    }
    if (payload.action === 'attach') {
      await workspace.attachSession(agent.session.id)
      return { ok: true }
    }
    if (payload.action === 'credential-start') {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'Test protected datasource.' }],
          source: { kind: 'user' },
        }),
      )
      return { ok: true }
    }
    if (payload.action === 'credential-idle') {
      await agent.whenIdle()
      return {
        ok: true,
        value: agent.session
          .snapshotEvents()
          .filter((event: any) => event.type === 'tool/result')
          .map((event: any) => ({
            isError: event.data.message.content[0]?.isError,
            content: event.data.message.content,
          })),
      }
    }
    if (payload.action === 'history') {
      assert.equal(payload.mode, 'credentials')
      for (let i = 0; i < 55; i++) {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: `Isolated pagination fixture ${i}` }],
            source: { kind: 'user' },
          }),
        )
        await agent.whenIdle()
      }
      return { ok: true }
    }
    if (payload.action === 'run') {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'Build the isolated report.' }],
          source: { kind: 'user' },
        }),
      )
      await agent.whenIdle()
      const deliveries = actualDeliveries(agent.session.snapshotEvents(), agent.session.id)
      assert.ok(deliveries.length, 'Production tool must deliver a report')
      return { ok: true, value: deliveries.at(-1) }
    }
    if (payload.action === 'status')
      return {
        ok: true,
        value: {
          sessionId: agent.session.id,
          deliveries: actualDeliveries(agent.session.snapshotEvents(), agent.session.id),
        },
      }
    throw new Error('Unknown isolated action')
  }
}
