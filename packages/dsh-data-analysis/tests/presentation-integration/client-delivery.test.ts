import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ConversationLocation,
  ConversationMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { type SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  marivoPresentationDeliveryDefinition as definition,
  parsePresentationDurableContent,
  presentationDeliveryFromEvent,
  presentationsForNode,
} from '../../src/client/presentation/delivery.ts'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'
import { createHostChatFixture } from './host-client-fixture.ts'

function delivery(buildId = 'build-a', sessionId = 'session-a', turn = 3): PresentationDelivery {
  return {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 2,
    dshSessionId: sessionId,
    turn,
    receipt: {
      kind: 'marivo.presentation',
      schemaVersion: 2,
      workspaceId: 'workspace-a',
      reportId: 'report',
      buildId,
      title: '分析结果',
      summary: '数据与来源快照',
      files: {
        document: {
          asset: 'presentation.json',
          path: `/workspace/.dsh-data-analysis/presentations/report/builds/${buildId}/presentation.json`,
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
        html: {
          asset: 'index.html',
          path: `/workspace/.dsh-data-analysis/presentations/report/builds/${buildId}/index.html`,
          bytes: 200,
          sha256: 'b'.repeat(64),
        },
      },
    },
  }
}
function native(value = delivery(), seq = 20) {
  return {
    seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 3,
      meta: value,
      message: {
        source: { kind: 'tool', callId: 'present-call' },
        content: [
          {
            type: 'tool-result',
            toolCallId: 'present-call',
            isError: false,
            content: [{ type: 'text', text: 'saved' }],
          },
        ],
      },
    },
  }
}
function code(value = delivery(), seq = 21) {
  return {
    seq,
    type: 'tool/ptc-dispatch',
    data: {
      name: 'marivo_present',
      isError: false,
      rootCallId: 'code-call',
      subCallId: 'code-call:code:1',
      content: [
        { type: 'text', text: 'saved' },
        { type: 'marivo.presentation.delivery', delivery: value },
      ],
    },
  }
}
const calls = new Map([
  ['present-call', 'marivo_present'],
  ['code-call', 'run_code'],
])

test('Native and Code consume the same detached durable receipt, with closed bounded contracts', () => {
  const value = delivery()
  const first = presentationDeliveryFromEvent(native(value), calls, 3)!
  const second = presentationDeliveryFromEvent(code(value), calls, 3)!
  assert.deepEqual(first.delivery, second.delivery)
  assert.equal(Object.isFrozen(first.delivery.receipt.files.html), true)
  value.receipt.title = 'changed after delivery'
  assert.equal(first.delivery.receipt.title, '分析结果')
  assert.equal(
    parsePresentationDurableContent([...code().data.content, code().data.content[1]]),
    null,
  )
  assert.equal(
    parsePresentationDurableContent([
      { type: 'marivo.presentation.delivery', delivery: { ...delivery(), version: 1 } },
    ]),
    null,
  )
  assert.equal(
    parsePresentationDurableContent([
      { type: 'marivo.presentation.delivery', delivery: { ...delivery(), schemaVersion: 0 } },
    ]),
    null,
  )
  const invalid = delivery()
  invalid.receipt.files.html!.path = '/etc/passwd'
  assert.equal(presentationDeliveryFromEvent(native(invalid), calls, 3), null)
})

test('receipts require successful own-Turn call correlation and cannot cross Native or Code turns', () => {
  assert.equal(presentationDeliveryFromEvent(native(), new Map(), 3), null)
  assert.equal(presentationDeliveryFromEvent(code(), new Map(), 3), null)
  assert.equal(
    presentationDeliveryFromEvent(native(delivery('build-a', 'session-a', 4)), calls, 3),
    null,
  )
  assert.equal(
    presentationDeliveryFromEvent(code(delivery('build-a', 'session-a', 4)), calls, 3),
    null,
  )
  assert.equal(presentationDeliveryFromEvent(native(), calls, 4), null)
  const failed = native()
  failed.data.message.content[0]!.isError = true
  assert.equal(presentationDeliveryFromEvent(failed, calls, 3), null)
  const wrongCall = native()
  wrongCall.data.message.content[0]!.toolCallId = 'different-call'
  assert.equal(presentationDeliveryFromEvent(wrongCall, calls, 3), null)
  assert.equal(
    presentationDeliveryFromEvent({ ...native(), surfaceOp: { op: 'replace' } }, calls, 3),
    null,
  )
  assert.equal(
    presentationDeliveryFromEvent({ ...code(), data: { ...code().data, isError: true } }, calls, 3),
    null,
  )
})

function initialState() {
  let state = definition.start({}, { event: { type: 'turn/start', data: { turn: 3 } } })
  for (const [callId, name] of calls)
    state = definition.update(
      { state },
      { event: { type: 'tool/call', data: { turn: 3, callId, name } } },
    )
  return state
}

function view(
  state: ReturnType<typeof initialState>,
  end?: { seq: number; turn?: number; reason?: string },
  locationOverride?: ConversationLocation,
) {
  const start = { type: 'turn/start', seq: 1, data: { turn: 3 } } as SessionEvent
  const location: ConversationLocation = locationOverride ?? {
    kind: 'turn',
    turn: {
      turn: 3,
      start: undefined,
      end: end
        ? ({
            type: 'turn/end',
            seq: SessionSeq(end.seq),
            time: 0,
            data: { turn: end.turn ?? 3, reason: { kind: end.reason ?? 'completed' } },
          } as ConversationMatch['event'] & { type: 'turn/end' })
        : undefined,
      status: end ? 'closed' : 'open',
      steps: [],
      data: {
        get: () => undefined,
        source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
      },
    },
  }
  return definition.buildViewNode({
    key: 'marivo-presentation-delivery:3',
    kind: definition.kind,
    id: '3',
    matches: [],
    current: new Map(),
    start: { event: start, role: 'start', location },
    state,
  })
}

const builds = (node: NonNullable<ReturnType<typeof view>>, sessionId = 'session-a') =>
  Array.from(presentationsForNode(node, sessionId), (item) => item.receipt.buildId)

test('completed reports follow final replies despite intervening steps, including Host replay', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  for (const withDiagnostics of [false, true]) {
    const assembler = host.createAssembler()
    const message = (seq: number, step: number, text: string) => ({
      event: {
        seq,
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          turn: 3,
          step,
          message: {
            id: `message-${seq}`,
            role: 'assistant',
            content: [{ type: 'text', text }],
          },
        },
      },
    })
    const inputs = [
      { event: { seq: 1, type: 'turn/start', data: { turn: 3 } } },
      { event: { seq: 2, type: 'step/start', data: { turn: 3, step: 1 } } },
      {
        event: {
          seq: 3,
          type: 'tool/call',
          data: {
            turn: 3,
            step: 1,
            callId: 'present-call',
            name: 'marivo_present',
            args: '{}',
          },
        },
      },
      { event: native() },
      ...(withDiagnostics
        ? [
            message(22, 2, '正在检查报告诊断'),
            {
              event: {
                seq: 23,
                type: 'tool/call',
                data: {
                  turn: 3,
                  step: 2,
                  callId: 'check-call',
                  name: 'bash',
                  args: '{}',
                },
              },
            },
            message(25, 3, '检查完成，更新待办'),
          ]
        : []),
      message(28, 4, '最终分析结论'),
    ]
    const reports = () => {
      const snapshot = assembler.snapshot('chat')
      return snapshot.order
        .map((key: string) => snapshot.nodes.get(key))
        .filter((node: { kind: string }) => node.kind === definition.kind)
    }
    for (const input of inputs) assembler.append({ type: 'event', ...input })
    assembler.flush()
    const originalKey = reports()[0].key
    assert.equal(reports()[0].anchorSeq, 20)
    const end = {
      event: {
        seq: 30,
        type: 'turn/end',
        data: {
          turn: 3,
          reason: { kind: 'completed' },
        },
      },
    }
    assembler.append({ type: 'event', ...end })
    assembler.flush()
    for (const replay of [
      () => {},
      () =>
        assembler.replaceWindow(
          [...inputs, end].map((entry) => ({ type: 'event', ...entry })),
          false,
        ),
      () => assembler.rebuildRegistry(),
    ]) {
      replay()
      assembler.flush()
      assert.equal(reports().length, 1)
      assert.equal(reports()[0].key, originalKey)
      assert.equal(reports()[0].anchorSeq, 30)
      assert.deepEqual(builds(reports()[0]), ['build-a'])
    }
  }
})

test('an independent Chat node appears at the first successful receipt before any final text or Turn end', () => {
  let state = initialState()
  assert.equal(definition.target, 'chat')
  assert.equal(view(state), null)
  const failed = native()
  failed.data.message.content[0]!.isError = true
  state = definition.update({ state }, { event: failed })
  assert.equal(view(state), null)
  state = definition.update({ state }, { event: native(delivery('first'), 20) })
  const first = view(state)!
  assert.equal(first.kind, definition.kind)
  assert.equal(first.visibility, 'visible')
  assert.equal(first.anchorSeq, 20)
  assert.deepEqual(builds(first), ['first'])
  state = definition.update({ state }, { event: code(delivery('second'), 30) })
  const second = view(state)!
  assert.equal(second.key, first.key)
  assert.equal(second.id, first.id)
  assert.equal(second.anchorSeq, first.anchorSeq)
  assert.deepEqual(builds(second), ['first', 'second'])
  assert.equal(view(state, undefined, { kind: 'unresolved' }), null)
  assert.equal(view(state, undefined, { kind: 'session' }), null)
})

test('Turn publication deduplicates Native and Code receipts and filters exact Session and Host Turn boundary', () => {
  let state = initialState()
  for (const event of [
    native(),
    code(),
    native(),
    code(delivery('build-b'), 30),
    code(delivery('foreign', 'session-b'), 31),
  ])
    state = definition.update({ state }, { event })
  assert.equal(state.deliveries.length, 3)
  assert.deepEqual(builds(view(state)!), ['build-a', 'build-b'])
  assert.deepEqual(builds(view(state, { seq: 25 })!), ['build-a'])
  assert.deepEqual(builds(view(state, { seq: 19 })!), [])
  assert.deepEqual(builds(view(state)!, 'session-c'), [])
  assert.deepEqual(builds(view(state, { seq: 40, turn: 4 })!), [])
  const location = definition.buildLocationData({ state }, 'turn')!
  assert.deepEqual(location.value, view(state)!.data)
  assert.equal(definition.buildLocationData({ state }, 'step'), null)
  const previous = state
  state = definition.update(
    { state },
    { event: { type: 'tool/call', data: { turn: 4, callId: 'foreign-code', name: 'run_code' } } },
  )
  assert.equal(state, previous)
  assert.equal(state.calls.has('foreign-code'), false)
})

test('successful Native and discarded Code receipts survive later tool failure, empty completion, and cancellation', () => {
  for (const reason of ['stop', 'error', 'cancelled']) {
    let state = initialState()
    state = definition.update({ state }, { event: native(delivery('native-saved'), 20) })
    state = definition.update({ state }, { event: code(delivery('code-discarded-return'), 21) })
    const first = view(state)!
    const failed = native(delivery('failed'), 25)
    failed.data.message.content[0]!.isError = true
    state = definition.update({ state }, { event: failed })
    state = definition.update(
      { state },
      {
        event: { ...code(delivery('failed-code'), 26), data: { ...code().data, isError: true } },
      },
    )
    const closed = view(state, { seq: 30, reason })!
    assert.equal(closed.key, first.key)
    assert.equal(closed.anchorSeq, 20)
    assert.deepEqual(builds(closed), ['native-saved', 'code-discarded-return'])
    assert.deepEqual(builds(closed, 'session-b'), [])
    assert.deepEqual(definition.match({ type: 'turn/end', data: { turn: 3, reason } }), {
      id: '3',
      role: 'update',
    })
  }
})

test('rebuilding from history or reconnecting preserves one node and receipt order', () => {
  const events = [native(delivery('a'), 20), code(delivery('b'), 21), native(delivery('a'), 22)]
  const replay = () => {
    let state = initialState()
    for (const event of events) state = definition.update({ state }, { event })
    return view(state, { seq: 30 })!
  }
  const before = replay()
  for (let count = 0; count < 3; count++) {
    const after = replay()
    assert.equal(after.key, before.key)
    assert.equal(after.anchorSeq, before.anchorSeq)
    assert.deepEqual(after.data, before.data)
    assert.deepEqual(builds(after), ['a', 'b'])
    assert.deepEqual(builds(after, 'session-b'), [])
    assert.deepEqual(builds(after, 'session-a'), ['a', 'b'])
  }
})

test('unchanged Host registries keep ProducedFiles and independent report nodes in either plugin order', async (t) => {
  for (const order of [
    ['native', 'presentation'],
    ['presentation', 'native'],
  ]) {
    const host = await createHostChatFixture(order)
    t.after(() => host.dispose())
    const assembler = host.createAssembler()
    const write = native(undefined, 5)
    write.data.message.source.callId = 'write-call'
    write.data.message.content[0]!.toolCallId = 'write-call'
    const inputs = [
      { event: { seq: 1, type: 'turn/start', data: { turn: 3 } } },
      { event: { seq: 2, type: 'step/start', data: { turn: 3, step: 1 } } },
      {
        event: {
          seq: 4,
          type: 'tool/call',
          data: {
            turn: 3,
            step: 1,
            callId: 'write-call',
            name: 'write',
            arguments: JSON.stringify({ file_path: '/workspace/draft.json', content: 'draft' }),
          },
        },
        view: {
          for: 'call',
          view: { card: 'diff', locations: [{ path: '/workspace/draft.json' }] },
        },
      },
      { event: write },
      {
        event: {
          seq: 10,
          type: 'tool/call',
          data: { turn: 3, step: 1, callId: 'present-call', name: 'marivo_present', args: '{}' },
        },
      },
      { event: native() },
      {
        event: {
          seq: 22,
          type: 'tool/call',
          data: { turn: 3, step: 1, callId: 'code-call', name: 'run_code', args: '{}' },
        },
      },
      { event: code(delivery('build-b'), 25) },
      { event: native(delivery(), 26) },
    ]
    const reports = () => {
      const snapshot = assembler.snapshot('chat')
      return snapshot.order
        .map((key: string) => snapshot.nodes.get(key))
        .filter((node: { kind: string }) => node.kind === definition.kind)
    }
    for (const input of inputs) {
      assembler.append({ type: 'event', ...input })
      assembler.flush()
      if (input.event.seq < 20) assert.equal(reports().length, 0)
      else assert.equal(reports().length, 1, `one report node after receipt seq ${input.event.seq}`)
    }
    const first = reports()[0]
    assert.equal(first.anchorSeq, 20)
    assert.deepEqual(builds(first), ['build-a', 'build-b'])
    const closing = { event: { seq: 30, type: 'turn/end', data: { turn: 3, reason: 'cancelled' } } }
    assembler.append({ type: 'event', ...closing })
    assembler.flush()
    const snapshot = assembler.snapshot('chat')
    const tails = host.slots.entries('conversation.chat.turnTail')
    // Native owns its original exclusive chain; report rendering has its own keyed seat.
    assert.equal(tails.length, 1)
    assert.deepEqual(
      Array.from(tails[0].select({ turn: snapshot.timeline.turns.get(3), seq: 30 })),
      ['/workspace/draft.json'],
    )
    const renderer = host.slots
      .entries('conversation.chat.node')
      .find((entry: { options: { key: string } }) => entry.options.key === definition.kind)
    assert.ok(renderer)
    const render = (sessionId: string) =>
      renderToStaticMarkup(
        createElement(renderer.component, {
          node: reports()[0],
          sessionId,
          useWorkspaces: () => [],
        }),
      )
    const html = render('session-a')
    assert.equal((html.match(/class="pd-card"/g) ?? []).length, 2)
    assert.equal((render('session-b').match(/class="pd-card"/g) ?? []).length, 0)
    for (const replay of [
      () =>
        assembler.replaceWindow(
          [...inputs, closing].map((entry) => ({ type: 'event', ...entry })),
          false,
        ),
      () => assembler.rebuildRegistry(),
      () =>
        assembler.replaceWindow(
          [...inputs, closing].map((entry) => ({ type: 'event', ...entry })),
          false,
        ),
    ]) {
      replay()
      assembler.flush()
      assert.equal(reports().length, 1)
      assert.equal(reports()[0].key, first.key)
      assert.equal(reports()[0].anchorSeq, first.anchorSeq)
      assert.deepEqual(builds(reports()[0]), ['build-a', 'build-b'])
    }
  }
})

// Historical plugin receipts remain readable after the Harness event rename.
test('rc saved Code dispatch receipts retain the same validated presentation and grouping', () => {
  const current = code()
  const historical = { ...current, type: 'tool/code-dispatch' }
  assert.deepEqual(
    presentationDeliveryFromEvent(historical, calls, 3),
    presentationDeliveryFromEvent(current, calls, 3),
  )
  assert.deepEqual(definition.match(historical), definition.match(current))
  assert.equal(
    presentationDeliveryFromEvent(
      { ...historical, data: { ...historical.data, isError: true } },
      calls,
      3,
    ),
    null,
  )
  assert.equal(presentationDeliveryFromEvent(historical, new Map(), 3), null)
})
