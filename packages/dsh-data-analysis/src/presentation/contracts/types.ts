/** Pure presentation data. No Marivo schema, Node runtime or Host imports. */
export const PRESENTATION_BUDGETS = {
  documentBytes: 4 * 1024 * 1024,
  datasetBytes: 2 * 1024 * 1024,
  datasets: 16,
  columns: 64,
  rows: 5_000,
  cells: 100_000,
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

export type PresentationLocale = 'zh-CN' | 'en-US'

export type PresentationAsset = 'presentation.json'
export interface PresentationFile<Asset extends PresentationAsset = PresentationAsset> {
  asset: Asset
  path: string
  sha256: string
  bytes: number
}
/** Session and Turn belong to the Host delivery envelope, not to the file identity. */
export interface PresentationReceipt {
  schemaVersion: 2
  reportId: string
  kind: 'marivo.presentation'
  workspaceId: string
  buildId: string
  title: string
  summary: string
  files: {
    document: PresentationFile<'presentation.json'>
  }
}
