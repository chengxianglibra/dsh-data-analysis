import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { waitForNextStepsAdvance } from '../../scripts/unified-analysis-ui/next-steps-host.ts'
import { NextStepsModel } from '../../src/client/next-steps-model.ts'
import { installNextStepsAgent } from '../../src/next-steps/agent.ts'
import {
  type NextStepsNotice,
  nextStepsInput,
  nextStepsNotice,
} from '../../src/next-steps/contracts.ts'
import { NextStepsService } from '../../src/next-steps/service.ts'
import { createAnalysisDocument } from '../../src/presentation/analysis.ts'
import { publishPresentation, readReportHistory } from '../../src/presentation/reports.ts'
import { TestShellEnv } from '../test-shell-env.ts'

const items = [{ label: 'Compare regions', prompt: 'Compare the regions in the saved analysis.' }]
const notice: NextStepsNotice = {
  sessionId: 'session',
  workspaceId: 'workspace',
  turn: 1,
  reportId: 'report',
  buildId: 'build',
  status: 'available',
  items,
}
const stop: StreamChunk[] = [{ type: 'finish', reason: { kind: 'stop' } }]

test('acceptance inspection pause releases on advance and cancellation', async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController()
    let release: (() => void) | undefined
    const waiting = waitForNextStepsAdvance(controller.signal, (value) => {
      release = value
    })
    assert.ok(release)
    if (cancelled) {
      controller.abort(new Error('inspection cancelled'))
      await assert.rejects(waiting, /inspection cancelled/)
    } else {
      release()
      await waiting
    }
    assert.equal(release, undefined)
  }
  const signal = AbortSignal.abort(new Error('already cancelled'))
  await assert.rejects(
    waitForNextStepsAdvance(signal, () => assert.fail()),
    /already cancelled/,
  )
})
function call(name: string, args: object): StreamChunk[] {
  const id = ToolCallId(randomUUID()),
    argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: argumentsJson },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
class Script extends LlmAdapter {
  requests = 0
  private readonly chunks: Array<StreamChunk[] | Error>
  constructor(chunks: Array<StreamChunk[] | Error>) {
    super()
    this.chunks = chunks
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  async *stream(_options: GenerateOptions) {
    this.requests++
    const chunks = this.chunks.shift()
    if (!chunks) throw new Error('script-exhausted')
    if (chunks instanceof Error) throw chunks
    yield* chunks
  }
}
async function harness(script: Script) {
  const ctx = new Context()
  for (const plugin of [
    LlmRuntime,
    SessionStore,
    SystemPrompt,
    TestShellEnv,
    ToolRuntime,
    AgentRegistry,
    SessionProjectionRegistry,
  ])
    await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], script)
  return ctx
}

test('next-step schema validates Unicode lengths, closed fields and duplicate content', () => {
  assert.equal(nextStepsInput.parse({ items: [] }).items.length, 0)
  assert.equal(nextStepsInput.parse({ items: [], emptyReason: 'declined' }).emptyReason, 'declined')
  assert.equal(nextStepsNotice.safeParse({ ...notice, items: [] }).success, false)
  assert.equal(
    nextStepsNotice.safeParse({ ...notice, status: 'unavailable', items: [] }).success,
    false,
  )
  assert.equal(
    nextStepsInput.parse({ items: [{ label: '🙂'.repeat(40), prompt: ' x ' }] }).items[0]?.prompt,
    'x',
  )
  for (const value of [
    { items, sessionId: 'forged' },
    { items, emptyReason: 'declined' },
    { items: [], emptyReason: 'failed' },
    { items: [...items, ...items] },
    { items: [{ label: ' ', prompt: 'x' }] },
    { items: [{ label: '🙂'.repeat(41), prompt: 'x' }] },
  ])
    assert.equal(nextStepsInput.safeParse(value).success, false)
})

test('live stream has no baseline, cross-session publication or reconnect replay', async () => {
  const ctx = new Context(),
    bus = new NextStepsService(ctx),
    lifetime = new AbortController()
  bus.publish(notice)
  const iterator = bus.watch('session', lifetime.signal)[Symbol.asyncIterator]()
  const first = iterator.next()
  bus.publish({ ...notice, sessionId: 'another' })
  bus.publish({ ...notice, turn: 2 })
  assert.equal((await first).value?.turn, 2)
  lifetime.abort()
  await iterator.next()
  const second = bus.watch('session', new AbortController().signal)[Symbol.asyncIterator]()
  const pending = second.next()
  bus.close()
  assert.equal((await pending).done, true)
})

test('Chat model consumes once, rejects late or foreign notices and never restores consumed options', () => {
  const model = new NextStepsModel()
  model.accept({ ...notice, sessionId: 'another' }, notice)
  assert.equal(model.value, undefined)
  model.accept(notice, notice)
  let sends = 0
  model.submit(1, 0, () => false)
  assert.ok(model.value)
  model.submit(1, 0, (prompt) => {
    sends++
    assert.equal(prompt, items[0]!.prompt)
    model.submit(1, 0, () => {
      sends++
      return true
    })
    return true
  })
  model.accept(notice, notice)
  model.submit(1, 0, () => {
    sends++
    return true
  })
  assert.equal(sends, 1)
  assert.equal(model.value, undefined)
  assert.equal(new NextStepsModel().value, undefined)
})

for (const nested of [false, true])
  for (const completes of [false, true])
    for (const response of ['items', 'empty', 'omitted'] as const) {
      test(`real Harness completion generates live-only recommendations (nested=${nested}, concludesTurn=${completes}, response=${response})`, async () => {
        const invoke = (name: string, args: object) =>
          nested ? call('nested_transport', { target: name, params: args }) : call(name, args)
        const script = new Script([
          invoke('marivo_present', {}),
          ...(completes ? [] : [stop]),
          ...(response === 'omitted'
            ? []
            : [invoke('marivo_next_steps', { items: response === 'empty' ? [] : items })]),
          stop,
        ])
        const ctx = await harness(script)
        const agent = await ctx.agentLoop.create(
          SessionId(`next-${nested}-${completes}-${response}`),
          {
            provider: 'mock',
            model: 'mock',
          },
        )
        const published: NextStepsNotice[] = []
        const dispose = installNextStepsAgent(
          ctx,
          agent,
          () => ({ id: 'workspace', path: '/workspace' }),
          (value) => published.push(value),
        )
        const present = agent.ctx.tools.register(
          defineTool({
            name: 'marivo_present',
            description: 'fixture saved delivery',
            parameters: {},
            output: { schema: { type: 'json' }, render: () => [] },
            async execute(_args, exec) {
              const root = [...agent.session.snapshotEvents()]
                .reverse()
                .find(
                  (event) => event.type === 'tool/call' && event.data.callId === exec.rootCallId,
                )
              assert.equal(root?.type, 'tool/call')
              const delivery = {
                kind: 'marivo.presentation.delivery',
                schemaVersion: 2,
                surface: 'tool',
                dshSessionId: String(agent.session.id),
                turn: root.data.turn,
                receipt: {
                  kind: 'marivo.presentation',
                  schemaVersion: 2,
                  workspaceId: 'workspace',
                  reportId: 'report',
                  buildId: 'build',
                  title: 'Analysis',
                  summary: 'Saved',
                  files: {
                    document: {
                      asset: 'presentation.json',
                      path: '/workspace/.dsh-data-analysis/presentations/report/builds/build/presentation.json',
                      bytes: 10,
                      sha256: 'a'.repeat(64),
                    },
                  },
                },
              }
              if (completes) exec.concludeTurn()
              return { deliveryJson: JSON.stringify(delivery) }
            },
          }),
        )
        const code = agent.ctx.tools.register(
          defineTool({
            name: 'nested_transport',
            description: 'nested tool transport fixture',
            parameters: {
              target: { type: 'string', required: true },
              params: { type: 'json', required: true },
            },
            output: { schema: { type: 'json' }, render: () => [] },
            async execute(args, exec) {
              const result = await agent.ctx.tools.execute({
                callId: ToolCallId(randomUUID()),
                rootCallId: exec.rootCallId,
                name: args.target,
                arguments: args.params,
                agent,
                parent: exec.token,
                signal: exec.signal,
              })
              assert.equal(result.isError, false)
              if (!result.isError && result.concludesTurn) exec.concludeTurn()
              return { discarded: true }
            },
          }),
        )
        try {
          agent.followup(
            createUserMessage({
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Analyze' }],
            }),
          )
          await agent.whenIdle()
          assert.equal(script.requests, completes ? 2 : 3)
          assert.equal(
            [...agent.session.snapshotEvents()].reverse().find((event) => event.type === 'turn/end')
              ?.data.reason.kind,
            'completed',
          )
          assert.equal(
            published.filter((value) => value.items.length).length,
            response === 'items' ? 1 : 0,
          )
          assert.equal(published.length, 1)
          assert.equal(published[0]?.reportId, 'report')
          assert.equal(published[0]?.buildId, 'build')
          assert.equal(published[0]?.status, response === 'items' ? 'available' : 'unavailable')
          if (response === 'items') assert.deepEqual(published[0]?.items, items)
          else
            assert.equal(
              published[0]?.reason,
              response === 'empty' ? 'no-suggestions' : 'generation-incomplete',
            )
          const messages = agent.session
            .snapshotEvents()
            .filter(
              (event) =>
                event.type === 'user/message' && event.data.source.kind === 'marivo-next-steps',
            )
          assert.equal(messages.length, 1)
          assert.ok(
            !agent.session
              .snapshotEvents()
              .some(
                (event) =>
                  event.type === 'tool/result' &&
                  JSON.stringify(event.data.meta ?? {}).includes(items[0]!.prompt),
              ),
          )
        } finally {
          code()
          present()
          await dispose()
        }
      })
    }

function calls(entries: Array<[string, object]>): StreamChunk[] {
  return [
    ...entries.flatMap(([name, args], index) =>
      call(name, args)
        .slice(0, -1)
        .map((chunk) => ('index' in chunk ? { ...chunk, index } : chunk)),
    ),
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

async function reportHarness(
  chunks: Array<StreamChunk[] | Error>,
  onSave?: (agent: Agent) => void,
) {
  const script = new Script(chunks)
  const ctx = await harness(script)
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), {
    provider: 'mock',
    model: 'mock',
  })
  const published: NextStepsNotice[] = []
  const dispose = installNextStepsAgent(
    ctx,
    agent,
    () => ({ id: 'workspace', path: '/workspace' }),
    (value) => published.push(value),
  )
  const present = agent.ctx.tools.register(
    defineTool({
      name: 'marivo_present',
      description: 'fixture saved delivery',
      parameters: { build: { type: 'string' }, receiptTurn: { type: 'integer' } },
      output: { schema: { type: 'json' }, render: () => [] },
      async execute(args, exec) {
        const root = [...agent.session.snapshotEvents()]
          .reverse()
          .find((event) => event.type === 'tool/call' && event.data.callId === exec.rootCallId)
        assert.equal(root?.type, 'tool/call')
        onSave?.(agent)
        const buildId = args.build ?? 'build'
        return {
          deliveryJson: JSON.stringify({
            kind: 'marivo.presentation.delivery',
            schemaVersion: 2,
            surface: 'tool',
            dshSessionId: String(agent.session.id),
            turn: args.receiptTurn ?? root.data.turn,
            receipt: {
              kind: 'marivo.presentation',
              schemaVersion: 2,
              workspaceId: 'workspace',
              reportId: 'report',
              buildId,
              title: 'Analysis',
              summary: 'Saved',
              files: {
                document: {
                  asset: 'presentation.json',
                  path: `/workspace/.dsh-data-analysis/presentations/report/builds/${buildId}/presentation.json`,
                  bytes: 10,
                  sha256: 'a'.repeat(64),
                },
              },
            },
          }),
        }
      },
    }),
  )
  const run = async (text = 'Analyze') => {
    agent.followup(
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    )
    await agent.whenIdle()
  }
  return {
    ctx,
    agent,
    script,
    published,
    run,
    async close() {
      present()
      await dispose()
    },
  }
}

test('each completed report creation or update gets freshly generated next steps', async () => {
  const fresh = [{ label: 'Inspect trends', prompt: 'Inspect trends in the updated report.' }]
  const fixture = await reportHarness([
    call('marivo_present', { build: 'initial' }),
    call('marivo_next_steps', { items }),
    call('marivo_present', { build: 'updated' }),
    call('marivo_next_steps', { items: fresh }),
    stop,
  ])
  try {
    await fixture.run()
    await fixture.run('Update the report')
    await fixture.run('Thanks')
    assert.deepEqual(
      fixture.published.map(({ turn, buildId, items: value }) => ({ turn, buildId, items: value })),
      [
        { turn: 1, buildId: 'initial', items },
        { turn: 2, buildId: 'updated', items: fresh },
      ],
    )
    assert.equal(fixture.script.requests, 5)
  } finally {
    await fixture.close()
  }
})

test('only the final saved build publishes once when a later same-step save invalidates recommendations', async () => {
  const fresh = [{ label: 'Inspect updated trends', prompt: 'Inspect the updated trends.' }]
  const fixture = await reportHarness([
    call('marivo_present', { build: 'initial' }),
    calls([
      ['marivo_next_steps', { items }],
      ['marivo_present', { build: 'final' }],
    ]),
    call('marivo_next_steps', { items: fresh }),
  ])
  try {
    await fixture.run()
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'final')
    assert.deepEqual(fixture.published[0]?.items, fresh)
  } finally {
    await fixture.close()
  }
})

for (const result of ['empty', 'declined', 'recovered', 'omitted', 'failed'] as const)
  test(`empty recommendations have one bounded completion retry and preserve refusal (${result})`, async () => {
    const fixture = await reportHarness([
      call('marivo_present', {}),
      call('marivo_next_steps', {
        items: [],
        ...(result === 'declined' ? { emptyReason: 'declined' } : {}),
      }),
      ...(result === 'declined'
        ? []
        : [
            stop,
            ...(result === 'failed'
              ? []
              : result === 'omitted'
                ? [stop]
                : [
                    call('marivo_next_steps', {
                      items: result === 'recovered' ? items : [],
                      emptyReason: result === 'recovered' ? undefined : 'no-suggestions',
                    }),
                  ]),
          ]),
    ])
    try {
      await fixture.run(result === 'declined' ? 'Analyze without recommendations' : 'Analyze')
      assert.equal(fixture.published.length, 1)
      const value = fixture.published[0]
      assert.equal(
        value?.status,
        result === 'declined' ? 'declined' : result === 'recovered' ? 'available' : 'unavailable',
      )
      if (result === 'empty') assert.equal(value?.reason, 'no-suggestions')
      if (result === 'omitted') assert.equal(value?.reason, 'no-suggestions')
      if (result === 'failed') assert.equal(value?.reason, 'generation-failed')
      assert.equal(
        fixture.agent.session
          .snapshotEvents()
          .filter(
            (event) =>
              event.type === 'user/message' && event.data.source.kind === 'marivo-next-steps',
          ).length,
        result === 'declined' ? 0 : 1,
      )
      assert.equal(fixture.script.requests, result === 'declined' ? 2 : 4)
    } finally {
      await fixture.close()
    }
  })

for (const invalidation of ['cancel', 'new-input', 'stale-turn'] as const)
  test(`cancelled, superseded or stale saves cannot publish recommendations (${invalidation})`, async () => {
    const fixture = await reportHarness(
      [call('marivo_present', invalidation === 'stale-turn' ? { receiptTurn: 99 } : {}), stop],
      (agent) => {
        if (invalidation === 'cancel') agent.cancel({ kind: 'user' })
        if (invalidation === 'new-input')
          agent.steer(
            createUserMessage({
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Stop recommendations; answer this instead.' }],
            }),
          )
      },
    )
    try {
      await fixture.run()
      assert.equal(fixture.published.length, 0)
      assert.equal(
        fixture.agent.session
          .snapshotEvents()
          .filter(
            (event) =>
              event.type === 'user/message' && event.data.source.kind === 'marivo-next-steps',
          ).length,
        0,
      )
    } finally {
      await fixture.close()
    }
  })

test('unavailable status stays visible while decline and invalidation suppress stale notices', () => {
  const model = new NextStepsModel()
  model.accept(
    { ...notice, status: 'unavailable', reason: 'generation-incomplete', items: [] },
    notice,
  )
  assert.equal(model.value?.status, 'unavailable')
  model.accept(notice, notice)
  assert.equal(model.value?.status, 'unavailable')
  model.clear()
  model.accept(notice, notice)
  assert.equal(model.value, undefined)
  model.accept({ ...notice, turn: 2, status: 'declined', items: [] }, notice)
  model.accept({ ...notice, turn: 2 }, notice)
  assert.equal(model.value, undefined)
})

test('generation timeout reports unavailability without fabricated suggestions or another retry', async () => {
  const fixture = await reportHarness([
    call('marivo_present', {}),
    stop,
    new Error('generation-timeout'),
  ])
  try {
    await fixture.run()
    assert.equal(fixture.script.requests, 3)
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.status, 'unavailable')
    assert.equal(fixture.published[0]?.reason, 'generation-failed')
    assert.deepEqual(fixture.published[0]?.items, [])
  } finally {
    await fixture.close()
  }
})

test('a fresh save after same-turn user steering can generate recommendations for the replacement report', async () => {
  const fixture = await reportHarness([
    call('marivo_present', { build: 'initial' }),
    call('marivo_present', { build: 'replacement' }),
    call('marivo_next_steps', { items }),
  ])
  let steered = false
  const stopObserver = fixture.agent.ctx.on('tools/result', (exec) => {
    if (exec.name !== 'marivo_present' || steered) return
    steered = true
    fixture.agent.steer(
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Update the report first.' }],
      }),
    )
  })
  try {
    await fixture.run()
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'replacement')
    const model = new NextStepsModel()
    model.accept(fixture.published[0], {
      sessionId: String(fixture.agent.session.id),
      workspaceId: 'workspace',
    })
    assert.equal(model.value?.status, 'available')
  } finally {
    stopObserver()
    await fixture.close()
  }
})

test('same-turn new input and another save do not reset the single completion retry', async () => {
  const fixture = await reportHarness([
    call('marivo_present', { build: 'initial' }),
    stop,
    call('marivo_present', { build: 'replacement' }),
    call('marivo_next_steps', { items: [], emptyReason: 'no-suggestions' }),
  ])
  const stopObserver = fixture.agent.ctx.on('agent/inbox/inserted', ({ message }) => {
    if (message.source.kind === 'marivo-next-steps')
      fixture.agent.steer(
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Update this report with my correction.' }],
        }),
      )
  })
  try {
    await fixture.run()
    assert.equal(fixture.script.requests, 4)
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.status, 'unavailable')
    assert.equal(fixture.published[0]?.buildId, 'replacement')
    assert.equal(
      fixture.agent.session
        .snapshotEvents()
        .filter(
          (event) =>
            event.type === 'user/message' && event.data.source.kind === 'marivo-next-steps',
        ).length,
      1,
    )
  } finally {
    stopObserver()
    await fixture.close()
  }
})

test('cancellation after recommendations are received discards them before publication', async () => {
  const fixture = await reportHarness([
    call('marivo_present', {}),
    call('marivo_next_steps', { items }),
  ])
  const stopObserver = fixture.agent.ctx.on('tools/result', (exec) => {
    if (exec.name === 'marivo_next_steps') fixture.agent.cancel({ kind: 'user' })
  })
  try {
    await fixture.run()
    assert.equal(fixture.published.length, 0)
  } finally {
    stopObserver()
    await fixture.close()
  }
})

test('explicit recommendations read an existing report without publishing another Build', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'next-steps-report-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const signal = new AbortController().signal
  const document = await createAnalysisDocument(
    { surface: 'tool', title: 'Existing', program: 'root=TextContent("Saved analysis");' },
    { projectRoot: root },
    { workspaceId: 'workspace', reportId: randomUUID(), buildId: randomUUID() },
    signal,
  )
  await publishPresentation(root, document, null, async () => {}, signal, {
    kind: 'agent',
    sessionId: 'original',
    surface: 'tool',
  })
  const before = await readReportHistory(root, 'workspace', document.reportId)
  const script = new Script([
    call('marivo_next_steps', { items, recordId: document.recordId }),
    call('marivo_next_steps', { items, recordId: document.recordId }),
    stop,
  ])
  const ctx = await harness(script)
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), {
    provider: 'mock',
    model: 'mock',
  })
  let identity = { id: 'workspace', path: root }
  const published: NextStepsNotice[] = []
  const dispose = installNextStepsAgent(
    ctx,
    agent,
    () => identity,
    (value) => published.push(value),
  )
  t.after(dispose)
  const run = async () => {
    agent.followup(
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Show next steps for the existing report' }],
      }),
    )
    await agent.whenIdle()
  }
  await run()
  assert.equal(script.requests, 1)
  assert.equal(published.length, 1)
  assert.equal(published[0]?.buildId, document.buildId)
  assert.ok(published[0]?.callId)
  assert.deepEqual(await readReportHistory(root, 'workspace', document.reportId), before)
  assert.equal(
    agent.session
      .snapshotEvents()
      .some((event) => event.type === 'tool/call' && event.data.name === 'marivo_present'),
    false,
  )
  identity = { id: 'foreign-workspace', path: root }
  await run()
  assert.equal(published.length, 1, 'a foreign Workspace cannot publish recommendations')
  assert.deepEqual(await readReportHistory(root, 'workspace', document.reportId), before)
})
