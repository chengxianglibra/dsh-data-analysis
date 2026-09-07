import { chartNumber, formatCell } from '../../presentation/contracts/index.ts'
import type {
  Cell,
  DatasetColumn,
  DocumentDataset,
  PresentationBlock,
  PresentationDocument,
  SourceSnapshot,
  TypedDataset,
} from '../../presentation/contracts/types.ts'

export type ReaderMode = 'interactive' | 'static'
export type ChartBlock = Extract<PresentationBlock, { kind: 'chart' }>
export type MetricBlock = Extract<PresentationBlock, { kind: 'metric' }>
export const TABLE_PAGE_SIZE = 20

export function cellText(value: Cell, column: DatasetColumn): string {
  return value === '' ? '（空字符串）' : formatCell(value, column)
}

export function valueWithUnit(value: Cell, column: DatasetColumn): string {
  const text = cellText(value, column)
  return column.unit && value !== null && value !== '' ? `${text} ${column.unit}` : text
}

export function columnLabel(column: DatasetColumn): string {
  return column.unit ? `${column.label} (${column.unit})` : column.label
}

/** Axis labels are compact coordinates; tooltips and tables retain exact source text. */
export function formatAxisTick(value: number): string {
  const text = String(value)
  return text.length > 10 || (value !== 0 && Math.abs(value) < 0.0001)
    ? value.toExponential(2)
    : text
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

export function selectMetric(dataset: TypedDataset, block: MetricBlock) {
  const index = columnIndex(dataset, block.columnId)
  const row = dataset.rows[block.rowIndex]
  if (!row) throw new Error(`Metric must select one existing row: ${block.rowIndex}`)
  return { column: dataset.columns[index]!, value: row[index]! }
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

function compareValues(first: Cell, second: Cell, column: DatasetColumn): number {
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
  return String(first).localeCompare(String(second), 'zh-CN')
}

export function sortedRowIndices(
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
    const comparison = compareValues(a, b, dataset.columns[column]!)
    return (sort.direction === 'ascending' ? comparison : -comparison) || first - second
  })
}

export function datasetScope(dataset: TypedDataset): string {
  if (dataset.rowCount === 0) return '暂无数据；列定义已保留。'
  if (dataset.truncated)
    return `已截断：共 ${dataset.rowCount} 行，保存前 ${dataset.rows.length} 行（限制 ${dataset.limit} 行）。图表和排序仅覆盖已保存行，不能代表全量总计或排名。`
  return `共 ${dataset.rowCount} 行，全部已保存。`
}

export interface ChartRow {
  rowIndex: number
  xLabel: string
  [key: string]: number | string | null
}

export function chartRows(dataset: TypedDataset, block: ChartBlock): ChartRow[] {
  const x = columnIndex(dataset, block.x)
  const indices = block.y.map((id) => columnIndex(dataset, id))
  return dataset.rows.map((row, rowIndex) => {
    const result: ChartRow = { rowIndex, xLabel: cellText(row[x]!, dataset.columns[x]!) }
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

export function chartTitle(dataset: TypedDataset, block: ChartBlock): string {
  const x = dataset.columns[columnIndex(dataset, block.x)]!
  const y = block.y.map((id) => dataset.columns[columnIndex(dataset, id)]!.label)
  return `${y.join('、')} · ${x.label}`
}

export function selectedSources(document: PresentationDocument, ids: string[]): SourceSnapshot[] {
  return ids.map((id) => {
    const source = document.sources.find((entry) => entry.id === id)
    if (!source) throw new Error(`Unknown presentation source: ${id}`)
    return source
  })
}

export function followUpContext(
  document: PresentationDocument,
  block?: PresentationBlock,
  rowIndex?: number,
): string {
  const lines = [
    document.title,
    `Build ID: ${document.buildId}`,
    `Workspace: ${document.workspaceId}`,
  ]
  let sources = document.sources
  if (block) {
    lines.push(`Block: ${block.id}`)
    if ('datasetId' in block) {
      const dataset = datasetById(document, block.datasetId)
      lines.push(
        `Dataset: ${dataset.id}`,
        `来源类型: ${dataset.origin}`,
        datasetScope(dataset.data),
      )
      sources = selectedSources(document, dataset.sourceIds)
      if (block.kind === 'chart') lines.push(`图表: ${chartTitle(dataset.data, block)}`)
      const selected = block.kind === 'metric' ? block.rowIndex : rowIndex
      if (selected !== undefined) {
        const row = dataset.data.rows[selected]
        if (!row) throw new Error(`Unknown presentation row: ${selected}`)
        lines.push(`保存行索引: ${selected}`)
        dataset.data.columns.forEach((column, index) => {
          lines.push(`${column.label}: ${valueWithUnit(row[index]!, column)}`)
        })
      }
    } else if (block.kind === 'source') sources = selectedSources(document, block.sourceIds)
  }
  for (const source of sources) {
    lines.push(
      `来源 ${source.id}: ${JSON.stringify(source.ref)} [${source.status}]`,
      ...(source.status === 'unavailable' ? [`原因: ${source.reason}`] : []),
    )
  }
  return lines.join('\n')
}
