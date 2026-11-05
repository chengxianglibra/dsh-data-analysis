import { formatCell } from '../../../presentation/contracts/index.ts'
import type {
  Cell,
  DatasetColumn,
  PresentationLocale,
  TypedDataset,
} from '../../../presentation/contracts/types.ts'

export interface Tick {
  key: string
  label: string
  title: string
  incomplete: boolean
}
export interface ChartAxis {
  id: string
  name: string
  keys: string[]
  labels: string[]
  ticks?: { ticks: Tick[]; indices: number[]; captured?: boolean[] }
}
export interface ChartGroup {
  key: string
  label: string
  rows: number[]
}
/** A read-only projection for drawing; it contains no analysis semantics. */
export interface ChartModel {
  data: TypedDataset
  axes: ChartAxis[]
  valueLabels: Record<string, string>
  references: Record<string, ChartGroup[]>
  display?: (value: Cell, column?: DatasetColumn) => string
  frameStyle?: boolean
  highlight?: { axis: string; key: string }
  rowLimit?: number
}
export type ChartView =
  | {
      chart: 'line' | 'area' | 'bar' | 'interval-bar'
      axis: string
      series?: string
      values: string[]
      broadcast: string[]
    }
  | { chart: 'hbar'; axis: string; values: string[]; broadcast: string[] }
  | { chart: 'heatmap'; x: string; y: string; value: string }
export interface ChartProps<K extends ChartView['chart']> {
  model: ChartModel
  view: ChartView & { chart: K }
  height?: number
}
type ChartData = Pick<ChartModel, 'data'>

export function columnOf(s: ChartData, name: string) {
  const index = s.data.columns.findIndex((c) => c.id === name)
  return index < 0 ? undefined : { index, column: s.data.columns[index]! }
}
export function cellOf(s: ChartData, row: number, name: string): Cell {
  const column = columnOf(s, name)
  return column ? (s.data.rows[row]?.[column.index] ?? null) : null
}
const NUMERIC = new Set(['float64', 'int64', 'decimal'])
export function isNumeric(column?: DatasetColumn): boolean {
  return !!column && NUMERIC.has(column.type)
}
/** Plot position of a saved numeric cell; decimal/int64 approximation affects only geometry. */
export function numberOf(value: Cell, column?: DatasetColumn): number | null {
  if (value === null || !isNumeric(column)) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
export function compact(locale: PresentationLocale, value: Cell, column?: DatasetColumn): string {
  if (value === null) return '—'
  const n = numberOf(value, column ?? { id: '', label: '', type: 'float64', nullable: true })
  if (n === null) return String(value)
  return Math.abs(n) >= 1000
    ? new Intl.NumberFormat(locale, {
        notation: 'compact',
        minimumSignificantDigits: 3,
        maximumSignificantDigits: 3,
      }).format(n)
    : new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(n)
}
/** Exact saved spelling plus unit, for tooltips and tables. */
export function exact(value: Cell, column?: DatasetColumn): string {
  if (!column) return value === null ? '—' : String(value)
  const text = formatCell(value, column)
  return value !== null && column.unit ? `${text} ${column.unit}` : text
}

export function displayed(s: ChartModel, value: Cell, column?: DatasetColumn): string {
  return s.display ? s.display(value, column) : exact(value, column)
}

export function valueAt(s: ChartData, row: number, name: string) {
  return numberOf(cellOf(s, row, name), columnOf(s, name)?.column)
}
export const rowsOf = (s: ChartData) => s.data.rows.map((_, i) => i)
export const valueName = (s: ChartModel, name: string) => s.valueLabels[name] ?? name
export const axisOf = (s: ChartModel, ref?: string) =>
  s.axes.find((a) => a.id === ref) ?? s.axes.find((a) => a.name === ref)
export function groupRows(s: ChartModel, axes: ChartAxis[]) {
  const groups = new Map<string, ChartGroup>()
  for (const row of rowsOf(s)) {
    const key = JSON.stringify(axes.map((a) => a.keys[row]))
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, label: axes.map((a) => a.labels[row]).join(' · '), rows: [row] })
  }
  return [...groups.values()]
}
export function ticksOf(s: ChartModel, axis: ChartAxis) {
  if (axis.ticks) {
    const { ticks, indices } = axis.ticks
    return { ticks, tickOf: (row: number) => indices[row] ?? -1 }
  }
  const groups = groupRows(s, [axis])
  const indices = new Map<number, number>()
  groups.forEach((g, i) => {
    for (const row of g.rows) indices.set(row, i)
  })
  return {
    ticks: groups.map((g) => ({ key: g.key, label: g.label, title: g.label, incomplete: false })),
    tickOf: (row: number) => indices.get(row) ?? -1,
  }
}
export const partitions = (s: ChartModel, name: string) => s.references[name] ?? []
/** First non-null saved value and its original row within the supplied rows. */
export function firstCell(
  s: ChartData,
  rows: number[],
  name: string,
): { row: number; value: Cell } {
  for (const row of rows) {
    const value = cellOf(s, row, name)
    if (value !== null) return { row, value }
  }
  return { row: rows[0] ?? 0, value: null }
}
