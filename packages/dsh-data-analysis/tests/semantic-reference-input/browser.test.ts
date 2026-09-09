// @ts-nocheck -- replay the installed public browser bundle without loading a sibling checkout.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createSemanticReferenceSource } from '../../src/client/semantic-reference-source.ts'
import { modelMarker } from '../../src/semantic-reference/contracts.ts'
import { semanticKindLabels } from '../../src/semantic-reference/labels.ts'
import { search } from '../../src/semantic-reference/search.ts'
import { createHostChatFixture } from '../presentation-integration/host-client-fixture.ts'
import { candidate } from './fixtures.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('installed DSH trigger controller keeps file and semantic sources and serializes the owner reference', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const calls = [],
    inserted = []
  let fail = false
  const source = createSemanticReferenceSource({
    async call(_channel, endpoint, payload) {
      calls.push(endpoint)
      if (endpoint.endsWith('/serialize'))
        return fail
          ? { ok: false, error: {} }
          : { ok: true, value: { text: modelMarker(payload.envelope) } }
      if (endpoint.endsWith('/selected')) return { ok: true, value: { selected: true } }
      return {
        ok: true,
        value: {
          environmentFingerprint: 'fp-a',
          items: [{ ...candidate('sales.revenue'), section: 'strict' }],
        },
      }
    },
  })
  const sources = [
    source,
    {
      trigger: '@',
      name: 'reference',
      candidates: async () => [{ name: 'file.txt', icon: 'file' }],
      onPick: () => ({ text: 'file.txt' }),
    },
  ]
  const controller = new host.InputTriggerController({
    actx: {
      bail(_ctx, name, request) {
        assert.equal(name, 'slash/input-insert-reference')
        inserted.push(request)
        return true
      },
    },
    sessionId: 'a',
    roster: { all: () => sources, sources: () => sources },
  })
  t.after(() => controller.dispose())
  controller.track('分析 @rev', 7, { tier: 'plain' }, 4)
  await tick()
  assert.equal(controller.menu.getSnapshot().groups.length, 2)
  controller.pick('marivo-semantic', 0)
  assert.equal(inserted.length, 1)
  const { reference, span } = inserted[0]
  assert.deepEqual({ ...span }, { start: 3, end: 7, draftRev: 4 })
  assert.equal(reference.source, 'marivo-semantic')
  const text = await controller.serializeReference(
    reference.source,
    reference.ref,
    new AbortController().signal,
  )
  assert.match(text, /<marivo-semantic-ref>/)
  assert.ok(!text.includes('fp-a'))
  assert.equal(calls.filter((endpoint) => endpoint.endsWith('/selected')).length, 1)
  fail = true
  await assert.rejects(
    controller.serializeReference(reference.source, reference.ref, new AbortController().signal),
  )
})

test('installed DSH controller cancels generations, drops late responses and preserves quoted queries', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const pending = []
  const source = createSemanticReferenceSource({
    call(_channel, endpoint, payload, signal) {
      assert.ok(endpoint.endsWith('/candidates'))
      return new Promise((resolve) => pending.push({ payload, signal, resolve }))
    },
  })
  const controller = new host.InputTriggerController({
    actx: {},
    sessionId: 'a',
    roster: { all: () => [source], sources: () => [source] },
  })
  t.after(() => controller.dispose())
  controller.track('@old', 4, { tier: 'plain' }, 1)
  controller.track('@"monthly revenue', 17, { tier: 'plain' }, 2)
  assert.equal(pending.length, 2)
  assert.equal(pending[0].signal.aborted, true)
  assert.equal(pending[1].payload.quoted, true)
  assert.equal(pending[1].payload.query, 'monthly revenue')
  const response = (path) => ({
    ok: true,
    value: {
      environmentFingerprint: 'fp-a',
      items: [{ ...candidate(path), section: 'strict' }],
    },
  })
  pending[1].resolve(response('new'))
  await tick()
  pending[0].resolve(response('old'))
  await tick()
  assert.match(JSON.stringify(controller.menu.getSnapshot()), /new/)
  assert.ok(!JSON.stringify(controller.menu.getSnapshot()).includes('metric:old'))
})

test('installed DSH controller exposes and selects matches beyond the former 100-row cap', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const data = {
    kinds: ['metric'],
    items: Array.from({ length: 250 }, (_, i) => candidate(`sales.revenue_${i}`)),
  }
  const inserted = []
  const source = createSemanticReferenceSource({
    async call(_channel, endpoint, payload) {
      if (endpoint.endsWith('/selected')) return { ok: true, value: { selected: true } }
      assert.equal(Object.hasOwn(payload, 'limit'), false)
      return {
        ok: true,
        value: { environmentFingerprint: 'fp-a', items: search(data, payload.query) },
      }
    },
  })
  const controller = new host.InputTriggerController({
    actx: {
      bail(_ctx, _name, request) {
        inserted.push(request)
        return true
      },
    },
    sessionId: 'a',
    roster: { all: () => [source], sources: () => [source] },
  })
  t.after(() => controller.dispose())
  controller.track('@', 1, { tier: 'plain' }, 1)
  await tick()
  assert.equal(controller.menu.getSnapshot().groups[0].items.length, 250)
  controller.track('@指标', 3, { tier: 'plain' }, 2)
  await tick()
  const rows = controller.menu.getSnapshot().groups[0].items
  assert.equal(rows.length, 250)
  assert.ok(rows.every((row) => row.section === '语义对象'))
  controller.pick('marivo-semantic', 249)
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].reference.ref, rows[249].value)
})

test('candidate display uses the same Chinese labels as search', async () => {
  const data = {
    kinds: Object.keys(semanticKindLabels),
    items: Object.keys(semanticKindLabels).map((kind) => candidate(`sales.${kind}`, kind)),
  }
  const source = createSemanticReferenceSource({
    async call(_channel, _endpoint, payload) {
      return {
        ok: true,
        value: { environmentFingerprint: 'fp-a', items: search(data, payload.query) },
      }
    },
  })
  for (const [kind, label] of Object.entries(semanticKindLabels)) {
    const rows = await source.candidates(
      { sessionId: 'a' },
      { query: label, signal: new AbortController().signal },
    )
    assert.ok(rows.some((row) => row.name === `${label} · sales.${kind}`))
  }
})
