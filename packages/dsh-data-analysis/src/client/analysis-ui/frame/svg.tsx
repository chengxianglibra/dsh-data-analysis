import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../../presentation/contracts/frame-view.ts'
import { useCopy } from '../../i18n/context.tsx'
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
/** Two original 4.5px point marks overlap when their rendered centres are less than 9px apart. */
export const dotsOverlap = (a: number, b: number) => Math.abs(r(a) - r(b)) < 9
/** Conservative 12px text budget; used only for geometry, never to format saved values. */
export const textWidth = (text: string) =>
  [...text].reduce((sum, ch) => sum + (ch.codePointAt(0)! > 127 ? 12 : 8), 0)
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
  width = W,
  legend,
  rowLabels,
  children,
}: {
  label: string
  height: number
  width?: number
  legend?: ReactNode
  rowLabels?: { label: string; y: number; strong?: boolean }[]
  children: (hatch: string) => ReactNode
}) {
  const id = `fv-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hintId = useId()
  const t = useCopy()
  const ref = useRef<HTMLElement>(null)
  const [scrollable, setScrollable] = useState(false)
  const [railWidth, setRailWidth] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const hasRowLabels = rowLabels?.some((item) => item.label.length > 0) ?? false
  useEffect(() => {
    const region = ref.current
    if (!region) return
    const update = () => {
      setScrollable(region.scrollWidth > region.clientWidth + 1)
      setRailWidth(Math.min(LABEL_W, Math.floor(region.clientWidth * 0.4)))
      setScrolled(region.scrollLeft > 0)
    }
    const observer = new ResizeObserver(update)
    observer.observe(region)
    const svg = region.querySelector('svg')
    if (svg) observer.observe(svg)
    update()
    return () => observer.disconnect()
  }, [])
  return (
    <figure className="fv-chart">
      {legend}
      {scrollable && (
        <span
          id={hintId}
          className="fv-scroll-hint"
          title={t('marivo.presentation.ui-frame-scroll-hint')}
        >
          <span className="fv-sr-only">{t('marivo.presentation.ui-frame-scroll-hint')}</span>
        </span>
      )}
      {/* The scroll region must receive keyboard focus so narrow charts can be read in full. */}
      <section
        ref={ref}
        className={scrolled && hasRowLabels ? 'fv-plot fv-plot-scrolled' : 'fv-plot'}
        aria-label={label}
        aria-describedby={scrollable ? hintId : undefined}
        style={{
          maxWidth: '100%',
          overflowX: 'auto',
          display: 'grid',
          gridTemplateColumns: `minmax(${width}px, 1fr)`,
        }}
        tabIndex={scrollable ? 0 : undefined}
        onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)}
        onKeyDown={(event) => {
          const region = event.currentTarget
          if (
            event.target !== region ||
            (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
            region.scrollWidth <= region.clientWidth
          )
            return
          event.preventDefault()
          region.scrollLeft += event.key === 'ArrowRight' ? 80 : -80
        }}
      >
        <svg
          className="fv-svg"
          viewBox={`0 0 ${r(width)} ${r(height)}`}
          width="100%"
          style={{ gridArea: '1 / 1', fontSize: 12 }}
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
        {scrollable && scrolled && hasRowLabels && rowLabels && railWidth > 0 && (
          <div
            aria-hidden="true"
            data-frame-rail=""
            style={{
              gridArea: '1 / 1',
              position: 'sticky',
              left: 0,
              zIndex: 1,
              width: railWidth,
              height,
              background: 'var(--pr-bg)',
              pointerEvents: 'none',
            }}
          >
            <svg
              aria-hidden="true"
              width={railWidth}
              height={height}
              className="fv-svg"
              style={{ fontSize: 12 }}
            >
              {rowLabels.map((item, i) => (
                <text
                  key={`${item.y}:${item.label}`}
                  data-rail-row={i}
                  x={railWidth - 8}
                  y={item.y}
                  textAnchor="end"
                  className={item.strong ? 'fv-strong' : undefined}
                >
                  <title>{item.label}</title>
                  {truncate(item.label, Math.max(4, Math.floor((railWidth - 12) / 7)))}
                </text>
              ))}
            </svg>
          </div>
        )}
      </section>
    </figure>
  )
}

export interface LegendItem {
  label: string
  color: string
  shape?: 'line' | 'dashed' | 'dot' | 'hollow' | 'square' | 'diamond'
  marker?: number
}
export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null
  return (
    <ul className="fv-legend">
      {items.map((item) => (
        <li key={`${item.label}-${item.color}-${item.shape}-${item.marker}`}>
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
        <>
          <line
            x1="1"
            y1="5"
            x2="17"
            y2="5"
            style={{ stroke: item.color }}
            strokeWidth="2"
            strokeDasharray={item.shape === 'dashed' ? '4 3' : undefined}
          />
          {item.marker !== undefined && (
            <path d={markerPath(9, 5, 3.5, item.marker)} fill={item.color} />
          )}
        </>
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

/** Eight closed point shapes distinguish category series without relying on colour alone. */
function markerPath(x: number, y: number, size: number, marker: number): string {
  const shapes: readonly (readonly [number, number][])[] = [
    [
      [0, -1],
      [0.7, -0.7],
      [1, 0],
      [0.7, 0.7],
      [0, 1],
      [-0.7, 0.7],
      [-1, 0],
      [-0.7, -0.7],
    ],
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ],
    [
      [0, -1.25],
      [1, 0],
      [0, 1.25],
      [-1, 0],
    ],
    [
      [0, -1.2],
      [1, 1],
      [-1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [0, 1.2],
    ],
    [
      [0, -1.2],
      [1, -0.35],
      [0.65, 1],
      [-0.65, 1],
      [-1, -0.35],
    ],
    [
      [-0.9, -1],
      [0.9, -1],
      [1, 0],
      [0.9, 1],
      [-0.9, 1],
      [-1, 0],
    ],
    [
      [0, -1.3],
      [0.55, -0.45],
      [1.2, 0],
      [0.55, 0.45],
      [0, 1.3],
      [-0.55, 0.45],
      [-1.2, 0],
      [-0.55, -0.45],
    ],
  ]
  const points = shapes[marker % shapes.length]!
  return `${points.map(([dx, dy], i) => `${i ? 'L' : 'M'}${r(x + dx * size)},${r(y + dy * size)}`).join('')}Z`
}

/** Point mark; hollow for incomplete periods, absent sides and baselines. */
export function Dot({
  x,
  y,
  fill,
  hollow,
  size = 3.5,
  title,
  marker,
}: {
  x: number
  y: number
  fill: string
  hollow?: boolean
  size?: number
  title?: string
  marker?: number
}) {
  if (marker !== undefined)
    return (
      <path
        d={markerPath(x, y, size, marker)}
        className={hollow ? 'fv-hollow' : undefined}
        style={hollow ? { stroke: fill } : { fill }}
        data-mark={hollow ? 'hollow' : 'filled'}
        data-marker={marker}
      >
        {title && <title>{title}</title>}
      </path>
    )
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
  // Estimate the widest label conservatively at the minimum 12px chart font.
  // Choosing a whole-index step also protects the shortest gap after rounding.
  const width = Math.max(0, ...ticks.map((tick) => textWidth(tick.label)))
  const spacing = ticks.length > 1 ? Math.abs(x(ticks.length - 1) - x(0)) / (ticks.length - 1) : 0
  const minStep = spacing > 0 ? Math.max(1, Math.ceil((width + 8) / spacing)) : 1
  const count =
    ticks.length < 2
      ? ticks.length
      : Math.max(2, Math.min(10, 1 + Math.floor((ticks.length - 1) / minStep)))
  // Distribute labels between the two endpoints so a final partial step cannot
  // place the penultimate label immediately next to the last one.
  const labels = new Set(
    Array.from({ length: count }, (_, i) =>
      count === 1 ? 0 : Math.round((i * (ticks.length - 1)) / (count - 1)),
    ),
  )
  return (
    <g className="fv-ticks">
      {ticks.map((tick, i) => (
        <g key={tick.key} data-tick={tick.label}>
          <title>{tick.title}</title>
          <line x1={r(x(i))} x2={r(x(i))} y1={y} y2={y + 4} className="fv-grid" />
          {labels.has(i) && (
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
