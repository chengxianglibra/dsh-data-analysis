import assert from 'node:assert/strict'
import test from 'node:test'
import { seriesAppearance } from '../../src/client/presentation/chart-geometry.ts'
import {
  changeChartView,
  chartViewError,
  exploredChartBlock,
  initialChartExploration,
  savedChartView,
  withChartSeries,
  withChartSeriesStyle,
  withChartX,
} from '../../src/client/presentation/chart-view.ts'
import { type ChartBlock, followUpContext } from '../../src/client/presentation/model.ts'
import { type ChartView, chartTransition } from '../../src/presentation/contracts/charts.ts'
import type { PresentationDocument, TypedDataset } from '../../src/presentation/contracts/types.ts'

const data: TypedDataset = {
  schemaVersion: 1,
  columns: [
    { id: 'category', label: '分类', type: 'string', nullable: true },
    { id: 'segment', label: '分组', type: 'string', nullable: false },
    { id: 'actual', label: '实际值', type: 'decimal', nullable: true, unit: 'CNY' },
    { id: 'plan', label: '计划值', type: 'decimal', nullable: true, unit: 'CNY' },
  ],
  rows: [
    ['A', 'north', '9007199254740993', '1'],
    ['A', 'south', null, '2'],
    ['', 'north', '0.1000', '3'],
    [null, 'north', '4', '4'],
  ],
  rowCount: 4,
  limit: 4,
  truncated: false,
}
const block: ChartBlock = {
  id: 'chart',
  kind: 'chart',
  datasetId: 'd',
  chart: 'line',
  x: 'category',
  y: ['actual', 'plan'],
  numericMode: 'approximate',
  options: {
    series: {
      actual: { role: 'actual', lineStyle: 'solid' },
      plan: { role: 'plan', lineStyle: 'dashed' },
    },
  },
}

test('chart state changes and reset do not modify authored view or share nested options', () => {
  const before = JSON.stringify(block)
  const initial = initialChartExploration(block)
  initial.view.options!.series!.actual!.lineStyle = 'dotted'
  const state = { ...initial, hidden: ['actual'] }
  const next = changeChartView(state, withChartSeries(state.view, ['plan']))
  assert.deepEqual(next.hidden, [])
  assert.deepEqual(Object.keys(next.view.options!.series!), ['plan'])
  assert.equal(chartViewError(next.view, data), undefined)
  assert.equal(exploredChartBlock(block, next).id, block.id)
  assert.deepEqual(initialChartExploration(block).view.options, block.options)
  assert.equal(JSON.stringify(block), before)
  const prepared = changeChartView(state, { ...state.view, datasetId: 'other' }, 'prepared')
  assert.deepEqual(prepared.hidden, [])
  assert.equal(prepared.preparedViewId, 'prepared')
})

test('changing field bindings clears authored reference lines while style changes preserve them', () => {
  const view = {
    ...initialChartExploration(block).view,
    options: {
      ...block.options,
      referenceLines: [{ axis: 'y' as const, value: 100, label: '收入目标' }],
    },
  }
  const before = JSON.stringify(view)
  assert.equal(withChartSeries(view, ['actual']).options?.referenceLines, undefined)
  assert.equal(withChartX(view, 'segment').options?.referenceLines, undefined)
  assert.deepEqual(
    withChartSeries(view, [...view.y]).options?.referenceLines,
    view.options.referenceLines,
  )
  assert.deepEqual(withChartX(view, view.x).options?.referenceLines, view.options.referenceLines)
  assert.deepEqual(
    withChartSeriesStyle(view, 'actual', 'role', 'forecast').options?.referenceLines,
    view.options.referenceLines,
  )
  assert.equal(JSON.stringify(view), before)
})

test('default role and line style remove their own declarations and restore rendering defaults', () => {
  const original = initialChartExploration(block).view
  const styled = withChartSeriesStyle(original, 'actual', 'role', 'forecast')
  assert.equal(seriesAppearance(styled, 'actual', 0).color, 'var(--pr-chart-muted)')
  const cleared = withChartSeriesStyle(styled, 'actual', 'role', undefined)
  assert.equal(Object.hasOwn(cleared.options!.series!.actual!, 'role'), false)
  assert.equal(seriesAppearance(cleared, 'actual', 0).color, 'var(--pr-chart-1)')
  assert.equal(cleared.options!.series!.actual!.lineStyle, 'solid')
  const noStyle = withChartSeriesStyle(cleared, 'actual', 'lineStyle', undefined)
  assert.equal(Object.hasOwn(noStyle.options!.series!, 'actual'), false)
  assert.equal(seriesAppearance(noStyle, 'actual', 0).dash, undefined)
  assert.equal(original.options!.series!.actual!.role, 'actual')
})

test('series styles treat constructor and __proto__ as own column IDs without mutating prototypes', () => {
  for (const field of ['constructor', '__proto__']) {
    const original: ChartView = {
      ...initialChartExploration(block).view,
      y: [field],
      options: undefined,
    }
    const styled: ChartView = withChartSeriesStyle(original, field, 'role', 'forecast')
    assert.equal(Object.hasOwn(styled.options!.series!, field), true)
    assert.equal(Object.getPrototypeOf(styled.options!.series!), Object.prototype)
    assert.equal(seriesAppearance(styled, field, 0).dash, '5 5')
    const cleared: ChartView = withChartSeriesStyle(styled, field, 'role', undefined)
    assert.equal(cleared.options, undefined)
    assert.equal(seriesAppearance(cleared, field, 0).color, 'var(--pr-chart-1)')
    assert.equal(original.options, undefined)
    assert.equal(Object.hasOwn(Object.prototype, 'role'), false)
  }
})

test('exploration switches only compatible prepared geometry, without calculating statistics', () => {
  const initial = initialChartExploration(block).view
  assert.equal(chartTransition(initial, 'bar', data)?.chart, 'bar')
  assert.equal(chartTransition(initial, 'stackedArea', data)?.chart, 'stackedArea')
  assert.equal(chartTransition(initial, 'stackedBar100', data), undefined)
  assert.equal(chartTransition(initial, 'histogram', data), undefined)
  assert.equal(chartTransition(initial, 'boxPlot', data), undefined)
  assert.equal(chartTransition(initial, 'sparkline', data), undefined)
  assert.match(chartViewError({ ...initial, numericMode: 'exact' }, data)!, /Exact chart encoding/)
  const ratioData: TypedDataset = {
    ...data,
    columns: [
      { id: 'category', label: '分类', type: 'string', nullable: false },
      ...['a', 'b', 'denominator'].map((id) => ({
        id,
        label: id,
        type: 'float64' as const,
        nullable: false,
      })),
    ],
    rows: [
      ['A', 0.25, 0.75, 200],
      ['B', 0.4, 0.6, 100],
    ],
    rowCount: 2,
  }
  const ratio: ChartBlock = {
    ...block,
    chart: 'stackedBar100',
    y: ['a', 'b'],
    bindings: { denominator: 'denominator' },
    options: undefined,
    numericMode: 'exact',
  }
  const snapshot = JSON.stringify(ratioData)
  const selected = [0]
  assert.deepEqual(selected, [0])
  assert.deepEqual(ratioData.rows[selected[0]!], ['A', 0.25, 0.75, 200])
  assert.equal(
    chartTransition(ratio, 'horizontalStackedBar100', ratioData)?.chart,
    'horizontalStackedBar100',
  )
  assert.equal(JSON.stringify(ratioData), snapshot)
})

test('copy context distinguishes current view, hidden series, filters and saved identity/source', () => {
  const document: PresentationDocument = {
    schemaVersion: 2,
    title: '报告',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    generatedAt: '2026-09-07T00:00:00Z',
    blocks: [block],
    datasets: [
      { id: 'd', origin: 'computed', sourceIds: ['original'], data },
      { id: 'prepared', origin: 'computed', sourceIds: ['derived'], data },
    ],
    sources: ['original', 'derived'].map((id) => ({
      id,
      status: 'available',
      label: id,
      facts: [],
      ref: { sessionId: 'session', artifactRef: id },
    })),
    diagnostics: [],
  }
  const state = {
    ...initialChartExploration(block),
    view: { ...initialChartExploration(block).view, datasetId: 'prepared' },
    hidden: ['plan'],
    preparedViewId: 'ready',
  }
  const copy = followUpContext(document, block, state)
  assert.match(copy, /Build ID: build/)
  assert.match(copy, /Workspace: workspace/)
  assert.match(copy, /Saved chart binding:/)
  assert.match(copy, /Current chart binding:.*"datasetId":"prepared"/)
  assert.match(copy, /page-local exploration/)
  assert.match(copy, /Hidden series: \["plan"\]/)
  assert.match(copy, /Saved source original:/)
  assert.match(copy, /来源 derived:/)
  assert.doesNotMatch(copy, /9007199254740993/)
})

test('prepared view labels and IDs never become editable chart configuration', () => {
  const prepared = savedChartView({ ...block, id: 'prepared', label: '预备视图标题' })
  assert.deepEqual(prepared, initialChartExploration(block).view)
  assert.equal(Object.hasOwn(prepared, 'label'), false)
  assert.equal(Object.hasOwn(prepared, 'id'), false)
})
