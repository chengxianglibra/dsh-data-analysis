import { type ReactNode, useId } from 'react'
import type { Cell } from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
import {
  axisOf,
  type ChartModel,
  type ChartProps,
  cellOf,
  columnOf,
  compact,
  exact,
  firstCell,
  groupRows,
  memberLabel,
  partitions,
  rowsOf,
  type Tick,
  ticksOf,
  valueAt,
  valueName,
} from './model.ts'
import { useChartSelection } from './selection-context.tsx'
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
  NEUTRAL,
  summary,
  truncate,
  W,
  XTicks,
} from './svg.tsx'

interface Series {
  key: string
  label: string
  name: string
  color: string
  marker?: number
  byTick: Map<number, number>
}

/** Only identical declared units share a numeric scale; an unknown unit is field-specific. */
function unitGroups(s: ChartModel, values: string[], broadcast: string[]) {
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

export function SelectableMark({
  row,
  field,
  label,
  children,
}: PointChoice & { children: ReactNode }) {
  const selection = useChartSelection()
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

/** line / area / bar / interval-bar over saved periods; gaps and hollow marks are data facts. */
export function TimeChart(props: ChartProps<'line' | 'area' | 'bar' | 'interval-bar'>) {
  const units = unitGroups(props.model, props.view.values, props.view.broadcast)
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
              .map((name) => valueName(props.model, name))
              .join(' · ')}
          </h4>
          <TimeChartPlot {...props} view={{ ...props.view, ...group }} showLegend={showLegend} />
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
  const selection = useChartSelection()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const { ticks, tickOf } = ticksOf(s, axis)
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
          : [g.label, valueName(s, name)].filter(Boolean).join(' · '),
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
      label: valueName(s, name),
      color: NEUTRAL,
      shape: 'dashed' as const,
    })),
  ]
  const columnFor = (name: string) => columnOf(s, name)?.column
  const tip = (tick: Tick, line: Series, value: Cell) =>
    `${tick.title}\n${line.label || valueName(s, line.name)}: ${exact(value, columnFor(line.name))}`
  const label = summary(
    t,
    series.map((l) => l.label || valueName(s, l.name)).join(' · '),
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
          legend[0]?.label === valueName(s, view.values[0]!)
        ) ? (
          <Legend items={legend} showSingle={!!view.series} />
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
                <title>{`${valueName(s, ref.name)}${ref.label ? ` · ${ref.label}` : ''}: ${exact(ref.value, columnFor(ref.name))}`}</title>
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

/** Horizontal bars in Frame row order; broadcast values are vertical reference lines. */
export function HBarChart(props: ChartProps<'hbar'>) {
  const groups = unitGroups(props.model, props.view.values, props.view.broadcast)
  if (groups.length <= 1) return <HBarChartPlot {...props} />
  return (
    <div className="fv-parents">
      {groups.map((group) => (
        <section className="fv-parent" key={[...group.values, ...group.broadcast].join('|')}>
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
    values.map((n) => valueName(s, n)).join(' · '),
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
              ...values.map((name, i) => ({ label: valueName(s, name), color: color(i) })),
              ...view.broadcast.map((name) => ({
                label: valueName(s, name),
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
                          label={`${member} · ${valueName(s, name)}: ${exact(value, columnFor(name))}`}
                        >
                          <Bar
                            horizontal
                            at={by}
                            breadth={16}
                            from={x(0)}
                            to={x(v)}
                            fill={color(vi)}
                            title={`${member} · ${valueName(s, name)}: ${exact(value, columnFor(name))}`}
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
                <title>{`${valueName(s, ref.name)}: ${exact(ref.value, columnFor(ref.name))}`}</title>
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

function members(s: ChartModel, ref: string) {
  const axis = axisOf(s, ref)
  if (!axis) return undefined
  if (axis.ticks) {
    const { ticks, tickOf } = ticksOf(s, axis)
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
export function Heatmap({ model: s, view }: ChartProps<'heatmap'>) {
  const t = useCopy()
  const gradientId = `fv-scale-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const xs = members(s, view.x)
  const ys = members(s, view.y)
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
    valueName(s, view.value),
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
      <span>{valueName(s, view.value)}</span>
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
