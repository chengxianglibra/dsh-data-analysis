import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  Rectangle,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import { useCopy } from '../../i18n/context.tsx'
import { compact, type Tick } from '../charts/model.ts'
import { rectangleGeometry } from '../charts/observation.tsx'
import {
  ChartFrame,
  color,
  coordinates,
  ExactTooltip,
  Legend,
  MemberTick,
  numericDomain,
  PeriodTick,
} from '../charts/recharts.tsx'
import { type DomainPoint, DomainPointMark } from './domain-point-selection.tsx'

export interface SavedSeries {
  key: string
  label: string
  values: (number | null)[]
  exact: (index: number) => string
  point?: (index: number) => DomainPoint | undefined
  color?: string
  hollow?: boolean
  dashed?: boolean
  diamond?: boolean
}
function seriesColor(series: SavedSeries, index: number) {
  return series.color ?? color(index)
}
/** A series can describe the whole row, shared with other series. */
function tooltipText(label: string, series: string[], endLabel?: string): string {
  const parts = label ? [label] : []
  for (const text of new Set(series)) {
    const value = label && text.startsWith(`${label}\n`) ? text.slice(label.length + 1) : text
    if (value && value !== label) parts.push(value)
  }
  // End labels can also carry a separate summary (e.g. an alignment pair).
  // Avoid repeating one that is already a complete formatted value.
  if (
    endLabel &&
    !parts.some((part) =>
      part.split('\n').some((line) => line === endLabel || line.endsWith(`: ${endLabel}`)),
    )
  )
    parts.push(endLabel)
  return parts.join('\n')
}
function SavedDot({
  input,
  series,
  index,
  ticks,
}: {
  input: unknown
  series: SavedSeries
  index: number
  ticks?: Tick[]
}) {
  const p = coordinates(input)
  const row = p?.payload?.index
  if (
    !p ||
    typeof row !== 'number' ||
    series.values[row] === null ||
    series.values[row] === undefined
  )
    return <g />
  const fill = seriesColor(series, index)
  const hollow = series.hollow || ticks?.[row]?.incomplete
  const point = series.point?.(row)
  const mark = series.diamond ? (
    <path d={`M${p.cx},${p.cy - 6}l6,6l-6,6l-6,-6Z`} fill={fill} data-mark="contribution" />
  ) : (
    <circle
      cx={p.cx}
      cy={p.cy}
      r={hollow ? 5.5 : 3.5}
      fill={hollow ? 'var(--background)' : fill}
      stroke={fill}
      strokeWidth={2}
      data-mark={hollow ? 'hollow' : 'filled'}
    />
  )
  return (
    <DomainPointMark point={point}>
      <g data-chart-index={row} data-series={series.key}>
        {mark}
      </g>
    </DomainPointMark>
  )
}
export function SavedLinePlot({
  label,
  ticks,
  series,
  height = 260,
  legend = true,
}: {
  label: string
  ticks: Tick[]
  series: SavedSeries[]
  height?: number
  legend?: boolean
}) {
  const t = useCopy()
  const data = ticks.map((_, index) => ({
    index,
    values: series.map((line) => line.values[index] ?? null),
  }))
  return (
    <ChartFrame
      label={label}
      height={height}
      legend={
        legend ? (
          <Legend
            items={series.map((line, index) => ({
              label: line.label,
              color: seriesColor(line, index),
              shape: line.dashed ? 'dashed' : 'line',
            }))}
            showSingle
          />
        ) : undefined
      }
    >
      <ComposedChart
        aria-label={label}
        desc={label}
        data={data}
        margin={{ top: 16, right: 24, bottom: 12, left: 8 }}
        accessibilityLayer
      >
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
        <XAxis
          dataKey="index"
          type="number"
          domain={[-0.5, Math.max(0.5, ticks.length - 0.5)]}
          ticks={ticks.map((_, index) => index)}
          minTickGap={24}
          interval="preserveStartEnd"
          tickFormatter={(index) => ticks[index]?.label ?? ''}
          tick={<PeriodTick ticks={ticks} />}
        />
        <YAxis
          type="number"
          domain={numericDomain(series.flatMap((line) => line.values))}
          tickFormatter={(value) => compact(t.locale, value)}
          width={64}
        />
        <ExactTooltip
          textAt={(index) =>
            tooltipText(
              ticks[index]?.title ?? '',
              series.map((line) => line.exact(index)),
            )
          }
        />
        {series.map((line, index) => (
          <Line
            key={line.key}
            dataKey={(row: (typeof data)[number]) => row.values[index]}
            name={line.label}
            stroke={seriesColor(line, index)}
            strokeDasharray={line.dashed ? '5 4' : undefined}
            type="monotone"
            connectNulls={false}
            isAnimationActive={false}
            activeDot={false}
            dot={(input) => <SavedDot input={input} series={line} index={index} ticks={ticks} />}
          />
        ))}
      </ComposedChart>
    </ChartFrame>
  )
}
export interface SavedBarSeries extends SavedSeries {
  fillAt?: (index: number) => string
  ranges?: ([number, number] | null)[]
}
export function SavedRowPlot({
  label,
  labels,
  series,
  bars = false,
  domain,
  height,
  links,
  totalState,
  reference,
  endLabels,
  endLabelRail = false,
  connectors,
  overlayBars = false,
  tickFormatter,
}: {
  label: string
  labels: string[]
  series: SavedBarSeries[]
  bars?: boolean
  domain?: [number, number]
  height?: number
  links?: { from: number; to: number; index: number }[]
  totalState?: 'closed' | 'detached'
  reference?: number
  endLabels?: string[]
  /** Align detailed values in a separate right-hand column instead of beside a mark. */
  endLabelRail?: boolean
  connectors?: { from: { x: number; y: number }; to: { x: number; y: number }; total?: boolean }[]
  overlayBars?: boolean
  tickFormatter?: (value: number) => string
}) {
  const data = labels.map((_, index) => ({
    index,
    values: series.map((line) => (line.ranges ? line.ranges[index] : (line.values[index] ?? null))),
  }))
  const values = series.flatMap((line) =>
    line.ranges ? line.ranges.flatMap((range) => range ?? []) : line.values,
  )
  const plotDomain = domain ?? numericDomain(values, bars)
  // End labels can contain two full grouped values. Reserve room for them while
  // keeping a usable plotting area, scrolling locally for exceptionally long text.
  const endLabelWidth = endLabels
    ? Math.max(
        120,
        ...endLabels.map(
          (text) =>
            24 +
            Array.from(text).reduce(
              (width, character) => width + (character.codePointAt(0)! > 0xff ? 12 : 8),
              0,
            ),
        ),
      )
    : 32
  return (
    <div className="min-w-0 max-w-full" data-mark-total={totalState}>
      <ChartFrame
        label={label}
        width={Math.max(640, endLabelWidth + 320)}
        height={height ?? Math.max(160, labels.length * 28 + 48)}
        legend={
          <Legend
            items={series.map((line, index) => ({
              label: line.label,
              color: seriesColor(line, index),
              shape: line.diamond ? 'diamond' : line.hollow ? 'hollow' : bars ? 'square' : 'dot',
            }))}
          />
        }
      >
        <ComposedChart
          aria-label={label}
          desc={label}
          data={data}
          layout="vertical"
          barGap={overlayBars ? -18 : 4}
          barSize={overlayBars ? 18 : undefined}
          margin={{ top: 12, right: endLabelWidth, bottom: 8, left: 8 }}
          accessibilityLayer
        >
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis type="number" domain={plotDomain} tickFormatter={tickFormatter} />
          <YAxis
            type="category"
            dataKey="index"
            tick={<MemberTick labels={labels} />}
            width={140}
            interval={0}
            padding={endLabelRail ? { top: 10, bottom: 10 } : undefined}
          />
          <ExactTooltip
            textAt={(index) =>
              tooltipText(
                labels[index] ?? '',
                series.map((line) => line.exact(index)),
                endLabels?.[index],
              )
            }
          />
          <ReferenceLine x={0} stroke="var(--border)" />
          {reference !== undefined && (
            <ReferenceLine x={reference} stroke="var(--border)" strokeDasharray="4 3" />
          )}
          {connectors?.map((connector) => (
            <ReferenceLine
              key={`${connector.from.y}:${connector.to.y}`}
              segment={[connector.from, connector.to]}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 3"
              className={connector.total ? 'mv-connector-total' : 'mv-connector'}
            />
          ))}
          {links?.map((link) => (
            <ReferenceLine
              key={`${link.index}:${link.from}:${link.to}`}
              className="mv-domain-link"
              segment={[
                { x: link.from, y: link.index },
                { x: link.to, y: link.index },
              ]}
              stroke="var(--muted-foreground)"
            />
          ))}
          {series.map((line, index) =>
            bars && !line.diamond ? (
              <Bar
                key={line.key}
                dataKey={(row: (typeof data)[number]) => row.values[index]}
                name={line.label}
                fill={seriesColor(line, index)}
                isAnimationActive={false}
                maxBarSize={18}
                shape={(input) => {
                  const p = rectangleGeometry(input)
                  if (!p) return <g />
                  return (
                    <DomainPointMark point={line.point?.(p.index)}>
                      <g data-mark="bar">
                        <Rectangle
                          x={p.x}
                          y={p.y}
                          width={Math.max(p.width, 1)}
                          height={p.height}
                          radius={2}
                          fill={line.fillAt?.(p.index) ?? seriesColor(line, index)}
                        />
                      </g>
                    </DomainPointMark>
                  )
                }}
              />
            ) : (
              <Line
                key={line.key}
                dataKey={(row: (typeof data)[number]) => row.values[index]}
                stroke="none"
                isAnimationActive={false}
                activeDot={false}
                dot={(input) => <SavedDot input={input} series={line} index={index} />}
              />
            ),
          )}
          {endLabels && (
            <Line
              dataKey={(row: (typeof data)[number]) =>
                endLabelRail
                  ? (row.values.find((value) => typeof value === 'number') ?? plotDomain[0])
                  : row.values[0]
              }
              stroke="none"
              dot={false}
              isAnimationActive={false}
            >
              <LabelList
                dataKey={(row: (typeof data)[number]) => endLabels[row.index]}
                content={(input) => {
                  const p = coordinates({ ...input, cx: input.x, cy: input.y })
                  return p && typeof input.value === 'string' ? (
                    <text
                      data-chart-end-label=""
                      x={endLabelRail ? '100%' : p.cx + 12}
                      dx={endLabelRail ? -8 : undefined}
                      y={p.cy + 4}
                      textAnchor={endLabelRail ? 'end' : undefined}
                      fill="currentColor"
                      fontSize={12}
                    >
                      {input.value}
                    </text>
                  ) : (
                    <g />
                  )
                }}
              />
            </Line>
          )}
        </ComposedChart>
      </ChartFrame>
    </div>
  )
}
/** A compact, independent saved-delta scale below a comparison trajectory. */
export function SavedDeltaStrip({
  label,
  ticks,
  series,
}: {
  label: string
  ticks: Tick[]
  series: SavedSeries
}) {
  const data = ticks.map((_, index) => ({ index, value: series.values[index] ?? null }))
  return (
    <div data-strip="delta">
      <ChartFrame label={label} height={64}>
        <ComposedChart
          aria-label={label}
          desc={label}
          data={data}
          margin={{ top: 8, right: 24, bottom: 4, left: 72 }}
          accessibilityLayer
        >
          <XAxis
            dataKey="index"
            type="number"
            domain={[-0.5, Math.max(0.5, ticks.length - 0.5)]}
            hide
          />
          <YAxis domain={numericDomain(series.values, true)} hide />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ExactTooltip textAt={series.exact} />
          <Bar
            dataKey="value"
            fill={series.color ?? 'var(--muted-foreground)'}
            isAnimationActive={false}
            maxBarSize={12}
            shape={(input) => {
              const p = rectangleGeometry(input)
              if (!p) return <g />
              return (
                <DomainPointMark point={series.point?.(p.index)}>
                  <g data-mark="bar">
                    <Rectangle
                      x={p.x}
                      y={p.y}
                      width={p.width}
                      height={Math.max(1, p.height)}
                      fill={
                        (series.values[p.index] ?? 0) < 0
                          ? 'var(--mv-down)'
                          : (series.values[p.index] ?? 0) > 0
                            ? 'var(--mv-up)'
                            : 'var(--foreground)'
                      }
                      radius={2}
                    />
                  </g>
                </DomainPointMark>
              )
            }}
          />
        </ComposedChart>
      </ChartFrame>
    </div>
  )
}
