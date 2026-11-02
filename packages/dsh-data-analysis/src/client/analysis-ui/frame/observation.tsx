import { useCopy } from '../../i18n/context.tsx'
import {
  SelectableMark,
  HBarChart as SharedHBarChart,
  Heatmap as SharedHeatmap,
  TimeChart as SharedTimeChart,
} from '../charts/observation.tsx'
import { frameChartModel } from './chart-model.ts'
import {
  axisOf,
  cellOf,
  columnOf,
  compact,
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
import {
  Bar,
  ChartFrame,
  color,
  Dot,
  END_W,
  LABEL_W,
  Legend,
  linear,
  type MainViewProps,
  summary,
  truncate,
  W,
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
                  <text className="fv-row-label" x={LABEL_W - 8} y={y0 + rowH / 2} textAnchor="end">
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
