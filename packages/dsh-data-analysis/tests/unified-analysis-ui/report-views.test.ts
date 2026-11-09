import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { analysisCandidate } from '../../src/client/analysis-ui/candidate.ts'
import { ReportViews } from '../../src/client/analysis-ui/report-views.ts'
import type { DraftDelivery, PresentationDelivery } from '../../src/presentation/receipt.ts'

// The Host mints opaque generations; this fixture only compares their identity.
const generation = {} as ConnectionGeneration
function candidate(callId = 'first', args = {}) {
  return analysisCandidate(
    {
      phase: 'preparing',
      args: PartialArguments.fromObject(args),
      callId,
      name: 'marivo_present',
      turn: 1,
      step: 1,
      time: 1,
      subCalls: [],
    },
    'session',
    'workspace',
    generation,
  )
}
function draft(): DraftDelivery {
  return {
    kind: 'marivo.presentation.draft',
    dshSessionId: 'session',
    workspaceId: 'workspace',
    turn: 1,
    surface: 'tool',
    draftId: randomUUID(),
    draftRevision: randomUUID(),
  }
}
function saved(draftId?: string): PresentationDelivery {
  return {
    kind: 'marivo.presentation.delivery',
    schemaVersion: 2,
    dshSessionId: 'session',
    turn: 1,
    surface: 'tool',
    ...(draftId ? { draftId } : {}),
    receipt: {
      kind: 'marivo.presentation',
      schemaVersion: 2,
      workspaceId: 'workspace',
      reportId: 'report',
      buildId: randomUUID(),
      title: 'Report',
      summary: 'Saved',
      files: {
        document: {
          asset: 'presentation.json',
          path: '/workspace/report/presentation.json',
          bytes: 1,
          sha256: 'a'.repeat(64),
        },
      },
    },
  }
}

test('one view and reading state survive streaming, revisions, save, hidden tabs and actual close', () => {
  const views = new ReportViews()
  const first = views.observe(candidate(), '/workspace')
  first.reading.tabs.set('sections', 'details')
  first.reading.tables.set('data', {
    page: 2,
    sort: { columnId: 'amount', direction: 'descending' },
  })
  const initial = draft()
  views.accept(initial, 'first', generation, '/workspace')
  views.attach(first.id, 'right-tab')
  const next = views.observe(
    candidate('second', {
      stage: 'preview',
      draftId: initial.draftId,
      draftRevision: initial.draftRevision,
    }),
    '/workspace',
  )
  assert.equal(next.id, first.id)
  views.accept({ ...initial, draftRevision: randomUUID() }, 'second', generation, '/workspace')
  views.accept(saved(initial.draftId), 'save', generation, '/workspace')
  assert.equal(views.forTurn('session', 1).length, 1)
  assert.equal(views.get(first.id)?.reading, first.reading)
  assert.equal(views.get(first.id)?.tabId, 'right-tab')
  for (const call of ['first', 'second', 'save'])
    assert.equal(views.forCall('session', call)?.tabId, 'right-tab')
  assert.equal(views.forCall('other', 'save'), undefined)
  views.reconcile([{ sessionId: 'session', tabId: 'right-tab' }])
  assert.equal(
    views.get(first.id)?.tabId,
    'right-tab',
    'inactive or collapsed tabs remain in inventory',
  )
  views.reconcile([{ sessionId: 'other', tabId: 'right-tab' }])
  assert.equal(
    views.get(first.id)?.tabId,
    undefined,
    'only the owning occurrence keeps the report moved',
  )
  assert.equal(views.get(first.id)?.reading.tabs.get('sections'), 'details')
  assert.equal(views.get(first.id)?.reading.tables.get('data')?.page, 2)
})

test('direct saves keep their candidate identity and separate calls create separate reports', () => {
  const views = new ReportViews()
  const first = views.observe(candidate(), '/workspace')
  views.accept(saved(), 'first', generation, '/workspace')
  const second = views.observe(candidate('second'), '/workspace')
  assert.notEqual(first.id, second.id)
  views.accept(saved(), 'second', generation, '/workspace')
  assert.equal(views.forTurn('session', 1).length, 2)
  views.settle('session')
  assert.equal(views.get(first.id)?.settled, undefined, 'published reports survive Turn settlement')
})

test('cancelled drafts stop streaming, and revoked scope cannot restore reading or placement', () => {
  const views = new ReportViews()
  const first = views.observe(candidate(), '/workspace')
  views.attach(first.id, 'tab')
  views.settle('session')
  assert.equal(views.get(first.id)?.candidate?.phase, 'cancelled')
  views.revoke('session')
  assert.equal(views.forCall('session', 'first'), undefined)
  const restored = views.observe(candidate(), '/changed-workspace')
  assert.equal(restored.tabId, undefined)
  assert.notEqual(restored.reading, first.reading)
})

test('native persisted addresses restore moved placement even when the tab body is not mounted', () => {
  const views = new ReportViews()
  const view = views.observe(candidate(), '/workspace')
  const tab = { sessionId: 'session', tabId: 'restored', viewId: view.id, workspaceId: 'other' }
  views.reconcile([tab])
  assert.equal(views.get(view.id)?.tabId, undefined)
  views.reconcile([{ ...tab, workspaceId: 'workspace' }])
  assert.equal(views.get(view.id)?.tabId, 'restored')
  views.reconcile([])
  assert.equal(views.get(view.id)?.tabId, undefined)
})
