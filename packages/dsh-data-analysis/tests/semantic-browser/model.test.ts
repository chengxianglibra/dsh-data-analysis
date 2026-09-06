import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countObjectsByKind,
  emptyView,
  filterObjects,
  SemanticBrowserModel,
} from '../../src/client/semantic-browser/model.ts'
import { parseCatalogSnapshot } from '../../src/semantic-browser/contracts.ts'
import { object, snapshot } from './fixtures.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
test('type counts follow domain and include unassigned objects only in all domains', () => {
  const objects = [
    object(),
    object('orders', 'entity'),
    { ...object('jobs', 'entity'), domain: 'ops' },
    { ...object('warehouse', 'datasource'), domain: null },
  ]
  const all = countObjectsByKind(objects, '')
  assert.equal(all.total, 4)
  assert.equal(all.byKind.get('entity'), 2)
  const sales = countObjectsByKind(objects, 'sales')
  assert.equal(sales.total, 2)
  assert.equal(sales.byKind.get('entity'), 1)
  assert.equal(sales.byKind.get('datasource') ?? 0, 0)
  const ops = countObjectsByKind(objects, 'ops')
  assert.equal(ops.total, 1)
  assert.equal(ops.byKind.get('metric') ?? 0, 0)
  assert.equal(countObjectsByKind(objects, 'missing').total, 0)
  assert.equal(countObjectsByKind([], '').total, 0)
})
function setup() {
  const calls: { signal: AbortSignal; payload: unknown; resolve: (value: unknown) => void }[] = []
  const model = new SemanticBrowserModel({
    call: async (_channel, _endpoint, payload, signal) =>
      new Promise((resolve) => {
        calls.push({ signal, payload, resolve })
      }),
  })
  return { calls, model }
}
test('late replies cannot cross workspace, refresh, close or disposal boundaries', async () => {
  const { calls, model } = setup()
  model.show('a')
  model.patch({ query: '收入' })
  model.select('b')
  assert.equal(calls[0]!.signal.aborted, true)
  calls[1]!.resolve({ ok: true, value: snapshot('b') })
  await tick()
  calls[0]!.resolve({ ok: true, value: snapshot('a') })
  await tick()
  assert.equal(model.getSnapshot().views.b!.snapshot!.workspaceId, 'b')
  assert.equal(model.getSnapshot().views.a!.snapshot, undefined)
  model.select('a')
  assert.equal(model.getSnapshot().views.a!.query, '收入')
  void model.refresh()
  calls[2]!.resolve({ ok: true, value: snapshot('a', [object('old')]) })
  calls[3]!.resolve({ ok: true, value: snapshot('a', [object('new')]) })
  await tick()
  assert.equal(model.getSnapshot().views.a!.snapshot!.objects[0]!.name, 'new')
  void model.refresh()
  model.close()
  calls[4]!.resolve({ ok: true, value: snapshot('a') })
  await tick()
  assert.equal(model.getSnapshot().views.a!.snapshot!.objects[0]!.name, 'new')
  model.show('a')
  model.dispose()
  calls[5]!.resolve({ ok: true, value: snapshot('a') })
  await tick()
  assert.equal(calls[5]!.signal.aborted, true)
})
test('failed refresh preserves exact snapshot and navigation; reconnect clears host-bound data', async () => {
  const { calls, model } = setup()
  model.show('a')
  calls[0]!.resolve({ ok: true, value: snapshot() })
  await tick()
  model.navigate('metric:sales.revenue')
  model.navigate('entity:sales.orders')
  model.back()
  assert.equal(model.getSnapshot().views.a!.selected, 'metric:sales.revenue')
  const previous = model.getSnapshot().views.a!.snapshot
  void model.refresh()
  calls[1]!.resolve({ ok: false, error: { message: '加载超时' } })
  await tick()
  assert.equal(model.getSnapshot().views.a!.snapshot, previous)
  assert.equal(model.getSnapshot().views.a!.error, '加载超时')
  model.resetConnection()
  assert.deepEqual(model.getSnapshot().views, {})
  assert.equal(model.getSnapshot().workspaceId, '')
})
test('search combines domain/type, unicode and full definitions; no reference collisions', () => {
  const a = object(),
    b = { ...object('revenue', 'measure'), domain: 'ops' }
  assert.equal(
    filterObjects([a, b], {
      ...emptyView(),
      query: 'ＲＥＶＥＮＵＥ 收入',
      domain: 'sales',
      kind: 'metric',
    }).length,
    1,
  )
  assert.equal(filterObjects([a, b], { ...emptyView(), query: 'measure:sales.revenue' })[0], b)
  assert.equal(parseCatalogSnapshot(snapshot('a', [a, b])).objects.length, 2)
  assert.throws(() => parseCatalogSnapshot(snapshot('a', [a, a])))
  assert.throws(() =>
    parseCatalogSnapshot({ ...snapshot(), objects: [{ ...a, secret: 'forbidden' }] }),
  )
})

test('deleted object keeps a missing selection; invalid responses never replace a good snapshot', async () => {
  const { calls, model } = setup()
  model.show('a')
  calls[0]!.resolve({ ok: true, value: snapshot() })
  await tick()
  model.navigate('metric:sales.revenue')
  void model.refresh()
  calls[1]!.resolve({ ok: true, value: snapshot('a', []) })
  await tick()
  assert.equal(model.getSnapshot().views.a!.selected, 'metric:sales.revenue')
  assert.deepEqual(model.getSnapshot().views.a!.snapshot!.objects, [])
  const previous = model.getSnapshot().views.a!.snapshot
  void model.refresh()
  calls[2]!.resolve({ ok: true, value: snapshot('wrong-workspace') })
  await tick()
  assert.equal(model.getSnapshot().views.a!.snapshot, previous)
  assert.ok(model.getSnapshot().views.a!.error)
  model.unavailable()
  assert.equal(model.getSnapshot().views.a!.snapshot, undefined)
  model.dispose()
})
