import assert from 'node:assert/strict'
import test from 'node:test'
import {
  marivoPresentationDeliveryDefinition as definition,
  parsePresentationDurableContent,
  presentationDeliveryFromEvent,
  presentationsForClosing,
  selectMarivoPresentations,
} from '../../src/client/presentation/delivery.ts'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'

function delivery(buildId = 'build-a', sessionId = 'session-a', turn = 3): PresentationDelivery {
  return {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 1,
    dshSessionId: sessionId,
    turn,
    receipt: {
      kind: 'marivo.presentation',
      schemaVersion: 1,
      workspaceId: 'workspace-a',
      buildId,
      title: '分析结果',
      summary: '数据与来源快照',
      files: {
        document: {
          asset: 'presentation.json',
          path: `/workspace/.dsh-data-analysis/presentations/${buildId}/presentation.json`,
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
        html: {
          asset: 'index.html',
          path: `/workspace/.dsh-data-analysis/presentations/${buildId}/index.html`,
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
    type: 'tool/code-dispatch',
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
  invalid.receipt.files.html.path = '/etc/passwd'
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

test('Turn publication deduplicates receipt events, preserves independent builds, and filters exact Session and Turn end', () => {
  let state = definition.start({}, { event: { type: 'turn/start', data: { turn: 3 } } })
  for (const [callId, name] of calls)
    state = definition.update(
      { state },
      { event: { type: 'tool/call', data: { turn: 3, callId, name } } },
    )
  for (const event of [
    native(),
    code(),
    native(),
    code(delivery('build-b'), 30),
    code(delivery('foreign', 'session-b'), 31),
  ])
    state = definition.update({ state }, { event })
  assert.equal(state.deliveries.length, 3)
  const location = definition.buildLocationData({ state }, 'turn')!
  const owner = {
    seq: 40,
    turn: {
      turn: 3,
      end: { type: 'turn/end', seq: 40, data: { turn: 3 } },
      data: { get: () => location.value },
    },
  }
  assert.deepEqual(
    presentationsForClosing(owner, 'session-a').map((item) => item.receipt.buildId),
    ['build-a', 'build-b'],
  )
  assert.deepEqual(
    presentationsForClosing(
      { ...owner, turn: { ...owner.turn, end: { ...owner.turn.end, seq: 25 } } },
      'session-a',
    ).map((item) => item.receipt.buildId),
    ['build-a'],
  )
  assert.deepEqual(presentationsForClosing(owner, 'session-c'), [])
  assert.equal(
    selectMarivoPresentations({
      ...owner,
      turn: { ...owner.turn, end: { ...owner.turn.end, seq: 19 } },
    }),
    null,
  )
  assert.deepEqual(
    presentationsForClosing({ ...owner, turn: { ...owner.turn, turn: 4 } }, 'session-a'),
    [],
  )
  assert.equal(definition.buildLocationData({ state }, 'step'), null)
  const previous = state
  state = definition.update(
    { state },
    { event: { type: 'tool/call', data: { turn: 4, callId: 'foreign-code', name: 'run_code' } } },
  )
  assert.equal(state, previous)
  assert.equal(state.calls.has('foreign-code'), false)
})

test('successful Native and discarded Code receipts remain visible after pre-tool text and an empty, failed, or cancelled ending', () => {
  for (const reason of ['stop', 'error', 'cancelled']) {
    let state = definition.start({}, { event: { type: 'turn/start', data: { turn: 3 } } })
    for (const [callId, name] of calls)
      state = definition.update(
        { state },
        { event: { type: 'tool/call', data: { turn: 3, callId, name } } },
      )
    state = definition.update({ state }, { event: native(delivery('native-saved'), 20) })
    state = definition.update({ state }, { event: code(delivery('code-discarded-return'), 21) })
    const location = definition.buildLocationData({ state }, 'turn')!
    // Host anchors the Turn tail to the earlier nonempty Assistant message.
    // The later request can end with no text while the successful deliveries survive.
    const owner = {
      seq: 10,
      turn: {
        turn: 3,
        end: { type: 'turn/end', seq: 30, data: { turn: 3, reason } },
        data: { get: () => location.value },
      },
    }
    assert.deepEqual(
      presentationsForClosing(owner, 'session-a').map((item) => item.receipt.buildId),
      ['native-saved', 'code-discarded-return'],
    )
    assert.equal(selectMarivoPresentations(owner)?.length, 2)
    assert.deepEqual(presentationsForClosing(owner, 'session-b'), [])
    assert.deepEqual(
      presentationsForClosing({ ...owner, turn: { ...owner.turn, turn: 4 } }, 'session-a'),
      [],
    )
    assert.equal(
      presentationsForClosing({ ...owner, turn: { ...owner.turn, end: undefined } }, 'session-a')
        .length,
      2,
    )
  }
})
