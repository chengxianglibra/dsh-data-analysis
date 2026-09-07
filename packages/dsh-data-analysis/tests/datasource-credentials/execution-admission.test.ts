import assert from 'node:assert/strict'
import test from 'node:test'
import type { MarivoDatasourceDescription } from '../../src/datasource/bridge.ts'
import { marivoCredentialStorageRef } from '../../src/datasource/shell-env.ts'
import { barrier, context, fixture, operation, waiting } from './fixtures.ts'

function multiple(interaction: 'web' | 'none' = 'none') {
  const f = fixture(interaction)
  const descriptions: Record<string, MarivoDatasourceDescription> = {
    warehouse: { ...f.description },
    catalog: {
      name: 'catalog',
      refs: ['CATALOG_PASSWORD'],
      fields: { password: 'CATALOG_PASSWORD' },
      definition: 'c'.repeat(64),
    },
  }
  f.bridge.describe = async (name) => structuredClone(descriptions[name]!)
  f.bridge.inventory = async () => Object.values(descriptions).map((item) => structuredClone(item))
  f.bridge.test = async (description) => ({
    name: description.name,
    ok: true,
    latency_ms: 1,
    failure: null,
    repair: null,
  })
  return { ...f, descriptions }
}

test('configured execution obtains one fresh snapshot, skips connection tests and forgets secrets', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const first = await f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  assert('status' in first && first.status === 'ready')
  assert.equal(first.values.DB_PASSWORD, 'canary-private-4826')
  assert.equal(f.tests, 0)
  assert.equal(f.store.calls.resolve, 1)
  first.assertCurrent()
  first.release()
  assert.deepEqual(Object.keys(first.values), [])
  assert.throws(first.assertCurrent, /execution-ended/)
  f.store.put('DB_PASSWORD', 'rotated-value')
  const next = await f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  assert('status' in next && next.status === 'ready')
  assert.equal(next.values.DB_PASSWORD, 'rotated-value')
  next.release()
})

test('noninteractive and subagent executions report missing refs without resolving any values', async (t) => {
  for (const origin of ['headless', 'subagent', 'delegated']) {
    const f = multiple(origin === 'headless' ? 'none' : 'web')
    t.after(() => f.service.close())
    if (origin === 'subagent') Object.assign(f.agent.session.header, { origin: 'subagent' })
    if (origin === 'delegated') Object.assign(f.agent.session.header, { delegationDepth: 1 })
    f.store.put('DB_PASSWORD')
    assert.deepEqual(
      await f.service.prepareExecution(f.exec, f.resolve, ['warehouse', 'catalog']),
      { status: 'needs-credentials', name: 'catalog', refs: ['CATALOG_PASSWORD'] },
    )
    assert.equal(f.store.calls.resolve, 0)
    assert.equal(f.service.watch('session').requests.length, 0)
  }
})

test('all datasource inputs become ready before a single execution snapshot is returned', async (t) => {
  const f = multiple('web')
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD', 'warehouse-canary')
  let starts = 0
  const execution = f.service
    .prepareExecution(f.exec, f.resolve, ['warehouse', 'catalog'])
    .then((prepared) => {
      assert('status' in prepared && prepared.status === 'ready')
      prepared.assertCurrent()
      starts++
      assert.deepEqual(Object.keys(prepared.grants), ['warehouse', 'catalog'])
      assert.equal(prepared.values.DB_PASSWORD, 'warehouse-canary')
      assert.equal(prepared.values.CATALOG_PASSWORD, 'catalog-canary')
      prepared.release()
    })
  const request = await waiting(f)
  assert.equal(request.context.name, 'catalog')
  assert.equal(starts, 0)
  assert.equal(f.store.calls.resolve, 0)
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { CATALOG_PASSWORD: 'catalog-canary' },
  })
  await execution
  assert.equal(starts, 1)
  assert.equal(f.store.calls.resolve, 3)
  assert.doesNotMatch(JSON.stringify(f.service.watch('session')), /warehouse-canary|catalog-canary/)
})

test('a ready datasource rotated while another waits rejects the original execution', async (t) => {
  const f = multiple('web')
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const execution = f.service.prepareExecution(f.exec, f.resolve, ['warehouse', 'catalog'])
  const rejected = assert.rejects(execution, /credentials-changed/)
  const request = await waiting(f)
  f.store.put('DB_PASSWORD', 'rotated-while-waiting')
  f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { CATALOG_PASSWORD: 'submitted' },
  })
  await rejected
  assert.equal(f.store.calls.resolve, 1)
})

test('datasources sharing a missing credential use one form and one final shared snapshot', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const execution = f.service.prepareExecution(f.exec, f.resolve, ['warehouse', 'catalog'])
  const request = await waiting(f)
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'shared-canary' },
  })
  const prepared = await execution
  assert('status' in prepared && prepared.status === 'ready')
  assert.equal(f.service.watch('session').requests.length, 1)
  assert.equal(f.tests, 1)
  assert.equal(f.store.calls.resolve, 2)
  assert.deepEqual(Object.keys(prepared.grants), ['warehouse', 'catalog'])
  prepared.release()
})

test('rotation after form test settlement cannot be absorbed by the execution continuation', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  let rotated = false
  f.bridge.test = async (description) => {
    let attempts = 0
    const afterSettlement = () => {
      if (f.service.watch('session').requests[0]?.status === 'succeeded') {
        f.store.put('DB_PASSWORD', 'rotated-after-test')
        f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
        rotated = true
      } else if (++attempts < 100) queueMicrotask(afterSettlement)
    }
    queueMicrotask(afterSettlement)
    return { name: description.name, ok: true, latency_ms: 1, failure: null, repair: null }
  }
  const pending = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const rejected = assert.rejects(pending, /credentials-changed/)
  const request = await waiting(f)
  const result = await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'submitted' },
  })
  await rejected
  assert.equal(result.status, 'succeeded')
  assert.equal(rotated, true)
  assert.equal(f.store.calls.resolve, 1)
})

test('credential rotation during final snapshot resolution rejects mixed values', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const gate = barrier(),
    entered = barrier(),
    original = f.store.resolve.bind(f.store)
  f.store.resolve = async (ref) => {
    entered.release()
    await gate.promise
    return original(ref)
  }
  const pending = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const rejected = assert.rejects(pending, /credentials-changed/)
  await entered.promise
  f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
  gate.release()
  await rejected
})

test('prepared execution guard rejects rotations, cancellation and Workspace changes before Shell starts', async (t) => {
  for (const change of ['rotate', 'cancel', 'workspace', 'dispose']) {
    const f = fixture()
    t.after(() => f.service.close())
    f.store.put('DB_PASSWORD')
    const prepared = await f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
    assert('status' in prepared && prepared.status === 'ready')
    if (change === 'rotate')
      f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
    if (change === 'cancel') f.controller.abort()
    if (change === 'workspace') Object.assign(f.agent.session.header, { cwd: '/another-workspace' })
    if (change === 'dispose') f.service.disposeAgent(f.agent)
    assert.throws(prepared.assertCurrent)
    prepared.release()
  }
})

test('Workspace or datasource definition change during final snapshot rejects the pending execution', async (t) => {
  for (const change of ['workspace', 'definition']) {
    const f = fixture()
    t.after(() => f.service.close())
    f.store.put('DB_PASSWORD')
    const original = f.store.resolve.bind(f.store)
    f.store.resolve = async (ref) => {
      const value = await original(ref)
      if (change === 'workspace') Object.assign(f.bridge.binding, { fingerprint: 'changed' })
      else f.description.definition = 'e'.repeat(64)
      return value
    }
    const resolve = async () => ({ ...f.bridge, binding: { ...f.bridge.binding } })
    await assert.rejects(
      f.service.prepareExecution(f.exec, resolve, ['warehouse']),
      /context-changed/,
    )
  }
})

test('cancellation ends a waiting execution and prevents its form from resuming it', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const pending = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const rejected = assert.rejects(pending, /call-ended/)
  const request = await waiting(f)
  f.controller.abort()
  await rejected
  assert.equal(f.service.watch('session').requests[0]?.status, 'call-ended')
  await assert.rejects(
    operation(f, request.context, 'submit', {
      requestId: request.id,
      changes: { DB_PASSWORD: 'too-late' },
    }),
    /call-ended/,
  )
  assert.equal(f.store.calls.set, 0)
})

test('management tests retain valid history and rotations mark it stale', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  await f.service.prepare('test', f.exec, f.resolve, 'warehouse')
  assert.equal((await context(f)).lastTest?.stale, false)
  f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
  assert.equal((await context(f)).lastTest?.stale, true)
  const view = await context(f)
  assert.equal((await operation(f, view, 'test')).status, 'succeeded')
  assert.equal((await context(f)).lastTest?.stale, false)
})

test('history keeps credential versions after its management context expires', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  await context(f)
  f.advance(60_000)
  await f.service.prepare('test', f.exec, f.resolve, 'warehouse')
  // The overview context expires before the newer direct-test history does.
  f.advance(1_740_000)
  f.service.watch('session')
  f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
  const historical = await context(f)
  assert.equal(historical.lastTest?.stale, true)
  f.advance(60_000)
  assert.equal((await context(f)).lastTest, undefined)
})

test('empty datasource execution has an empty scope and exact names are bounded', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const prepared = await f.service.prepareExecution(f.exec, f.resolve, [])
  assert('status' in prepared && prepared.status === 'ready')
  assert.deepEqual(Object.keys(prepared.values), [])
  assert.deepEqual(prepared.grants, {})
  prepared.release()
  for (const names of [
    ['warehouse', 'warehouse'],
    [' '],
    ['x'.repeat(257)],
    Array.from({ length: 17 }, (_, i) => `db${i}`),
  ])
    await assert.rejects(
      f.service.prepareExecution(f.exec, f.resolve, names),
      /invalid-datasources/,
    )
  assert.equal(f.store.calls.resolve, 0)
})

test('empty datasource execution rejects a changed Runtime binding before it can start', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  let resolves = 0
  const resolve = async () => ({
    ...f.bridge,
    binding: { ...f.bridge.binding, fingerprint: ++resolves === 1 ? 'first' : 'changed' },
  })
  await assert.rejects(f.service.prepareExecution(f.exec, resolve, []), /context-changed/)
})

test('a datasource description cannot substitute a name outside the execution request', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  f.bridge.describe = async () => ({ ...f.description, name: 'another-datasource' })
  await assert.rejects(
    f.service.prepareExecution(f.exec, f.resolve, ['warehouse']),
    /invalid-datasource-context/,
  )
  assert.equal(f.store.calls.resolve, 0)
})
