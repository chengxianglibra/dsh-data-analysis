import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { z } from 'zod/v4'
import {
  AnalysisViewError,
  validateAnalysisResources,
} from '../../src/presentation/contracts/analysis-document.ts'
import { parseAnalysisProgram } from '../../src/presentation/contracts/analysis-program.ts'
import {
  snapshotFilterBindingSchema,
  snapshotFilterSchema,
} from '../../src/presentation/contracts/snapshot-filter.ts'
import * as f from './frame-fixtures.ts'

// Extracted from analysisLibrary.toJSONSchema() built from commit 25737bc, before
// shared bindings and date-range existed. This is the old reader's generated
// component schema, not a hand-written approximation of its rejection rules.
const oldCatalog = JSON.parse(
  readFileSync(new URL('./fixtures/old-snapshot-filter-catalog.json', import.meta.url), 'utf8'),
) as Record<string, z.core.JSONSchema.JSONSchema>
const oldFilter = z.fromJSONSchema(oldCatalog.snapshotFilter!)
const oldDatasetFilters = z.fromJSONSchema(oldCatalog.datasetFilters!)
const oldFrameFilters = z.fromJSONSchema(oldCatalog.frameFilters!)

const declaration = {
  filterId: 'day',
  ref: 'daily',
  field: { kind: 'column', name: 'day' },
  label: 'Day',
  mode: 'single',
  defaultValues: ['2026-11-13'],
}

test('new reader accepts old filters while the old generated schema rejects each extension', () => {
  assert.equal(oldFilter.safeParse(declaration).success, true)
  assert.equal(snapshotFilterSchema.safeParse(declaration).success, true)
  for (const filters of [oldDatasetFilters, oldFrameFilters])
    assert.equal(filters.safeParse(['day']).success, true)
  assert.equal(snapshotFilterBindingSchema.array().safeParse(['day']).success, true)
  assert.equal(
    parseAnalysisProgram(
      'root = Stack([f, v]);\nf = SnapshotFilter("day", "daily", {kind:"column",name:"day"}, "Day", "single", ["2026-11-13"]);\nv = DatasetView("daily", {chart:"table"}, {}, ["day"]);',
    ).typeName,
    'Stack',
  )

  const range = { ...declaration, mode: 'date-range', defaultValues: ['2026-11-13', '2026-11-13'] }
  const options = { ...declaration, options: { allowAll: false } }
  const binding = [{ filter: 'day', field: { kind: 'column', name: 'other_day' } }]
  assert.equal(snapshotFilterSchema.safeParse(range).success, true)
  assert.equal(snapshotFilterSchema.safeParse(options).success, true)
  assert.equal(snapshotFilterBindingSchema.array().safeParse(binding).success, true)
  assert.equal(oldFilter.safeParse(range).success, false)
  assert.equal(oldFilter.safeParse(options).success, false)
  for (const filters of [oldDatasetFilters, oldFrameFilters])
    assert.equal(filters.safeParse(binding).success, false)
})

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
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
  }
  assert.equal(parseAnalysisProgram(program).typeName, 'Stack')
  assert.throws(
    () => validateAnalysisResources(program, resources),
    (error) =>
      error instanceof AnalysisViewError &&
      error.code === 'analysis-view-target-ambiguous' &&
      error.path === 'v/view',
  )
})
