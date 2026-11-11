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
        labels: data.rows.map((row) => formatCell(row[index] ?? null, column)),
      }
    }),
    valueLabels: Object.fromEntries(data.columns.map((c) => [c.id, c.label])),
    references: {},
  }
}
