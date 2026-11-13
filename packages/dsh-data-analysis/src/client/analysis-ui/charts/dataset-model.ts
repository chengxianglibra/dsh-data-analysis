import type { FrameDisplay } from '../../../presentation/contracts/frame-view.ts'
import { formatCell } from '../../../presentation/contracts/index.ts'
import type { PresentationLocale, TypedDataset } from '../../../presentation/contracts/types.ts'
import { displayExplicitFormat, formattedTimeTick } from '../frame/model.ts'
import { type ChartModel, exact } from './model.ts'

/** Discrete axis slots follow first appearance in the saved rows, including dates. */
export function datasetChartModel(
  data: TypedDataset,
  axes: string[],
  visibleRowIndices?: readonly number[],
  formats?: FrameDisplay['formats'],
  locale: PresentationLocale = 'en-US',
  time?: FrameDisplay['time'],
): ChartModel {
  return {
    data,
    visibleRowIndices,
    display: (value, column) =>
      column
        ? (displayExplicitFormat(
            locale,
            value,
            column,
            formats?.find((item) => item.value === column.id),
          ) ?? exact(value, column))
        : exact(value),
    scaleFormatKey: (name) => {
      const format = formats?.find((item) => item.value === name)
      return format ? JSON.stringify([format.format, format.decimals ?? 2]) : ''
    },
    tickDisplay: (value, name) => {
      const column = data.columns.find((item) => item.id === name)
      return column
        ? displayExplicitFormat(
            locale,
            value,
            column,
            formats?.find((item) => item.value === name),
          )
        : undefined
    },
    frameStyle: true,
    axes: [...new Set(axes)].map((id) => {
      const index = data.columns.findIndex((c) => c.id === id)
      const column = data.columns[index]!
      const keys = data.rows.map((row) => JSON.stringify(row[index]))
      const ticks: NonNullable<ChartModel['axes'][number]['ticks']>['ticks'] = []
      const tickIndices = new Map<string, number>()
      if ((column.type === 'datetime' || column.type === 'date') && time) {
        for (const row of data.rows) {
          const value = row[index] ?? null
          const key = JSON.stringify(value)
          if (tickIndices.has(key)) continue
          tickIndices.set(key, ticks.length)
          const title = formatCell(value, column)
          const formatted = formattedTimeTick(title, time)
          ticks.push({
            key,
            label: formatted ?? title,
            title,
            incomplete: false,
            ...(formatted === undefined ? {} : { formatted: true }),
          })
        }
      }
      return {
        id,
        name: id,
        keys,
        ...(ticks.length
          ? { ticks: { ticks, indices: keys.map((key) => tickIndices.get(key) ?? -1) } }
          : {}),
        labels: data.rows.map((row) => {
          const cell = row[index] ?? null
          const label =
            displayExplicitFormat(
              locale,
              cell,
              column,
              formats?.find((item) => item.value === column.id),
            ) ?? formatCell(cell, column)
          // Dataset timestamps have no bucket grain. Trim only insignificant
          // zeros, leaving distinct instants distinct in the display.
          return column.type === 'datetime'
            ? label
                .replace(/(\.\d*?[1-9])0+(?=Z|[+-]\d\d)/i, '$1')
                .replace(/\.0+(?=Z|[+-]\d\d)/i, '')
            : label
        }),
      }
    }),
    valueLabels: Object.fromEntries(data.columns.map((c) => [c.id, c.label])),
    references: {},
  }
}
