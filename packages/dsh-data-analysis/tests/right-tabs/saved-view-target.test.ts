import assert from 'node:assert/strict'
import test from 'node:test'
import { isDeletedViewPage, TabPage } from '../../src/client/right-tabs/page.ts'
import {
  assertLiveViewOwner,
  readViewTarget,
  removeViewTargets,
  saveViewTarget,
} from '../../src/client/right-tabs/saved-view-target.ts'

function storage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

test('saved views recover their exact Build only for the owning session and workspace path', () => {
  const store = storage()
  const owner = {
    sessionId: 's',
    workspaceId: 'w',
    viewId: '["s",1,"first-call"]',
    workspacePath: '/project',
  }
  const target = {
    kind: 'report' as const,
    workspaceId: 'w',
    reportId: 'r',
    buildId: 'b',
    reportViewId: owner.viewId,
  }
  saveViewTarget(store, owner, target)
  assert.deepEqual(readViewTarget(store, owner), target)
  assert.equal(readViewTarget(store, { ...owner, sessionId: 'other' }), undefined)
  assert.equal(readViewTarget(store, { ...owner, workspaceId: 'other' }), undefined)
  assert.equal(readViewTarget(store, { ...owner, workspacePath: '/other' }), undefined)
  const key = store.key(0)!
  store.setItem(
    key,
    JSON.stringify({
      workspacePath: '/project',
      address:
        'dsh-resource://marivo-report/other/r/build/b?view=%5B%22s%22%2C1%2C%22first-call%22%5D',
    }),
  )
  assert.throws(() => readViewTarget(store, owner), /workspace-changed/)
})

test('deleting a report removes its recoverable Build without affecting other reports', () => {
  const store = storage()
  const owner = { sessionId: 's', workspaceId: 'w', viewId: 'view', workspacePath: '/project' }
  const other = { ...owner, viewId: 'other' }
  saveViewTarget(store, owner, {
    kind: 'report',
    workspaceId: 'w',
    reportId: 'r',
    buildId: 'b',
    reportViewId: owner.viewId,
  })
  saveViewTarget(store, other, {
    kind: 'report',
    workspaceId: 'w',
    reportId: 'other',
    buildId: 'c',
    reportViewId: other.viewId,
  })
  removeViewTargets(store, 'w', 'r', '/project')
  assert.equal(readViewTarget(store, owner), undefined)
  assert.equal(readViewTarget(store, other)?.buildId, 'c')
})

test('live view ownership rejects a forged Session and stale connection or workspace path', () => {
  const owner = { sessionId: 'session', workspacePath: '/workspace' }
  const generation = {}
  const view = { ...owner, generation }
  assert.doesNotThrow(() => assertLiveViewOwner(owner, view, generation))
  assert.throws(
    () => assertLiveViewOwner(owner, { ...view, sessionId: 'other-session' }, generation),
    /workspace-changed/,
  )
  assert.throws(
    () => assertLiveViewOwner(owner, { ...view, workspacePath: '/other' }, generation),
    /workspace-changed/,
  )
  assert.throws(() => assertLiveViewOwner(owner, view, {}), /workspace-changed/)
})

test('newer saved receipts replace the recovery hint without waiting for a mounted reader', () => {
  const store = storage()
  const owner = { sessionId: 's', workspaceId: 'w', viewId: 'view', workspacePath: '/project' }
  const target = {
    kind: 'report' as const,
    workspaceId: 'w',
    reportId: 'r',
    buildId: 'b1',
    reportViewId: 'view',
  }
  saveViewTarget(store, owner, target)
  saveViewTarget(store, owner, { ...target, buildId: 'b2' })
  assert.equal(readViewTarget(store, owner)?.buildId, 'b2')
})

test('deletion revokes only bindings in the deleted Workspace path', () => {
  const store = storage()
  const owner = { sessionId: 's', workspaceId: 'w', viewId: 'v', workspacePath: '/project' }
  const other = { ...owner, workspacePath: '/another' }
  const target = {
    kind: 'report' as const,
    workspaceId: 'w',
    reportId: 'r',
    buildId: 'b',
    reportViewId: 'v',
  }
  saveViewTarget(store, owner, target)
  saveViewTarget(store, other, target)
  removeViewTargets(store, 'w', 'r', '/project')
  assert.equal(readViewTarget(store, owner), undefined)
  assert.equal(readViewTarget(store, other)?.buildId, 'b')
})

test('a deleted live view retains its existing cleanup page but not a different view', () => {
  const page = new TabPage(
    's',
    { kind: 'report', workspaceId: 'w', reportId: 'r', buildId: 'b', reportViewId: 'view' },
    { call: async () => undefined },
  )
  const identity = { workspaceId: 'w', viewId: 'view' }
  try {
    assert.equal(isDeletedViewPage(page, identity), false)
    page.patch({ deleteCleanup: { reportId: 'r', expectedBuildId: 'b' } })
    page.unavailable('marivo.presentation.report-deleted-cleanup-pending')
    assert.equal(isDeletedViewPage(page, identity), true)
    assert.deepEqual(page.getSnapshot().deleteCleanup, { reportId: 'r', expectedBuildId: 'b' })
    assert.equal(isDeletedViewPage(page, { ...identity, viewId: 'another' }), false)
    assert.equal(isDeletedViewPage(page, { ...identity, workspaceId: 'another' }), false)
  } finally {
    page.dispose()
  }
})
