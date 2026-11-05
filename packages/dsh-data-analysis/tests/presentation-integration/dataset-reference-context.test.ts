import assert from 'node:assert/strict'
import test from 'node:test'
import { datasetContext, datasetPointContext } from '../../src/presentation/dataset-reference.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'

test('DataFrame preview preserves empty data and bounds long rows and column metadata', () => {
  const columns = [{ id: 'value', label: 'Value', type: 'string' as const, nullable: false }]
  const empty = datasetContext(datasetSnapshot([], columns))
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.previewTruncated, false)
  const big = datasetSnapshot(
    [['x'.repeat(32_000)], ['y'.repeat(32_000)], ['z'.repeat(32_000)], ['w'.repeat(32_000)]],
    columns,
  )
  const preview = datasetContext(big)
  assert.equal(preview.rows.length, 3)
  assert.equal(preview.savedRows, 4)
  assert.equal(preview.previewTruncated, true)
  const hugeColumns = Array.from({ length: 4 }, (_, i) => ({ ...columns[0]!, id: `col${i}` }))
  const singleHuge = datasetSnapshot([hugeColumns.map(() => 'x'.repeat(30_000))], hugeColumns)
  assert.equal(datasetContext(singleHuge).rows.length, 0)
  assert.equal(datasetContext(singleHuge).previewTruncated, true)
  const manyColumns = Array.from({ length: 64 }, (_, i) => ({
    ...columns[0]!,
    id: `${i}${'\u0001'.repeat(250)}`,
    label: '\u0001'.repeat(256),
    unit: '\u0001'.repeat(128),
  }))
  const wide = datasetContext(datasetSnapshot([manyColumns.map(() => 'v')], manyColumns))
  assert.equal(wide.columnsTruncated, true)
  assert.equal(wide.rows[0]?.length, wide.columns.length)
  assert.ok(Buffer.byteLength(JSON.stringify(wide)) < 185_000)
})

test('DataFrame point context retains the exact selected value and bounds other cells in its row', () => {
  const columns = [
    { id: 'large', label: 'Large', type: 'string' as const, nullable: false },
    { id: 'selection', label: 'Selection', type: 'decimal' as const, nullable: true },
    { id: 'category', label: 'Category', type: 'string' as const, nullable: false },
    { id: 'other', label: 'Other', type: 'string' as const, nullable: false },
  ]
  const snapshot = datasetSnapshot(
    [['x'.repeat(32_000), '9007199254740993.2300', 'A', 'y'.repeat(32_000)]],
    columns,
  )
  const selected = datasetPointContext(snapshot, 0, 'selection')
  assert.equal(selected.value, '9007199254740993.2300')
  assert.equal(selected.column.id, 'selection')
  assert.deepEqual(
    selected.rowContext.map(({ column }) => column.id),
    ['large', 'category'],
  )
  assert.equal(selected.rowContextTruncated, true)
  assert.throws(() => datasetPointContext(snapshot, 1, 'selection'), /dataset-unavailable/)
  assert.throws(() => datasetPointContext(snapshot, 0, 'missing'), /dataset-unavailable/)
  const missing = datasetSnapshot([['x', null, 'A', 'y']], columns)
  assert.throws(() => datasetPointContext(missing, 0, 'selection'), /dataset-unavailable/)
})
