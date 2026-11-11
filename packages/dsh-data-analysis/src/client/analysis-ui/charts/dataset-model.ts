import { formatCell } from '../../../presentation/contracts/index.ts'
import type { TypedDataset } from '../../../presentation/contracts/types.ts'
import type { ChartModel } from './model.ts'

/** Discrete axis slots follow first appearance in the saved rows, including dates. */
export function datasetChartModel(
  data: TypedDataset,
  axes: string[],
  visibleRowIndices?: readonly number[],
): ChartModel {
  return {
    data,
    visibleRowIndices,
    frameStyle: true,
    axes: [...new Set(axes)].map((id) => {
      const index = data.columns.findIndex((c) => c.id === id)
      const column = data.columns[index]!
      return {
        id,
        name: id,
        keys: data.rows.map((row) => JSON.stringify(row[index])),
        labels: data.rows.map((row) => {
          const label = formatCell(row[index] ?? null, column)
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
