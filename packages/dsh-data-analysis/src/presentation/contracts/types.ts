/** Pure presentation data. No Marivo schema, Node runtime or Host imports. */
import type { PythonCodeRef, PythonCodeSnippet } from '../../python-execution-contracts.ts'

export type { PythonCodeRef, PythonCodeSnippet } from '../../python-execution-contracts.ts'

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
  codeSnippets: 32,
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
/** Captured SQL belongs to an exact persisted producer, never a reconstructed query. */
export interface SqlCodeSnippet {
  language: 'sql'
  text: string
  provenance: 'execution'
  runId: string
  queryId: string
  artifactRef: string
}
export interface SourceCodeSnapshot {
  snippets: SqlCodeSnippet[]
  notices: string[]
}
export type SourceSnapshot = DeclaredSource &
  (
    | {
        status: 'available'
        label: string
        facts: { label: string; value: string }[]
        code?: SourceCodeSnapshot
      }
    | { status: 'unavailable'; reason: string }
  )

export type DraftDataset = (
  | { id: string; kind: 'artifact'; sourceId: string; columns?: string[]; rowLimit: number }
  | { id: string; kind: 'computed'; path: string; sourceIds: string[] }
) & { codeRefs?: PythonCodeRef[] }
export interface DocumentDataset {
  id: string
  origin: 'artifact' | 'computed'
  data: TypedDataset
  sourceIds: string[]
  code?: PythonCodeSnippet[]
}

export type ChartType =
  | 'line'
  | 'area'
  | 'stackedArea'
  | 'sparkline'
  | 'bar'
  | 'horizontalBar'
  | 'stackedBar'
  | 'stackedBar100'
  | 'horizontalStackedBar'
  | 'horizontalStackedBar100'
  | 'histogram'
  | 'boxPlot'
  | 'scatter'
  | 'heatmap'
  | 'pie'
  | 'leaderboard'
  | 'funnel'
  | 'waterfall'

/** Names identify columns containing prepared values, never expressions or statistics. */
export interface ChartBindings {
  binStart?: string
  binEnd?: string
  minimum?: string
  q1?: string
  q3?: string
  maximum?: string
  start?: string
  end?: string
  role?: string
  share?: string
  rank?: string
  denominator?: string
  size?: string
  label?: string
  color?: string
}
export interface ChartOptions {
  showPoints?: 'auto' | 'always' | 'never'
  series?: Record<
    string,
    {
      lineStyle?: 'solid' | 'dashed' | 'dotted'
      role?: 'actual' | 'baseline' | 'target' | 'forecast' | 'plan' | 'comparison'
    }
  >
  valueLabels?: 'none' | 'auto' | 'all'
  referenceLines?: { axis: 'x' | 'y'; value: number; label?: string }[]
}
interface ChartViewFields {
  datasetId: string
  x: string
  y: string[]
  numericMode: 'exact' | 'approximate'
  bindings?: ChartBindings
  options?: ChartOptions
}

type PreparedChart<Type extends ChartType, Keys extends keyof ChartBindings> = {
  chart: Type
  bindings: ChartBindings & Required<Pick<ChartBindings, Keys>>
}

/** Statistical families require prepared bindings at both the type and JSON boundaries. */
export type ChartView = ChartViewFields &
  (
    | {
        chart: Exclude<
          ChartType,
          | 'histogram'
          | 'boxPlot'
          | 'waterfall'
          | 'pie'
          | 'funnel'
          | 'leaderboard'
          | 'stackedBar100'
          | 'horizontalStackedBar100'
        >
      }
    | PreparedChart<'histogram', 'binStart' | 'binEnd'>
    | PreparedChart<'boxPlot', 'minimum' | 'q1' | 'q3' | 'maximum'>
    | PreparedChart<'waterfall', 'start' | 'end' | 'role'>
    | PreparedChart<'pie' | 'funnel', 'share'>
    | PreparedChart<'leaderboard', 'rank'>
    | PreparedChart<'stackedBar100' | 'horizontalStackedBar100', 'denominator'>
  )

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
  | ({
      id: string
      kind: 'chart'
      preparedViews?: (ChartView & { id: string; label: string })[]
    } & ChartView)
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
