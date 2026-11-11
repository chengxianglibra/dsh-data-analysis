import assert from 'node:assert/strict'
import test from 'node:test'
import { datasetChartModel } from '../../src/client/analysis-ui/charts/dataset-model.ts'
import { axisOf, groupRows, ticksOf } from '../../src/client/analysis-ui/charts/model.ts'
import {
  datasetViewSchema,
  resolveDatasetView,
} from '../../src/presentation/contracts/dataset-view.ts'
import type { FrameView } from '../../src/presentation/contracts/frame-view.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('Dataset defaults and metrics retain the existing complete-single-row contract without classification', () => {
  const scalar = datasetSnapshot(
    [['saved']],
    [{ id: 'text', label: 'Text', type: 'string', nullable: false }],
  )
  assert.deepEqual(resolveDatasetView(scalar), {
    ok: true,
    view: { chart: 'metric', values: ['text'] },
  })
  assert.deepEqual(resolveDatasetView(datasetSnapshot()).ok, true)
  const resolution = resolveDatasetView(datasetSnapshot([['A', '3.00']]), {
    chart: 'metric',
    encoding: { value: 'value' },
  })
  assert.deepEqual(resolution, { ok: true, view: { chart: 'metric', values: ['value'] } })
  assert.deepEqual(resolveDatasetView(datasetSnapshot()), {
    ok: true,
    view: { chart: 'table', columns: ['category', 'value'] },
  })
  assert.equal(resolveDatasetView(scalar, { chart: 'table', columns: ['missing'] }).ok, false)
  assert.equal(
    resolveDatasetView(datasetSnapshot(), { chart: 'metric', encoding: { value: 'value' } }).ok,
    false,
  )
})

test('Dataset line, area and bar require explicit column mappings and preserve typed rows', () => {
  const snapshot = datasetSnapshot()
  for (const chart of ['line', 'area', 'bar'] as const) {
    const view = { chart, encoding: { axis: 'category', values: ['value'] } }
    assert.equal(datasetViewSchema.safeParse(view).success, true)
    assert.deepEqual(resolveDatasetView(snapshot, view), {
      ok: true,
      view: { chart, axis: 'category', values: ['value'], series: undefined, broadcast: [] },
    })
    assert.equal(datasetViewSchema.safeParse({ chart }).success, false)
    assert.equal(resolveDatasetView(snapshot, { chart }).ok, false)
  }
  const model = datasetChartModel(snapshot.data, ['category'])
  assert.equal(model.data, snapshot.data)
  assert.deepEqual(
    ticksOf(model, model.axes[0]!).ticks.map((t) => t.label),
    ['A', 'B', 'C'],
  )
  assert.equal(snapshot.data.rows[0]![1], '12345678901234.5678')
  assert.equal(snapshot.data.rows[1]![1], null)
})

test('Dataset validates numeric values, complete coverage, unique keys and supported charts', () => {
  const valid = { chart: 'line', encoding: { axis: 'category', values: ['value'] } } as const
  const check = (view: FrameView, code: string, snapshot = datasetSnapshot()) => {
    const result = resolveDatasetView(snapshot, view)
    assert(!result.ok)
    assert.equal(result.code, code)
    assert.match(result.path, /^\/view/)
  }
  check({ chart: 'line', encoding: { axis: 'absent', values: ['value'] } }, 'view-name-unknown')
  check(
    { chart: 'line', encoding: { axis: 'category', values: ['category'] } },
    'view-dtype-not-drawable',
  )
  check(
    { chart: 'line', encoding: { axis: 'category', values: ['value', 'value'] } },
    'view-target-ambiguous',
  )
  check(
    { ...valid, encoding: { ...valid.encoding, values: ['value'] } },
    'view-requires-complete-snapshot',
    datasetSnapshot(undefined, undefined, false),
  )
  check({ chart: 'comparison' }, 'view-unsupported-for-snapshot')
  check({ chart: 'decomposition' }, 'view-unsupported-for-snapshot')
  check(
    { chart: 'line', encoding: { axis: 'category', values: ['value'] } },
    'view-dtype-not-drawable',
    datasetSnapshot([['A', '1e1000']]),
  )
  check(
    { chart: 'bar', encoding: { axis: 'category', values: ['value'] } },
    'view-target-ambiguous',
    datasetSnapshot([
      ['A', '1'],
      ['A', '2'],
    ]),
  )
})

test('series mappings use raw typed identities and keep the first saved appearance order', () => {
  const columns = [
    { id: 'day', label: 'Day', type: 'date', nullable: false },
    { id: 'series', label: 'Series', type: 'int64', nullable: false },
    { id: 'value', label: 'Value', type: 'decimal', nullable: true },
  ] as const
  const snapshot = datasetSnapshot(
    [
      ['2026-11-02', '9007199254740993', '1.00'],
      ['2026-11-01', '9007199254740992', '2.00'],
      ['2026-11-01', '9007199254740993', null],
    ],
    [...columns],
  )
  const view: FrameView = {
    chart: 'line',
    encoding: { axis: 'day', values: ['value'], series: 'series' },
  }
  assert.equal(resolveDatasetView(snapshot, view).ok, true)
  const model = datasetChartModel(snapshot.data, ['day', 'series'])
  assert.deepEqual(
    ticksOf(model, axisOf(model, 'day')!).ticks.map((t) => t.label),
    ['2026-11-02', '2026-11-01'],
  )
  assert.equal(groupRows(model, [axisOf(model, 'series')!]).length, 2)
  snapshot.data.rows.push([...snapshot.data.rows[0]!])
  assert.equal(resolveDatasetView(snapshot, view).ok, false)
})

test('heatmap requires numeric saved values and a unique cell per pair, retaining sparse cells', () => {
  const columns = [
    { id: 'x', label: 'X', type: 'int64', nullable: false },
    { id: 'y', label: 'Y', type: 'string', nullable: false },
    { id: 'value', label: 'Value', type: 'decimal', nullable: true },
  ] as const
  const snapshot = datasetSnapshot(
    [
      ['9007199254740993', 'A', '1.20'],
      ['9007199254740992', 'B', null],
    ],
    [...columns],
  )
  const view: FrameView = { chart: 'heatmap', encoding: { x: 'x', y: 'y', value: 'value' } }
  assert.deepEqual(resolveDatasetView(snapshot, view), {
    ok: true,
    view: { chart: 'heatmap', x: 'x', y: 'y', value: 'value' },
  })
  const badAxis = resolveDatasetView(snapshot, {
    chart: 'heatmap',
    encoding: { x: 'x', y: 'x', value: 'value' },
  })
  assert(!badAxis.ok)
  assert.equal(badAxis.path, '/view/encoding/y')
  assert.deepEqual(badAxis.candidates, ['y', 'value'])
  const badValue = resolveDatasetView(snapshot, {
    chart: 'heatmap',
    encoding: { x: 'x', y: 'y', value: 'y' },
  })
  assert(!badValue.ok)
  assert.equal(badValue.path, '/view/encoding/value')
  assert.deepEqual(badValue.candidates, ['x', 'value'])
  snapshot.data.rows.push([...snapshot.data.rows[0]!])
  assert.equal(resolveDatasetView(snapshot, view).ok, false)
})

test('Dataset drawing bounds reject excessive series and sparse Cartesian grids', () => {
  const snapshot = datasetSnapshot(
    Array.from({ length: 320 }, (_, i) => [`x${i}`, `y${i}`, i]),
    [
      { id: 'x', label: 'X', type: 'string', nullable: false },
      { id: 'y', label: 'Y', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'float64', nullable: false },
    ],
  )
  for (const view of [
    { chart: 'bar', encoding: { axis: 'x', values: ['value'], series: 'y' } },
    { chart: 'heatmap', encoding: { x: 'x', y: 'y', value: 'value' } },
  ] satisfies FrameView[]) {
    const result = resolveDatasetView(snapshot, view)
    assert(!result.ok)
    assert.equal(result.code, 'view-budget')
  }
})

test('shared chart lookup retains Frame token precedence over an earlier matching display name', () => {
  const model = datasetChartModel(datasetSnapshot().data, ['category', 'value'])
  model.axes[0]!.name = 'value'
  assert.equal(axisOf(model, 'value')?.id, 'value')
})
