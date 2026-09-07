/** Pure presentation data. No Marivo schema, Node runtime or Host imports. */
export const PRESENTATION_SCHEMA_VERSION = 1 as const

export const PRESENTATION_BUDGETS = {
  documentBytes: 4 * 1024 * 1024,
  draftBytes: 256 * 1024,
  datasetBytes: 2 * 1024 * 1024,
  htmlBytes: 8 * 1024 * 1024,
  datasets: 16,
  columns: 64,
  rows: 5_000,
  cells: 100_000,
  sources: 64,
  blocks: 64,
  text: 32_768,
} as const

export type ColumnType =
  | 'string'
  | 'boolean'
  | 'float64'
  | 'int64'
  | 'decimal'
  | 'date'
  | 'datetime'
export type Cell = string | boolean | number | null
export interface DatasetColumn {
  id: string
  label: string
  type: ColumnType
  nullable: boolean
  unit?: string
}

/** int64/decimal are exact strings; datetime always includes an explicit offset. */
export interface TypedDataset {
  schemaVersion: 1
  columns: DatasetColumn[]
  rows: Cell[][]
  rowCount: number
  limit: number
  truncated: boolean
}

export interface SourceRef {
  sessionId: string
  artifactRef: string
  findingId?: string
}
export interface DeclaredSource {
  id: string
  ref: SourceRef
}
export type SourceSnapshot = DeclaredSource &
  (
    | { status: 'available'; label: string; facts: { label: string; value: string }[] }
    | { status: 'unavailable'; reason: string }
  )

export type DraftDataset =
  | { id: string; kind: 'artifact'; sourceId: string; columns?: string[]; rowLimit: number }
  | { id: string; kind: 'computed'; path: string; sourceIds: string[] }
export interface DocumentDataset {
  id: string
  origin: 'artifact' | 'computed'
  data: TypedDataset
  sourceIds: string[]
}

export type PresentationBlock =
  | { id: string; kind: 'markdown'; text: string }
  | {
      id: string
      kind: 'metric'
      datasetId: string
      columnId: string
      rowIndex: number
      label: string
    }
  | {
      id: string
      kind: 'chart'
      datasetId: string
      chart: 'line' | 'bar'
      x: string
      y: string[]
      numericMode: 'exact' | 'approximate'
    }
  | { id: string; kind: 'table'; datasetId: string; columns?: string[] }
  | { id: string; kind: 'source'; sourceIds: string[] }

export interface PresentationDraft {
  schemaVersion: 1
  title: string
  datasets: DraftDataset[]
  sources: DeclaredSource[]
  blocks: PresentationBlock[]
}
export interface PresentationDiagnostic {
  code: string
  path: string
  message: string
}
export interface PresentationDocument {
  schemaVersion: 1
  workspaceId: string
  buildId: string
  title: string
  generatedAt: string
  datasets: DocumentDataset[]
  sources: SourceSnapshot[]
  blocks: PresentationBlock[]
  diagnostics: PresentationDiagnostic[]
}

export type PresentationAsset = 'presentation.json' | 'index.html'
export interface PresentationFile<Asset extends PresentationAsset = PresentationAsset> {
  asset: Asset
  path: string
  sha256: string
  bytes: number
}
/** Session and Turn belong to the Host delivery envelope, not to the file identity. */
export interface PresentationReceipt {
  schemaVersion: 1
  kind: 'marivo.presentation'
  workspaceId: string
  buildId: string
  title: string
  summary: string
  files: {
    document: PresentationFile<'presentation.json'>
    html: PresentationFile<'index.html'>
  }
}
