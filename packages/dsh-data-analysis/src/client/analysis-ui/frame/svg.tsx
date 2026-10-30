import { type ReactNode, useId } from 'react'
import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../../presentation/contracts/frame-view.ts'
import type { Translator } from '../../i18n/copy.ts'
import type { Snapshot, Tick } from './model.ts'

// Hand-rolled SVG primitives. Geometry is layout only: no value drawn as text
// here is produced by arithmetic; labels always come from saved cells.

export type View<K extends ResolvedFrameView['chart']> = Extract<ResolvedFrameView, { chart: K }>
export interface MainViewProps<K extends ResolvedFrameView['chart']> {
  snapshot: Snapshot
  classification: FrameClassification
  view: View<K>
  height?: number
}

export const W = 640
export const LABEL_W = 150
export const END_W = 84
/** Fixed-order categorical slots; colours come from CSS variables in styles.ts. */
export const color = (i: number) => `var(--fv-s${Math.min(Math.max(i, 0), 7) + 1})`
export const NEUTRAL = 'var(--fv-neutral)'

export type Scale = (v: number) => number
export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const span = d1 - d0 || 1
  return (v) => r0 + ((v - d0) / span) * (r1 - r0)
}
/** Plot domain over drawn values; `zero` keeps the baseline for bars. */
export function extent(values: (number | null)[], zero = false): [number, number] {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (zero) xs.push(0)
  if (xs.length === 0) return [0, 1]
  let lo = xs[0]!
  let hi = xs[0]!
  for (const x of xs) {
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  if (lo === hi) {
    const d = Math.abs(lo) || 1
    return zero && lo === 0 ? [-d, d] : [lo - d, hi + d]
  }
  const pad = (hi - lo) * 0.05
  return [zero && lo === 0 ? 0 : lo - pad, zero && hi === 0 ? 0 : hi + pad]
}
const r = (n: number) => Math.round(n * 10) / 10
/** Polyline that lifts the pen at every null: NA and missing periods break the line. */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = ''
  let pen = false
  for (const p of points) {
    if (!p) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${r(p.x)},${r(p.y)}`
    pen = true
  }
  return d
}
/** Closed areas per contiguous segment, down to the baseline. */
export function areaPaths(points: ({ x: number; y: number } | null)[], base: number): string[] {
  const out: string[] = []
  let run: { x: number; y: number }[] = []
  const flush = () => {
    if (run.length > 1)
      out.push(
        `M${r(run[0]!.x)},${r(base)}${run.map((p) => `L${r(p.x)},${r(p.y)}`).join('')}L${r(run.at(-1)!.x)},${r(base)}Z`,
      )
    run = []
  }
  for (const p of points) p ? run.push(p) : flush()
  flush()
  return out
}

export function summary(t: Translator, name: string, items: string[]): string {
  return t('marivo.presentation.ui-frame-chart-summary', {
    p0: name,
    p1: items.length,
    p2: items.slice(0, 8).join('; ') + (items.length > 8 ? '; …' : ''),
  })
}

export function ChartFrame({
  label,
  height,
  legend,
  children,
}: {
  label: string
  height: number
  legend?: ReactNode
  children: (hatch: string) => ReactNode
}) {
  const id = `fv-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <figure className="fv-chart">
      {legend}
      <svg
        className="fv-svg"
        viewBox={`0 0 ${W} ${r(height)}`}
        width="100%"
        role="img"
        aria-label={label}
      >
        <defs>
          <pattern
            id={id}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="fv-hatch-line" />
          </pattern>
        </defs>
        {children(`url(#${id})`)}
      </svg>
    </figure>
  )
}

export interface LegendItem {
  label: string
  color: string
  shape?: 'line' | 'dashed' | 'dot' | 'hollow' | 'square' | 'diamond'
}
export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null
  return (
    <ul className="fv-legend">
      {items.map((item) => (
        <li key={`${item.label}-${item.color}-${item.shape}`}>
          <svg width="18" height="10" aria-hidden="true">
            <Swatch item={item} />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  )
}
function Swatch({ item }: { item: LegendItem }) {
  const style = { stroke: item.color, fill: item.color }
  switch (item.shape) {
    case 'line':
    case 'dashed':
      return (
        <line
          x1="1"
          y1="5"
          x2="17"
          y2="5"
          style={{ stroke: item.color }}
          strokeWidth="2"
          strokeDasharray={item.shape === 'dashed' ? '4 3' : undefined}
        />
      )
    case 'dot':
      return <circle cx="9" cy="5" r="4" style={style} />
    case 'hollow':
      return <circle cx="9" cy="5" r="3.5" className="fv-hollow" style={{ stroke: item.color }} />
    case 'diamond':
      return <path d="M9,0.5L13.5,5L9,9.5L4.5,5Z" style={style} />
    default:
      return <rect x="3" y="1" width="12" height="8" rx="2" style={style} />
  }
}

/** Point mark; hollow for incomplete periods, absent sides and baselines. */
export function Dot({
  x,
  y,
  fill,
  hollow,
  size = 3.5,
  title,
}: {
  x: number
  y: number
  fill: string
  hollow?: boolean
  size?: number
  title?: string
}) {
  return (
    <circle
      cx={r(x)}
      cy={r(y)}
      r={size}
      className={hollow ? 'fv-hollow' : undefined}
      style={hollow ? { stroke: fill } : { fill }}
      data-mark={hollow ? 'hollow' : 'filled'}
    >
      {title && <title>{title}</title>}
    </circle>
  )
}
export function Diamond({ x, y, title }: { x: number; y: number; title?: string }) {
  return (
    <path
      d={`M${r(x)},${r(y - 6)}L${r(x + 6)},${r(y)}L${r(x)},${r(y + 6)}L${r(x - 6)},${r(y)}Z`}
      className="fv-diamond"
      data-mark="contribution"
    >
      {title && <title>{title}</title>}
    </path>
  )
}

/**
 * Bar between two positions on the value axis. Zero keeps a baseline tick;
 * incomplete periods are hatched; callers skip NA entirely.
 */
export function Bar({
  horizontal,
  at,
  breadth,
  from,
  to,
  fill,
  hatch,
  hatched,
  title,
}: {
  horizontal?: boolean
  at: number
  breadth: number
  from: number
  to: number
  fill: string
  hatch?: string
  hatched?: boolean
  title?: string
}) {
  const lo = Math.min(from, to)
  const len = Math.abs(to - from)
  if (len < 0.5)
    return horizontal ? (
      <line
        x1={r(from)}
        x2={r(from)}
        y1={r(at)}
        y2={r(at + breadth)}
        className="fv-zero-mark"
        style={{ stroke: fill }}
        data-mark="zero"
      >
        {title && <title>{title}</title>}
      </line>
    ) : (
      <line
        x1={r(at)}
        x2={r(at + breadth)}
        y1={r(from)}
        y2={r(from)}
        className="fv-zero-mark"
        style={{ stroke: fill }}
        data-mark="zero"
      >
        {title && <title>{title}</title>}
      </line>
    )
  const box = horizontal
    ? { x: r(lo), y: r(at), width: r(len), height: r(breadth) }
    : { x: r(at), y: r(lo), width: r(breadth), height: r(len) }
  return (
    <g data-mark={hatched ? 'hatched' : 'bar'}>
      {title && <title>{title}</title>}
      <rect {...box} rx="2" style={{ fill, fillOpacity: hatched ? 0.45 : 1 }} />
      {hatched && hatch && <rect {...box} rx="2" style={{ fill: hatch }} />}
    </g>
  )
}

/** Time ticks keep every period, including missing ones; labels thin out when dense. */
export function XTicks({ ticks, x, y }: { ticks: Tick[]; x: (i: number) => number; y: number }) {
  const step = Math.max(1, Math.ceil(ticks.length / 10))
  return (
    <g className="fv-ticks">
      {ticks.map((tick, i) => (
        <g key={tick.key} data-tick={tick.label}>
          <title>{tick.title}</title>
          <line x1={r(x(i))} x2={r(x(i))} y1={y} y2={y + 4} className="fv-grid" />
          {(i % step === 0 || i === ticks.length - 1) && (
            <text x={r(x(i))} y={y + 15} textAnchor="middle">
              {tick.label}
            </text>
          )}
        </g>
      ))}
    </g>
  )
}

export function truncate(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
