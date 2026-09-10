import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { registerCredentialRpc } from '../../src/datasource/rpc.ts'
import { marivoCredentialStorageRef } from '../../src/datasource/shell-env.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { barrier, context, finish, fixture, waiting } from './fixtures.ts'

function removable() {
  const f = fixture('web')
  let removed = false,
    writes = 0
  const describe = f.bridge.describe
  f.bridge.describe = async (name, signal) => {
    if (removed) throw new Error('not-found')
    return describe(name, signal)
  }
  f.bridge.inventory = async () => (removed ? [] : [{ ...f.description }])
  f.bridge.remove = async (description) => {
    assert.equal(description.definition, f.description.definition)
    removed = true
    writes++
    return { name: description.name }
  }
  return {
    ...f,
    get writes() {
      return writes
    },
  }
}

async function remove(f: ReturnType<typeof fixture>, deleteCredentials = false) {
  const view = await context(f)
  const input = {
    generation: f.service.generation,
    id: randomUUID(),
    scope: view.token,
    action: 'delete-datasource' as const,
    version: view.version,
    deleteCredentials,
  }
  f.service.start(input)
  return { input, result: await finish(f, input.id, input.scope) }
}

test('removal preserves shared credentials unless explicitly selected and replays no writes', async (t) => {
  for (const deleteCredentials of [false, true]) {
    const f = removable()
    t.after(() => f.service.close())
    f.store.put('DB_PASSWORD')
    const { input, result } = await remove(f, deleteCredentials)
    assert.equal(result.status, 'succeeded')
    assert.equal(result.datasourceRemoved, true)
    assert.equal(f.store.values.has(marivoCredentialStorageRef('DB_PASSWORD')), !deleteCredentials)
    assert.deepEqual(await f.service.overview('workspace', f.resolve, f.controller.signal), [])
    assert.deepEqual(f.service.start(input), result)
    assert.equal(f.writes, 1)
    assert.equal(f.store.calls.unset, Number(deleteCredentials))
    assert.equal(f.store.calls.resolve, 0)
    assert.doesNotMatch(JSON.stringify(result), /canary-private/)
  }
})

test('readonly credential failure reports the deleted datasource and retained references', async (t) => {
  const f = removable()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  f.store.readonly = true
  const { result } = await remove(f, true)
  assert.equal(result.status, 'failed')
  assert.equal(result.datasourceRemoved, true)
  assert.deepEqual(result.credentialDeleteFailures, ['DB_PASSWORD'])
  assert.deepEqual(result.deletedCredentials, [])
  assert.deepEqual(result.errors, ['credential-delete-failed'])
  assert.equal(f.store.values.size, 1)
  assert.doesNotMatch(JSON.stringify(result), /unsafe-provider-detail|canary-private/)
})

test('a rejected or unconfirmed datasource removal never deletes credentials', async (t) => {
  for (const mode of ['reject', 'lost']) {
    const f = removable()
    t.after(() => f.service.close())
    f.store.put('DB_PASSWORD')
    f.bridge.remove = async () => {
      if (mode === 'lost') throw new Error('unsafe-subprocess-error')
      return { error: 'datasource-not-removable' }
    }
    const { result } = await remove(f, true)
    assert.equal(result.status, 'failed')
    assert.equal(result.datasourceRemoved, undefined)
    assert.equal(f.store.calls.unset, 0)
  }
})

test('stale credentials, definition, and Runtime reject removal before any write', async (t) => {
  for (const changed of ['credentials', 'definition', 'runtime']) {
    const f = removable()
    t.after(() => f.service.close())
    let currentBridge = f.bridge
    const view = (
      await f.service.overview('workspace', async () => currentBridge, f.controller.signal)
    )[0]!
    if (changed === 'credentials') f.service.invalidate(['DB_PASSWORD'])
    if (changed === 'definition') f.description.definition = 'b'.repeat(64)
    if (changed === 'runtime')
      currentBridge = { ...f.bridge, binding: { ...f.bridge.binding, fingerprint: 'other' } }
    const input = {
      generation: f.service.generation,
      id: randomUUID(),
      scope: view.token,
      action: 'delete-datasource' as const,
      version: view.version,
      deleteCredentials: true,
    }
    if (changed === 'credentials')
      assert.throws(() => f.service.start(input), /credentials-changed/)
    else {
      f.service.start(input)
      assert.equal((await finish(f, input.id, input.scope)).status, 'failed')
    }
    assert.equal(f.writes, 0)
    assert.equal(f.store.calls.unset, 0)
  }
})

test('deletion revokes prepared no-credential execution and waiting credential requests', async (t) => {
  const f = removable()
  t.after(() => f.service.close())
  f.description.refs = []
  f.description.fields = {}
  const prepared = await f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  assert('status' in prepared && prepared.status === 'ready')
  await remove(f)
  assert.throws(prepared.assertCurrent, /context-changed/)
  prepared.release()

  const pending = removable()
  t.after(() => pending.service.close())
  const task = pending.service.prepare('test', pending.exec, pending.resolve, 'warehouse')
  const rejected = assert.rejects(task, /context-changed/)
  await waiting(pending)
  await remove(pending)
  await rejected
  assert.equal(pending.service.watch('session').requests[0]?.status, 'context-changed')
})

test('in-flight deletion prevents a second operation on the same definition', async (t) => {
  const f = removable(),
    gate = barrier()
  t.after(() => f.service.close())
  const view = await context(f)
  const original = f.bridge.remove!
  f.bridge.remove = async (...args) => {
    await gate.promise
    return original(...args)
  }
  const input = {
    generation: f.service.generation,
    id: randomUUID(),
    scope: view.token,
    action: 'delete-datasource' as const,
    version: view.version,
  }
  f.service.start(input)
  assert.throws(
    () => f.service.start({ ...input, id: randomUUID() }),
    /operation-busy|context-changed/,
  )
  gate.release()
  assert.equal((await finish(f, input.id, input.scope)).status, 'succeeded')
})

test('RPC lost response recovers deletion once and keeps the outcome after the card disappears', async (t) => {
  const f = removable()
  t.after(() => f.service.close())
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const handler = channels.get('/dsh-data-analysis-credentials')!
  let starts = 0
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload, signal) {
      const result = await handler(endpoint, payload, signal!)
      if (endpoint === 'start') {
        starts++
        throw new Error('lost-response')
      }
      return result
    },
  })
  t.after(() => model.dispose())
  await model.show('workspace')
  const view = model.getSnapshot().datasources[0]!
  await model.start(view, 'delete-datasource', {}, undefined, true)
  assert.equal(starts, 1)
  assert.equal(f.writes, 1)
  assert.deepEqual(model.getSnapshot().datasources, [])
  assert.deepEqual(model.getSnapshot().operations, [])
  assert.equal(model.getSnapshot().outcomes[view.token]?.operation?.datasourceRemoved, true)
  model.dismissOutcome(view.token)
  assert.deepEqual(model.getSnapshot().outcomes, {})
})

test('shared credentials revoke other Workspace preparations only when credential deletion is selected', async (t) => {
  for (const deleteCredentials of [false, true]) {
    const f = removable()
    t.after(() => f.service.close())
    f.store.put('DB_PASSWORD')
    const other = { ...f.bridge, binding: { ...f.bridge.binding, fingerprint: 'other-workspace' } }
    const prepared = await f.service.prepareExecution(f.exec, async () => other, ['other'])
    assert('status' in prepared && prepared.status === 'ready')
    await remove(f, deleteCredentials)
    if (deleteCredentials) assert.throws(prepared.assertCurrent, /credentials-changed/)
    else prepared.assertCurrent()
    prepared.release()
  }
})

test('cancellation after datasource removal reports completion and does not begin credential deletion', async (t) => {
  const f = removable()
  t.after(() => f.service.close())
  const view = await context(f),
    id = randomUUID()
  const original = f.bridge.remove!
  f.bridge.remove = async (...args) => {
    const result = await original(...args)
    f.service.cancelOperation(f.service.generation, id, view.token)
    return result
  }
  f.service.start({
    generation: f.service.generation,
    id,
    scope: view.token,
    version: view.version,
    action: 'delete-datasource',
    deleteCredentials: true,
  })
  const result = await finish(f, id, view.token)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.datasourceRemoved, true)
  assert.equal(f.store.calls.unset, 0)
})

test('deletion ends an edit configuration request before it selects a datasource', async (t) => {
  const f = removable()
  t.after(() => f.service.close())
  const task = f.service.configure(f.exec, f.resolve, {
    mode: 'edit',
    name: 'warehouse',
    reason: 'edit',
  })
  for (;;) {
    if (f.service.watch('session').configurationRequests.length) break
    await f.service.waitWatch(
      'session',
      f.service.watch('session').cursor,
      AbortSignal.timeout(5000),
    )
  }
  await remove(f)
  assert.deepEqual(await task, { status: 'context-changed' })
})

test('authoritative deletion rejection stays actionable instead of becoming an unknown operation', async (t) => {
  const f = removable()
  t.after(() => f.service.close())
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const handler = channels.get('/dsh-data-analysis-credentials')!
  let queries = 0
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload, signal) {
      if (endpoint === 'operation') queries++
      return handler(endpoint, payload, signal!)
    },
  })
  t.after(() => model.dispose())
  await model.show('workspace')
  const view = model.getSnapshot().datasources[0]!
  f.service.invalidate(['DB_PASSWORD'])
  await model.start(view, 'delete-datasource', {}, undefined, true)
  assert.equal(f.writes, 0)
  assert.equal(queries, 0)
  assert.deepEqual(model.getSnapshot().outcomes[view.token]?.operation?.errors, [
    'credentials-changed',
  ])
  assert.equal(model.getSnapshot().datasources[0]?.version, JSON.stringify([['DB_PASSWORD', 1]]))
  assert.doesNotMatch(model.getSnapshot().error, /不可恢复/)
})
