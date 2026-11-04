import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from 'recharts'
import { useCopy } from '../../i18n/context.tsx'
import {
  HBarChart as SharedHBarChart,
  Heatmap as SharedHeatmap,
  TimeChart as SharedTimeChart,
} from '../charts/observation.tsx'
import {
  ChartFrame,
  color,
  coordinates,
  ExactTooltip,
  Legend,
  MemberTick,
  numericDomain,
  summary,
} from '../charts/recharts.tsx'
import { frameChartModel } from './chart-model.ts'
import { DomainPointMark } from './domain-point-selection.tsx'
import {
  axisOf,
  cellOf,
  columnOf,
  displayFrameCell,
  groupRows,
  memberLabel,
  membersLabel,
  percent,
  rowsOf,
  timeTicks,
  valueAt,
  valueName,
} from './model.ts'
import { SavedRowPlot } from './plots.tsx'
import type { MainViewProps } from './types.ts'

export function TimeChart(props: MainViewProps<'line' | 'area' | 'bar' | 'interval-bar'>) {
  const t = useCopy()
  return (
    <SharedTimeChart
      model={frameChartModel(t, props.snapshot, props.classification, props.view.broadcast)}
      view={props.view}
      height={props.height}
    />
  )
}
export function HBarChart(props: MainViewProps<'hbar'>) {
  const t = useCopy()
  return (
    <SharedHBarChart
      model={frameChartModel(t, props.snapshot, props.classification, props.view.broadcast)}
      view={props.view}
      height={props.height}
    />
  )
}
export function Heatmap(props: MainViewProps<'heatmap'>) {
  const t = useCopy()
  return (
    <SharedHeatmap
      model={frameChartModel(t, props.snapshot, props.classification)}
      view={props.view}
      height={props.height}
    />
  )
}
const PIE_COLORS = [
  '#126c74',
  '#2c6fa8',
  '#b58b22',
  '#6a55a0',
  '#087c65',
  '#bb5230',
  '#567a95',
  '#8b6c9f',
]

/** A complete categorical distribution, using saved cells without aggregating rows. */
export function PieChart({ snapshot: s, classification: c, view }: MainViewProps<'pie'>) {
  const t = useCopy()
  const axis = axisOf(s, view.axis)
  if (!axis) return null
  const column = columnOf(s, view.value)?.column
  const rows = rowsOf(s).map((row) => ({
    row,
    label: memberLabel(s, axis, row),
    value: valueAt(s, row, view.value),
  }))
  // Scale before summing so finite input values cannot overflow the total.
  const max = rows.reduce((largest, item) => Math.max(largest, item.value ?? 0), 0)
  const total = rows.reduce((sum, item) => sum + (item.value ?? 0) / max, 0)
  if (!(max > 0) || !(total > 0) || rows.some((item) => item.value === null || item.value < 0))
    return null
  let angle = -Math.PI / 2
  const entries = rows.map((item, index) => {
    const share = item.value === null ? null : item.value / max / total
    const start = angle
    angle += (share ?? 0) * 2 * Math.PI
    const text = `${item.label} · ${column ? displayFrameCell(s, t.locale, cellOf(s, item.row, view.value), column) : '—'} · ${percent(t.locale, share, false)}`
    return { ...item, index, share, start, end: angle, text }
  })
  const point = (a: number) => `${150 + 120 * Math.cos(a)},${150 + 120 * Math.sin(a)}`
  return (
    <figure className="fv-chart" data-chart="pie">
      <div className="fv-pie-layout">
        <svg viewBox="0 0 300 300" aria-label={valueName(s, c, view.value)} className="fv-pie-svg">
          {entries.map((item) => {
            if (!item.share) return null
            const shape =
              item.share >= 1 - Number.EPSILON ? (
                <circle
                  cx={150}
                  cy={150}
                  r={120}
                  fill={PIE_COLORS[item.index % PIE_COLORS.length]}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              ) : (
                <path
                  d={`M150,150 L${point(item.start)} A120,120 0 ${item.end - item.start > Math.PI ? 1 : 0} 1 ${point(item.end)} Z`}
                  fill={PIE_COLORS[item.index % PIE_COLORS.length]}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              )
            return (
              <DomainPointMark
                key={item.row}
                point={{ row: item.row, field: view.value, label: item.text }}
              >
                <g data-pie-row={item.row}>
                  <title>{item.text}</title>
                  {shape}
                </g>
              </DomainPointMark>
            )
          })}
        </svg>
        <ul className="fv-pie-legend">
          {entries.map((item) => (
            <li
              key={item.row}
              style={{
                display: 'grid',
                gridTemplateColumns: '10px 1fr auto',
                gap: '2px 10px',
                alignItems: 'center',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: PIE_COLORS[item.index % PIE_COLORS.length],
                }}
              />
              <span>{item.label}</span>
              <b className="tabular-nums">{percent(t.locale, item.share, false)}</b>
              <small style={{ gridColumn: '2 / -1', color: 'var(--muted-foreground)' }}>
                {column
                  ? displayFrameCell(s, t.locale, cellOf(s, item.row, view.value), column)
                  : '—'}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}
/** Saved coefficients on a fixed [-1, 1] domain; no fit or statistic is computed here. */
export function CorrelationPlot({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'correlation'>) {
  const t = useCopy()
  const rows = rowsOf(s)
  const labels = rows.map((row) => membersLabel(s, s.frame.axes, row))
  const formatted = (row: number, name: string) => {
    const column = columnOf(s, name)?.column
    return column ? displayFrameCell(s, t.locale, cellOf(s, row, name), column) : '—'
  }
  const tip = (row: number, name: string) =>
    `${labels[row] ?? ''} · ${valueName(s, c, name)}: ${formatted(row, name)}${view.counts[name] ? ` · n ${formatted(row, view.counts[name]!)}` : ''}`
  const label = summary(
    t,
    view.values.map((name) => valueName(s, c, name)).join(' · '),
    rows.map((row) => view.values.map((name) => tip(row, name)).join(' / ')),
  )
  return (
    <ChartFrame
      label={label}
      height={Math.max(160, rows.length * 28 + 48)}
      legend={
        <Legend
          items={view.values.map((name, index) => ({
            label: valueName(s, c, name),
            color: color(index),
            shape: 'dot',
          }))}
        />
      }
    >
      <ScatterChart
        title={label}
        desc={label}
        margin={{ top: 12, right: 32, bottom: 8, left: 8 }}
        accessibilityLayer
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" dataKey="x" domain={[-1, 1]} ticks={[-1, 0, 1]} />
        <YAxis
          type="number"
          dataKey="y"
          domain={[-0.5, Math.max(0.5, rows.length - 0.5)]}
          ticks={rows}
          tick={<MemberTick labels={labels} />}
          reversed
          width={140}
          interval={0}
        />
        <ReferenceLine x={0} stroke="var(--border)" />
        <ExactTooltip textAt={(row) => view.values.map((name) => tip(row, name)).join('\n')} />
        {view.values.map((name, vi) => (
          <Scatter
            key={name}
            name={valueName(s, c, name)}
            data={rows.flatMap((index) => {
              const value = valueAt(s, index, name)
              return value === null ? [] : [{ index, x: value, y: index }]
            })}
            isAnimationActive={false}
            shape={(input) => {
              const p = coordinates(input)
              const row = p?.payload?.index
              if (!p || typeof row !== 'number') return <g />
              return (
                <DomainPointMark point={{ row, field: name, label: tip(row, name) }}>
                  <g>
                    <title>{tip(row, name)}</title>
                    <circle cx={p.cx} cy={p.cy} r={4} fill={color(vi)} data-mark="filled" />
                  </g>
                </DomainPointMark>
              )
            }}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  )
}
/** Saved shares use a track from 0 to 100%; values outside that range remain visible. */
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
  const labels = rows.map((row) => labelOf?.(row) ?? '')
  const text = (index: number, name: string) =>
    `${labels[index] ?? ''} · ${valueName(s, c, name)}: ${percent(t.locale, valueAt(s, rows[index]!, name), false)}`
  const series = values.map((name) => ({
    key: name,
    label: valueName(s, c, name),
    values: rows.map((row) => valueAt(s, row, name)),
    exact: (index: number) => text(index, name),
    point: (index: number) => ({
      row: rows[index]!,
      field: name,
      label: text(index, name),
    }),
  }))
  const domain = numericDomain([0, 1, ...series.flatMap((line) => line.values)])
  return (
    <SavedRowPlot
      label={summary(
        t,
        values.map((name) => valueName(s, c, name)).join(' · '),
        rows.map(
          (row, index) =>
            `${labels[index]} ${values.map((name) => percent(t.locale, valueAt(s, row, name), false)).join(' / ')}`,
        ),
      )}
      labels={labels}
      series={series}
      bars
      domain={domain}
      reference={1}
      tickFormatter={(value) => percent(t.locale, value, false)}
      endLabels={rows.map((row) =>
        values.map((name) => percent(t.locale, valueAt(s, row, name), false)).join(' · '),
      )}
    />
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
