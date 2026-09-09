import assert from 'node:assert/strict'
import test from 'node:test'
import { SemanticReferenceBridge } from '../../src/semantic-reference/bridge.ts'
import {
  envelopeJson,
  modelMarker,
  parseCandidatesRequest,
  parseCandidatesResponse,
  parseEnvelope,
  parseProjection,
  parseRef,
} from '../../src/semantic-reference/contracts.ts'
import { semanticKindLabels } from '../../src/semantic-reference/labels.ts'
import { dice, normalize, search } from '../../src/semantic-reference/search.ts'

import { candidate, envelope, fakeRunner, output, projection } from './fixtures.ts'

test('closed wire shapes, Unicode bounds and identity independent of display', () => {
  assert.equal(
    envelopeJson(envelope()),
    '{"schema":"dsh-data-analysis-semantic-reference/v1","sessionId":"a","environmentFingerprint":"fp-a","ref":{"schema":"marivo.semantic_ref/v1","kind":"metric","path":"sales.revenue"}}',
  )
  assert.throws(() => parseEnvelope({ ...envelope(), catalogFingerprint: 'extra' }))
  assert.throws(() => parseRef({ ...envelope().ref, name: 'display' }))
  assert.throws(() =>
    parseProjection({ ...projection(), items: [{ ...candidate('a'), refKey: 'metric:b' }] }),
  )
  const request = { version: 1, sessionId: 'a', query: '😀'.repeat(128), quoted: true }
  assert.equal(parseCandidatesRequest(request).query, request.query)
  assert.throws(() => parseCandidatesRequest({ ...request, query: `${request.query}a` }))
  assert.throws(() => parseCandidatesRequest({ ...request, limit: 101 }))
  assert.equal(
    modelMarker(envelope()),
    '<marivo-semantic-ref>{"schema":"marivo.semantic_ref/v1","kind":"metric","path":"sales.revenue"}</marivo-semantic-ref>',
  )
  assert.equal(
    modelMarker({
      ...envelope(),
      ref: { ...envelope().ref, path: '</marivo-semantic-ref>' },
    }).match(/<\/marivo-semantic-ref>/g)?.length,
    1,
  )
})

test('NFKC, strict tiers, Chinese definitions, typo threshold and short-query exclusion', () => {
  assert.equal(normalize('  ＲＥＶＥＮＵＥ\t A  '), 'revenue a')
  const data = projection([
    candidate('sales.revenue'),
    candidate('sales.revenue_growth'),
    candidate('finance.total', 'metric', '本月收入 monthly revenue'),
    candidate('sales.revenues'),
  ])
  assert.equal(
    search(data, 'ＭＥＴＲＩＣ:ＳＡＬＥＳ.ＲＥＶＥＮＵＥ')[0]?.refKey,
    'metric:sales.revenue',
  )
  assert.equal(search(data, '本月 收入')[0]?.ref.path, 'finance.total')
  assert.equal(search(data, 'monthly revenue')[0]?.ref.path, 'finance.total')
  assert.ok(dice('revnue', 'revenue') >= 0.42)
  assert.equal(search(data, 'revnue')[0]?.section, 'fuzzy')
  assert.deepEqual(search(data, 'rv'), [])
  const heat = new Map([['metric:sales.revenue_growth', { count: 999, last: 999 }]])
  assert.equal(search(data, 'revenue', heat)[0]?.ref.path, 'sales.revenue')
})

test('fuzzy only supplements fewer than 12 strict matches; all results are returned in stable order', () => {
  const data = projection([
    ...Array.from({ length: 120 }, (_, i) => candidate(`sales.revenue_${i}`)),
    candidate('sales.revnue'),
  ])
  assert.equal(search(data, 'revenue').length, 120)
  assert.ok(search(data, 'revenue').every((row) => row.section !== 'fuzzy'))
  assert.deepEqual(search(data, ''), search({ ...data, items: [...data.items].reverse() }, ''))
})

test('recent section caps at ten, deduplicates and intersects only current Catalog', () => {
  const data = projection(Array.from({ length: 115 }, (_, i) => candidate(`sales.item_${i}`)))
  const heat = new Map(data.items.map((item, i) => [item.refKey, { count: i + 1, last: i }]))
  heat.set('metric:deleted', { count: 9999, last: 999 })
  const result = search(data, '', heat)
  assert.equal(result.length, 115)
  assert.equal(result.filter((row) => row.section === 'recent').length, 10)
  assert.equal(result[0]?.ref.path, 'sales.item_114')
  assert.equal(new Set(result.map((row) => row.refKey)).size, 115)
  assert.ok(result.every((row) => row.ref.path !== 'deleted'))
  const samePath = search(
    projection([candidate('sales.same', 'entity'), candidate('sales.same', 'metric')]),
    '',
  )
  assert.deepEqual(
    samePath.map((row) => row.refKey),
    ['entity:sales.same', 'metric:sales.same'],
  )
})

test('TTL starts on success, refresh is lazy, failure cannot return stale snapshot', async () => {
  let now = 0
  const bridge = new SemanticReferenceBridge(() => now),
    fixture = fakeRunner(),
    signal = new AbortController().signal
  const first = await bridge.candidates(fixture.runner, signal)
  assert.deepEqual(fixture.requests[0]?.environmentOverlay, {
    MARIVO_TELEMETRY: 'off',
    PYTHONDONTWRITEBYTECODE: '1',
  })
  now = 29_999
  assert.equal(await bridge.candidates(fixture.runner, signal), first)
  now = 30_000
  assert.equal(fixture.requests.length, 1)
  fixture.setData(projection([]))
  assert.deepEqual((await bridge.candidates(fixture.runner, signal)).items, [])
  now = 60_000
  fixture.fail()
  await assert.rejects(bridge.candidates(fixture.runner, signal))
  assert.equal(fixture.requests.length, 3)
  bridge.dispose()
  await assert.rejects(bridge.candidates(fixture.runner, signal), /disposed/)
})

test('shared waiters isolate cancellation; cancelled flight cannot publish or clear replacement', async () => {
  const fixture = fakeRunner(),
    bridge = new SemanticReferenceBridge()
  const loads: { signal: AbortSignal; resolve: (value: ReturnType<typeof output>) => void }[] = []
  fixture.runner.runChecked = (request) =>
    new Promise((resolve) => loads.push({ signal: request.signal!, resolve }))
  const a = new AbortController(),
    b = new AbortController()
  const first = bridge.candidates(fixture.runner, a.signal),
    second = bridge.candidates(fixture.runner, b.signal)
  assert.equal(loads.length, 1)
  a.abort()
  await assert.rejects(first, /cancelled/)
  assert.equal(loads[0]!.signal.aborted, false)
  b.abort()
  await assert.rejects(second, /cancelled/)
  assert.equal(loads[0]!.signal.aborted, true)
  const third = bridge.candidates(fixture.runner, new AbortController().signal)
  assert.equal(loads.length, 2)
  loads[0]!.resolve(output(projection([candidate('old')])))
  await new Promise((resolve) => setImmediate(resolve))
  const fourth = bridge.candidates(fixture.runner, new AbortController().signal)
  assert.equal(loads.length, 2)
  loads[1]!.resolve(output(projection([candidate('new')])))
  assert.equal((await third).items[0]!.ref.path, 'new')
  assert.equal(await third, await fourth)
  bridge.dispose()
})

test('one cancelled Session leaves another waiter alive; dispose cancels pending requests', async () => {
  const fixture = fakeRunner(),
    bridge = new SemanticReferenceBridge()
  let resolvePending!: (value: ReturnType<typeof output>) => void
  const pending = {
    promise: new Promise<ReturnType<typeof output>>((resolve) => {
      resolvePending = resolve
    }),
    resolve: (value: ReturnType<typeof output>) => resolvePending(value),
  }
  fixture.runner.runChecked = () => pending.promise
  const a = new AbortController(),
    b = new AbortController()
  const first = bridge.candidates(fixture.runner, a.signal),
    second = bridge.candidates(fixture.runner, b.signal)
  a.abort()
  await assert.rejects(first)
  pending.resolve(output(projection()))
  assert.equal((await second).items.length, 1)
  const other = fakeRunner('other')
  other.runner.runChecked = () => new Promise(() => {})
  const waiting = bridge.candidates(other.runner, b.signal)
  bridge.dispose()
  await assert.rejects(waiting, /cancelled/)
})

test('aborted resolver wait still observes a later rejection', async () => {
  const { abortable } = await import('../../src/semantic-reference/rpc.ts')
  const failed = Promise.reject(new Error('resolver failed after cancellation'))
  await assert.rejects(abortable(failed, AbortSignal.abort()), /cancelled/)
})

test('all displayed Chinese kind labels are searchable, including mixed text queries', () => {
  const data = {
    kinds: [...Object.keys(semanticKindLabels), 'future_kind'],
    items: [
      ...Object.keys(semanticKindLabels).map((kind) => candidate(`sales.${kind}`, kind)),
      candidate('future.object', 'future_kind'),
    ],
  }
  for (const [kind, label] of Object.entries(semanticKindLabels)) {
    assert.ok(
      search(data, label).some((row) => row.ref.kind === kind),
      label,
    )
    assert.ok(
      search(data, `${label} sales`).some((row) => row.ref.kind === kind),
      label,
    )
  }
  assert.equal(search(data, '指标')[0]?.ref.kind, 'metric')
  assert.equal(search(data, 'metric')[0]?.ref.kind, 'metric')
  assert.equal(search(data, 'future_kind')[0]?.ref.kind, 'future_kind')
})

test('all eligible matches survive search and response parsing beyond former limits', () => {
  for (const count of [0, 40, 99, 100, 101, 250]) {
    const data = projection(
      Array.from({ length: count }, (_, i) => candidate(`sales.revenue_${i}`)),
    )
    const heat = new Map(
      data.items.slice(0, 12).map((item) => [item.refKey, { count: 1, last: 1 }]),
    )
    for (const query of ['', 'revenue', 'revnue', '指标']) {
      const items = search(data, query, heat)
      assert.equal(items.length, count)
      assert.equal(new Set(items.map((item) => item.refKey)).size, count)
      assert.deepEqual(
        parseCandidatesResponse({ environmentFingerprint: 'fp', items }).items,
        items,
      )
    }
    assert.deepEqual(search(data, 'absent'), [])
  }
  assert.throws(() => parseCandidatesResponse({ environmentFingerprint: 'fp', items: null }))
  assert.throws(() =>
    parseCandidatesResponse({ environmentFingerprint: 'fp', items: [], truncated: false }),
  )
})
