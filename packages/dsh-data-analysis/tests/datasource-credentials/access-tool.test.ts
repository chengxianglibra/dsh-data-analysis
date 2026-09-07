import assert from 'node:assert/strict'
import test from 'node:test'
import { context, fixture, operation } from './fixtures.ts'

test('access authorizes Python without testing or resolving values; each execution resolves fresh', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const result = await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  assert.equal('status' in result && result.status, 'ok')
  assert.equal(f.tests, 0)
  assert.equal(f.store.calls.resolve, 0)
  const first = await f.service.claim(f.exec, f.resolve, ['warehouse'])
  assert.equal(first.values.DB_PASSWORD, 'canary-private-4826')
  f.store.put('DB_PASSWORD', 'rotated-value')
  assert.equal(
    (await f.service.claim(f.exec, f.resolve, ['warehouse'])).values.DB_PASSWORD,
    'rotated-value',
  )
  assert.doesNotMatch(JSON.stringify(result), /canary|prelude|token|shell_lease/)
})
test('missing credentials do not grant access; noninteractive calls return bounded refs', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  assert.deepEqual(await f.service.prepare('access', f.exec, f.resolve, 'warehouse'), {
    status: 'needs-credentials',
    name: 'warehouse',
    refs: ['DB_PASSWORD'],
  })
  await assert.rejects(f.service.claim(f.exec, f.resolve, ['warehouse']), /access-required/)
})
test('the 64th execution succeeds and the 65th requires renewal; TTL and Agent ownership are enforced', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  await assert.rejects(
    f.service.claim({ ...f.exec, agent: { ...f.agent } }, f.resolve, ['warehouse']),
    /access-required/,
  )
  for (let i = 0; i < 64; i++) await f.service.claim(f.exec, f.resolve, ['warehouse'])
  await assert.rejects(f.service.claim(f.exec, f.resolve, ['warehouse']), /access-required/)
  await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  f.advance(1_800_000)
  await assert.rejects(f.service.claim(f.exec, f.resolve, ['warehouse']), /access-required/)
})
test('definition and Workspace changes reject old access even with unchanged refs', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  f.description.definition = 'e'.repeat(64)
  await assert.rejects(f.service.claim(f.exec, f.resolve, ['warehouse']), /access-required/)
  await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  const changed = async () => ({
    ...f.bridge,
    binding: { ...f.bridge.binding, fingerprint: 'changed' },
  })
  await assert.rejects(f.service.claim(f.exec, changed, ['warehouse']), /access-required/)
})
test('management test preserves access, but replacement revokes shared access', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  const view = await context(f)
  assert.equal((await operation(f, view, 'test')).status, 'succeeded')
  await f.service.claim(f.exec, f.resolve, ['warehouse'])
  assert.equal(
    (await operation(f, view, 'update', { changes: { DB_PASSWORD: 'next-value' } })).status,
    'succeeded',
  )
  await assert.rejects(f.service.claim(f.exec, f.resolve, ['warehouse']), /access-required/)
})
test('explicit test revokes previous access and query-independent execution needs no secret', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  await f.service.prepare('access', f.exec, f.resolve, 'warehouse')
  await f.service.prepare('test', f.exec, f.resolve, 'warehouse')
  await assert.rejects(f.service.claim(f.exec, f.resolve, ['warehouse']), /access-required/)
  assert.deepEqual((await f.service.claim(f.exec, f.resolve, [])).values, {})
})
