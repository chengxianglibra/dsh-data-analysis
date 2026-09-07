import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { marivoCredentialStorageRef } from '../../src/datasource/shell-env.ts'
import { barrier, context, failed, finish, fixture, operation, waiting } from './fixtures.ts'

test('missing Web test stays pending, submit validates once and settles the original call', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  let settled = false
  const pending = f.service.prepare('test', f.exec, f.resolve, 'warehouse').then((value) => {
    settled = true
    return value
  })
  const request = await waiting(f)
  assert.equal(settled, false)
  assert.equal(f.tests, 0)
  assert.equal(f.store.calls.resolve, 0)
  const op = await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'submitted-canary' },
  })
  assert.equal(op.status, 'succeeded')
  assert.equal(f.tests, 1)
  assert.equal('ok' in (await pending) && ((await pending) as { ok: boolean }).ok, true)
  assert.equal(f.service.watch('session').requests[0]?.status, 'succeeded')
  assert.doesNotMatch(JSON.stringify(f.service.watch('session')), /submitted-canary/)
})
test('execution after missing form verifies once before returning a fresh snapshot', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const pending = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const request = await waiting(f)
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'submitted-canary' },
  })
  const prepared = await pending
  assert('status' in prepared && prepared.status === 'ready')
  assert.equal(f.tests, 1)
  assert.equal(f.store.calls.resolve, 2)
  prepared.release()
})
test('configured connection failures return directly, while form failures retain correction and diagnose', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  f.setResult(failed)
  f.store.put('DB_PASSWORD')
  assert.deepEqual(await f.service.prepare('test', f.exec, f.resolve, 'warehouse'), failed)
  assert.equal(f.service.watch('session').requests.length, 0)
  f.store.values.clear()
  const pending = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const request = await waiting(f)
  const op = await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'wrong-value' },
  })
  assert.deepEqual(op.result, failed)
  assert.deepEqual(op.saved, ['DB_PASSWORD'])
  const current = f.service.watch('session').requests[0]!
  assert.equal(current.status, 'awaiting-decision')
  await operation(f, current.context, 'diagnose', { requestId: request.id })
  assert.deepEqual(await pending, failed)
  assert.equal(f.tests, 2)
})
test('outer cancellation ends pending calls; a disconnected watch does not cancel them', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const pending = f.service.prepare('test', f.exec, f.resolve, 'warehouse')
  const rejection = assert.rejects(pending, /call-ended/)
  const request = await waiting(f)
  const watch = new AbortController()
  const read = f.service.waitWatch('session', f.service.watch('session').cursor, watch.signal)
  watch.abort()
  await assert.rejects(read)
  assert.equal(f.service.watch('session').requests[0]?.endedAt, undefined)
  f.controller.abort()
  await rejection
  assert.throws(
    () =>
      f.service.start({
        generation: f.service.generation,
        id: randomUUID(),
        scope: request.context.token,
        version: request.context.version,
        action: 'submit',
        requestId: request.id,
      }),
    /call-ended/,
  )
})
test('subagents never enter interactive waits', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  Object.assign(f.agent.session.header, { origin: 'subagent' })
  assert.equal('status' in (await f.service.prepare('test', f.exec, f.resolve, 'warehouse')), true)
  assert.equal(f.service.watch('session').requests.length, 0)
})
test('operation IDs deduplicate writes and tests, reject mismatched scope, and expire explicitly', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const view = await context(f),
    id = randomUUID()
  const input = {
    generation: f.service.generation,
    id,
    scope: view.token,
    version: view.version,
    action: 'update' as const,
    changes: { DB_PASSWORD: 'first-value' },
  }
  f.service.start(input)
  f.service.start({ ...input, changes: { DB_PASSWORD: 'must-not-overwrite' } })
  await finish(f, id, view.token)
  assert.equal(f.store.calls.set, 1)
  assert.equal(f.tests, 1)
  assert.equal(f.store.values.get(marivoCredentialStorageRef('DB_PASSWORD')), 'first-value')
  assert.throws(() => f.service.start({ ...input, action: 'test' }), /operation-scope-mismatch/)
  f.advance(1_800_000)
  assert.equal(f.service.operation(f.service.generation, id, view.token), undefined)
  assert.equal(f.service.operation('old-generation', id, view.token), undefined)
})
test('partial saves retain successful values, never validate, and do not expose provider messages', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.description.refs.push('DB_USER')
  f.description.fields.user = 'DB_USER'
  f.store.fail = marivoCredentialStorageRef('DB_USER')
  const op = await operation(f, await context(f), 'update', {
    changes: { DB_PASSWORD: 'safe-canary', DB_USER: 'other-canary' },
  })
  assert.equal(op.status, 'failed')
  assert.deepEqual(op.saved, ['DB_PASSWORD'])
  assert.equal(f.tests, 0)
  assert.doesNotMatch(JSON.stringify(op), /unsafe-provider|safe-canary|other-canary/)
})
test('deletion re-describes actual fallback, and readonly errors do not imply missing credentials', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  f.store.readonly = true
  const op = await operation(f, await context(f), 'delete', { reference: 'DB_PASSWORD' })
  assert.equal(op.status, 'failed')
  assert.equal((await context(f)).credentials.DB_PASSWORD?.configured, true)
  f.store.readonly = false
  await operation(f, await context(f), 'delete', { reference: 'DB_PASSWORD' })
  assert.equal((await context(f)).credentials.DB_PASSWORD?.configured, false)
})
test('stale definition and context writes fail before credential mutation', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const view = await context(f)
  f.description.definition = 'e'.repeat(64)
  const op = await operation(f, view, 'update', { changes: { DB_PASSWORD: 'must-not-save' } })
  assert.equal(op.status, 'failed')
  assert.equal(f.store.calls.set, 0)
})
test('definition change during validation cannot continue an old call', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const gate = barrier(),
    entered = barrier()
  f.bridge.test = async () => {
    entered.release()
    await gate.promise
    return { ...failed, ok: true, failure: null, repair: null }
  }
  const pending = f.service.prepare('test', f.exec, f.resolve, 'warehouse')
  const rejected = assert.rejects(pending, /context-changed/)
  const request = await waiting(f)
  const completion = operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'value' },
  })
  await entered.promise
  f.description.definition = 'e'.repeat(64)
  gate.release()
  assert.equal((await completion).status, 'failed')
  await rejected
})
test('management cancel preserves completed saves and waits for its test to stop', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const entered = barrier()
  f.bridge.test = async (_name, _values, signal) => {
    entered.release()
    await new Promise<void>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
    })
    return failed
  }
  const view = await context(f),
    id = randomUUID()
  f.service.start({
    generation: f.service.generation,
    id,
    scope: view.token,
    action: 'update',
    version: view.version,
    changes: { DB_PASSWORD: 'persisted-value' },
  })
  await entered.promise
  f.service.cancelOperation(f.service.generation, id, view.token)
  const op = await finish(f, id, view.token)
  assert.equal(op.status, 'cancelled')
  assert.deepEqual(op.saved, ['DB_PASSWORD'])
})

test('external credential updates refresh a pending form without replaying its call', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const pending = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const request = await waiting(f)
  f.store.put('DB_PASSWORD')
  f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
  const snapshot = await f.service.waitWatch('session', undefined, f.controller.signal)
  const refreshed = snapshot.requests.find((r) => r.id === request.id)!
  assert.notEqual(refreshed.context.version, request.context.version)
  assert.equal(refreshed.context.credentials.DB_PASSWORD?.configured, true)
  await operation(f, refreshed.context, 'submit', { requestId: request.id })
  const prepared = await pending
  assert('status' in prepared && prepared.status === 'ready')
  prepared.release()
})

test('service disposal waits for an aborted foreground test to finish cleanup', async () => {
  const f = fixture()
  f.store.put('DB_PASSWORD')
  const entered = barrier(),
    cleaned = barrier()
  f.bridge.test = async (_name, _values, signal) => {
    entered.release()
    await new Promise<void>((resolve) =>
      signal!.addEventListener('abort', () => resolve(), { once: true }),
    )
    await cleaned.promise
    signal!.throwIfAborted()
    return failed
  }
  const pending = f.service.track(f.service.prepare('test', f.exec, f.resolve, 'warehouse'))
  const rejected = assert.rejects(pending)
  await entered.promise
  let closed = false
  const closing = f.service.close().then(() => {
    closed = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  cleaned.release()
  await closing
  await rejected
})

test('test dispatch retains its admitted definition when the live definition changes', async (t) => {
  const { MarivoDatasourceBridge } = await import('../../src/datasource/bridge.ts')
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const admitted = f.description.definition
  let granted: string | undefined
  const bridge = new MarivoDatasourceBridge({
    binding: f.bridge.binding,
    status: 'ready',
    runChecked: async (request) => {
      assert(request.stdin, 'dispatch must not mint a new grant from another describe call')
      granted = JSON.parse(request.stdin).grants.warehouse.definition
      return {
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(JSON.stringify({ ...failed, ok: true, failure: null, repair: null })),
      }
    },
  })
  f.bridge.test = async (description, values, signal) => {
    f.description.definition = 'e'.repeat(64)
    return bridge.test(description, values, signal)
  }
  await assert.rejects(f.service.prepare('test', f.exec, f.resolve, 'warehouse'), /context-changed/)
  assert.equal(granted, admitted)
})

test('external updates during a direct test reject mixed snapshots without management', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.description.refs = ['DB_PASSWORD', 'DB_USER']
  f.description.fields = { password: 'DB_PASSWORD', user: 'DB_USER' }
  f.store.put('DB_PASSWORD', 'old-password')
  f.store.put('DB_USER', 'old-user')
  const resolve = f.store.resolve.bind(f.store)
  f.store.resolve = async (ref) => {
    const result = await resolve(ref)
    if (ref === marivoCredentialStorageRef('DB_PASSWORD')) {
      f.store.put('DB_PASSWORD', 'new-password')
      f.store.put('DB_USER', 'new-user')
      for (const name of f.description.refs)
        f.service.invalidateStorageRef(marivoCredentialStorageRef(name))
    }
    return result
  }
  await assert.rejects(
    f.service.prepare('test', f.exec, f.resolve, 'warehouse'),
    /credentials-changed/,
  )
  assert.equal(f.tests, 0)
  f.store.resolve = resolve
  assert.equal('ok' in (await f.service.prepare('test', f.exec, f.resolve, 'warehouse')), true)
  // Settled tests retain ref provenance so management history observes later rotations.
  f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
  assert.equal((await context(f)).lastTest?.stale, true)
})

test('external updates during a direct connection test invalidate its result', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  f.bridge.test = async () => {
    f.store.put('DB_PASSWORD', 'rotated')
    f.service.invalidateStorageRef(marivoCredentialStorageRef('DB_PASSWORD'))
    return { ...failed, ok: true, failure: null, repair: null }
  }
  await assert.rejects(
    f.service.prepare('test', f.exec, f.resolve, 'warehouse'),
    /credentials-changed/,
  )
  assert.equal((await context(f)).lastTest, undefined)
})
