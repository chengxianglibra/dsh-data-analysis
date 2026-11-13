import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useCopy } from '../../i18n/context.tsx'
import type { Translator } from '../../i18n/copy.ts'
import { Button } from '../../ui/primitives/button.tsx'
import { ChartContainer, ChartTooltip } from '../../ui/primitives/chart.tsx'
import type { Tick } from './model.ts'
import { useChartSelection } from './selection-context.tsx'

export const color = (index: number) => `var(--chart-${(index % 8) + 1})`
export const NEUTRAL = 'var(--muted-foreground)'
export function summary(t: Translator, name: string, items: string[]) {
  return t('marivo.presentation.ui-frame-chart-summary', {
    p0: name,
    p1: items.length,
    p2: items.slice(0, 8).join('; ') + (items.length > 8 ? '; …' : ''),
  })
}
export interface LegendItem {
  label: string
  color: string
  shape?: 'line' | 'dashed' | 'dot' | 'hollow' | 'square' | 'diamond'
  marker?: number
}
export function Legend({
  items,
  showSingle = false,
}: {
  items: LegendItem[]
  showSingle?: boolean
}) {
  const t = useCopy()
  if (!items.length || (items.length === 1 && !showSingle)) return null
  return (
    <ul
      className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs"
      aria-label={t('marivo.presentation.ui-chart-series')}
    >
      {items.map((item) => (
        <li key={`${item.label}:${item.color}:${item.shape}`} className="flex items-center gap-1.5">
          <span aria-hidden="true" style={{ color: item.color }}>
            {item.shape === 'dashed'
              ? '┄'
              : item.shape === 'line'
                ? '━'
                : item.shape === 'hollow'
                  ? '○'
                  : item.shape === 'diamond'
                    ? '◆'
                    : '■'}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  )
}
/** Recharts owns measurement and all Cartesian coordinates. The outer region only permits local scroll. */
export function ChartFrame({
  label,
  height,
  width = 640,
  horizontalTickInset,
  legend,
  axisTitle,
  children,
}: {
  label: string
  height: number
  width?: number
  horizontalTickInset?: number
  legend?: ReactNode
  axisTitle?: string
  children: ReactElement
}) {
  const t = useCopy()
  const regionRef = useRef<HTMLElement>(null)
  const hintId = useId()
  const [scrollable, setScrollable] = useState(false)
  const [measuredTickWidth, setMeasuredTickWidth] = useState(0)
  const plotWidth = Math.max(width, horizontalTickInset === undefined ? 0 : measuredTickWidth)
  const [rail, setRail] = useState<
    { label: string; title: string; incomplete: boolean; y: number; index: string }[]
  >([])
  const [railWidth, setRailWidth] = useState(0)
  useEffect(() => {
    const region = regionRef.current
    if (!region) return
    const update = () => {
      setScrollable(
        region.scrollWidth > region.clientWidth + 1 || plotWidth > region.clientWidth + 1,
      )
      if (horizontalTickInset === undefined) return
      const labels = region.querySelectorAll<SVGTextElement>('[data-tick] text')
      if (!labels.length) return
      const widths = Array.from(labels, (label) => label.getComputedTextLength())
      // Indexed categories occupy equally spaced slots centered under their marks.
      const slotWidth = Math.max(
        widths[0]!,
        widths.at(-1)!,
        ...widths.slice(1).map((width, index) => (width + widths[index]!) / 2 + 8),
      )
      setMeasuredTickWidth(Math.ceil(horizontalTickInset + labels.length * slotWidth))
    }
    const observer = new ResizeObserver(update)
    observer.observe(region)
    const chart = region.firstElementChild
    if (chart) observer.observe(chart)
    const mutation = new MutationObserver(update)
    mutation.observe(region, {
      attributes: true,
      characterData: horizontalTickInset !== undefined,
      childList: true,
      subtree: true,
      attributeFilter: ['style', 'transform', 'x', 'y', 'width', 'height'],
    })
    if (horizontalTickInset !== undefined) document.fonts.addEventListener('loadingdone', update)
    update()
    // The grid's min track and its SVG are committed in the same render; measure
    // again after layout so a shrinking chart clears a previously needed hint.
    const frame = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(frame)
      if (horizontalTickInset !== undefined)
        document.fonts.removeEventListener('loadingdone', update)
      mutation.disconnect()
      observer.disconnect()
    }
  }, [horizontalTickInset, plotWidth])
  const updateRail = () => {
    const region = regionRef.current
    if (!region || region.scrollLeft < 1) {
      setRail([])
      return
    }
    const labels = [
      ...region.querySelectorAll<SVGGElement>('svg.recharts-surface [data-row-label]'),
    ].map((node) => ({
      label: node.dataset.rowLabel ?? '',
      title: node.querySelector('title')?.textContent ?? node.dataset.rowLabel ?? '',
      incomplete: node.dataset.rowIncomplete === 'true',
      y: node.transform.baseVal.consolidate()?.matrix.f ?? 0,
      index: node.dataset.rowIndex ?? '',
    }))
    setRail(labels.some((item) => item.label.length > 0) ? labels : [])
    setRailWidth(Math.min(140, Math.floor(region.clientWidth * 0.4)))
  }
  return (
    <figure className="fv-chart space-y-3">
      {axisTitle && (
        <div className="text-xs text-muted-foreground" data-axis-title="">
          {axisTitle}
        </div>
      )}
      <section
        ref={regionRef}
        className={
          rail.length ? 'fv-plot fv-plot-scrolled overflow-x-auto' : 'fv-plot overflow-x-auto'
        }
        aria-label={label}
        aria-describedby={scrollable ? hintId : undefined}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: This local overflow region supports keyboard scrolling.
        tabIndex={0}
        style={{ display: 'grid', gridTemplateColumns: `minmax(${plotWidth}px,1fr)` }}
        onScroll={updateRail}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['ArrowLeft', 'ArrowRight'].includes(event.key)
          )
            return
          event.preventDefault()
          event.currentTarget.scrollLeft += event.key === 'ArrowRight' ? 80 : -80
        }}
      >
        <ChartContainer
          initialDimension={{ width: plotWidth, height }}
          style={{ height, width: '100%', minWidth: plotWidth, gridArea: '1 / 1' }}
          className="aspect-auto"
        >
          {children}
        </ChartContainer>
        {rail.length > 0 && (
          <div
            data-frame-rail=""
            aria-hidden="true"
            style={{
              gridArea: '1 / 1',
              position: 'sticky',
              left: 0,
              width: railWidth,
              height,
              background: 'var(--background)',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <svg
              aria-hidden="true"
              width={railWidth}
              height={height}
              className="text-xs fill-muted-foreground"
            >
              {rail.map((item) => (
                <g key={item.index} data-rail-row={item.index}>
                  <title>{item.title}</title>
                  <text x={railWidth - 8} y={item.y} dy={4} textAnchor="end">
                    {item.label.length > 18 ? `${item.label.slice(0, 17)}…` : item.label}
                    {item.incomplete ? ' ◌' : ''}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}
      </section>
      {scrollable && (
        <p className="fv-sr-only" id={hintId}>
          {t('marivo.presentation.ui-frame-scroll-hint')}
        </p>
      )}
      {legend}
    </figure>
  )
}
/** Tooltip text is supplied by adapters from original cells, never from Recharts numeric payloads. */
export function ExactTooltip({
  textAt,
  detailsAt,
  showCursor,
}: {
  textAt: (index: number) => string
  showCursor?: boolean
  detailsAt?: (index: number) => {
    label: string
    rows: { label: string; value: string; color: string }[]
  }
}) {
  return (
    <ChartTooltip
      cursor={showCursor ? <TimeCursor /> : false}
      isAnimationActive={false}
      content={({ active, payload }) => {
        if (!active || !payload?.length) return null
        const source: unknown = payload[0]?.payload
        if (
          !source ||
          typeof source !== 'object' ||
          !('index' in source) ||
          typeof source.index !== 'number'
        )
          return null
        const details = detailsAt?.(source.index)
        return (
          <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-xl whitespace-pre-wrap">
            {details ? (
              <>
                <div className="font-medium">{details.label}</div>
                {details.rows.map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Saved series can share labels and colors; these stateless rows follow series order.
                  <div className="flex items-center gap-2" key={`${index}:${row.label}`}>
                    <span
                      aria-hidden="true"
                      style={{
                        background: row.color,
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        flexShrink: 0,
                      }}
                    />
                    <span>{row.label}</span>
                    <span className="ml-auto tabular-nums">{row.value}</span>
                  </div>
                ))}
              </>
            ) : (
              textAt(source.index)
            )}
          </div>
        )
      }}
    />
  )
}
function TimeCursor({ points }: { points?: { x: number; y: number }[] }) {
  const id = `time-cursor-${useId().replace(/:/g, '')}`
  const start = points?.[0]
  const end = points?.[1]
  if (!start || !end) return null
  return (
    <g pointerEvents="none" data-time-cursor="">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.4} />
          <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <line x1={start.x} x2={end.x} y1={start.y} y2={end.y} stroke={`url(#${id})`} />
    </g>
  )
}
export function PeriodTick({
  x = 0,
  y = 0,
  payload,
  ticks,
}: {
  x?: number
  y?: number
  payload?: { value: number }
  ticks: Tick[]
}) {
  const tick = payload ? ticks[payload.value] : undefined
  if (!tick) return <g />
  return (
    <g transform={`translate(${x},${y})`} data-tick={tick.label}>
      <title>{tick.title}</title>
      <text textAnchor="middle" dy={16} fill="var(--muted-foreground)" fontSize={10.5}>
        {tick.label}
        {tick.incomplete ? ' ◌' : ''}
      </text>
    </g>
  )
}
export function numericDomain(values: (number | null)[], includeZero = false): [number, number] {
  let min = includeZero ? 0 : Infinity
  let max = includeZero ? 0 : -Infinity
  for (const value of values)
    if (value !== null && Number.isFinite(value)) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  if (!Number.isFinite(min)) return [0, 1]
  if (min === max)
    return min === 0 ? [-1, 1] : [min - Math.abs(min) * 0.05, max + Math.abs(max) * 0.05]
  return [min, max]
}
/** Recharts custom-shape input is an external boundary; only finite supplied geometry is used. */
export function coordinates(
  input: unknown,
): { cx: number; cy: number; index?: number; payload?: Record<string, unknown> } | undefined {
  if (!input || typeof input !== 'object') return undefined
  const p = input as Record<string, unknown>
  if (
    typeof p.cx !== 'number' ||
    typeof p.cy !== 'number' ||
    !Number.isFinite(p.cx) ||
    !Number.isFinite(p.cy)
  )
    return undefined
  return {
    cx: p.cx,
    cy: p.cy,
    ...(typeof p.index === 'number' ? { index: p.index } : {}),
    ...(p.payload && typeof p.payload === 'object'
      ? { payload: p.payload as Record<string, unknown> }
      : {}),
  }
}

/** Roving access retains every saved mark when dense paths omit static dot DOM. */
export function DensePointNavigator({
  points,
}: {
  points: { row: number; field: string; label: string }[]
}) {
  const t = useCopy()
  const selection = useChartSelection()
  const [cursor, setCursor] = useState(0)
  if (!selection || !points.length) return null
  const index = Math.min(cursor, points.length - 1)
  const point = points[index]!
  const move = (delta: number) =>
    setCursor((value) => (value + delta + points.length) % points.length)
  return (
    <div
      className="flex items-center gap-2"
      data-chart-navigator=""
      data-point-count={points.length}
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t('marivo.presentation.ui-chart-previous-point')}
        onClick={() => move(-1)}
      >
        ←
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="max-w-full min-w-0 whitespace-normal"
        data-frame-point={`${point.row}:${point.field}`}
        aria-label={t('marivo.presentation.ui-chart-inspect-point', { p0: point.label })}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            move(event.key === 'ArrowRight' ? 1 : -1)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            setCursor(event.key === 'Home' ? 0 : points.length - 1)
          }
        }}
        onClick={() => selection.select(point.row, point.field)}
      >
        {index + 1}/{points.length} · {point.label}
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t('marivo.presentation.ui-chart-next-point')}
        onClick={() => move(1)}
      >
        →
      </Button>
    </div>
  )
}

/** Label placement is supplied by Recharts; the scroll rail copies these coordinates. */
export function MemberTick({
  x = 0,
  y = 0,
  payload,
  labels,
}: {
  x?: number
  y?: number
  payload?: { value: number }
  labels: string[]
}) {
  const index = payload?.value ?? -1
  const label = labels[index] ?? ''
  return (
    <g transform={`translate(${x},${y})`} data-row-label={label} data-row-index={index}>
      <title>{label}</title>
      <text
        className="fv-row-label"
        textAnchor="end"
        dy={4}
        fill="var(--muted-foreground)"
        fontSize={10.5}
      >
        {label.length > 18 ? `${label.slice(0, 17)}…` : label}
      </text>
    </g>
  )
}
