import { type ReactNode, useId } from 'react'
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
import {
  axisOf,
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
  const groups = seriesAxis ? groupRows(s, [seriesAxis]) : [{ key: '', label: '', rows: rowsOf(s) }]
  const series = groups.flatMap((group, gi) =>
    view.values.map((name, vi) => ({
      key: `s${gi}_${vi}`,
      name,
      label: [group.label, valueName(s, name)].filter(Boolean).join(' · '),
      color: s.frameStyle && (seriesAxis ? gi : vi) === 0 ? '#126c74' : color(seriesAxis ? gi : vi),
      marker: seriesAxis ? gi : undefined,
      rows: new Map(group.rows.map((row) => [tickOf(row), row])),
    })),
  )
  const showLabels = !!s.frameStyle && ticks.length <= 12 && series.length === 1
  const bars = view.chart === 'bar' || view.chart === 'interval-bar'
  const data = ticks.map((_, index) =>
    Object.assign(
      { index },
      ...series.map((line) => {
        const row = line.rows.get(index)
        const value = row === undefined ? null : valueAt(s, row, line.name)
        if (!showLabels || bars) return { [line.key]: value }
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
        legend={
          showLegend && (
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
          )
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
                        >
                          <title>{title}</title>
                          <Rectangle
                            x={p.x}
                            y={p.y}
                            width={p.width}
                            height={Math.max(p.height, 1)}
                            fill={line.color}
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
                              fill="#126c74"
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
                    fill="#126c74"
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
                    fill="#126c74"
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
  const groups = unitGroups(props.model, props.view.values, props.view.broadcast)
  if (groups.length <= 1) return <HBarChartPlot {...props} />
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
function HBarChartPlot({ model: s, view }: ChartProps<'hbar'>) {
  const t = useCopy()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const rows = rowsOf(s)
  const data = rows.map((index) =>
    Object.assign(
      { index },
      ...view.values.map((name, vi) => ({ [`v${vi}`]: valueAt(s, index, name) })),
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
  return (
    <ChartFrame
      label={label}
      height={Math.max(140, rows.length * (22 * view.values.length + 8) + 48)}
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
        margin={{ top: 12, right: 32, bottom: 8, left: 8 }}
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
          tick={<MemberTick labels={axis.labels} />}
          width={140}
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
          />
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
function HeatmapColumnTick({
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
  const label = labels[payload?.value ?? -1] ?? ''
  const words = label.split(' ')
  const lines = words.length > 1 ? words : (label.match(/.{1,11}/gu) ?? [''])
  return (
    <g transform={`translate(${x},${y})`}>
      <text data-heatmap-column={label} textAnchor="middle" fill="currentColor">
        <title>{label}</title>
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
export function Heatmap({ model: s, view }: ChartProps<'heatmap'>) {
  const t = useCopy()
  const xAxis = axisOf(s, view.x)
  const yAxis = axisOf(s, view.y)
  if (!xAxis || !yAxis) return null
  const xs = groupRows(s, [xAxis])
  const ys = groupRows(s, [yAxis])
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
    `${xs[xOf.get(row)!]?.label ?? ''} · ${ys[yOf.get(row)!]?.label ?? ''}: ${displayed(s, cellOf(s, row, view.value), col)}`
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
      width={Math.max(640, xs.length * 88 + 170)}
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
          tick={<HeatmapColumnTick labels={xs.map((group) => group.label)} />}
          interval={0}
        />
        <YAxis
          allowDataOverflow
          type="number"
          dataKey="y"
          domain={[-0.5, Math.max(0.5, ys.length - 0.5)]}
          ticks={ys.map((_, index) => index)}
          tick={<MemberTick labels={ys.map((group) => group.label)} />}
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
