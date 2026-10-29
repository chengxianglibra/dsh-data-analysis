import { formatCell } from '../../presentation/contracts/index.ts'
import type {
  Cell,
  DatasetColumn,
  PresentationLocale,
  TypedDataset,
} from '../../presentation/contracts/types.ts'
import { message, translator } from './../i18n/copy.ts'

export const TABLE_PAGE_SIZE = 20

export function cellText(locale: PresentationLocale, value: Cell, column: DatasetColumn): string {
  return value === ''
    ? translator(locale)('marivo.presentation.empty-string-438')
    : formatCell(value, column)
}

export function columnLabel(column: DatasetColumn): string {
  const unit = column.unit?.trim()
  const label = column.label.trimEnd()
  return unit && !label.endsWith(`(${unit})`) && !label.endsWith(`（${unit}）`)
    ? `${column.label} (${unit})`
    : column.label
}

export function columnIndex(dataset: TypedDataset, id: string): number {
  const index = dataset.columns.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error(`Unknown presentation column: ${id}`)
  return index
}

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
