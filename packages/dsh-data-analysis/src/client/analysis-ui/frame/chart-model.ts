import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type { Translator } from '../../i18n/copy.ts'
import type { ChartModel } from '../charts/model.ts'
import {
  axisKey,
  axisOf,
  chartMemberLabel,
  displayFrameCell,
  partitions,
  periodsOf,
  rowsOf,
  type Snapshot,
  timeTicks,
  valueName,
} from './model.ts'

/** Project saved Frame facts without changing classification, periods or row identity. */
export function frameChartModel(
  t: Translator,
  s: Snapshot,
  c: FrameClassification,
  broadcast: string[] = [],
  visibleRowIndices?: readonly number[],
): ChartModel {
  const rows = rowsOf(s)
  const highlight = s.frameDisplay?.highlight
  const highlightedAxis = highlight ? axisOf(s, highlight.axis) : undefined
  return {
    data: s.data,
    visibleRowIndices,
    frameStyle: true,
    ...(s.frameDisplay?.rowLimit ? { rowLimit: s.frameDisplay.rowLimit } : {}),
    ...(highlight && highlightedAxis
      ? { highlight: { axis: highlightedAxis.token, key: JSON.stringify(highlight.key) } }
      : {}),
    display: (value, column) =>
      column ? displayFrameCell(s, t.locale, value, column) : String(value ?? '—'),
    axes: s.frame.axes.map((axis) => {
      const time =
        axis.variant?.kind === 'calendar' || axis.variant?.kind === 'interval'
          ? timeTicks(t, s, axis)
          : undefined
      const pages = periodsOf(s)?.pages.filter(
        (item) => item.target.kind === 'axis' && item.target.axisToken === axis.token,
      )
      const capturedKeys = new Map<string, number>()
      for (const page of pages ?? [])
        for (const item of page.items) {
          if (item.kind !== 'calendar' && item.kind !== 'interval') continue
          const key = JSON.stringify(item.key)
          capturedKeys.set(key, (capturedKeys.get(key) ?? 0) + 1)
        }
      return {
        id: axis.token,
        name: axis.name,
        keys: rows.map((row) => axisKey(s, axis, row)),
        labels: rows.map((row) => chartMemberLabel(s, axis, row)),
        ...(time
          ? {
              ticks: {
                ticks: time.ticks,
                indices: rows.map(time.tickOf),
                captured: time.ticks.map((tick) => capturedKeys.get(tick.key) === 1),
              },
            }
          : {}),
      }
    }),
    valueLabels: Object.fromEntries(
      s.data.columns.map((column) => [column.id, valueName(s, c, column.id)]),
    ),
    references: Object.fromEntries(broadcast.map((name) => [name, partitions(s, name)])),
  }
}
