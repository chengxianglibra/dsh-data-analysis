import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { MarivoDatasourceBridge } from '../../src/datasource/bridge.ts'
import { registerCredentialRpc } from '../../src/datasource/rpc.ts'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { context, finish, fixture } from './fixtures.ts'

test('invalid references reach the creation form as safe actionable errors before any write', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  let runs = 0
  const bridge = new MarivoDatasourceBridge({
    binding: f.bridge.binding,
    status: 'ready',
    async runChecked() {
      runs++
      throw new Error('invalid references must not execute Python')
    },
  } satisfies MarivoCheckedRunner)
  const { connection, channels } = createConnectionFixture()
  const unregister = registerCredentialRpc(connection, f.service, async () => bridge)
  const handler = channels.get('/dsh-data-analysis-credentials')!
  t.after(unregister)
  const model = new CredentialClientModel({
    call: async (_channel, endpoint, payload, signal) => handler(endpoint, payload, signal!),
  })
  t.after(() => model.dispose())
  for (const reference of [
    '9private-canary',
    'MARIVO_PRIVATE',
    'DSH_HOME',
    'DSH_DATA_ANALYSIS_PRIVATE',
    { password: 123 },
  ]) {
    const input = {
      backend: 'clickhouse',
      fields: { name: 'warehouse', host: 'localhost', password_env: reference },
    }
    const response = await handler(
      'create-datasource',
      {
        workspaceId: 'workspace',
        generation: f.service.generation,
        fingerprint: bridge.binding.fingerprint,
        ...input,
      },
      f.controller.signal,
    )
    assert.deepEqual(response, {
      ok: false,
      error: { code: 'internal', message: 'datasource-credential-ref-invalid', details: {} },
    })
    await assert.rejects(
      model.createDatasource(
        'workspace',
        {
          generation: f.service.generation,
          fingerprint: bridge.binding.fingerprint,
          backends: [],
        },
        input,
      ),
      (error: Error) => {
        assert.match(error.message, /凭证引用名称无效/)
        assert.match(error.message, /实际用户名和密码/)
        assert.doesNotMatch(error.message, /9private-canary|提交结果未确认|凭证操作失败/)
        return true
      },
    )
  }
  assert.equal(runs, 0)
  assert.deepEqual(f.store.calls, { resolve: 0, set: 0, unset: 0 })
})

test('unconfirmed creation is not replayed and still asks the user to refresh', async (t) => {
  for (const transportFailure of [false, true]) {
    let calls = 0
    const model = new CredentialClientModel({
      async call() {
        calls++
        if (transportFailure) throw new Error('connection-lost')
        return { ok: false, error: { message: 'credential-operation-failed' } }
      },
    })
    t.after(() => model.dispose())
    await assert.rejects(
      model.createDatasource(
        'workspace',
        {
          generation: 'host',
          fingerprint: 'runtime',
          backends: [],
        },
        { backend: 'duckdb', fields: { name: 'created' } },
      ),
      /提交结果未确认.*刷新列表/,
    )
    assert.equal(calls, 1)
  }
})

test('adding one credential saves without testing incomplete datasource credentials', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.description.refs.push('DB_USER')
  f.description.fields.user = 'DB_USER'
  const view = await context(f)
  const changes = { DB_PASSWORD: 'credential-canary' }
  const id = randomUUID()
  f.service.start({
    generation: f.service.generation,
    id,
    scope: view.token,
    version: view.version,
    action: 'save',
    changes,
  })
  const result = await finish(f, id, view.token)
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(result.saved, ['DB_PASSWORD'])
  assert.equal(result.result, undefined)
  assert.equal(f.tests, 0)
  assert.doesNotMatch(JSON.stringify(result), /credential-canary/)
  const refreshed = await context(f)
  assert.equal(refreshed.credentials.DB_PASSWORD?.configured, true)
  assert.equal(refreshed.credentials.DB_USER?.configured, false)
})

test('datasource creation checks Host and Runtime identity before writing', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  let writes = 0
  f.bridge.create = async () => {
    writes++
    return { name: 'created' }
  }
  const input = { backend: 'duckdb', fields: { name: 'created' } }
  const create = (generation: string, fingerprint: string) =>
    f.service.createDatasource(generation, fingerprint, input, f.resolve, f.controller.signal)
  await assert.rejects(create(randomUUID(), f.bridge.binding.fingerprint), /context-changed/)
  await assert.rejects(create(f.service.generation, 'other-runtime'), /context-changed/)
  assert.equal(writes, 0)
  assert.deepEqual(await create(f.service.generation, f.bridge.binding.fingerprint), {
    name: 'created',
  })
  assert.equal(writes, 1)
  f.bridge.create = async () => ({ error: 'datasource-already-exists' })
  await assert.rejects(
    create(f.service.generation, f.bridge.binding.fingerprint),
    /datasource-already-exists/,
  )
})

test('late datasource creation does not select or refresh another Workspace', async (t) => {
  let complete!: (value: unknown) => void
  const reads: string[] = []
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload) {
      if (endpoint === 'create-datasource')
        return new Promise((resolve) => {
          complete = resolve
        })
      assert.equal(endpoint, 'overview')
      reads.push((payload as { workspaceId: string }).workspaceId)
      return { ok: true, value: { generation: 'host', datasources: [] } }
    },
  })
  t.after(() => model.dispose())
  model.show('A')
  const pending = model.createDatasource(
    'A',
    { generation: 'host', fingerprint: 'runtime', backends: [] },
    { backend: 'duckdb', fields: { name: 'created' } },
  )
  model.show('B')
  complete({ ok: true, value: { name: 'created' } })
  await pending
  assert.equal(model.getSnapshot().workspaceId, 'B')
  assert.deepEqual(reads, ['A', 'B'])
})
