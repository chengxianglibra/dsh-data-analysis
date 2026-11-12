import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { analysisCandidate } from '../../src/client/analysis-ui/candidate.ts'
import { ReportViews, reportContentKey } from '../../src/client/analysis-ui/report-views.ts'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  analysisRecordId,
} from '../../src/presentation/contracts/analysis-document.ts'
import { draftReportRef, savedReportRef } from '../../src/presentation/contracts/report-ref.ts'
import type { DraftDelivery, PresentationDelivery } from '../../src/presentation/receipt.ts'

// The Host mints opaque generations; this fixture only compares their identity.
const generation = {} as ConnectionGeneration
function candidate(callId = 'first', args = {}) {
  return analysisCandidate(
    {
      phase: 'preparing',
      args: PartialArguments.fromObject(args),
      callId,
      name: 'marivo_report_write',
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
function document(buildId: string, program: string): AnalysisDocument {
  return {
    schemaVersion: ANALYSIS_UI_FORMAT,
    workspaceId: 'workspace',
    reportId: 'report',
    buildId,
    recordId: analysisRecordId('report', buildId),
    title: 'Report',
    locale: 'en-US',
    generatedAt: '2026-11-11T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program,
    resources: {},
  }
}

test('one view and reading state survive streaming, revisions and save', () => {
  const views = new ReportViews()
  const first = views.observe(candidate(), '/workspace')
  first.reading.tabs.set('sections', 'details')
  first.reading.tables.set('data', {
    page: 2,
    sort: { columnId: 'amount', direction: 'descending' },
  })
  const initial = draft()
  views.accept(initial, 'first', generation, '/workspace')
  const next = views.observe(
    candidate('second', {
      stage: 'preview',
      ref: draftReportRef({
        workspaceId: initial.workspaceId,
        sessionId: initial.dshSessionId,
        turn: initial.turn,
        draftId: initial.draftId,
        revision: initial.draftRevision,
      }),
    }),
    '/workspace',
  )
  assert.equal(next.id, first.id)
  views.accept({ ...initial, draftRevision: randomUUID() }, 'second', generation, '/workspace')
  views.accept(saved(initial.draftId), 'save', generation, '/workspace')
  assert.equal(views.forTurn('session', 1).length, 1)
  assert.equal(views.get(first.id)?.reading, first.reading)
  for (const call of ['first', 'second', 'save'])
    assert.equal(views.forCall('session', call)?.id, first.id)
  assert.equal(views.forCall('other', 'save'), undefined)
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

test('standalone previews keep separate views while a late draft ref joins its original view', () => {
  const views = new ReportViews()
  const initial = draft()
  const first = views.accept(initial, 'first', generation, '/workspace')
  const args = new PartialArguments()
  args.append('{"stage":"preview","program":"root = TextContent(\\"Updated\\");","ref":"')
  const read = () =>
    analysisCandidate(
      {
        phase: 'preparing',
        args,
        callId: 'patch',
        name: 'marivo_report_write',
        turn: 1,
        step: 1,
        time: 1,
        subCalls: [],
      },
      'session',
      'workspace',
      generation,
    )
  assert.equal(views.observeReady(read(), '/workspace'), undefined)
  assert.equal(views.forTurn('session', 1).length, 1)
  args.append(
    `${draftReportRef({
      workspaceId: initial.workspaceId,
      sessionId: initial.dshSessionId,
      turn: initial.turn,
      draftId: initial.draftId,
      revision: initial.draftRevision,
    })}"}`,
  )
  assert.equal(views.observeReady(read(), '/workspace')?.id, first.id)
  const second = views.observeReady(
    candidate('second', { stage: 'preview', program: 'root = TextContent("Another");' }),
    '/workspace',
  )
  assert.ok(second)
  assert.notEqual(second.id, first.id)
  assert.equal(views.forTurn('session', 1).length, 2)
})

test('a revision of the exact saved Build reuses its Turn view and preserves the last successful draft', () => {
  const views = new ReportViews()
  const original = saved()
  const first = views.accept(original, 'initial', generation, '/workspace')
  first.reading.tabs.set('sections', 'details')
  const ref = savedReportRef({
    workspaceId: original.receipt.workspaceId,
    reportId: original.receipt.reportId,
    buildId: original.receipt.buildId,
  })
  const revision = candidate('revision', {
    stage: 'preview',
    ref,
    program: 'root = TextContent("Updated");',
  })
  const editing = views.observeReady(revision, '/workspace')
  assert.equal(editing?.id, first.id)
  assert.equal(editing?.saved?.receipt.buildId, original.receipt.buildId)
  assert.equal(editing?.reading.tabs.get('sections'), 'details')
  const preview = draft()
  views.accept(preview, 'revision', generation, '/workspace')
  views.observeReady({ ...revision, phase: 'failed' }, '/workspace')
  assert.equal(views.get(first.id)?.saved?.receipt.buildId, original.receipt.buildId)
  assert.equal(views.get(first.id)?.draft?.draftRevision, preview.draftRevision)
  const next = saved(preview.draftId)
  views.accept(next, 'final', generation, '/workspace')
  assert.equal(views.get(first.id)?.saved?.receipt.buildId, next.receipt.buildId)
  assert.equal(views.forTurn('session', 1).length, 1)
  const otherTurn = views.observeReady({ ...revision, callId: 'other-turn', turn: 2 }, '/workspace')
  assert.ok(otherTurn)
  assert.notEqual(otherTurn.id, first.id)
  assert.equal(views.get(first.id)?.saved?.receipt.buildId, next.receipt.buildId)
})

test('a failed new preview from the saved Build restores the previously admitted draft', () => {
  const views = new ReportViews()
  const original = saved()
  const first = views.accept(original, 'initial', generation, '/workspace')
  const ref = savedReportRef({
    workspaceId: original.receipt.workspaceId,
    reportId: original.receipt.reportId,
    buildId: original.receipt.buildId,
  })
  const args = { stage: 'preview', ref, program: 'root = TextContent("Updated");' }
  views.observeReady(candidate('preview-one', args), '/workspace')
  const admitted = draft()
  views.accept(admitted, 'preview-one', generation, '/workspace')
  const admittedDocument = document(admitted.draftRevision, 'root = TextContent("Admitted");')
  views.document(
    first.id,
    { generation, workspacePath: '/workspace' },
    admitted.draftRevision,
    admittedDocument,
  )
  const next = candidate('preview-two', args)
  views.observeReady(next, '/workspace')
  const baseDocument = document(original.receipt.buildId, 'root = TextContent("Saved");')
  views.document(
    first.id,
    { generation, workspacePath: '/workspace' },
    baseDocument.recordId,
    baseDocument,
  )
  assert.equal(views.get(first.id)?.document?.program, baseDocument.program)
  views.observeReady({ ...next, phase: 'failed' }, '/workspace')
  assert.equal(views.get(first.id)?.draft?.draftRevision, admitted.draftRevision)
  assert.equal(views.get(first.id)?.document?.program, admittedDocument.program)
  views.observeReady(candidate('preview-three', args), '/workspace')
  views.document(
    first.id,
    { generation, workspacePath: '/workspace' },
    baseDocument.recordId,
    baseDocument,
  )
  views.settle('session')
  assert.equal(views.get(first.id)?.document?.program, admittedDocument.program)
})

test('a newly admitted draft replaces the saved-base preview fallback', () => {
  const views = new ReportViews()
  const original = saved()
  const first = views.accept(original, 'initial', generation, '/workspace')
  const ref = savedReportRef({
    workspaceId: original.receipt.workspaceId,
    reportId: original.receipt.reportId,
    buildId: original.receipt.buildId,
  })
  const args = { stage: 'preview', ref, program: 'root = TextContent("Updated");' }
  views.observeReady(candidate('preview-one', args), '/workspace')
  const one = draft()
  views.accept(one, 'preview-one', generation, '/workspace')
  const oneDocument = document(one.draftRevision, 'root = TextContent("One");')
  views.document(
    first.id,
    { generation, workspacePath: '/workspace' },
    one.draftRevision,
    oneDocument,
  )
  const twoCandidate = candidate('preview-two', args)
  views.observeReady(twoCandidate, '/workspace')
  const two = draft()
  views.observeReady({ ...twoCandidate, phase: 'previewed', draft: two }, '/workspace')
  const twoDocument = document(two.draftRevision, 'root = TextContent("Two");')
  views.document(
    first.id,
    { generation, workspacePath: '/workspace' },
    two.draftRevision,
    twoDocument,
  )
  const draftRef = draftReportRef({
    workspaceId: two.workspaceId,
    sessionId: two.dshSessionId,
    turn: two.turn,
    draftId: two.draftId,
    revision: two.draftRevision,
  })
  const failed = candidate('preview-three', { ...args, ref: draftRef })
  views.observeReady(failed, '/workspace')
  views.observeReady({ ...failed, phase: 'failed' }, '/workspace')
  assert.equal(views.get(first.id)?.draft?.draftRevision, two.draftRevision)
  assert.equal(views.get(first.id)?.document?.program, twoDocument.program)
})

test('saving retires the draft so its stale ref cannot replace the published view', () => {
  const views = new ReportViews()
  const admitted = draft()
  const first = views.accept(admitted, 'preview', generation, '/workspace')
  const published = saved(admitted.draftId)
  views.accept(published, 'save', generation, '/workspace')
  const ref = draftReportRef({
    workspaceId: admitted.workspaceId,
    sessionId: admitted.dshSessionId,
    turn: admitted.turn,
    draftId: admitted.draftId,
    revision: admitted.draftRevision,
  })
  const stale = candidate('stale', { stage: 'preview', ref, program: 'root = TextContent("Old");' })
  views.observeReady(stale, '/workspace')
  views.observeReady({ ...stale, phase: 'failed' }, '/workspace')
  assert.equal(views.get(first.id)?.draft, undefined)
  assert.equal(views.get(first.id)?.candidate, undefined)
  assert.equal(views.get(first.id)?.saved?.receipt.buildId, published.receipt.buildId)
})

test('replayed receipts preserve the latest saved Build and an ongoing revision', () => {
  const views = new ReportViews()
  const first = saved()
  const view = views.accept(first, 'first', generation, '/workspace')
  const edit = (callId: string, base: PresentationDelivery) =>
    candidate(callId, {
      stage: 'preview',
      ref: savedReportRef({
        workspaceId: base.receipt.workspaceId,
        reportId: base.receipt.reportId,
        buildId: base.receipt.buildId,
      }),
      program: 'root = TextContent("Revision");',
    })
  views.observeReady(edit('second', first), '/workspace')
  const preview = draft()
  views.accept(preview, 'second', generation, '/workspace')
  const second = saved(preview.draftId)
  views.accept(second, 'save-second', generation, '/workspace')
  views.observeReady(edit('third', second), '/workspace')
  views.accept(first, 'first', generation, '/workspace')
  views.accept(second, 'save-second', generation, '/workspace')
  views.observeReady({ ...edit('second', first), phase: 'previewed', draft: preview }, '/workspace')
  assert.equal(views.get(view.id)?.saved?.receipt.buildId, second.receipt.buildId)
  assert.equal(views.get(view.id)?.candidate?.callId, 'third')
  assert.equal(views.get(view.id)?.draft, undefined)
})

test('settled saved revisions reopen the saved Build instead of an expired draft', () => {
  const views = new ReportViews()
  const published = saved()
  const view = views.accept(published, 'saved', generation, '/workspace')
  views.observeReady(
    candidate('revision', {
      stage: 'preview',
      ref: savedReportRef({
        workspaceId: published.receipt.workspaceId,
        reportId: published.receipt.reportId,
        buildId: published.receipt.buildId,
      }),
      program: 'root = TextContent("Unsaved");',
    }),
    '/workspace',
  )
  const preview = draft()
  views.accept(preview, 'revision', generation, '/workspace')
  views.settle('session')
  assert.equal(reportContentKey(views.get(view.id)!), published.receipt.buildId)
  assert.equal(views.get(view.id)?.candidate, undefined)
  assert.equal(views.get(view.id)?.draft, undefined)
})

test('cancelled drafts stop streaming, and revoked scope cannot restore reading state', () => {
  const views = new ReportViews()
  const first = views.observe(candidate(), '/workspace')
  views.settle('session')
  assert.equal(views.get(first.id)?.candidate?.phase, 'cancelled')
  views.revoke('session')
  assert.equal(views.forCall('session', 'first'), undefined)
  const restored = views.observe(candidate(), '/changed-workspace')
  assert.notEqual(restored.reading, first.reading)
})

test('resource deltas reject stale call, Workspace, generation and revision and failure discards transient bytes', () => {
  const views = new ReportViews()
  const view = views.observe(candidate('active'), '/workspace')
  const owner = { generation, workspacePath: '/workspace' }
  const delta = {
    sessionId: 'session',
    workspaceId: 'workspace',
    turn: 1,
    callId: 'active',
    revision: 2,
    status: 'reading' as const,
    resources: {},
  }
  views.resources(view.id, owner, delta)
  assert.equal(views.get(view.id)?.resourceStream?.revision, 2)
  for (const response of [
    { ...delta, revision: 1 },
    { ...delta, callId: 'other', revision: 3 },
    { ...delta, workspaceId: 'other', revision: 3 },
  ])
    views.resources(view.id, owner, response)
  views.resources(
    view.id,
    { ...owner, generation: {} as ConnectionGeneration },
    { ...delta, revision: 3 },
  )
  assert.equal(views.get(view.id)?.resourceStream?.revision, 2)
  views.resources(view.id, owner, { ...delta, revision: 4, status: 'failed' })
  assert.equal(views.get(view.id)?.resourceStream?.status, 'failed')
  assert.deepEqual(views.get(view.id)?.resourceStream?.resources, {})
})
