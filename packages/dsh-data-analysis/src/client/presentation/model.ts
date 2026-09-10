import type { ChartView } from '../../presentation/contracts/charts.ts'
import { chartNumber, formatCell } from '../../presentation/contracts/index.ts'
import type {
  Cell,
  DatasetColumn,
  DocumentDataset,
  PresentationBlock,
  PresentationDocument,
  PresentationLocale,
  SourceSnapshot,
  TypedDataset,
} from '../../presentation/contracts/types.ts'
import { message, translator } from './../i18n/copy.ts'

export type ReaderMode = 'interactive' | 'static'
export type ChartBlock = Extract<PresentationBlock, { kind: 'chart' }>
export type MetricBlock = Extract<PresentationBlock, { kind: 'metric' }>
export const TABLE_PAGE_SIZE = 20

export function cellText(locale: PresentationLocale, value: Cell, column: DatasetColumn): string {
  return value === ''
    ? translator(locale)('marivo.presentation.empty-string-438')
    : formatCell(value, column)
}

export function valueWithUnit(
  locale: PresentationLocale,
  value: Cell,
  column: DatasetColumn,
): string {
  const text = cellText(locale, value, column)
  return column.unit && value !== null && value !== '' ? `${text} ${column.unit}` : text
}

/** Add grouping separators only; never round, rescale, or convert exact decimal text. */
export function metricText(locale: PresentationLocale, value: Cell, column: DatasetColumn): string {
  const text = cellText(locale, value, column)
  const grouped =
    ['int64', 'decimal', 'float64'].includes(column.type) && /^-?\d+(?:\.\d+)?$/.test(text)
      ? text.replace(/^-?\d+/, (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ','))
      : text
  return column.unit && value !== null && value !== '' ? `${grouped} ${column.unit}` : grouped
}

/** A stable explicit timezone keeps portable and Host metadata equally readable. */
export function snapshotDate(locale: PresentationLocale, value: string): string {
  return (
    new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value)) + ' UTC'
  )
}

export function columnLabel(column: DatasetColumn): string {
  const unit = column.unit?.trim()
  const label = column.label.trimEnd()
  return unit && !label.endsWith(`(${unit})`) && !label.endsWith(`（${unit}）`)
    ? `${column.label} (${unit})`
    : column.label
}

/** Axis labels are compact coordinates; tooltips and tables retain exact source text. */
export function formatAxisTick(locale: PresentationLocale, value: number): string {
  const magnitude = Math.abs(value)
  if (magnitude >= 1e12 || (value !== 0 && magnitude < 0.0001)) return value.toExponential(2)
  return new Intl.NumberFormat(locale, {
    notation: magnitude >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits:
      magnitude >= 100_000
        ? 1
        : magnitude > 0 && magnitude < 1
          ? 2 - Math.floor(Math.log10(magnitude))
          : 2,
  }).format(value)
}

export function formatCategoryTick(value: string): string {
  const characters = [...value]
  return characters.length > 16 ? `${characters.slice(0, 16).join('')}…` : value
}

export function datasetById(document: PresentationDocument, id: string): DocumentDataset {
  const dataset = document.datasets.find((entry) => entry.id === id)
  if (!dataset) throw new Error(`Unknown presentation dataset: ${id}`)
  return dataset
}

export function columnIndex(dataset: TypedDataset, id: string): number {
  const index = dataset.columns.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error(`Unknown presentation column: ${id}`)
  return index
}

export function selectMetric(
  locale: PresentationLocale,
  dataset: TypedDataset,
  block: MetricBlock,
  rowIndices?: readonly number[],
) {
  const index = columnIndex(dataset, block.columnId)
  if (block.rowSelection === 'slice' && rowIndices?.length !== 1)
    throw new Error('Dynamic metric must select exactly one prepared row.')
  const indexOfRow = block.rowSelection === 'slice' ? rowIndices![0]! : block.rowIndex
  const row = dataset.rows[indexOfRow]
  if (!row) throw new Error(`Metric must select one existing row: ${block.rowIndex}`)
  const comparisons = (block.comparisons ?? []).map((comparison) => {
    const read = (id: string | undefined, signed: boolean) => {
      if (!id) return undefined
      const column = dataset.columns[columnIndex(dataset, id)]!
      const value = row[columnIndex(dataset, id)]!
      const sign = value === null ? undefined : decimalParts(String(value)).sign
      return {
        value,
        sign,
        text: `${signed && sign === 1 ? '+' : ''}${metricText(locale, value, column)}`,
      }
    }
    const reference = read(comparison.referenceColumnId, false)
    const delta = read(comparison.deltaColumnId, true)
    const relative = read(comparison.relativeColumnId, true)
    const sign = delta?.sign ?? relative?.sign
    const sentiment = comparison.sentiment ?? 'neutral'
    const tone =
      sign === undefined || sign === 0 || sentiment === 'neutral'
        ? 'neutral'
        : (sign === 1) === (sentiment === 'higher-is-better')
          ? 'positive'
          : 'negative'
    return { label: comparison.label, reference, delta, relative, sign, tone }
  })
  return { column: dataset.columns[index]!, value: row[index]!, comparisons }
}

// Compare decimal text without passing its significand or exponent through Number.
// Padding is bounded by the input length, even for values such as 1e9999999999.
function decimalParts(value: string) {
  const [coefficient = '', exponent = '0'] = value.toLowerCase().split('e')
  const negative = coefficient.startsWith('-')
  const unsigned = negative ? coefficient.slice(1) : coefficient
  const [whole = '', fraction = ''] = unsigned.split('.')
  const digits = `${whole}${fraction}`.replace(/^0+/, '')
  return {
    sign: digits ? (negative ? -1 : 1) : 0,
    digits,
    magnitude: BigInt(digits.length - fraction.length) + BigInt(exponent),
  }
}

export function compareDecimalText(first: string, second: string): number {
  const left = decimalParts(first)
  const right = decimalParts(second)
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1
  if (!left.sign) return 0
  let comparison = 0
  if (left.magnitude !== right.magnitude) comparison = left.magnitude < right.magnitude ? -1 : 1
  else {
    const length = Math.max(left.digits.length, right.digits.length)
    const a = left.digits.padEnd(length, '0')
    const b = right.digits.padEnd(length, '0')
    comparison = a < b ? -1 : a > b ? 1 : 0
  }
  return comparison * left.sign
}

function compareValues(
  locale: PresentationLocale,
  first: Cell,
  second: Cell,
  column: DatasetColumn,
): number {
  if (first === second) return 0
  if (column.type === 'decimal' || column.type === 'int64')
    return compareDecimalText(String(first), String(second))
  if (column.type === 'float64' || column.type === 'boolean') return first! < second! ? -1 : 1
  if (column.type === 'datetime') {
    // Keep sub-millisecond precision while comparing explicit offsets chronologically.
    const micros = (value: Cell) => {
      const text = String(value)
      const fraction = /\.(\d+)(?:Z|[+-])/.exec(text)?.[1] ?? ''
      return BigInt(Date.parse(text)) * 1_000n + BigInt(fraction.padEnd(6, '0').slice(3))
    }
    const a = micros(first)
    const b = micros(second)
    return a < b ? -1 : a > b ? 1 : 0
  }
  return String(first).localeCompare(String(second), locale)
}

export function sortedRowIndices(
  locale: PresentationLocale,
  dataset: TypedDataset,
  sort?: { columnId: string; direction: 'ascending' | 'descending' },
): number[] {
  const rows = dataset.rows.map((_, index) => index)
  if (!sort) return rows
  const column = columnIndex(dataset, sort.columnId)
  return rows.sort((first, second) => {
    const a = dataset.rows[first]![column]!
    const b = dataset.rows[second]![column]!
    // Missing values remain last in both directions; ties keep snapshot order.
    if (a === null || b === null) return a === b ? first - second : a === null ? 1 : -1
    const comparison = compareValues(locale, a, b, dataset.columns[column]!)
    return (sort.direction === 'ascending' ? comparison : -comparison) || first - second
  })
}

export function datasetScope(locale: PresentationLocale, dataset: TypedDataset): string {
  if (dataset.rowCount === 0) return translator(locale)('marivo.presentation.no-data')
  if (dataset.truncated)
    return translator(locale)(
      message('marivo.presentation.showing-value-value-rows-truncated', {
        p0: dataset.rows.length,
        p1: dataset.rowCount,
      }),
    )
  return translator(locale)(message('marivo.presentation.value-rows', { p0: dataset.rowCount }))
}

export interface ChartRow {
  rowIndex: number
  xLabel: string
  [key: string]: number | string | null
}

export function chartRows(
  locale: PresentationLocale,
  dataset: TypedDataset,
  block: ChartView,
  rowIndices?: readonly number[],
): ChartRow[] {
  const x = columnIndex(dataset, block.x)
  const indices = block.y.map((id) => columnIndex(dataset, id))
  return (rowIndices ?? dataset.rows.map((_, i) => i)).map((rowIndex) => {
    const row = dataset.rows[rowIndex]!
    const result: ChartRow = { rowIndex, xLabel: cellText(locale, row[x]!, dataset.columns[x]!) }
    indices.forEach((index, series) => {
      result[`series${series}`] = chartNumber(
        row[index]!,
        dataset.columns[index]!,
        block.numericMode,
      )
    })
    return result
  })
}

export function chartTitle(
  locale: PresentationLocale,
  dataset: TypedDataset,
  block: ChartView,
): string {
  const x = dataset.columns[columnIndex(dataset, block.x)]!
  const y = block.y.map((id) => dataset.columns[columnIndex(dataset, id)]!.label)
  return `${y.join(locale === 'zh-CN' ? '、' : ', ')} · ${x.label}`
}

export function selectedSources(document: PresentationDocument, ids: string[]): SourceSnapshot[] {
  return ids.map((id) => {
    const source = document.sources.find((entry) => entry.id === id)
    if (!source) throw new Error(`Unknown presentation source: ${id}`)
    return source
  })
}

export { followUpContext } from './context-reference.ts'
