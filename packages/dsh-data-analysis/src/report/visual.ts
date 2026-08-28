import type { JsonValue } from '@deepseek-ai/dsh-session'
import { type CompiledSessionDag, compileSessionDag } from './dag.ts'
import type {
  ChartBlockV1,
  ReportDocumentV1,
  ReportIssueV1,
  ReportVisualCandidate,
  TableBlockV1,
} from './document.ts'
import type {
  ReportArtifactColumn,
  ReportArtifactProjection,
  ReportProjectionBundle,
} from './projection.ts'
import { reportTimeEpoch } from './time.ts'

export interface CompiledChartBlock {
  readonly block: ChartBlockV1
  readonly artifact: ReportArtifactProjection
  readonly view: 'line' | 'bar'
  readonly x: string
  readonly y: string
  readonly points: readonly { readonly x: JsonValue; readonly y: number }[]
}

export interface CompiledTableBlock {
  readonly block: TableBlockV1
  readonly artifact: ReportArtifactProjection
  readonly columns: readonly string[]
  readonly rows: readonly (readonly JsonValue[])[]
  readonly totalRows: number
  readonly omittedRows: number
}

export interface CompiledReport {
  readonly document: ReportDocumentV1
  readonly projection: ReportProjectionBundle
  readonly charts: ReadonlyMap<string, CompiledChartBlock>
  readonly tables: ReadonlyMap<string, CompiledTableBlock>
  readonly sessionDag: CompiledSessionDag
  readonly disclosures: readonly string[]
}

export type CompileVisualResult =
  | { readonly ok: true; readonly value: CompiledReport }
  | { readonly ok: false; readonly issues: readonly ReportIssueV1[] }

export interface ReportVisualPreflight {
  readonly issues: readonly ReportIssueV1[]
  readonly checkedCount: number
  readonly skippedCount: number
}

function reportIssue(
  code: string,
  location: string,
  message: string,
  repair: string,
): ReportIssueV1 {
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

function columnIndex(artifact: ReportArtifactProjection, name: string): number {
  return artifact.columns.findIndex((column) => column.name === name)
}

function comparableKey(value: JsonValue): string {
  return JSON.stringify(value)
}

function sortedPoints(
  artifact: ReportArtifactProjection,
  view: 'line' | 'bar',
  xColumn: ReportArtifactColumn,
  xIndex: number,
  yIndex: number,
  location: string,
  issues: ReportIssueV1[],
): { x: JsonValue; y: number }[] | undefined {
  const points: { x: JsonValue; y: number; order?: number }[] = []
  const seen = new Set<string>()
  for (const [rowIndex, row] of artifact.rows.entries()) {
    const x = row[xIndex]
    const y = row[yIndex]
    if (x === undefined || x === null || typeof x === 'object') {
      issues.push(
        reportIssue(
          'invalid-chart-x',
          `${location}.artifact_ref`,
          `Chart x contains an empty or structured value at row ${rowIndex}.`,
          'Produce an Artifact with complete scalar x values.',
        ),
      )
      return undefined
    }
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      issues.push(
        reportIssue(
          'invalid-chart-y',
          `${location}.artifact_ref`,
          `Chart y contains a non-finite numeric value at row ${rowIndex}.`,
          'Produce an Artifact with complete finite numeric y values.',
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
            `${location}.artifact_ref`,
            `Chart time x contains an invalid ISO date/time at row ${rowIndex}.`,
            'Produce an Artifact with complete ISO date/time x values.',
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
            `${location}.artifact_ref`,
            `Chart ordered x contains a non-finite numeric value at row ${rowIndex}.`,
            'Produce an Artifact with complete finite numeric x values.',
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
          `${location}.artifact_ref`,
          `Chart x value ${String(x)} is not unique.`,
          'Produce an Artifact at one row per x value; the renderer will not aggregate rows.',
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

function mixedGrain(artifact: ReportArtifactProjection, x: string): string | undefined {
  for (const [index, column] of artifact.columns.entries()) {
    if (column.name === x || (column.role !== 'time' && column.role !== 'dimension')) continue
    const values = new Set(artifact.rows.map((row) => comparableKey(row[index] ?? null)))
    if (values.size > 1) return column.name
  }
  return undefined
}

function compileChart(
  block: ChartBlockV1,
  artifact: ReportArtifactProjection,
  location: string,
  issues: ReportIssueV1[],
): CompiledChartBlock | undefined {
  let view: 'line' | 'bar' | undefined
  let x: string | undefined = block.x
  let y: string | undefined = block.y
  if (block.view === 'auto') {
    const lineX = artifact.columns.filter(ordered)
    const barX = artifact.columns.filter(category)
    const values = artifact.columns.filter(measure)
    const line = lineX.length === 1 && values.length === 1
    const bar = barX.length === 1 && values.length === 1
    if (line === bar) {
      issues.push(
        reportIssue(
          'auto-chart-ambiguous',
          `${location}.view`,
          'auto could not select one unique line or bar mapping from the Artifact contract.',
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
  const xIndex = columnIndex(artifact, x)
  const yIndex = columnIndex(artifact, y)
  if (xIndex < 0 || yIndex < 0) {
    const missing = [xIndex < 0 ? x : undefined, yIndex < 0 ? y : undefined]
      .filter(Boolean)
      .join(', ')
    issues.push(
      reportIssue(
        'chart-column-not-found',
        location,
        `Chart columns are not public Artifact columns: ${missing}.`,
        'Use exact names from artifact.contract().artifact_schema.columns.',
      ),
    )
    return undefined
  }
  const xColumn = artifact.columns[xIndex]
  const yColumn = artifact.columns[yIndex]
  if (xColumn === undefined || yColumn === undefined || !numeric(yColumn)) {
    issues.push(
      reportIssue(
        'chart-y-not-numeric',
        `${location}.y`,
        `Chart y column ${JSON.stringify(y)} is not numeric.`,
        'Choose a numeric public Artifact column.',
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
  const grain = mixedGrain(artifact, x)
  if (grain !== undefined) {
    issues.push(
      reportIssue(
        'mixed-chart-grain',
        `${location}.artifact_ref`,
        `Artifact varies across additional grain column ${JSON.stringify(grain)}.`,
        'Produce an Artifact with one grain for the selected x/y chart.',
      ),
    )
    return undefined
  }
  const points = sortedPoints(artifact, view, xColumn, xIndex, yIndex, location, issues)
  if (points === undefined) return undefined
  if (points.length === 0) {
    issues.push(
      reportIssue(
        'chart-empty',
        `${location}.artifact_ref`,
        'Chart Artifact has no rows to render.',
        'Use a non-empty Artifact or replace the chart with narrative text.',
      ),
    )
    return undefined
  }
  return { block, artifact, view, x, y, points }
}

function compileTable(
  block: TableBlockV1,
  artifact: ReportArtifactProjection,
  location: string,
  issues: ReportIssueV1[],
  disclosures: string[],
): CompiledTableBlock | undefined {
  const selected = block.columns ?? artifact.columns.map((column) => column.name)
  const indexes = selected.map((column) => columnIndex(artifact, column))
  if (indexes.some((index) => index < 0)) {
    const missing = selected.filter((_column, index) => indexes[index] === -1)
    issues.push(
      reportIssue(
        'table-column-not-found',
        `${location}.columns`,
        `Table columns are not public Artifact columns: ${missing.join(', ')}.`,
        'Use exact names from artifact.contract().artifact_schema.columns.',
      ),
    )
    return undefined
  }
  const totalRows = artifact.rows.length
  const rows = artifact.rows
    .slice(0, block.max_rows)
    .map((row) => indexes.map((index) => row[index] ?? null))
  const omittedRows = totalRows - rows.length
  if (omittedRows > 0)
    disclosures.push(
      `Table ${block.id} displays ${rows.length} of ${totalRows} rows and omits ${omittedRows}.`,
    )
  return { block, artifact, columns: selected, rows, totalRows, omittedRows }
}

/** Check every visual candidate whose exact Artifact projection is available. */
export function preflightReportVisuals(
  candidates: readonly ReportVisualCandidate[],
  projection: ReportProjectionBundle,
): ReportVisualPreflight {
  const artifacts = new Map(projection.artifacts.map((artifact) => [artifact.ref, artifact]))
  const issues: ReportIssueV1[] = []
  const disclosures: string[] = []
  let checkedCount = 0
  let skippedCount = 0
  for (const candidate of candidates) {
    const artifact = artifacts.get(candidate.block.artifact_ref)
    if (artifact === undefined) {
      skippedCount += 1
      continue
    }
    checkedCount += 1
    if (candidate.block.kind === 'chart') {
      compileChart(candidate.block, artifact, candidate.location, issues)
    } else {
      compileTable(candidate.block, artifact, candidate.location, issues, disclosures)
    }
  }
  return { issues, checkedCount, skippedCount }
}

/** Admit every data block without aggregating, sampling, or changing the Artifact rows. */
export function compileReportVisuals(
  document: ReportDocumentV1,
  projection: ReportProjectionBundle,
): CompileVisualResult {
  const artifacts = new Map(projection.artifacts.map((artifact) => [artifact.ref, artifact]))
  const charts = new Map<string, CompiledChartBlock>()
  const tables = new Map<string, CompiledTableBlock>()
  const issues: ReportIssueV1[] = []
  const disclosures: string[] = []
  for (const [sectionIndex, section] of document.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      const location = `document.sections[${sectionIndex}].blocks[${blockIndex}]`
      if (block.kind !== 'chart' && block.kind !== 'table') continue
      const artifact = artifacts.get(block.artifact_ref)
      if (artifact === undefined) {
        issues.push(
          reportIssue(
            'artifact-projection-missing',
            `${location}.artifact_ref`,
            `No checked projection exists for ${JSON.stringify(block.artifact_ref)}.`,
            'Use the exact canonical Artifact ref and retry the complete report.',
          ),
        )
        continue
      }
      if (block.kind === 'chart') {
        const compiled = compileChart(block, artifact, location, issues)
        if (compiled !== undefined) charts.set(block.id, compiled)
      } else {
        const compiled = compileTable(block, artifact, location, issues, disclosures)
        if (compiled !== undefined) tables.set(block.id, compiled)
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
