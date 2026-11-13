import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  analysisElements,
  analysisRecordId,
  parseSavedPresentation,
} from '../../src/presentation/contracts/analysis-document.ts'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

const snapshot = datasetSnapshot(
  [
    ['2026-11-12', '1'],
    ['2026-11-13', '2'],
  ],
  [
    { id: 'day', label: 'Day', type: 'string', nullable: false },
    { id: 'amount', label: 'Amount', type: 'decimal', nullable: false },
  ],
)
const resource = {
  kind: 'snapshot',
  declaration: { kind: 'dataset-snapshot', snapshotRef: 'ref' },
  snapshot,
  binding: {
    workspaceId: 'workspace',
    sessionId: 'session',
    callId: 'call',
    codeRef: { executionId: '12345678-1234-4123-8123-123456789abc', sha256: 'a'.repeat(64) },
  },
}
function legacy(program: string) {
  return {
    schemaVersion: 'dsh.analysis-ui/v3',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    recordId: analysisRecordId('report', 'build'),
    title: 'Legacy',
    locale: 'en-US',
    generatedAt: '2026-11-13T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    resources: { daily: resource, other: resource },
    program,
  }
}

for (const [mode, defaults] of [
  ['single', '["2026-11-12"]'],
  ['multiple', '["2026-11-12"]'],
  ['date-range', '["2026-11-12", "2026-11-13"]'],
] as const) {
  test(`legacy ${mode} report preserves source and bound views during migration`, () => {
    const program = `root = Stack([filter, filter, first, second]);
filter = SnapshotFilter("day-filter", "daily", {kind:"column",name:"day"}, "Day", "${mode}", ${defaults});
first = DatasetView("daily", {chart:"table"}, {}, ["day-filter"]);
second = DatasetView("other", {chart:"table"}, {}, [{filter:"day-filter",field:{kind:"column",name:"day"}}]);`
    const original = legacy(program)
    const migrated = parseSavedPresentation(original)
    assert.equal(migrated.schemaVersion, 'dsh.analysis-ui/v4')
    assert.equal(Object.keys(migrated.selectionSources ?? {}).length, 1)
    assert.equal(Object.values(migrated.selectionSources ?? {})[0]?.mode, mode)
    assert.deepEqual(
      Object.values(migrated.selectionSources ?? {})[0]?.defaultValues,
      JSON.parse(defaults),
    )
    const nodes = analysisElements(parseAnalysisProgram(migrated.program))
    const inputs = nodes.filter((node) =>
      ['Select', 'CheckBoxGroup', 'DatePicker'].includes(node.typeName),
    )
    assert.equal(inputs.length, 2)
    assert(
      inputs.every(
        (node) =>
          node.typeName ===
          ({ single: 'Select', multiple: 'CheckBoxGroup', 'date-range': 'DatePicker' } as const)[
            mode
          ],
      ),
    )
    const views = nodes.filter((node) => node.typeName === 'DatasetView')
    assert.equal(views.length, 2)
    assert.deepEqual(views[0]?.props.filters, [
      { source: 'legacy1', selection: { k: 'StateRef', n: '$legacy1' } },
    ])
    assert.deepEqual(views[1]?.props.filters, [
      {
        source: 'legacy1',
        field: { kind: 'column', name: 'day' },
        selection: { k: 'StateRef', n: '$legacy1' },
      },
    ])
    assert.equal(original.program, program)
  })
}

test('legacy report without filters remains readable', () => {
  const migrated = parseSavedPresentation(legacy('root = DatasetView("daily", {chart:"table"});'))
  assert.equal(migrated.schemaVersion, 'dsh.analysis-ui/v4')
})
