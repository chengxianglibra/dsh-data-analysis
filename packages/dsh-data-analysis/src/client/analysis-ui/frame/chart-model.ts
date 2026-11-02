import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type { Translator } from '../../i18n/copy.ts'
import type { ChartModel } from '../charts/model.ts'
import {
  axisKey,
  memberLabel,
  partitions,
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
): ChartModel {
  const rows = rowsOf(s)
  return {
    data: s.data,
    axes: s.frame.axes.map((axis) => {
      const time =
        axis.variant?.kind === 'calendar' || axis.variant?.kind === 'interval'
          ? timeTicks(t, s, axis)
          : undefined
      return {
        id: axis.token,
        name: axis.name,
        keys: rows.map((row) => axisKey(s, axis, row)),
        labels: rows.map((row) => memberLabel(s, axis, row)),
        ...(time ? { ticks: { ticks: time.ticks, indices: rows.map(time.tickOf) } } : {}),
      }
    }),
    valueLabels: Object.fromEntries(
      s.data.columns.map((column) => [column.id, valueName(s, c, column.id)]),
    ),
    references: Object.fromEntries(broadcast.map((name) => [name, partitions(s, name)])),
  }
}
