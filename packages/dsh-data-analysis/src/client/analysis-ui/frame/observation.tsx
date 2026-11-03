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
  exact,
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
/** Saved coefficients on a fixed [-1, 1] domain; no fit or statistic is computed here. */
export function CorrelationPlot({
  snapshot: s,
  classification: c,
  view,
}: MainViewProps<'correlation'>) {
  const t = useCopy()
  const rows = rowsOf(s)
  const labels = rows.map((row) => membersLabel(s, s.frame.axes, row))
  const tip = (row: number, name: string) =>
    `${labels[row] ?? ''} · ${valueName(s, c, name)}: ${exact(cellOf(s, row, name), columnOf(s, name)?.column)}${view.counts[name] ? ` · n ${exact(cellOf(s, row, view.counts[name]!), columnOf(s, view.counts[name]!)?.column)}` : ''}`
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
  const series = values.map((name) => ({
    key: name,
    label: valueName(s, c, name),
    values: rows.map((row) => valueAt(s, row, name)),
    exact: (index: number) =>
      `${labels[index] ?? ''} · ${valueName(s, c, name)}: ${exact(cellOf(s, rows[index]!, name), columnOf(s, name)?.column)}`,
    point: (index: number) => ({
      row: rows[index]!,
      field: name,
      label: `${labels[index] ?? ''} · ${valueName(s, c, name)}: ${exact(cellOf(s, rows[index]!, name), columnOf(s, name)?.column)}`,
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
