import { useState } from 'react'
import { useCopy } from '../../i18n/context.tsx'
import { compareDecimalText } from '../../presentation/model.ts'
import { Button } from '../../ui/primitives/button.tsx'
import { compact } from '../charts/model.ts'
import { color, summary } from '../charts/recharts.tsx'
import { type DomainPoint, uniquelyBound } from './domain-point-selection.tsx'
import {
  axisOf,
  cellOf,
  columnOf,
  displayFrameCell,
  groupRows,
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
  const [activePair, setActivePair] = useState<string>()
  if (!item) return null
  const col = (n: string) => columnOf(s, n)?.column
  const formatted = (row: number, name: string) => {
    const column = col(name)
    return column ? displayFrameCell(s, t.locale, cellOf(s, row, name), column) : '—'
  }
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
    present(s, row, item[side].presence) ? formatted(row, name) : '—'
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
      label: `${label} · ${valueName(s, c, name)}: ${formatted(row, name)}`,
    }
  }
  if (view.style === 'line') {
    const axis =
      axisOf(s, c.timeAxis) ?? s.frame.axes.find((axis) => axis.variant?.kind === 'paired')
    if (!axis) return null
    const { ticks, tickOf } = timeTicks(t, s, axis)
    const memberAxes = s.frame.axes.filter((candidate) => candidate.token !== axis.token)
    const groups = groupRows(s, memberAxes)
    // A duplicate full coordinate cannot be represented by a single line point.
    // Preserve all saved rows in the table rather than silently replacing one.
    if (groups.some((group) => new Set(group.rows.map(tickOf)).size !== group.rows.length)) {
      const columns = new Map(s.data.columns.map((column, index) => [column.id, index]))
      const names = new Set([...item.left.values, ...item.right.values])
      const rows = s.data.rows.map((cells, row) => {
        const visible = [...cells]
        for (const name of names) {
          const presentOnAnySide = (['left', 'right'] as const).some(
            (side) => item[side].values.includes(name) && present(s, row, item[side].presence),
          )
          const index = columns.get(name)
          if (!presentOnAnySide && index !== undefined) visible[index] = null
        }
        return visible
      })
      return (
        <DataTable
          snapshot={{ ...s, data: { ...s.data, rows } }}
          columns={Array.from(
            new Set([
              ...s.frame.layout.filter((l) => l.kind === 'coordinate').map((l) => l.name),
              ...item.left.values,
              ...item.right.values,
            ]),
          )}
        />
      )
    }
    // Each saved subject pair owns its numeric axis; distinct measures never share a scale.
    return (
      <div className="fv-alignment-facets">
        {pairs.length * groups.length > 1 && (
          <p>{t('marivo.presentation.ui-frame-alignment-independent-scales')}</p>
        )}
        <div className="fv-parents">
          {pairs.flatMap((pair, pi) =>
            groups.map((group) => {
              const byTick = new Map(group.rows.map((row) => [tickOf(row), row]))
              const series: SavedSeries[] = (['left', 'right'] as const).map((side) => ({
                key: `${pi}-${side}`,
                label: valueName(s, c, pair[side]),
                color: color(side === 'left' ? 0 : 1),
                hollow: side === 'left',
                dashed: side === 'left',
                values: ticks.map((_, i) => {
                  const row = byTick.get(i)
                  return row === undefined ? null : get(row, pair[side], side)
                }),
                exact: (i) => {
                  const row = byTick.get(i)
                  return `${ticks[i]?.title ?? ''}\n${valueName(s, c, pair[side])}: ${row === undefined ? '—' : text(row, pair[side], side)}`
                },
                point: (i) =>
                  point(
                    byTick.get(i),
                    pair[side],
                    side,
                    [group.label, ticks[i]?.label].filter(Boolean).join(' · '),
                  ),
              }))
              return (
                <section
                  key={JSON.stringify([pair.left, pair.right, group.key])}
                  data-alignment-pair={`${pair.left}:${pair.right}`}
                >
                  {memberAxes.length > 0 && <h4>{group.label}</h4>}
                  <SavedLinePlot
                    label={summary(
                      t,
                      [group.label, ...series.map((line) => line.label)]
                        .filter(Boolean)
                        .join(' · '),
                      ticks.map((_, i) => series.map((line) => line.exact(i)).join(' / ')),
                    )}
                    ticks={ticks}
                    series={series}
                    height={height}
                  />
                </section>
              )
            }),
          )}
        </div>
      </div>
    )
  }

  const axes = c.categoryAxes.map((token) => axisOf(s, token)).filter((axis) => axis !== undefined)
  const pairKey = (pair: (typeof pairs)[number]) => JSON.stringify([pair.left, pair.right])
  const selected = pairs.find((pair) => pairKey(pair) === activePair) ?? pairs[0]!
  const rowValue = (row: number): string | undefined => {
    const values = (['left', 'right'] as const).flatMap((side) => {
      const name = selected[side]
      const value = cellOf(s, row, name)
      return get(row, name, side) !== null && value !== null ? [String(value)] : []
    })
    return values.sort((a, b) => compareDecimalText(b, a))[0]
  }
  const rows = rowsOf(s).sort((a, b) => {
    const av = rowValue(a)
    const bv = rowValue(b)
    if (av === undefined || bv === undefined) return av === bv ? a - b : av === undefined ? 1 : -1
    return compareDecimalText(bv, av) || a - b
  })
  const magnitude = (row: number) =>
    Math.max(...(['left', 'right'] as const).map((side) => get(row, selected[side], side) ?? 0))
  const allNonNegative = rows.every((row) =>
    (['left', 'right'] as const).every((side) => (get(row, selected[side], side) ?? 0) >= 0),
  )
  // Keep exceptionally large categories legible without changing values; every
  // facet has its own visible zero-based axis. No category name is special.
  const separateLargest =
    allNonNegative &&
    rows.length >= 4 &&
    magnitude(rows[0]!) > 0 &&
    magnitude(rows[0]!) >= 5 * magnitude(rows[1]!)
  const facets = separateLargest ? [rows.slice(0, 1), rows.slice(1)] : [rows]
  return (
    <div className="fv-alignment-facets">
      {pairs.length > 1 && (
        <fieldset
          className="fv-alignment-controls"
          aria-label={t('marivo.presentation.ui-frame-comparison-metric')}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          {pairs.map((pair) => (
            <Button
              key={pairKey(pair)}
              type="button"
              size="xs"
              variant="outline"
              aria-pressed={pair === selected}
              onClick={() => setActivePair(pairKey(pair))}
            >
              {valueName(s, c, pair.left)}
            </Button>
          ))}
        </fieldset>
      )}
      {facets.length > 1 && <p>{t('marivo.presentation.ui-frame-alignment-independent-scales')}</p>}
      {facets.map((facet) => {
        const pair = selected
        const labels = facet.map((row) => membersLabel(s, axes, row))
        const series: SavedSeries[] = (['left', 'right'] as const).map((side) => ({
          key: side,
          label: valueName(s, c, pair[side]),
          color: color(side === 'left' ? 0 : 1),
          hollow: side === 'left',
          values: facet.map((row) => get(row, pair[side], side)),
          exact: (i) =>
            `${labels[i]}\n${valueName(s, c, pair[side])}: ${text(facet[i]!, pair[side], side)}`,
          point: (i) => point(facet[i], pair[side], side, labels[i] ?? ''),
        }))
        const max = Math.max(
          ...series.flatMap((line) => line.values).filter((v): v is number => v !== null),
          0,
        )
        return (
          <SavedRowPlot
            key={`${pairKey(pair)}:${facet.join(',')}`}
            label={summary(
              t,
              series.map((line) => line.label).join(' · '),
              facet.map((_, i) => series.map((line) => line.exact(i)).join(' / ')),
            )}
            labels={labels}
            series={series}
            domain={allNonNegative ? [0, max || 1] : undefined}
            endLabelRail
            tickFormatter={(value) => compact(t.locale, value)}
            endLabels={facet.map(
              (row) =>
                `${valueName(s, c, pair.left)}: ${text(row, pair.left, 'left')} · ${valueName(s, c, pair.right)}: ${text(row, pair.right, 'right')}`,
            )}
            links={facet.flatMap((_, i) => {
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
