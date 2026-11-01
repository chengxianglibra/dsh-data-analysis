import { useCopy } from '../../i18n/context.tsx'
import { type DomainPoint, DomainPointMark, uniquelyBound } from './domain-point-selection.tsx'
import {
  axisOf,
  cellOf,
  columnOf,
  compact,
  exact,
  interpretationOf,
  membersLabel,
  rowsOf,
  type Snapshot,
  timeTicks,
  valueAt,
  valueName,
} from './model.ts'
import {
  ChartFrame,
  color,
  Dot,
  dotsOverlap,
  END_W,
  extent,
  LABEL_W,
  Legend,
  linear,
  linePath,
  type MainViewProps,
  summary,
  textWidth,
  truncate,
  W,
  XTicks,
} from './svg.tsx'
import { DataTable } from './table.tsx'

/** A side whose presence is false is not drawn. */
function present(s: Snapshot, row: number, names: string[]): boolean {
  return names.every((n) => cellOf(s, row, n) !== false)
}

export function AlignmentView({
  snapshot: s,
  classification: c,
  view,
  height = 240,
}: MainViewProps<'alignment'>) {
  const t = useCopy()
  const item = interpretationOf(s)?.alignments[view.alignment]
  const pairs = view.pairs
  if (!item) return null
  const col = (n: string) => columnOf(s, n)?.column
  // Sides without a shared subject are not comparable; show both as saved.
  if (view.style === 'table' || pairs.length === 0)
    return (
      <DataTable
        snapshot={s}
        columns={[
          ...s.frame.layout.filter((l) => l.kind === 'coordinate').map((l) => l.name),
          ...item.left.values,
          ...item.right.values,
        ]}
      />
    )
  const get = (row: number, name: string, side: 'left' | 'right') =>
    present(s, row, item[side].presence) ? valueAt(s, row, name) : null
  const text = (row: number, name: string, side: 'left' | 'right') =>
    present(s, row, item[side].presence) ? compact(t.locale, cellOf(s, row, name), col(name)) : '—'
  const tip = (row: number, name: string, side: 'left' | 'right') =>
    present(s, row, item[side].presence) ? exact(cellOf(s, row, name), col(name)) : '—'
  const point = (
    row: number | undefined,
    name: string,
    side: 'left' | 'right',
    label: string,
  ): DomainPoint | undefined => {
    if (
      row === undefined ||
      !uniquelyBound(s, name) ||
      cellOf(s, row, name) === null ||
      item[side].presence.some((n) => cellOf(s, row, n) !== true)
    )
      return undefined
    if (item[side === 'left' ? 'right' : 'left'].values.includes(name)) return undefined
    return {
      row,
      field: name,
      label: `${label} · ${valueName(s, c, name)}: ${exact(cellOf(s, row, name), col(name))}`,
    }
  }
  if (view.style === 'line') {
    // Time shapes name their axis; a paired-time Frame draws along its paired axis.
    const axis = axisOf(s, c.timeAxis) ?? s.frame.axes.find((a) => a.variant?.kind === 'paired')
    if (!axis) return null
    const { ticks, tickOf } = timeTicks(t, s, axis)
    const byTick = new Map(rowsOf(s).map((row) => [tickOf(row), row]))
    const counts = new Map<number, number>()
    for (const row of rowsOf(s)) counts.set(tickOf(row), (counts.get(tickOf(row)) ?? 0) + 1)
    const top = 12
    const bottom = height - 26
    const band = (W - END_W - 8) / Math.max(ticks.length, 1)
    const x = (i: number) => 8 + band * (i + 0.5)
    const series = pairs.flatMap((p, pi) =>
      (['left', 'right'] as const).map((side) => ({
        key: `${pi}-${side}`,
        name: p[side],
        side,
        color: color(pi * 2 + (side === 'left' ? 0 : 1)),
        values: ticks.map((_, i) => {
          const row = byTick.get(i)
          return row === undefined ? null : get(row, p[side], side)
        }),
      })),
    )
    const y = linear(extent(series.flatMap((l) => l.values)), [bottom, top])
    const label = summary(
      t,
      series.map((l) => valueName(s, c, l.name)).join(' · '),
      ticks.map((tick, i) => {
        const row = byTick.get(i)
        return `${tick.label} ${series
          .map((l) => (row === undefined ? '—' : text(row, l.name, l.side)))
          .join(' / ')}`
      }),
    )
    const selectionAt = (i: number, name: string, side: 'left' | 'right') =>
      counts.get(i) === 1 ? point(byTick.get(i), name, side, ticks[i]?.label ?? '') : undefined

    return (
      <>
        <ChartFrame
          label={label}
          height={height}
          legend={
            <Legend
              items={series.map((l) => ({
                label: valueName(s, c, l.name),
                color: l.color,
                shape: 'line' as const,
              }))}
            />
          }
        >
          {() => (
            <>
              <line x1={8} x2={W - END_W} y1={bottom} y2={bottom} className="fv-axis" />
              <XTicks ticks={ticks} x={x} y={bottom} />
              {series.map((l, li) => (
                <g key={l.key} data-series={l.name}>
                  <path
                    d={linePath(l.values.map((v, i) => (v === null ? null : { x: x(i), y: y(v) })))}
                    className="fv-line"
                    style={{ stroke: l.color }}
                  />
                  {l.values.map((v, i) => {
                    const row = byTick.get(i)
                    const other = series[li ^ 1]?.values[i]
                    const overlap = v !== null && other != null && dotsOverlap(y(v), y(other))
                    return v === null || row === undefined ? null : (
                      <DomainPointMark key={ticks[i]!.key} point={selectionAt(i, l.name, l.side)}>
                        <Dot
                          x={x(i)}
                          y={y(v)}
                          fill={l.color}
                          hollow={ticks[i]!.incomplete}
                          size={l.side === 'left' && overlap ? 6.5 : 2.5}
                          title={`${ticks[i]!.title}\n${valueName(s, c, l.name)}: ${exact(cellOf(s, row, l.name), col(l.name))}`}
                        />
                      </DomainPointMark>
                    )
                  })}
                </g>
              ))}
            </>
          )}
        </ChartFrame>
      </>
    )
  }
  // Dumbbell: hollow left point, filled right point, one row per Frame row and pair.
  const axes = c.categoryAxes.map((token) => axisOf(s, token)).filter((a) => a !== undefined)
  const rows = rowsOf(s)
  const rowH = 22 * pairs.length + 4
  const height2 = 4 + rows.length * rowH + 4
  const x = linear(
    extent(
      rows.flatMap((row) =>
        pairs.flatMap((p) => [get(row, p.left, 'left'), get(row, p.right, 'right')]),
      ),
    ),
    [LABEL_W, W - END_W],
  )
  const label = summary(
    t,
    pairs.map((p) => `${valueName(s, c, p.left)} · ${valueName(s, c, p.right)}`).join('; '),
    rows.map(
      (row) =>
        `${membersLabel(s, axes, row)} ${pairs
          .map((p) => `${text(row, p.left, 'left')} / ${text(row, p.right, 'right')}`)
          .join('; ')}`,
    ),
  )
  let endWidth = 0
  for (const row of rows)
    for (const p of pairs)
      endWidth = Math.max(
        endWidth,
        textWidth(`${text(row, p.left, 'left')} · ${text(row, p.right, 'right')}`),
      )
  const chartWidth = Math.max(W, W - END_W + 18 + endWidth)

  return (
    <>
      <ChartFrame
        label={label}
        height={height2}
        width={chartWidth}
        rowLabels={rows.map((row, ri) => ({
          label: membersLabel(s, axes, row),
          y: 4 + ri * rowH + 15,
        }))}
        legend={
          <Legend
            items={pairs.flatMap((p, pi) => [
              { label: valueName(s, c, p.left), color: color(pi), shape: 'hollow' as const },
              { label: valueName(s, c, p.right), color: color(pi), shape: 'dot' as const },
            ])}
          />
        }
      >
        {() => (
          <>
            {rows.map((row, ri) => {
              const member = membersLabel(s, axes, row)
              return (
                <g key={row} data-row={member}>
                  <text
                    className="fv-row-label"
                    x={LABEL_W - 8}
                    y={4 + ri * rowH + 15}
                    textAnchor="end"
                  >
                    {truncate(member)}
                  </text>
                  {pairs.map((p, pi) => {
                    const cy = 4 + ri * rowH + 11 + pi * 22
                    const l = get(row, p.left, 'left')
                    const r = get(row, p.right, 'right')
                    const overlap = l !== null && r !== null && dotsOverlap(x(l), x(r))
                    return (
                      <g key={p.left}>
                        <title>{`${member}\n${valueName(s, c, p.left)}: ${tip(row, p.left, 'left')}\n${valueName(s, c, p.right)}: ${tip(row, p.right, 'right')}`}</title>
                        {l !== null && r !== null && (
                          <line x1={x(l)} x2={x(r)} y1={cy} y2={cy} className="fv-stem" />
                        )}
                        {l !== null && (
                          <DomainPointMark point={point(row, p.left, 'left', member)}>
                            <Dot
                              x={x(l)}
                              y={cy}
                              fill={color(pi)}
                              hollow
                              size={overlap ? 6.5 : 4.5}
                            />
                          </DomainPointMark>
                        )}
                        {r !== null && (
                          <DomainPointMark point={point(row, p.right, 'right', member)}>
                            <Dot x={x(r)} y={cy} fill={color(pi)} size={overlap ? 3 : 4.5} />
                          </DomainPointMark>
                        )}
                        <text x={W - END_W + 10} y={cy + 4} className="fv-strong">
                          {`${text(row, p.left, 'left')} · ${text(row, p.right, 'right')}`}
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
