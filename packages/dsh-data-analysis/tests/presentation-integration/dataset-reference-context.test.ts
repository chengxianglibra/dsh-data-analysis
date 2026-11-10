import assert from 'node:assert/strict'
import test from 'node:test'
import { datasetPointContext } from '../../src/presentation/dataset-reference.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'

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
    ['category'],
  )
  assert.equal(selected.rowContextTruncated, true)
  const numericKey = datasetSnapshot(
    [['42', '9007199254740993.2300']],
    [{ id: 'account', label: 'Account', type: 'int64', nullable: false }, columns[1]!],
  )
  assert.equal(datasetPointContext(numericKey, 0, 'selection').rowContext[0]?.value, '42')
  assert.throws(() => datasetPointContext(snapshot, 1, 'selection'), /dataset-unavailable/)
  assert.throws(() => datasetPointContext(snapshot, 0, 'missing'), /dataset-unavailable/)
  const missing = datasetSnapshot([['x', null, 'A', 'y']], columns)
  assert.throws(() => datasetPointContext(missing, 0, 'selection'), /dataset-unavailable/)
})
