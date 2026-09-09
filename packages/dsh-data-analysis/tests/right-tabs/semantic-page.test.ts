import assert from 'node:assert/strict'
import test from 'node:test'
import { TabPage } from '../../src/client/right-tabs/page.ts'
import { object, snapshot } from '../semantic-browser/fixtures.ts'

for (const resource of [false, true]) {
  test(`semantic ${resource ? 'resource' : 'directory'} tab keeps browsing state until an explicit refresh`, async (t) => {
    const first = object('revenue'),
      second = object('orders', 'entity')
    const calls: unknown[] = []
    const page = new TabPage(
      'session',
      {
        kind: 'semantic',
        workspaceId: 'a',
        ...(resource ? { ref: first.ref } : {}),
      },
      {
        async call(_channel, endpoint, payload) {
          assert.equal(endpoint, 'semantic-browser/catalog')
          calls.push(payload)
          return { ok: true, value: snapshot('a', [first, second]) }
        },
      },
    )
    t.after(() => page.dispose())
    await page.navigate(1)
    await new Promise((resolve) => setImmediate(resolve))
    const model = page.semantic
    const view = () => model.getSnapshot().views.a!
    const loaded = view().snapshot
    assert.ok(loaded)
    model.patch({ query: 'revenue', kind: 'metric', domain: 'sales', tab: 'definition' })
    model.navigate('metric:sales.revenue')
    model.navigate('entity:sales.orders')
    model.back()
    // Host body remount or focus replay does not read or reset page-owned state.
    await page.navigate(1)
    assert.deepEqual(calls, [{ workspaceId: 'a' }])
    assert.equal(view().snapshot, loaded)
    assert.equal(view().selected, 'metric:sales.revenue')
    assert.equal(view().tab, 'definition')
    await model.refresh()
    assert.equal(calls.length, 2)
    assert.notEqual(view().snapshot, loaded)
    assert.equal(view().selected, 'metric:sales.revenue')
    assert.equal(view().query, 'revenue')
    assert.equal(view().kind, 'metric')
    assert.equal(view().domain, 'sales')
    assert.equal(view().tab, 'definition')
  })
}
