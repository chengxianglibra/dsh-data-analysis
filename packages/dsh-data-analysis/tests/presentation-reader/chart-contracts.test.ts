import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHART_TYPES,
  type ChartType,
  type ChartView,
  type ColumnType,
  chartColumns,
  chartTransition,
  PresentationContractError,
  type PresentationDocument,
  parseChartViewShape,
  parsePresentationDocument,
  parsePresentationDraft,
  type TypedDataset,
  validateChartView,
} from '../../src/presentation/contracts/index.ts'

function data(columns: [string, ColumnType, string?][], rows: TypedDataset['rows']): TypedDataset {
  return {
    schemaVersion: 1,
    columns: columns.map(([id, type, unit]) => ({
      id,
      label: id,
      type,
      nullable: true,
      ...(unit ? { unit } : {}),
    })),
    rows,
    rowCount: rows.length,
    limit: Math.max(1, rows.length),
    truncated: false,
  }
}

function example(chart: ChartType): { view: ChartView; dataset: TypedDataset } {
  const view: Omit<ChartView, 'chart'> & { chart: ChartType } = {
    datasetId: 'prepared',
    chart,
    x: 'category',
    y: ['value'],
    numericMode: 'exact',
  }
  let dataset = data(
    [
      ['category', 'string'],
      ['value', 'float64'],
      ['other', 'float64'],
    ],
    [
      ['A', 4, 2],
      ['A', 2, -1],
    ],
  )
  switch (chart) {
    case 'histogram':
      view.bindings = { binStart: 'lo', binEnd: 'hi' }
      dataset = data(
        [
          ['category', 'string'],
          ['lo', 'float64'],
          ['hi', 'float64'],
          ['value', 'float64'],
        ],
        [
          ['0–1', 0, 1, 4],
          ['1–3', 1, 3, 2],
        ],
      )
      break
    case 'boxPlot':
      view.bindings = { minimum: 'min', q1: 'q1', q3: 'q3', maximum: 'max' }
      dataset = data(
        [
          ['category', 'string'],
          ['min', 'float64'],
          ['q1', 'float64'],
          ['value', 'float64'],
          ['q3', 'float64'],
          ['max', 'float64'],
        ],
        [['A', -4, -2, 0, 2, 7]],
      )
      break
    case 'scatter':
      view.x = 'other'
      view.bindings = { size: 'size', color: 'category', label: 'label' }
      dataset = data(
        [
          ['category', 'string'],
          ['other', 'float64'],
          ['value', 'float64'],
          ['size', 'float64'],
          ['label', 'string'],
        ],
        [['A', -2, 3, 4, 'Observation 1']],
      )
      break
    case 'pie':
    case 'funnel':
      view.bindings = { share: 'share' }
      dataset = data(
        [
          ['category', 'string'],
          ['value', 'float64'],
          ['share', 'float64'],
        ],
        [
          ['A', 4, 0.4],
          ['B', 2, 0.2],
        ],
      )
      break
    case 'leaderboard':
      view.bindings = { rank: 'rank' }
      dataset = data(
        [
          ['category', 'string'],
          ['value', 'float64'],
          ['rank', 'int64'],
        ],
        [
          ['A', -2, '1'],
          ['B', -5, '3'],
        ],
      )
      break
    case 'waterfall':
      view.bindings = { start: 'start', end: 'end', role: 'role' }
      dataset = data(
        [
          ['category', 'string'],
          ['value', 'float64'],
          ['start', 'float64'],
          ['end', 'float64'],
          ['role', 'string'],
        ],
        [
          ['Opening', 10, 0, 10, 'start'],
          ['Loss', -3, 10, 7, 'delta'],
          ['Subtotal', 7, 0, 7, 'subtotal'],
          ['Gain', 5, 7, 12, 'delta'],
          ['Closing', 12, 0, 12, 'total'],
        ],
      )
      break
    case 'stackedBar100':
    case 'horizontalStackedBar100':
      view.y = ['value', 'other']
      view.bindings = { denominator: 'denominator' }
      dataset = data(
        [
          ['category', 'string'],
          ['value', 'float64'],
          ['other', 'float64'],
          ['denominator', 'float64'],
        ],
        [
          ['A', 0.2, 0.3, 100],
          ['B', null, 0.4, 5],
        ],
      )
      break
    case 'sparkline':
      break
    default:
      view.y.push('other')
  }
  parseChartViewShape(view)
  return { view, dataset }
}

function document(view: ChartView, dataset: TypedDataset): PresentationDocument {
  return {
    schemaVersion: 2,
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'chart-contracts',
    title: 'Prepared chart data',
    generatedAt: '2026-09-07T00:00:00Z',
    datasets: [{ id: view.datasetId, origin: 'computed', data: dataset, sourceIds: [] }],
    sources: [],
    blocks: [{ id: 'chart', kind: 'chart', ...view }],
    diagnostics: [],
  }
}

function invalid(run: () => unknown, pattern?: RegExp) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof PresentationContractError && (!pattern || pattern.test(error.message)),
  )
}

test('statistical families require bindings at compile time and narrow by chart', () => {
  const common = { datasetId: 'd', x: 'label', y: ['frequency'], numericMode: 'exact' as const }
  // @ts-expect-error histogram requires prepared binStart and binEnd bindings.
  const missing: ChartView = { ...common, chart: 'histogram' }
  // @ts-expect-error one histogram boundary does not satisfy its prepared bindings.
  const partial: ChartView = { ...common, chart: 'histogram', bindings: { binStart: 'lower' } }
  invalid(() => parseChartViewShape(missing))
  invalid(() => parseChartViewShape(partial))
  const ordinary: ChartView = { ...common, chart: 'bar' }
  assert.doesNotThrow(() => parseChartViewShape(ordinary))
  const histogram: ChartView = {
    ...common,
    chart: 'histogram',
    bindings: { binStart: 'lower', binEnd: 'upper' },
  }
  function start(view: ChartView): string | undefined {
    return view.chart === 'histogram' ? view.bindings.binStart : undefined
  }
  assert.equal(start(histogram), 'lower')
})

test('all 18 declared chart families accept prepared values without changing source data', () => {
  assert.equal(CHART_TYPES.length, 18)
  for (const chart of CHART_TYPES) {
    const { view, dataset } = example(chart)
    const original = JSON.stringify({ view, dataset })
    assert.doesNotThrow(() => validateChartView(view, dataset), chart)
    assert.deepEqual(parsePresentationDocument(document(view, dataset)).blocks[0], {
      id: 'chart',
      kind: 'chart',
      ...view,
    })
    assert.equal(JSON.stringify({ view, dataset }), original)
  }
})

test('empty and all-null snapshots preserve missing values across every chart family', () => {
  for (const chart of CHART_TYPES) {
    const { view, dataset } = example(chart)
    dataset.rows = [dataset.columns.map(() => null)]
    dataset.rowCount = 1
    assert.doesNotThrow(() => parsePresentationDocument(document(view, dataset)), chart)
    dataset.rows = []
    dataset.rowCount = 0
    assert.doesNotThrow(() => parsePresentationDocument(document(view, dataset)), chart)
  }
})

test('strict binding shape rejects arbitrary chart configs, omitted statistics and wrong series counts', () => {
  const { view } = example('line')
  invalid(() => parseChartViewShape({ ...view, chart: 'custom' }), /Expected line/)
  invalid(() => parseChartViewShape({ ...view, options: { connectNulls: true } }), /Unknown field/)
  invalid(() => parseChartViewShape({ ...view, bindings: { share: 'share' } }), /Unknown field/)
  invalid(() => parseChartViewShape({ ...view, chart: 'sparkline' }), /exactly one/)
  invalid(() => parseChartViewShape({ ...view, y: ['value', 'value'] }), /Duplicate/)
  for (const chart of [
    'histogram',
    'boxPlot',
    'pie',
    'funnel',
    'waterfall',
    'leaderboard',
    'stackedBar100',
  ] as const) {
    invalid(() => parseChartViewShape({ ...example(chart).view, bindings: undefined }), /object/)
  }
})

test('line variants accept only supported points, line styles, roles and numeric reference axes', () => {
  const { view, dataset } = example('line')
  for (const chart of ['line', 'area', 'stackedArea', 'sparkline'] as const) {
    for (const lineStyle of ['solid', 'dashed', 'dotted'] as const) {
      for (const showPoints of ['auto', 'always', 'never'] as const) {
        assert.doesNotThrow(() =>
          validateChartView(
            {
              ...view,
              chart,
              y: ['value'],
              options: {
                showPoints,
                series: { value: { lineStyle, role: 'forecast' } },
                valueLabels: 'all',
              },
            },
            dataset,
          ),
        )
      }
    }
  }
  invalid(
    () => parseChartViewShape({ ...view, options: { series: { missing: { role: 'actual' } } } }),
    /selected series/,
  )
  invalid(
    () => parseChartViewShape({ ...view, options: { series: { value: { role: 'invented' } } } }),
    /actual/,
  )
  invalid(
    () => parseChartViewShape({ ...view, options: { referenceLines: [{ axis: 'x', value: 1 }] } }),
    /Expected y/,
  )
  invalid(
    () => parseChartViewShape({ ...view, chart: 'bar', options: { showPoints: 'always' } }),
    /trend/,
  )
  for (const chart of CHART_TYPES) {
    const current = example(chart).view
    const axis = [
      'horizontalBar',
      'horizontalStackedBar',
      'horizontalStackedBar100',
      'boxPlot',
      'leaderboard',
    ].includes(chart)
      ? 'x'
      : 'y'
    const action = () =>
      parseChartViewShape({
        ...current,
        options: { referenceLines: [{ axis, value: 1, label: 'Target' }] },
      })
    if (['pie', 'funnel', 'heatmap', 'sparkline'].includes(chart)) invalid(action)
    else assert.doesNotThrow(action)
  }
})

test('numericMode covers scatter X, point size and prepared geometry, retaining exact strings', () => {
  for (const [chart, field] of [
    ['scatter', 'other'],
    ['scatter', 'size'],
    ['histogram', 'lo'],
    ['boxPlot', 'min'],
    ['waterfall', 'end'],
  ] as const) {
    const { view, dataset } = example(chart)
    const index = dataset.columns.findIndex((column) => column.id === field)
    dataset.columns[index]!.type = 'decimal'
    dataset.rows.forEach((row) => {
      row[index] = `${row[index]}.00`
    })
    const original = structuredClone(dataset.rows)
    invalid(() => validateChartView(view, dataset), /Exact chart encoding/)
    assert.doesNotThrow(() => validateChartView({ ...view, numericMode: 'approximate' }, dataset))
    assert.deepEqual(dataset.rows, original)
  }
  const { view, dataset } = example('scatter')
  dataset.columns[1]!.type = 'int64'
  dataset.rows[0]![1] = '9007199254740993'
  invalid(() => validateChartView(view, dataset), /Exact chart encoding/)
  assert.doesNotThrow(() => validateChartView({ ...view, numericMode: 'approximate' }, dataset))
  dataset.columns[1]!.type = 'decimal'
  dataset.rows[0]![1] = '1e999'
  invalid(() => validateChartView({ ...view, numericMode: 'approximate' }, dataset), /finite/)
})

test('shared-scale charts reject mixed units but ordinary multi-series charts retain them', () => {
  for (const chart of [
    'line',
    'area',
    'bar',
    'horizontalBar',
    'stackedBar',
    'horizontalStackedBar',
    'stackedArea',
    'stackedBar100',
    'horizontalStackedBar100',
    'heatmap',
  ] as const) {
    const { view, dataset } = example(chart)
    dataset.columns.find((column) => column.id === view.y[0])!.unit = 'USD'
    dataset.columns.find((column) => column.id === view.y[1])!.unit = 'people'
    if (['line', 'area', 'bar', 'horizontalBar'].includes(chart))
      assert.doesNotThrow(() => validateChartView(view, dataset))
    else invalid(() => validateChartView(view, dataset), /matching units/)
  }
})

test('references require one unit per physical numeric axis without coupling independent axes', () => {
  for (const chart of ['line', 'area', 'bar', 'horizontalBar'] as const) {
    const { view, dataset } = example(chart)
    const axis = chart === 'horizontalBar' ? 'x' : 'y'
    const referenceView: ChartView = {
      ...view,
      options: { referenceLines: [{ axis, value: 100, label: 'Budget' }] },
    }
    dataset.columns[1]!.unit = 'USD'
    dataset.columns[2]!.unit = 'people'
    invalid(
      () => validateChartView(referenceView, dataset),
      /separate chart or prepared view for each unit/,
    )
    assert.doesNotThrow(() => validateChartView(view, dataset))
    dataset.columns[2]!.unit = 'USD'
    assert.doesNotThrow(() => validateChartView(referenceView, dataset))
    delete dataset.columns[2]!.unit
    invalid(() => validateChartView(referenceView, dataset), /different series units/)
  }
  const scatter = example('scatter')
  scatter.dataset.columns[1]!.unit = 'USD'
  scatter.dataset.columns[2]!.unit = 'people'
  scatter.view.options = {
    referenceLines: [
      { axis: 'x', value: 100 },
      { axis: 'y', value: 10 },
    ],
  }
  assert.doesNotThrow(() => validateChartView(scatter.view, scatter.dataset))
  const histogram = example('histogram')
  histogram.dataset.columns[1]!.unit = 'USD'
  histogram.dataset.columns[2]!.unit = 'USD'
  histogram.dataset.columns[3]!.unit = 'people'
  histogram.view.options = {
    referenceLines: [
      { axis: 'x', value: 100 },
      { axis: 'y', value: 10 },
    ],
  }
  assert.doesNotThrow(() => validateChartView(histogram.view, histogram.dataset))
})

test('approximate geometry still validates original exact decimal and int64 statistics', () => {
  const box = example('boxPlot')
  box.view.numericMode = 'approximate'
  box.dataset.columns.slice(1).forEach((column) => {
    column.type = 'decimal'
  })
  box.dataset.rows[0] = ['A', '0', '1.00000000000000000002', '1.00000000000000000001', '2', '3']
  invalid(() => validateChartView(box.view, box.dataset), /Five-number summary/)
  const percent = example('stackedBar100')
  percent.view.numericMode = 'approximate'
  percent.dataset.columns[1]!.type = 'decimal'
  percent.dataset.columns[2]!.type = 'decimal'
  percent.dataset.rows = [['A', '0.50000000000000000001', '0.5', 100]]
  invalid(() => validateChartView(percent.view, percent.dataset), /exceed one/)
  percent.dataset.rows[0]![1] = '-1e-99999999999999999999'
  invalid(() => validateChartView(percent.view, percent.dataset), /between zero and one/)
  percent.dataset.rows[0]![1] = '1e-99999999999999999999'
  assert.doesNotThrow(() => validateChartView(percent.view, percent.dataset))
  const waterfall = example('waterfall')
  waterfall.view.numericMode = 'approximate'
  waterfall.dataset.columns.slice(1, 4).forEach((column) => {
    column.type = 'int64'
  })
  waterfall.dataset.rows = [
    ['Opening', '9007199254740992', '0', '9007199254740992', 'start'],
    ['Gain', '1', '9007199254740992', '9007199254740993', 'delta'],
    ['Closing', '9007199254740993', '0', '9007199254740993', 'total'],
  ]
  assert.doesNotThrow(() => validateChartView(waterfall.view, waterfall.dataset))
  waterfall.dataset.rows[1]![1] = '2'
  invalid(() => validateChartView(waterfall.view, waterfall.dataset), /end minus start/)
})

test('stacked coordinates reject cumulative overflow while finite opposite extremes remain valid', () => {
  for (const chart of ['stackedArea', 'stackedBar', 'horizontalStackedBar'] as const) {
    const { view, dataset } = example(chart)
    for (const sign of [1, -1]) {
      dataset.rows[0] = ['A', sign * 1e308, sign * 1e308]
      invalid(() => validateChartView(view, dataset), /coordinates must remain finite/)
    }
    dataset.rows[0] = ['A', 1e308, -1e308]
    assert.doesNotThrow(() => validateChartView(view, dataset))
  }
})

test('precomputed intervals and five-number summaries reject invalid order without repairing rows', () => {
  const histogram = example('histogram')
  histogram.dataset.rows[1]![1] = 0.5
  invalid(() => validateChartView(histogram.view, histogram.dataset), /nonoverlapping/)
  histogram.dataset.rows[1]![1] = 3
  invalid(() => validateChartView(histogram.view, histogram.dataset), /binStart < binEnd/)
  histogram.dataset.rows[1]![1] = 1
  histogram.dataset.rows[1]![3] = -1
  invalid(() => validateChartView(histogram.view, histogram.dataset), /negative/)
  const box = example('boxPlot')
  box.dataset.rows[0]![2] = 3
  invalid(() => validateChartView(box.view, box.dataset), /Five-number summary/)
  box.dataset.rows[0]![3] = null
  invalid(() => validateChartView(box.view, box.dataset), /Five-number summary/)
})

test('percentages use authored fractions and denominators with no renormalization', () => {
  const { view, dataset } = example('stackedBar100')
  dataset.rows[0] = ['A', null, null, 0]
  assert.doesNotThrow(() => validateChartView(view, dataset))
  dataset.rows[0]![1] = 0
  invalid(() => validateChartView(view, dataset), /Zero denominators/)
  dataset.rows[0] = ['A', 0.7, 0.4, 100]
  invalid(() => validateChartView(view, dataset), /exceed one/)
  dataset.rows[0] = ['A', -0.1, 0.4, 100]
  invalid(() => validateChartView(view, dataset), /between zero and one/)
  dataset.rows[0] = ['A', 0.2, 0.4, null]
  invalid(() => validateChartView(view, dataset), /positive denominator/)
  const pie = example('pie')
  pie.dataset.rows[1]![2] = 0.9
  invalid(() => validateChartView(pie.view, pie.dataset), /exceed one/)
  const funnel = example('funnel')
  funnel.dataset.rows[0]![2] = 1
  assert.doesNotThrow(() => validateChartView(funnel.view, funnel.dataset))
})

test('rank and waterfall checks preserve authored order and enforce prepared arithmetic', () => {
  const leaderboard = example('leaderboard')
  leaderboard.dataset.rows[1]![2] = '0'
  invalid(() => validateChartView(leaderboard.view, leaderboard.dataset), /positive safe integer/)
  leaderboard.dataset.rows[0]![2] = '3'
  leaderboard.dataset.rows[1]![2] = '1'
  invalid(() => validateChartView(leaderboard.view, leaderboard.dataset), /already be ordered/)
  for (const [row, col, value, error] of [
    [1, 1, -2, /end minus start/],
    [3, 2, 6, /end minus start/],
    [2, 1, 6, /end equal to value/],
    [1, 4, 'unknown', /Unknown waterfall/],
  ] as const) {
    const waterfall = example('waterfall')
    waterfall.dataset.rows[row]![col] = value
    invalid(() => validateChartView(waterfall.view, waterfall.dataset), error)
  }
})

test('column collection includes special geometry and tooltip fields exactly once', () => {
  const { view } = example('scatter')
  assert.equal(view.chart, 'scatter')
  assert.deepEqual(chartColumns(view), ['other', 'value', 'size', 'category', 'label'])
  assert.deepEqual(chartColumns({ ...view, bindings: { label: 'other' } }), ['other', 'value'])
})

test('exploration offers geometry-only transitions and refuses statistics or invalid scales', () => {
  const { view, dataset } = example('line')
  const original = JSON.stringify(view)
  for (const chart of [
    'bar',
    'horizontalBar',
    'stackedBar',
    'horizontalStackedBar',
    'area',
    'stackedArea',
    'heatmap',
  ] as const) {
    assert.equal(chartTransition(view, chart, dataset)?.chart, chart)
  }
  for (const chart of [
    'sparkline',
    'scatter',
    'histogram',
    'boxPlot',
    'pie',
    'funnel',
    'waterfall',
    'leaderboard',
    'stackedBar100',
  ] as const) {
    assert.equal(chartTransition(view, chart, dataset), undefined)
  }
  assert.equal(
    chartTransition({ ...view, y: ['value'], x: 'other' }, 'scatter', dataset)?.chart,
    'scatter',
  )
  dataset.columns[2]!.unit = 'different'
  assert.equal(chartTransition(view, 'stackedBar', dataset), undefined)
  assert.equal(JSON.stringify(view), original)
  const percent = example('stackedBar100')
  assert.equal(
    chartTransition(percent.view, 'horizontalStackedBar100', percent.dataset)?.bindings
      ?.denominator,
    'denominator',
  )
  const percentagesAsBars = chartTransition(percent.view, 'bar', percent.dataset)!
  assert.equal(percentagesAsBars.bindings, undefined)
  assert.deepEqual(percentagesAsBars.y, percent.view.y)
  assert.equal(percent.dataset.rows[0]![1], 0.2)
  assert.equal(chartTransition(percentagesAsBars, 'stackedBar100', percent.dataset), undefined)
  for (const chart of [
    'histogram',
    'boxPlot',
    'pie',
    'funnel',
    'waterfall',
    'leaderboard',
  ] as const) {
    const prepared = example(chart)
    const bars = chartTransition(prepared.view, 'bar', prepared.dataset)!
    assert.equal(bars.chart, 'bar')
    assert.equal(bars.bindings, undefined)
    assert.deepEqual(bars.y, prepared.view.y)
    assert.equal(chartTransition(bars, chart, prepared.dataset), undefined)
  }
})

test('prepared views validate every referenced dataset in drafts and generated documents', () => {
  const ordinary = example('line')
  const histogram = example('histogram')
  histogram.view.datasetId = 'bins'
  const value = document(ordinary.view, ordinary.dataset)
  value.datasets.push({ id: 'bins', origin: 'computed', sourceIds: [], data: histogram.dataset })
  const block = value.blocks[0]!
  assert.equal(block.kind, 'chart')
  block.preparedViews = [{ id: 'histogram', label: 'Prepared bins', ...histogram.view }]
  assert.doesNotThrow(() => parsePresentationDocument(value))
  const draft = {
    schemaVersion: 1,
    title: value.title,
    sources: [],
    datasets: value.datasets.map((dataset) => ({
      id: dataset.id,
      kind: 'computed',
      path: `${dataset.id}.json`,
      sourceIds: [],
    })),
    blocks: value.blocks,
  }
  assert.doesNotThrow(() => parsePresentationDraft(draft))
  histogram.dataset.rows[0]![1] = 2
  invalid(() => parsePresentationDocument(value), /binStart < binEnd/)
  assert.doesNotThrow(() => parsePresentationDraft(draft))
  block.preparedViews[0]!.datasetId = 'missing'
  invalid(() => parsePresentationDraft(draft), /Unknown dataset/)
  block.preparedViews[0]!.datasetId = 'bins'
  block.preparedViews.push(structuredClone(block.preparedViews[0]!))
  invalid(() => parsePresentationDraft(draft), /Duplicate identifiers/)
})
