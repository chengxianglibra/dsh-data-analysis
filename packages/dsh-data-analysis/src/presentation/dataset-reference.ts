import { createHash } from 'node:crypto'
import type { AnalysisDocument } from './contracts/analysis-document.ts'
import type { AnyDatasetRequest, DatasetEnvelope } from './contracts/dataset-reference.ts'

/** Read only the DataFrame bound to the fixed saved document. */
export function datasetFromDocument(document: AnalysisDocument, request: AnyDatasetRequest) {
  const resource = document.resources[request.resourceName]
  if (
    document.workspaceId !== request.workspaceId ||
    document.recordId !== request.recordId ||
    resource?.kind !== 'snapshot' ||
    resource.snapshot.kind !== 'dataset'
  )
    throw new Error('dataset-unavailable')
  const snapshot = resource.snapshot
  if ('row' in request) {
    const row = snapshot.data.rows[request.row]
    const index = snapshot.data.columns.findIndex((column) => column.id === request.field)
    if (!row || index < 0 || row[index] == null) throw new Error('dataset-unavailable')
  }
  const digest = createHash('sha256')
    .update(JSON.stringify('row' in request ? [snapshot, request.row, request.field] : snapshot))
    .digest('hex')
  const envelope: DatasetEnvelope =
    'row' in request
      ? { ...request, schema: 'dsh-data-analysis-dataset-point/v1', digest }
      : { ...request, schema: 'dsh-data-analysis-dataset/v1', digest }
  return { envelope, snapshot }
}

/** Include the exact selected value and a bounded, explicitly marked same-row context. */
export function datasetPointContext(
  snapshot: ReturnType<typeof datasetFromDocument>['snapshot'],
  rowIndex: number,
  field: string,
) {
  const index = snapshot.data.columns.findIndex((column) => column.id === field)
  const row = snapshot.data.rows[rowIndex]
  if (!row || index < 0 || row[index] == null) throw new Error('dataset-unavailable')
  const context: { column: (typeof snapshot.data.columns)[number]; value: (typeof row)[number] }[] =
    []
  let bytes = 0
  for (let i = 0; i < snapshot.data.columns.length; i++) {
    if (i === index) continue
    const entry = { column: snapshot.data.columns[i]!, value: row[i]! }
    const size = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1
    if (bytes + size > 4_000) continue
    context.push(entry)
    bytes += size
  }
  const { columns: _coverageColumns, ...coverage } = snapshot.coverage
  return {
    row: rowIndex,
    column: snapshot.data.columns[index]!,
    value: row[index]!,
    rowContext: context,
    rowContextTruncated: context.length < snapshot.data.columns.length - 1,
    coverage,
  }
}
