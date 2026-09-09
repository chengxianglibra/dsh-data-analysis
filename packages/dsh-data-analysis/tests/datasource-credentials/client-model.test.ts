import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import test from 'node:test'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import type {
  CredentialContextView,
  CredentialOperationView,
  CredentialRequestView,
} from '../../src/datasource/service.ts'
import { barrier } from './fixtures.ts'

function datasource(name: string): CredentialContextView {
  return {
    token: randomUUID(),
    workspaceId: 'workspace',
    name,
    backend: 'fixture',
    properties: {},
    refs: [],
    fields: {},
    credentials: {},
    version: 'before',
  }
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function refreshFixture(t: TestContext) {
  const a = datasource('a'),
    b = datasource('b'),
    generation = randomUUID()
  const reads: Array<{
    signal?: AbortSignal
    workspaceId: string
    response: ReturnType<
      typeof deferred<{ generation: string; datasources: CredentialContextView[] }>
    >
  }> = []
  const operations: Array<{
    scope: string
    finish: () => void
  }> = []
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload, signal) {
      if (endpoint === 'overview') {
        const response = deferred<{ generation: string; datasources: CredentialContextView[] }>()
        reads.push({
          workspaceId: (payload as { workspaceId: string }).workspaceId,
          signal,
          response,
        })
        return { ok: true, value: await response.promise }
      }
      if (endpoint === 'start') return { ok: true, value: {} }
      assert.equal(endpoint, 'operation')
      const handle = payload as { id: string; scope: string },
        gate = barrier()
      operations.push({ scope: handle.scope, finish: gate.release })
      await gate.promise
      return {
        ok: true,
        value: {
          ...handle,
          action: 'test',
          status: 'succeeded',
          phase: 'settled',
          saved: [],
          errors: [],
          result: tested(handle.scope === a.token ? a : b, 2000).lastTest!.result,
        } satisfies CredentialOperationView,
      }
    },
  })
  t.after(() => model.dispose())
  model.show('workspace')
  reads[0]!.response.resolve({ generation, datasources: [a, b] })
  await nextTurn()
  return { a, b, generation, model, reads, operations }
}

function tested(context: CredentialContextView, at: number): CredentialContextView {
  return {
    ...context,
    lastTest: {
      at,
      stale: false,
      result: { name: context.name, ok: true, latency_ms: 1, failure: null, repair: null },
    },
  }
}

for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
  test(`${status} operation leaves the active list and refreshes the selected datasource in place`, async (t) => {
    const first = datasource('first'),
      selected = datasource('selected'),
      generation = randomUUID()
    const storage = new Map<string, string>()
    let completed = false,
      gate = barrier()
    const lastTest = {
      at: 1234,
      stale: false,
      result: {
        name: selected.name,
        ok: status === 'succeeded',
        latency_ms: 1,
        failure: null,
        repair: null,
      },
    }
    const model = new CredentialClientModel(
      {
        async call(_channel, endpoint, payload) {
          if (endpoint === 'overview')
            return {
              ok: true,
              value: {
                generation,
                datasources: [
                  first,
                  completed ? { ...selected, version: 'after', lastTest } : selected,
                ],
              },
            }
          if (endpoint === 'start') return { ok: true, value: {} }
          assert.equal(endpoint, 'operation')
          await gate.promise
          completed = true
          return {
            ok: true,
            value: {
              ...(payload as { id: string; scope: string }),
              action: 'test',
              status,
              phase: 'settled',
              saved: [],
              errors: [],
              result: lastTest.result,
            } satisfies CredentialOperationView,
          }
        },
      },
      {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value)
        },
        removeItem: (key) => {
          storage.delete(key)
        },
      },
    )
    t.after(() => model.dispose())
    model.show('workspace')
    await nextTurn()
    model.select(selected.token)
    const pending = model.start(selected, 'test')
    assert.equal(model.getSnapshot().operations.length, 1)
    assert.equal(storage.size, 1)
    gate.release()
    await pending
    const state = model.getSnapshot()
    assert.deepEqual(state.operations, [])
    assert.equal(state.handle, undefined)
    assert.equal(state.operation, undefined)
    assert.equal(state.outcomes[selected.token]?.operation?.status, status)
    assert.equal(state.outcomes[selected.token]?.overviewUpdated, true)
    assert.equal(state.selected, selected.token)
    assert.equal(state.datasources.find((item) => item.token === selected.token)?.version, 'after')
    assert.deepEqual(
      state.datasources.find((item) => item.token === selected.token)?.lastTest,
      lastTest,
    )
    assert.equal(storage.size, 0)

    gate = barrier()
    const retry = model.start(state.datasources[1]!, 'test')
    assert.equal(model.getSnapshot().outcomes[selected.token], undefined)
    assert.equal(model.getSnapshot().operations.length, 1)
    gate.release()
    await retry
  })
}

test('closing the panel keeps an in-flight query alive and discards its completed activity entry', async (t) => {
  const context = datasource('warehouse'),
    gate = barrier()
  let querySignal: AbortSignal | undefined,
    overviewCount = 0
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload, signal) {
      if (endpoint === 'overview') {
        overviewCount++
        return { ok: true, value: { generation: randomUUID(), datasources: [context] } }
      }
      if (endpoint === 'start') return { ok: true, value: {} }
      assert.equal(endpoint, 'operation')
      querySignal = signal
      await gate.promise
      return {
        ok: true,
        value: {
          ...(payload as { id: string; scope: string }),
          action: 'test',
          status: 'succeeded',
          phase: 'settled',
          saved: [],
          errors: [],
        } satisfies CredentialOperationView,
      }
    },
  })
  t.after(() => model.dispose())
  model.show('workspace')
  await nextTurn()
  const pending = model.start(context, 'test')
  await nextTurn()
  model.close()
  assert.equal(querySignal?.aborted, false)
  gate.release()
  await pending
  assert.equal(model.getSnapshot().open, false)
  assert.deepEqual(model.getSnapshot().operations, [])
  assert.equal(overviewCount, 1)
})

test('an unrecoverable operation after a Workspace switch does not replace the new Workspace error', async (t) => {
  const context = datasource('warehouse'),
    gate = barrier()
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload) {
      if (endpoint === 'overview') {
        if ((payload as { workspaceId: string }).workspaceId === 'other')
          return { ok: false, error: { message: 'credential-state-unavailable' } }
        return { ok: true, value: { generation: randomUUID(), datasources: [context] } }
      }
      if (endpoint === 'start') return { ok: true, value: {} }
      assert.equal(endpoint, 'operation')
      await gate.promise
      return { ok: true, value: null }
    },
  })
  t.after(() => model.dispose())
  await model.selectWorkspace('workspace')
  const pending = model.start(context, 'test')
  await model.selectWorkspace('other')
  const error = model.getSnapshot().error
  assert.match(error, /暂时无法读取凭证状态/)
  gate.release()
  await pending
  assert.equal(model.getSnapshot().workspaceId, 'other')
  assert.equal(model.getSnapshot().error, error)
  assert.match(model.getSnapshot().outcomes[context.token]!.error!, /保存可能已经发生/)
  assert.deepEqual(model.getSnapshot().operations, [])
})

test('background completion refreshes datasource results without clearing or changing the selected form', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const snapshots: Array<{ selected: string; count: number; version?: string }> = []
  model.subscribe(() => {
    const state = model.getSnapshot()
    snapshots.push({
      selected: state.selected,
      count: state.datasources.length,
      version: state.datasources.find((context) => context.token === a.token)?.version,
    })
  })
  const pending = model.start(b, 'test')
  await nextTurn()
  operations[0]!.finish()
  await nextTurn()
  assert.equal(reads.length, 2)
  reads[1]!.response.resolve({ generation, datasources: [a, tested(b, 2000)] })
  await pending
  assert(snapshots.every((state) => state.selected === a.token && state.count === 2))
  assert(snapshots.every((state) => state.version === a.version))
  model.select(b.token)
  assert.equal(
    model.getSnapshot().datasources.find((context) => context.token === b.token)?.lastTest?.at,
    2000,
  )
})

test('a passive overview cannot replace a datasource after a newer operation starts', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const first = model.start(b, 'test')
  await nextTurn()
  operations[0]!.finish()
  await nextTurn()
  const second = model.start(b, 'test')
  await nextTurn()
  model.select(b.token)
  reads[1]!.response.resolve({ generation, datasources: [a, tested(b, 1000)] })
  await first
  assert.equal(model.getSnapshot().selected, b.token)
  assert.equal(model.getSnapshot().datasources[1]?.lastTest, undefined)
  assert.equal(model.getSnapshot().operations.length, 1)
  operations[1]!.finish()
  await nextTurn()
  reads[2]!.response.resolve({ generation, datasources: [a, tested(b, 2000)] })
  await second
  assert.equal(model.getSnapshot().datasources[1]?.lastTest?.at, 2000)
})

test('concurrent completion overviews settle in request order without allowing a late older result', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const runA = model.start(a, 'test'),
    runB = model.start(b, 'test')
  await nextTurn()
  operations[0]!.finish()
  await nextTurn()
  operations[1]!.finish()
  await nextTurn()
  assert.equal(reads[1]!.signal?.aborted, true)
  model.select(b.token)
  reads[2]!.response.resolve({ generation, datasources: [tested(a, 2000), tested(b, 3000)] })
  await runB
  reads[1]!.response.resolve({ generation, datasources: [tested(a, 1000), b] })
  await runA
  assert.equal(model.getSnapshot().selected, b.token)
  assert.deepEqual(
    model.getSnapshot().datasources.map((context) => context.lastTest?.at),
    [2000, 3000],
  )
})

test('Workspace switches reject late passive replies and returning overviews prune replaced context outcomes', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const pending = model.start(b, 'test')
  await nextTurn()
  operations[0]!.finish()
  await nextTurn()
  const other = { ...datasource('other'), workspaceId: 'other' }
  const switched = model.selectWorkspace('other')
  reads[2]!.response.resolve({ generation, datasources: [other] })
  await switched
  reads[1]!.response.resolve({ generation, datasources: [a, tested(b, 2000)] })
  await pending
  assert.equal(model.getSnapshot().workspaceId, 'other')
  assert.equal(model.getSnapshot().selected, other.token)
  assert.equal(model.getSnapshot().outcomes[b.token]?.workspaceId, 'workspace')
  const returned = model.selectWorkspace('workspace')
  reads[3]!.response.resolve({ generation, datasources: [a, { ...b, token: randomUUID() }] })
  await returned
  assert.equal(model.getSnapshot().outcomes[b.token], undefined)
})

test('passive refresh rejects a changed Host generation and explicit overview clears old-generation outcomes', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const pending = model.start(b, 'test'),
    nextGeneration = randomUUID()
  await nextTurn()
  operations[0]!.finish()
  await nextTurn()
  reads[1]!.response.resolve({ generation: nextGeneration, datasources: [a, tested(b, 2000)] })
  await pending
  assert.equal(model.getSnapshot().generation, generation)
  assert.equal(model.getSnapshot().datasources[1]?.lastTest, undefined)
  assert(model.getSnapshot().outcomes[b.token])
  assert.equal(model.getSnapshot().outcomes[b.token]?.overviewUpdated, undefined)
  const refresh = model.selectWorkspace('workspace')
  reads[2]!.response.resolve({ generation: nextGeneration, datasources: [a, b] })
  await refresh
  assert.equal(model.getSnapshot().generation, nextGeneration)
  assert.deepEqual(model.getSnapshot().outcomes, {})
})

test('a failed passive refresh leaves the operation result unconfirmed until a later authoritative overview', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const pending = model.start(b, 'test')
  await nextTurn()
  operations[0]!.finish()
  await nextTurn()
  reads[1]!.response.reject(new Error('offline'))
  await pending
  assert.equal(model.getSnapshot().outcomes[b.token]?.overviewUpdated, undefined)
  assert.equal(model.getSnapshot().outcomes[b.token]?.operation?.result?.ok, true)
  const refresh = model.selectWorkspace('workspace')
  reads[2]!.response.resolve({ generation, datasources: [a, tested(b, 2000)] })
  await refresh
  assert.equal(model.getSnapshot().outcomes[b.token]?.overviewUpdated, true)
  assert.equal(model.getSnapshot().datasources[1]?.lastTest?.at, 2000)
})

test('an overview begun before operation completion cannot confirm that later result', async (t) => {
  const { a, b, generation, model, reads, operations } = await refreshFixture(t)
  const refresh = model.selectWorkspace('workspace')
  const pending = model.start(b, 'test')
  await nextTurn()
  operations[0]!.finish()
  await pending
  reads[1]!.response.resolve({ generation, datasources: [a, b] })
  await refresh
  assert.equal(model.getSnapshot().outcomes[b.token]?.overviewUpdated, undefined)
  assert.equal(model.getSnapshot().outcomes[b.token]?.operation?.result?.ok, true)
})

test('a failed prompt operation leaves the pending request available for correction and cancellation', async (t) => {
  const context = datasource('warehouse')
  const request: CredentialRequestView = {
    id: randomUUID(),
    sessionId: 'session',
    context,
    status: 'awaiting-decision',
  }
  const generation = randomUUID(),
    cancellations: unknown[] = []
  let watchCount = 0,
    overviewCount = 0
  const model = new CredentialClientModel({
    async call(_channel, endpoint, payload, signal) {
      if (endpoint === 'watch') {
        if (watchCount++ > 0)
          await new Promise<void>((resolve) =>
            signal?.addEventListener('abort', () => resolve(), { once: true }),
          )
        return { ok: true, value: { generation, cursor: '1', requests: [request] } }
      }
      if (endpoint === 'overview') overviewCount++
      if (endpoint === 'start') return { ok: true, value: {} }
      if (endpoint === 'cancel-request') {
        cancellations.push(payload)
        return { ok: true, value: {} }
      }
      assert.equal(endpoint, 'operation')
      return {
        ok: true,
        value: {
          ...(payload as { id: string; scope: string }),
          action: 'submit',
          status: 'failed',
          phase: 'settled',
          saved: [],
          errors: ['credential-missing'],
        } satisfies CredentialOperationView,
      }
    },
  })
  t.after(() => model.dispose())
  model.session('session')
  await nextTurn()
  await model.start(context, 'submit')
  assert.deepEqual(model.getSnapshot().operations, [])
  assert.equal(model.getSnapshot().requestId, request.id)
  assert.equal(model.getSnapshot().requests[0]?.status, 'awaiting-decision')
  assert.equal(model.getSnapshot().open, true)
  assert.equal(overviewCount, 0)
  await model.cancelRequest(request.id)
  assert.deepEqual(cancellations, [{ requestId: request.id }])
})

test('datasource Tab handoff preserves the selected datasource in the operation container', async (t) => {
  const first = datasource('first'),
    selected = datasource('selected')
  const model = new CredentialClientModel({
    call: async () => ({ ok: true, value: { generation: 'test', datasources: [first, selected] } }),
  })
  t.after(() => model.dispose())
  model.show('workspace', selected.token)
  await nextTurn()
  assert.equal(model.getSnapshot().selected, selected.token)
  assert.equal(model.getSnapshot().open, true)
  model.close()
  assert.equal(model.getSnapshot().selected, selected.token)
})
