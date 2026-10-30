import type { Cell } from '../../../presentation/contracts/types.ts'
import { useCopy } from '../../i18n/context.tsx'
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
            <span>{valueName(s, c, name)}</span>
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
  byTick: Map<number, number>
}

/** line / area / bar / interval-bar over saved periods; gaps and hollow marks are data facts. */
export function TimeChart({
  snapshot: s,
  classification: c,
  view,
  height = 240,
}: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'>) {
  const t = useCopy()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const { ticks, tickOf } = timeTicks(t, s, axis)
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
  return (
    <ChartFrame label={label} height={height} legend={<Legend items={legend} />}>
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
                  if (ticks.length > 40 && !isolated && !tick.incomplete) return null
                  const row = line.byTick.get(i)!
                  return (
                    <Dot
                      key={tick.key}
                      x={p.x}
                      y={p.y}
                      fill={line.color}
                      hollow={tick.incomplete}
                      size={ticks.length > 40 ? 2.5 : 3}
                      title={tip(tick, line, cellOf(s, row, line.name))}
                    />
                  )
                })}
                {lastRow !== undefined && (
                  <text x={x(last) + 8} y={points[last]!.y + 4} className="fv-strong">
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

/** Horizontal bars in Frame row order; broadcast values are vertical reference lines. */
export function HBarChart({ snapshot: s, classification: c, view }: MainViewProps<'hbar'>) {
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
      legend={
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
                <text x={LABEL_W - 8} y={y0 + rowH / 2} textAnchor="end">
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
                        <Bar
                          horizontal
                          at={by}
                          breadth={16}
                          from={x(0)}
                          to={x(v)}
                          fill={color(vi)}
                          title={`${member} · ${valueName(s, c, name)}: ${exact(value, columnFor(name))}`}
                        />
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

/** Matrix cells; NA and missing combinations are empty dashed cells. */
export function Heatmap({ snapshot: s, classification: c, view }: MainViewProps<'heatmap'>) {
  const t = useCopy()
  const xs = members(t, s, view.x)
  const ys = members(t, s, view.y)
  if (!xs || !ys) return null
  const cells = new Map<string, number>()
  for (const row of rowsOf(s)) cells.set(`${xs.of(row)}|${ys.of(row)}`, row)
  const column = columnOf(s, view.value)?.column
  const values = rowsOf(s).map((row) => valueAt(s, row, view.value))
  const [lo, hi] = extent(values)
  const finite = values.filter((v): v is number => v !== null)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const diverging = min < 0 && max > 0
  const span = Math.max(Math.abs(min), Math.abs(max)) || 1
  const fill = (v: number) =>
    diverging
      ? { fill: v < 0 ? color(1) : color(0), fillOpacity: 0.12 + (Math.abs(v) / span) * 0.78 }
      : { fill: color(0), fillOpacity: 0.12 + ((v - lo) / (hi - lo || 1)) * 0.78 }
  const cellW = (W - LABEL_W) / Math.max(xs.labels.length, 1)
  const cellH = 24
  const height = 20 + ys.labels.length * cellH
  const showText = cellW >= 40 && xs.labels.length * ys.labels.length <= 120
  const label = summary(
    t,
    valueName(s, c, view.value),
    rowsOf(s).map(
      (row) =>
        `${xs.labels[xs.of(row)]} · ${ys.labels[ys.of(row)]} ${compact(t.locale, cellOf(s, row, view.value), column)}`,
    ),
  )
  return (
    <ChartFrame label={label} height={height}>
      {() => (
        <>
          {xs.labels.map((text, xi) => (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: Member labels may repeat; position is the identity.
              key={xi}
              x={LABEL_W + cellW * (xi + 0.5)}
              y={12}
              textAnchor="middle"
            >
              {truncate(text, Math.max(4, Math.floor(cellW / 7)))}
            </text>
          ))}
          {ys.labels.map((text, yi) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Member labels may repeat; position is the identity.
            <g key={yi}>
              <text x={LABEL_W - 8} y={20 + yi * cellH + 16} textAnchor="end">
                {truncate(text)}
              </text>
              {xs.labels.map((xl, xi) => {
                const row = cells.get(`${xi}|${yi}`)
                const v = row === undefined ? null : valueAt(s, row, view.value)
                const box = {
                  x: LABEL_W + xi * cellW + 1,
                  y: 20 + yi * cellH + 1,
                  width: Math.max(cellW - 2, 1),
                  height: cellH - 2,
                }
                const value = row === undefined ? null : cellOf(s, row, view.value)
                return (
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
    <ChartFrame
      label={label}
      height={height}
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
                  <text x={LABEL_W - 8} y={cy + 4} textAnchor="end">
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
                        <Dot
                          x={x(Math.max(-1, Math.min(1, v)))}
                          y={cy}
                          fill={color(vi)}
                          size={5}
                          title={`${valueName(s, c, name)}: ${exact(value, columnFor(name))}`}
                        />
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
    <ChartFrame
      label={label}
      height={height}
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
                  <text x={LABEL_W - 8} y={y0 + rowH / 2} textAnchor="end">
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
                        <Bar
                          horizontal
                          at={by + 3}
                          breadth={10}
                          from={x(0)}
                          to={x(v)}
                          fill={color(vi)}
                          title={`${member} · ${valueName(s, c, name)}: ${exact(cellOf(s, row, name), columnOf(s, name)?.column)}`}
                        />
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
