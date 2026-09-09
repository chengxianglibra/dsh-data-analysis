import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCandidatesResponse } from '../../src/semantic-reference/contracts.ts'
import {
  referenceEnvironmentResolver,
  semanticEnvironmentFingerprint,
} from '../../src/semantic-reference/environment.ts'
import { SemanticReferenceService } from '../../src/semantic-reference/rpc.ts'
import { SemanticReferenceUsage } from '../../src/semantic-reference/usage.ts'
import { envelope, fakeRunner } from './fixtures.ts'

function fixture() {
  const f = fakeRunner()
  const agent = {}
  const state = {
    agent: agent as object | undefined,
    workspace: { id: 'w', path: '/work' },
    root: '/work',
    resolves: 0,
  }
  let binding: { root: string; environment: Promise<typeof f.runner> } | undefined
  let wait = Promise.resolve(f.runner)
  const resolve = referenceEnvironmentResolver({
    agent: (id) => (id === 'a' ? state.agent : undefined),
    workspace: () => {
      if (!state.workspace.id) throw new Error('missing-workspace')
      return state.workspace
    },
    binding: () => binding,
    projectRoot: () => state.root,
    resolve: () => {
      state.resolves++
      binding ??= { root: state.root, environment: wait }
      return binding.environment
    },
  })
  const usage = new SemanticReferenceUsage({
    open: async () => {
      throw new Error('unused-storage')
    },
  })
  const service = new SemanticReferenceService(resolve, usage)
  const request = {
    sessionId: 'a',
    workspaceId: 'w',
    environmentFingerprint: semanticEnvironmentFingerprint('w', 'fp-a'),
    ref: envelope().ref,
  }
  return {
    f,
    state,
    service,
    request,
    resolve,
    rebind: () => {
      binding = undefined
    },
    wait: (promise: typeof wait) => {
      wait = promise
    },
  }
}

test('prepare establishes first binding without candidates, Catalog, analysis or usage; existing codec remains authoritative', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const signal = new AbortController().signal
  await assert.rejects(
    f.service.handle(
      'semantic-references/serialize',
      { envelope: envelope('a', semanticEnvironmentFingerprint('w', 'fp-a')) },
      signal,
    ),
    /unbound/,
  )
  assert.deepEqual(await f.service.handle('semantic-references/prepare', f.request, signal), {
    envelope: envelope('a', semanticEnvironmentFingerprint('w', 'fp-a')),
  })
  assert.equal(f.state.resolves, 1)
  const serialized = await f.service.handle(
    'semantic-references/serialize',
    { envelope: envelope('a', semanticEnvironmentFingerprint('w', 'fp-a')) },
    signal,
  )
  assert.match(JSON.stringify(serialized), /marivo-semantic-ref/)
  assert.equal(f.f.requests.length, 0)
  // Existence is intentionally not checked, including after objects were deleted.
  f.f.setData({ kinds: [], items: [] })
  await f.service.handle('semantic-references/prepare', f.request, signal)
  assert.equal(f.f.requests.length, 0)
  f.state.workspace = { id: 'other', path: '/work' }
  await assert.rejects(
    f.service.handle(
      'semantic-references/serialize',
      { envelope: envelope('a', semanticEnvironmentFingerprint('w', 'fp-a')) },
      signal,
    ),
    /workspace-changed/,
  )
  assert.equal(f.state.resolves, 2, 'serialize never repairs binding')
})

test('prepare rejects wrong Session, same-path Workspace, fingerprint and failed Runtime', async (t) => {
  for (const change of [
    { sessionId: 'b' },
    { workspaceId: 'other' },
    { environmentFingerprint: 'other' },
  ]) {
    const f = fixture()
    t.after(() => f.service.close())
    await assert.rejects(
      f.service.handle(
        'semantic-references/prepare',
        { ...f.request, ...change },
        new AbortController().signal,
      ),
    )
    assert.equal(f.f.requests.length, 0)
  }
  const f = fixture()
  t.after(() => f.service.close())
  Object.defineProperty(f.f.runner, 'status', { value: 'failed' })
  await assert.rejects(
    f.service.handle('semantic-references/prepare', f.request, new AbortController().signal),
    /environment-failed/,
  )
})

test('late binding cannot cross Agent, Workspace or configured-root changes; caller abort remains closed', async (t) => {
  for (const change of ['agent', 'workspace', 'root', 'abort'] as const) {
    const f = fixture()
    t.after(() => f.service.close())
    let finish!: (value: typeof f.f.runner) => void
    f.wait(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const controller = new AbortController()
    const pending = f.service.handle('semantic-references/prepare', f.request, controller.signal)
    const rejected = assert.rejects(pending)
    if (change === 'agent') f.state.agent = {}
    if (change === 'workspace') f.state.workspace = { id: 'other', path: '/work' }
    if (change === 'root') f.state.root = '/changed'
    if (change === 'abort') controller.abort()
    finish(f.f.runner)
    await rejected
    assert.equal(f.f.requests.length, 0)
  }
})

test('new Workspace selections recover without reviving old envelopes, even at the same path', async (t) => {
  for (const [purpose, rebind] of [
    ['prepare', false],
    ['prepare', true],
    ['candidates', false],
    ['candidates', true],
  ] as const) {
    const f = fixture()
    t.after(() => f.service.close())
    const signal = new AbortController().signal
    const old = await f.service.handle('semantic-references/prepare', f.request, signal)
    f.state.workspace = { id: 'new', path: '/work' }
    if (rebind) f.rebind()
    const fingerprint = semanticEnvironmentFingerprint('new', 'fp-a')
    await assert.rejects(f.service.handle('semantic-references/serialize', old, signal))
    if (purpose === 'prepare') {
      const fresh = await f.service.handle(
        'semantic-references/prepare',
        {
          ...f.request,
          workspaceId: 'new',
          environmentFingerprint: fingerprint,
        },
        signal,
      )
      await f.service.handle('semantic-references/serialize', fresh, signal)
      assert.equal(f.f.requests.length, 0, 'preparation never reads Catalog or executes analysis')
    } else {
      const candidates = parseCandidatesResponse(
        await f.service.handle(
          'semantic-references/candidates',
          {
            version: 1,
            sessionId: 'a',
            query: 'revenue',
            quoted: false,
          },
          signal,
        ),
      )
      assert.equal(candidates.environmentFingerprint, fingerprint)
      assert.equal(candidates.items.length, 1)
      assert.equal(f.f.requests.length, 1)
      await f.service.handle(
        'semantic-references/serialize',
        { envelope: envelope('a', fingerprint) },
        signal,
      )
    }
    await assert.rejects(
      f.service.handle('semantic-references/serialize', old, signal),
      /environment-mismatch/,
    )
  }
})
