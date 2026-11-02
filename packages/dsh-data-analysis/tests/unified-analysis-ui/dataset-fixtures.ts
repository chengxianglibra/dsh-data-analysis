import {
  type DatasetSnapshot,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import type { Cell, DatasetColumn } from '../../src/presentation/contracts/types.ts'

export function datasetSnapshot(
  rows: Cell[][] = [
    ['A', '12345678901234.5678'],
    ['B', null],
    ['C', '-2.5000'],
  ],
  columns: DatasetColumn[] = [
    { id: 'category', label: 'Category', type: 'string', nullable: false },
    { id: 'value', label: 'Value', type: 'decimal', nullable: true },
  ],
  complete = true,
): DatasetSnapshot {
  const rowCount = rows.length + (complete ? 0 : 1)
  const snapshot = parseAnalysisSnapshot({
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: '2026-11-02T00:00:00Z',
    source: { kind: 'dataframe', details: 'not-captured' },
    data: {
      schemaVersion: 1,
      columns,
      rows,
      rowCount,
      limit: complete ? 5000 : rows.length,
      truncated: !complete,
    },
    coverage: {
      start: 0,
      totalRows: rowCount,
      capturedRows: rows.length,
      complete,
      columns: columns.map((c) => c.id),
      business: 'unknown',
    },
  })
  if (snapshot.kind !== 'dataset') throw new Error('dataset-required')
  return snapshot
}
