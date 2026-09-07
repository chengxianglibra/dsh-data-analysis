import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chartCoordinate,
  domainTicks,
  donutPath,
  drawingDomain,
  drawingScale,
  numericDrawingAxis,
  pointIsDrawable,
  seriesAppearance,
  shareIntervals,
  showValueLabels,
  stackCoordinates,
} from '../../src/client/presentation/chart-geometry.ts'
import type { ChartView, TypedDataset } from '../../src/presentation/contracts/types.ts'

const view: ChartView = {
  datasetId: 'd',
  chart: 'line',
  x: 'x',
  y: ['amount'],
  numericMode: 'approximate',
}

test('drawing coordinates retain missing values and source precision', () => {
  const data: TypedDataset = {
    schemaVersion: 1,
    columns: [{ id: 'amount', label: '金额', type: 'decimal', nullable: true }],
    rows: [['9007199254740993'], ['0.1000'], [null]],
    rowCount: 3,
    limit: 3,
    truncated: false,
  }
  const before = JSON.stringify(data)
  assert.equal(chartCoordinate(data, view, 0, 'amount'), 9007199254740992)
  assert.equal(chartCoordinate(data, view, 1, 'amount'), 0.1)
  assert.equal(chartCoordinate(data, view, 2, 'amount'), null)
  assert.equal(JSON.stringify(data), before)
  assert.throws(() => chartCoordinate(data, { ...view, numericMode: 'exact' }, 0, 'amount'))
})

test('signed stack geometry preserves gaps and precomputed ratio widths', () => {
  assert.deepEqual(stackCoordinates([4, null, 3, -2, -5, 0]), [
    [0, 4],
    null,
    [4, 7],
    [0, -2],
    [-2, -7],
    [7, 7],
  ])
  assert.deepEqual(stackCoordinates([0.6, null, 0.1]), [[0, 0.6], null, [0.6, 0.7]])
  assert.throws(() => stackCoordinates([1e308, 1e308]), /finite drawing coordinate/)
})

test('finite extreme and all-zero domains produce finite geometry without rescaling source values', () => {
  const domain = drawingDomain([-1e308, null, 1e308])
  assert.deepEqual(domain, [-1e308, 1e308])
  const scale = drawingScale(domain, 0, 640)
  assert.equal(scale(-1e308), 0)
  assert.equal(scale(0), 320)
  assert.equal(scale(1e308), 640)
  assert.ok(domainTicks(domain).every(Number.isFinite))
  assert.deepEqual(drawingDomain([null, 0]), [0, 1])
  assert.deepEqual(numericDrawingAxis([-1e308, null, 1e308]), { divisor: 1e308, domain: [-1, 1] })
  assert.deepEqual(numericDrawingAxis([0, 1e-308]), { divisor: 1e-308, domain: [0, 1] })
  assert.deepEqual(numericDrawingAxis([-10, 20]), { divisor: 1, domain: [-10, 20] })
})

test('point display options cannot paint null observations at an implicit zero coordinate', () => {
  assert.equal(pointIsDrawable(null, 10, undefined), false)
  assert.equal(pointIsDrawable(null, 10, 0), false)
  assert.equal(pointIsDrawable(0, 10, 0), true)
  assert.equal(pointIsDrawable(5, 10, Number.NaN), false)
})

test('pie angles keep authored shares and filtered slices leave their original gaps', () => {
  const intervals = shareIntervals([0.25, 0.5, null, 0.125])
  assert.deepEqual(intervals, [
    { start: 0, end: 0.25 },
    { start: 0.25, end: 0.75 },
    null,
    { start: 0.75, end: 0.875 },
  ])
  const filtered = intervals.filter((_, index) => index === 1)
  assert.deepEqual(filtered, [{ start: 0.25, end: 0.75 }])
  assert.equal(donutPath(0, 0, 100, 100), '')
  assert.equal((donutPath(0, 1, 100, 100).match(/ A /g) ?? []).length, 4)
  assert.doesNotMatch(donutPath(0, 1, 100, 100), /NaN|Infinity/)
})

test('line roles require explicit authoring and explicit stroke style wins', () => {
  assert.equal(seriesAppearance(view, 'amount', 0).lineStyle, 'solid')
  assert.equal(
    seriesAppearance(
      { ...view, options: { series: { amount: { role: 'forecast' } } } },
      'amount',
      0,
    ).dash,
    '5 5',
  )
  assert.equal(
    seriesAppearance(
      { ...view, options: { series: { amount: { role: 'target', lineStyle: 'solid' } } } },
      'amount',
      0,
    ).dash,
    undefined,
  )
  assert.equal(
    seriesAppearance(
      { ...view, options: { series: { amount: { lineStyle: 'dotted' } } } },
      'amount',
      0,
    ).dash,
    '2 4',
  )
  assert.equal(showValueLabels(view, 1), false)
  assert.equal(showValueLabels({ ...view, options: { valueLabels: 'auto' } }, 12), true)
  assert.equal(showValueLabels({ ...view, options: { valueLabels: 'auto' } }, 13), false)
  assert.equal(showValueLabels({ ...view, options: { valueLabels: 'all' } }, 5000), true)
})
