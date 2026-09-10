import {
  type ChartOptions,
  type ChartView,
  validateChartView,
} from '../../presentation/contracts/charts.ts'
import type { TypedDataset } from '../../presentation/contracts/types.ts'
import type { ChartBlock } from './model.ts'

/** Page-local state only: the authored block and snapshot are never modified. */
export interface ChartExploration {
  view: ChartView
  hidden: string[]
  preparedViewId?: string
}

export function savedChartView(block: ChartBlock & { label?: string }): ChartView {
  const {
    id: _id,
    kind: _kind,
    label: _label,
    preparedViews: _preparedViews,
    ...view
  } = structuredClone(block)
  return view
}

export function initialChartExploration(block: ChartBlock): ChartExploration {
  return { view: savedChartView(block), hidden: [] }
}

export function exploredChartBlock(block: ChartBlock, state?: ChartExploration): ChartBlock {
  if (!state) return block
  return { ...state.view, id: block.id, kind: 'chart', preparedViews: block.preparedViews }
}

export function chartViewError(view: ChartView, dataset: TypedDataset): string | undefined {
  try {
    validateChartView(view, dataset)
    return undefined
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'marivo.presentation.fields-do-not-meet-chart-requirements'
  }
}

function withoutReferenceLines(view: ChartView): ChartView {
  if (!view.options?.referenceLines) return view
  const options = { ...view.options }
  delete options.referenceLines
  const next = { ...view }
  if (Object.keys(options).length) next.options = options
  else delete next.options
  return next
}

/** Reference lines were authored for the original fields; new bindings need new declarations. */
export function withChartX(view: ChartView, x: string): ChartView {
  return x === view.x ? view : withoutReferenceLines({ ...view, x })
}

export function withChartSeries(view: ChartView, y: string[]): ChartView {
  const next = {
    ...view,
    y,
    ...(view.options?.series
      ? {
          options: {
            ...view.options,
            series: Object.fromEntries(
              Object.entries(view.options.series).filter(([id]) => y.includes(id)),
            ),
          },
        }
      : {}),
  }
  return JSON.stringify(y) === JSON.stringify(view.y) ? next : withoutReferenceLines(next)
}

type SeriesStyle = NonNullable<ChartOptions['series']>[string]

/** Clearing a selector removes its declaration, including for prototype-named column IDs. */
export function withChartSeriesStyle<Key extends keyof SeriesStyle>(
  view: ChartView,
  field: string,
  key: Key,
  value: SeriesStyle[Key],
): ChartView {
  const series = new Map(Object.entries(view.options?.series ?? {}))
  const style = { ...series.get(field) }
  if (value === undefined) delete style[key]
  else style[key] = value
  if (Object.keys(style).length) series.set(field, style)
  else series.delete(field)
  const options = { ...view.options }
  if (series.size) options.series = Object.fromEntries(series)
  else delete options.series
  const next = { ...view }
  if (Object.keys(options).length) next.options = options
  else delete next.options
  return next
}

export function changeChartView(
  state: ChartExploration,
  view: ChartView,
  preparedViewId = state.preparedViewId,
): ChartExploration {
  const datasetChanged = view.datasetId !== state.view.datasetId
  return {
    view,
    hidden: datasetChanged ? [] : state.hidden.filter((field) => view.y.includes(field)),
    preparedViewId,
  }
}
