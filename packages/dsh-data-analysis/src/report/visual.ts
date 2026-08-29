import type { JsonValue } from '@deepseek-ai/dsh-session'
import { type CompiledSessionDag, compileSessionDag } from './dag.ts'
import type {
  ChartBlock,
  ReportDocument,
  ReportIssue,
  ReportVisualCandidate,
  TableBlock,
} from './document.ts'
import type {
  ReportArtifactColumn,
  ReportArtifactProjection,
  ReportComputedProjection,
  ReportProjectionBundle,
} from './projection.ts'
import { reportTimeEpoch } from './time.ts'

export interface ReportDisplayDataset {
  readonly id: string
  readonly kind: 'artifact' | 'computed'
  readonly columns: readonly ReportArtifactColumn[]
  readonly rows: readonly (readonly JsonValue[])[]
  readonly artifact?: ReportArtifactProjection
  readonly computed?: ReportComputedProjection
}

export interface CompiledChartBlock {
  readonly block: ChartBlock
  readonly dataset: ReportDisplayDataset
  readonly view: 'line' | 'bar'
  readonly x: string
  readonly y: string
  readonly points: readonly { readonly x: JsonValue; readonly y: number }[]
}

export interface CompiledTableBlock {
  readonly block: TableBlock
  readonly dataset: ReportDisplayDataset
  readonly columns: readonly string[]
  readonly rows: readonly (readonly JsonValue[])[]
  readonly totalRows: number
  readonly omittedRows: number
}

export interface CompiledReport {
  readonly document: ReportDocument
  readonly projection: ReportProjectionBundle
  readonly charts: ReadonlyMap<string, CompiledChartBlock>
  readonly tables: ReadonlyMap<string, CompiledTableBlock>
  readonly sessionDag: CompiledSessionDag
  readonly disclosures: readonly string[]
}

export type CompileVisualResult =
  | { readonly ok: true; readonly value: CompiledReport }
  | { readonly ok: false; readonly issues: readonly ReportIssue[] }

export interface ReportVisualPreflight {
  readonly issues: readonly ReportIssue[]
  readonly checkedCount: number
  readonly skippedCount: number
}

function reportIssue(code: string, location: string, message: string, repair: string): ReportIssue {
  return { code, location, message, repair }
}

function numeric(column: ReportArtifactColumn): boolean {
  return /(?:^|\b)(?:u?int\d*|float\d*|double|decimal|number|numeric)(?:\b|$)/i.test(column.dtype)
}

function category(column: ReportArtifactColumn): boolean {
  return column.role === 'dimension'
}

function ordered(column: ReportArtifactColumn): boolean {
  return column.role === 'time' || (column.role === 'dimension' && numeric(column))
}

function measure(column: ReportArtifactColumn): boolean {
  return (column.role === 'value' || column.role === 'measure') && numeric(column)
}

function columnIndex(dataset: ReportDisplayDataset, name: string): number {
  return dataset.columns.findIndex((column) => column.name === name)
}

function comparableKey(value: JsonValue): string {
  return JSON.stringify(value)
}

function sortedPoints(
  dataset: ReportDisplayDataset,
  view: 'line' | 'bar',
  xColumn: ReportArtifactColumn,
  xIndex: number,
  yIndex: number,
  location: string,
  issues: ReportIssue[],
): { x: JsonValue; y: number }[] | undefined {
  const points: { x: JsonValue; y: number; order?: number }[] = []
  const seen = new Set<string>()
  for (const [rowIndex, row] of dataset.rows.entries()) {
    const x = row[xIndex]
    const y = row[yIndex]
    if (x === undefined || x === null || typeof x === 'object') {
      issues.push(
        reportIssue(
          'invalid-chart-x',
          `${location}.data_ref`,
          `Chart x contains an empty or structured value at row ${rowIndex}.`,
          'Produce a data source with complete scalar x values.',
        ),
      )
      return undefined
    }
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      issues.push(
        reportIssue(
          'invalid-chart-y',
          `${location}.data_ref`,
          `Chart y contains a non-finite numeric value at row ${rowIndex}.`,
          'Produce a data source with complete finite numeric y values.',
        ),
      )
      return undefined
    }
    let key = comparableKey(x)
    let order: number | undefined
    if (view === 'line' && xColumn.role === 'time') {
      order = reportTimeEpoch(x)
      if (order === undefined) {
        issues.push(
          reportIssue(
            'invalid-chart-x',
            `${location}.data_ref`,
            `Chart time x contains an invalid ISO date/time at row ${rowIndex}.`,
            'Produce a data source with complete ISO date/time x values.',
          ),
        )
        return undefined
      }
      key = `time:${String(order)}`
    } else if (view === 'line') {
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        issues.push(
          reportIssue(
            'invalid-chart-x',
            `${location}.data_ref`,
            `Chart ordered x contains a non-finite numeric value at row ${rowIndex}.`,
            'Produce a data source with complete finite numeric x values.',
          ),
        )
        return undefined
      }
      order = Object.is(x, -0) ? 0 : x
      key = `number:${String(order)}`
    }
    if (seen.has(key)) {
      issues.push(
        reportIssue(
          'duplicate-chart-x',
          `${location}.data_ref`,
          `Chart x value ${String(x)} is not unique.`,
          'Produce one row per x value; the renderer will not aggregate rows.',
        ),
      )
      return undefined
    }
    seen.add(key)
    points.push({ x, y, ...(order === undefined ? {} : { order }) })
  }
  if (view === 'line') points.sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  return points.map(({ x, y }) => ({ x, y }))
}

function mixedGrain(dataset: ReportDisplayDataset, x: string): string | undefined {
  for (const [index, column] of dataset.columns.entries()) {
    if (column.name === x || (column.role !== 'time' && column.role !== 'dimension')) continue
    const values = new Set(dataset.rows.map((row) => comparableKey(row[index] ?? null)))
    if (values.size > 1) return column.name
  }
  return undefined
}

function compileChart(
  block: ChartBlock,
  dataset: ReportDisplayDataset,
  location: string,
  issues: ReportIssue[],
): CompiledChartBlock | undefined {
  let view: 'line' | 'bar' | undefined
  let x: string | undefined = block.x
  let y: string | undefined = block.y
  if (block.view === 'auto') {
    const lineX = dataset.columns.filter(ordered)
    const barX = dataset.columns.filter(category)
    const values = dataset.columns.filter(measure)
    const line = lineX.length === 1 && values.length === 1
    const bar = barX.length === 1 && values.length === 1
    if (line === bar) {
      issues.push(
        reportIssue(
          'auto-chart-ambiguous',
          `${location}.view`,
          'auto could not select one unique line or bar mapping from the data source contract.',
          'Specify view, x, and y explicitly, or use a table block.',
        ),
      )
      return undefined
    }
    view = line ? 'line' : 'bar'
    x = (line ? lineX[0] : barX[0])?.name
    y = values[0]?.name
  } else {
    view = block.view
  }
  if (x === undefined || y === undefined || view === undefined) return undefined
  const xIndex = columnIndex(dataset, x)
  const yIndex = columnIndex(dataset, y)
  if (xIndex < 0 || yIndex < 0) {
    const missing = [xIndex < 0 ? x : undefined, yIndex < 0 ? y : undefined]
      .filter(Boolean)
      .join(', ')
    issues.push(
      reportIssue(
        'chart-column-not-found',
        location,
        `Chart columns are not public data source columns: ${missing}.`,
        'Use exact names from the data source columns.',
      ),
    )
    return undefined
  }
  const xColumn = dataset.columns[xIndex]
  const yColumn = dataset.columns[yIndex]
  if (xColumn === undefined || yColumn === undefined || !numeric(yColumn)) {
    issues.push(
      reportIssue(
        'chart-y-not-numeric',
        `${location}.y`,
        `Chart y column ${JSON.stringify(y)} is not numeric.`,
        'Choose a numeric data source column.',
      ),
    )
    return undefined
  }
  if (view === 'line' && !ordered(xColumn)) {
    issues.push(
      reportIssue(
        'line-x-not-ordered',
        `${location}.x`,
        `Line x column ${JSON.stringify(x)} is not a time or ordered numeric dimension.`,
        'Choose a time or ordered numeric dimension, or use a bar/table block.',
      ),
    )
    return undefined
  }
  if (view === 'bar' && !category(xColumn)) {
    issues.push(
      reportIssue(
        'bar-x-not-category',
        `${location}.x`,
        `Bar x column ${JSON.stringify(x)} is not a categorical dimension.`,
        'Choose a public dimension column, or use a line/table block.',
      ),
    )
    return undefined
  }
  const grain = mixedGrain(dataset, x)
  if (grain !== undefined) {
    issues.push(
      reportIssue(
        'mixed-chart-grain',
        `${location}.data_ref`,
        `Data source varies across additional grain column ${JSON.stringify(grain)}.`,
        'Produce one row per selected x/y chart grain.',
      ),
    )
    return undefined
  }
  const points = sortedPoints(dataset, view, xColumn, xIndex, yIndex, location, issues)
  if (points === undefined) return undefined
  if (points.length === 0) {
    issues.push(
      reportIssue(
        'chart-empty',
        `${location}.data_ref`,
        'Chart data source has no rows to render.',
        'Use a non-empty data source or replace the chart with narrative text.',
      ),
    )
    return undefined
  }
  return { block, dataset, view, x, y, points }
}

function compileTable(
  block: TableBlock,
  dataset: ReportDisplayDataset,
  location: string,
  issues: ReportIssue[],
): CompiledTableBlock | undefined {
  const selected = block.columns ?? dataset.columns.map((column) => column.name)
  const indexes = selected.map((column) => columnIndex(dataset, column))
  if (indexes.some((index) => index < 0)) {
    const missing = selected.filter((_column, index) => indexes[index] === -1)
    issues.push(
      reportIssue(
        'table-column-not-found',
        `${location}.columns`,
        `Table columns are not public data source columns: ${missing.join(', ')}.`,
        'Use exact names from the data source columns.',
      ),
    )
    return undefined
  }
  const totalRows = dataset.rows.length
  const rows = dataset.rows
    .slice(0, block.max_rows)
    .map((row) => indexes.map((index) => row[index] ?? null))
  const omittedRows = totalRows - rows.length
  return { block, dataset, columns: selected, rows, totalRows, omittedRows }
}

function displayDatasets(
  document: ReportDocument,
  projection: ReportProjectionBundle,
): ReadonlyMap<string, ReportDisplayDataset> {
  const artifacts = new Map(projection.artifacts.map((artifact) => [artifact.ref, artifact]))
  const computed = new Map(projection.computed.map((item) => [item.id, item]))
  const result = new Map<string, ReportDisplayDataset>()
  for (const source of document.data ?? []) {
    if ('artifact_ref' in source) {
      const artifact = artifacts.get(source.artifact_ref)
      if (artifact !== undefined)
        result.set(source.id, {
          id: source.id,
          kind: 'artifact',
          columns: artifact.columns,
          rows: artifact.rows,
          artifact,
        })
      continue
    }
    const item = computed.get(source.id)
    if (item !== undefined)
      result.set(source.id, {
        id: source.id,
        kind: 'computed',
        columns: item.columns,
        rows: item.rows,
        computed: item,
      })
  }
  return result
}

/** Check every visual candidate whose exact data projection is available. */
export function preflightReportVisuals(
  candidates: readonly ReportVisualCandidate[],
  document: ReportDocument,
  projection: ReportProjectionBundle,
): ReportVisualPreflight {
  const datasets = displayDatasets(document, projection)
  const issues: ReportIssue[] = []
  let checkedCount = 0
  let skippedCount = 0
  for (const candidate of candidates) {
    const dataset = datasets.get(candidate.block.data_ref)
    if (dataset === undefined) {
      skippedCount += 1
      continue
    }
    checkedCount += 1
    if (candidate.block.kind === 'chart')
      compileChart(candidate.block, dataset, candidate.location, issues)
    else compileTable(candidate.block, dataset, candidate.location, issues)
  }
  return { issues, checkedCount, skippedCount }
}

/** Admit every data block without aggregating, sampling, or changing its rows. */
export function compileReportVisuals(
  document: ReportDocument,
  projection: ReportProjectionBundle,
): CompileVisualResult {
  const datasets = displayDatasets(document, projection)
  const charts = new Map<string, CompiledChartBlock>()
  const tables = new Map<string, CompiledTableBlock>()
  const issues: ReportIssue[] = []
  const disclosures: string[] = []
  for (const [sectionIndex, section] of document.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      const location = `document.sections[${sectionIndex}].blocks[${blockIndex}]`
      if (block.kind !== 'chart' && block.kind !== 'table') continue
      const dataset = datasets.get(block.data_ref)
      if (dataset === undefined) {
        issues.push(
          reportIssue(
            'data-projection-missing',
            `${location}.data_ref`,
            `No checked projection exists for ${JSON.stringify(block.data_ref)}.`,
            'Use a registered data source and retry the complete report.',
          ),
        )
        continue
      }
      if (block.kind === 'chart') {
        const compiled = compileChart(block, dataset, location, issues)
        if (compiled !== undefined) charts.set(block.id, compiled)
      } else {
        const compiled = compileTable(block, dataset, location, issues)
        if (compiled !== undefined) {
          if (compiled.omittedRows > 0)
            disclosures.push(
              `Table ${block.id} displays ${compiled.rows.length} of ${compiled.totalRows} rows and omits ${compiled.omittedRows}.`,
            )
          tables.set(block.id, compiled)
        }
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues }
  const dag = compileSessionDag(projection.sessionDag)
  if (!dag.ok) return { ok: false, issues: dag.issues }
  return {
    ok: true,
    value: { document, projection, charts, tables, sessionDag: dag.value, disclosures },
  }
}
