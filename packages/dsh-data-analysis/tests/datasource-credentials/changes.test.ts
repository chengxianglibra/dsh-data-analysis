import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { CredentialChangesService } from '../../src/datasource/changes.ts'
import type { CredentialRevision } from '../../src/datasource/changes-contract.ts'
import { credentialChangesHost } from '../../src/datasource/changes-contract.ts'
import { fixture } from './fixtures.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function notifications() {
  const queue: Array<{ value: CredentialRevision; signal: AbortSignal }> = []
  let wake = deferred<void>()
  const controller = new AbortController()
  let accepted = 0
  return {
    get accepted() {
      return accepted
    },
    push(value: CredentialRevision, signal = controller.signal) {
      queue.push({ value, signal })
      wake.resolve()
    },
    controller,
    async *[Symbol.asyncIterator]() {
      while (!controller.signal.aborted) {
        if (!queue.length) {
          await wake.promise
          wake = deferred<void>()
          continue
        }
        yield {
          generation: 1,
          ...queue.shift()!,
          accept() {
            accepted++
          },
        }
      }
    },
    async dispose() {
      controller.abort()
      wake.resolve()
    },
  }
}

test('strict Gateway stream yields revisions only and cancellation leaves the waiting call alive', async (t) => {
  const ctx = new Context()
  new Registry(ctx)
  const f = fixture('web')
  const service = new CredentialChangesService(ctx, f.service)
  const unregister = ctx.typert.register(credentialChangesHost)
  const gateway = new Gateway(ctx, {})
  t.after(async () => {
    await service.close()
    await unregister()
    await f.service.close()
  })
  const controller = new AbortController()
  const source = await gateway.stream({
    namespace: 'dshDataAnalysisCredentials',
    method: 'changes',
    args: { sessionId: 'session' },
    signal: controller.signal,
  })
  const iterator = source[Symbol.asyncIterator]()
  const opening = await iterator.next()
  assert.deepEqual(Object.keys(opening.value as object).sort(), ['cursor', 'generation'])
  const next = iterator.next()
  const task = f.service.configure(f.exec, f.resolve, { mode: 'create', reason: 'need orders' })
  const change = await next
  assert.notEqual(
    (change.value as CredentialRevision).cursor,
    (opening.value as CredentialRevision).cursor,
  )
  assert.doesNotMatch(JSON.stringify(change.value), /DB_PASSWORD|need orders|requests/)
  const waiting = iterator.next()
  controller.abort()
  await assert.rejects(waiting)
  assert.equal(f.service.watch('session').configurationRequests[0]?.endedAt, undefined)
  await assert.rejects(
    gateway.stream({
      namespace: 'dshDataAnalysisCredentials',
      method: 'changes',
      args: { sessionId: 'session', secret: 'canary' },
    }),
  )
  f.controller.abort()
  await task
})

test('notification bursts coalesce immediate snapshots; superseded Session results never apply', async (t) => {
  const generation = randomUUID()
  const first = notifications(),
    second = notifications()
  const reads: Array<{
    payload: unknown
    signal: AbortSignal
    response: ReturnType<typeof deferred<unknown>>
  }> = []
  const model = new CredentialClientModel(
    {
      async call(_channel, endpoint, payload, signal) {
        assert.equal(endpoint, 'watch')
        assert.deepEqual(Object.keys(payload as object), ['sessionId'])
        const response = deferred<unknown>()
        reads.push({ payload, signal, response })
        return response.promise
      },
    },
    undefined,
    (sessionId) => (sessionId === 'first' ? first : second),
  )
  t.after(() => model.dispose())
  model.session('first')
  first.push({ generation, cursor: '1' })
  await tick()
  first.push({ generation, cursor: '2' })
  first.push({ generation, cursor: '3' })
  await tick()
  assert.equal(reads.length, 1)
  reads[0]!.response.resolve({ ok: true, value: { generation, cursor: '2', requests: [] } })
  await tick()
  assert.equal(reads.length, 2)
  model.session('second')
  assert.equal(reads[1]!.signal.aborted, true)
  second.push({ generation, cursor: '4' })
  await tick()
  reads[2]!.response.resolve({ ok: true, value: { generation, cursor: '4', requests: [] } })
  reads[1]!.response.resolve({ ok: true, value: { generation, cursor: '3', requests: [] } })
  await tick()
  assert.equal(model.getSnapshot().revision, '4')
  assert.equal(model.getSnapshot().sessionId, 'second')
  assert.equal(reads.length, 3)
  model.reset()
  assert.equal(second.controller.signal.aborted, true)
})

test('each new notification generation reloads its baseline even with an unchanged cursor', async (t) => {
  const feeds = [notifications(), notifications()]
  const generation = randomUUID()
  let readCount = 0,
    opens = 0
  const model = new CredentialClientModel(
    {
      async call(_channel, _endpoint, payload) {
        assert.deepEqual(payload, { sessionId: 'session' })
        readCount++
        return { ok: true, value: { generation, cursor: 'same', requests: [] } }
      },
    },
    undefined,
    () => feeds[opens++]!,
  )
  t.after(() => model.dispose())
  model.session('session')
  feeds[0]!.push({ generation, cursor: 'same' })
  await tick()
  model.reset()
  feeds[1]!.push({ generation, cursor: 'same' })
  await tick()
  assert.equal(readCount, 2)
  assert.equal(feeds[0]!.controller.signal.aborted, true)
  assert.equal(model.getSnapshot().revision, 'same')
})

test('physical reconnect and Host replacement discard the old in-flight snapshot', async () => {
  const feed = notifications()
  const old = new AbortController()
  const generation = randomUUID(),
    replacement = randomUUID()
  const reads: Array<ReturnType<typeof deferred<unknown>>> = []
  const model = new CredentialClientModel(
    {
      async call() {
        const read = deferred<unknown>()
        reads.push(read)
        return read.promise
      },
    },
    undefined,
    () => feed,
  )
  model.session('session')
  feed.push({ generation, cursor: 'old' }, old.signal)
  await tick()
  old.abort()
  feed.push({ generation: replacement, cursor: 'new' })
  reads[0]!.resolve({ ok: true, value: { generation, cursor: 'old', requests: [] } })
  await tick()
  assert.equal(model.getSnapshot().revision, undefined)
  reads[1]!.resolve({ ok: true, value: { generation: replacement, cursor: 'new', requests: [] } })
  await tick()
  assert.equal(model.getSnapshot().generation, replacement)
  assert.equal(model.getSnapshot().revision, 'new')
  await model.dispose()
  assert.equal(feed.controller.signal.aborted, true)
})

test('unchanged heartbeat revalidates without yielding; Host close drains the waiting read', async () => {
  const generation = randomUUID()
  const reads: Array<{
    cursor: string | undefined
    signal: AbortSignal
    reply: ReturnType<typeof deferred<any>>
  }> = []
  const service = new CredentialChangesService(new Context(), {
    waitWatch: async (_session, cursor, signal) => {
      const reply = deferred<any>()
      reads.push({ cursor, signal: signal!, reply })
      signal!.addEventListener(
        'abort',
        () => reply.resolve({ generation, cursor: 'same', requests: [] }),
        { once: true },
      )
      return reply.promise
    },
  })
  const iterator = service.changes('session', new AbortController().signal)[Symbol.asyncIterator]()
  const first = iterator.next()
  reads[0]!.reply.resolve({ generation, cursor: 'same', requests: [] })
  await first
  const next = iterator.next()
  reads[1]!.reply.resolve({ generation, cursor: 'same', requests: [] })
  await tick()
  assert.equal(reads.length, 3)
  assert.equal(reads[2]!.cursor, 'same')
  const rejected = assert.rejects(next)
  await service.close()
  await rejected
  assert.equal(reads[2]!.signal.aborted, true)
})

test('a transient provider failure recovers the same stream and pending call', async () => {
  const f = fixture('web')
  const task = f.service.prepareExecution(f.exec, f.resolve, ['warehouse'])
  const { waiting } = await import('./fixtures.ts')
  await waiting(f)
  const describe = f.store.describe.bind(f.store)
  let failures = 0
  f.store.describe = async (ref) => {
    if (!failures++) throw new Error('temporary provider failure')
    return describe(ref)
  }
  const service = new CredentialChangesService(new Context(), f.service)
  const iterator = service.changes('session', new AbortController().signal)[Symbol.asyncIterator]()
  try {
    const item = await iterator.next()
    assert.equal(item.done, false)
    assert.equal(f.service.watch('session').requests.length, 1)
    assert.equal(f.service.watch('session').requests[0]!.endedAt, undefined)
    assert.equal(f.store.calls.set, 0)
    assert.equal(failures, 2)
  } finally {
    await service.close()
    await iterator.return?.()
    const ended = assert.rejects(task, /call-ended/)
    f.controller.abort()
    await ended
    await f.service.close()
  }
})

test('closing a stream cancels its provider retry delay', async () => {
  const { CredentialServiceError } = await import('../../src/datasource/service.ts')
  let reads = 0
  const service = new CredentialChangesService(new Context(), {
    async waitWatch() {
      reads++
      throw new CredentialServiceError('credential-state-unavailable')
    },
  })
  const iterator = service.changes('session', new AbortController().signal)[Symbol.asyncIterator]()
  const next = assert.rejects(iterator.next())
  await tick()
  await service.close()
  await next
  assert.equal(reads, 1)
})

test('contract failures are terminal rather than retried as provider outages', async () => {
  let reads = 0
  const service = new CredentialChangesService(new Context(), {
    async waitWatch() {
      reads++
      throw new Error('private diagnostic')
    },
  })
  await assert.rejects(
    service.changes('session', new AbortController().signal)[Symbol.asyncIterator]().next(),
    /^Error: credential-notification-unavailable$/,
  )
  assert.equal(reads, 1)
  await service.close()
})

test('the native RemoteStream cannot apply a late snapshot while waiting offline', async () => {
  // Load the installed Harness implementation; model-only signal stubs miss its retry timing.
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const require = createRequire(import.meta.url)
  const base = pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway/package.json'))
  const { RemoteStream } = await import(new URL('./lib/types/client/remote-stream.js', base).href)
  const { RemoteStreamCarrierError } = await import(
    new URL('./lib/types/client/stream-client.js', base).href
  )
  const { credentialChanges } = await import('../../src/client/credentials/changes.ts')
  let host: object | undefined = {}
  const listeners = new Set<() => void>()
  const generation = {
    getSnapshot: () => host,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const broken = deferred<void>()
  const hostGeneration = randomUUID()
  let opens = 0
  const namespace = {
    async *changes(_session: string, signal: AbortSignal) {
      const n = ++opens
      yield { generation: hostGeneration, cursor: String(n) }
      if (n === 1) {
        await broken.promise
        throw new RemoteStreamCarrierError('offline')
      }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
        if (signal.aborted) resolve()
      })
    },
  }
  const ctx = {
    connection: { generation },
    remote: {
      $mount: async () => () => {},
      $stream: (options: unknown) => new RemoteStream({ generation }, options),
    },
    effect() {},
    inject(_keys: unknown, use: (ctx: unknown) => void) {
      use({ remote: { dshDataAnalysisCredentials: namespace } })
      return Object.assign(Promise.resolve(), { dispose: async () => {} })
    },
  } as unknown as Context
  const reads: Array<{ signal: AbortSignal; response: ReturnType<typeof deferred<unknown>> }> = []
  const model = new CredentialClientModel(
    {
      async call(_c, _e, _p, signal) {
        const response = deferred<unknown>()
        reads.push({ signal, response })
        return response.promise
      },
    },
    undefined,
    credentialChanges(ctx),
  )
  try {
    model.session('session')
    await tick()
    host = undefined
    for (const listener of listeners) listener()
    assert.equal(reads[0]!.signal.aborted, true, 'abort before the carrier finishes')
    broken.resolve()
    await tick()
    reads[0]!.response.resolve({
      ok: true,
      value: { generation: hostGeneration, cursor: '1', requests: [] },
    })
    await tick()
    assert.equal(model.getSnapshot().revision, undefined)
    host = {}
    for (const listener of listeners) listener()
    await tick()
    assert.equal(opens, 2)
    reads[1]!.response.resolve({
      ok: true,
      value: { generation: hostGeneration, cursor: '2', requests: [] },
    })
    await tick()
    assert.equal(model.getSnapshot().revision, '2')
  } finally {
    await model.dispose()
    assert.equal(listeners.size, 0)
  }
})
