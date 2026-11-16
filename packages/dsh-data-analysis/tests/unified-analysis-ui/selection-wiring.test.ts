import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AnalysisViewError,
  validateAnalysisResources,
} from '../../src/presentation/contracts/analysis-document.ts'
import type { SelectionSources } from '../../src/presentation/contracts/snapshot-filter.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('enum chips must write to the declared source consumed by the view', () => {
  const resources = {
    sales: {
      kind: 'snapshot' as const,
      declaration: { kind: 'dataset-snapshot' as const, snapshotRef: 'ref' },
      snapshot: datasetSnapshot(),
      binding: {
        workspaceId: 'workspace',
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
  }
  const sources: SelectionSources = {
    region: { ref: 'sales', field: { kind: 'column', name: 'category' }, mode: 'multiple' },
  }
  const program = (source: string, state: string) =>
    `$region = {}; $other = {};
root = Stack([picker, view]);
picker = FilterChips("${source}", ${state});
view = DatasetView("sales", {chart:"table"}, {}, [{source:"region",selection:$region}]);`
  assert.doesNotThrow(() =>
    validateAnalysisResources(program('region', '$region'), resources, sources),
  )
  for (const [source, value, path] of [
    ['unknown', '$region', 'picker/source'],
    ['region', '$other', 'picker/value'],
    ['region', '{}', 'picker/value'],
  ] as const)
    assert.throws(
      () => validateAnalysisResources(program(source, value), resources, sources),
      (error) =>
        error instanceof AnalysisViewError &&
        error.code === 'analysis-filter-reference-invalid' &&
        error.path === path,
    )

  assert.throws(
    () =>
      validateAnalysisResources(program('region', '$region'), resources, {
        region: { ...sources.region!, mode: 'date-range' },
      }),
    (error) =>
      error instanceof AnalysisViewError &&
      error.code === 'analysis-filter-reference-invalid' &&
      error.path === 'picker/source',
  )
})
