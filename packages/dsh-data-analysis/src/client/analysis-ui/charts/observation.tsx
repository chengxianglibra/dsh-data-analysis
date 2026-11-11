import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  Rectangle,
  ReferenceLine,
  Scatter,
  ScatterChart,
  usePlotArea,
  XAxis,
  YAxis,
} from 'recharts'
import { useCopy } from '../../i18n/context.tsx'
import { Button } from '../../ui/primitives/button.tsx'
import {
  axisOf,
  type ChartAxis,
  type ChartGroup,
  type ChartModel,
  type ChartProps,
  cellOf,
  columnOf,
  compact,
  displayed,
  firstCell,
  groupRows,
  partitions,
  rowsOf,
  ticksOf,
  valueAt,
  valueName,
} from './model.ts'
import {
  ChartFrame,
  color,
  coordinates,
  DensePointNavigator,
  ExactTooltip,
  Legend,
  MemberTick,
  NEUTRAL,
  numericDomain,
  PeriodTick,
  summary,
} from './recharts.tsx'
import { useChartSelection } from './selection-context.tsx'

/** Only identical declared units share a numeric scale; unknown units remain field-specific. */
function unitGroups(s: ChartModel, values: string[], broadcast: string[]) {
  const groups = new Map<string, { values: string[]; broadcast: string[] }>()
  for (const [names, role] of [
    [values, 'values'],
    [broadcast, 'broadcast'],
  ] as const)
    for (const name of names) {
      const unit = columnOf(s, name)?.column.unit
      const key = unit ? `unit:${unit}` : `unknown:${name}`
      let group = groups.get(key)
      if (!group) {
        group = { values: [], broadcast: [] }
        groups.set(key, group)
      }
      group[role].push(name)
    }
  return [...groups.values()]
}
export function SelectableMark({
  row,
  field,
  label,
  children,
}: {
  row: number
  field: string
  label: string
  children: ReactNode
}) {
  const selection = useChartSelection()
  if (!selection) return <>{children}</>
  return (
    // biome-ignore lint/a11y/useSemanticElements: An SVG mark has no native button; expose keyboard activation.
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      data-frame-point={`${row}:${field}`}
      style={{ cursor: 'pointer' }}
      onClick={() => selection.select(row, field)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selection.select(row, field)
        }
      }}
    >
      {children}
    </g>
  )
}
export function TimeChart(props: ChartProps<'line' | 'area' | 'bar' | 'interval-bar'>) {
  const groups = unitGroups(props.model, props.view.values, props.view.broadcast).flatMap((unit) =>
    props.view.series && unit.values.length > 1
      ? unit.values.map((name) => ({ values: [name], broadcast: unit.broadcast }))
      : [unit],
  )
  if (groups.length <= 1) return <TimeChartPlot {...props} />
  return (
    <div className="fv-parents">
      {groups.map((group, index) => (
        <section className="fv-parent" key={JSON.stringify(group)}>
          <h4>
            {[...group.values, ...group.broadcast]
              .map((name) => valueName(props.model, name))
              .join(' · ')}
          </h4>
          <TimeChartPlot {...props} view={{ ...props.view, ...group }} showLegend={index === 0} />
        </section>
      ))}
    </div>
  )
}
function TimeChartPlot({
  model: s,
  view,
  height: requestedHeight,
  showLegend = true,
}: ChartProps<'line' | 'area' | 'bar' | 'interval-bar'> & { showLegend?: boolean }) {
  const t = useCopy()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const { ticks, tickOf } = ticksOf(s, axis)
  const height = requestedHeight ?? (ticks.length === 1 ? 160 : 260)
  const seriesAxis = axisOf(s, view.series)
  const visible = s.visibleRowIndices ? new Set(s.visibleRowIndices) : undefined
  const groups = seriesAxis
    ? groupRows(
        s,
        [seriesAxis],
        s.data.rows.map((_, i) => i),
      ).map((group) => ({
        ...group,
        rows: visible ? group.rows.filter((row) => visible.has(row)) : group.rows,
      }))
    : [{ key: '', label: '', rows: rowsOf(s) }]
  const series = groups.flatMap((group, gi) =>
    view.values.map((name, vi) => ({
      key: `s${gi}_${vi}`,
      name,
      label: [group.label, valueName(s, name)].filter(Boolean).join(' · '),
      color: color(seriesAxis ? gi : vi),
      marker: seriesAxis ? gi : undefined,
      rows: new Map(group.rows.map((row) => [tickOf(row), row])),
    })),
  )
  const bars = view.chart === 'bar' || view.chart === 'interval-bar'
  const hasMissingBar =
    bars &&
    series.some((line) => [...line.rows.values()].some((row) => cellOf(s, row, line.name) === null))
  const barChartWidth = s.frameStyle ? Math.max(300, Math.min(640, ticks.length * 18 + 90)) : 640
  // Dense bars cannot fit a text label for every cell. A compact mark and key
  // preserve the missing state without making the entire chart extremely wide.
  const compactMissing = hasMissingBar && (barChartWidth - 96) / (ticks.length * series.length) < 18
  const highlightedKey = s.highlight?.axis === axis.id ? s.highlight.key : undefined
  const showLabels =
    !!s.frameStyle && ticks.length <= 12 && series.length === 1 && !(bars && highlightedKey)
  const data = ticks.map((_, index) =>
    Object.assign(
      { index },
      ...series.map((line) => {
        const row = line.rows.get(index)
        const value = row === undefined ? null : valueAt(s, row, line.name)
        // Recharts omits null bars altogether. Use a zero-sized layout anchor for a
        // saved null cell; the shape renders an NA label instead of a numeric mark.
        const anchor = bars && row !== undefined && cellOf(s, row, line.name) === null ? 0 : value
        if (!showLabels || bars) return { [line.key]: anchor }
        return {
          [line.key]: value,
          [`${line.key}Label`]:
            row === undefined || value === null
              ? ''
              : displayed(s, cellOf(s, row, line.name), columnOf(s, line.name)?.column),
        }
      }),
    ),
  )
  const refs = view.broadcast.flatMap((name) =>
    partitions(s, name).map((part) => {
      const first = firstCell(s, part.rows, name)
      const indices = part.rows.map(tickOf).filter((i) => i >= 0)
      return {
        name,
        label: part.label,
        value: first.value,
        y: valueAt(s, first.row, name),
        from: Math.min(...indices),
        to: Math.max(...indices),
      }
    }),
  )
  const referenceData = data.map((item) => ({
    ...item,
    __reference: refs.find((ref) => item.index >= ref.from && item.index <= ref.to)?.y ?? null,
  }))
  const tip = (index: number) =>
    [
      ticks[index]?.title ?? '',
      ...series.map((line) => {
        const row = line.rows.get(index)
        return `${line.label}: ${displayed(s, row === undefined ? null : cellOf(s, row, line.name), columnOf(s, line.name)?.column)}`
      }),
      ...refs
        .filter((ref) => index >= ref.from && index <= ref.to)
        .map(
          (ref) =>
            `${valueName(s, ref.name)}: ${displayed(s, ref.value, columnOf(s, ref.name)?.column)}`,
        ),
    ].join('\n')
  const label = summary(
    t,
    series.map((line) => line.label).join(' · '),
    ticks.map((_, index) => tip(index)),
  )
  const baseDomain = numericDomain(
    [
      ...series.flatMap((line) =>
        ticks.map((_, index) => {
          const row = line.rows.get(index)
          return row === undefined ? null : valueAt(s, row, line.name)
        }),
      ),
      ...refs.map((ref) => ref.y),
    ],
    bars || view.chart === 'area',
  )
  const padding = (baseDomain[1] - baseDomain[0]) * 0.14
  const domain: [number, number] = showLabels
    ? [baseDomain[0] < 0 && bars ? baseDomain[0] - padding : baseDomain[0], baseDomain[1] + padding]
    : baseDomain
  const dense = !bars && ticks.length * series.length > 2000
  return (
    <>
      <ChartFrame
        label={label}
        height={height}
        width={s.frameStyle && bars ? barChartWidth : undefined}
        legend={
          <>
            {showLegend && (
              <Legend
                items={[
                  ...series.map((line) => ({
                    label: line.label,
                    color: line.color,
                    shape: bars ? ('square' as const) : ('line' as const),
                  })),
                  ...view.broadcast.map((name) => ({
                    label: valueName(s, name),
                    color: NEUTRAL,
                    shape: 'dashed' as const,
                  })),
                ]}
                showSingle={!!view.series}
              />
            )}
            {compactMissing && (
              <div className="text-center text-xs" data-missing-key="">
                <span aria-hidden="true">× </span>NA
              </div>
            )}
          </>
        }
      >
        <ComposedChart
          aria-label={label}
          desc={label}
          data={referenceData}
          margin={{ top: 16, right: 24, bottom: 12, left: 8 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="index"
            type="number"
            domain={[-0.5, Math.max(0.5, ticks.length - 0.5)]}
            ticks={ticks.map((_, index) => index)}
            interval="preserveStartEnd"
            minTickGap={24}
            tickFormatter={(index) => ticks[index]?.label ?? ''}
            tick={<PeriodTick ticks={ticks} />}
          />
          <YAxis
            domain={domain}
            padding={bars ? undefined : { top: 4, bottom: 4 }}
            tickFormatter={(value) => compact(t.locale, value)}
            width={64}
          />
          <ExactTooltip textAt={tip} />
          {domain[0] <= 0 && domain[1] >= 0 && <ReferenceLine y={0} stroke="var(--border)" />}
          {series.map((line) => {
            const dot = (input: unknown) => {
              const point = coordinates(input)
              const index = point?.payload?.index
              if (!point || typeof index !== 'number') return <g />
              const row = line.rows.get(index)
              if (row === undefined || valueAt(s, row, line.name) === null) return <g />
              const title = `${ticks[index]?.title ?? ''}\n${line.label}: ${displayed(s, cellOf(s, row, line.name), columnOf(s, line.name)?.column)}`
              return (
                <SelectableMark row={row} field={line.name} label={title}>
                  <circle
                    cx={point.cx}
                    cy={point.cy}
                    r={seriesAxis ? 4 : 3}
                    fill={ticks[index]?.incomplete ? 'var(--background)' : line.color}
                    stroke={line.color}
                    strokeWidth={2}
                    data-mark={ticks[index]?.incomplete ? 'hollow' : 'filled'}
                    data-marker={line.marker}
                  />
                </SelectableMark>
              )
            }
            if (bars)
              return (
                <Bar
                  key={line.key}
                  dataKey={line.key}
                  name={line.label}
                  fill={line.color}
                  isAnimationActive={false}
                  maxBarSize={s.frameStyle ? 44 : undefined}
                  shape={(input) => {
                    const p = rectangleGeometry(input)
                    if (!p) return <g />
                    const row = line.rows.get(p.index)
                    if (row === undefined) return <g />
                    if (cellOf(s, row, line.name) === null) {
                      const x = p.x + p.width / 2
                      const below = domain[1] <= 0
                      const y = p.y + (below ? 8 : -8)
                      if (compactMissing)
                        return (
                          <g data-mark="missing">
                            <title>{`${ticks[p.index]?.title ?? ''} · ${line.label}: NA`}</title>
                            <path
                              d={`M${x - 3},${y - 3} l6,6 m0,-6 l-6,6`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.5}
                            />
                          </g>
                        )
                      return (
                        <text
                          x={x}
                          y={y + (below ? 4 : 0)}
                          textAnchor="middle"
                          fill="currentColor"
                          fontSize={12}
                          data-mark="missing"
                        >
                          NA
                        </text>
                      )
                    }
                    const highlighted =
                      highlightedKey !== undefined && axis.keys[row] === highlightedKey
                    const title = `${ticks[p.index]?.title ?? ''}\n${line.label}: ${displayed(s, cellOf(s, row, line.name), columnOf(s, line.name)?.column)}`
                    return (
                      <SelectableMark row={row} field={line.name} label={title}>
                        <g
                          data-mark={
                            ticks[p.index]?.incomplete
                              ? 'hatched'
                              : valueAt(s, row, line.name) === 0
                                ? 'zero'
                                : 'bar'
                          }
                          data-highlighted={highlighted || undefined}
                        >
                          <title>{title}</title>
                          <Rectangle
                            x={p.x}
                            y={p.y}
                            width={p.width}
                            height={Math.max(p.height, 1)}
                            fill={highlighted ? color(3) : line.color}
                            fillOpacity={ticks[p.index]?.incomplete ? 0.45 : 1}
                            stroke={ticks[p.index]?.incomplete ? line.color : undefined}
                            strokeDasharray={ticks[p.index]?.incomplete ? '3 2' : undefined}
                            radius={2}
                          />
                          {showLabels && (
                            <text
                              x={p.x + p.width / 2}
                              y={
                                (valueAt(s, row, line.name) ?? 0) < 0
                                  ? p.y + p.height + 16
                                  : p.y - 8
                              }
                              textAnchor="middle"
                              fill={line.color}
                              fontSize={12}
                            >
                              {displayed(
                                s,
                                cellOf(s, row, line.name),
                                columnOf(s, line.name)?.column,
                              )}
                            </text>
                          )}
                        </g>
                      </SelectableMark>
                    )
                  }}
                />
              )
            return view.chart === 'area' ? (
              <Area
                key={line.key}
                dataKey={line.key}
                name={line.label}
                type="linear"
                stroke={line.color}
                fill={line.color}
                fillOpacity={0.16}
                baseValue={0}
                connectNulls={false}
                isAnimationActive={false}
                dot={ticks.length * series.length > 2000 ? false : dot}
                activeDot={dot}
              >
                {showLabels && (
                  <LabelList
                    dataKey={`${line.key}Label`}
                    position="top"
                    offset={12}
                    fill={line.color}
                    fontSize={12}
                  />
                )}
              </Area>
            ) : (
              <Line
                key={line.key}
                dataKey={line.key}
                name={line.label}
                type="linear"
                stroke={line.color}
                strokeDasharray={seriesAxis ? `${4 + series.indexOf(line)} 2` : undefined}
                connectNulls={false}
                isAnimationActive={false}
                dot={ticks.length * series.length > 2000 ? false : dot}
                activeDot={dot}
              >
                {showLabels && (
                  <LabelList
                    dataKey={`${line.key}Label`}
                    position="top"
                    offset={12}
                    fill={line.color}
                    fontSize={12}
                  />
                )}
              </Line>
            )
          })}
          {/* A reference-only facet still registers its saved numeric field with Recharts. */}
          {series.length === 0 && (
            <Line
              dataKey="__reference"
              stroke="none"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {refs.map((ref) =>
            ref.y === null || !Number.isFinite(ref.from) ? null : (
              <ReferenceLine
                key={`${ref.name}:${ref.from}:${ref.to}`}
                className="mv-broadcast-reference"
                segment={[
                  { x: ref.from - 0.45, y: ref.y },
                  { x: ref.to + 0.45, y: ref.y },
                ]}
                stroke={NEUTRAL}
                strokeDasharray="4 3"
                label={{
                  value: displayed(s, ref.value, columnOf(s, ref.name)?.column),
                  position: 'insideTopRight',
                }}
              />
            ),
          )}
        </ComposedChart>
      </ChartFrame>
      {dense && (
        <DensePointNavigator
          points={series.flatMap((line) =>
            ticks.flatMap((tick, index) => {
              const row = line.rows.get(index)
              return row === undefined || valueAt(s, row, line.name) === null
                ? []
                : [
                    {
                      row,
                      field: line.name,
                      label: `${tick.title} · ${line.label}: ${displayed(s, cellOf(s, row, line.name), columnOf(s, line.name)?.column)}`,
                    },
                  ]
            }),
          )}
        />
      )}
    </>
  )
}
export function rectangleGeometry(
  input: unknown,
): { x: number; y: number; width: number; height: number; index: number } | undefined {
  if (!input || typeof input !== 'object') return undefined
  const p = input as Record<string, unknown>
  const payload =
    p.payload && typeof p.payload === 'object' ? (p.payload as Record<string, unknown>) : undefined
  if (
    typeof p.x !== 'number' ||
    typeof p.y !== 'number' ||
    typeof p.width !== 'number' ||
    typeof p.height !== 'number' ||
    typeof payload?.index !== 'number'
  )
    return undefined
  return {
    x: p.width < 0 ? p.x + p.width : p.x,
    y: p.height < 0 ? p.y + p.height : p.y,
    width: Math.abs(p.width),
    height: Math.abs(p.height),
    index: payload.index,
  }
}
export function HBarChart(props: ChartProps<'hbar'>) {
  const t = useCopy()
  const [selectedGroup, setSelectedGroup] = useState<string>()
  const groups = unitGroups(props.model, props.view.values, props.view.broadcast).flatMap(
    (group) =>
      props.model.frameStyle && group.values.length > 1
        ? group.values.map((name) => ({ values: [name], broadcast: group.broadcast }))
        : [group],
  )
  if (groups.length <= 1) return <HBarChartPlot {...props} />
  if (props.model.frameStyle) {
    const metrics = groups.filter((group) => group.values.length > 0)
    const references = groups.filter((group) => group.values.length === 0)
    const key = (group: (typeof groups)[number]) => JSON.stringify(group)
    const selected = metrics.find((group) => key(group) === selectedGroup) ?? metrics[0]
    return (
      <div className="fv-parents">
        {metrics.length > 1 && (
          <fieldset
            className="fv-hbar-controls"
            aria-label={t('marivo.presentation.ui-frame-comparison-metric')}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            {metrics.map((group) => (
              <Button
                key={key(group)}
                variant="outline"
                size="xs"
                aria-pressed={group === selected}
                onClick={() => setSelectedGroup(key(group))}
              >
                {group.values.map((name) => valueName(props.model, name)).join(' · ')}
              </Button>
            ))}
          </fieldset>
        )}
        {selected && <HBarChartPlot {...props} view={{ ...props.view, ...selected }} />}
        {references.map((group) => (
          <section className="fv-parent" key={key(group)}>
            <h4>{group.broadcast.map((name) => valueName(props.model, name)).join(' · ')}</h4>
            <HBarChartPlot {...props} view={{ ...props.view, ...group }} />
          </section>
        ))}
      </div>
    )
  }
  return (
    <div className="fv-parents">
      {groups.map((group) => (
        <section className="fv-parent" key={JSON.stringify(group)}>
          <h4>
            {[...group.values, ...group.broadcast]
              .map((name) => valueName(props.model, name))
              .join(' · ')}
          </h4>
          <HBarChartPlot {...props} view={{ ...props.view, ...group }} />
        </section>
      ))}
    </div>
  )
}
/** Category labels have a real width budget; long values retain their full title. */
function HBarMemberTick({
  x = 0,
  y = 0,
  payload,
  labels,
  maxCharacters,
}: {
  x?: number
  y?: number
  payload?: { value: number }
  labels: string[]
  maxCharacters: number
}) {
  const index = payload?.value ?? -1
  const label = labels[index] ?? ''
  const text = label.length > maxCharacters ? `${label.slice(0, maxCharacters - 1)}…` : label
  return (
    <g transform={`translate(${x},${y})`} data-row-label={label} data-row-index={index}>
      <title>{label}</title>
      <text className="fv-row-label" textAnchor="end" dy={4} fill="currentColor">
        {text}
      </text>
    </g>
  )
}
function HBarChartPlot({ model: s, view, height: requestedHeight }: ChartProps<'hbar'>) {
  const t = useCopy()
  const regionRef = useRef<HTMLElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const axis = axisOf(s, view.axis)
  useEffect(() => {
    const element = regionRef.current
    if (!element || !s.frameStyle || !axis) return
    const update = () => setAvailableWidth(element.clientWidth)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [s.frameStyle, axis])
  if (!axis) return null
  const rows = rowsOf(s).slice(0, s.rowLimit)
  const data = rows.map((index) =>
    Object.assign(
      { index },
      ...view.values.map((name, vi) => ({
        // The zero-sized bar only supplies positioning; null is never selectable.
        [`v${vi}`]: cellOf(s, index, name) === null ? 0 : valueAt(s, index, name),
        [`v${vi}Label`]:
          valueAt(s, index, name) === null
            ? ''
            : displayed(s, cellOf(s, index, name), columnOf(s, name)?.column),
      })),
    ),
  )
  const refs = view.broadcast.flatMap((name) =>
    partitions(s, name).map((part) => {
      const first = firstCell(s, part.rows, name)
      return {
        name,
        x: valueAt(s, first.row, name),
        value: first.value,
        from: Math.min(...part.rows),
        to: Math.max(...part.rows),
      }
    }),
  )
  const referenceData = data.map((item) => ({
    ...item,
    __reference: refs.find((ref) => item.index >= ref.from && item.index <= ref.to)?.x ?? null,
  }))
  const tip = (row: number) =>
    [
      axis.labels[row] ?? '',
      ...[...view.values, ...view.broadcast].map(
        (name) =>
          `${valueName(s, name)}: ${displayed(s, cellOf(s, row, name), columnOf(s, name)?.column)}`,
      ),
    ].join('\n')
  const label = summary(t, view.values.map((name) => valueName(s, name)).join(' · '), rows.map(tip))
  const showLabels = !!s.frameStyle && view.values.length === 1
  const valueWidth = showLabels
    ? Math.min(
        1000,
        Math.max(60, ...data.map((item) => String(item.v0Label ?? '').length * 8 + 16)),
      )
    : 32
  const naturalAxisWidth = Math.min(
    200,
    Math.max(140, ...axis.labels.map((text) => Math.min(text.length, 42) * 8 + 16)),
  )
  const axisWidth = s.frameStyle
    ? Math.min(
        naturalAxisWidth,
        availableWidth ? Math.max(90, availableWidth - valueWidth - 80) : naturalAxisWidth,
      )
    : 140
  const chartHeight = Math.max(140, rows.length * (22 * view.values.length + 8) + 48)
  return (
    <section
      ref={regionRef}
      aria-label={label}
      style={
        requestedHeight && chartHeight > requestedHeight
          ? { maxHeight: requestedHeight, overflowY: 'auto' }
          : undefined
      }
      tabIndex={requestedHeight && chartHeight > requestedHeight ? 0 : undefined}
    >
      <ChartFrame
        label={label}
        width={s.frameStyle ? Math.max(250, axisWidth + valueWidth + 80) : undefined}
        height={chartHeight}
        legend={
          <Legend
            items={view.values.map((name, vi) => ({ label: valueName(s, name), color: color(vi) }))}
          />
        }
      >
        <ComposedChart
          title={label}
          desc={label}
          data={referenceData}
          layout="vertical"
          margin={{ top: 12, right: valueWidth, bottom: 8, left: 8 }}
          accessibilityLayer
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            dataKey="__reference"
            allowDataOverflow
            type="number"
            domain={numericDomain(
              [
                ...rows.flatMap((row) => view.values.map((name) => valueAt(s, row, name))),
                ...refs.map((ref) => ref.x),
              ],
              true,
            )}
            tickFormatter={(value) => compact(t.locale, value)}
          />
          <YAxis
            allowDataOverflow
            type="category"
            dataKey="index"
            tick={
              s.frameStyle ? (
                <HBarMemberTick
                  labels={axis.labels}
                  maxCharacters={Math.floor((axisWidth - 16) / 8)}
                />
              ) : (
                <MemberTick labels={axis.labels} />
              )
            }
            width={axisWidth}
            interval={0}
          />
          <ExactTooltip textAt={tip} />
          <ReferenceLine x={0} stroke="var(--border)" />
          {view.values.map((name, vi) => (
            <Bar
              key={name}
              dataKey={`v${vi}`}
              name={valueName(s, name)}
              fill={color(vi)}
              isAnimationActive={false}
              shape={(input) => {
                const p = rectangleGeometry(input)
                if (!p) return <g />
                if (cellOf(s, p.index, name) === null)
                  return (
                    <text
                      x={p.x + 4}
                      y={p.y + p.height / 2 + 4}
                      fill="currentColor"
                      fontSize={12}
                      data-mark="missing"
                    >
                      NA
                    </text>
                  )
                const title = `${axis.labels[p.index] ?? ''} · ${valueName(s, name)}: ${displayed(s, cellOf(s, p.index, name), columnOf(s, name)?.column)}`
                return (
                  <SelectableMark row={p.index} field={name} label={title}>
                    <g data-mark="bar">
                      <title>{title}</title>
                      <Rectangle {...p} width={Math.max(p.width, 1)} radius={2} fill={color(vi)} />
                    </g>
                  </SelectableMark>
                )
              }}
            >
              {showLabels && (
                <LabelList
                  dataKey={`v${vi}Label`}
                  position="right"
                  fill="currentColor"
                  fontSize={12}
                />
              )}
            </Bar>
          ))}
          {view.values.length === 0 && (
            <Line
              dataKey="__reference"
              stroke="none"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {refs.map((ref) =>
            ref.x === null ? null : (
              <ReferenceLine
                key={`${ref.name}:${ref.from}:${ref.to}`}
                className="mv-broadcast-reference"
                segment={[
                  { x: ref.x, y: ref.from },
                  { x: ref.x, y: ref.to },
                ]}
                stroke={NEUTRAL}
                strokeDasharray="4 3"
                label={{ value: displayed(s, ref.value, columnOf(s, ref.name)?.column) }}
              />
            ),
          )}
        </ComposedChart>
      </ChartFrame>
    </section>
  )
}
/** The grid is one SVG pattern; sparse layouts do not allocate a mark for each missing pair. */
function HeatGrid({
  columns,
  rows,
  missing,
  nulls,
}: {
  columns: number
  rows: number
  missing: number
  nulls: number
}) {
  const area = usePlotArea()
  const id = `heat-grid-${useId().replace(/:/g, '')}`
  if (!area || !columns || !rows) return null
  return (
    <g pointerEvents="none">
      <defs>
        <pattern
          id={id}
          width={area.width / columns}
          height={area.height / rows}
          patternUnits="userSpaceOnUse"
          x={area.x}
          y={area.y}
        >
          <rect
            width={area.width / columns}
            height={area.height / rows}
            fill="var(--muted)"
            fillOpacity={0.2}
            stroke="var(--border)"
          />
        </pattern>
      </defs>
      <rect
        {...area}
        fill={`url(#${id})`}
        data-heatmap-grid="sparse"
        data-heatmap-missing-count={missing}
        data-heatmap-null-count={nulls}
      />
    </g>
  )
}
function HeatCell({
  input,
  columns,
  rows,
  fill,
  children,
}: {
  input: unknown
  columns: number
  rows: number
  fill: { fill: string; fillOpacity: number }
  children: ReactNode
}) {
  const area = usePlotArea()
  const point = coordinates(input)
  if (!point || !area) return <g />
  const width = area.width / columns
  const height = area.height / rows
  return (
    <g>
      <rect
        x={point.cx - width / 2 + 1}
        y={point.cy - height / 2 + 1}
        width={Math.max(1, width - 2)}
        height={Math.max(1, height - 2)}
        rx={2}
        {...fill}
      />
      {children}
    </g>
  )
}
interface HeatmapLabel {
  label: string
  title: string
  incomplete: boolean
  period?: boolean
}

/** Resolve display labels from captured period facts while retaining the original grouping key. */
function heatmapLabel(axis: ChartAxis, group: ChartGroup): HeatmapLabel {
  const row = group.rows[0]
  const index = row === undefined ? undefined : axis.ticks?.indices[row]
  const tick = index === undefined ? undefined : axis.ticks?.ticks[index]
  return tick && index !== undefined && axis.ticks?.captured?.[index]
    ? { ...tick, period: true }
    : { label: group.label, title: group.label, incomplete: false }
}

/** Captured period labels are bounded to the fixed two-line header; full text stays in title. */
function periodLines(item: HeatmapLabel): string[] {
  const take = (text: string, limit: number) => {
    let width = 0
    const chars = Array.from(text)
    let end = 0
    for (const char of chars) {
      const next = (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1
      if (width + next > limit) break
      width += next
      end++
    }
    return [chars.slice(0, end).join('').trim(), chars.slice(end).join('').trim()] as const
  }
  const [first, remainder] = take(item.label, 11)
  if (!remainder) {
    if (!item.incomplete) return [first]
    const [, overflow] = take(first, 9)
    return overflow ? [first, '◌'] : [`${first} ◌`]
  }
  const [second, rest] = take(remainder, item.incomplete ? 8 : 10)
  return [first, `${second}${rest ? '…' : ''}${item.incomplete ? ' ◌' : ''}`]
}

function HeatmapColumnTick({
  x = 0,
  y = 0,
  payload,
  labels,
}: {
  x?: number
  y?: number
  payload?: { value: number }
  labels: HeatmapLabel[]
}) {
  const item = labels[payload?.value ?? -1]
  const label = item?.label ?? ''
  const text = `${label}${item?.incomplete ? ' ◌' : ''}`
  const words = text.split(' ')
  const lines = item?.period
    ? periodLines(item)
    : words.length > 1
      ? words
      : (text.match(/.{1,11}/gu) ?? [''])
  return (
    <g transform={`translate(${x},${y})`}>
      <text data-heatmap-column={label} textAnchor="middle" fill="currentColor">
        <title>{item?.title ?? label}</title>
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Wrapped label lines have fixed physical positions, including repeated words.
          <tspan key={`${index}:${line}`} x={0} y={-8 - (lines.length - 1 - index) * 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}
function HeatmapRowTick({
  x = 0,
  y = 0,
  payload,
  labels,
}: {
  x?: number
  y?: number
  payload?: { value: number }
  labels: HeatmapLabel[]
}) {
  const index = payload?.value ?? -1
  const item = labels[index]
  const label = `${item?.label ?? ''}${item?.incomplete ? ' ◌' : ''}`
  const visible =
    item && item.label.length > 18 ? `${item.label.slice(0, 17)}…` : (item?.label ?? '')
  return (
    <g
      transform={`translate(${x},${y})`}
      data-row-label={item?.label ?? ''}
      data-row-incomplete={item?.incomplete || undefined}
      data-row-index={index}
    >
      <title>{item?.title ?? label}</title>
      <text className="fv-row-label" textAnchor="end" dy={4} fill="currentColor">
        {visible}
        {item?.incomplete ? ' ◌' : ''}
      </text>
    </g>
  )
}
export function Heatmap({ model: s, view }: ChartProps<'heatmap'>) {
  const t = useCopy()
  const xAxis = axisOf(s, view.x)
  const yAxis = axisOf(s, view.y)
  if (!xAxis || !yAxis) return null
  const xs = groupRows(s, [xAxis])
  const ys = groupRows(s, [yAxis])
  const xLabels = xs.map((group) => heatmapLabel(xAxis, group))
  const yLabels = ys.map((group) => heatmapLabel(yAxis, group))
  const columnWidth = Math.max(
    24,
    ...xLabels.map((item) => Math.min(11, item.label.length) * 8 + 8),
  )
  const xOf = new Map<number, number>()
  const yOf = new Map<number, number>()
  xs.forEach((group, index) => {
    for (const row of group.rows) xOf.set(row, index)
  })
  ys.forEach((group, index) => {
    for (const row of group.rows) yOf.set(row, index)
  })
  const data = rowsOf(s).map((index) => ({
    index,
    x: xOf.get(index)!,
    y: yOf.get(index)!,
    value: valueAt(s, index, view.value),
  }))
  const domain = numericDomain(data.map((point) => point.value))
  const min = domain[0]
  const max = domain[1]
  const diverging = min < 0 && max > 0
  const fill = (value: number | null) => ({
    fill: value === null ? 'var(--muted)' : color(value < 0 && diverging ? 1 : 0),
    fillOpacity:
      value === null
        ? 0.35
        : 0.12 +
          0.88 *
            (diverging
              ? Math.abs(value) / Math.max(Math.abs(min), Math.abs(max))
              : (value - min) / (max - min || 1)),
  })
  const col = columnOf(s, view.value)?.column
  const tip = (row: number) =>
    `${xLabels[xOf.get(row)!]?.title ?? ''} · ${yLabels[yOf.get(row)!]?.title ?? ''}: ${displayed(s, cellOf(s, row, view.value), col)}`
  const label = summary(t, valueName(s, view.value), rowsOf(s).map(tip))
  const finite = data.filter((point) => point.value !== null)
  const minPoint = finite.reduce<(typeof finite)[number] | undefined>(
    (best, point) => (!best || point.value! < best.value! ? point : best),
    undefined,
  )
  const maxPoint = finite.reduce<(typeof finite)[number] | undefined>(
    (best, point) => (!best || point.value! > best.value! ? point : best),
    undefined,
  )
  return (
    <ChartFrame
      label={label}
      width={Math.max(640, xs.length * columnWidth + 170)}
      height={Math.max(180, ys.length * 28 + 80)}
      legend={
        minPoint && maxPoint ? (
          <div
            className="flex gap-3 text-xs"
            data-heatmap-scale={diverging ? 'diverging' : 'sequential'}
          >
            <span>{valueName(s, view.value)}</span>
            <span>
              {t('marivo.presentation.ui-chart-missing-pairs', {
                p0: xs.length * ys.length - data.length,
              })}
            </span>
            <span>
              {t('marivo.presentation.ui-chart-null-values', { p0: data.length - finite.length })}
            </span>
            <span title={displayed(s, cellOf(s, minPoint.index, view.value), col)}>
              {displayed(s, cellOf(s, minPoint.index, view.value), col)}
            </span>
            <span aria-hidden="true">→</span>
            <span title={displayed(s, cellOf(s, maxPoint.index, view.value), col)}>
              {displayed(s, cellOf(s, maxPoint.index, view.value), col)}
            </span>
          </div>
        ) : undefined
      }
    >
      <ScatterChart
        title={label}
        desc={label}
        margin={{ top: 16, right: 16, bottom: 24, left: 8 }}
        accessibilityLayer
      >
        <XAxis
          allowDataOverflow
          type="number"
          dataKey="x"
          orientation="top"
          domain={[-0.5, Math.max(0.5, xs.length - 0.5)]}
          ticks={xs.map((_, index) => index)}
          height={48}
          tick={<HeatmapColumnTick labels={xLabels} />}
          interval={0}
        />
        <YAxis
          allowDataOverflow
          type="number"
          dataKey="y"
          domain={[-0.5, Math.max(0.5, ys.length - 0.5)]}
          ticks={ys.map((_, index) => index)}
          tick={<HeatmapRowTick labels={yLabels} />}
          reversed
          width={140}
          interval={0}
        />
        <HeatGrid
          columns={xs.length}
          rows={ys.length}
          missing={xs.length * ys.length - data.length}
          nulls={data.length - finite.length}
        />
        <ExactTooltip textAt={tip} />
        <Scatter
          data={data}
          isAnimationActive={false}
          shape={(input) => {
            const point = coordinates(input)
            const row = point?.payload?.index
            if (typeof row !== 'number') return <g />
            const value = valueAt(s, row, view.value)
            const mark = (
              <g data-mark={value === null ? 'empty' : 'cell'}>
                <title>{tip(row)}</title>
                <HeatCell input={input} columns={xs.length} rows={ys.length} fill={fill(value)}>
                  {null}
                </HeatCell>
              </g>
            )
            return value === null ? (
              mark
            ) : (
              <SelectableMark row={row} field={view.value} label={tip(row)}>
                {mark}
              </SelectableMark>
            )
          }}
        />
      </ScatterChart>
    </ChartFrame>
  )
}
