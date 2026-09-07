import type { ChartView } from '../../presentation/contracts/charts.ts'
import { chartNumber } from '../../presentation/contracts/index.ts'
import type { TypedDataset } from '../../presentation/contracts/types.ts'

export const CHART_COLORS = Array.from({ length: 6 }, (_, index) => `var(--pr-chart-${index + 1})`)

/** Coordinate conversion only. The immutable source cell remains the tooltip authority. */
export function chartCoordinate(
  data: TypedDataset,
  view: ChartView,
  rowIndex: number,
  field: string,
): number | null {
  const index = data.columns.findIndex((column) => column.id === field)
  if (index < 0) throw new Error(`Unknown presentation column: ${field}`)
  return chartNumber(data.rows[rowIndex]![index]!, data.columns[index]!, view.numericMode)
}

export function seriesAppearance(view: ChartView, field: string, index: number) {
  const option = view.options?.series?.[field]
  const planning = ['baseline', 'target', 'forecast', 'plan'].includes(option?.role ?? '')
  const color = planning
    ? 'var(--pr-chart-muted)'
    : option?.role === 'actual'
      ? CHART_COLORS[0]!
      : option?.role === 'comparison'
        ? CHART_COLORS[3]!
        : CHART_COLORS[index % CHART_COLORS.length]!
  const lineStyle = option?.lineStyle ?? (planning ? 'dashed' : 'solid')
  return {
    color,
    lineStyle,
    dash: lineStyle === 'dotted' ? '2 4' : lineStyle === 'dashed' ? '5 5' : undefined,
  }
}

/** Stack offsets are drawing geometry, never a derived dataset or a normalization. */
export function stackCoordinates(values: readonly (number | null)[]): ([number, number] | null)[] {
  let positive = 0
  let negative = 0
  return values.map((value) => {
    if (value === null) return null
    const start = value < 0 ? negative : positive
    const end = start + value
    if (!Number.isFinite(end)) throw new Error('Stack exceeds the finite drawing coordinate range')
    if (value < 0) negative = end
    else positive = end
    return [start, end]
  })
}

/** Includes zero; a zero-only or empty scale still has a nonzero drawing extent. */
export function drawingDomain(values: readonly (number | null)[]): [number, number] {
  let minimum = 0
  let maximum = 0
  for (const value of values) {
    if (value === null) continue
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return minimum === maximum ? [0, 1] : [minimum, maximum]
}

/** Keep Recharts/d3 internal subtraction and interpolation in a finite numeric range. */
export function numericDrawingAxis(values: readonly (number | null)[]) {
  const domain = drawingDomain(values)
  const maximum = Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
  const divisor = maximum > 1e100 || (maximum > 0 && maximum < 1e-100) ? maximum : 1
  return { divisor, domain: [domain[0] / divisor, domain[1] / divisor] as [number, number] }
}

/** Dividing first avoids overflow for valid finite domains spanning -1e308 to 1e308. */
export function drawingScale(domain: readonly [number, number], from: number, to: number) {
  const divisor = Math.max(Math.abs(domain[0]), Math.abs(domain[1]), 1)
  const minimum = domain[0] / divisor
  const span = domain[1] / divisor - minimum
  return (value: number) => from + ((value / divisor - minimum) / span) * (to - from)
}

export function domainTicks(domain: readonly [number, number]): number[] {
  return Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4
    return domain[0] * (1 - fraction) + domain[1] * fraction
  })
}

/** Angles stay bound to the full authored snapshot, including omitted/filtered slices. */
export function shareIntervals(shares: readonly (number | null)[]) {
  let start = 0
  return shares.map((share) => {
    if (share === null) return null
    const interval = { start, end: start + share }
    start = interval.end
    return interval
  })
}

export function donutPath(start: number, end: number, cx: number, cy: number, radius = 106) {
  if (end <= start) return ''
  const inner = radius * 0.62
  const point = (fraction: number, r: number) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const
  }
  // Two halves also cover a single authored share of exactly 1 without an SVG degenerate arc.
  const middle = (start + end) / 2
  const a = point(start, radius)
  const b = point(middle, radius)
  const c = point(end, radius)
  const d = point(end, inner)
  const e = point(middle, inner)
  const f = point(start, inner)
  return `M ${a} A ${radius} ${radius} 0 0 1 ${b} A ${radius} ${radius} 0 0 1 ${c} L ${d} A ${inner} ${inner} 0 0 0 ${e} A ${inner} ${inner} 0 0 0 ${f} Z`
}

export function showValueLabels(view: ChartView, count: number) {
  return (
    view.options?.valueLabels === 'all' || (view.options?.valueLabels === 'auto' && count <= 12)
  )
}

export function pointIsDrawable(value: unknown, cx: number | undefined, cy: number | undefined) {
  return value !== null && value !== undefined && Number.isFinite(cx) && Number.isFinite(cy)
}
