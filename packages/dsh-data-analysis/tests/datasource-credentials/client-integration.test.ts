import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { translator } from './../../src/client/i18n/copy.ts'
import { context, fixture } from './fixtures.ts'

test('lost submit response queries the preallocated operation ID; secrets never enter storage or state', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const view = await context(f),
    calls: string[] = [],
    storage = new Map<string, string>()
  let id = ''
  const model = new CredentialClientModel(
    {
      async call(_channel, endpoint, payload) {
        calls.push(endpoint)
        if (endpoint === 'overview')
          return { ok: true, value: { generation: f.service.generation, datasources: [view] } }
        if (endpoint === 'start') {
          id = (payload as { id: string }).id
          throw new Error('response-lost')
        }
        if (endpoint === 'operation') {
          assert.equal((payload as { id: string }).id, id)
          return {
            ok: true,
            value: {
              id,
              scope: view.token,
              action: 'update',
              status: 'succeeded',
              phase: 'settled',
              saved: ['DB_PASSWORD'],
              errors: [],
            },
          }
        }
        throw new Error('unexpected endpoint')
      },
    },
    {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        assert.doesNotMatch(value, /private-value/)
        storage.set(key, value)
      },
      removeItem: (key) => {
        storage.delete(key)
      },
    },
  )
  t.after(() => model.dispose())
  model.show('workspace')
  await model.selectWorkspace('workspace')
  await model.start(view, 'update', { DB_PASSWORD: 'private-value' })
  assert.equal(calls.filter((x) => x === 'start').length, 1)
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /private-value/)
  assert.equal(storage.size, 0)
})
test('unknown generation or operation is reported as unrecoverable, never as an unwritten save', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const view = await context(f)
  const model = new CredentialClientModel({
    async call(_channel, endpoint) {
      return {
        ok: true,
        value: endpoint === 'overview' ? { generation: randomUUID(), datasources: [view] } : null,
      }
    },
  })
  t.after(() => model.dispose())
  await model.selectWorkspace('workspace')
  await model.start(view, 'test')
  assert.match(translator('zh-CN')(model.getSnapshot().error), /保存可能已经发生/)
  assert.equal(model.getSnapshot().operation, undefined)
})
test('closing the page or switching Workspace ignores late overview replies', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const view = await context(f)
  let finish!: (value: unknown) => void
  const model = new CredentialClientModel({
    call: async () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  t.after(() => model.dispose())
  const pending = model.selectWorkspace('workspace')
  model.close()
  finish({ ok: true, value: { generation: randomUUID(), datasources: [view] } })
  await pending
  assert.deepEqual(model.getSnapshot().datasources, [])
})
test('bundle installs constant management and pending entries, with no historical result form', async () => {
  const { readFile } = await import('node:fs/promises')
  const bundle = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8').catch(() =>
    readFile(new URL('../../lib/client.js', new URL('../', import.meta.url)), 'utf8'),
  )
  assert.match(bundle, /marivo-credential-requests/)
  assert.match(bundle, /marivo-credential-observer/)
  assert.doesNotMatch(bundle, /mc-dialog/)
  assert.doesNotMatch(
    bundle,
    /shouldAutoOpen|CredentialDialogController|MarivoDatasourceCredentialToolView/,
  )
})

test('late submit A cannot replace operation B or cancel its query after a Workspace switch', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const a = await context(f),
    b = { ...a, token: randomUUID(), name: 'other' }
  const storage = new Map<string, string>(),
    ids = new Map<string, string>()
  let releaseA!: () => void, finishB!: () => void, queryBSignal: AbortSignal | undefined
  let queriedB!: () => void
  const readyB = new Promise<void>((resolve) => {
    queriedB = resolve
  })
  const cancellations: string[] = []
  const result = (scope: string, status: 'running' | 'succeeded') => ({
    ok: true,
    value: {
      id: ids.get(scope)!,
      scope,
      action: 'update',
      status,
      phase: status === 'running' ? 'validating' : 'settled',
      saved: [],
      errors: [],
    },
  })
  const model = new CredentialClientModel(
    {
      async call(_channel, endpoint, value, signal) {
        const payload = value as { scope: string; id: string; workspaceId: string }
        if (endpoint === 'overview')
          return {
            ok: true,
            value: {
              generation: f.service.generation,
              datasources: [payload.workspaceId === 'A' ? a : b],
            },
          }
        if (endpoint === 'start') {
          ids.set(payload.scope, payload.id)
          if (payload.scope === a.token)
            await new Promise<void>((resolve) => {
              releaseA = resolve
            })
          return result(payload.scope, 'running')
        }
        if (endpoint === 'operation') {
          if (payload.scope === b.token) {
            queryBSignal = signal
            queriedB()
            await new Promise<void>((resolve) => {
              finishB = resolve
            })
          }
          return result(payload.scope, 'succeeded')
        }
        if (endpoint === 'cancel-operation') {
          cancellations.push(payload.id)
          return { ok: true, value: {} }
        }
        throw new Error('unexpected endpoint')
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
  await model.selectWorkspace('A')
  const runA = model.start(a, 'update')
  await model.selectWorkspace('B')
  const runB = model.start(b, 'update')
  await readyB
  assert.equal(JSON.parse([...storage.values()][0]!).length, 2)
  releaseA()
  await runA
  assert.equal(queryBSignal?.aborted, false)
  assert.equal(model.getSnapshot().workspaceId, 'B')
  assert.equal(model.getSnapshot().operation?.id, ids.get(b.token))
  assert.equal(model.getSnapshot().handle?.id, ids.get(b.token))
  assert.deepEqual(
    model.getSnapshot().operations.map((entry) => entry.handle.id),
    [ids.get(b.token)],
  )
  assert.equal(model.getSnapshot().outcomes[a.token]?.operation?.status, 'succeeded')
  const handles = JSON.parse([...storage.values()][0]!)
  assert.deepEqual(
    handles.map((entry: { handle: { id: string } }) => entry.handle.id),
    [ids.get(b.token)],
  )
  model.selectOperation(ids.get(a.token)!)
  assert.equal(model.getSnapshot().operation?.id, model.getSnapshot().handle?.id)
  // A completed operation cannot replace B's active selection or cancellation target.
  await model.cancelOperation(b.token)
  assert.deepEqual(cancellations, [ids.get(b.token)])
  finishB()
  await runB
  assert.equal(storage.size, 0)
  assert.deepEqual(model.getSnapshot().operations, [])
  assert.equal(model.getSnapshot().operation, undefined)
})

test('refresh recovers every outstanding operation independently without resending values', async (t) => {
  const generation = randomUUID()
  const entries = ['one', 'two'].map((name) => ({
    name,
    handle: { generation, id: randomUUID(), scope: randomUUID() },
  }))
  const storage = new Map([['marivo-credential-operation', JSON.stringify(entries)]])
  const queries = new Set<string>(),
    finishes = new Map<string, () => void>()
  const model = new CredentialClientModel(
    {
      async call(_channel, endpoint, payload) {
        assert.equal(endpoint, 'operation', 'recovery must never resend a mutation')
        const handle = payload as { id: string; scope: string }
        queries.add(handle.id)
        await new Promise<void>((resolve) => {
          finishes.set(handle.id, resolve)
        })
        return {
          ok: true,
          value: {
            id: handle.id,
            scope: handle.scope,
            action: 'test',
            status: 'succeeded',
            phase: 'settled',
            saved: [],
            errors: [],
          },
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
  model.recover()
  assert.deepEqual(
    [...queries],
    entries.map((entry) => entry.handle.id),
  )
  assert.equal(model.getSnapshot().operations.length, 2)
  finishes.get(entries[0]!.handle.id)!()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(JSON.parse([...storage.values()][0]!).length, 1)
  finishes.get(entries[1]!.handle.id)!()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(storage.size, 0)
  assert.deepEqual(model.getSnapshot().operations, [])
  assert(
    Object.values(model.getSnapshot().outcomes).every(
      (entry) => entry.operation?.status === 'succeeded',
    ),
  )
})

test('an unrecoverable background operation keeps a scoped warning without leaving a history entry', async (t) => {
  const entries = ['selected', 'background'].map((name) => ({
    name,
    handle: { generation: randomUUID(), id: randomUUID(), scope: randomUUID() },
  }))
  const model = new CredentialClientModel(
    {
      async call(_channel, endpoint, value) {
        assert.equal(endpoint, 'operation')
        const handle = value as { id: string; scope: string }
        return {
          ok: true,
          value:
            handle.id === entries[1]!.handle.id
              ? null
              : {
                  ...handle,
                  action: 'test',
                  status: 'succeeded',
                  phase: 'settled',
                  saved: [],
                  errors: [],
                },
        }
      },
    },
    { getItem: () => JSON.stringify(entries), setItem: () => {}, removeItem: () => {} },
  )
  t.after(() => model.dispose())
  model.recover()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(model.getSnapshot().operation, undefined)
  assert.equal(model.getSnapshot().handle, undefined)
  assert.equal(model.getSnapshot().error, '')
  assert.deepEqual(model.getSnapshot().operations, [])
  assert.equal(
    model.getSnapshot().outcomes[entries[0]!.handle.scope]?.operation?.status,
    'succeeded',
  )
  assert.match(
    translator('zh-CN')(model.getSnapshot().outcomes[entries[1]!.handle.scope]!.error!),
    /保存可能已经发生/,
  )
  model.select(entries[1]!.handle.scope)
  assert.match(
    translator('zh-CN')(model.getSnapshot().outcomes[model.getSnapshot().selected]!.error!),
    /保存可能已经发生/,
  )
})
