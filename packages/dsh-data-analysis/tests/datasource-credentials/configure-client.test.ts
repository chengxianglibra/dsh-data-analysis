import assert from 'node:assert/strict'
import test from 'node:test'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { registerCredentialRpc } from '../../src/datasource/rpc.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { fixture } from './fixtures.ts'

test('configuration watch reaches the tab model and selecting an existing datasource continues through the original tool', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const handler = channels.get('/dsh-data-analysis-credentials')!
  const model = new CredentialClientModel({
    call: async (_channel, endpoint, payload, signal) => handler(endpoint, payload, signal!),
  })
  t.after(() => model.dispose())
  await model.show('workspace')
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'need orders' })
  model.session('session')
  await new Promise<void>((resolve) => {
    const stop = model.subscribe(() => {
      if (!model.getSnapshot().requestId) return
      stop()
      resolve()
    })
  })
  const requestId = model.getSnapshot().requestId
  assert.ok(requestId)
  assert.equal(model.getSnapshot().requests[0]?.context, undefined)
  await model.selectConfiguration('workspace', requestId, 'warehouse')
  const context = model.getSnapshot().requests[0]!.context!
  assert.equal(context.name, 'warehouse')
  await model.start(context, 'submit', { DB_PASSWORD: 'browser-canary' })
  assert.deepEqual(await task, { status: 'ok', name: 'warehouse', latency_ms: 1 })
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /browser-canary/)
})

test('unconfirmed configuration writes are not replayed', async (t) => {
  let writes = 0
  const model = new CredentialClientModel({
    async call() {
      writes++
      throw new Error('transport-lost')
    },
  })
  t.after(() => model.dispose())
  await assert.rejects(
    model.saveConfiguration(
      'workspace',
      { generation: 'host', fingerprint: 'runtime', backends: [] },
      { backend: 'duckdb', fields: { name: 'warehouse' } },
      { name: 'warehouse', backend: 'duckdb', fields: {}, version: 'v1' },
    ),
    /transport-lost/,
  )
  assert.equal(writes, 1)
})

test('one form saves configuration references, then credentials through the existing operation, and only then resumes', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const writes: string[] = []
  f.bridge.create = async (input) => {
    writes.push(JSON.stringify(input))
    return { name: 'warehouse' }
  }
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const handler = channels.get('/dsh-data-analysis-credentials')!
  const model = new CredentialClientModel({
    call: async (_channel, endpoint, payload, signal) => handler(endpoint, payload, signal!),
  })
  t.after(() => model.dispose())
  await model.show('workspace')
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'need orders' })
  model.session('session')
  await new Promise<void>((resolve) => {
    const stop = model.subscribe(() => {
      if (!model.getSnapshot().requestId) return
      stop()
      resolve()
    })
  })
  const changes = { DB_PASSWORD: 'inline-canary' }
  await model.saveConfiguration(
    'workspace',
    {
      generation: f.service.generation,
      fingerprint: f.bridge.binding.fingerprint,
      backends: [],
    },
    { backend: 'duckdb', fields: { name: 'warehouse', password_env: 'DB_PASSWORD' } },
    undefined,
    model.getSnapshot().requestId,
    changes,
  )
  assert.equal((await task).status, 'ok')
  assert.equal(f.tests, 1)
  assert.equal(f.store.calls.set, 1)
  assert.deepEqual(changes, {})
  assert.doesNotMatch(JSON.stringify(writes), /inline-canary/)
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /inline-canary/)
})

test('failed configuration writes discard inline secrets without sending or replaying credential writes', async (t) => {
  const calls: string[] = []
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload) {
      calls.push(JSON.stringify({ endpoint, payload }))
      throw new Error('transport-lost')
    },
  })
  t.after(() => model.dispose())
  const changes = { REF: 'discard-canary' }
  await assert.rejects(
    model.saveConfiguration(
      'workspace',
      {
        generation: 'host',
        fingerprint: 'runtime',
        backends: [],
      },
      { backend: 'duckdb', fields: { name: 'db', password_env: 'REF' } },
      undefined,
      undefined,
      changes,
    ),
  )
  assert.equal(calls.length, 1)
  assert.doesNotMatch(JSON.stringify(calls), /discard-canary/)
  assert.deepEqual(changes, {})
})

test('manually choosing a configured reference never silently overwrites a shared credential', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD', 'existing-canary')
  f.bridge.create = async () => ({ name: 'warehouse' })
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const handler = channels.get('/dsh-data-analysis-credentials')!
  const model = new CredentialClientModel({
    call: async (_channel, endpoint, payload, signal) => handler(endpoint, payload, signal!),
  })
  t.after(() => model.dispose())
  await model.show('workspace')
  const changes = { DB_PASSWORD: 'replacement-canary' }
  await assert.rejects(
    model.saveConfiguration(
      'workspace',
      {
        generation: f.service.generation,
        fingerprint: f.bridge.binding.fingerprint,
        backends: [],
      },
      { backend: 'duckdb', fields: { name: 'warehouse', password_env: 'DB_PASSWORD' } },
      undefined,
      undefined,
      changes,
    ),
    /未覆盖已有凭证/,
  )
  assert.equal(f.store.calls.set, 0)
  assert.equal(f.tests, 0)
  assert.deepEqual(changes, {})
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /canary/)
})
