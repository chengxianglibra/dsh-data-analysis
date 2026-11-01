import { AreaChart, BarChart, LineChart } from '@openuidev/react-ui'
import { type ReactNode, useId, useState } from 'react'
import type { Cell } from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
import { paletteForSeries } from './chart-palette.ts'
import { FrameChartTheme } from './chart-theme.tsx'
import {
  axisOf,
  cellOf,
  columnOf,
  compact,
  exact,
  firstCell,
  groupRows,
  memberLabel,
  membersLabel,
  partitions,
  percent,
  rowsOf,
  type Snapshot,
  type Tick,
  timeTicks,
  valueAt,
  valueName,
} from './model.ts'
import { useFrameSelection } from './selection-context.tsx'
import {
  areaPaths,
  Bar,
  ChartFrame,
  color,
  Dot,
  END_W,
  extent,
  LABEL_W,
  Legend,
  type LegendItem,
  linear,
  linePath,
  type MainViewProps,
  NEUTRAL,
  summary,
  truncate,
  W,
  XTicks,
} from './svg.tsx'

export function MetricCards({ snapshot: s, classification: c, view }: MainViewProps<'metric'>) {
  const t = useCopy()
  return (
    <div className="fv-cards">
      {view.values.map((name) => {
        const column = columnOf(s, name)?.column
        const value = cellOf(s, 0, name)
        return (
          <div key={name} data-value={name}>
            {view.values.length > 1 && <span>{valueName(s, c, name)}</span>}
            <strong title={exact(value, column)}>{compact(t.locale, value, column)}</strong>
          </div>
        )
      })}
    </div>
  )
}

interface Series {
  key: string
  label: string
  name: string
  color: string
  marker?: number
  byTick: Map<number, number>
}

/** Only identical declared units share a numeric scale; an unknown unit is field-specific. */
function unitGroups(s: Snapshot, values: string[], broadcast: string[]) {
  const groups = new Map<string, { values: string[]; broadcast: string[] }>()
  for (const [names, role] of [
    [values, 'values'],
    [broadcast, 'broadcast'],
  ] as const) {
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
  }
  return [...groups.values()]
}

type PointChoice = { row: number; field: string; label: string }

function SelectableMark({ row, field, label, children }: PointChoice & { children: ReactNode }) {
  const selection = useFrameSelection()
  if (!selection) return <>{children}</>
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG has no native button element; expose keyboard activation directly.
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
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

/** Native keyboard targets for chart libraries whose SVG marks are not focusable. */
function KeyboardPoints({ points }: { points: PointChoice[] }) {
  const selection = useFrameSelection()
  if (!selection) return null
  return (
    <div className="fv-keyboard-points">
      {points.map((point) => (
        <button
          key={`${point.row}:${point.field}`}
          type="button"
          onClick={() => selection.select(point.row, point.field)}
        >
          {point.label}
        </button>
      ))}
    </div>
  )
}

function FallbackTimeChart(
  props: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'> & { showLegend?: boolean },
) {
  return (
    <>
      <SvgTimeChartPlot {...props} />
    </>
  )
}

function FallbackHBarChart(props: MainViewProps<'hbar'>) {
  return (
    <>
      <SvgHBarChartPlot {...props} />
    </>
  )
}

export function Heatmap(props: MainViewProps<'heatmap'>) {
  return (
    <>
      <SvgHeatmap {...props} />
    </>
  )
}

/**
 * The official line/area/bar components convert missing values to zero.  Admit
 * only complete, uniquely indexed series without broadcast or incomplete
 * periods. The SVG renderer preserves missing values and period widths for other series.
 */
function TimeChartPlot(
  props: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'> & { showLegend?: boolean },
) {
  const { snapshot: s, classification: c, view, height, showLegend = true } = props
  const t = useCopy()
  const selection = useFrameSelection()
  const [clicked, setClicked] = useState<number>()
  const axis = axisOf(s, view.axis)
  if (!axis || view.chart === 'interval-bar' || view.broadcast.length)
    return <FallbackTimeChart {...props} />
  const { ticks, tickOf } = timeTicks(t, s, axis)
  const seriesAxis = axisOf(s, view.series)
  const groups = seriesAxis ? groupRows(s, [seriesAxis]) : [{ key: '', label: '', rows: rowsOf(s) }]
  const series = groups.flatMap((group) =>
    view.values.map((field) => ({
      field,
      label: [group.label, view.values.length > 1 || !seriesAxis ? valueName(s, c, field) : '']
        .filter(Boolean)
        .join(' · '),
      rows: group.rows,
    })),
  )
  const labels = series.map((item) => item.label)
  const categoryKey = '__frame_period__'
  if (
    ticks.length <= 1 ||
    ticks.length >= 12 ||
    !series.length ||
    series.length > 7 ||
    ticks.some((tick) => tick.incomplete) ||
    new Set(ticks.map((tick) => tick.label)).size !== ticks.length ||
    new Set(labels).size !== labels.length ||
    labels.includes(categoryKey)
  )
    return <FallbackTimeChart {...props} />
  const lookup = series.map((item) => {
    const map = new Map<number, number>()
    for (const row of item.rows) {
      const index = tickOf(row)
      if (index < 0 || map.has(index)) return undefined
      map.set(index, row)
    }
    return map
  })
  if (lookup.some((map) => !map)) return <FallbackTimeChart {...props} />
  const points: PointChoice[][] = ticks.map((tick, index) =>
    series.flatMap((item, seriesIndex) => {
      const row = lookup[seriesIndex]?.get(index)
      if (row === undefined || valueAt(s, row, item.field) === null) return []
      return [
        {
          row,
          field: item.field,
          label: `${tick.title} · ${item.label}: ${exact(cellOf(s, row, item.field), columnOf(s, item.field)?.column)}`,
        },
      ]
    }),
  )
  if (points.some((items) => items.length !== series.length))
    return <FallbackTimeChart {...props} />
  const data = ticks.map((tick, index) => {
    const item: Record<string, string | number> = { [categoryKey]: tick.label }
    series.forEach((line, i) => {
      item[line.label] = valueAt(s, lookup[i]!.get(index)!, line.field)!
    })
    return item
  })
  const onClick = selection
    ? (_row: Record<string, string | number>, index: number) => {
        const choices = points[index] ?? []
        if (choices.length === 1) selection.select(choices[0]!.row, choices[0]!.field)
        else setClicked(index)
      }
    : undefined
  const common = {
    data,
    categoryKey,
    height: height ?? 240,
    legend:
      showLegend &&
      !(
        view.values.length === 1 &&
        !view.series &&
        series.length === 1 &&
        series[0]?.label === valueName(s, c, view.values[0]!)
      ),
    isAnimationActive: false,
    onClick,
  }
  return (
    <FrameChartTheme>
      {(colors) => (
        <>
          {view.chart === 'line' ? (
            <LineChart
              {...common}
              customPalette={paletteForSeries(labels.map((_, i) => colors[i % colors.length]!))}
              variant="linear"
              showDots
            />
          ) : view.chart === 'area' ? (
            <AreaChart
              {...common}
              customPalette={paletteForSeries(labels.map((_, i) => colors[i % colors.length]!))}
              variant="linear"
            />
          ) : (
            <BarChart
              {...common}
              customPalette={paletteForSeries(labels.map((_, i) => colors[i % colors.length]!))}
            />
          )}
          {clicked !== undefined && points[clicked] && points[clicked]!.length > 1 && selection && (
            <fieldset>
              <legend>{t('marivo.presentation.ui-frame-select-series')}</legend>
              {points[clicked]!.map((point) => (
                <button
                  key={`${point.row}:${point.field}`}
                  type="button"
                  onClick={() => selection.select(point.row, point.field)}
                >
                  {point.label}
                </button>
              ))}
            </fieldset>
          )}
          <KeyboardPoints points={points.flat()} />
        </>
      )}
    </FrameChartTheme>
  )
}

/** line / area / bar / interval-bar over saved periods; gaps and hollow marks are data facts. */
export function TimeChart(props: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'>) {
  const units = unitGroups(props.snapshot, props.view.values, props.view.broadcast)
  const groups = units.flatMap((unit) =>
    props.view.series && unit.values.length > 1
      ? unit.values.map((name, index) => ({
          values: [name],
          broadcast: unit.broadcast,
          showLegend: index === 0,
        }))
      : [{ ...unit, showLegend: true }],
  )
  if (groups.length <= 1) return <TimeChartPlot {...props} />
  return (
    <div className="fv-parents">
      {groups.map(({ showLegend, ...group }) => (
        <section className="fv-parent" key={JSON.stringify([group.values, group.broadcast])}>
          <h4>
            {[...group.values, ...group.broadcast]
              .map((name) => valueName(props.snapshot, props.classification, name))
              .join(' · ')}
          </h4>
          <TimeChartPlot {...props} view={{ ...props.view, ...group }} showLegend={showLegend} />
        </section>
      ))}
    </div>
  )
}

function SvgTimeChartPlot({
  snapshot: s,
  classification: c,
  view,
  height: requestedHeight,
  showLegend = true,
}: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'> & { showLegend?: boolean }) {
  const t = useCopy()
  const selection = useFrameSelection()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const { ticks, tickOf } = timeTicks(t, s, axis)
  // A single period has no temporal trajectory; keep its points readable without a tall empty plot.
  const height = requestedHeight ?? (ticks.length === 1 ? 112 : 240)
  const seriesAxis = axisOf(s, view.series)
  const groups = seriesAxis ? groupRows(s, [seriesAxis]) : [{ key: '', label: '', rows: rowsOf(s) }]
  const series: Series[] = groups.flatMap((g, gi) =>
    view.values.map((name, vi) => ({
      key: `${g.key}|${name}`,
      label:
        seriesAxis && view.values.length === 1
          ? g.label
          : [g.label, valueName(s, c, name)].filter(Boolean).join(' · '),
      name,
      color: color(seriesAxis ? gi : vi),
      ...(seriesAxis ? { marker: gi } : {}),
      byTick: new Map(g.rows.map((row) => [tickOf(row), row])),
    })),
  )
  const at = (line: Series, i: number) => {
    const row = line.byTick.get(i)
    return row === undefined ? null : valueAt(s, row, line.name)
  }
  const refs = view.broadcast.flatMap((name) =>
    partitions(s, name).map((p) => {
      const first = firstCell(s, p.rows, name)
      const indices = p.rows.map(tickOf).filter((i) => i >= 0)
      return {
        key: `${name}|${p.key}`,
        name,
        label: p.label,
        value: first.value,
        y: valueAt(s, first.row, name),
        from: Math.min(...indices),
        to: Math.max(...indices),
      }
    }),
  )
  const bars = view.chart === 'bar' || view.chart === 'interval-bar'
  const all = series.flatMap((line) => ticks.map((_, i) => at(line, i)))
  const domain = extent([...all, ...refs.map((r) => r.y)], bars)
  const top = 16
  const bottom = height - 26
  const left = 8
  const right = W - END_W
  const band = (right - left) / Math.max(ticks.length, 1)
  const x = (i: number) => left + band * (i + 0.5)
  const y = linear(domain, [bottom, top])
  const zero = domain[0] <= 0 && domain[1] >= 0 ? y(0) : undefined
  const sub = (band * 0.8) / Math.max(series.length, 1)
  const labelBars = bars && ticks.length * series.length <= 12
  const legend: LegendItem[] = [
    ...series.map((line) => ({
      label: line.label,
      color: line.color,
      shape: bars ? ('square' as const) : ('line' as const),
      ...(!bars && line.marker !== undefined ? { marker: line.marker } : {}),
    })),
    ...view.broadcast.map((name) => ({
      label: valueName(s, c, name),
      color: NEUTRAL,
      shape: 'dashed' as const,
    })),
  ]
  const columnFor = (name: string) => columnOf(s, name)?.column
  const tip = (tick: Tick, line: Series, value: Cell) =>
    `${tick.title}\n${line.label || valueName(s, c, line.name)}: ${exact(value, columnFor(line.name))}`
  const label = summary(
    t,
    series.map((l) => l.label || valueName(s, c, l.name)).join(' · '),
    series.flatMap((line) =>
      ticks.map((tick, i) => {
        const row = line.byTick.get(i)
        const value = row === undefined ? null : cellOf(s, row, line.name)
        return `${series.length > 1 ? `${line.label} ` : ''}${tick.label} ${compact(t.locale, value, columnFor(line.name))}`
      }),
    ),
  )
  // Suppress overlapping endpoint text, retaining every plotted point and exact value in its title/table.
  const shownLabels = new Set<string>()
  const labelPositions: { x: number; y: number }[] = []
  for (const line of series) {
    let last = ticks.length - 1
    while (last >= 0 && at(line, last) === null) last--
    if (last < 0) continue
    const value = at(line, last)
    if (value === null) continue
    const position = { x: x(last) + 8, y: y(value) }
    if (
      labelPositions.some(
        (other) => Math.abs(other.x - position.x) < END_W && Math.abs(other.y - position.y) < 14,
      )
    )
      continue
    labelPositions.push(position)
    shownLabels.add(line.key)
  }
  return (
    <ChartFrame
      label={label}
      height={height}
      legend={
        showLegend &&
        !(
          view.values.length === 1 &&
          !view.series &&
          !view.broadcast.length &&
          legend.length === 1 &&
          legend[0]?.label === valueName(s, c, view.values[0]!)
        ) ? (
          <Legend items={legend} />
        ) : undefined
      }
    >
      {(hatch) => (
        <>
          <line x1={left} x2={right} y1={bottom} y2={bottom} className="fv-axis" />
          {zero !== undefined && zero !== bottom && (
            <line x1={left} x2={right} y1={zero} y2={zero} className="fv-axis" />
          )}
          <XTicks ticks={ticks} x={x} y={bottom} />
          {series.map((line, li) => {
            const column = columnFor(line.name)
            if (bars)
              return (
                <g key={line.key} data-series={line.label}>
                  {ticks.map((tick, i) => {
                    const row = line.byTick.get(i)
                    const v = at(line, i)
                    if (row === undefined || v === null) return null
                    const value = cellOf(s, row, line.name)
                    const bx = x(i) - (band * 0.8) / 2 + sub * li
                    return (
                      <g key={tick.key}>
                        <SelectableMark row={row} field={line.name} label={tip(tick, line, value)}>
                          <Bar
                            at={bx}
                            breadth={Math.max(sub - 2, 1)}
                            from={y(Math.min(Math.max(0, domain[0]), domain[1]))}
                            to={y(v)}
                            fill={line.color}
                            hatch={hatch}
                            hatched={tick.incomplete}
                            title={tip(tick, line, value)}
                          />
                        </SelectableMark>
                        {labelBars && (
                          <text
                            x={bx + sub / 2}
                            y={v < 0 ? y(v) + 12 : y(v) - 4}
                            textAnchor="middle"
                            className="fv-strong"
                          >
                            {compact(t.locale, value, column)}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              )
            const points = ticks.map((_, i) => {
              const v = at(line, i)
              return v === null ? null : { x: x(i), y: y(v) }
            })
            let last = -1
            points.forEach((p, i) => {
              if (p) last = i
            })
            const lastRow = line.byTick.get(last)
            return (
              <g key={line.key} data-series={line.label}>
                {view.chart === 'area' &&
                  areaPaths(points, zero ?? bottom).map((d) => (
                    <path key={d} d={d} className="fv-area" style={{ fill: line.color }} />
                  ))}
                <path d={linePath(points)} className="fv-line" style={{ stroke: line.color }} />
                {points.map((p, i) => {
                  if (!p) return null
                  const tick = ticks[i]!
                  const isolated = !points[i - 1] && !points[i + 1]
                  const showDot = !(
                    ticks.length > 40 &&
                    !isolated &&
                    !tick.incomplete &&
                    points[i - 1] &&
                    i !== last &&
                    i % Math.ceil(ticks.length / 10) !== 0
                  )
                  if (!showDot && !selection) return null
                  const row = line.byTick.get(i)!
                  return (
                    <SelectableMark
                      key={tick.key}
                      row={row}
                      field={line.name}
                      label={tip(tick, line, cellOf(s, row, line.name))}
                    >
                      {selection && <circle cx={p.x} cy={p.y} r={7} fill="transparent" />}
                      {showDot && (
                        <Dot
                          x={p.x}
                          y={p.y}
                          fill={line.color}
                          hollow={tick.incomplete}
                          size={ticks.length > 40 ? 2.5 : 3}
                          marker={line.marker}
                          title={tip(tick, line, cellOf(s, row, line.name))}
                        />
                      )}
                    </SelectableMark>
                  )
                })}
                {lastRow !== undefined && shownLabels.has(line.key) && (
                  <text
                    x={x(last) + 8}
                    y={points[last]!.y + 4}
                    className="fv-strong"
                    data-mark="endpoint-label"
                  >
                    {compact(t.locale, cellOf(s, lastRow, line.name), column)}
                  </text>
                )}
              </g>
            )
          })}
          {refs.map((ref) =>
            ref.y === null || !Number.isFinite(ref.from) ? null : (
              <g key={ref.key} data-mark="reference">
                <title>{`${valueName(s, c, ref.name)}${ref.label ? ` · ${ref.label}` : ''}: ${exact(ref.value, columnFor(ref.name))}`}</title>
                <line
                  x1={x(ref.from) - band / 2}
                  x2={x(ref.to) + band / 2}
                  y1={y(ref.y)}
                  y2={y(ref.y)}
                  className="fv-ref"
                />
                <text x={x(ref.to) + band / 2 + 4} y={y(ref.y) + 4}>
                  {compact(t.locale, ref.value, columnFor(ref.name))}
                </text>
              </g>
            ),
          )}
        </>
      )}
    </ChartFrame>
  )
}

function HBarChartPlot(props: MainViewProps<'hbar'>) {
  const { snapshot: s, classification: c, view } = props
  const t = useCopy()
  const selection = useFrameSelection()
  const [clicked, setClicked] = useState<number>()
  const axis = axisOf(s, view.axis)
  if (!axis || view.broadcast.length) return <FallbackHBarChart {...props} />
  const rows = rowsOf(s)
  const labels = rows.map((row) => memberLabel(s, axis, row))
  const fields = view.values.map((field) => ({ field, label: valueName(s, c, field) }))
  const categoryKey = '__frame_member__'
  if (
    !rows.length ||
    !fields.length ||
    new Set(labels).size !== labels.length ||
    new Set(fields.map((field) => field.label)).size !== fields.length ||
    fields.some((field) => field.label === categoryKey) ||
    rows.some((row) => fields.some((field) => valueAt(s, row, field.field) === null))
  )
    return <FallbackHBarChart {...props} />
  const data = rows.map((row, index) => {
    const item: Record<string, string | number> = { [categoryKey]: labels[index]! }
    for (const field of fields) item[field.label] = valueAt(s, row, field.field)!
    return item
  })
  const points = rows.map((row, index) =>
    fields.map(({ field, label }) => ({
      row,
      field,
      label: `${labels[index]} · ${label}: ${exact(cellOf(s, row, field), columnOf(s, field)?.column)}`,
    })),
  )
  const onClick = selection
    ? (_row: Record<string, string | number>, index: number) => {
        const choices = points[index] ?? []
        if (choices.length === 1) selection.select(choices[0]!.row, choices[0]!.field)
        else setClicked(index)
      }
    : undefined
  return (
    <FrameChartTheme>
      {(colors) => (
        <>
          <BarChart
            data={data}
            categoryKey={categoryKey}
            customPalette={paletteForSeries(fields.map((_, i) => colors[i % colors.length]!))}
            height={props.height ?? 240}
            legend={fields.length > 1}
            isAnimationActive={false}
            onClick={onClick}
          />
          {clicked !== undefined && points[clicked] && points[clicked]!.length > 1 && selection && (
            <fieldset>
              <legend>{t('marivo.presentation.ui-frame-select-series')}</legend>
              {points[clicked]!.map((point) => (
                <button
                  key={`${point.row}:${point.field}`}
                  type="button"
                  onClick={() => selection.select(point.row, point.field)}
                >
                  {point.label}
                </button>
              ))}
            </fieldset>
          )}
          <KeyboardPoints points={points.flat()} />
        </>
      )}
    </FrameChartTheme>
  )
}

/** Horizontal bars in Frame row order; broadcast values are vertical reference lines. */
export function HBarChart(props: MainViewProps<'hbar'>) {
  const groups = unitGroups(props.snapshot, props.view.values, props.view.broadcast)
  if (groups.length <= 1) return <HBarChartPlot {...props} />
  return (
    <div className="fv-parents">
      {groups.map((group) => (
        <section className="fv-parent" key={[...group.values, ...group.broadcast].join('|')}>
          <h4>
            {[...group.values, ...group.broadcast]
              .map((name) => valueName(props.snapshot, props.classification, name))
              .join(' · ')}
          </h4>
          <HBarChartPlot {...props} view={{ ...props.view, ...group }} />
        </section>
      ))}
    </div>
  )
}

function SvgHBarChartPlot({ snapshot: s, classification: c, view }: MainViewProps<'hbar'>) {
  const t = useCopy()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const rows = rowsOf(s)
  const values = view.values
  const rowH = 20 * values.length + 8
  const top = view.broadcast.length ? 18 : 4
  const height = top + rows.length * rowH + 4
  const all = rows.flatMap((row) => values.map((name) => valueAt(s, row, name)))
  const refs = view.broadcast.flatMap((name) =>
    partitions(s, name).map((p) => {
      const first = firstCell(s, p.rows, name)
      return {
        key: `${name}|${p.key}`,
        name,
        value: first.value,
        x: valueAt(s, first.row, name),
        from: rows.indexOf(Math.min(...p.rows)),
        to: rows.indexOf(Math.max(...p.rows)),
      }
    }),
  )
  const domain = extent([...all, ...refs.map((r) => r.x)], true)
  const x = linear(domain, [LABEL_W, W - END_W])
  const columnFor = (name: string) => columnOf(s, name)?.column
  const label = summary(
    t,
    values.map((n) => valueName(s, c, n)).join(' · '),
    rows.flatMap((row) =>
      values.map(
        (name) =>
          `${memberLabel(s, axis, row)} ${compact(t.locale, cellOf(s, row, name), columnFor(name))}`,
      ),
    ),
  )
  return (
    <ChartFrame
      label={label}
      height={height}
      rowLabels={rows.map((row, ri) => ({
        label: memberLabel(s, axis, row),
        y: top + ri * rowH + 4 + rowH / 2,
      }))}
      legend={
        values.length > 1 || view.broadcast.length ? (
          <Legend
            items={[
              ...values.map((name, i) => ({ label: valueName(s, c, name), color: color(i) })),
              ...view.broadcast.map((name) => ({
                label: valueName(s, c, name),
                color: NEUTRAL,
                shape: 'dashed' as const,
              })),
            ]}
          />
        ) : undefined
      }
    >
      {() => (
        <>
          <line x1={x(0)} x2={x(0)} y1={top} y2={height - 4} className="fv-axis" />
          {rows.map((row, ri) => {
            const y0 = top + ri * rowH + 4
            const member = memberLabel(s, axis, row)
            return (
              <g key={row} data-row={member}>
                <text className="fv-row-label" x={LABEL_W - 8} y={y0 + rowH / 2} textAnchor="end">
                  <title>{member}</title>
                  {truncate(member)}
                </text>
                {values.map((name, vi) => {
                  const v = valueAt(s, row, name)
                  const value = cellOf(s, row, name)
                  const by = y0 + vi * 20
                  return (
                    <g key={name}>
                      {v !== null && (
                        <SelectableMark
                          row={row}
                          field={name}
                          label={`${member} · ${valueName(s, c, name)}: ${exact(value, columnFor(name))}`}
                        >
                          <Bar
                            horizontal
                            at={by}
                            breadth={16}
                            from={x(0)}
                            to={x(v)}
                            fill={color(vi)}
                            title={`${member} · ${valueName(s, c, name)}: ${exact(value, columnFor(name))}`}
                          />
                        </SelectableMark>
                      )}
                      <text
                        x={v === null ? x(0) + 4 : v < 0 ? x(v) - 4 : x(v) + 4}
                        y={by + 12}
                        textAnchor={v !== null && v < 0 ? 'end' : 'start'}
                        className="fv-strong"
                      >
                        {compact(t.locale, value, columnFor(name))}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}
          {refs.map((ref) =>
            ref.x === null ? null : (
              <g key={ref.key} data-mark="reference">
                <title>{`${valueName(s, c, ref.name)}: ${exact(ref.value, columnFor(ref.name))}`}</title>
                <line
                  x1={x(ref.x)}
                  x2={x(ref.x)}
                  y1={top + ref.from * rowH}
                  y2={top + (ref.to + 1) * rowH + 4}
                  className="fv-ref"
                />
                <text x={x(ref.x)} y={top + ref.from * rowH - 4} textAnchor="middle">
                  {compact(t.locale, ref.value, columnFor(ref.name))}
                </text>
              </g>
            ),
          )}
        </>
      )}
    </ChartFrame>
  )
}

function members(t: ReturnType<typeof useCopy>, s: Snapshot, ref: string) {
  const axis = axisOf(s, ref)
  if (!axis) return undefined
  if (axis.variant && axis.variant.kind !== 'ordinary' && axis.variant.kind !== 'paired') {
    const { ticks, tickOf } = timeTicks(t, s, axis)
    return { labels: ticks.map((k) => k.label), of: tickOf }
  }
  const groups = groupRows(s, [axis])
  const index = new Map<number, number>()
  groups.forEach((g, i) => {
    for (const row of g.rows) index.set(row, i)
  })
  return { labels: groups.map((g) => g.label), of: (row: number) => index.get(row) ?? -1 }
}

/** Estimate 12px system-font advances for heatmap labels, keeping narrow Latin letters compact. */
function heatmapTextWidth(text: string): number {
  return [...text].reduce((width, char) => {
    if (char.codePointAt(0)! > 127) return width + 12
    if (char === ' ') return width + 4
    if ('ilI'.includes(char)) return width + 4
    if ('frt'.includes(char)) return width + 5
    if ('mwMW'.includes(char)) return width + 10
    return width + 7
  }, 0)
}

/** Fit at most two lines in a column; preserve the complete name in the SVG title. */
function heatmapHeader(label: string, available: number): string[] {
  const maxWidth = Math.max(8, available - 8)
  if (heatmapTextWidth(label) <= maxWidth) return [label]
  const chars = [...label]
  let fit = 0
  while (fit < chars.length && heatmapTextWidth(chars.slice(0, fit + 1).join('')) <= maxWidth) fit++
  fit = Math.max(1, fit)
  const whitespace = chars.slice(0, fit + 1).lastIndexOf(' ')
  const split = whitespace > 0 ? whitespace : Math.min(fit, Math.ceil(chars.length / 2))
  const first = chars.slice(0, split).join('').trimEnd()
  const remainder = chars.slice(split).join('').trimStart()
  if (heatmapTextWidth(remainder) <= maxWidth) return [first, remainder]
  const remaining = [...remainder]
  let end = 0
  while (
    end < remaining.length &&
    heatmapTextWidth(`${remaining.slice(0, end + 1).join('')}…`) <= maxWidth
  )
    end++
  return [first, `${remaining.slice(0, end).join('')}…`]
}

/** Matrix cells; NA and missing combinations are empty dashed cells. */
function SvgHeatmap({ snapshot: s, classification: c, view }: MainViewProps<'heatmap'>) {
  const t = useCopy()
  const gradientId = `fv-scale-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const xs = members(t, s, view.x)
  const ys = members(t, s, view.y)
  if (!xs || !ys) return null
  const cells = new Map<string, number>()
  for (const row of rowsOf(s)) cells.set(`${xs.of(row)}|${ys.of(row)}`, row)
  const column = columnOf(s, view.value)?.column
  const values = rowsOf(s).map((row) => valueAt(s, row, view.value))
  const [lo, hi] = extent(values)
  const finite = values.filter((v): v is number => v !== null)
  const min = finite.length ? Math.min(...finite) : 0
  const max = finite.length ? Math.max(...finite) : 0
  const diverging = min < 0 && max > 0
  const span = Math.max(Math.abs(min), Math.abs(max)) || 1
  const fill = (v: number) =>
    diverging
      ? { fill: v < 0 ? color(1) : color(0), fillOpacity: 0.12 + (Math.abs(v) / span) * 0.78 }
      : { fill: color(0), fillOpacity: 0.12 + ((v - lo) / (hi - lo || 1)) * 0.78 }
  // Keep dense columns readable rather than forcing more labels into a fixed-width chart.
  const width = Math.max(W, LABEL_W + xs.labels.length * 48)
  const cellW = (width - LABEL_W) / Math.max(xs.labels.length, 1)
  const cellH = 24
  const headers = xs.labels.map((label) => heatmapHeader(label, cellW))
  const headerHeight = headers.some((lines) => lines.length > 1) ? 32 : 20
  const height = headerHeight + ys.labels.length * cellH
  const showText = cellW >= 40 && xs.labels.length * ys.labels.length <= 120
  const label = summary(
    t,
    valueName(s, c, view.value),
    rowsOf(s).map(
      (row) =>
        `${xs.labels[xs.of(row)]} · ${ys.labels[ys.of(row)]} ${compact(t.locale, cellOf(s, row, view.value), column)}`,
    ),
  )
  const minRow = values.indexOf(min)
  const maxRow = values.indexOf(max)
  const minCell = minRow < 0 ? null : cellOf(s, minRow, view.value)
  const maxCell = maxRow < 0 ? null : cellOf(s, maxRow, view.value)
  const minText = compact(t.locale, minCell, column)
  const maxText = compact(t.locale, maxCell, column)
  const showExact = min !== max && minText === maxText
  const legend = finite.length > 0 && (
    <div
      data-heatmap-scale={diverging ? 'diverging' : 'sequential'}
      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12 }}
    >
      <span>{valueName(s, c, view.value)}</span>
      <span title={exact(minCell, column)}>{showExact ? exact(minCell, column) : minText}</span>
      <svg width="100" height="10" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId}>
            <stop
              offset="0%"
              stopColor={diverging ? color(1) : color(0)}
              stopOpacity={fill(min).fillOpacity}
            />
            {diverging && (
              <>
                <stop
                  offset={`${(-min / (max - min)) * 100}%`}
                  stopColor={color(1)}
                  stopOpacity={0.12}
                />
                <stop
                  offset={`${(-min / (max - min)) * 100}%`}
                  stopColor={color(0)}
                  stopOpacity={0.12}
                />
              </>
            )}
            <stop offset="100%" stopColor={color(0)} stopOpacity={fill(max).fillOpacity} />
          </linearGradient>
        </defs>
        <rect width="100" height="10" fill={`url(#${gradientId})`} />
      </svg>
      {min !== max && (
        <span title={exact(maxCell, column)}>{showExact ? exact(maxCell, column) : maxText}</span>
      )}
    </div>
  )
  return (
    <ChartFrame
      label={label}
      height={height}
      width={width}
      legend={legend}
      rowLabels={ys.labels.map((text, yi) => ({ label: text, y: headerHeight + yi * cellH + 16 }))}
    >
      {() => (
        <>
          {xs.labels.map((text, xi) => (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: Member labels may repeat; position is the identity.
              key={xi}
              x={LABEL_W + cellW * (xi + 0.5)}
              textAnchor="middle"
              data-heatmap-column={text}
            >
              <title>{text}</title>
              {headers[xi]!.map((line, lineIndex) => (
                <tspan
                  // biome-ignore lint/suspicious/noArrayIndexKey: The line's fixed position identifies it even when labels repeat.
                  key={lineIndex}
                  x={LABEL_W + cellW * (xi + 0.5)}
                  y={12 + lineIndex * 12}
                >
                  {line}
                </tspan>
              ))}
            </text>
          ))}
          {ys.labels.map((text, yi) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Member labels may repeat; position is the identity.
            <g key={yi}>
              <text
                className="fv-row-label"
                x={LABEL_W - 8}
                y={headerHeight + yi * cellH + 16}
                textAnchor="end"
              >
                {truncate(text)}
              </text>
              {xs.labels.map((xl, xi) => {
                const row = cells.get(`${xi}|${yi}`)
                const v = row === undefined ? null : valueAt(s, row, view.value)
                const box = {
                  x: LABEL_W + xi * cellW + 1,
                  y: headerHeight + yi * cellH + 1,
                  width: Math.max(cellW - 2, 1),
                  height: cellH - 2,
                }
                const value = row === undefined ? null : cellOf(s, row, view.value)
                const cell = (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Grid position is the identity.
                  <g key={xi} data-mark={v === null ? 'empty' : 'cell'}>
                    <title>{`${xl} · ${text}: ${exact(value, column)}`}</title>
                    {v === null ? (
                      <rect {...box} rx="2" className="fv-cell-empty" />
                    ) : (
                      <rect {...box} rx="2" style={fill(v)} />
                    )}
                    {showText && (
                      <text
                        x={box.x + box.width / 2}
                        y={box.y + 15}
                        textAnchor="middle"
                        className="fv-strong"
                      >
                        {compact(t.locale, value, column)}
                      </text>
                    )}
                  </g>
                )
                return row === undefined || v === null ? (
                  cell
                ) : (
                  <SelectableMark
                    key={row}
                    row={row}
                    field={view.value}
                    label={`${xl} · ${text}: ${exact(value, column)}`}
                  >
                    {cell}
                  </SelectableMark>
                )
              })}
            </g>
          ))}
        </>
      )}
    </ChartFrame>
  )
}

/** Coefficients on a fixed [-1, 1] axis with a zero line; NA draws no point. */
export function CorrelationPlot({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'correlation'>) {
  const t = useCopy()
  const axes = s.frame.axes
  const rows = rowsOf(s)
  const rowH = 26
  const top = 16
  const height = top + rows.length * rowH + 18
  const x = linear([-1, 1], [LABEL_W, W - END_W - 30])
  const columnFor = (name: string) => columnOf(s, name)?.column
  const label = summary(
    t,
    view.values.map((n) => valueName(s, c, n)).join(' · '),
    rows.flatMap((row) =>
      view.values.map(
        (name) =>
          `${axes.length ? `${membersLabel(s, axes, row)} ` : ''}${compact(t.locale, cellOf(s, row, name), columnFor(name))}`,
      ),
    ),
  )
  return (
    <>
      <ChartFrame
        label={label}
        height={height}
        rowLabels={
          axes.length
            ? rows.map((row, ri) => ({
                label: membersLabel(s, axes, row),
                y: top + ri * rowH + rowH / 2 + 4,
              }))
            : undefined
        }
        legend={
          <Legend
            items={view.values.map((name, i) => ({
              label: valueName(s, c, name),
              color: color(i),
              shape: 'dot' as const,
            }))}
          />
        }
      >
        {() => (
          <>
            {[-1, 0, 1].map((tick) => (
              <g key={tick}>
                <line
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={top - 4}
                  y2={height - 16}
                  className={tick === 0 ? 'fv-axis' : 'fv-grid'}
                />
                <text x={x(tick)} y={height - 4} textAnchor="middle">
                  {tick}
                </text>
              </g>
            ))}
            {rows.map((row, ri) => {
              const cy = top + ri * rowH + rowH / 2
              const member = axes.length ? membersLabel(s, axes, row) : ''
              return (
                <g key={row} data-row={member}>
                  {member && (
                    <text className="fv-row-label" x={LABEL_W - 8} y={cy + 4} textAnchor="end">
                      {truncate(member)}
                    </text>
                  )}
                  <line x1={x(-1)} x2={x(1)} y1={cy} y2={cy} className="fv-grid" />
                  {view.values.map((name, vi) => {
                    const v = valueAt(s, row, name)
                    const value = cellOf(s, row, name)
                    const n = view.counts[name]
                    const nValue = n ? cellOf(s, row, n) : undefined
                    return (
                      <g key={name}>
                        {v !== null && (
                          <SelectableMark
                            row={row}
                            field={name}
                            label={`${member} · ${valueName(s, c, name)}: ${exact(value, columnFor(name))}${nValue === undefined ? '' : ` · n ${nValue === null ? '—' : String(nValue)}`}`}
                          >
                            <Dot
                              x={x(Math.max(-1, Math.min(1, v)))}
                              y={cy}
                              fill={color(vi)}
                              size={5}
                              title={`${valueName(s, c, name)}: ${exact(value, columnFor(name))}`}
                            />
                          </SelectableMark>
                        )}
                        {vi === 0 && (
                          <text x={W - END_W - 16} y={cy + 4} className="fv-strong">
                            {view.values
                              .map((m) => compact(t.locale, cellOf(s, row, m), columnFor(m)))
                              .join(' · ')}
                            {nValue !== undefined && (
                              <tspan
                                className="fv-n"
                                dx="6"
                              >{`n ${nValue === null ? '—' : String(nValue)}`}</tspan>
                            )}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </>
        )}
      </ChartFrame>
    </>
  )
}

/** Shares on a 0–100% track that extends below 0 or above 100% when values do. */
export function ShareTrack({
  snapshot: s,
  classification: c,
  values,
  rows = rowsOf(s),
  labelOf,
}: Omit<MainViewProps<'share'>, 'view'> & {
  values: string[]
  rows?: number[]
  labelOf?: (row: number) => string
}) {
  const t = useCopy()
  const rowH = 20 * values.length + 8
  const top = 6
  const height = top + rows.length * rowH + 18
  const all = rows.flatMap((row) => values.map((name) => valueAt(s, row, name)))
  const finite = all.filter((v): v is number => v !== null)
  const domain: [number, number] = [Math.min(0, ...finite), Math.max(1, ...finite)]
  const x = linear(domain, [LABEL_W, W - END_W])
  const label = summary(
    t,
    values.map((n) => valueName(s, c, n)).join(' · '),
    rows.flatMap((row) =>
      values.map(
        (name) => `${labelOf?.(row) ?? ''} ${percent(t.locale, valueAt(s, row, name), false)}`,
      ),
    ),
  )
  return (
    <>
      <ChartFrame
        label={label}
        height={height}
        rowLabels={
          labelOf
            ? rows.map((row, ri) => ({
                label: labelOf(row),
                y: top + ri * rowH + 4 + rowH / 2,
              }))
            : undefined
        }
        legend={
          <Legend
            items={values.map((name, i) => ({ label: valueName(s, c, name), color: color(i) }))}
          />
        }
      >
        {() => (
          <>
            {[0, 1].map((tick) => (
              <g key={tick} data-tick={tick === 0 ? '0' : '100%'}>
                <line x1={x(tick)} x2={x(tick)} y1={top} y2={height - 14} className="fv-axis" />
                <text x={x(tick)} y={height - 2} textAnchor="middle">
                  {tick === 0 ? '0' : '100%'}
                </text>
              </g>
            ))}
            {rows.map((row, ri) => {
              const y0 = top + ri * rowH + 4
              const member = labelOf?.(row) ?? ''
              return (
                <g key={row} data-row={member}>
                  {member && (
                    <text
                      className="fv-row-label"
                      x={LABEL_W - 8}
                      y={y0 + rowH / 2}
                      textAnchor="end"
                    >
                      {truncate(member)}
                    </text>
                  )}
                  {values.map((name, vi) => {
                    const v = valueAt(s, row, name)
                    const by = y0 + vi * 20
                    return (
                      <g key={name}>
                        <rect
                          x={x(0)}
                          y={by + 3}
                          width={x(1) - x(0)}
                          height={10}
                          rx="5"
                          className="fv-track"
                        />
                        {v !== null && (
                          <SelectableMark
                            row={row}
                            field={name}
                            label={`${member} · ${valueName(s, c, name)}: ${exact(cellOf(s, row, name), columnOf(s, name)?.column)}`}
                          >
                            <Bar
                              horizontal
                              at={by + 3}
                              breadth={10}
                              from={x(0)}
                              to={x(v)}
                              fill={color(vi)}
                              title={`${member} · ${valueName(s, c, name)}: ${exact(cellOf(s, row, name), columnOf(s, name)?.column)}`}
                            />
                          </SelectableMark>
                        )}
                        <text
                          x={Math.max(x(1), v === null ? 0 : x(v)) + 6}
                          y={by + 12}
                          className="fv-strong"
                        >
                          {percent(t.locale, v, false)}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </>
        )}
      </ChartFrame>
    </>
  )
}

export function ShareView(props: MainViewProps<'share'>) {
  const t = useCopy()
  const s = props.snapshot
  const axis = axisOf(s, props.view.axis)
  const axes = axis ? [axis] : s.frame.axes
  const time = axisOf(s, props.classification.timeAxis)
  if (time && axis) {
    // One track per period; each period's shares are normalized along the category.
    const { ticks, tickOf } = timeTicks(t, s, time)
    return (
      <div className="fv-parents">
        {groupRows(s, [time]).map((g) => (
          <section key={g.key} className="fv-parent" data-parent={ticks[tickOf(g.rows[0]!)]?.label}>
            <h4>{ticks[tickOf(g.rows[0]!)]?.label ?? g.label}</h4>
            <ShareTrack
              {...props}
              values={props.view.values}
              rows={g.rows}
              labelOf={(row) => memberLabel(s, axis, row)}
            />
          </section>
        ))}
      </div>
    )
  }
  return (
    <ShareTrack
      {...props}
      values={props.view.values}
      labelOf={axes.length ? (row) => membersLabel(props.snapshot, axes, row) : undefined}
    />
  )
}
