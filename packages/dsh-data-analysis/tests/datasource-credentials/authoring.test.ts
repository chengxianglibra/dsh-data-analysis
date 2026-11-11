import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
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
  assert.equal(f.tests, 0)
  assert.doesNotMatch(JSON.stringify(result), /credential-canary/)
  const refreshed = await context(f)
  assert.equal(refreshed.credentials.DB_PASSWORD?.configured, true)
  assert.equal(refreshed.credentials.DB_USER?.configured, false)
})
