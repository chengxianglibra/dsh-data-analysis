import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  AnalysisViewError,
  analysisRecordId,
  parseSavedPresentation,
} from '../../src/presentation/contracts/analysis-document.ts'
import * as f from './frame-fixtures.ts'

test('a legacy filtered Frame with duplicate chart coordinates is rejected on reading', () => {
  // The complete baseline 25737bc validateAnalysisResources accepted this same
  // program and snapshot. Its renderer could overwrite one of the duplicate
  // hour/cluster coordinates; the current reader rejects this ambiguous Build.
  const snapshot = f.frame({
    axes: [
      { name: 'day', keys: ['d1', 'd2', 'd2'] },
      { name: 'hour', keys: ['09', '09', '09'] },
      { name: 'cluster', keys: ['A', 'A', 'B'] },
    ],
    values: [f.value('v', 3, f.observed())],
  })
  const program = [
    'root = Stack([filter, v]);',
    'filter = SnapshotFilter("day", "f", {kind:"axis",name:"day"}, "Day", "single", []);',
    'v = AnalysisFrameView("f", {chart:"bar",encoding:{axis:"hour",series:"cluster"}}, {}, ["day"]);',
  ].join('\n')
  const resources = {
    f: {
      kind: 'snapshot' as const,
      declaration: { kind: 'frame-snapshot' as const, snapshotRef: 'frame' },
      snapshot,
      binding: {
        workspaceId: 'workspace',
        codeRef: { executionId: '12345678-1234-4123-8123-123456789abc', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
  }
  assert.throws(
    () =>
      parseSavedPresentation({
        schemaVersion: 'dsh.analysis-ui/v3',
        workspaceId: 'workspace',
        reportId: 'report',
        buildId: 'build',
        recordId: analysisRecordId('report', 'build'),
        title: 'Legacy',
        locale: 'en-US',
        generatedAt: '2026-11-13T00:00:00Z',
        catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
        program,
        resources,
      }),
    (error) =>
      error instanceof AnalysisViewError &&
      error.code === 'analysis-view-target-ambiguous' &&
      error.path === 'v/view',
  )
})
