import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANALYSIS_SURFACE_NODE_KEY,
  analysisSurfacesForNode,
  marivoAnalysisSurfaceDefinition,
} from '../../src/client/presentation/delivery.ts'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'
import { createHostChatFixture } from './host-client-fixture.ts'

function delivery(
  buildId: string,
  options: { sessionId?: string; turn?: number; surface?: 'tool' | 'tab' } = {},
): PresentationDelivery {
  return {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 2,
    dshSessionId: options.sessionId ?? 'session-a',
    turn: options.turn ?? 3,
    ...(options.surface === undefined ? {} : { surface: options.surface }),
    receipt: {
      kind: 'marivo.presentation',
      schemaVersion: 2,
      workspaceId: 'workspace-a',
      reportId: 'report',
      buildId,
      title: 'Analysis result',
      summary: 'Saved snapshot',
      files: {
        document: {
          asset: 'presentation.json',
          path: `/workspace/.dsh-data-analysis/presentations/report/builds/${buildId}/presentation.json`,
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
      },
    },
  }
}

function call(seq: number, name: string, callId: string, turn = 3) {
  return {
    seq,
    type: 'tool/call',
    data: { turn, step: 1, callId, name, arguments: '{}' },
  }
}

// The current Harness writes identity and outcome on the tool-role message.
function native(seq: number, value: PresentationDelivery, callId = 'present-call', failed = false) {
  return {
    seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: value.turn,
      step: 1,
      meta: value,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId },
        toolCallId: callId,
        isError: failed,
        content: [{ type: 'text', text: 'saved' }],
      },
    },
  }
}

function ptc(seq: number, value: PresentationDelivery, failed = false) {
  return {
    seq,
    type: 'tool/ptc-dispatch',
    data: {
      name: 'marivo_present',
      isError: failed,
      rootCallId: 'code-call',
      subCallId: 'code-call:code:1',
      content: [{ type: 'marivo.presentation.delivery', delivery: value }],
    },
  }
}

const start = (turn: number, seq = 1) => ({ seq, type: 'turn/start', data: { turn } })
const step = (turn: number, seq = 2) => ({ seq, type: 'step/start', data: { turn, step: 1 } })
const end = (turn: number, seq: number, reason = 'completed') => ({
  seq,
  type: 'turn/end',
  data: { turn, reason: { kind: reason } },
})
const finalAnswer = (turn: number, seq: number) => ({
  seq,
  type: 'assistant/message',
  surfaceOp: 'append',
  data: {
    turn,
    step: 1,
    stream: [],
    message: {
      id: `answer-${turn}`,
      role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: 'Final analysis' }],
    },
  },
})

function append(
  assembler: ReturnType<Awaited<ReturnType<typeof createHostChatFixture>>['createAssembler']>,
  event: unknown,
) {
  assembler.append({ type: 'event', event })
  assembler.flush()
}

function surfaces(
  assembler: ReturnType<Awaited<ReturnType<typeof createHostChatFixture>>['createAssembler']>,
) {
  const snapshot = assembler.snapshot('chat')
  return Array.from(snapshot.order, (key: string) => snapshot.nodes.get(key)).filter(
    (node: { kind: string }) => node.kind === ANALYSIS_SURFACE_NODE_KEY,
  )
}

function buildIds(node: Parameters<typeof analysisSurfacesForNode>[0], sessionId = 'session-a') {
  return Array.from(analysisSurfacesForNode(node, sessionId), (item) => item.receipt.buildId)
}

function assertOutsideHostProcessGroup(
  assembler: ReturnType<Awaited<ReturnType<typeof createHostChatFixture>>['createAssembler']>,
  node: { key: string; location: { kind: string }; visibility: string },
) {
  const grouped = assembler.grouped('chat')
  assert.ok(grouped, 'the installed Harness registered its actual process grouping')
  assert.equal(node.location.kind, 'session')
  assert.equal(node.visibility, 'visible')
  assert.ok(
    grouped.entries.some(
      (entry: { kind: string; key: string }) => entry.kind === 'node' && entry.key === node.key,
    ),
    'the analysis surface is a root entry outside collapsible work-step groups',
  )
  for (const entry of grouped.entries) {
    if (entry.kind !== 'group') continue
    const group = grouped.groupSource(entry.key).getSnapshot()
    assert.ok(group)
    assert.equal(
      group.members.some((member: { key: string }) => member.key === node.key),
      false,
    )
  }
}

test('Native and PTC saved tool surfaces stay outside actual Host process groups through close and replay', async (t) => {
  for (const reason of ['completed', 'cancelled']) {
    const host = await createHostChatFixture()
    t.after(() => host.dispose())
    const assembler = host.createAssembler()
    const inputs = [
      start(3),
      step(3),
      call(3, 'marivo_present', 'present-call'),
      native(4, delivery('native-build', { surface: 'tool' })),
      call(5, 'run_code', 'code-call'),
      ptc(6, delivery('ptc-build', { surface: 'tool' })),
      // The same receipt may be published twice through the Host; it renders once.
      ptc(7, delivery('ptc-build', { surface: 'tool' })),
      native(8, delivery('foreign-build', { surface: 'tool', sessionId: 'session-b' })),
      call(9, 'marivo_present', 'tab-call'),
      native(10, delivery('tab-build', { surface: 'tab' }), 'tab-call'),
      finalAnswer(3, 11),
      end(3, 12, reason),
    ]
    for (const event of inputs) {
      append(assembler, event)
      if (event.seq === 4) {
        assert.equal(surfaces(assembler)[0].anchorSeq, 4)
        assert.deepEqual(buildIds(surfaces(assembler)[0]), ['native-build'])
      }
      if (event.seq === 6) {
        assert.equal(surfaces(assembler)[0].anchorSeq, 6)
        assert.deepEqual(buildIds(surfaces(assembler)[0]), ['native-build', 'ptc-build'])
      }
    }
    const nodes = surfaces(assembler)
    assert.equal(nodes.length, 1)
    const node = nodes[0]
    assert.equal(node.anchorSeq, 12)
    assertOutsideHostProcessGroup(assembler, node)
    assert.deepEqual(buildIds(node), ['native-build', 'ptc-build'])
    assert.deepEqual(buildIds(node, 'session-b'), ['foreign-build'])
    assert.deepEqual(buildIds(node, 'session-c'), [])
    const snapshot = assembler.snapshot('chat')
    const grouped = assembler.grouped('chat')!
    const final = grouped.entries.findIndex(
      (entry: { kind: string; key: string; groupPart?: string }) =>
        entry.kind === 'node' &&
        entry.groupPart === 'response' &&
        snapshot.nodes.get(entry.key)?.kind === 'assistant-step',
    )
    const surface = grouped.entries.findIndex(
      (entry: { kind: string; key: string }) => entry.kind === 'node' && entry.key === node.key,
    )
    assert.ok(final >= 0, 'the final answer is a visible Host response')
    assert.ok(surface > final, 'the saved UI follows the final answer outside the folded Turn')

    for (const replay of [
      () =>
        assembler.replaceWindow(
          inputs.map((event) => ({ type: 'event', event })),
          false,
        ),
      () => assembler.rebuildRegistry(),
    ]) {
      replay()
      assembler.flush()
      const restored = surfaces(assembler)
      assert.equal(restored.length, 1)
      assert.equal(restored[0].key, node.key)
      assertOutsideHostProcessGroup(assembler, restored[0])
      assert.deepEqual(buildIds(restored[0]), ['native-build', 'ptc-build'])
    }
  }
})

test('an already published surface survives transient absence of state or its start location', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const assembler = host.createAssembler()
  for (const event of [
    start(3),
    step(3),
    call(3, 'marivo_present', 'present-call'),
    native(4, delivery('saved', { surface: 'tool' })),
  ])
    append(assembler, event)
  const node = surfaces(assembler)[0]
  assert.ok(node)
  const context = {
    key: node.key,
    kind: ANALYSIS_SURFACE_NODE_KEY,
    id: node.id,
    matches: [],
    current: new Map([['chat', node]]),
    start: undefined,
    state: undefined,
  }
  assert.equal(marivoAnalysisSurfaceDefinition.buildViewNode(context), node)
  const state = marivoAnalysisSurfaceDefinition.start(
    {},
    { event: { type: 'turn/start', data: { turn: 3 } } },
  )
  assert.equal(marivoAnalysisSurfaceDefinition.buildViewNode({ ...context, state }), node)
})

test('failed, mismatched and tab-only deliveries never publish an analysis surface', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const assembler = host.createAssembler()
  for (const event of [
    start(3),
    step(3),
    call(3, 'marivo_present', 'present-call'),
    native(4, delivery('failed', { surface: 'tool' }), 'present-call', true),
    native(5, delivery('wrong-call', { surface: 'tool' }), 'unrecognized-call'),
    call(6, 'run_code', 'code-call'),
    ptc(7, delivery('failed-ptc', { surface: 'tool' }), true),
    call(8, 'marivo_present', 'tab-call'),
    native(9, delivery('tab-only', { surface: 'tab' }), 'tab-call'),
    native(10, delivery('legacy-tab'), 'tab-call'),
    end(3, 11),
  ])
    append(assembler, event)
  assert.equal(surfaces(assembler).length, 0)
})

test('a partial history window retains a verified call and result, but never trusts a result alone', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  for (const { events, expected } of [
    {
      events: [
        call(20, 'marivo_present', 'present-call'),
        native(21, delivery('native-history', { surface: 'tool' })),
        end(3, 22),
      ],
      expected: 'native-history',
    },
    {
      events: [
        call(20, 'run_code', 'code-call'),
        ptc(21, delivery('ptc-history', { surface: 'tool' })),
        end(3, 22),
      ],
      expected: 'ptc-history',
    },
  ]) {
    const assembler = host.createAssembler()
    assembler.replaceWindow(
      events.map((event) => ({ type: 'event', event })),
      true,
    )
    assembler.flush()
    const nodes = surfaces(assembler)
    assert.equal(nodes.length, 1)
    assertOutsideHostProcessGroup(assembler, nodes[0])
    assert.deepEqual(buildIds(nodes[0]), [expected])
  }
  const unknownCall = host.createAssembler()
  unknownCall.replaceWindow(
    [{ type: 'event', event: native(21, delivery('untrusted', { surface: 'tool' })) }],
    true,
  )
  unknownCall.flush()
  assert.equal(surfaces(unknownCall).length, 0)

  // The Host's own tool-call node rejects result-before-call for the same ID.
  // Exercise the surface reducer separately: a later call must not retroactively
  // authenticate the earlier orphan receipt.
  const orphan = native(20, delivery('orphan', { surface: 'tool' }))
  assert.equal(marivoAnalysisSurfaceDefinition.match(orphan)?.role, 'start')
  let state = marivoAnalysisSurfaceDefinition.start({}, { event: orphan })
  state = marivoAnalysisSurfaceDefinition.update(
    { state },
    { event: call(21, 'marivo_present', 'present-call') },
  )
  state = marivoAnalysisSurfaceDefinition.update(
    { state },
    { event: native(22, delivery('later-valid', { surface: 'tool' })) },
  )
  assert.deepEqual(
    Array.from(state.deliveries, ({ delivery: saved }) => saved.receipt.buildId),
    ['later-valid'],
  )
})

test('separate Turns retain separate visible results instead of moving older results into a later Turn', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const assembler = host.createAssembler()
  for (const event of [
    start(3, 1),
    step(3, 2),
    call(3, 'marivo_present', 'present-call', 3),
    native(4, delivery('first', { turn: 3, surface: 'tool' })),
    end(3, 5),
    start(4, 6),
    step(4, 7),
    call(8, 'marivo_present', 'next-call', 4),
    native(9, delivery('second', { turn: 4, surface: 'tool' }), 'next-call'),
    end(4, 10),
  ])
    append(assembler, event)
  const nodes = surfaces(assembler)
  assert.equal(nodes.length, 2)
  assert.deepEqual(
    nodes.map((node: Parameters<typeof analysisSurfacesForNode>[0]) => buildIds(node)),
    [['first'], ['second']],
  )
  for (const node of nodes) assertOutsideHostProcessGroup(assembler, node)
})
