import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { registerCredentialRpc } from '../../src/datasource/rpc.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { barrier, failed, finish, fixture, operation } from './fixtures.ts'

async function pending(f: ReturnType<typeof fixture>) {
  for (;;) {
    const request = f.service
      .watch('session')
      .configurationRequests.find((r) => r.endedAt === undefined)
    if (request) return request
    await f.service.waitWatch(
      'session',
      f.service.watch('session').cursor,
      AbortSignal.timeout(5000),
    )
  }
}

test('configuration starts without a datasource, waits through failure, and returns only verified identity', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  let settled = false
  const task = f.service
    .configure(f.exec, f.resolve, { mode: 'create', reason: '分析 orders 表' })
    .then((result) => {
      settled = true
      return result
    })
  const request = await pending(f)
  assert.equal(request.context, undefined)
  assert.equal(settled, false)
  const selected = await f.service.selectConfiguration(
    request.id,
    'workspace',
    'warehouse',
    f.resolve,
    f.controller.signal,
  )
  assert.ok(selected.context)
  f.setResult(failed)
  await operation(f, selected.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'private-config-canary' },
  })
  assert.equal(settled, false)
  assert.equal(f.service.watch('session').configurationRequests[0]?.status, 'awaiting-decision')
  const current = f.service.watch('session').configurationRequests[0]!.context!
  f.setResult({ name: 'warehouse', ok: true, latency_ms: 3, failure: null, repair: null })
  await operation(f, current, 'submit', { requestId: request.id })
  assert.deepEqual(await task, { status: 'ok', name: 'warehouse', latency_ms: 3 })
  assert.doesNotMatch(JSON.stringify(f.service.watch('session')), /private-config-canary/)
  assert.throws(
    () =>
      f.service.start({
        generation: f.service.generation,
        id: randomUUID(),
        scope: current.token,
        version: current.version,
        action: 'submit',
        requestId: request.id,
      }),
    /call-ended/,
  )
})

test('cancellation and headless/subagent configuration do not resume as success', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'missing source' })
  const request = await pending(f)
  f.service.cancelRequest(request.id)
  assert.deepEqual(await task, { status: 'cancelled' })
  assert.equal(
    f.controller.signal.aborted,
    false,
    'configuration cancellation is a tool result, not cancellation of the whole agent',
  )
  await assert.rejects(
    f.service.selectConfiguration(
      request.id,
      'workspace',
      'warehouse',
      f.resolve,
      f.controller.signal,
    ),
    /call-ended/,
  )
  Reflect.set(f.agent.session.header, 'origin', 'subagent')
  assert.deepEqual(
    await f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'missing source' }),
    { status: 'needs-configuration' },
  )
  const headless = fixture()
  t.after(() => headless.service.close())
  assert.deepEqual(
    await headless.service.configure(headless.exec, headless.resolve, {
      mode: 'edit',
      name: 'warehouse',
      reason: 'repair',
    }),
    { status: 'needs-configuration', name: 'warehouse' },
  )
})

test('edit requests cannot change targets; selecting after update rebinds to fresh definition and credentials', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const task = f.service.configure(f.exec, f.resolve, {
    mode: 'edit',
    name: 'warehouse',
    reason: 'repair',
  })
  const request = await pending(f)
  await assert.rejects(
    f.service.selectConfiguration(request.id, 'workspace', 'other', f.resolve, f.controller.signal),
    /datasource-identity-fixed/,
  )
  const before = await f.service.selectConfiguration(
    request.id,
    'workspace',
    'warehouse',
    f.resolve,
    f.controller.signal,
  )
  f.description.definition = 'new-definition'
  const after = await f.service.selectConfiguration(
    request.id,
    'workspace',
    'warehouse',
    f.resolve,
    f.controller.signal,
  )
  assert.notEqual(after.context!.token, before.context!.token)
  assert.throws(
    () =>
      f.service.start({
        generation: f.service.generation,
        id: randomUUID(),
        scope: before.context!.token,
        version: before.context!.version,
        action: 'submit',
        requestId: request.id,
      }),
    /call-ended/,
  )
  f.service.cancelRequest(request.id)
  await task
})

test('definition changes during test cannot finish configuration; context changes terminate unattached requests', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'configure' })
  const request = await pending(f)
  const selected = await f.service.selectConfiguration(
    request.id,
    'workspace',
    'warehouse',
    f.resolve,
    f.controller.signal,
  )
  const entered = barrier(),
    release = barrier()
  f.bridge.test = async () => {
    entered.release()
    await release.promise
    return { name: 'warehouse', ok: true, latency_ms: 1, failure: null, repair: null }
  }
  const id = randomUUID()
  f.service.start({
    generation: f.service.generation,
    id,
    scope: selected.context!.token,
    version: selected.context!.version,
    action: 'submit',
    requestId: request.id,
  })
  await entered.promise
  await assert.rejects(
    f.service.selectConfiguration(
      request.id,
      'workspace',
      'warehouse',
      f.resolve,
      f.controller.signal,
    ),
    /operation-busy/,
  )
  f.description.definition = 'changed'
  release.release()
  await finish(f, id, selected.context!.token)
  assert.deepEqual(await task, { status: 'context-changed' })
  const next = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'configure' })
  await pending(f)
  Reflect.set(f.agent.session.header, 'cwd', '/another-workspace')
  await f.service.waitWatch('session', undefined, f.controller.signal)
  assert.deepEqual(await next, { status: 'context-changed' })
})

test('closed agent releases pending configuration; diagnostic handoff is explicitly unsuccessful', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'configure' })
  const request = await pending(f)
  const selected = await f.service.selectConfiguration(
    request.id,
    'workspace',
    'warehouse',
    f.resolve,
    f.controller.signal,
  )
  f.setResult(failed)
  f.store.put('DB_PASSWORD')
  await operation(f, selected.context!, 'submit', { requestId: request.id })
  await operation(f, selected.context!, 'diagnose', { requestId: request.id })
  assert.deepEqual(await task, {
    status: 'failed',
    name: 'warehouse',
    latency_ms: null,
    failure: failed.failure,
    repair: failed.repair,
  })
  const next = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'configure' })
  await pending(f)
  f.service.disposeAgent(f.agent)
  assert.deepEqual(await next, { status: 'call-ended' })
})

test('RPC rejects a stale edit and serializes writes; configuration requests scope saves to their Runtime', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  let version = 'original',
    writes = 0
  f.bridge.update = async (input) => {
    if (input.version !== version) return { error: 'datasource-config-changed' }
    await Promise.resolve()
    writes++
    version = 'updated'
    return { name: input.name }
  }
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const rpc = channels.get('/dsh-data-analysis-credentials')!
  const input = {
    workspaceId: 'workspace',
    generation: f.service.generation,
    fingerprint: f.bridge.binding.fingerprint,
    name: 'warehouse',
    version,
    backend: 'duckdb',
    fields: { name: 'warehouse' },
  }
  const results = await Promise.all([
    rpc('update-datasource', input, f.controller.signal),
    rpc('update-datasource', input, f.controller.signal),
  ])
  assert.equal(writes, 1)
  assert.match(JSON.stringify(results), /datasource-config-changed/)
  assert.equal(results.filter((r: any) => r.ok).length, 1)
})

test('old connection history becomes stale after a definition update', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const first = (await f.service.overview('workspace', f.resolve, f.controller.signal))[0]!
  await operation(f, first, 'test')
  f.description.definition = 'updated-definition'
  const refreshed = (await f.service.overview('workspace', f.resolve, f.controller.signal))[0]!
  assert.equal(refreshed.lastTest?.stale, true)
  assert.notEqual(refreshed.token, first.token)
})

test('RPC rejects cross-Workspace configuration writes before a side effect', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  Reflect.set(f.agent.session.header, 'workspaceId', 'owner')
  let writes = 0
  f.bridge.create = async () => {
    writes++
    return { name: 'created' }
  }
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'configure' })
  const request = await pending(f)
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve))
  const rpc = channels.get('/dsh-data-analysis-credentials')!
  const result = await rpc(
    'create-datasource',
    {
      workspaceId: 'other',
      requestId: request.id,
      generation: f.service.generation,
      fingerprint: f.bridge.binding.fingerprint,
      backend: 'duckdb',
      fields: { name: 'created' },
    },
    f.controller.signal,
  )
  assert.match(JSON.stringify(result), /context-changed/)
  assert.equal(writes, 0)
  f.service.cancelRequest(request.id)
  await task
})
