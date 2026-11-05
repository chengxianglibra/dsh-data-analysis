import assert from 'node:assert/strict'
import test from 'node:test'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  appendComponentReference,
  createComponentReferenceSource,
} from '../../src/client/component-reference.ts'
import {
  appendDatasetReference,
  createDatasetReferenceSource,
} from '../../src/client/dataset-reference.ts'
import type { InputContextHost } from '../../src/client/input-context.ts'
import {
  appendPointReference,
  createPointReferenceSource,
} from '../../src/client/point-reference.ts'
import type { PointEnvelope } from '../../src/presentation/contracts/point-reference.ts'

function fixture() {
  const listeners = new Set<() => void>()
  const inputListeners = new Set<() => void>()
  const state = {
    active: true,
    workspaceId: 'w',
    path: '/w',
    phase: 'plain',
    reject: false,
    focusCount: 0,
  }
  let draft = {
    draft: '问题 @旧引用',
    draftRev: 3,
    occurrences: [{ offset: 3, length: 4 }],
    attachmentIds: ['file'],
  }
  const inserted: {
    span: { start: number; end: number; draftRev: number }
    reference: { ref: string; clipboardText: string }
  }[] = []
  const actx = {
    bail(_ctx: unknown, _event: string, request: (typeof inserted)[number]) {
      if (state.reject) return undefined
      inserted.push(request)
      return true
    },
  }
  const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  // Minimal Host doubles exercise the owned-input boundary; unrelated Host services are intentionally absent.
  const host = {
    sessions: {
      list: {
        getSnapshot: () => ({ byId: { a: { retainedBy: { mainView: state.active ? 1 : 0 } } } }),
        subscribe,
      },
      scope: () => actx,
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          phase: 'ready',
          state: 'idle',
          items: [{ workspaceId: state.workspaceId, path: state.path, sessionIds: ['a'] }],
        }),
        subscribe,
      },
    },
    conversation: {
      input: {
        for: () => ({
          focus: () => state.focusCount++,
          state: {
            getSnapshot: () => ({ ...draft, phase: state.phase }),
            subscribe: (fn: () => void) => {
              inputListeners.add(fn)
              return () => inputListeners.delete(fn)
            },
          },
        }),
      },
    },
  } as unknown as InputContextHost
  const request = {
    sessionId: 'a',
    workspaceId: 'w',
    recordId: 'marivo-ui:r:b',
    resourceName: 'trips',
    row: 0,
    field: 'count',
  }
  const envelope: PointEnvelope = {
    ...request,
    schema: 'dsh-data-analysis-frame-point/v1',
    point: {
      column: { id: 'count', label: 'Trips', type: 'int64', nullable: false },
      value: '9007199254740993',
      role: 'value',
      description: null,
      axes: [],
      coordinates: [],
      presence: [],
      related: [],
      coverageComplete: true,
      interpretation: null,
      periods: JSON.stringify({ status: 'captured', pages: [] }),
    },
  }
  let finish: ((result: unknown) => void) | undefined
  const rpc = {
    call: async (_channel: string, endpoint: string) => {
      if (
        endpoint === 'point/prepare' ||
        endpoint === 'dataset/prepare' ||
        endpoint === 'component/prepare'
      )
        return new Promise((resolve) => {
          finish = resolve
        })
      if (endpoint === 'component/serialize')
        return { ok: true, value: { text: 'verified component' } }
      if (endpoint === 'dataset/serialize')
        return { ok: true, value: { text: 'verified DataFrame' } }
      if (endpoint === 'point/serialize')
        return { ok: true, value: { text: 'verified precise value: 9007199254740993' } }
      throw new Error('unexpected endpoint')
    },
  } as unknown as ClientConnectionRpc
  return {
    host,
    rpc,
    request,
    envelope,
    state,
    inserted,
    listeners,
    inputListeners,
    finish: (value: unknown = { ok: true, value: { envelope } }) => {
      assert.ok(finish)
      finish(value)
    },
    change: (value: Partial<typeof state>) => {
      Object.assign(state, value)
      for (const fn of listeners) fn()
      for (const fn of inputListeners) fn()
    },
    edit: (value: typeof draft) => {
      draft = value
      for (const fn of inputListeners) fn()
    },
  }
}

test('point insertion preserves edited draft and serializes the validated reference', async () => {
  const f = fixture()
  const lifetime = new AbortController()
  const pending = appendPointReference(f.host, f.rpc, f.request, lifetime.signal)
  f.edit({
    draft: '新问题 @旧引用',
    draftRev: 4,
    occurrences: [{ offset: 4, length: 4 }],
    attachmentIds: ['file'],
  })
  f.finish()
  await pending
  assert.equal(f.inserted.length, 1)
  assert.deepEqual(f.inserted[0]?.span, { start: 5, end: 5, draftRev: 4 })
  assert.equal(f.inserted[0]?.reference.clipboardText, '@Trips')
  const codec = createPointReferenceSource(f.rpc, lifetime.signal).codec
  assert.ok(codec)
  assert.equal(
    await codec.serialize(f.inserted[0]!.reference.ref, lifetime.signal),
    'verified precise value: 9007199254740993',
  )
  assert.equal(f.listeners.size, 0)
  assert.equal(f.inputListeners.size, 0)
})

test('point focus callback respects current input ownership and lifetime', async () => {
  for (const mode of ['active', 'session', 'workspace', 'cancel']) {
    const f = fixture()
    const lifetime = new AbortController()
    const pending = appendPointReference(f.host, f.rpc, f.request, lifetime.signal)
    f.finish()
    const focus = await pending
    assert.equal(f.state.focusCount, 0)
    if (mode === 'session') f.change({ active: false })
    if (mode === 'workspace') f.change({ workspaceId: 'other' })
    if (mode === 'cancel') lifetime.abort()
    focus()
    assert.equal(f.state.focusCount, mode === 'active' ? 1 : 0, mode)
  }
})

test('point prepare refuses stale ownership, reset, cancellation and mismatched replies', async () => {
  for (const failure of [
    'session',
    'workspace',
    'path',
    'phase',
    'reset',
    'cas',
    'cancel',
    'reply',
    'rpc',
  ]) {
    const f = fixture()
    const lifetime = new AbortController()
    const pending = appendPointReference(f.host, f.rpc, f.request, lifetime.signal)
    const rejected = assert.rejects(pending)
    if (failure === 'session') f.change({ active: false })
    if (failure === 'workspace') f.change({ workspaceId: 'other' })
    if (failure === 'path') f.change({ path: '/other' })
    if (failure === 'phase') f.change({ phase: 'submitting' })
    if (failure === 'cas') f.change({ reject: true })
    if (failure === 'cancel') lifetime.abort()
    if (failure === 'reset') f.edit({ draft: '', draftRev: 4, occurrences: [], attachmentIds: [] })
    f.finish(
      failure === 'rpc'
        ? { ok: false }
        : failure === 'reply'
          ? { ok: true, value: { envelope: { ...f.envelope, row: 1 } } }
          : undefined,
    )
    await rejected
    assert.equal(f.inserted.length, 0, failure)
    assert.equal(f.listeners.size, 0)
    assert.equal(f.inputListeners.size, 0)
  }
})

test('DataFrame references append to the live draft and reject stale ownership or mismatches', async () => {
  for (const failure of ['none', 'workspace', 'cancel', 'reply']) {
    const f = fixture()
    const lifetime = new AbortController()
    const request = f.request
    const envelope = {
      ...request,
      schema: 'dsh-data-analysis-dataset-point/v1',
      digest: 'a'.repeat(64),
    }
    const pending = appendDatasetReference(f.host, f.rpc, request, lifetime.signal)
    const rejected = failure === 'none' ? undefined : assert.rejects(pending)
    if (failure === 'workspace') f.change({ workspaceId: 'other' })
    if (failure === 'cancel') lifetime.abort()
    f.finish({
      ok: true,
      value: { envelope: failure === 'reply' ? { ...envelope, resourceName: 'other' } : envelope },
    })
    if (rejected) {
      await rejected
      assert.equal(f.inserted.length, 0)
    } else {
      await pending
      assert.equal(f.inserted[0]?.reference.clipboardText, '@trips · count · 1')
      const codec = createDatasetReferenceSource(f.rpc, lifetime.signal).codec
      assert.ok(codec)
      assert.equal(
        await codec.serialize(f.inserted[0]!.reference.ref, lifetime.signal),
        'verified DataFrame',
      )
    }
    assert.equal(f.listeners.size, 0)
    assert.equal(f.inputListeners.size, 0)
  }
})

test('component references preserve the draft and cancel stale preparation', async () => {
  for (const failure of ['none', 'cancel', 'workspace', 'reply']) {
    const f = fixture()
    const lifetime = new AbortController()
    const { row: _row, field: _field, ...identity } = f.request
    const request = { ...identity, component: { kind: 'frame' as const, view: { chart: 'table' } } }
    const envelope = {
      ...request,
      schema: 'dsh-data-analysis-component/v1',
      digest: 'a'.repeat(64),
    }
    const pending = appendComponentReference(f.host, f.rpc, request, lifetime.signal)
    const rejected = failure === 'none' ? undefined : assert.rejects(pending)
    if (failure === 'workspace') f.change({ workspaceId: 'other' })
    if (failure === 'cancel') lifetime.abort()
    f.finish({
      ok: true,
      value: {
        envelope: failure === 'reply' ? { ...envelope, component: { kind: 'dataset' } } : envelope,
      },
    })
    if (rejected) {
      await rejected
      assert.equal(f.inserted.length, 0)
    } else {
      const focus = await pending
      assert.equal(f.inserted[0]?.reference.clipboardText, '@trips')
      assert.deepEqual(f.inserted[0]?.span, { start: 4, end: 4, draftRev: 3 })
      assert.equal(f.state.focusCount, 0)
      focus()
      assert.equal(f.state.focusCount, 1)
      const codec = createComponentReferenceSource(f.rpc, lifetime.signal).codec
      assert.ok(codec)
      assert.equal(
        await codec.serialize(f.inserted[0]!.reference.ref, lifetime.signal),
        'verified component',
      )
    }
    assert.equal(f.listeners.size, 0)
    assert.equal(f.inputListeners.size, 0)
  }
})
