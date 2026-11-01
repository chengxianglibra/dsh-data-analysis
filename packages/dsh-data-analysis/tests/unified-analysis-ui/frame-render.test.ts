import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../src/presentation/contracts/frame-view.ts'
import { resolveFrameView } from '../../src/presentation/contracts/frame-view.ts'
import {
  type FrameSnapshotV2,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import {
  align,
  attributeAdditive,
  attributeEffects,
  attributeShare,
  axisGroups,
  calendarBinding,
  categoryAxis,
  compareCalendar,
  comparedIntervalMonth,
  comparedRoles,
  comparedValues,
  compareOrdinary,
  comparisonOf,
  correlate,
  cycle,
  frame,
  labels,
  members,
  months,
  observeCategory,
  observed,
  observeMatrix,
  observeScalar,
  observeTime,
  observeTimeCategory,
  overBroadcast,
  pairedAxis,
  records,
  reduceByMonth,
  repeat,
  shareByRegion,
  shareOf,
  timeAxis,
  token,
  value,
} from './frame-fixtures.ts'
import {
  bundleRenderer,
  categoryBroadcast,
  comparedCalendarWithPeriods,
  comparedCategories,
  comparedScalar,
  comparedSinglePeriodMultiGroup,
  comparedTimeCategory,
  monthly,
  type Renderer,
  twoAliases,
} from './frame-render-fixtures.ts'

let r: Renderer
// Inline <style> carries palette hexes and class names; assertions read only the markup.
const strip = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '')
before(async () => {
  const bundled = await bundleRenderer()
  r = {
    ...bundled,
    render: (...args) => strip(bundled.render(...args)),
    shell: (...args) => strip(bundled.shell(...args)),
  }
})
after(async () => {
  await r?.dispose()
})

const viewOf = (html: string) => /data-frame-view="([^"]+)"/.exec(html)?.[1]
const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern, 'g'))?.length ?? 0
const comparisonTable = (html: string) =>
  /<section class="pr-table fv-comparison-table"[\s\S]*?<\/table><\/section>/.exec(html)?.[0] ?? ''
/** Path `d` attributes of drawn lines; each `M` starts a segment. */
const segments = (html: string) =>
  [...html.matchAll(/<path d="([^"]*)" class="fv-line"/g)].map((m) => count(m[1]!, /M/))
const resolved = (snapshot: FrameSnapshotV2) => {
  const resolution = resolveFrameView(snapshot)
  if (!resolution.ok) throw new Error(resolution.code)
  return resolution
}
// Explanatory copy the principles forbid in Frame views.
const BANNERS =
  /note:|注[:：]|说明[:：]|Evidence|Findings|Methods|方法说明|同比|环比|仅本期|only current|not computed|未计算/i

test('every auto view resolves through the real resolveFrameView and renders its main view', () => {
  const cases: [string, FrameSnapshotV2, string][] = [
    ['metric', observeScalar(2), 'metric'],
    ['bar', observeTime(6), 'bar'],
    ['line', observeTime(18), 'line'],
    [
      'interval-bar',
      observeTime(4, 1, { kind: 'interval', timezone: 'Asia/Shanghai' }),
      'interval-bar',
    ],
    ['hbar', observeCategory(3), 'hbar'],
    ['multi-line', observeTimeCategory(3), 'line'],
    ['heatmap time-category', observeTimeCategory(9), 'heatmap'],
    ['heatmap matrix', observeMatrix(), 'heatmap'],
    ['comparison line', compareCalendar(6), 'comparison'],
    ['dumbbell', compareOrdinary([categoryAxis(3)]), 'comparison'],
    ['waterfall', attributeAdditive(), 'decomposition'],
    ['effects', attributeEffects(), 'decomposition'],
    ['correlation', correlate(true), 'correlation'],
    ['share', shareByRegion(), 'share'],
    ['align dumbbell', align(categoryAxis(3)), 'alignment'],
    ['align line', align(pairedAxis(3)), 'alignment'],
    ['members', members(), 'members'],
    ['records', records(), 'table'],
  ]
  for (const [name, snapshot, chart] of cases) {
    const html = r.render(snapshot)
    assert.equal(viewOf(html), chart, name)
    assert.equal(viewOf(html), resolved(snapshot).view.chart, name)
    assert.doesNotMatch(html, BANNERS, name)
    if (!['members', 'table', 'metric'].includes(chart))
      assert.match(
        html,
        /<svg class="fv-svg"[^>]*role="img" aria-label="[^"]+"|data-chart-engine="openui"/,
        name,
      )
  }
})

test('observation shapes draw lines, areas, bars, heatmaps and frozen record tables', () => {
  const line = r.render(observeTime(18))
  assert.equal(segments(line).length, 1)
  assert.match(
    r.render(observeTime(6), { view: { chart: 'area' } }),
    /class="openui-area-chart-area-path"/,
  )
  assert.equal(count(r.render(observeTime(6)), /class="openui-bar-chart-bar"/), 6)
  const interval = r.render(observeTime(4, 1, { kind: 'interval', timezone: 'Asia/Shanghai' }))
  assert.doesNotMatch(interval, /class="fv-line"/)
  const series = r.render(observeTimeCategory(3))
  assert.equal(count(series, /class="openui-line-chart-line"/), 3)
  assert.match(series, /class="openui-chart-legend"/)
  assert.match(r.render(observeMatrix()), /data-mark="cell"/)
  assert.match(r.render(records()), /class="fv-frozen"/)
  // Statistic symbols prefix value names.
  const reduced = r.render(reduceByMonth())
  assert.match(reduced, /Σ total/)
  assert.match(reduced, /μ average/)
  assert.match(reduced, /# rows/)
})

test('a legend is hidden only when it repeats the sole displayed metric', () => {
  const singleBar = r.render(observeCategory(3))
  assert.match(singleBar, /data-chart-engine="openui"/)
  assert.doesNotMatch(singleBar, /class="openui-chart-legend"/)
  const singleTime = r.render(observeTime(6))
  assert.doesNotMatch(singleTime, /class="openui-chart-legend"/)
  const multiTime = r.render(observeTimeCategory(3))
  assert.match(multiTime, /class="openui-chart-legend"/)
  const singleGroup = r.render(
    frame({
      axes: [timeAxis(3), { ...categoryAxis(1), keys: ['m0', 'm0', 'm0'] }],
      values: [value('m0', 3, observed())],
    }),
  )
  assert.match(singleGroup, /class="openui-chart-legend"/)
  const fallback = r.render(observeTime(18))
  assert.doesNotMatch(fallback, /class="fv-legend"/)
  const withBroadcast = overBroadcast()
  for (const column of withBroadcast.data.columns) {
    if (column.id === 'revenue' || column.id === 'mean_revenue') column.unit = 'USD'
  }
  const broadcast = r.render(withBroadcast)
  assert.match(broadcast, /class="fv-legend"/)
})

test('official points expose accessible keyboard targets only in an actionable surface', () => {
  const snapshot = observeTime(6)
  const actionable = r.render(snapshot, { askPoint: true })
  assert.match(actionable, /data-chart-engine="openui"/)
  assert.match(actionable, /class="fv-keyboard-points"/)
  const value =
    snapshot.data.rows[0]![snapshot.data.columns.findIndex((column) => column.id === 'm0')]
  assert.match(actionable, new RegExp(String(value)))
  const readOnly = r.render(snapshot)
  assert.doesNotMatch(readOnly, /class="fv-keyboard-points"/)
})

test('missing observations use the truthful renderer and offer only present values for selection', () => {
  const snapshot = monthly([0, 2, null, 4])
  const html = r.render(snapshot, { askPoint: true })
  assert.doesNotMatch(html, /data-chart-engine="openui"/)
  assert.equal(count(html, /data-mark="zero"/), 1)
  assert.doesNotMatch(html, /Select a data point|选择数据点/)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
})

test('heatmap retains sparse axis members and distinguishes missing cells from zero', () => {
  const snapshot = observeMatrix()
  snapshot.data.rows.splice(0, 1)
  for (const coordinate of Object.values(snapshot.frame.coordinates)) coordinate.values.splice(0, 1)
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.rows[0]![index] = 0
  const html = r.render(snapshot, { askPoint: true })
  assert.doesNotMatch(html, /data-chart-engine="openui"/)
  assert.equal(count(html, /data-mark="empty"/), 1)
  assert.equal(count(html, /data-mark="cell"/), 3)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
  assert.match(html, /data-heatmap-scale=/)
  assert.match(html, /title="0/)
  assert.match(html, /<title>[^<]*: 0<\/title>/)
  assert.doesNotMatch(html, /Row avg|Column avg/)
})

test('heatmap leaves NULL cells empty and selects only saved numeric values', () => {
  const snapshot = observeMatrix()
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.rows[0]![index] = null
  snapshot.data.rows[1]![index] = 1234567.89
  const html = r.render(snapshot, { askPoint: true })
  assert.equal(count(html, /data-mark="empty"/), 1)
  assert.equal(count(html, /data-mark="cell"/), 3)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
  assert.match(html, /<title>[^<]*: 1234567\.89<\/title>/)
  assert.doesNotMatch(html, /Row avg|Column avg/)
})

test('correlation and saved shares expose data points without selecting reference tracks', () => {
  const correlation = r.render(correlate(true), { askPoint: true })
  assert.match(correlation, /role="button" tabindex="0"[^>]*aria-label="[^"]*n /)
  assert.doesNotMatch(correlation, /Select a data point|选择数据点/)
  const shares = r.render(shareByRegion(), { askPoint: true })
  assert.ok(count(shares, /role="button" tabindex="0"/) > 0)
  assert.doesNotMatch(shares, /Select a data point|选择数据点/)
  assert.doesNotMatch(shares, /class="fv-track"[^>]*role="button"/)
})

test('time-category charts facet multiple values, distinguish categories and avoid overlapping endpoints', () => {
  const snapshot = observeTimeCategory(8, 3)
  for (const name of ['m0', 'm1', 'm2']) {
    const index = snapshot.data.columns.findIndex((column) => column.id === name)
    snapshot.data.columns[index]!.unit = 'USD'
    for (const row of snapshot.data.rows) row[index] = 50
  }
  const html = r.render(snapshot, { view: { chart: 'line' } })
  assert.equal(count(html, /<section class="fv-parent"/), 3)
  assert.equal(count(html, /<ul class="fv-legend">/), 1)
  assert.equal(count(html, /data-series="/), 24)
  assert.equal(count(html, /data-mark="endpoint-label"/), 3)
  for (let i = 0; i < 8; i++) assert.match(html, new RegExp(`data-marker="${i}"`))
  // Every equal-valued point remains represented in its own series and exposes its original value.
  assert.equal(count(html, /: 50 USD<\/title>/), 72)
})

test('single-period plots use a compact height without overriding an explicit height', () => {
  const snapshot = frame({
    axes: [
      { ...timeAxis(1), keys: repeat(months(1), 3) },
      { ...categoryAxis(3), keys: labels('r', 3) },
    ],
    values: [{ name: 'amount', values: [1, 2, 3] }],
  })
  assert.match(r.render(snapshot, { view: { chart: 'line' } }), /viewBox="0 0 640 112"/)
  assert.match(
    r.render(snapshot, { view: { chart: 'line' }, display: { height: 200 } }),
    /viewBox="0 0 640 200"/,
  )
})

test('long time series retain distinguishing markers and never connect null gaps', () => {
  const snapshot = frame({
    axes: [
      { ...timeAxis(45), keys: repeat(months(45), 2) },
      { ...categoryAxis(2), keys: cycle(labels('r', 2), 45) },
    ],
    values: [
      { name: 'amount', values: Array.from({ length: 90 }, (_, i) => (i === 40 ? null : i)) },
    ],
  })
  const html = r.render(snapshot, { view: { chart: 'line' } })
  assert.equal(segments(html).length, 2)
  assert.ok(segments(html).some((segment) => segment === 2))
  assert.ok(count(html, /data-marker="0"/) >= 10)
  assert.ok(count(html, /data-marker="1"/) >= 10)
  assert.match(html, /<title>2025/)
})

test('Frame titles reflect the values actually selected for observation charts', () => {
  for (const chart of ['line', 'area', 'bar'] as const) {
    const html = r.render(observeTime(3, 2), { view: { chart, encoding: { values: ['m1'] } } })
    const title = /<h3 class="fv-title">([^<]*)<\/h3>/.exec(html)?.[1]
    assert.match(title ?? '', /m1/)
    assert.doesNotMatch(title ?? '', /m0/)
  }
  const metric = r.render(observeScalar(2), {
    view: { chart: 'metric', encoding: { value: 'm1' } },
  })
  assert.match(metric, /<h3 class="fv-title">m1(?: \([^)]*\))?<\/h3>/)
  const heatmap = r.render(observeMatrix(2), {
    view: { chart: 'heatmap', encoding: { x: 'region', y: 'channel', value: 'm1' } },
  })
  const title = /<h3 class="fv-title">([^<]*)<\/h3>/.exec(heatmap)?.[1]
  assert.match(title ?? '', /m1/)
  assert.doesNotMatch(title ?? '', /m0/)
  const broadcast = /<h3 class="fv-title">([^<]*)<\/h3>/.exec(r.render(overBroadcast(6)))?.[1]
  assert.match(broadcast ?? '', /revenue/)
  assert.match(broadcast ?? '', /mean_revenue/)
  const table = r.render(observeTime(3, 2), { view: { chart: 'table', columns: ['m1'] } })
  const tableTitle = /<h3 class="fv-title">([^<]*)<\/h3>/.exec(table)?.[1]
  assert.match(tableTitle ?? '', /m0/)
  assert.match(tableTitle ?? '', /m1/)
})

test('heatmap scale shows saved bounds and omits a scale when all values are missing', () => {
  const snapshot = observeMatrix()
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.columns[index]!.unit = 'USD'
  snapshot.data.rows[0]![index] = -2
  snapshot.data.rows[1]![index] = 5
  const html = r.render(snapshot)
  assert.match(html, /data-heatmap-scale="diverging"/)
  assert.match(html, /m0 \(USD\)/)
  assert.match(html, /title="-2 USD"/)
  assert.match(html, /title="5 USD"/)
  for (const row of snapshot.data.rows) row[index] = null
  const empty = r.render(snapshot)
  assert.doesNotMatch(empty, /data-heatmap-scale=/)
  assert.match(empty, /data-mark="empty"/)
})

test('dense time labels retain both endpoints without crowding the final label', () => {
  const axis = timeAxis(30, {
    kind: 'calendar',
    timezone: 'Asia/Shanghai',
    grain: { kind: 'builtin', unit: 'day', step: 1 },
  })
  axis.keys = Array.from(
    { length: 30 },
    (_, i) => `2025-06-${String(i + 1).padStart(2, '0')}T00:00:00+08:00`,
  )
  const html = r.render(
    frame({ axes: [axis], values: [{ name: 'value', values: Array(30).fill(1) }] }),
  )
  const ticks = [...html.matchAll(/<g data-tick="([^"]+)">([\s\S]*?)<\/g>/g)]
  const labeled = ticks.flatMap((tick, index) => (tick[2]!.includes('<text') ? [index] : []))
  assert.equal(ticks.length, 30)
  assert.equal(labeled.length, 10)
  assert.equal(labeled[0], 0)
  assert.equal(labeled.at(-1), 29)
  assert.ok(labeled.at(-1)! - labeled.at(-2)! >= 3)
})

test('long month labels have room while keeping the endpoints', () => {
  const html = r.render(observeTime(12))
  const ticks = [...html.matchAll(/<g data-tick="([^"]+)">([\s\S]*?)<\/g>/g)]
  const labeled = ticks.flatMap((tick, index) => (tick[2]!.includes('<text') ? [index] : []))
  assert.equal(ticks.length, 12)
  assert.equal(labeled[0], 0)
  assert.equal(labeled.at(-1), 11)
  assert.ok(labeled.length <= 6)
  assert.ok(labeled.slice(1).every((n, i) => n - labeled[i]! >= 2))
})

test('observation charts use separate scales for different or unknown units', () => {
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [
      { name: 'trips', values: [1, 2, 3] },
      { name: 'fare', values: [4, 5, 6] },
      { name: 'other', values: [7, 8, 9] },
    ],
  })
  snapshot.data.columns.find((column) => column.id === 'trips')!.unit = '1'
  snapshot.data.columns.find((column) => column.id === 'fare')!.unit = 'USD'
  const mixed = r.render(snapshot)
  assert.equal(count(mixed, /data-chart-engine="openui"|class="fv-chart"/), 3)
  assert.match(mixed, /trips/)
  assert.match(mixed, /fare \(USD\)/)
  snapshot.data.columns.find((column) => column.id === 'fare')!.unit = '1'
  const shared = r.render(snapshot)
  assert.equal(count(shared, /data-chart-engine="openui"|class="fv-chart"/), 2)

  const time = frame({
    axes: [timeAxis(3)],
    values: [
      { name: 'trips', values: [1, 2, 3] },
      { name: 'fare', values: [4, 5, 6] },
    ],
  })
  time.data.columns.find((column) => column.id === 'trips')!.unit = '1'
  time.data.columns.find((column) => column.id === 'fare')!.unit = 'USD'
  assert.equal(count(r.render(time), /data-chart-engine="openui"|class="fv-chart"/), 2)
})

test('broadcast values are reference lines labelled with the saved partition value', () => {
  const time = r.render(overBroadcast(6))
  assert.equal(count(time, /data-mark="reference"/), 1)
  assert.match(time, /μ mean_revenue/)
  const bars = r.render(categoryBroadcast())
  assert.equal(count(bars, /data-mark="reference"/), 1)
  assert.match(bars, /9[,.]?00K|9K/)
  // The broadcast value is not drawn as its own bar series.
  assert.equal(count(bars, /data-mark="bar"|class="openui-bar-chart-bar"/), 3)
})

test('NA draws no mark and breaks the line; 0 is drawn on the baseline', () => {
  const na = r.render(monthly([1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))
  assert.deepEqual(segments(na), [2])
  assert.match(na, /—/)
  const bars = r.render(monthly([0, 2, null, 4]))
  assert.equal(count(bars, /data-mark="zero"/), 1)
  assert.equal(count(bars, /data-mark="bar"/), 2)
})

test('a missing period keeps its tick and leaves a gap', () => {
  const html = r.render(
    monthly([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], {
      periods: 14,
      rows: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    }),
  )
  assert.equal(count(html, /data-tick="/), 14)
  assert.match(html, /data-tick="2025-03"/)
  assert.deepEqual(segments(html), [2])
})

test('an incomplete period draws a hollow point or a hatched bar with both bounds in the tooltip', () => {
  const actual = { 1: '2025-02-10T00:00:00+08:00' }
  const line = r.render(
    monthly(
      Array.from({ length: 14 }, (_, i) => i + 1),
      { actual },
    ),
  )
  assert.equal(count(line, /data-mark="hollow"/), 1)
  assert.match(line, /Actual 2025-02-10 00:00 – 2025-03-01 00:00\nNominal 2025-02-01 00:00/)
  const bars = r.render(monthly([1, 2, 3], { actual }))
  assert.equal(count(bars, /data-mark="hatched"/), 1)
})

test('calendar periods use saved labels and selection states without invented bounds', () => {
  const snapshot = monthly([1, 2, 3, 4])
  const periods = snapshot.frame.sections.periods
  assert.equal(periods.status, 'captured')
  if (periods.status !== 'captured') return
  const items = periods.pages[0]!.items
  const selections = ['full', 'prefix', 'partial', 'unavailable'] as const
  periods.pages[0]!.items = items.map((item, index) => ({
    kind: 'calendar' as const,
    key: item.key,
    timezone: 'Asia/Shanghai',
    label: `2025-0${index + 1}`,
    selection: selections[index]!,
    cutoff: index === 1 ? '2025-02-15T12:00:00.000000' : null,
  }))
  const html = r.render(parseAnalysisSnapshot(snapshot))
  assert.match(html, /data-tick="2025-01"/)
  assert.match(html, /Full period/)
  assert.match(html, /Period prefix, local cutoff: 2025-02-15T12:00:00.000000/)
  assert.match(html, /Partial period/)
  assert.match(html, /Period selection unavailable/)
  assert.equal(count(html, /data-mark="hatched"/), 3)
  assert.doesNotMatch(html, /Nominal |Actual /)
})

test('presence false draws only the present side', () => {
  const html = r.render(comparedCategories([true, false, true]))
  assert.equal(viewOf(html), 'comparison')
  assert.equal(count(html, /data-mark="hollow"/), 2)
  assert.equal(count(html, /data-mark="filled"/), 3)
  assert.equal(count(html, /class="fv-stem"/), 2)
})

test('restricted decompositions detach the total; has_more falls back to a table', () => {
  const closed = r.render(attributeAdditive())
  assert.match(closed, /data-mark="connector-total"/)
  assert.match(closed, /data-mark-total="closed"/)
  const restricted = r.render(attributeAdditive({ rowScope: 'restricted' }))
  assert.doesNotMatch(restricted, /data-mark="connector-total"/)
  assert.match(restricted, /data-mark-total="detached"/)
  for (const [snapshot, coverage] of [
    [attributeAdditive({ total: 9 }), '4/9'],
    [attributeShare(9), '3/9'],
    [observeCategory(3, 9), '3/9'],
    [shareByRegion(3, 9), '3/9'],
  ] as const) {
    const html = r.render(snapshot)
    assert.equal(viewOf(html), 'table')
    assert.match(html, new RegExp(`<span>${coverage}</span>`))
  }
})

test('a missing decomposition contribution is marked and does not close the waterfall', () => {
  const snapshot = attributeAdditive()
  const index = snapshot.data.columns.findIndex((column) => column.id === 'contribution')
  snapshot.data.columns[index]!.nullable = true
  snapshot.data.rows[1]![index] = null
  const html = r.render(snapshot)
  assert.match(html, /data-mark-total="detached"/)
  assert.doesNotMatch(html, /data-mark="connector-total"/)
  assert.match(html, /class="fv-strong">—<\/text>/)
})

test('comparison numbers are saved cells with neutral marks and endpoint labels', () => {
  const html = r.render(comparedScalar({ current: 120, baseline: 100, absolute: 7, relative: 0.5 }))
  assert.equal(viewOf(html), 'comparison')
  // Δ and Δ% are the saved (deliberately inconsistent) cells, never current − baseline.
  assert.match(html, /▲7</)
  assert.match(html, /▲50\.0%/)
  assert.doesNotMatch(html, /▲20\b|▲20%/)
  assert.match(html, /<dt>west<\/dt>/)
  assert.match(html, /<dt>east<\/dt>/)
  const zero = r.render(comparedScalar({ current: 5, baseline: 0, absolute: 5, relative: null }))
  assert.match(zero, /data-number="prior.relative.sales"><dd[^>]*>—</)
  const down = r.render(comparedScalar({ current: 1, baseline: 2, absolute: -1, relative: -0.5 }))
  assert.match(down, /▼1</)
  assert.match(down, /▼50\.0%/)
  assert.doesNotMatch(down, /#(?:e34948|008300|ff0000|00ff00)|\bred\b|\bgreen\b/i)
})

test('a single-row multi-group comparison is one transposed table plus the audit table', () => {
  const html = r.render(comparedSinglePeriodMultiGroup())
  assert.equal(viewOf(html), 'table')
  const block = comparisonTable(html)
  assert.match(
    block,
    /^<section class="pr-table fv-comparison-table" data-table-layout="comparison"/,
  )
  // metric | current | baseline | Δ | Δ% — endpoints come from the comparison.
  assert.equal(count(block, /<th scope="col"/), 5)
  for (const header of ['Metric', 'Current', 'Baseline', 'Δ', 'Δ%'])
    assert.ok(block.includes(`>${header}</th>`), header)
  // Two groups on one saved row: two data rows in one tbody, no section headers.
  assert.equal(count(block, /<tr><th scope="row">/), 2)
  // Current/baseline/Δ/Δ% are numeric cells for both rows.
  assert.equal(count(block, /<td class="pr-numeric"/), 8)
  assert.equal(count(block, /<tbody>/), 1)
  assert.doesNotMatch(block, /fv-comparison-section/)
  // Raw role column ids stay out of the display table.
  assert.doesNotMatch(block, /prior\.(?:baseline|relative)\./)
  assert.match(html, /<details class="fv-table">/)
  assert.match(html, /<h3 class="fv-title">Current ⇄ Baseline<\/h3>/)
})

test('a frame table shows grouped values and keeps the exact cell in the title', () => {
  const html = r.render(
    frame({
      axes: [categoryAxis(2)],
      values: [{ name: 'amount', values: [118393545.04998468, 8] }],
    }),
    { view: { chart: 'table' } },
  )
  assert.match(html, />118,393,545\.05</)
  assert.match(html, /title="118393545\.04998468"/)
})

test('interval comparison endpoints name inclusive civil months', () => {
  const html = r.render(comparedIntervalMonth())
  assert.equal(viewOf(html), 'table')
  const block = comparisonTable(html)
  assert.match(block, /<th scope="col" class="pr-numeric">2025-06<\/th>/)
  assert.match(block, /<th scope="col" class="pr-numeric">2025-05<\/th>/)
  assert.match(html, /<h3 class="fv-title">2025-06 ⇄ 2025-05<\/h3>/)
  assert.doesNotMatch(block, /07-01/)
  assert.doesNotMatch(block, /06-01 – 07-01/)
})

test('time comparison draws a solid current line, dashed baseline and a Δ strip', () => {
  const html = r.render(compareCalendar(6))
  assert.match(html, /class="fv-line" data-dashed=""/)
  assert.equal(segments(html).length, 2)
  assert.match(html, /data-strip="delta"/)
  const periods = r.render(comparedCalendarWithPeriods(3))
  assert.match(periods, /data-icon="periods"/)
  assert.match(periods, /2025-01 – 2025-03 ⇄ 2026-01 – 2026-03/)
})

test('category comparisons draw a dumbbell, a delta bar, small multiples and alias segments', () => {
  const dumbbell = r.render(compareOrdinary([categoryAxis(3)]))
  assert.equal(count(dumbbell, /class="fv-stem"/), 3)
  const delta = r.render(compareOrdinary([categoryAxis(3)]), {
    view: { chart: 'comparison', style: 'delta' },
  })
  assert.doesNotMatch(delta, /class="fv-stem"/)
  assert.equal(count(delta, /data-mark="bar"/), 3)
  const multiples = r.render(comparedTimeCategory())
  assert.equal(count(multiples, /data-multiple="/), 3)
  const aliases = r.render(twoAliases(), {
    view: { chart: 'comparison', encoding: { value: 'lastyear.baseline.sales' } },
  })
  assert.match(aliases, /class="fv-segments"/)
  assert.match(aliases, /aria-pressed="true"[^>]*>lastyear</)
  assert.match(aliases, /aria-pressed="false"[^>]*>plan</)
})

test('decompositions draw the waterfall, effect segments with ◆ and the share track', () => {
  const waterfall = r.render(attributeAdditive())
  assert.equal(count(waterfall, /data-mark="connector"/), 3)
  assert.match(waterfall, /data-number="total"/)
  const effects = r.render(attributeEffects())
  assert.equal(count(effects, /data-mark="contribution"/), 3)
  assert.match(effects, /Within/)
  assert.match(effects, /Mix/)
  const share = r.render(attributeShare(), { view: { chart: 'decomposition', style: 'share' } })
  assert.match(share, /data-tick="0"/)
  assert.match(share, /data-tick="100%"/)
  assert.match(share, />20%</)
  assert.match(share, />50%</)
})

test('the share track extends below 0 and above 100%', () => {
  const s = shareByRegion()
  const index = s.data.columns.findIndex((c) => c.id === 'revenue_share')
  s.data.rows.forEach((row, i) => {
    row[index] = [-0.2, 0.5, 1.4][i]!
  })
  const html = r.render(s)
  assert.match(html, />-20%</)
  assert.match(html, />140%</)
})

test('correlation dots sit on a fixed [-1, 1] axis; NA draws no point and keeps n_pairs', () => {
  const s = correlate(true)
  s.data.rows[1]![1] = null
  s.data.columns[1]!.nullable = true
  const html = r.render(s)
  assert.equal(viewOf(html), 'correlation')
  assert.equal(count(html, /data-mark="filled"/), 2)
  for (const tick of ['-1', '0', '1']) assert.match(html, new RegExp(`>${tick}</text>`))
  assert.equal(count(html, /n 30/), 3)
  assert.match(html, /—/)
  const scalar = r.render(correlate(false, 'spearman'))
  assert.match(scalar, /<dt>ρ<\/dt>/)
  assert.match(scalar, /<dt>n<\/dt>/)
})

test('align draws hollow left and filled right pairs, or two lines on a paired axis', () => {
  const dumbbell = r.render(align(categoryAxis(3)))
  assert.equal(count(dumbbell, /class="fv-stem"/), 6)
  assert.match(dumbbell, /left\.revenue/)
  const line = r.render(align(pairedAxis(3)))
  assert.equal(segments(line).length, 4)
  // Unmatched subjects draw no pairs; both sides stay in the saved table.
  const unmatched = r.render(align(categoryAxis(3), ['sales.aov', 'sales.margin']))
  assert.equal(count(unmatched, /class="fv-stem"/), 0)
  assert.match(unmatched, /data-column-id="right\.orders"/)
})

test('coincident comparison and alignment dots retain both roles; absent sides remain absent', () => {
  const compared = comparedCategories([true, false, true, false, true, true])
  const index = (id: string) => compared.data.columns.findIndex((column) => column.id === id)
  compared.data.rows[1]![index('prior.baseline.sales')] = 777777
  compared.data.rows[2]![index('current.present')] = false
  compared.data.rows[2]![index('sales')] = 888888
  compared.data.rows[3]![index('current.present')] = false
  compared.data.rows[3]![index('sales')] = 666666
  compared.data.rows[3]![index('prior.baseline.sales')] = 555555
  compared.data.rows[4]![index('prior.baseline.sales')] = 5.00000001
  compared.data.rows[5]![index('prior.baseline.sales')] = 9
  const chart = r.render(compared).match(/<svg[^>]*role="img"[\s\S]*?<\/svg>/)?.[0] ?? ''
  const row = (i: number) =>
    new RegExp(`<g data-row="r${i}">([\\s\\S]*?)<\\/g>`).exec(chart)?.[1] ?? ''
  assert.match(row(0), /r="6\.5"[^>]*data-mark="hollow"/)
  assert.match(row(0), /r="3"[^>]*data-mark="filled"/)
  assert.doesNotMatch(row(1), /data-mark="hollow"|777777/)
  assert.doesNotMatch(row(2), /data-mark="filled"|888888/)
  assert.doesNotMatch(row(3), /data-mark="(?:hollow|filled)"|666666|555555/)
  assert.match(row(4), /r="6\.5"[^>]*data-mark="hollow"/)
  assert.match(row(4), /5\.00000001/)
  assert.equal(count(row(5), /r="4\.5"/), 2)
  assert.doesNotMatch(chart, /777777|888888|666666|555555/)

  const aligned = align(categoryAxis(4))
  const column = (id: string) => aligned.data.columns.findIndex((item) => item.id === id)
  aligned.data.rows[1]![column('right_present')] = false
  aligned.data.rows[1]![column('right.revenue')] = 999999
  aligned.data.rows[2]![column('right.revenue')] = 3.00000001
  aligned.data.rows[3]![column('right.revenue')] = 8
  const alignedChart = r.render(aligned).match(/<svg[^>]*role="img"[\s\S]*?<\/svg>/)?.[0] ?? ''
  assert.match(alignedChart, /r="6\.5"[^>]*data-mark="hollow"/)
  assert.match(alignedChart, /r="3"[^>]*data-mark="filled"/)
  assert.match(alignedChart, /3\.00000001/)
  assert.doesNotMatch(alignedChart, /999999/)
})

test('time comparison tooltip and accessible summary honor side presence', () => {
  const comparison = {
    ...comparisonOf(calendarBinding(), [{ name: 'sales', values: comparedRoles('sales') }]),
    presence: { current: 'current.present', baseline: 'prior.present', enclosing: [] },
  }
  const snapshot = frame({
    axes: [timeAxis(3)],
    values: [
      ...comparedValues('sales', 3),
      { name: 'current.present', type: 'boolean', values: [false, true, false], presence: true },
      { name: 'prior.present', type: 'boolean', values: [true, false, false], presence: true },
    ],
    comparisons: [comparison],
  })
  const current = snapshot.data.columns.findIndex((column) => column.id === 'sales')
  const baseline = snapshot.data.columns.findIndex((column) => column.id === 'prior.baseline.sales')
  snapshot.data.rows[0]![current] = 777777
  snapshot.data.rows[1]![baseline] = 888888
  snapshot.data.rows[2]![current] = 666666
  snapshot.data.rows[2]![baseline] = 555555
  const absolute = snapshot.data.columns.findIndex((column) => column.id === 'prior.absolute.sales')
  const relative = snapshot.data.columns.findIndex((column) => column.id === 'prior.relative.sales')
  for (const row of snapshot.data.rows) {
    row[absolute] = 432100
    row[relative] = 0.4321
  }
  const chart = r.render(snapshot).match(/<svg[^>]*role="img"[\s\S]*?<\/svg>/)?.[0] ?? ''
  assert.doesNotMatch(chart, /777777|888888|666666|555555|432100|0\.4321/)
  assert.match(chart, /—/)
})

test('comparison changes require both direct endpoints but ignore enclosing and unknown presence', () => {
  const current = [true, false, true, false, null]
  const baseline = [true, true, false, false, null]
  const comparison = {
    ...comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: comparedRoles('sales') }]),
    presence: {
      current: 'current.present',
      baseline: 'prior.present',
      enclosing: ['outer.present'],
    },
  }
  const snapshot = frame({
    axes: [categoryAxis(5)],
    values: [
      ...comparedValues('sales', 5),
      { name: 'current.present', type: 'boolean', values: current, presence: true },
      { name: 'prior.present', type: 'boolean', values: baseline, presence: true },
      {
        name: 'outer.present',
        type: 'boolean',
        values: [false, true, true, true, false],
        presence: true,
      },
    ],
    comparisons: [comparison],
  })
  const absolute = snapshot.data.columns.findIndex((column) => column.id === 'prior.absolute.sales')
  const relative = snapshot.data.columns.findIndex((column) => column.id === 'prior.relative.sales')
  for (const [i, row] of snapshot.data.rows.entries()) {
    row[absolute] = 800001 + i
    row[relative] = 0.451 + i / 1000
  }
  for (const view of [
    { chart: 'comparison' as const },
    { chart: 'comparison' as const, style: 'delta' as const },
  ]) {
    const html = r.render(snapshot, { view })
    const chart = html.match(/<svg[^>]*role="img"[\s\S]*?<\/svg>/)?.[0] ?? ''
    for (const i of [1, 2, 3]) {
      const row = new RegExp(`<g data-row="r${i}">([\\s\\S]*?)<\\/g>`).exec(chart)?.[1] ?? ''
      assert.doesNotMatch(row, new RegExp(`${800001 + i}|0\\.45${i + 1}`))
      assert.match(row, /—/)
    }
    assert.match(chart, /800001/)
    assert.match(chart, /800005/)
    // Detailed comparison retains endpoint masking for absent sides.
    const details = r.render(snapshot, { view, display: { dataTable: 'visible' } })
    assert.match(details, /800001/)
    assert.doesNotMatch(details, /800002/)
  }
})

test('comparison numbers and transposed tables mask changes for explicitly absent sides', () => {
  const comparison = {
    ...comparisonOf({ kind: 'ordinary' }, [
      { name: 'sales', values: comparedRoles('sales') },
      { name: 'orders', values: comparedRoles('orders') },
    ]),
    presence: { current: 'current.present', baseline: 'prior.present', enclosing: [] },
  }
  const snapshot = frame({
    values: [
      ...comparedValues('sales', 1),
      ...comparedValues('orders', 1),
      { name: 'current.present', type: 'boolean', values: [true], presence: true },
      { name: 'prior.present', type: 'boolean', values: [false], presence: true },
    ],
    comparisons: [comparison],
  })
  for (const row of snapshot.data.rows) {
    for (const name of [
      'prior.absolute.sales',
      'prior.relative.sales',
      'prior.absolute.orders',
      'prior.relative.orders',
    ]) {
      row[snapshot.data.columns.findIndex((column) => column.id === name)] = 432100
    }
  }
  const table = comparisonTable(r.render(snapshot))
  assert.doesNotMatch(table, /432100|432,100|43,210,000/)
  assert.ok(count(table, /—/) >= 6)
  const numbers = r.render(snapshot, {
    view: { chart: 'comparison', encoding: { value: 'sales' } },
  })
  const values = /<dl class="fv-numbers">[\s\S]*?<\/dl>/.exec(numbers)?.[0] ?? ''
  assert.doesNotMatch(values, /432100|432,100|43,210,000/)
  assert.ok(count(values, /—/) >= 2)
  assert.doesNotMatch(numbers, /432100/)
})

test('nearby comparison marks retain distinct centres and original values', () => {
  const snapshot = comparedCategories(Array(6).fill(true))
  const baseline = snapshot.data.columns.findIndex((column) => column.id === 'prior.baseline.sales')
  for (const [i, value] of [1.004, 2.02, 3.08, 4.15, 5.3, 9].entries()) {
    snapshot.data.rows[i]![baseline] = value
  }
  const chart = r.render(snapshot).match(/<svg[^>]*role="img"[\s\S]*?<\/svg>/)?.[0] ?? ''
  const row = (i: number) =>
    new RegExp(`<g data-row="r${i}">([\\s\\S]*?)<\\/g>`).exec(chart)?.[1] ?? ''
  for (const i of [0, 1, 2, 3]) {
    assert.match(row(i), /r="6\.5"[^>]*data-mark="hollow"/)
    assert.match(row(i), /r="3"[^>]*data-mark="filled"/)
    const centres = [...row(i).matchAll(/<circle cx="([^"]+)"/g)].map((match) => match[1])
    assert.equal(centres.length, 2)
    assert.notEqual(centres[0], centres[1])
  }
  assert.match(row(0), /1\.004/)
  assert.equal(count(row(4), /r="4\.5"/), 2)
  assert.equal(count(row(5), /r="4\.5"/), 2)
})

test('alignment chart labels and descriptions honor side presence', () => {
  for (const axis of [categoryAxis(3), pairedAxis(3)]) {
    const snapshot = align(axis)
    const rightPresent = snapshot.data.columns.findIndex((column) => column.id === 'right_present')
    const rightRevenue = snapshot.data.columns.findIndex((column) => column.id === 'right.revenue')
    snapshot.data.rows[0]![rightPresent] = false
    snapshot.data.rows[0]![rightRevenue] = 987654321
    const html = r.render(snapshot)
    const chart = html.match(/<svg[^>]*role="img"[\s\S]*?<\/svg>/)?.[0]
    assert.ok(chart)
    assert.doesNotMatch(chart, /987654321|988M/)
    assert.match(chart, /—/)
  }
})

test('members show the saved count and composite keys in separate columns', () => {
  const html = r.render(members())
  assert.match(html, /data-number="members"><dd[^>]*>3</)
  assert.match(html, /<th[^>]*data-column-id="region"/)
})

test('main views accept a hand-built resolution and never re-derive class or shape', () => {
  const s = observeTime(3)
  const c: FrameClassification = {
    class: 'observation',
    shape: 'time',
    timeAxis: token('month'),
    categoryAxes: [],
    primaryValues: ['m0'],
    broadcastValues: [],
    symbols: { m0: 'Σ' },
  }
  const views: ResolvedFrameView[] = [
    { chart: 'line', axis: token('month'), values: ['m0'], broadcast: [] },
    { chart: 'area', axis: token('month'), values: ['m0'], broadcast: [] },
    { chart: 'bar', axis: token('month'), values: ['m0'], broadcast: [] },
    { chart: 'table', columns: ['m0'] },
  ]
  for (const view of views) {
    const html = r.shell(s, c, view)
    assert.equal(viewOf(html), view.chart)
    assert.match(html, /Σ m0/)
  }
  const table = r.shell(s, c, { chart: 'table', columns: ['m0'] })
  assert.match(table, /data-column-id="m0"/)
  assert.doesNotMatch(table, /data-column-id="month"/)
})

test('compact density keeps the name, header numbers or the main view and only useful icons', () => {
  const kpi = r.render(
    comparedScalar({ current: 120, baseline: 100, absolute: 20, relative: 0.2 }),
    {
      display: { density: 'compact' },
    },
  )
  assert.match(kpi, /data-density="compact"/)
  assert.match(kpi, /class="fv-numbers"/)
  assert.equal(count(kpi, /data-icon="/), 0)
  assert.doesNotMatch(kpi, /<details/)
  assert.doesNotMatch(kpi, /fv-chips/)
  const trend = r.render(observeTime(18), { display: { density: 'compact' } })
  assert.match(trend, /class="fv-svg"/)
  assert.equal(count(trend, /data-icon="/), 0)
  assert.match(trend, /<details class="fv-table">/)
  const periods = r.render(comparedCalendarWithPeriods(3), { display: { density: 'compact' } })
  assert.equal(count(periods, /data-icon="/), 1)
  assert.match(periods, /data-icon="periods"/)
})

test('icons grey out for missing sections and Python sources, never as zero items', () => {
  const html = r.render(observeCategory(3, 9))
  assert.match(html, /data-icon="coverage"/)
  assert.match(html, /<span>3\/9<\/span>/)
  assert.doesNotMatch(html, /data-icon="coverage" data-disabled/)
  assert.match(html, /data-icon="origins" data-disabled="true"/)
  assert.doesNotMatch(html, /data-icon="origins"[\s\S]*?<span>0<\/span>/)
  assert.match(html, /data-icon="python" data-disabled="true"/)
  assert.match(html, /No script source/)
  assert.match(html, /aria-label="Python"/)
  assert.doesNotMatch(html, /data-icon="periods"/)
  // Complete snapshots show no coverage icon; incomplete ones show the captured fraction.
  assert.doesNotMatch(r.render(observeTime(6)), /data-icon="coverage"/)
  const s = observeTime(6)
  s.frame.sections.semantics = {
    status: 'captured',
    columns: [
      {
        role: 'value',
        id: 'm0',
        valueOrigins: [{ kind: 'metric', path: 'sales.revenue', definitionId: 'd' }],
        contextOrigins: [],
        omittedOrigins: 0,
      },
    ],
  }
  const origins = r.render(s, {
    codeRef: { executionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sha256: 'a'.repeat(64) },
    readCode: true,
  })
  assert.doesNotMatch(origins, /data-icon="origins" data-disabled/)
  assert.match(origins, /sales\.revenue/)
  assert.doesNotMatch(origins, /data-icon="python" data-disabled/)
  assert.match(origins, /executionId 6f9619ff/)
  // sessionId and artifactId only live in the (closed) developer area of the Python dialog.
  assert.doesNotMatch(origins, /sessionId|artifactId|>session</)
})

test('chips appear only for saved facts and the data table is collapsible', () => {
  const html = r.render(observeTime(6))
  assert.match(html, /Last 12 periods/)
  assert.match(html, /month · Asia\/Shanghai/)
  assert.match(html, /<details class="fv-table">/)
  assert.match(
    r.render(observeTime(6), { display: { dataTable: 'visible' } }),
    /<details class="fv-table" open="">/,
  )
  const bare = observeScalar(1)
  bare.frame.sections.interpretation = { status: 'unavailable', reason: 'read-failed' }
  assert.doesNotMatch(r.render(bare), /fv-chips/)
})

test('no computed numbers: every drawn number is a saved cell', () => {
  // Contributions 1..4 and a total of 10 (equal by fixture); floating ends 3 and 6 are layout.
  const html = r.render(attributeAdditive())
  for (const text of ['>1<', '>2<', '>3<', '>4<', '>10<']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, />6</)
  // Category bars: the sum 6 of revenue 1..3 never appears.
  const bars = r.render(observeCategory(3))
  assert.doesNotMatch(bars, />6</)
})

test('time × category shares draw one 0–100% track per period', () => {
  const html = r.render(
    frame({
      axes: [
        { ...timeAxis(2), keys: repeat(months(2), 3) },
        { ...categoryAxis(3), keys: cycle(labels('r', 3), 2) },
      ],
      values: [
        { name: 'share', values: Array(6).fill(0.3), context: shareOf(axisGroups('region')) },
      ],
    }),
  )
  assert.equal(viewOf(html), 'share')
  assert.equal(count(html, /class="fv-parent" data-parent="/), 2)
  assert.equal(count(html, /data-tick="100%"/), 2)
})

test('week ticks use ISO week labels', () => {
  const week = {
    kind: 'calendar' as const,
    timezone: 'Asia/Shanghai',
    grain: { kind: 'builtin' as const, unit: 'week' as const, step: 1 },
  }
  const html = r.render(observeTime(2, 1, week))
  assert.match(html, />2025-W01</)
  assert.match(html, />2025-W05</)
})

test('saved views that do not resolve show an error instead of another chart', () => {
  const html = r.render(observeTime(6), { view: { chart: 'line', encoding: { axis: 'missing' } } })
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /data-frame-view=/)
})

test('correlation titles name the captured operands; records freeze every key column', () => {
  assert.match(r.render(correlate(false)), /class="fv-title">revenue ↔ orders</)
  assert.match(r.render(records()), /data-frozen="1"/)
})
