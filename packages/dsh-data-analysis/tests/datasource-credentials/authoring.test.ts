import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { context, finish, fixture } from './fixtures.ts'

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
