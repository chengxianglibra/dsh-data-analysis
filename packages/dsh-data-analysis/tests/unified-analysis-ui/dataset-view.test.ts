import assert from 'node:assert/strict'
import test from 'node:test'
import { datasetChartModel } from '../../src/client/analysis-ui/charts/dataset-model.ts'
import { axisOf, groupRows, ticksOf } from '../../src/client/analysis-ui/charts/model.ts'
import {
  AnalysisViewError,
  validateAnalysisResources,
} from '../../src/presentation/contracts/analysis-document.ts'
import {
  datasetDisplayIssue,
  datasetDisplaySchema,
  datasetViewSchema,
  resolveDatasetView,
} from '../../src/presentation/contracts/dataset-view.ts'
import type { FrameView } from '../../src/presentation/contracts/frame-view.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('line overlay accepts unknown units and rejects conflicting units or formats', () => {
  const snapshot = datasetSnapshot(
    [['A', 1, 2]],
    [
      { id: 'x', label: 'x', type: 'string', nullable: false },
      { id: 'a', label: 'a', type: 'float64', nullable: false },
      { id: 'b', label: 'b', type: 'float64', nullable: false },
    ],
  )
  const resolved = resolveDatasetView(snapshot, {
    chart: 'line',
    encoding: { axis: 'x', values: ['a', 'b'] },
  })
  assert.ok(resolved.ok)
  const display = { seriesLayout: 'overlay' as const }
  assert.equal(datasetDisplayIssue(snapshot, display, resolved.view), undefined)
  snapshot.data.columns[1]!.unit = 'USD'
  snapshot.data.columns[2]!.unit = 'EUR'
  assert.equal(datasetDisplayIssue(snapshot, display, resolved.view)?.path, '/display/seriesLayout')
  delete snapshot.data.columns[2]!.unit
  assert.equal(
    datasetDisplayIssue(
      snapshot,
      { ...display, formats: [{ value: 'a', format: 'percent' }] },
      resolved.view,
    )?.path,
    '/display/seriesLayout',
  )
  assert.equal(
    datasetDisplayIssue(snapshot, display, { chart: 'table', columns: ['x'] })?.path,
    '/display/seriesLayout',
  )
})

test('datetime tick formatting preserves distinct coordinates and exact tooltip labels', () => {
  const source = ['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00']
  const snapshot = datasetSnapshot(
    source.map((value) => [value, 1]),
    [
      { id: 'when', label: 'When', type: 'datetime', nullable: false },
      { id: 'value', label: 'Value', type: 'float64', nullable: false },
    ],
  )
  const model = datasetChartModel(snapshot.data, ['when'], undefined, undefined, 'en-US', {
    tickFormat: 'date-time',
    showTimezone: false,
  })
  const axis = axisOf(model, 'when')!
  const { ticks, tickOf } = ticksOf(model, axis)
  assert.deepEqual(
    ticks.map((tick) => tick.label),
    ['2026-11-01 01:30', '2026-11-01 01:30'],
  )
  assert.deepEqual(
    ticks.map((tick) => tick.title),
    source,
  )
  assert.notEqual(tickOf(0), tickOf(1))
  assert.deepEqual(
    snapshot.data.rows.map((row) => row[0]),
    source,
  )
})

test('Dataset display admits numeric column formats and reports invalid references on save', () => {
  const snapshot = datasetSnapshot()
  const display = {
    title: 'Families',
    subtitle: 'Share',
    formats: [{ value: 'value', format: 'percent', decimals: 1 }],
  }
  const parsed = datasetDisplaySchema.parse(display)
  assert.equal(datasetDisplayIssue(snapshot, parsed), undefined)
  assert.equal(
    datasetDisplaySchema.safeParse({
      ...display,
      formats: [{ value: 'value', format: 'percent', decimals: 7 }],
    }).success,
    false,
  )
  const resources = {
    data: {
      kind: 'snapshot' as const,
      declaration: { kind: 'dataset-snapshot' as const, snapshotRef: 'data' },
      snapshot,
      binding: {
        workspaceId: 'workspace',
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
  }
  const program = (value: string) =>
    `root = DatasetView("data", {chart:"table"}, {title:"Families", formats:[{value:"${value}", format:"percent", decimals:1}]});`
  assert.doesNotThrow(() => validateAnalysisResources(program('value'), resources))
  for (const value of ['category', 'missing']) {
    assert.throws(
      () => validateAnalysisResources(program(value), resources),
      (error) => {
        assert(error instanceof AnalysisViewError)
        assert.equal(error.path, 'root/display/formats/0/value')
        assert.deepEqual(error.details.candidates, ['value'])
        return true
      },
    )
  }
  assert.equal(
    datasetDisplayIssue(snapshot, { formats: [parsed.formats![0]!, parsed.formats![0]!] })?.path,
    '/display/formats/1/value',
  )
})

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

test('Dataset charts accept more than eight series while heatmap grids remain bounded', () => {
  const snapshot = datasetSnapshot(
    Array.from({ length: 320 }, (_, i) => [`x${i}`, `y${i}`, i]),
    [
      { id: 'x', label: 'X', type: 'string', nullable: false },
      { id: 'y', label: 'Y', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'float64', nullable: false },
    ],
  )
  for (const chart of ['line', 'area', 'bar'] as const) {
    const view = { chart, encoding: { axis: 'x', values: ['value'], series: 'y' } }
    assert.equal(resolveDatasetView(snapshot, view).ok, true)
  }
  const model = datasetChartModel(snapshot.data, ['x', 'y'])
  assert.equal(groupRows(model, [axisOf(model, 'y')!]).length, 320)
  const view: FrameView = { chart: 'heatmap', encoding: { x: 'x', y: 'y', value: 'value' } }
  const result = resolveDatasetView(snapshot, view)
  assert(!result.ok)
  assert.equal(result.code, 'view-budget')
})

test('shared chart lookup retains Frame token precedence over an earlier matching display name', () => {
  const model = datasetChartModel(datasetSnapshot().data, ['category', 'value'])
  model.axes[0]!.name = 'value'
  assert.equal(axisOf(model, 'value')?.id, 'value')
})
