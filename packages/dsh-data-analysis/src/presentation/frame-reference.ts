import type { AnalysisDocument } from './contracts/analysis-document.ts'
import type { ComponentRequest } from './contracts/component-reference.ts'
import { isFrameSnapshotV2 } from './contracts/snapshot.ts'

/** Bind the complete saved Frame to its fixed Build, including empty snapshots. */
export function frameFromDocument(document: AnalysisDocument, request: ComponentRequest) {
  const resource = document.resources[request.resourceName]
  if (
    document.workspaceId !== request.workspaceId ||
    document.recordId !== request.recordId ||
    resource?.kind !== 'snapshot' ||
    !isFrameSnapshotV2(resource.snapshot)
  )
    throw new Error('frame-unavailable')
  const snapshot = resource.snapshot
  return { snapshot }
}

/** Omit oversized metadata as a whole; never silently return incomplete semantics. */
function bounded<T>(value: T, budget: number): { value: T | null; truncated: boolean } {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= budget
    ? { value, truncated: false }
    : { value: null, truncated: true }
}

export function frameContext(snapshot: ReturnType<typeof frameFromDocument>['snapshot']) {
  const columns: typeof snapshot.data.columns = []
  let columnBytes = 0
  for (const column of snapshot.data.columns) {
    const size = Buffer.byteLength(JSON.stringify(column), 'utf8') + 1
    if (columnBytes + size > 30_000) break
    columns.push(column)
    columnBytes += size
  }
  const rows: typeof snapshot.data.rows = []
  let rowBytes = 0
  for (const row of snapshot.data.rows) {
    const preview = row.slice(0, columns.length)
    const size = Buffer.byteLength(JSON.stringify(preview), 'utf8') + 1
    if (rowBytes + size > 50_000) break
    rows.push(preview)
    rowBytes += size
  }
  // Coordinate arrays are kept aligned to preview rows, separately bounded.
  const coordinates = bounded(
    Object.fromEntries(
      Object.entries(snapshot.frame.coordinates).map(([key, coordinate]) => [
        key,
        { column: coordinate.column, values: coordinate.values.slice(0, rows.length) },
      ]),
    ),
    20_000,
  )
  const metadata = bounded(
    {
      inputId: snapshot.frame.inputId,
      description: snapshot.frame.description,
      fields: snapshot.frame.fields,
      layout: snapshot.frame.layout,
      slots: snapshot.frame.slots,
      axes: snapshot.frame.axes,
    },
    25_000,
  )
  const sections = bounded(snapshot.frame.sections, 40_000)
  const { columns: _coverageColumns, ...coverage } = snapshot.coverage
  return {
    marivoFrame: { sessionId: snapshot.source.sessionId, artifactId: snapshot.source.artifactId },
    coverage,
    metadata,
    sections,
    coordinates,
    columns,
    rows,
    previewColumns: columns.length,
    savedColumns: snapshot.data.columns.length,
    columnsTruncated: columns.length < snapshot.data.columns.length,
    previewRows: rows.length,
    savedRows: snapshot.data.rows.length,
    previewTruncated: rows.length < snapshot.data.rows.length,
  }
}
