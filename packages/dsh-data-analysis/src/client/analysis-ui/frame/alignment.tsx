import { useCopy } from '../../i18n/context.tsx'
import { color, summary } from '../charts/recharts.tsx'
import { type DomainPoint, uniquelyBound } from './domain-point-selection.tsx'
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
import { SavedLinePlot, SavedRowPlot, type SavedSeries } from './plots.tsx'
import { DataTable } from './table.tsx'
import type { MainViewProps } from './types.ts'

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
    const axis =
      axisOf(s, c.timeAxis) ?? s.frame.axes.find((axis) => axis.variant?.kind === 'paired')
    if (!axis) return null
    const { ticks, tickOf } = timeTicks(t, s, axis)
    const byTick = new Map(rowsOf(s).map((row) => [tickOf(row), row]))
    const counts = new Map<number, number>()
    for (const row of rowsOf(s)) counts.set(tickOf(row), (counts.get(tickOf(row)) ?? 0) + 1)
    // Each saved subject pair owns its numeric axis; distinct measures never share a scale.
    return (
      <div className="fv-parents">
        {pairs.map((pair, pi) => {
          const series: SavedSeries[] = (['left', 'right'] as const).map((side) => ({
            key: `${pi}-${side}`,
            label: valueName(s, c, pair[side]),
            color: color(pi * 2 + (side === 'left' ? 0 : 1)),
            hollow: side === 'left',
            dashed: side === 'left',
            values: ticks.map((_, i) => {
              const row = byTick.get(i)
              return row === undefined ? null : get(row, pair[side], side)
            }),
            exact: (i) => {
              const row = byTick.get(i)
              return `${ticks[i]?.title ?? ''}\n${valueName(s, c, pair[side])}: ${row === undefined ? '—' : tip(row, pair[side], side)}`
            },
            point: (i) =>
              counts.get(i) === 1
                ? point(byTick.get(i), pair[side], side, ticks[i]?.label ?? '')
                : undefined,
          }))
          return (
            <section
              key={`${pair.left}:${pair.right}`}
              data-alignment-pair={`${pair.left}:${pair.right}`}
            >
              <SavedLinePlot
                label={summary(
                  t,
                  series.map((line) => line.label).join(' · '),
                  ticks.map((_, i) => series.map((line) => line.exact(i)).join(' / ')),
                )}
                ticks={ticks}
                series={series}
                height={height}
              />
            </section>
          )
        })}
      </div>
    )
  }

  const axes = c.categoryAxes.map((token) => axisOf(s, token)).filter((axis) => axis !== undefined)
  const rows = rowsOf(s)
  return (
    <div className="fv-parents">
      {pairs.map((pair, pi) => {
        const labels = rows.map((row) => membersLabel(s, axes, row))
        const series: SavedSeries[] = (['left', 'right'] as const).map((side) => ({
          key: side,
          label: valueName(s, c, pair[side]),
          color: color(pi),
          hollow: side === 'left',
          values: rows.map((row) => get(row, pair[side], side)),
          exact: (i) =>
            `${labels[i]}\n${valueName(s, c, pair[side])}: ${tip(rows[i]!, pair[side], side)}`,
          point: (i) => point(rows[i], pair[side], side, labels[i] ?? ''),
        }))
        return (
          <SavedRowPlot
            key={`${pair.left}:${pair.right}`}
            label={summary(
              t,
              series.map((line) => line.label).join(' · '),
              rows.map((_, i) => series.map((line) => line.exact(i)).join(' / ')),
            )}
            labels={labels}
            series={series}
            endLabels={rows.map(
              (row) => `${text(row, pair.left, 'left')} · ${text(row, pair.right, 'right')}`,
            )}
            links={rows.flatMap((_, i) => {
              const from = series[0]!.values[i]
              const to = series[1]!.values[i]
              return from == null || to == null ? [] : [{ from, to, index: i }]
            })}
          />
        )
      })}
    </div>
  )
}
