import {
  type ChartBindings,
  type ChartType,
  type ChartView,
  PRESENTATION_BUDGETS,
  type TypedDataset,
} from './types.ts'
import { chartNumber, PresentationContractError } from './values.ts'

export type { ChartBindings, ChartOptions, ChartType, ChartView } from './types.ts'

export const CHART_TYPES = [
  'line',
  'area',
  'stackedArea',
  'sparkline',
  'bar',
  'horizontalBar',
  'stackedBar',
  'stackedBar100',
  'horizontalStackedBar',
  'horizontalStackedBar100',
  'histogram',
  'boxPlot',
  'scatter',
  'heatmap',
  'pie',
  'leaderboard',
  'funnel',
  'waterfall',
] as const satisfies readonly ChartType[]

const trendTypes: readonly ChartType[] = ['line', 'area', 'stackedArea', 'sparkline']
const ratioTypes: readonly ChartType[] = ['stackedBar100', 'horizontalStackedBar100']
const singleSeriesTypes: readonly ChartType[] = [
  'sparkline',
  'histogram',
  'boxPlot',
  'scatter',
  'pie',
  'leaderboard',
  'funnel',
  'waterfall',
]
const commonScaleTypes: readonly ChartType[] = [
  'stackedArea',
  'stackedBar',
  'horizontalStackedBar',
  ...ratioTypes,
  'heatmap',
]
const simpleTypes: readonly ChartType[] = [
  ...trendTypes,
  'bar',
  'horizontalBar',
  'stackedBar',
  'horizontalStackedBar',
  'heatmap',
  'scatter',
]
const bindingSpec: Partial<
  Record<ChartType, { required: (keyof ChartBindings)[]; optional?: (keyof ChartBindings)[] }>
> = {
  histogram: { required: ['binStart', 'binEnd'] },
  boxPlot: { required: ['minimum', 'q1', 'q3', 'maximum'] },
  waterfall: { required: ['start', 'end', 'role'] },
  pie: { required: ['share'] },
  funnel: { required: ['share'] },
  leaderboard: { required: ['rank'] },
  stackedBar100: { required: ['denominator'] },
  horizontalStackedBar100: { required: ['denominator'] },
  scatter: { required: [], optional: ['size', 'label', 'color'] },
}

function fail(path: string, message: string, code = 'invalid_value'): never {
  throw new PresentationContractError(code, path, message)
}
function pointer(path: string, key: string | number) {
  return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object.')
  return value as Record<string, unknown>
}
function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(pointer(path, key), 'Required field is missing.')
  }
  for (const key of Object.keys(value)) {
    if (![...required, ...optional].includes(key))
      fail(pointer(path, key), 'Unknown field.', 'unknown_field')
  }
}
function string(value: unknown, path: string, max = 256) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > max ||
    value.includes('\0') ||
    /[\uD800-\uDFFF]/u.test(value)
  )
    fail(path, `Expected a nonempty string of at most ${max} characters.`)
}
function choice(value: unknown, choices: readonly string[], path: string) {
  if (typeof value !== 'string' || !choices.includes(value))
    fail(path, `Expected ${choices.join(', ')}.`)
}

type NumericCell = number | string
function decimal(value: NumericCell): { coefficient: bigint; exponent: bigint } {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa!.split('.')
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    exponent: BigInt(exponent) - BigInt(fraction.length),
  }
}
/** Decimal comparisons must inspect original strings even when geometry is approximate. */
function sumSign(values: [NumericCell, 1 | -1][]): number {
  const parts = values
    .map(([value, sign]) => {
      const part = decimal(value)
      return { ...part, coefficient: part.coefficient * BigInt(sign) }
    })
    .filter((part) => part.coefficient !== 0n)
    .sort((a, b) => (a.exponent > b.exponent ? -1 : a.exponent < b.exponent ? 1 : 0))
  let coefficient = 0n
  let exponent = parts[0]?.exponent ?? 0n
  for (const part of parts) {
    const shift = exponent - part.exponent
    // Inputs have <= 256 digits and datasets <= 5000 rows. Beyond this gap,
    // lower terms cannot change a nonzero sign; do not allocate enormous powers.
    if (shift > 1024n && coefficient !== 0n) return coefficient > 0n ? 1 : -1
    coefficient =
      coefficient === 0n ? part.coefficient : coefficient * 10n ** shift + part.coefficient
    exponent = part.exponent
  }
  return coefficient > 0n ? 1 : coefficient < 0n ? -1 : 0
}
function compare(a: NumericCell, b: NumericCell) {
  return sumSign([
    [a, 1],
    [b, -1],
  ])
}

/** Strictly validates one binding. A containing block handles id/kind/preparedViews. */
export function parseChartViewShape(value: unknown, path = ''): asserts value is ChartView {
  const view = object(value, path)
  keys(view, ['datasetId', 'chart', 'x', 'y', 'numericMode'], ['bindings', 'options'], path)
  string(view.datasetId, `${path}/datasetId`)
  string(view.x, `${path}/x`)
  choice(view.chart, CHART_TYPES, `${path}/chart`)
  choice(view.numericMode, ['exact', 'approximate'], `${path}/numericMode`)
  if (!Array.isArray(view.y) || view.y.length < 1 || view.y.length > PRESENTATION_BUDGETS.columns)
    fail(`${path}/y`, 'Expected one or more bounded series identifiers.')
  view.y.forEach((id, i) => {
    string(id, `${path}/y/${i}`)
  })
  if (new Set(view.y).size !== view.y.length)
    fail(`${path}/y`, 'Duplicate identifiers.', 'duplicate_id')
  const chart = view.chart as ChartType
  if (singleSeriesTypes.includes(chart) && view.y.length !== 1)
    fail(`${path}/y`, `${chart} requires exactly one series.`)
  const spec = bindingSpec[chart]
  if (view.bindings !== undefined || spec?.required.length) {
    const bindings = object(view.bindings, `${path}/bindings`)
    keys(bindings, spec?.required ?? [], spec?.optional ?? [], `${path}/bindings`)
    for (const [name, id] of Object.entries(bindings)) string(id, `${path}/bindings/${name}`)
  }
  if (view.options === undefined) return
  const options = object(view.options, `${path}/options`)
  keys(options, [], ['showPoints', 'series', 'valueLabels', 'referenceLines'], `${path}/options`)
  if (options.showPoints !== undefined) {
    if (!trendTypes.includes(chart))
      fail(`${path}/options/showPoints`, 'Point styles apply to trend charts only.')
    choice(options.showPoints, ['auto', 'always', 'never'], `${path}/options/showPoints`)
  }
  if (options.series !== undefined) {
    if (!trendTypes.includes(chart))
      fail(`${path}/options/series`, 'Line styles apply to trend charts only.')
    const series = object(options.series, `${path}/options/series`)
    for (const [id, value] of Object.entries(series)) {
      const seriesPath = pointer(`${path}/options/series`, id)
      if (!view.y.includes(id))
        fail(seriesPath, 'Style must name a selected series.', 'invalid_reference')
      const style = object(value, seriesPath)
      keys(style, [], ['lineStyle', 'role'], seriesPath)
      if (style.lineStyle !== undefined)
        choice(style.lineStyle, ['solid', 'dashed', 'dotted'], `${seriesPath}/lineStyle`)
      if (style.role !== undefined)
        choice(
          style.role,
          ['actual', 'baseline', 'target', 'forecast', 'plan', 'comparison'],
          `${seriesPath}/role`,
        )
    }
  }
  if (options.valueLabels !== undefined)
    choice(options.valueLabels, ['none', 'auto', 'all'], `${path}/options/valueLabels`)
  if (options.referenceLines !== undefined) {
    if (!Array.isArray(options.referenceLines) || options.referenceLines.length > 16)
      fail(`${path}/options/referenceLines`, 'Expected at most 16 reference lines.')
    const axes =
      chart === 'scatter' || chart === 'histogram'
        ? ['x', 'y']
        : ['pie', 'funnel', 'heatmap', 'sparkline'].includes(chart)
          ? []
          : [
                'horizontalBar',
                'horizontalStackedBar',
                'horizontalStackedBar100',
                'leaderboard',
                'boxPlot',
              ].includes(chart)
            ? ['x']
            : ['y']
    options.referenceLines.forEach((value, i) => {
      const refPath = `${path}/options/referenceLines/${i}`
      const ref = object(value, refPath)
      keys(ref, ['axis', 'value'], ['label'], refPath)
      choice(ref.axis, axes, `${refPath}/axis`)
      if (typeof ref.value !== 'number' || !Number.isFinite(ref.value))
        fail(`${refPath}/value`, 'Expected a finite number.')
      if (ref.label !== undefined) string(ref.label, `${refPath}/label`)
    })
  }
}

/** Exact source columns, including every auxiliary field used by geometry or tooltip. */
export function chartColumns(view: ChartView): string[] {
  return [...new Set([view.x, ...view.y, ...Object.values(view.bindings ?? {})])]
}

/** Verifies supplied values only: never bins, ranks, accumulates, normalizes or sorts. */
export function validateChartView(
  view: ChartView,
  dataset: TypedDataset,
  path = '',
  dataPath = '/data',
  rowIndices?: readonly number[],
): void {
  const rows = rowIndices ? rowIndices.map((index) => dataset.rows[index]!) : dataset.rows
  parseChartViewShape(
    {
      datasetId: view.datasetId,
      chart: view.chart,
      x: view.x,
      y: view.y,
      numericMode: view.numericMode,
      ...(view.bindings === undefined ? {} : { bindings: view.bindings }),
      ...(view.options === undefined ? {} : { options: view.options }),
    },
    path,
  )
  const columns = new Map(dataset.columns.map((column, index) => [column.id, { column, index }]))
  for (const id of chartColumns(view)) {
    if (!columns.has(id)) fail(path, `Unknown column ${id}.`, 'invalid_reference')
  }
  const bindings = view.bindings ?? {}
  const numeric = new Set(view.y)
  if (view.chart === 'scatter') numeric.add(view.x)
  for (const [role, id] of Object.entries(bindings)) {
    if (!['role', 'color', 'label'].includes(role)) numeric.add(id)
  }
  for (const id of numeric) {
    const { column, index } = columns.get(id)!
    if (!['float64', 'decimal', 'int64'].includes(column.type))
      fail(path, `Column ${id} must be numeric.`)
    rows.forEach((row, i) => {
      chartNumber(
        row[index]!,
        column,
        view.numericMode,
        `${dataPath}/rows/${rowIndices?.[i] ?? i}/${index}`,
      )
    })
  }
  if (bindings.role && columns.get(bindings.role)!.column.type !== 'string')
    fail(`${path}/bindings/role`, 'Waterfall roles must use a string column.')
  if (
    bindings.color &&
    !['string', 'boolean', 'date', 'datetime'].includes(columns.get(bindings.color)!.column.type)
  )
    fail(`${path}/bindings/color`, 'Scatter color must use a categorical column.')
  function commonUnit(ids: string[]) {
    if (new Set(ids.map((id) => columns.get(id)!.column.unit ?? '')).size > 1)
      fail(path, 'A shared chart scale requires matching units.')
  }
  if (commonScaleTypes.includes(view.chart)) commonUnit(view.y)
  if (view.chart === 'boxPlot')
    commonUnit([bindings.minimum!, bindings.q1!, view.y[0]!, bindings.q3!, bindings.maximum!])
  if (view.chart === 'histogram') commonUnit([bindings.binStart!, bindings.binEnd!])
  if (view.chart === 'waterfall') commonUnit([view.y[0]!, bindings.start!, bindings.end!])
  if (new Set(view.y.map((id) => columns.get(id)!.column.unit ?? '')).size > 1) {
    const numericAxis = view.chart.startsWith('horizontal') ? 'x' : 'y'
    view.options?.referenceLines?.forEach((reference, index) => {
      if (reference.axis === numericAxis)
        fail(
          `${path}/options/referenceLines/${index}`,
          'Reference lines across different series units are ambiguous. Use a separate chart or prepared view for each unit.',
        )
    })
  }
  const raw = (row: TypedDataset['rows'][number], id: string) =>
    row[columns.get(id)!.index] as NumericCell | null
  let previousBinEnd: NumericCell | null = null
  let previousRank: number | null = null
  let previousEnd: NumericCell | null = null
  let totalShare = 0
  const pieShares: [NumericCell, 1 | -1][] = [[1, -1]]
  const exactStatistics =
    view.y.some((id) => columns.get(id)!.column.type !== 'float64') ||
    (view.chart === 'waterfall' &&
      [bindings.start!, bindings.end!].some((id) => columns.get(id)!.column.type !== 'float64'))
  const exactShares =
    bindings.share !== undefined && columns.get(bindings.share)!.column.type !== 'float64'
  const close = (a: number, b: number) =>
    Math.abs(a - b) <= Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b))
  const equal = (a: NumericCell, b: NumericCell) =>
    exactStatistics ? compare(a, b) === 0 : close(Number(a), Number(b))
  rows.forEach((row, i) => {
    const rowPath = `${dataPath}/rows/${rowIndices?.[i] ?? i}`
    const values = view.y.map((id) => raw(row, id))
    const value = values[0]!
    if (['stackedArea', 'stackedBar', 'horizontalStackedBar'].includes(view.chart)) {
      let positive = 0
      let negative = 0
      for (const value of values) {
        if (value === null) continue
        const coordinate = Number(value)
        if (coordinate >= 0) positive += coordinate
        else negative += coordinate
        if (!Number.isFinite(positive) || !Number.isFinite(negative))
          fail(rowPath, 'Stacked chart coordinates must remain finite.', 'numeric_precision')
      }
    }
    if (bindings.size) {
      const size = raw(row, bindings.size)
      if (size !== null && compare(size, 0) < 0) fail(rowPath, 'Scatter size cannot be negative.')
    }
    if (ratioTypes.includes(view.chart)) {
      const denominator = raw(row, bindings.denominator!)
      if (denominator !== null && compare(denominator, 0) < 0)
        fail(rowPath, 'A percentage denominator cannot be negative.')
      if (
        denominator !== null &&
        compare(denominator, 0) === 0 &&
        values.some((value) => value !== null)
      )
        fail(rowPath, 'Zero denominators require missing fractions.')
      if (denominator === null && values.some((value) => value !== null))
        fail(rowPath, 'Provided fractions require a positive denominator.')
      if (
        values.some((value) => value !== null && (compare(value, 0) < 0 || compare(value, 1) > 0))
      )
        fail(rowPath, 'Prepared fractions must be between zero and one.')
      if (
        exactStatistics
          ? sumSign([
              ...values
                .filter((value): value is NumericCell => value !== null)
                .map((value): [NumericCell, 1] => [value, 1]),
              [1, -1],
            ]) > 0
          : values.reduce<number>((sum, value) => sum + Number(value ?? 0), 0) >
            1 + Number.EPSILON * view.y.length * 4
      )
        fail(rowPath, 'Prepared fractions cannot exceed one in total.')
    }
    if (bindings.share) {
      const share = raw(row, bindings.share)
      if (value !== null && compare(value, 0) < 0)
        fail(rowPath, 'Part-to-whole values cannot be negative.')
      if (share !== null && (compare(share, 0) < 0 || compare(share, 1) > 0))
        fail(rowPath, 'Prepared share must be between zero and one.')
      if (view.chart === 'pie' && share !== null) {
        totalShare += Number(share)
        pieShares.push([share, 1])
      }
    }
    if (view.chart === 'histogram') {
      const start = raw(row, bindings.binStart!)
      const end = raw(row, bindings.binEnd!)
      if (value !== null && compare(value, 0) < 0)
        fail(rowPath, 'Histogram frequency cannot be negative.')
      if (start !== null && end !== null) {
        if (compare(start, end) >= 0)
          fail(rowPath, 'Histogram intervals require binStart < binEnd.')
        if (previousBinEnd !== null && compare(start, previousBinEnd) < 0)
          fail(rowPath, 'Histogram intervals must be ordered and nonoverlapping.')
        previousBinEnd = end
      }
    }
    if (view.chart === 'boxPlot') {
      const five = [
        bindings.minimum!,
        bindings.q1!,
        view.y[0]!,
        bindings.q3!,
        bindings.maximum!,
      ].map((id) => raw(row, id))
      const present = five.filter((entry): entry is NumericCell => entry !== null)
      if (present.some((entry, j) => j > 0 && compare(entry, present[j - 1]!) < 0))
        fail(
          rowPath,
          'Five-number summary must be ordered minimum <= q1 <= median <= q3 <= maximum.',
        )
    }
    if (view.chart === 'leaderboard') {
      const rankValue = raw(row, bindings.rank!)
      if (rankValue !== null) {
        const rank = Number(rankValue)
        if (!Number.isSafeInteger(rank) || rank < 1 || compare(rankValue, rank) !== 0)
          fail(rowPath, 'Prepared rank must be a positive safe integer.')
        if (previousRank !== null && rank < previousRank)
          fail(rowPath, 'Prepared ranks must already be ordered.')
        previousRank = rank
      }
    }
    if (view.chart === 'waterfall') {
      const start = raw(row, bindings.start!)
      const end = raw(row, bindings.end!)
      const role = row[columns.get(bindings.role!)!.index]!
      if (role !== null && !['start', 'delta', 'subtotal', 'total'].includes(String(role)))
        fail(rowPath, 'Unknown waterfall step role.')
      if (start !== null && end !== null && value !== null && role !== null) {
        if (role === 'delta') {
          if (
            exactStatistics
              ? sumSign([
                  [end, 1],
                  [start, -1],
                  [value, -1],
                ]) !== 0
              : !close(Number(end) - Number(start), Number(value))
          )
            fail(rowPath, 'Waterfall delta must equal end minus start.')
          if (previousEnd !== null && !equal(start, previousEnd))
            fail(rowPath, 'Waterfall delta must start at the preceding end.')
        } else {
          if (!equal(start, 0) || !equal(end, value))
            fail(rowPath, 'Waterfall start and totals require start zero and end equal to value.')
          if (role === 'start' && i !== 0)
            fail(rowPath, 'A waterfall start must be the first step.')
          if (role !== 'start' && previousEnd !== null && !equal(end, previousEnd))
            fail(rowPath, 'Waterfall totals must match the preceding end.')
        }
        previousEnd = end
      } else previousEnd = null
    }
  })
  if (
    exactShares
      ? sumSign(pieShares) > 0
      : totalShare > 1 + Number.EPSILON * Math.max(1, rows.length) * 4
  )
    fail(dataPath, 'Prepared pie shares cannot exceed one in total.')
}

/** Changes geometry only. Statistical views must be declared with prepared bindings. */
export function chartTransition(
  view: ChartView,
  chart: ChartType,
  dataset: TypedDataset,
): ChartView | undefined {
  if (
    view.chart !== chart &&
    !simpleTypes.includes(chart) &&
    !(ratioTypes.includes(view.chart) && ratioTypes.includes(chart))
  )
    return undefined
  const next = {
    datasetId: view.datasetId,
    chart,
    x: view.x,
    y: [...view.y],
    numericMode: view.numericMode,
    ...(view.bindings === undefined ? {} : { bindings: { ...view.bindings } }),
    ...(view.options === undefined ? {} : { options: structuredClone(view.options) }),
  }
  if (view.chart !== chart) {
    if (!ratioTypes.includes(chart)) delete next.bindings
    if (next.options) {
      delete next.options.referenceLines
      if (!trendTypes.includes(chart)) {
        delete next.options.showPoints
        delete next.options.series
      }
    }
  }
  try {
    parseChartViewShape(next)
    validateChartView(next, dataset)
    return next
  } catch (error) {
    if (error instanceof PresentationContractError) return undefined
    throw error
  }
}
