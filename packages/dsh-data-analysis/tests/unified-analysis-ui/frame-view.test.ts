import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  type FrameView,
  type FrameViewResolution,
  resolveFrameView,
} from '../../src/presentation/contracts/frame-view.ts'
import {
  type AnalysisSnapshot,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import { frameSnapshot } from './fixtures.ts'
import * as f from './frame-fixtures.ts'
import { comparedSinglePeriodMultiGroup } from './frame-render-fixtures.ts'

function resolved(snapshot: AnalysisSnapshot, view?: FrameView) {
  const result = resolveFrameView(snapshot, view)
  if (!result.ok) throw new Error(`unexpected ${result.code} at ${result.path}`)
  return result
}
const viewOf = (snapshot: AnalysisSnapshot, view?: FrameView) => resolved(snapshot, view).view
const failure = (snapshot: AnalysisSnapshot, view: FrameView) => {
  const result: FrameViewResolution = resolveFrameView(snapshot, view)
  assert.equal(result.ok, false, JSON.stringify(result))
  return result.ok ? undefined : { code: result.code, path: result.path }
}
const ambiguity = (snapshot: AnalysisSnapshot, view: FrameView) => {
  const result: FrameViewResolution = resolveFrameView(snapshot, view)
  assert.equal(result.ok, false, JSON.stringify(result))
  return result.ok ? undefined : result
}
const kindOf = (snapshot: AnalysisSnapshot) => {
  const { classification } = resolved(snapshot)
  return `${classification.class}/${classification.shape}`
}

test('every design operation classifies by final facts into class and shape', () => {
  const cases: [string, AnalysisSnapshot, string][] = [
    ['observe scalar', f.observeScalar(), 'observation/scalar'],
    ['observe time', f.observeTime(6), 'observation/time'],
    ['observe category', f.observeCategory(3), 'observation/category'],
    ['observe time x category', f.observeTimeCategory(3), 'observation/time-category'],
    ['observe matrix', f.observeMatrix(), 'observation/matrix'],
    ['reduce', f.reduceByMonth(), 'observation/time'],
    ['over', f.overBroadcast(), 'observation/time'],
    ['correlate by', f.correlate(true), 'correlation/category'],
    ['correlate', f.correlate(false, 'spearman'), 'correlation/scalar'],
    ['share', f.shareByRegion(), 'observation/category'],
    ['align', f.align(f.categoryAxis(3)), 'alignment/category'],
    ['align paired', f.align(f.pairedAxis()), 'alignment/paired-time'],
    ['compare calendar', f.compareCalendar(), 'comparison/time'],
    ['compare ordinary', f.compareOrdinary([f.categoryAxis(3)]), 'comparison/category'],
    ['attribute additive', f.attributeAdditive(), 'decomposition/category'],
    ['attribute effects', f.attributeEffects(), 'decomposition/category'],
    ['attribute share', f.attributeShare(), 'decomposition/category'],
    ['attribute change', f.attributeChange(), 'decomposition/time'],
    ['where restricted', f.whereRestricted(), 'observation/category'],
    ['members', f.members(), 'members/category'],
    ['records', f.records(), 'observation/records'],
  ]
  for (const [name, snapshot, expected] of cases) assert.equal(kindOf(snapshot), expected, name)
})

test('classification order: members, decomposition, comparison, alignment, correlation', () => {
  // A comparison whose groups carry no values is not a comparison.
  const empty = f.frame({
    axes: [f.timeAxis(3)],
    values: [f.value('sales', 3)],
    comparisons: [f.comparisonOf(f.calendarBinding(), [{ name: 'sales', values: [] }])],
  })
  assert.equal(kindOf(empty), 'observation/time')
  // attributeChange keeps a comparison fact, but decomposition wins.
  assert.equal(resolved(f.attributeChange()).classification.class, 'decomposition')
  // Correlation needs a coefficient; pair_count alone is a statistic.
  const counts = f.frame({
    values: [
      {
        name: 'n_pairs',
        type: 'int64',
        values: ['3'],
        context: f.pairStatistic('pair_count', []),
      },
    ],
  })
  assert.equal(resolved(counts).classification.class, 'observation')
  assert.deepEqual(resolved(counts).classification.symbols, { n_pairs: 'n' })
})

test('shapes: records, paired-time and other take precedence or fill the rest', () => {
  const wide = f.frame({
    axes: [f.categoryAxis(2, 'identity')],
    values: f.labels('m', 7).map((name) => f.value(name, 2)),
  })
  assert.equal(kindOf(wide), 'observation/records')
  const narrow = f.frame({
    axes: [f.categoryAxis(2, 'identity')],
    values: f.labels('m', 6).map((name) => f.value(name, 2)),
  })
  assert.equal(kindOf(narrow), 'observation/category')
  const paired = f.frame({ axes: [f.pairedAxis()], values: [f.value('x', 3)] })
  assert.equal(kindOf(paired), 'observation/paired-time')
  assert.equal(viewOf(paired).chart, 'table')
  const three = f.frame({
    axes: [
      { name: 'a', keys: ['1', '2'] },
      { name: 'b', keys: ['1', '2'] },
      { name: 'c', keys: ['1', '2'] },
    ],
    values: [f.value('x', 2)],
  })
  assert.equal(kindOf(three), 'observation/other')
  assert.equal(viewOf(three).chart, 'table')
  const twoTimes = f.frame({
    axes: [f.timeAxis(2), { ...f.timeAxis(2), name: 'week' }],
    values: [f.value('x', 2)],
  })
  assert.equal(kindOf(twoTimes), 'observation/other')
})

test('statistic modifiers: broadcast values and symbols', () => {
  const reduce = resolved(f.reduceByMonth())
  assert.deepEqual(reduce.classification.symbols, { total: 'Σ', average: 'μ', rows: '#' })
  assert.deepEqual(reduce.classification.broadcastValues, [])
  const over = resolved(f.overBroadcast())
  assert.deepEqual(over.classification.broadcastValues, ['mean_revenue'])
  assert.deepEqual(over.classification.symbols, { mean_revenue: 'μ' })
  // One drawn value plus a reference line: a short time series stays a bar.
  assert.deepEqual(over.view, {
    chart: 'bar',
    axis: 't_month',
    values: ['revenue'],
    broadcast: ['mean_revenue'],
  })
  const correlate = resolved(f.correlate(true))
  assert.deepEqual(correlate.classification.symbols, { n_pairs: 'n' })
  assert.deepEqual(correlate.classification.broadcastValues, [])
})

test('observation auto: scalar metric, up to four values', () => {
  assert.deepEqual(viewOf(f.observeScalar(4)), {
    chart: 'metric',
    values: ['m0', 'm1', 'm2', 'm3'],
  })
  assert.equal(viewOf(f.observeScalar(5)).chart, 'table')
})

test('observation auto: time series bar, line and interval bar thresholds', () => {
  assert.equal(viewOf(f.observeTime(12)).chart, 'bar')
  assert.equal(viewOf(f.observeTime(13)).chart, 'line')
  assert.equal(viewOf(f.observeTime(12, 2)).chart, 'line')
  assert.deepEqual(viewOf(f.observeTime(3, 2, f.interval)), {
    chart: 'interval-bar',
    axis: 't_month',
    values: ['m0', 'm1'],
    broadcast: [],
  })
  // read_periods counts empty periods too: 12 rows over 13 periods is a line.
  const sparse = f.frame({
    axes: [f.timeAxis(12)],
    values: [f.value('m0', 12)],
    periods: f.axisPeriods('month', 13, 12),
  })
  assert.equal(viewOf(sparse).chart, 'line')
  // Non-drawable values only: no chart.
  const text = f.frame({
    axes: [f.timeAxis(3)],
    values: [{ name: 'note', type: 'string', values: ['a', 'b', 'c'] }],
  })
  assert.equal(viewOf(text).chart, 'table')
})

test('observation auto: category hbar up to 30 complete rows', () => {
  assert.deepEqual(viewOf(f.observeCategory(30)), {
    chart: 'hbar',
    axis: 't_region',
    values: ['revenue'],
    broadcast: [],
  })
  assert.equal(viewOf(f.observeCategory(31)).chart, 'table')
  assert.equal(viewOf(f.observeCategory(3, 10)).chart, 'table')
})

test('observation auto: time x category series, heatmap and matrix', () => {
  assert.deepEqual(viewOf(f.observeTimeCategory(8)), {
    chart: 'line',
    axis: 't_month',
    series: 't_region',
    values: ['m0'],
    broadcast: [],
  })
  assert.deepEqual(viewOf(f.observeTimeCategory(9)), {
    chart: 'heatmap',
    x: 't_month',
    y: 't_region',
    value: 'm0',
  })
  assert.equal(viewOf(f.observeTimeCategory(9, 2)).chart, 'table')
  assert.deepEqual(viewOf(f.observeMatrix()), {
    chart: 'heatmap',
    x: 't_region',
    y: 't_channel',
    value: 'm0',
  })
  assert.equal(viewOf(f.observeMatrix(2)).chart, 'table')
  assert.equal(viewOf(f.records()).chart, 'table')
})

test('share values use the 0-100% track on complete scalar or category Frames', () => {
  assert.deepEqual(viewOf(f.shareByRegion()), {
    chart: 'share',
    values: ['revenue_share'],
    axis: 't_region',
  })
  assert.equal(viewOf(f.shareByRegion(3, 5)).chart, 'table')
  const scalar = f.frame({
    values: [{ name: 'share', values: [0.4], context: f.shareOf([]) }],
  })
  assert.deepEqual(viewOf(scalar), { chart: 'share', values: ['share'] })
  // Outside scalar/category a share value is an ordinary primary value.
  const timed = f.frame({
    axes: [f.timeAxis(3)],
    values: [{ name: 'share', values: [0.1, 0.2, 0.3], context: f.shareOf(f.axisGroups('month')) }],
  })
  assert.equal(viewOf(timed).chart, 'bar')
})

test('comparison auto follows the shape', () => {
  const style = (snapshot: AnalysisSnapshot) => {
    const view = viewOf(snapshot)
    assert.equal(view.chart, 'comparison')
    return view.chart === 'comparison' ? view.style : undefined
  }
  assert.equal(style(f.compareOrdinary([])), 'numbers')
  assert.equal(style(f.compareCalendar()), 'line')
  assert.equal(style(f.compareOrdinary([f.categoryAxis(3)])), 'dumbbell')
  const grid = (categories: number) =>
    f.compareOrdinary([
      { ...f.timeAxis(2), keys: f.repeat(f.months(2), categories) },
      { ...f.categoryAxis(categories), keys: f.cycle(f.labels('r', categories), 2) },
    ])
  assert.equal(style(grid(8)), 'small-multiples')
  assert.equal(style(grid(9)), 'table')
  const matrix = f.compareOrdinary([
    { name: 'region', keys: f.repeat(['a', 'b'], 2) },
    { name: 'channel', keys: f.cycle(['x', 'y'], 2) },
  ])
  assert.equal(style(matrix), 'table')
  // Without a baseline column the paired chart cannot be drawn; auto falls back.
  assert.equal(style(f.compareOrdinary([f.categoryAxis(3)], ['current', 'absolute'])), 'table')
  const view = viewOf(f.compareCalendar())
  assert.deepEqual(view, { chart: 'comparison', comparison: 0, group: 'sales', style: 'line' })
  // Only comparison values are primary; the observed `orders` stays in the table.
  assert.deepEqual(resolved(f.compareOrdinary([f.categoryAxis(3)])).classification.primaryValues, [
    'sales',
    'prior.baseline.sales',
    'prior.absolute.sales',
    'prior.relative.sales',
  ])
})

test('single-row multi-group comparisons resolve to one comparison table', () => {
  const multi = comparedSinglePeriodMultiGroup()
  const columns = multi.data.columns.map((column) => column.id)
  assert.deepEqual(viewOf(multi), { chart: 'table', columns, layout: 'comparison' })
  assert.deepEqual(viewOf(multi, { chart: 'comparison' }), {
    chart: 'table',
    columns,
    layout: 'comparison',
  })
  assert.deepEqual(
    viewOf(multi, { chart: 'comparison', encoding: { value: 'prior.relative.orders' } }),
    { chart: 'comparison', comparison: 0, group: 'orders', style: 'numbers' },
  )
  assert.deepEqual(
    viewOf(multi, { chart: 'comparison', encoding: { value: 'sales' }, style: 'delta' }),
    {
      chart: 'comparison',
      comparison: 0,
      group: 'sales',
      style: 'delta',
    },
  )
  assert.deepEqual(viewOf(multi, { chart: 'table' }), {
    chart: 'table',
    columns,
    layout: 'comparison',
  })
  // An explicit column list is still taken literally, without the comparison layout.
  assert.deepEqual(viewOf(multi, { chart: 'table', columns: ['sales'] }), {
    chart: 'table',
    columns: ['sales'],
  })
  // One group on one saved row reads as numbers, not a one-point line.
  assert.deepEqual(viewOf(f.compareCalendar(1)), {
    chart: 'comparison',
    comparison: 0,
    group: 'sales',
    style: 'numbers',
  })
  assert.deepEqual(viewOf(f.compareCalendar(1), { chart: 'comparison', style: 'delta' }), {
    chart: 'comparison',
    comparison: 0,
    group: 'sales',
    style: 'delta',
  })
})

test('explicit comparison: delta style, target lookup and roles', () => {
  const category = f.compareOrdinary([f.categoryAxis(3)])
  assert.deepEqual(viewOf(category, { chart: 'comparison', style: 'delta' }), {
    chart: 'comparison',
    comparison: 0,
    group: 'sales',
    style: 'delta',
  })
  assert.deepEqual(
    failure(f.compareOrdinary([f.categoryAxis(3)], ['current', 'baseline']), {
      chart: 'comparison',
      style: 'delta',
    }),
    { code: 'view-role-missing', path: '/view' },
  )
  assert.deepEqual(
    failure(f.compareOrdinary([f.categoryAxis(3)], ['current', 'absolute']), {
      chart: 'comparison',
    }),
    { code: 'view-role-missing', path: '/view' },
  )
  const two = f.frame({
    axes: [f.categoryAxis(2)],
    values: [...f.comparedValues('sales', 2), ...f.comparedValues('orders', 2)],
    comparisons: [
      f.comparisonOf({ kind: 'ordinary' }, [
        { name: 'sales', values: f.comparedRoles('sales') },
        { name: 'orders', values: f.comparedRoles('orders') },
      ]),
    ],
  })
  assert.deepEqual(failure(two, { chart: 'comparison' }), {
    code: 'view-target-ambiguous',
    path: '/view',
  })
  const candidates = ambiguity(two, { chart: 'comparison' })?.candidates
  assert.ok(candidates)
  assert.ok(candidates.includes('orders'))
  for (const name of [
    'sales',
    'prior.baseline.sales',
    'prior.absolute.sales',
    'prior.relative.sales',
  ])
    assert.ok(candidates.includes(name), name)
  assert.ok(candidates.length <= 8)
  const picked = viewOf(two, { chart: 'comparison', encoding: { value: 'prior.relative.orders' } })
  assert.equal(picked.chart === 'comparison' && picked.group, 'orders')
  assert.deepEqual(failure(two, { chart: 'comparison', encoding: { value: 'missing' } }), {
    code: 'view-name-unknown',
    path: '/view/encoding/value',
  })
  // A data column that belongs to no comparison is not a target, but still lists candidates.
  assert.deepEqual(failure(category, { chart: 'comparison', encoding: { value: 'orders' } }), {
    code: 'view-target-ambiguous',
    path: '/view/encoding/value',
  })
  const unmatchedCandidates = ambiguity(category, {
    chart: 'comparison',
    encoding: { value: 'orders' },
  })?.candidates
  assert.ok(unmatchedCandidates)
  assert.deepEqual(unmatchedCandidates, [
    'sales',
    'prior.baseline.sales',
    'prior.absolute.sales',
    'prior.relative.sales',
  ])
  assert.deepEqual(failure(f.observeCategory(3), { chart: 'comparison' }), {
    code: 'view-target-ambiguous',
    path: '/view',
  })
  const text = f.frame({
    axes: [f.categoryAxis(2)],
    values: [
      { name: 'sales', type: 'string', values: ['a', 'b'] },
      { name: 'prior.baseline.sales', type: 'string', values: ['a', 'b'] },
    ],
    comparisons: [
      f.comparisonOf({ kind: 'ordinary' }, [
        { name: 'sales', values: f.comparedRoles('sales', ['current', 'baseline']) },
      ]),
    ],
  })
  assert.deepEqual(failure(text, { chart: 'comparison' }), {
    code: 'view-dtype-not-drawable',
    path: '/view',
  })
})

test('encoding names must be captured data columns, not only interpretation facts', () => {
  // The comparison fact names all four roles, but a restricted read kept two columns.
  const restricted = f.frame({
    axes: [f.timeAxis(3)],
    values: f.comparedValues('sales', 3, ['current', 'absolute']),
    comparisons: [
      f.comparisonOf(f.calendarBinding(), [{ name: 'sales', values: f.comparedRoles('sales') }]),
    ],
  })
  assert.deepEqual(
    failure(restricted, { chart: 'comparison', encoding: { value: 'prior.baseline.sales' } }),
    { code: 'view-name-unknown', path: '/view/encoding/value' },
  )
  const auto = viewOf(restricted)
  assert.equal(auto.chart === 'comparison' && auto.style, 'table')
  assert.equal(viewOf(restricted, { chart: 'comparison', style: 'delta' }).chart, 'comparison')
})

test('decomposition auto: waterfall, effects and incomplete fallback', () => {
  assert.deepEqual(viewOf(f.attributeAdditive()), {
    chart: 'decomposition',
    decomposition: 0,
    style: 'waterfall',
  })
  assert.deepEqual(viewOf(f.attributeEffects()), {
    chart: 'decomposition',
    decomposition: 0,
    style: 'effects',
  })
  assert.equal(viewOf(f.attributeAdditive({ total: 9 })).chart, 'table')
  // Effects do not read as the whole and stay drawable on partial data.
  const partial = viewOf(f.attributeEffects(9))
  assert.equal(partial.chart === 'decomposition' && partial.style, 'effects')
  // Restricted row scope is a visual encoding, not a fallback.
  assert.equal(viewOf(f.attributeAdditive({ rowScope: 'restricted' })).chart, 'decomposition')
  const contributionOnly = f.frame({
    axes: [f.categoryAxis(2)],
    values: [f.value('contribution', 2)],
    decompositions: [f.decompositionOf([['contribution', 'contribution']])],
  })
  assert.equal(viewOf(contributionOnly).chart, 'table')
  assert.deepEqual(resolved(f.attributeAdditive()).classification.primaryValues, [
    'contribution',
    'total',
    'observed_total',
  ])
})

test('explicit decomposition: share style, roles, ambiguity and completeness', () => {
  assert.deepEqual(viewOf(f.attributeShare(), { chart: 'decomposition', style: 'share' }), {
    chart: 'decomposition',
    decomposition: 0,
    style: 'share',
  })
  assert.deepEqual(failure(f.attributeAdditive(), { chart: 'decomposition', style: 'share' }), {
    code: 'view-role-missing',
    path: '/view/style',
  })
  assert.deepEqual(failure(f.attributeShare(9), { chart: 'decomposition', style: 'share' }), {
    code: 'view-requires-complete-snapshot',
    path: '/view',
  })
  assert.deepEqual(failure(f.attributeAdditive({ total: 9 }), { chart: 'decomposition' }), {
    code: 'view-requires-complete-snapshot',
    path: '/view',
  })
  const contributionOnly = f.frame({
    axes: [f.categoryAxis(2)],
    values: [f.value('contribution', 2)],
    decompositions: [f.decompositionOf([['contribution', 'contribution']])],
  })
  assert.deepEqual(failure(contributionOnly, { chart: 'decomposition' }), {
    code: 'view-role-missing',
    path: '/view',
  })
  const two = f.frame({
    axes: [f.categoryAxis(2)],
    values: ['a', 'b'].flatMap((p) => [f.value(`${p}.contribution`, 2), f.value(`${p}.total`, 2)]),
    decompositions: ['a', 'b'].map((p) =>
      f.decompositionOf([
        ['contribution', `${p}.contribution`],
        ['total', `${p}.total`],
      ]),
    ),
  })
  assert.deepEqual(failure(two, { chart: 'decomposition' }), {
    code: 'view-target-ambiguous',
    path: '/view',
  })
  assert.deepEqual(viewOf(two, { chart: 'decomposition', encoding: { value: 'b.total' } }), {
    chart: 'decomposition',
    decomposition: 1,
    style: 'waterfall',
  })
  assert.deepEqual(failure(f.observeCategory(3), { chart: 'decomposition' }), {
    code: 'view-target-ambiguous',
    path: '/view',
  })
})

test('correlation, alignment and members auto views', () => {
  assert.deepEqual(viewOf(f.correlate(true)), {
    chart: 'correlation',
    values: ['coefficient'],
    counts: { coefficient: 'n_pairs' },
  })
  assert.deepEqual(viewOf(f.align(f.categoryAxis(3))), {
    chart: 'alignment',
    alignment: 0,
    pairs: [
      { left: 'left.revenue', right: 'right.revenue' },
      { left: 'left.orders', right: 'right.orders' },
    ],
    style: 'dumbbell',
  })
  // Values pair only by shared subject; names and order prove nothing.
  assert.deepEqual(viewOf(f.align(f.categoryAxis(3), ['sales.order_count', 'sales.revenue'])), {
    chart: 'alignment',
    alignment: 0,
    pairs: [
      { left: 'left.revenue', right: 'right.orders' },
      { left: 'left.orders', right: 'right.revenue' },
    ],
    style: 'dumbbell',
  })
  const unmatched = viewOf(f.align(f.categoryAxis(3), ['sales.aov', 'sales.margin']))
  assert.deepEqual(unmatched, { chart: 'alignment', alignment: 0, pairs: [], style: 'table' })
  const paired = viewOf(f.align(f.pairedAxis()))
  assert.equal(paired.chart === 'alignment' && paired.style, 'line')
  const timed = viewOf(f.align(f.timeAxis(3)))
  assert.equal(timed.chart === 'alignment' && timed.style, 'table')
  assert.deepEqual(resolved(f.align(f.categoryAxis(3))).classification.primaryValues, [
    'left.revenue',
    'left.orders',
    'right.revenue',
    'right.orders',
  ])
  assert.deepEqual(viewOf(f.members()), { chart: 'members' })
})

test('explicit table, metric and time charts validate names, dtypes and axes', () => {
  const category = f.observeCategory(3)
  assert.deepEqual(viewOf(category, { chart: 'table', columns: ['revenue'] }), {
    chart: 'table',
    columns: ['revenue'],
  })
  assert.deepEqual(failure(category, { chart: 'table', columns: ['revenue', 'nope'] }), {
    code: 'view-name-unknown',
    path: '/view/columns/1',
  })
  assert.deepEqual(failure(category, { chart: 'table', columns: ['revenue', 'revenue'] }), {
    code: 'view-name-unknown',
    path: '/view/columns/1',
  })
  assert.deepEqual(failure(category, { chart: 'metric', encoding: { value: 'revenue' } }), {
    code: 'view-metric-requires-complete-single-row',
    path: '/view',
  })
  assert.deepEqual(failure(f.observeScalar(), { chart: 'metric', encoding: { value: 'x' } }), {
    code: 'view-name-unknown',
    path: '/view/encoding/value',
  })
  assert.deepEqual(viewOf(f.observeScalar(), { chart: 'metric' }), {
    chart: 'metric',
    values: ['m0'],
  })
  assert.deepEqual(failure(category, { chart: 'line' }), {
    code: 'view-axis-not-time',
    path: '/view/encoding/axis',
  })
  assert.deepEqual(failure(category, { chart: 'bar', encoding: { axis: 'region' } }), {
    code: 'view-axis-not-time',
    path: '/view/encoding/axis',
  })
  const grid = f.observeTimeCategory(3, 2)
  assert.deepEqual(failure(grid, { chart: 'line', encoding: { axis: 'week' } }), {
    code: 'view-name-unknown',
    path: '/view/encoding/axis',
  })
  assert.deepEqual(viewOf(grid, { chart: 'area', encoding: { values: ['m1'] } }), {
    chart: 'area',
    axis: 't_month',
    series: 't_region',
    values: ['m1'],
    broadcast: [],
  })
  assert.deepEqual(failure(grid, { chart: 'line', encoding: { values: ['m1', 'month'] } }), {
    code: 'view-name-unknown',
    path: '/view/encoding/values/1',
  })
  assert.deepEqual(failure(grid, { chart: 'line', encoding: { series: 'month' } }), {
    code: 'view-name-unknown',
    path: '/view/encoding/series',
  })
  assert.equal(viewOf(f.observeTime(3, 1, f.interval), { chart: 'bar' }).chart, 'interval-bar')
  const text = f.frame({
    axes: [f.timeAxis(3)],
    values: [{ name: 'note', type: 'string', values: ['a', 'b', 'c'] }],
  })
  assert.deepEqual(failure(text, { chart: 'line', encoding: { values: ['note'] } }), {
    code: 'view-dtype-not-drawable',
    path: '/view/encoding/values/0',
  })
  assert.deepEqual(failure(text, { chart: 'line' }), {
    code: 'view-dtype-not-drawable',
    path: '/view',
  })
  const over = viewOf(f.overBroadcast(), { chart: 'line' })
  assert.deepEqual(over.chart === 'line' && over.broadcast, ['mean_revenue'])
})

test('explicit heatmap validates both axes and the value', () => {
  const matrix = f.observeMatrix()
  assert.deepEqual(
    viewOf(matrix, { chart: 'heatmap', encoding: { x: 'channel', y: 'region', value: 'm0' } }),
    { chart: 'heatmap', x: 't_channel', y: 't_region', value: 'm0' },
  )
  assert.deepEqual(
    failure(matrix, { chart: 'heatmap', encoding: { x: 'nope', y: 'region', value: 'm0' } }),
    { code: 'view-name-unknown', path: '/view/encoding/x' },
  )
  assert.deepEqual(
    failure(matrix, { chart: 'heatmap', encoding: { x: 'region', y: 'region', value: 'm0' } }),
    { code: 'view-name-unknown', path: '/view/encoding/y' },
  )
  assert.deepEqual(
    failure(matrix, { chart: 'heatmap', encoding: { x: 'channel', y: 'region', value: 'region' } }),
    { code: 'view-name-unknown', path: '/view/encoding/value' },
  )
  const records = f.frame({
    axes: [
      { name: 'region', keys: ['a', 'b'] },
      { name: 'channel', keys: ['x', 'y'] },
    ],
    values: [{ name: 'note', type: 'string', values: ['p', 'q'] }],
  })
  assert.deepEqual(
    failure(records, { chart: 'heatmap', encoding: { x: 'region', y: 'channel', value: 'note' } }),
    { code: 'view-dtype-not-drawable', path: '/view/encoding/value' },
  )
  assert.deepEqual(failure(f.observeTime(3), { chart: 'heatmap' }), {
    code: 'view-target-ambiguous',
    path: '/view',
  })
})

test('heatmaps reject duplicate projected axis keys without aggregating captured rows', () => {
  const encoding = { chart: 'heatmap', encoding: { x: 'a', y: 'b', value: 'v' } } as const
  const make = (a: (string | null)[], b: (string | null)[], c?: string[], totalRows = a.length) =>
    f.frame({
      axes: [
        { name: 'a', keys: a },
        { name: 'b', keys: b },
        ...(c ? [{ name: 'c', keys: c }] : []),
      ],
      values: [f.value('v', a.length)],
      totalRows,
    })
  const expected = { code: 'view-target-ambiguous', path: '/view' }
  const duplicate = make(['one', 'one'], ['two', 'two'], ['first', 'second'])
  assert.deepEqual(failure(duplicate, encoding), expected)
  assert.equal(viewOf(duplicate).chart, 'table')
  assert.deepEqual(
    failure(duplicate, { chart: 'heatmap', encoding: { ...encoding.encoding, value: 'nope' } }),
    {
      code: 'view-name-unknown',
      path: '/view/encoding/value',
    },
  )
  const textDuplicate = f.frame({
    axes: [
      { name: 'a', keys: ['one', 'one'] },
      { name: 'b', keys: ['two', 'two'] },
    ],
    values: [{ name: 'v', type: 'string', values: ['first', 'second'] }],
  })
  assert.deepEqual(failure(textDuplicate, encoding), {
    code: 'view-dtype-not-drawable',
    path: '/view/encoding/value',
  })
  const timeDuplicate = f.observeTimeCategory(9)
  timeDuplicate.frame.coordinates.k_region!.values[1] =
    timeDuplicate.frame.coordinates.k_region!.values[0]!
  timeDuplicate.data.rows[1]![1] = timeDuplicate.data.rows[0]![1]!
  assert.equal(viewOf(timeDuplicate).chart, 'table')
  const invalidFullKey = make(['one', 'one'], ['two', 'two'])
  assert.deepEqual(failure(invalidFullKey, { chart: 'heatmap' }), expected)
  assert.equal(viewOf(invalidFullKey).chart, 'table')
  assert.equal(viewOf(make(['one', 'one'], ['two', 'two'], undefined, 3)).chart, 'table')
  assert.deepEqual(failure(make(['one', 'one'], ['two', 'two'], undefined, 3), encoding), expected)
  assert.equal(
    viewOf(make(['one', 'one'], ['two', 'three'], ['first', 'second']), encoding).chart,
    'heatmap',
  )
  assert.equal(viewOf(make([], []), encoding).chart, 'heatmap')
  // NULL and its visible placeholder have the same label but different raw identities.
  const nullable = make(['placeholder', '—'], ['two', 'two'])
  nullable.frame.coordinates.k_a!.values[0] = null
  nullable.data.rows[0]![0] = null
  assert.equal(viewOf(nullable, encoding).chart, 'heatmap')
  nullable.frame.coordinates.k_a!.values[1] = null
  nullable.data.rows[1]![0] = null
  assert.deepEqual(failure(nullable, encoding), expected)
  // A composite key uses every slot, even when its first component repeats.
  const composite = make(['one', 'one'], ['two', 'two'], ['first', 'second'])
  composite.frame.axes[0]!.keys.push(composite.frame.axes[2]!.keys[0]!)
  assert.equal(viewOf(composite, encoding).chart, 'heatmap')
  composite.frame.coordinates.k_c!.values[1] = 'first'
  assert.deepEqual(failure(composite, encoding), expected)
})

function dataset(columns: number, complete: boolean) {
  const raw = frameSnapshot()
  const base = complete
    ? {
        ...raw,
        data: { ...raw.data, rowCount: 1, truncated: false },
        coverage: { ...raw.coverage, totalRows: 1, complete: true },
      }
    : raw
  const keep = base.data.columns.slice(0, columns)
  return parseAnalysisSnapshot({
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: base.fetchedAt,
    data: { ...base.data, columns: keep, rows: base.data.rows.map((r) => r.slice(0, columns)) },
    coverage: { ...base.coverage, columns: keep.map((c) => c.id) },
    source: { kind: 'dataframe', details: 'not-captured' },
  })
}

test('Dataset snapshots keep auto/table/metric behaviour', () => {
  assert.deepEqual(viewOf(dataset(1, true)), { chart: 'metric', values: ['region'] })
  assert.equal(viewOf(dataset(1, false)).chart, 'table')
  assert.deepEqual(viewOf(dataset(2, true)), { chart: 'table', columns: ['region', 'amount'] })
  assert.deepEqual(viewOf(dataset(2, true), { chart: 'metric', encoding: { value: 'amount' } }), {
    chart: 'metric',
    values: ['amount'],
  })
  assert.deepEqual(failure(dataset(2, false), { chart: 'bar' }), {
    code: 'view-unsupported-for-snapshot',
    path: '/view/chart',
  })
  assert.equal(resolved(dataset(2, true)).classification.class, 'observation')
})

const REAL: Record<string, string> = {
  'align-paired-time': 'alignment/paired-time',
  align: 'alignment/category',
  'attribute-additive': 'decomposition/time-category',
  'attribute-fix': 'decomposition/time',
  'attribute-level': 'decomposition/time-category',
  'attribute-rate-mix': 'decomposition/time-category',
  'attribute-shapley': 'decomposition/time-category',
  'attribute-where': 'decomposition/time-category',
  'compare-calendar': 'comparison/time-category',
  'compare-ordinary': 'comparison/time',
  correlate: 'correlation/scalar',
  members: 'members/category',
  'observe-calendar': 'observation/time',
  'observe-category': 'observation/category',
  'observe-scalar': 'observation/scalar',
  'observe-time-category': 'observation/time-category',
  'over-broadcast': 'observation/time-category',
  'read-records': 'observation/records',
  reduce: 'observation/category',
  share: 'observation/time-category',
  values: 'observation/category',
}

test('real Marivo Frame snapshots classify and resolve auto views', () => {
  const directory = new URL('./fixtures/frames/', import.meta.url)
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'))
  for (const file of files) {
    const name = file.slice(0, -'.json'.length)
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(readFileSync(new URL(file, directory), 'utf8')),
    )
    assert.equal(kindOf(snapshot), REAL[name], name)
  }
  assert.deepEqual(files.map((n) => n.slice(0, -5)).sort(), Object.keys(REAL).sort())
  const read = (name: string) =>
    parseAnalysisSnapshot(JSON.parse(readFileSync(new URL(`${name}.json`, directory), 'utf8')))
  assert.deepEqual(resolved(read('over-broadcast')).classification.broadcastValues, ['month_total'])
  assert.deepEqual(viewOf(read('correlate')), {
    chart: 'correlation',
    values: ['coefficient'],
    counts: { coefficient: 'n_pairs' },
  })
  assert.equal(viewOf(read('observe-scalar')).chart, 'metric')
  assert.equal(viewOf(read('read-records')).chart, 'table')
  assert.equal(viewOf(read('members')).chart, 'members')
  // Real share is normalized along region inside each month: one track per period.
  assert.deepEqual(viewOf(read('share')), {
    chart: 'share',
    values: ['region_share'],
    axis: 'axis.1',
  })
  // Real align sides observe revenue and order_count: no shared subject, so no pairs.
  assert.deepEqual(viewOf(read('align')), {
    chart: 'alignment',
    alignment: 0,
    pairs: [],
    style: 'table',
  })
  assert.deepEqual(viewOf(read('align-paired-time')), {
    chart: 'alignment',
    alignment: 0,
    pairs: [{ left: 'left.revenue', right: 'right.revenue' }],
    style: 'line',
  })
  // attribute of a comparison: effect outputs sit on the change decompositions.
  const rateMix = read('attribute-rate-mix')
  assert.equal(
    viewOf(rateMix, {
      chart: 'decomposition',
      encoding: { value: 'effect.within.previous.absolute.aov' },
    }).chart,
    'decomposition',
  )
  const effects = viewOf(rateMix, {
    chart: 'decomposition',
    encoding: { value: 'effect.within.previous.absolute.aov' },
  })
  assert.equal(effects.chart === 'decomposition' && effects.style, 'effects')
})
