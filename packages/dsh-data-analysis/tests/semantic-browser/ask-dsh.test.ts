// @ts-nocheck -- explicit Host stores and editor failure injection.
import assert from 'node:assert/strict'
import test from 'node:test'
import { appendSemanticReference } from '../../src/client/semantic-browser/ask-dsh.ts'
import { SemanticBrowserModel } from '../../src/client/semantic-browser/model.ts'
import { createSemanticReferenceSource } from '../../src/client/semantic-reference-source.ts'
import { envelopeJson, modelMarker } from '../../src/semantic-reference/contracts.ts'
import { snapshot } from './fixtures.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
  const listeners = new Set<() => void>()
  const inputListeners = new Set<() => void>()
  const state = {
    current: 'a',
    workspaceId: 'w',
    path: '/project',
    inputPhase: 'plain',
    reject: false,
  }
  let draft = {
    draft: '问题 @metric:old',
    draftRev: 3,
    occurrences: [{ offset: 3, length: 11 }],
    attachmentIds: ['image'],
  }
  const inserted = [],
    calls = []
  const actx = {
    bail(_ctx, event, request) {
      assert.equal(event, 'slash/input-insert-reference')
      if (state.reject) return undefined
      assert.equal(request.span.draftRev, draft.draftRev)
      inserted.push(request)
      return true
    },
  }
  const subscribe = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  const host = {
    sessions: {
      list: { getSnapshot: () => ({ current: state.current }), subscribe },
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
          state: {
            getSnapshot: () => ({ ...draft, phase: state.inputPhase }),
            subscribe: (fn) => {
              inputListeners.add(fn)
              return () => inputListeners.delete(fn)
            },
          },
        }),
      },
    },
  }
  const request = {
    sessionId: 'a',
    workspaceId: 'w',
    environmentFingerprint: 'env',
    ref: snapshot().objects[0].ref,
  }
  const envelope = {
    schema: 'dsh-data-analysis-semantic-reference/v1',
    sessionId: 'a',
    environmentFingerprint: 'env',
    ref: request.ref,
  }
  let finish: (value: unknown) => void
  const rpc = {
    call: async (_channel, endpoint, payload, signal) => {
      calls.push({ endpoint, payload, signal })
      if (endpoint.endsWith('/prepare'))
        return new Promise((resolve) => {
          finish = resolve
        })
      if (endpoint.endsWith('/serialize'))
        return { ok: true, value: { text: modelMarker(payload.envelope) } }
      if (endpoint.endsWith('/selected')) throw new Error('usage unavailable')
      return { ok: true, value: snapshot('w') }
    },
  }
  return {
    host,
    rpc,
    request,
    envelope,
    state,
    inserted,
    calls,
    finish: (value = { ok: true, value: { envelope } }) => finish(value),
    change: (change) => {
      Object.assign(state, change)
      for (const fn of 'inputPhase' in change ? inputListeners : listeners) fn()
    },
    draft: (value) => {
      draft = value
      for (const fn of inputListeners) fn()
    },
    listeners,
    inputListeners,
  }
}

test('details and @ share complete chip, clipboard and codec; latest input is read after preparation', async () => {
  const f = fixture()
  const pending = appendSemanticReference(f.host, f.rpc, f.request, new AbortController().signal)
  assert.equal(f.inserted.length, 0)
  f.draft({
    draft: '新增问题 @metric:old',
    draftRev: 4,
    occurrences: [{ offset: 5, length: 11 }],
    attachmentIds: ['image'],
  })
  f.finish()
  await pending
  assert.equal(f.inserted.length, 1)
  assert.deepEqual(f.inserted[0].span, { start: 6, end: 6, draftRev: 4 })
  const source = createSemanticReferenceSource(f.rpc)
  const picked = source.onPick({
    session: { sessionId: 'a' },
    candidate: { value: envelopeJson(f.envelope) },
  })
  assert.deepEqual(f.inserted[0].reference, picked.insert)
  assert.equal(source.codec.clipboardText(picked.insert.ref), picked.insert.clipboardText)
  assert.equal(f.calls.filter((x) => x.endpoint.endsWith('/serialize')).length, 0)
  assert.equal(
    await source.codec.serialize(picked.insert.ref, new AbortController().signal),
    modelMarker(f.envelope),
  )
  assert.equal(f.listeners.size, 0)
})

test('prepare errors, changed identities, non-plain editor, stale revision and mismatched replies never insert or count', async () => {
  for (const failure of [
    'rpc',
    'session',
    'workspace',
    'path',
    'submitting',
    'revision',
    'reply',
    'cancel',
  ]) {
    const f = fixture(),
      controller = new AbortController()
    const pending = appendSemanticReference(f.host, f.rpc, f.request, controller.signal)
    const rejected = assert.rejects(pending)
    if (failure === 'session') {
      f.change({ current: 'b' })
      f.change({ current: 'a' })
    }
    if (failure === 'workspace') f.change({ workspaceId: 'other' })
    if (failure === 'path') f.change({ path: '/changed' })
    if (failure === 'submitting') f.change({ inputPhase: 'submitting' })
    if (failure === 'revision') f.change({ reject: true })
    if (failure === 'cancel') controller.abort()
    f.finish(
      failure === 'rpc'
        ? { ok: false }
        : failure === 'reply'
          ? { ok: true, value: { envelope: { ...f.envelope, sessionId: 'b' } } }
          : undefined,
    )
    await rejected
    assert.equal(f.inserted.length, 0, failure)
    assert.equal(f.calls.filter((x) => x.endpoint.endsWith('/selected')).length, 0, failure)
    assert.equal(f.listeners.size, 0)
    assert.equal(f.inputListeners.size, 0)
  }
})

test('model cancels delayed question on close, navigation, refresh, snapshot replacement, revocation and disposal', async () => {
  for (const action of [
    'close',
    'navigate',
    'refresh',
    'snapshot',
    'unavailable',
    'reset',
    'dispose',
  ]) {
    const f = fixture(),
      model = new SemanticBrowserModel(f.rpc)
    model.showObject('w', f.request.ref)
    await tick()
    const pending = model.addToQuestion(f.host, 'a')
    assert.equal(model.getSnapshot().questionPending, true)
    await model.addToQuestion(f.host, 'a')
    assert.equal(f.calls.filter((x) => x.endpoint.endsWith('/prepare')).length, 1)
    if (action === 'close') model.close()
    if (action === 'navigate') {
      model.navigate('metric:other')
      model.navigate('metric:sales.revenue')
    }
    if (action === 'refresh') await model.refresh()
    if (action === 'snapshot') model.patch({ snapshot: snapshot('w') })
    if (action === 'unavailable') model.unavailable()
    if (action === 'reset') model.resetConnection()
    if (action === 'dispose') model.dispose()
    f.finish()
    await pending
    assert.equal(f.inserted.length, 0, action)
    assert.notEqual(model.getSnapshot().questionNotice, 'marivo.semantic.added-to-question')
    model.dispose()
  }
})

test('successful insert survives usage failure and allows another explicit append', async () => {
  const f = fixture(),
    model = new SemanticBrowserModel(f.rpc)
  model.showObject('w', f.request.ref)
  await tick()
  for (let i = 0; i < 2; i++) {
    const pending = model.addToQuestion(f.host, 'a')
    f.finish()
    await pending
    await tick()
    assert.equal(model.getSnapshot().questionNotice, 'marivo.semantic.added-to-question')
    assert.equal(model.getSnapshot().questionPending, false)
    assert.equal(f.inserted.length, i + 1)
  }
  assert.equal(f.calls.filter((x) => x.endpoint.endsWith('/selected')).length, 2)
  model.dispose()
})

test('submission cancels preparation even after the composer returns to a new plain draft', async () => {
  for (const phase of ['adjudicating', 'submitting']) {
    const f = fixture()
    const pending = appendSemanticReference(f.host, f.rpc, f.request, new AbortController().signal)
    const rejected = assert.rejects(pending)
    f.change({ inputPhase: phase })
    f.draft({ draft: '', draftRev: 4, occurrences: [], attachmentIds: [] })
    f.change({ inputPhase: 'plain' })
    f.finish()
    await rejected
    assert.equal(f.inserted.length, 0)
    assert.equal(f.calls.filter((x) => x.endpoint.endsWith('/selected')).length, 0)
    assert.equal(f.listeners.size, 0)
    assert.equal(f.inputListeners.size, 0)
  }
})

test('claimed command drafts accept details just like the native @ source', async () => {
  const f = fixture()
  f.change({ inputPhase: 'claimed' })
  f.draft({ draft: '/skill question', draftRev: 5, occurrences: [], attachmentIds: ['image'] })
  const pending = appendSemanticReference(f.host, f.rpc, f.request, new AbortController().signal)
  f.finish()
  await pending
  assert.equal(f.inserted.length, 1)
  assert.equal(f.inserted[0].span.draftRev, 5)
  assert.equal(f.listeners.size, 0)
})

test('ordinary sends and manual resets cancel preparation while phase stays plain', async () => {
  for (const attachmentOnly of [false, true]) {
    const f = fixture()
    if (attachmentOnly)
      f.draft({ draft: '', draftRev: 3, occurrences: [], attachmentIds: ['image'] })
    const pending = appendSemanticReference(f.host, f.rpc, f.request, new AbortController().signal)
    const rejected = assert.rejects(pending)
    f.draft({ draft: '', draftRev: 4, occurrences: [], attachmentIds: [] })
    // Even if the user has already typed into the next draft, the old action stays cancelled.
    f.draft({ draft: 'next question', draftRev: 5, occurrences: [], attachmentIds: [] })
    f.finish()
    await rejected
    assert.equal(f.inserted.length, 0)
    assert.equal(f.calls.filter((x) => x.endpoint.endsWith('/selected')).length, 0)
    assert.equal(f.inputListeners.size, 0)
  }
})
