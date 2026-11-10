import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
import ToolRuntime, {
  defineTool,
  type ToolDefinition,
  type ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { waitForNextStepsAdvance } from '../../scripts/unified-analysis-ui/next-steps-host.ts'
import { NextStepsModel } from '../../src/client/next-steps-model.ts'
import { installNextStepsAgent } from '../../src/next-steps/agent.ts'
import {
  type NextStepsNotice,
  nextStepsInput,
  nextStepsNotice,
} from '../../src/next-steps/contracts.ts'
import { SavedWriteProofs } from '../../src/next-steps/saved-writes.ts'
import { NextStepsService } from '../../src/next-steps/service.ts'
import { createAnalysisDocument } from '../../src/presentation/analysis.ts'
import { savedReportRef } from '../../src/presentation/contracts/report-ref.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  parsePresentationDelivery,
} from '../../src/presentation/receipt.ts'
import { publishPresentation, readReportHistory } from '../../src/presentation/reports.ts'
import { createMarivoPresentTool } from '../../src/presentation/tool.ts'
import { TestShellEnv } from '../test-shell-env.ts'

const savedRef = (buildId = 'build') =>
  savedReportRef({ workspaceId: 'workspace', reportId: 'report', buildId })
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
    argumentsJson = JSON.stringify(
      name === 'marivo_next_steps' ? { ref: savedRef(), ...args } : args,
    )
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
  assert.equal(nextStepsInput.safeParse({ items }).success, false)
  assert.equal(nextStepsInput.safeParse({ items, recordId: 'legacy-record' }).success, false)
  assert.equal(nextStepsInput.parse({ ref: savedRef(), items: [] }).items.length, 0)
  assert.equal(
    nextStepsInput.parse({ ref: savedRef(), items: [], emptyReason: 'declined' }).emptyReason,
    'declined',
  )
  assert.equal(nextStepsNotice.safeParse({ ...notice, items: [] }).success, false)
  assert.equal(nextStepsNotice.safeParse({ ...notice, status: 'empty', items: [] }).success, true)
  assert.equal(
    nextStepsNotice.safeParse({
      ...notice,
      status: 'empty',
      reason: 'generation-failed',
      items: [],
    }).success,
    false,
  )
  assert.equal(
    nextStepsNotice.safeParse({ ...notice, status: 'unavailable', items: [] }).success,
    false,
  )
  assert.equal(
    nextStepsInput.parse({ ref: savedRef(), items: [{ label: '🙂'.repeat(40), prompt: ' x ' }] })
      .items[0]?.prompt,
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
    assert.equal(nextStepsInput.safeParse({ ref: savedRef(), ...value }).success, false)
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

function reminders(agent: Agent) {
  return agent.session
    .snapshotEvents()
    .filter(
      (event) => event.type === 'user/message' && event.data.source.kind === 'marivo-next-steps',
    )
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
  let identity = { id: 'workspace', path: '/workspace' }
  const published: NextStepsNotice[] = []
  const savedWrites = new SavedWriteProofs()
  const definition = defineTool({
    name: MARIVO_PRESENT_TOOL_NAME,
    description: 'fixture saved delivery',
    parameters: {
      build: { type: 'string' },
      receiptTurn: { type: 'integer' },
      refBuild: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: () => [] },
    async execute(args, exec) {
      const root = [...agent.session.snapshotEvents()]
        .reverse()
        .find((event) => event.type === 'tool/call' && event.data.callId === exec.rootCallId)
      assert.equal(root?.type, 'tool/call')
      onSave?.(agent)
      const buildId = args.build ?? 'build'
      const value = {
        ref: savedRef(args.refBuild ?? buildId),
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
      savedWrites.committed(exec, savedRef(buildId))
      return value
    },
  })
  let present = agent.ctx.tools.register(definition)
  const dispose = installNextStepsAgent(
    ctx,
    agent,
    () => identity,
    (value) => published.push(value),
    savedWrites,
  )
  const nested = agent.ctx.tools.register(
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
        assert.equal(result.concludesTurn, undefined)
        return { discarded: true }
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
    savedWrites,
    definition,
    rebindWriter: (tool: ToolDefinition) => {
      present()
      present = agent.ctx.tools.register(tool)
    },
    changeWorkspace: (value: typeof identity) => {
      identity = value
    },
    replaceWriter: () => {
      present()
      present = agent.ctx.tools.register({ ...definition })
    },
    dispose,
    async close() {
      nested()
      present()
      await dispose()
    },
  }
}

for (const nested of [false, true])
  for (const response of ['items', 'empty', 'declined'] as const)
    test(`accepted recommendations wait for normal Harness completion without steering (nested=${nested}, response=${response})`, async () => {
      const invoke = (name: string, args: object) =>
        nested
          ? call('nested_transport', {
              target: name,
              params: name === 'marivo_next_steps' ? { ref: savedRef(), ...args } : args,
            })
          : call(name, args)
      const fixture = await reportHarness([
        invoke(MARIVO_PRESENT_TOOL_NAME, {}),
        invoke('marivo_next_steps', {
          items: response === 'items' ? items : [],
          emptyReason:
            response === 'items' ? undefined : response === 'empty' ? 'no-suggestions' : 'declined',
        }),
        stop,
      ])
      const stopObserver = fixture.agent.ctx.on('tools/result', (exec, result) => {
        if (exec.name === 'marivo_next_steps') {
          assert.equal(result.concludesTurn, undefined)
          assert.equal(
            fixture.published.length,
            0,
            'recommendations are not published before Turn end',
          )
        }
      })
      try {
        await fixture.run()
        assert.equal(fixture.script.requests, 3)
        assert.equal(reminders(fixture.agent).length, 0)
        assert.equal(fixture.published.length, 1)
        assert.equal(
          fixture.published[0]?.status,
          response === 'items' ? 'available' : response === 'empty' ? 'empty' : 'declined',
        )
        assert.equal(fixture.published[0]?.reason, undefined)
        assert.deepEqual(fixture.published[0]?.items, response === 'items' ? items : [])
      } finally {
        stopObserver()
        await fixture.close()
      }
    })

test('recommendations allow a later file delivery and necessary final answer in the same Turn', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'next-steps-file-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'analysis.txt')
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, {}),
    call('marivo_next_steps', { items }),
    call('deliver_file', {}),
    [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Saved the requested file.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Saved the requested file.' } },
      ...stop,
    ],
  ])
  const file = fixture.agent.ctx.tools.register(
    defineTool({
      name: 'deliver_file',
      description: 'deliver requested file fixture',
      parameters: {},
      output: { schema: { type: 'json' }, render: () => [] },
      async execute() {
        assert.equal(fixture.published.length, 0)
        await writeFile(filename, 'Analysis delivery')
        return { delivered: true }
      },
    }),
  )
  try {
    await fixture.run()
    assert.equal(await readFile(filename, 'utf8'), 'Analysis delivery')
    assert.equal(fixture.script.requests, 4)
    assert.equal(fixture.published[0]?.status, 'available')
    assert.ok(
      JSON.stringify(fixture.agent.session.snapshotEvents()).includes('Saved the requested file.'),
    )
  } finally {
    file()
    await fixture.close()
  }
})

for (const response of ['omitted', 'failed'] as const)
  test(`missing recommendations receive at most one reminder (${response})`, async () => {
    const fixture = await reportHarness([
      call(MARIVO_PRESENT_TOOL_NAME, {}),
      stop,
      response === 'failed' ? new Error('generation-timeout') : stop,
    ])
    try {
      await fixture.run()
      assert.equal(fixture.script.requests, 3)
      assert.equal(reminders(fixture.agent).length, 1)
      assert.equal(fixture.published.length, 1)
      assert.equal(fixture.published[0]?.status, 'unavailable')
      assert.equal(
        fixture.published[0]?.reason,
        response === 'failed' ? 'generation-failed' : 'generation-incomplete',
      )
    } finally {
      await fixture.close()
    }
  })

test('each Turn gets fresh recommendations for its final saved version', async () => {
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
    call('marivo_next_steps', { ref: savedRef('initial'), items }),
    stop,
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'updated' }),
    call('marivo_next_steps', { ref: savedRef('updated'), items: [] }),
    stop,
    stop,
  ])
  try {
    await fixture.run()
    await fixture.run('Update')
    await fixture.run('Thanks')
    assert.deepEqual(
      fixture.published.map(({ turn, buildId, status }) => ({ turn, buildId, status })),
      [
        { turn: 1, buildId: 'initial', status: 'available' },
        { turn: 2, buildId: 'updated', status: 'empty' },
      ],
    )
    assert.equal(reminders(fixture.agent).length, 0)
  } finally {
    await fixture.close()
  }
})

test('a later save invalidates old recommendations and rejects the old saved ref', async () => {
  const fresh = [{ label: 'Inspect updated trends', prompt: 'Inspect updated trends.' }]
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
    call('marivo_next_steps', { ref: savedRef('initial'), items }),
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'final' }),
    call('marivo_next_steps', { ref: savedRef('initial'), items }),
    stop,
    call('marivo_next_steps', { ref: savedRef('final'), items: fresh }),
    stop,
  ])
  try {
    await fixture.run()
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'final')
    assert.deepEqual(fixture.published[0]?.items, fresh)
    assert.equal(reminders(fixture.agent).length, 1)
    assert.ok(
      fixture.agent.session
        .snapshotEvents()
        .some((event) => event.type === 'tool/result' && event.data.message.isError),
    )
  } finally {
    await fixture.close()
  }
})

for (const response of ['items', 'declined'] as const)
  test(`a failed later call preserves the accepted ${response} submission`, async () => {
    const fixture = await reportHarness([
      call(MARIVO_PRESENT_TOOL_NAME, {}),
      call('marivo_next_steps', {
        items: response === 'items' ? items : [],
        emptyReason: response === 'declined' ? 'declined' : undefined,
      }),
      call('marivo_next_steps', { ref: savedRef('wrong'), items }),
      stop,
    ])
    try {
      await fixture.run()
      assert.ok(
        fixture.agent.session
          .snapshotEvents()
          .some((event) => event.type === 'tool/result' && event.data.message.isError),
      )
      assert.equal(reminders(fixture.agent).length, 0)
      assert.equal(fixture.published.length, 1)
      assert.equal(fixture.published[0]?.status, response === 'items' ? 'available' : 'declined')
      assert.deepEqual(fixture.published[0]?.items, response === 'items' ? items : [])
    } finally {
      await fixture.close()
    }
  })

test('a new save after a submission publishes unavailable for the final version', async () => {
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
    call('marivo_next_steps', { ref: savedRef('initial'), items }),
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'final' }),
    stop,
    stop,
  ])
  try {
    await fixture.run()
    assert.equal(reminders(fixture.agent).length, 1)
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'final')
    assert.equal(fixture.published[0]?.status, 'unavailable')
    assert.deepEqual(fixture.published[0]?.items, [])
  } finally {
    await fixture.close()
  }
})

for (const build of ['initial', 'final'] as const)
  test(`a ${build} save between recommendation execution and its result preserves version identity`, async () => {
    const fixture = await reportHarness([
      call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
      call('marivo_next_steps', { ref: savedRef('initial'), items }),
      stop,
      stop,
    ])
    // Harness post-execute runs after the recommendation returns and before tools/result.
    // The nested save completes while that accepted result is still pending.
    const hook = fixture.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
      if (exec.name === 'marivo_next_steps' && !result.isError) {
        const saved = await fixture.agent.ctx.tools.execute({
          callId: ToolCallId(randomUUID()),
          rootCallId: exec.rootCallId,
          name: MARIVO_PRESENT_TOOL_NAME,
          arguments: { build },
          agent: fixture.agent,
          parent: exec.token,
          signal: exec.signal,
        })
        assert.equal(saved.isError, false)
      }
      return next()
    })
    try {
      await fixture.run()
      assert.equal(reminders(fixture.agent).length, build === 'initial' ? 0 : 1)
      assert.equal(fixture.published.length, 1)
      assert.equal(fixture.published[0]?.buildId, build)
      assert.equal(fixture.published[0]?.status, build === 'initial' ? 'available' : 'unavailable')
      assert.deepEqual(fixture.published[0]?.items, build === 'initial' ? items : [])
    } finally {
      hook()
      await fixture.close()
    }
  })

test('a late old result cannot replace an accepted submission for the final save', async () => {
  const fresh = [{ label: 'Inspect updated trends', prompt: 'Inspect updated trends.' }]
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
    call('marivo_next_steps', { ref: savedRef('initial'), items }),
    stop,
    stop,
  ])
  let injected = false
  const hook = fixture.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === 'marivo_next_steps' && !result.isError && !injected) {
      injected = true
      const nested = async (name: string, args: object) =>
        fixture.agent.ctx.tools.execute({
          callId: ToolCallId(randomUUID()),
          rootCallId: exec.rootCallId,
          name,
          arguments: args,
          agent: fixture.agent,
          parent: exec.token,
          signal: exec.signal,
        })
      assert.equal((await nested(MARIVO_PRESENT_TOOL_NAME, { build: 'final' })).isError, false)
      assert.equal(
        (await nested('marivo_next_steps', { ref: savedRef('final'), items: fresh })).isError,
        false,
      )
    }
    return next()
  })
  try {
    await fixture.run()
    assert.equal(reminders(fixture.agent).length, 0)
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'final')
    assert.equal(fixture.published[0]?.status, 'available')
    assert.deepEqual(fixture.published[0]?.items, fresh)
  } finally {
    hook()
    await fixture.close()
  }
})

test('a late earlier save result cannot replace the later committed version', async () => {
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
    call('marivo_next_steps', { ref: savedRef('final'), items }),
    stop,
    stop,
  ])
  let injected = false
  const hook = fixture.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === MARIVO_PRESENT_TOOL_NAME && !result.isError && !injected) {
      injected = true
      // The first writer has already committed, but its result is still held back.
      // A second writer commits and reports its result before the first is released.
      const later = await fixture.agent.ctx.tools.execute({
        callId: ToolCallId(randomUUID()),
        rootCallId: exec.rootCallId,
        name: MARIVO_PRESENT_TOOL_NAME,
        arguments: { build: 'final' },
        agent: fixture.agent,
        parent: exec.token,
        signal: exec.signal,
      })
      assert.equal(later.isError, false)
    }
    return next()
  })
  try {
    await fixture.run()
    assert.equal(reminders(fixture.agent).length, 0)
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'final')
    assert.equal(fixture.published[0]?.status, 'available')
    assert.deepEqual(fixture.published[0]?.items, items)
  } finally {
    hook()
    await fixture.close()
  }
})

test('a later save in the same tool batch replaces the version awaiting publication', async () => {
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'initial' }),
    calls([
      ['marivo_next_steps', { ref: savedRef('initial'), items }],
      [MARIVO_PRESENT_TOOL_NAME, { build: 'final' }],
    ]),
    call('marivo_next_steps', { ref: savedRef('final'), items: [] }),
    stop,
  ])
  try {
    await fixture.run()
    assert.equal(fixture.published.length, 1)
    assert.equal(fixture.published[0]?.buildId, 'final')
    assert.equal(fixture.published[0]?.status, 'empty')
    assert.equal(reminders(fixture.agent).length, 0)
  } finally {
    await fixture.close()
  }
})

for (const invalidation of [
  'cancel',
  'new-input',
  'stale-turn',
  'mismatched-ref',
  'replaced-definition',
] as const)
  test(`untrusted or superseded saves do not arm recommendations (${invalidation})`, async () => {
    const fixture = await reportHarness(
      [
        call(
          MARIVO_PRESENT_TOOL_NAME,
          invalidation === 'stale-turn'
            ? { receiptTurn: 99 }
            : invalidation === 'mismatched-ref'
              ? { refBuild: 'foreign' }
              : {},
        ),
        stop,
      ],
      (agent) => {
        if (invalidation === 'cancel') agent.cancel({ kind: 'user' })
        if (invalidation === 'new-input')
          agent.steer(
            createUserMessage({
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Answer this instead.' }],
            }),
          )
      },
    )
    if (invalidation === 'replaced-definition') fixture.replaceWriter()
    try {
      await fixture.run()
      assert.equal(fixture.published.length, 0)
      assert.equal(reminders(fixture.agent).length, 0)
    } finally {
      await fixture.close()
    }
  })

for (const invalidation of ['cancel', 'workspace', 'dispose', 'new-input'] as const)
  test(`accepted recommendations are discarded after owner invalidation (${invalidation})`, async () => {
    const fixture = await reportHarness([
      call(MARIVO_PRESENT_TOOL_NAME, {}),
      call('marivo_next_steps', { items }),
      stop,
    ])
    const stopObserver = fixture.agent.ctx.on('tools/result', (exec) => {
      if (exec.name !== 'marivo_next_steps') return
      if (invalidation === 'cancel') fixture.agent.cancel({ kind: 'user' })
      if (invalidation === 'workspace')
        fixture.changeWorkspace({ id: 'workspace', path: '/replacement' })
      if (invalidation === 'dispose') void fixture.dispose()
      if (invalidation === 'new-input')
        fixture.agent.steer(
          createUserMessage({
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'Do something else.' }],
          }),
        )
    })
    try {
      await fixture.run()
      assert.equal(fixture.published.length, 0)
    } finally {
      stopObserver()
      await fixture.close()
    }
  })

test('a Workspace change after save suppresses the missing-recommendation reminder', async () => {
  const fixture = await reportHarness([call(MARIVO_PRESENT_TOOL_NAME, {}), stop])
  const stopObserver = fixture.agent.ctx.on('tools/result', (exec) => {
    if (exec.name === MARIVO_PRESENT_TOOL_NAME)
      fixture.changeWorkspace({ id: 'workspace', path: '/replacement' })
  })
  try {
    await fixture.run()
    assert.equal(reminders(fixture.agent).length, 0)
    assert.equal(fixture.published.length, 0)
  } finally {
    stopObserver()
    await fixture.close()
  }
})

test('a second save does not reset the one completion reminder', async () => {
  const fixture = await reportHarness([
    call(MARIVO_PRESENT_TOOL_NAME, {}),
    stop,
    call(MARIVO_PRESENT_TOOL_NAME, { build: 'replacement' }),
    stop,
  ])
  try {
    await fixture.run()
    assert.equal(fixture.script.requests, 4)
    assert.equal(reminders(fixture.agent).length, 1)
    assert.equal(fixture.published[0]?.buildId, 'replacement')
    assert.equal(fixture.published[0]?.status, 'unavailable')
  } finally {
    await fixture.close()
  }
})

test('empty and unavailable statuses stay visible while decline and consumption retire the Turn', () => {
  for (const value of [
    { ...notice, status: 'empty', items: [] },
    { ...notice, status: 'unavailable', reason: 'generation-incomplete', items: [] },
  ]) {
    const model = new NextStepsModel()
    model.accept(value, notice)
    assert.equal(model.value?.status, value.status)
    model.accept(notice, notice)
    assert.equal(model.value?.status, value.status)
    model.clear()
    model.accept(notice, notice)
    assert.equal(model.value, undefined)
    model.accept({ ...notice, turn: 2, status: 'declined', items: [] }, notice)
    model.accept({ ...notice, turn: 2 }, notice)
    assert.equal(model.value, undefined)
  }
})

test('explicit saved-ref recommendations read an existing report without creating a Build', async (t) => {
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
  const ref = savedReportRef({
    workspaceId: document.workspaceId,
    reportId: document.reportId,
    buildId: document.buildId,
  })
  const before = await readReportHistory(root, 'workspace', document.reportId)
  const script = new Script([
    call('marivo_next_steps', { items, ref }),
    stop,
    call('marivo_next_steps', { items, ref }),
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
  assert.equal(script.requests, 2)
  assert.equal(published.length, 1)
  assert.equal(published[0]?.buildId, document.buildId)
  assert.ok(published[0]?.callId)
  assert.deepEqual(await readReportHistory(root, 'workspace', document.reportId), before)
  assert.equal(
    agent.session
      .snapshotEvents()
      .some((event) => event.type === 'tool/call' && event.data.name === MARIVO_PRESENT_TOOL_NAME),
    false,
  )
  identity = { id: 'foreign-workspace', path: root }
  await run()
  assert.equal(published.length, 1)
  assert.deepEqual(await readReportHistory(root, 'workspace', document.reportId), before)
})

for (const restore of [false, true])
  test(`a waterfall replacement cannot attest a save even if the original definition is restored (${restore})`, async () => {
    let originalRuns = 0,
      replacementRuns = 0
    const fixture = await reportHarness([call(MARIVO_PRESENT_TOOL_NAME, {}), stop, stop], () => {
      originalRuns++
    })
    const replacement: ToolDefinition = {
      ...fixture.definition,
      async execute(_args, exec) {
        replacementRuns++
        const root = [...fixture.agent.session.snapshotEvents()]
          .reverse()
          .find((event) => event.type === 'tool/call' && event.data.callId === exec.rootCallId)
        assert.equal(root?.type, 'tool/call')
        return {
          ref: savedRef(),
          deliveryJson: JSON.stringify({
            kind: 'marivo.presentation.delivery',
            schemaVersion: 2,
            surface: 'tool',
            dshSessionId: String(fixture.agent.session.id),
            turn: root.data.turn,
            receipt: {
              kind: 'marivo.presentation',
              schemaVersion: 2,
              workspaceId: 'workspace',
              reportId: 'report',
              buildId: 'build',
              title: 'Forged',
              summary: 'Not saved',
              files: {
                document: {
                  asset: 'presentation.json',
                  path: '/workspace/.dsh-data-analysis/presentations/report/builds/build/presentation.json',
                  bytes: 1,
                  sha256: 'a'.repeat(64),
                },
              },
            },
          }),
        }
      },
    }
    const hook = fixture.agent.ctx.on('tools/execute', async (exec, next) => {
      if (exec.name !== MARIVO_PRESENT_TOOL_NAME) return next()
      fixture.rebindWriter(replacement)
      const result = await next()
      if (restore) fixture.rebindWriter(fixture.definition)
      return result
    })
    try {
      await fixture.run()
      assert.equal(originalRuns, 0)
      assert.equal(replacementRuns, 1)
      assert.equal(reminders(fixture.agent).length, 0)
      assert.equal(fixture.published.length, 0)
    } finally {
      hook()
      await fixture.close()
    }
  })

test('post-policy ref and delivery replacement cannot substitute another saved version', async () => {
  const fixture = await reportHarness([call(MARIVO_PRESENT_TOOL_NAME, {}), stop, stop])
  const hook = fixture.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name !== MARIVO_PRESENT_TOOL_NAME || result.isError) return next()
    const value = z.object({ ref: z.string(), deliveryJson: z.string() }).parse(result.value)
    const delivery = parsePresentationDelivery(JSON.parse(value.deliveryJson))
    return {
      kind: 'accept',
      value: {
        ...value,
        ref: savedRef('forged'),
        deliveryJson: JSON.stringify({
          ...delivery,
          receipt: { ...delivery.receipt, buildId: 'forged' },
        }),
      },
    }
  })
  const consumed = fixture.agent.ctx.on('tools/result', (exec) => {
    assert.equal(fixture.savedWrites.take(exec.token), undefined)
  })
  try {
    await fixture.run()
    assert.equal(reminders(fixture.agent).length, 0)
    assert.equal(fixture.published.length, 0)
  } finally {
    consumed()
    hook()
    await fixture.close()
  }
})

for (const stage of ['save', 'preview', 'failed', 'cancel', 'dispose'] as const)
  test(`the production writer attests only an actual successful save (${stage})`, async (t) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'next-steps-proof-')))
    t.after(() => rm(root, { recursive: true, force: true }))
    const script = new Script([
      call(MARIVO_PRESENT_TOOL_NAME, {
        stage: stage === 'preview' ? 'preview' : 'save',
        title: 'Proof',
        program: stage === 'failed' ? 'root=UnknownComponent();' : 'root=TextContent("Saved");',
      }),
      stop,
      stop,
    ])
    const ctx = await harness(script)
    const agent = await ctx.agentLoop.create(SessionId(randomUUID()), {
      provider: 'mock',
      model: 'mock',
    })
    const savedWrites = new SavedWriteProofs()
    let commits = 0
    let committedToken: ToolExecutionToken | undefined
    const published: NextStepsNotice[] = []
    const unregister = agent.ctx.tools.register(
      createMarivoPresentTool(
        () => ({ id: 'workspace', path: root }),
        agent.session,
        undefined,
        undefined,
        undefined,
        (exec, ref) => {
          commits++
          committedToken = exec.token
          savedWrites.committed(exec, ref)
          if (stage === 'cancel') agent.cancel({ kind: 'user' })
          if (stage === 'dispose') void close()
        },
      ),
    )
    const close = installNextStepsAgent(
      ctx,
      agent,
      () => ({ id: 'workspace', path: root }),
      (value) => published.push(value),
      savedWrites,
    )
    const consumed = agent.ctx.on('tools/result', (exec) => {
      assert.equal(savedWrites.take(exec.token), undefined)
    })
    try {
      agent.followup(
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Save the report' }],
        }),
      )
      await agent.whenIdle()
      assert.equal(commits, ['save', 'cancel', 'dispose'].includes(stage) ? 1 : 0)
      if (committedToken) assert.equal(savedWrites.take(committedToken), undefined)
      assert.equal(reminders(agent).length, stage === 'save' ? 1 : 0)
      assert.equal(published.length, stage === 'save' ? 1 : 0)
    } finally {
      consumed()
      unregister()
      await close()
      await ctx.fiber.dispose()
    }
  })

test('next steps declares a closed supported output with identity-only receipt fields', async () => {
  const fixture = await reportHarness([stop])
  try {
    const definition = fixture.agent.ctx.tools.get('marivo_next_steps', fixture.agent)!
    assert.equal(definition.output.schema.type, 'object')
    assert.equal(definition.output.schema.additionalProperties, false)
    assert.deepEqual(definition.output.schema.required, ['accepted', 'ref'])
    assert.deepEqual(definition.output.schema.properties?.receipt?.required, [
      'kind',
      'sessionId',
      'turn',
      'callId',
    ])
    assert.equal(definition.output.schema.properties?.accepted?.const, true)
  } finally {
    await fixture.close()
  }
})
