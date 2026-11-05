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
    render: async (...args) => strip(await bundled.render(...args)),
    shell: async (...args) => strip(await bundled.shell(...args)),
  }
})
after(async () => {
  await r?.dispose()
})

const viewOf = (html: string) => /data-frame-view="([^"]+)"/.exec(html)?.[1]
const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern, 'g'))?.length ?? 0
const comparisonTable = (html: string) =>
  /<section[^>]*data-table-layout="comparison"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
/** Path `d` attributes of drawn lines; each `M` starts a segment. */
const segments = (html: string) =>
  [...html.matchAll(/<path[^>]*class="recharts-curve recharts-line-curve"[^>]*d="([^"]*)"/g)].map(
    (m) => count(m[1]!, /M/),
  )
const factualText = (html: string) =>
  [...html.matchAll(/<(?:title|desc)>([\s\S]*?)<\/(?:title|desc)>|aria-label="([^"]*)"/g)]
    .map((match) => match[1] ?? match[2])
    .join(' ')
const resolved = (snapshot: FrameSnapshotV2) => {
  const resolution = resolveFrameView(snapshot)
  if (!resolution.ok) throw new Error(resolution.code)
  return resolution
}
// Explanatory copy the principles forbid in Frame views.
const BANNERS =
  /note:|注[:：]|说明[:：]|Evidence|Findings|Methods|方法说明|同比|环比|仅本期|only current|not computed|未计算/i

test('every auto view resolves through the real resolveFrameView and renders its main view', async () => {
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
    ['comparison grid', comparedSinglePeriodMultiGroup(), 'comparison-grid'],
    ['category comparison', compareOrdinary([categoryAxis(3)]), 'comparison'],
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
    const html = await r.render(snapshot)
    assert.equal(viewOf(html), chart, name)
    assert.equal(viewOf(html), resolved(snapshot).view.chart, name)
    assert.doesNotMatch(html, BANNERS, name)
    assert.doesNotMatch(
      html,
      /data-chart-engine="openui"|class="openui-(?:line|area|bar|heatmap)-chart/,
      name,
    )
    if (
      name !== 'category comparison' &&
      !['members', 'table', 'metric', 'comparison-grid'].includes(chart)
    ) {
      assert.match(
        html,
        /<svg(?=[^>]*\brole="application")(?=[^>]*class="recharts-surface")[^>]*>/,
        name,
      )
      assert.match(html, /<section[^>]*class="fv-plot[^"]*"[^>]*aria-label="[^"]+"/, name)
    }
  }
})

test('observation shapes draw lines, areas, bars, heatmaps and frozen record tables', async () => {
  const line = await r.render(observeTime(18))
  assert.equal(segments(line).length, 1)
  assert.match(await r.render(observeTime(6), { view: { chart: 'area' } }), /recharts-area-area/)
  assert.equal(count(await r.render(observeTime(6)), /data-mark="bar"/), 6)
  // Bars read an ordinary category axis as evenly spaced groups; no continuity is implied.
  const categoryBar = await r.render(observeCategory(3), { view: { chart: 'bar' } })
  assert.equal(viewOf(categoryBar), 'bar')
  assert.equal(count(categoryBar, /data-mark="bar"/), 3)
  assert.match(categoryBar, /data-tick="r0"/)
  const interval = await r.render(
    observeTime(4, 1, { kind: 'interval', timezone: 'Asia/Shanghai' }),
  )
  assert.doesNotMatch(interval, /class="recharts-layer recharts-line"/)
  const series = await r.render(observeTimeCategory(3))
  assert.equal(count(series, /class="recharts-layer recharts-line"/), 3)
  assert.match(series, /aria-label="Data series"/)
  assert.match(await r.render(observeMatrix()), /data-mark="cell"/)
  assert.match(await r.render(records()), /class="fv-frozen/)
  // Statistic symbols prefix value names.
  const reduced = await r.render(reduceByMonth())
  assert.match(reduced, /Σ total/)
  assert.match(reduced, /μ average/)
  assert.match(reduced, /# rows/)
})

test('time plots keep SVG marks and point identity across period and series counts', async () => {
  for (const periods of [1, 11, 12, 24]) {
    const html = await r.render(observeTime(periods), { view: { chart: 'line' }, askPoint: true })
    assert.equal(count(html, /class="recharts-layer recharts-line"/), 1)
    assert.equal(count(html, /role="button" tabindex="0"/), periods)
  }
  for (const categories of [7, 8]) {
    const snapshot = observeTimeCategory(categories)
    const html = await r.render(snapshot, { view: { chart: 'line' }, askPoint: true })
    assert.equal(count(html, /class="recharts-layer recharts-line"/), categories)
    assert.equal(count(html, /role="button" tabindex="0"/), snapshot.data.rows.length)
    for (let i = 0; i < categories; i++) assert.match(html, new RegExp(`data-marker="${i}"`))
  }
})

test('category bars remain horizontal in saved row order', async () => {
  const html = await r.render(observeCategory(3))
  const bars = [
    ...html.matchAll(
      /<g data-mark="bar">[\s\S]*?<(?:path|rect)[^>]*width="([\d.]+)" height="([\d.]+)"/g,
    ),
  ]
  assert.equal(bars.length, 3)
  for (const bar of bars) assert.ok(Number(bar[1]) > Number(bar[2]))
  assert.match(html, /r0[\s\S]*r1[\s\S]*r2/)
})

test('a legend is hidden only when it repeats the sole displayed metric', async () => {
  const singleBar = await r.render(observeCategory(3))
  assert.match(singleBar, /class="recharts-surface"/)
  assert.doesNotMatch(singleBar, /aria-label="Data series"/)
  const singleTime = await r.render(observeTime(6))
  assert.doesNotMatch(singleTime, /aria-label="Data series"/)
  const multiTime = await r.render(observeTimeCategory(3))
  assert.match(multiTime, /aria-label="Data series"/)
  const singleGroup = await r.render(
    frame({
      axes: [timeAxis(3), { ...categoryAxis(1), keys: ['m0', 'm0', 'm0'] }],
      values: [value('m0', 3, observed())],
    }),
  )
  assert.match(singleGroup, /aria-label="Data series"/)
  const long = await r.render(observeTime(18))
  assert.doesNotMatch(long, /aria-label="Data series"/)
  const withBroadcast = overBroadcast()
  for (const column of withBroadcast.data.columns) {
    if (column.id === 'revenue' || column.id === 'mean_revenue') column.unit = 'USD'
  }
  const broadcast = await r.render(withBroadcast)
  assert.match(broadcast, /aria-label="Data series"/)
})

test('SVG points expose keyboard activation only in an actionable surface', async () => {
  const snapshot = observeTime(6)
  const actionable = await r.render(snapshot, { askPoint: true })
  assert.equal(count(actionable, /role="button" tabindex="0"/), 6)
  const value =
    snapshot.data.rows[0]![snapshot.data.columns.findIndex((column) => column.id === 'm0')]
  assert.match(actionable, new RegExp(String(value)))
  const readOnly = await r.render(snapshot)
  assert.doesNotMatch(readOnly, /role="button" tabindex="0"/)
})

test('missing observations use the truthful renderer and offer only present values for selection', async () => {
  const snapshot = monthly([0, 2, null, 4])
  const html = await r.render(snapshot, { askPoint: true })
  assert.doesNotMatch(html, /data-chart-engine="openui"/)
  assert.equal(count(html, /data-mark="zero"/), 1)
  assert.doesNotMatch(html, /Select a data point|选择数据点/)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
})

test('heatmap retains sparse axis members and distinguishes missing cells from zero', async () => {
  const snapshot = observeMatrix()
  snapshot.data.rows.splice(0, 1)
  for (const coordinate of Object.values(snapshot.frame.coordinates)) coordinate.values.splice(0, 1)
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.rows[0]![index] = 0
  const html = await r.render(snapshot, { askPoint: true })
  assert.doesNotMatch(html, /data-chart-engine="openui"/)
  assert.match(html, /data-heatmap-missing-count="1"/)
  assert.equal(count(html, /data-mark="empty"/), 0)
  assert.equal(count(html, /data-mark="cell"/), 3)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
  assert.match(html, /data-heatmap-scale=/)
  assert.match(html, /title="0/)
  assert.match(html, /<title>[^<]*: 0\.00<\/title>/)
  assert.doesNotMatch(html, /Row avg|Column avg/)
})

test('heatmap leaves NULL cells empty and selects only saved numeric values', async () => {
  const snapshot = observeMatrix()
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.rows[0]![index] = null
  snapshot.data.rows[1]![index] = 1234567.89
  const html = await r.render(snapshot, { askPoint: true })
  assert.equal(count(html, /data-mark="empty"/), 1)
  assert.equal(count(html, /data-mark="cell"/), 3)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
  assert.match(html, /<title>[^<]*: 1,234,567\.89<\/title>/)
  assert.doesNotMatch(html, /Row avg|Column avg/)
})

test('correlation and saved shares expose data points without selecting reference tracks', async () => {
  const correlation = await r.render(correlate(true), { askPoint: true })
  assert.match(correlation, /role="button" tabindex="0"[^>]*aria-label="[^"]*n /)
  assert.doesNotMatch(correlation, /Select a data point|选择数据点/)
  const shares = await r.render(shareByRegion(), { askPoint: true })
  assert.ok(count(shares, /role="button" tabindex="0"/) > 0)
  assert.doesNotMatch(shares, /Select a data point|选择数据点/)
  assert.doesNotMatch(shares, /data-reference-track[^>]*role="button"/)
})

test('time-category charts facet multiple values, distinguish categories and avoid overlapping endpoints', async () => {
  const snapshot = observeTimeCategory(8, 3)
  for (const name of ['m0', 'm1', 'm2']) {
    const index = snapshot.data.columns.findIndex((column) => column.id === name)
    snapshot.data.columns[index]!.unit = 'USD'
    for (const row of snapshot.data.rows) row[index] = 50
  }
  const html = await r.render(snapshot, { view: { chart: 'line' }, askPoint: true })
  assert.equal(count(html, /<section class="fv-parent"/), 3)
  assert.equal(count(html, /aria-label="Data series"/), 1)
  assert.equal(count(html, /class="recharts-layer recharts-line"/), 24)
  assert.equal(count(html, /data-mark="endpoint-label"/), 0)
  for (let i = 0; i < 8; i++) assert.match(html, new RegExp(`data-marker="${i}"`))
  // Every equal-valued point remains represented in its own series and exposes its formatted value.
  assert.equal(count(html, /data-mark="filled"/), 72)
  assert.equal(count(html, /role="button" tabindex="0" aria-label="[^"]*: \$50\.00"/), 72)
})

test('single-period plots use a compact height without overriding an explicit height', async () => {
  const snapshot = frame({
    axes: [
      { ...timeAxis(1), keys: repeat(months(1), 3) },
      { ...categoryAxis(3), keys: labels('r', 3) },
    ],
    values: [{ name: 'amount', values: [1, 2, 3] }],
  })
  assert.match(await r.render(snapshot, { view: { chart: 'line' } }), /viewBox="0 0 \d+ 160"/)
  assert.match(
    await r.render(snapshot, { view: { chart: 'line' }, display: { height: 200 } }),
    /viewBox="0 0 \d+ 200"/,
  )
})

test('long time series retain distinguishing markers and never connect null gaps', async () => {
  const snapshot = frame({
    axes: [
      { ...timeAxis(45), keys: repeat(months(45), 2) },
      { ...categoryAxis(2), keys: cycle(labels('r', 2), 45) },
    ],
    values: [
      { name: 'amount', values: Array.from({ length: 90 }, (_, i) => (i === 40 ? null : i)) },
    ],
  })
  const html = await r.render(snapshot, { view: { chart: 'line' } })
  assert.equal(segments(html).length, 2)
  assert.ok(segments(html).some((segment) => segment === 2))
  assert.ok(count(html, /data-marker="0"/) >= 10)
  assert.ok(count(html, /data-marker="1"/) >= 10)
  assert.match(html, /<title>2025/)
})

test('Frame titles reflect the values actually selected for observation charts', async () => {
  for (const chart of ['line', 'area', 'bar'] as const) {
    const html = await r.render(observeTime(3, 2), {
      view: { chart, encoding: { values: ['m1'] } },
    })
    const title = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(html)?.[1]
    assert.match(title ?? '', /m1/)
    assert.doesNotMatch(title ?? '', /m0/)
  }
  const metric = await r.render(observeScalar(2), {
    view: { chart: 'metric', encoding: { value: 'm1' } },
  })
  assert.match(metric, /<div data-slot="card-title"[^>]*>m1(?: \([^)]*\))?<\/div>/)
  const heatmap = await r.render(observeMatrix(2), {
    view: { chart: 'heatmap', encoding: { x: 'region', y: 'channel', value: 'm1' } },
  })
  const title = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(heatmap)?.[1]
  assert.match(title ?? '', /m1/)
  assert.doesNotMatch(title ?? '', /m0/)
  const broadcast = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(
    await r.render(overBroadcast(6)),
  )?.[1]
  assert.match(broadcast ?? '', /revenue/)
  assert.match(broadcast ?? '', /mean_revenue/)
  const table = await r.render(observeTime(3, 2), { view: { chart: 'table', columns: ['m1'] } })
  const tableTitle = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(table)?.[1]
  assert.match(tableTitle ?? '', /m0/)
  assert.match(tableTitle ?? '', /m1/)
})

test('heatmap scale shows saved bounds and omits a scale when all values are missing', async () => {
  const snapshot = observeMatrix()
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.columns[index]!.unit = 'USD'
  snapshot.data.rows[0]![index] = -2
  snapshot.data.rows[1]![index] = 5
  const html = await r.render(snapshot)
  assert.match(html, /data-heatmap-scale="diverging"/)
  assert.match(html, /m0 \(USD\)/)
  assert.match(html, /title="-\$2\.00"/)
  assert.match(html, /title="\$5\.00"/)
  for (const row of snapshot.data.rows) row[index] = null
  const empty = await r.render(snapshot)
  assert.doesNotMatch(empty, /data-heatmap-scale=/)
  assert.match(empty, /data-mark="empty"/)
})

test('dense time labels retain both endpoints without crowding the final label', async () => {
  const axis = timeAxis(30, {
    kind: 'calendar',
    timezone: 'Asia/Shanghai',
    grain: { kind: 'builtin', unit: 'day', step: 1 },
  })
  axis.keys = Array.from(
    { length: 30 },
    (_, i) => `2025-06-${String(i + 1).padStart(2, '0')}T00:00:00+08:00`,
  )
  const html = await r.render(
    frame({ axes: [axis], values: [{ name: 'value', values: Array(30).fill(1) }] }),
  )
  const ticks = [...html.matchAll(/<g transform="translate\(([^,]+),[^)]*\)" data-tick="([^"]+)"/g)]
  assert.ok(ticks.length >= 2 && ticks.length < 30)
  assert.equal(ticks[0]?.[2], '06-01')
  assert.equal(ticks.at(-1)?.[2], '06-30')
  assert.ok(ticks.slice(1).every((tick, index) => Number(tick[1]) - Number(ticks[index]![1]) >= 60))
})

test('long month labels have room while keeping the endpoints', async () => {
  const html = await r.render(observeTime(12))
  const ticks = [...html.matchAll(/<g transform="translate\(([^,]+),[^)]*\)" data-tick="([^"]+)"/g)]
  assert.equal(ticks[0]?.[2], '2025-01')
  assert.equal(ticks.at(-1)?.[2], '2025-12')
  assert.ok(ticks.slice(1).every((tick, index) => Number(tick[1]) - Number(ticks[index]![1]) >= 55))
})

test('category charts switch measures while time charts use separate scales', async () => {
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
  const mixed = await r.render(snapshot)
  assert.equal(count(mixed, /class="fv-chart /), 1)
  assert.match(mixed, /trips/)
  assert.match(mixed, /fare \(USD\)/)
  snapshot.data.columns.find((column) => column.id === 'fare')!.unit = '1'
  const shared = await r.render(snapshot)
  assert.equal(count(shared, /class="fv-chart /), 1)

  const time = frame({
    axes: [timeAxis(3)],
    values: [
      { name: 'trips', values: [1, 2, 3] },
      { name: 'fare', values: [4, 5, 6] },
    ],
  })
  time.data.columns.find((column) => column.id === 'trips')!.unit = '1'
  time.data.columns.find((column) => column.id === 'fare')!.unit = 'USD'
  assert.equal(count(await r.render(time), /class="fv-chart /), 2)
})

test('broadcast values are reference lines labelled with the saved partition value', async () => {
  const time = await r.render(overBroadcast(6))
  assert.equal(count(time, /mv-broadcast-reference/), 1)
  assert.match(time, /μ mean_revenue/)
  const bars = await r.render(categoryBroadcast())
  assert.equal(count(bars, /mv-broadcast-reference/), 1)
  assert.match(bars, /9,000\.00/)
  // The broadcast value is not drawn as its own bar series.
  assert.equal(count(bars, /data-mark="bar"/), 3)
})

test('NA draws no mark and breaks the line; 0 is drawn on the baseline', async () => {
  const na = await r.render(monthly([1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))
  assert.deepEqual(segments(na), [2])
  assert.match(na, /—/)
  const bars = await r.render(monthly([0, 2, null, 4]))
  assert.equal(count(bars, /data-mark="zero"/), 1)
  assert.equal(count(bars, /data-mark="bar"/), 2)
})

test('a missing period keeps its tick and leaves a gap', async () => {
  const html = await r.render(
    monthly([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], {
      periods: 14,
      rows: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    }),
  )
  assert.match(factualText(html), /2025-03/)
  assert.match(html, /data-tick="2025-03"/)
  assert.deepEqual(segments(html), [2])
})

test('an incomplete period draws a hollow point or a hatched bar with both bounds in the tooltip', async () => {
  const actual = { 1: '2025-02-10T00:00:00+08:00' }
  const line = await r.render(
    monthly(
      Array.from({ length: 14 }, (_, i) => i + 1),
      { actual },
    ),
  )
  assert.equal(count(line, /data-mark="hollow"/), 1)
  assert.match(line, /Actual 2025-02-10 00:00 – 2025-03-01 00:00\nNominal 2025-02-01 00:00/)
  const bars = await r.render(monthly([1, 2, 3], { actual }))
  assert.equal(count(bars, /data-mark="hatched"/), 1)
})

test('calendar periods use saved labels and selection states without invented bounds', async () => {
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
  const html = await r.render(parseAnalysisSnapshot(snapshot))
  assert.match(html, /data-tick="2025-01"/)
  assert.match(html, /Full period/)
  assert.match(html, /Period prefix, local cutoff: 2025-02-15T12:00:00.000000/)
  assert.match(html, /Partial period/)
  assert.match(html, /Period selection unavailable/)
  assert.equal(count(html, /data-mark="hatched"/), 3)
  assert.doesNotMatch(html, /Nominal |Actual /)
})

test('category comparison masks absent sides and retains saved changes on the matching row', async () => {
  for (const presence of [
    [true, false, true, true],
    [false, true, true, true],
  ]) {
    const snapshot = comparedCategories(presence)
    const relative = snapshot.data.columns.findIndex(
      (column) => column.id === 'prior.relative.sales',
    )
    snapshot.data.rows.forEach((row, index) => {
      row[relative] = (index + 1) / 10
    })
    const html = await r.render(snapshot)
    assert.equal(viewOf(html), 'comparison')
    const rows = [...html.matchAll(/<tr><th scope="row">r(\d+)<\/th>([\s\S]*?)<\/tr>/g)]
    assert.equal(rows.length, presence.length)
    for (const [, index, cells] of rows) {
      const expected = `▲${(Number(index) + 1) * 10}.00%`
      if (presence[Number(index)]) assert.ok(cells!.includes(expected))
      else assert.ok(!cells!.includes(expected))
    }
  }
})

test('saved field names cannot collide with plot row or label metadata', async () => {
  for (const name of ['savedEndLabel', 'index', 'values']) {
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(JSON.stringify(shareByRegion()).replaceAll('revenue_share', name)),
    )
    const html = await r.render(snapshot, { askPoint: true })
    const chart = html.match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0] ?? ''
    assert.equal(count(chart, /data-chart-end-label=""/), 3)
    assert.equal(count(chart, /data-chart-end-label=""[^>]*>25\.00%<\/text>/), 3)
    for (let row = 0; row < 3; row++) {
      assert.ok(chart.includes(`data-frame-point="${row}:${name}"`), `${name}: saved row ${row}`)
    }
  }
})

test('restricted decompositions detach the total; has_more falls back to a table', async () => {
  const closed = await r.render(attributeAdditive())
  assert.match(closed, /mv-connector-total/)
  assert.match(closed, /data-mark-total="closed"/)
  const restricted = await r.render(attributeAdditive({ rowScope: 'restricted' }))
  assert.doesNotMatch(restricted, /mv-connector-total/)
  assert.match(restricted, /data-mark-total="detached"/)
  for (const [snapshot, coverage] of [
    [attributeAdditive({ total: 9 }), '4/9'],
    [attributeShare(9), '3/9'],
    [observeCategory(3, 9), '3/9'],
    [shareByRegion(3, 9), '3/9'],
  ] as const) {
    const html = await r.render(snapshot)
    assert.equal(viewOf(html), 'table')
    assert.match(html, new RegExp(`<span>${coverage}</span>`))
  }
})

test('a missing decomposition contribution is marked and does not close the waterfall', async () => {
  const snapshot = attributeAdditive()
  const index = snapshot.data.columns.findIndex((column) => column.id === 'contribution')
  snapshot.data.columns[index]!.nullable = true
  snapshot.data.rows[1]![index] = null
  const html = await r.render(snapshot)
  assert.match(html, /data-mark-total="detached"/)
  assert.doesNotMatch(html, /mv-connector-total/)
  assert.match(html, /—/)
})

test('comparison numbers label saved changes and keep direction marks', async () => {
  const html = await r.render(
    comparedScalar({ current: 120, baseline: 100, absolute: 7, relative: 0.5 }),
  )
  assert.equal(viewOf(html), 'comparison')
  // Δ and Δ% are the saved (deliberately inconsistent) cells, never current − baseline.
  assert.match(html, /▲7\.00</)
  assert.match(html, /▲50\.00%/)
  assert.doesNotMatch(html, /▲20\b|▲20%/)
  assert.match(html, /<dt>Change<\/dt><dd>▲7\.00/)
  assert.match(html, /<dt>Change rate<\/dt><dd>▲50\.00%/)
  assert.match(html, /<dt[^>]*>west<\/dt>/)
  assert.match(html, /<dt[^>]*>east<\/dt>/)
  const zero = await r.render(
    comparedScalar({ current: 5, baseline: 0, absolute: 5, relative: null }),
  )
  assert.match(zero, /<dt>Change rate<\/dt><dd>—<\/dd>/)
  const down = await r.render(
    comparedScalar({ current: 1, baseline: 2, absolute: -1, relative: -0.5 }),
  )
  assert.match(down, /▼1\.00</)
  assert.match(down, /▼50\.00%/)
  assert.doesNotMatch(down, /#(?:e34948|008300|ff0000|00ff00)|\bred\b|\bgreen\b/i)
  const flat = await r.render(comparedScalar({ current: 1, baseline: 1, absolute: 0, relative: 0 }))
  assert.match(flat, /<dt>Change<\/dt><dd>0\.00</)
  assert.match(flat, /<dt>Change rate<\/dt><dd>0\.00%/)
  const tiny = await r.render(
    comparedScalar({ current: 1, baseline: 1, absolute: -0.00001, relative: -0.000001 }),
  )
  assert.match(tiny, /▼0\.00</)
  assert.match(tiny, /▼&lt;0\.01%/)
  const tinyUp = await r.render(
    comparedScalar({ current: 1, baseline: 1, absolute: 0.00001, relative: 0.000001 }),
  )
  assert.match(tinyUp, /▲0\.00</)
  assert.match(tinyUp, /▲&lt;0\.01%/)
})

test('a single-row multi-group comparison is one headline block per metric', async () => {
  const html = await r.render(comparedSinglePeriodMultiGroup())
  assert.equal(viewOf(html), 'comparison-grid')
  assert.equal(count(html, /<section[^>]*data-comparison-group=/), 2)
  for (const name of ['sales', 'orders'])
    assert.match(html, new RegExp(`data-comparison-group="${name}"[\\s\\S]*?<h4[^>]*>${name}</h4>`))
  // Four saved numbers per metric: current, baseline, Δ, Δ%.
  const block =
    /<section[^>]*data-comparison-group="sales"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  assert.equal(count(block, /<dt(?:\s[^>]*)?>/), 4)
  for (const label of ['Current', 'Baseline', 'Change', 'Change rate'])
    assert.ok(block.includes(`>${label}</dt>`), label)
  // Each endpoint label precedes its saved value; the baseline and changes follow the current value.
  const currentLabel = block.indexOf('>Current</dt>')
  const baselineLabel = block.indexOf('>Baseline</dt>')
  const deltaLabel = block.indexOf('>Change</dt>')
  const rateLabel = block.indexOf('>Change rate</dt>')
  assert.ok(currentLabel < baselineLabel && baselineLabel < deltaLabel && deltaLabel < rateLabel)
  // Raw role column ids stay out of the visible text; the detailed table is the data entry.
  const text = html.replace(/<[^>]+>/g, ' ')
  assert.doesNotMatch(text, /prior\.(?:baseline|absolute|relative)\./)
  assert.match(html, /data-icon="data"/)
  assert.doesNotMatch(html, /<div data-slot="card-title"[^>]*>Current ⇄ Baseline<\/div>/)
  assert.doesNotMatch(html, /role="heading" aria-level="3"[^>]*><\/div>/)
})

test('a frame table shows grouped values without an exact-value tooltip', async () => {
  const html = await r.render(
    frame({
      axes: [categoryAxis(2)],
      values: [{ name: 'amount', values: [118393545.04998468, 8] }],
    }),
    { view: { chart: 'table' } },
  )
  assert.match(html, />118,393,545\.05</)
  assert.doesNotMatch(html, /118393545\.04998468/)
})

test('interval comparison endpoints name inclusive civil months', async () => {
  const html = await r.render(comparedIntervalMonth())
  assert.equal(viewOf(html), 'comparison-grid')
  assert.match(html, /<dt[^>]*>2025-06<\/dt>/)
  assert.match(html, /<dt[^>]*>2025-05<\/dt>/)
  assert.match(html, /<div data-slot="card-title"[^>]*>2025-06 ⇄ 2025-05<\/div>/)
  assert.doesNotMatch(html, /07-01/)
  assert.doesNotMatch(html, /06-01 – 07-01/)
})

test('comparison table titles show captured endpoints only when specific', async () => {
  const generic = await r.render(comparedSinglePeriodMultiGroup(), { view: { chart: 'table' } })
  assert.doesNotMatch(generic, /<div data-slot="card-title"[^>]*>Current ⇄ Baseline<\/div>/)
  const specific = await r.render(comparedIntervalMonth(), { view: { chart: 'table' } })
  assert.match(specific, /<div data-slot="card-title"[^>]*>2025-06 ⇄ 2025-05<\/div>/)
})

test('time comparison draws a solid current line, dashed baseline and a Δ strip', async () => {
  const html = await r.render(compareCalendar(6))
  assert.match(html, /stroke-dasharray="5 4"/)
  assert.equal(segments(html).length, 2)
  assert.match(html, /data-strip="delta"/)
  const periods = await r.render(comparedCalendarWithPeriods(3))
  assert.match(periods, /data-icon="periods"/)
  assert.match(periods, /2025-01 – 2025-03 ⇄ 2026-01 – 2026-03/)
})

test('category comparisons draw a dumbbell, a delta bar, small multiples and alias segments', async () => {
  const comparison = await r.render(compareOrdinary([categoryAxis(3)]))
  assert.match(comparison, /data-comparison-rows="delta"/)
  const delta = await r.render(compareOrdinary([categoryAxis(3)]), {
    view: { chart: 'comparison', style: 'delta' },
  })
  assert.doesNotMatch(delta, /mv-domain-link/)
  assert.equal(count(delta, /class="fv-delta-bar /), 3)
  const multiples = await r.render(comparedTimeCategory())
  assert.equal(count(multiples, /data-multiple="/), 3)
  const aliases = await r.render(twoAliases(), {
    view: { chart: 'comparison', encoding: { value: 'lastyear.baseline.sales' } },
  })
  assert.match(aliases, /class="fv-segments"/)
  assert.match(aliases, /aria-pressed="true"[^>]*>lastyear</)
  assert.match(aliases, /aria-pressed="false"[^>]*>plan</)

  const withSavedMembers = twoAliases()
  const source = comparedScalar({ current: 1, baseline: 2, absolute: -1, relative: -0.5 })
  const targetFacts = withSavedMembers.frame.sections.interpretation
  const sourceFacts = source.frame.sections.interpretation
  if (targetFacts.status !== 'captured' || sourceFacts.status !== 'captured')
    throw new Error('Expected captured comparison facts')
  targetFacts.comparisons[0]!.currentFixedAxes = sourceFacts.comparisons[0]!.currentFixedAxes
  targetFacts.comparisons[0]!.baselineFixedAxes = sourceFacts.comparisons[0]!.baselineFixedAxes
  const mixed = await r.render(withSavedMembers, {
    view: { chart: 'comparison', encoding: { value: 'lastyear.baseline.sales' } },
  })
  // A captured endpoint is clearer than its alias; the incomplete pair still uses its alias.
  assert.match(mixed, /aria-pressed="true"[^>]*>east</)
  assert.match(mixed, /aria-pressed="false"[^>]*>plan</)
  assert.doesNotMatch(mixed, /aria-pressed="true"[^>]*>lastyear</)
})

test('decompositions draw the waterfall, effect segments with ◆ and the share track', async () => {
  const waterfall = await r.render(attributeAdditive())
  assert.equal(count(waterfall, /mv-connector"/), 3)
  assert.match(waterfall, /data-number="total"/)
  const effects = await r.render(attributeEffects())
  assert.equal(count(effects, /data-mark="contribution"/), 3)
  assert.match(effects, /Within/)
  assert.match(effects, /Mix/)
  const share = await r.render(attributeShare(), {
    view: { chart: 'decomposition', style: 'share' },
  })
  assert.match(share, />0\.00%/)
  assert.match(share, /100\.00%/)
  assert.match(share, /20\.00%/)
  assert.match(share, /50\.00%/)
})

test('the share track extends below 0 and above 100%', async () => {
  const s = shareByRegion()
  const index = s.data.columns.findIndex((c) => c.id === 'revenue_share')
  s.data.rows.forEach((row, i) => {
    row[index] = [-0.2, 0.5, 1.4][i]!
  })
  const html = await r.render(s)
  assert.match(html, /-20\.00%/)
  assert.match(html, /140\.00%/)
})

test('correlation dots sit on a fixed [-1, 1] axis; NA draws no point and keeps n_pairs', async () => {
  const s = correlate(true)
  s.data.rows[1]![1] = null
  s.data.columns[1]!.nullable = true
  const html = await r.render(s)
  assert.equal(viewOf(html), 'correlation')
  assert.equal(count(html, /data-mark="filled"/), 2)
  for (const tick of ['-1', '0', '1']) assert.match(html, new RegExp(`>${tick}</(?:tspan|text)>`))
  assert.ok(count(factualText(html), /n 30/) >= 3)
  assert.match(html, /—/)
  const scalar = await r.render(correlate(false, 'spearman'))
  assert.match(scalar, /<dt[^>]*>ρ<\/dt>/)
  assert.match(scalar, /<dt[^>]*>n<\/dt>/)
})

test('align draws hollow left and filled right pairs, or two lines on a paired axis', async () => {
  const dumbbell = await r.render(align(categoryAxis(3)))
  assert.equal(count(dumbbell, /mv-domain-link/), 3)
  assert.match(dumbbell, /aria-pressed="true"/)
  assert.match(dumbbell, /left\.revenue/)
  const line = await r.render(align(pairedAxis(3)))
  assert.equal(segments(line).length, 4)
  // Unmatched subjects draw no pairs; both sides stay in the saved table.
  const unmatched = await r.render(align(categoryAxis(3), ['sales.aov', 'sales.margin']))
  assert.equal(count(unmatched, /mv-domain-link/), 0)
  assert.match(unmatched, /data-column-id="right\.orders"/)
})

test('paired-time alignment separates USD and count subjects into independent plots', async () => {
  const snapshot = align(pairedAxis(3))
  for (const column of snapshot.data.columns) {
    if (column.id.endsWith('.revenue')) column.unit = 'USD'
    if (column.id.endsWith('.orders')) column.unit = 'count'
  }
  for (const slot of snapshot.frame.slots) {
    if (slot.id.endsWith('.revenue')) slot.unit = 'USD'
    if (slot.id.endsWith('.orders')) slot.unit = 'count'
  }
  const parsed = parseAnalysisSnapshot(snapshot)
  if (parsed.kind !== 'frame') throw new Error('frame-required')
  const html = await r.render(parsed)
  const plots = [...html.matchAll(/data-alignment-pair="([^"]+)"[\s\S]*?<\/figure>/g)]
  assert.equal(plots.length, 2)
  assert.equal(plots[0]![1], 'left.revenue:right.revenue')
  assert.equal(plots[1]![1], 'left.orders:right.orders')
  assert.doesNotMatch(plots[0]![0], /left\.orders|right\.orders/)
  assert.doesNotMatch(plots[1]![0], /left\.revenue|right\.revenue/)
  assert.equal(count(html, /class="recharts-wrapper"/), 2)
})

test('coincident comparison and alignment dots retain both roles; absent sides remain absent', async () => {
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
  const comparison = await r.render(compared)
  assert.match(comparison, /data-comparison-rows="delta"/)
  assert.doesNotMatch(comparison, /777,777|888,888|666,666|555,555/)

  const aligned = align(categoryAxis(4))
  const column = (id: string) => aligned.data.columns.findIndex((item) => item.id === id)
  aligned.data.rows[1]![column('right_present')] = false
  aligned.data.rows[1]![column('right.revenue')] = 999999
  aligned.data.rows[2]![column('right.revenue')] = 3.00000001
  aligned.data.rows[3]![column('right.revenue')] = 8
  const alignedChart =
    (await r.render(aligned)).match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0] ?? ''
  assert.match(alignedChart, /data-mark="hollow"/)
  assert.match(alignedChart, /data-mark="filled"/)
  assert.match(alignedChart, /3\.00/)
  assert.doesNotMatch(alignedChart, /999,999/)
})

test('time comparison tooltip and accessible summary honor side presence', async () => {
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
  const chart =
    (await r.render(snapshot)).match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0] ?? ''
  assert.doesNotMatch(factualText(chart), /777777|888888|666666|555555|432100|0\.4321/)
  assert.match(chart, /—/)
})

test('comparison changes require both direct endpoints but ignore enclosing and unknown presence', async () => {
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
    const html = await r.render(snapshot, { view })
    const facts = html
    for (const i of [1, 2, 3])
      assert.doesNotMatch(facts, new RegExp(`800,00${1 + i}\\.00|45\\.${(1 + i) * 10}%`))
    assert.match(facts, /800,001\.00/)
    assert.match(facts, /800,005\.00/)
    // Detailed comparison retains endpoint masking for absent sides.
    const details = await r.render(snapshot, { view, display: { dataTable: 'visible' } })
    assert.match(details, /800,001\.00/)
    assert.doesNotMatch(details, /800,002\.00/)
  }
})

test('comparison numbers and transposed tables mask changes for explicitly absent sides', async () => {
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
  const grid = await r.render(snapshot)
  assert.equal(viewOf(grid), 'comparison-grid')
  assert.doesNotMatch(grid, /432100|432,100|43,210,000/)
  // Absent baseline roles are omitted from headline blocks; Δ and Δ% stay masked.
  assert.ok(count(grid, /—/) >= 4)
  const table = comparisonTable(await r.render(snapshot, { view: { chart: 'table' } }))
  assert.doesNotMatch(table, /432100|432,100|43,210,000/)
  assert.ok(count(table, /—/) >= 6)
  const numbers = await r.render(snapshot, {
    view: { chart: 'comparison', encoding: { value: 'sales' } },
  })
  const values = /<dl class="fv-kpi-values[^"]*">[\s\S]*?<\/dl>/.exec(numbers)?.[0] ?? ''
  assert.doesNotMatch(values, /432100|432,100|43,210,000/)
  assert.ok(count(values, /—/) >= 2)
  assert.doesNotMatch(numbers, /432100/)
})

test('nearby comparison endpoints preserve rounded saved values in the category view', async () => {
  const snapshot = comparedCategories(Array(6).fill(true))
  const baseline = snapshot.data.columns.findIndex((column) => column.id === 'prior.baseline.sales')
  for (const [i, value] of [1.004, 2.02, 3.08, 4.15, 5.3, 9].entries())
    snapshot.data.rows[i]![baseline] = value
  const html = await r.render(snapshot)
  assert.match(html, /data-comparison-rows="delta"/)
  assert.match(html, /1\.00/)
  assert.match(html, /2\.02/)
  assert.match(html, /3\.08/)
})

test('alignment chart labels and descriptions honor side presence', async () => {
  for (const axis of [categoryAxis(3), pairedAxis(3)]) {
    const snapshot = align(axis)
    const rightPresent = snapshot.data.columns.findIndex((column) => column.id === 'right_present')
    const rightRevenue = snapshot.data.columns.findIndex((column) => column.id === 'right.revenue')
    snapshot.data.rows[0]![rightPresent] = false
    snapshot.data.rows[0]![rightRevenue] = 987654321
    const html = await r.render(snapshot)
    const chart = html.match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0]
    assert.ok(chart)
    assert.doesNotMatch(chart, /987654321|988M/)
    assert.match(chart, /—/)
  }
})

test('members show the saved count and a compact key preview', async () => {
  const html = await r.render(members())
  assert.match(html, /data-number="members"><dd[^>]*>3</)
  assert.match(html, /class="fv-members-key"/)
  assert.match(html, /data-icon="data"/)
})

test('composite member keys retain the requested table height', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3, 'identity'), { ...categoryAxis(3, 'identity'), name: 'district' }],
  })
  const html = await r.render(snapshot, { display: { height: 150 } })
  assert.match(html, /max-height:\s*150px/)
  assert.match(html, /data-column-id="region"/)
  assert.match(html, /data-column-id="district"/)
})

test('main views accept a hand-built resolution and never re-derive class or shape', async () => {
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
    const html = await r.shell(s, c, view)
    assert.equal(viewOf(html), view.chart)
    assert.match(html, /Σ m0/)
  }
  const table = await r.shell(s, c, { chart: 'table', columns: ['m0'] })
  assert.match(table, /data-column-id="m0"/)
  assert.doesNotMatch(table, /data-column-id="month"/)
})

test('compact density keeps the name, header numbers or the main view and only useful icons', async () => {
  const kpi = await r.render(
    comparedScalar({ current: 120, baseline: 100, absolute: 20, relative: 0.2 }),
    {
      display: { density: 'compact' },
    },
  )
  assert.match(kpi, /data-density="compact"/)
  assert.match(kpi, /class="fv-kpi-values"/)
  assert.equal(count(kpi, /data-icon="/), 1)
  assert.match(kpi, /data-icon="data"/)
  assert.doesNotMatch(kpi, /<details/)
  assert.doesNotMatch(kpi, /fv-chips/)
  const trend = await r.render(observeTime(18), { display: { density: 'compact' } })
  assert.match(trend, /class="recharts-surface"/)
  assert.equal(count(trend, /data-icon="/), 1)
  assert.match(trend, /data-icon="data"/)
  const periods = await r.render(comparedCalendarWithPeriods(3), {
    display: { density: 'compact' },
  })
  assert.equal(count(periods, /data-icon="/), 2)
  assert.match(periods, /data-icon="periods"/)
})

test('icons grey out for missing sections and Python sources, never as zero items', async () => {
  const html = await r.render(observeCategory(3, 9))
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
  assert.doesNotMatch(await r.render(observeTime(6)), /data-icon="coverage"/)
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
  const origins = await r.render(s, {
    codeRef: { executionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sha256: 'a'.repeat(64) },
    readCode: true,
  })
  assert.doesNotMatch(origins, /data-icon="origins" data-disabled/)
  assert.match(origins, /sales\.revenue/)
  // The source icon carries no count badge; the dialog lists the deduplicated objects.
  assert.doesNotMatch(origins, /<span>1<\/span>/)
  assert.doesNotMatch(origins, /data-icon="python" data-disabled/)
  assert.match(origins, /executionId 6f9619ff/)
  // sessionId and artifactId only live in the (closed) developer area of the Python dialog.
  assert.doesNotMatch(origins, /sessionId|artifactId|>session</)
})

test('chart data shares the icon row and explicit visible data stays inline', async () => {
  const html = await r.render(observeTime(6))
  assert.match(html, /Last 12 periods/)
  assert.match(html, /month · Asia\/Shanghai/)
  assert.match(html, /<div class="fv-icons(?: [^"]*)?"><span class="fv-icon" data-icon="data"/)
  assert.match(html, /data-icon="data"[\s\S]*aria-haspopup="dialog"/)
  // The chart data entry is an icon like the rest of the row, not a text link.
  assert.doesNotMatch(html, /fv-data-label|Table ↗/)
  const visible = await r.render(observeTime(6), { display: { dataTable: 'visible' } })
  assert.match(visible, /data-icon="data"[\s\S]*aria-expanded="true"/)
  assert.match(visible, /class="fv-data-reference"/)
  assert.doesNotMatch(visible, />6 rows</)
  const bare = observeScalar(1)
  bare.frame.sections.interpretation = { status: 'unavailable', reason: 'read-failed' }
  assert.doesNotMatch(await r.render(bare), /fv-chips/)
})

test('table-shaped main views retain the data entry', async () => {
  for (const snapshot of [records(), members()]) {
    for (const display of [undefined, { dataTable: 'visible' as const }]) {
      const html = await r.render(snapshot, { display })
      assert.match(html, /data-icon="data"/)
      if (display) assert.match(html, /class="fv-data-reference"/)
    }
  }
  // A single-row comparison defaults to headline blocks and keeps the table behind the data icon.
  const multi = comparedSinglePeriodMultiGroup()
  const grid = await r.render(multi, { display: { dataTable: 'visible' } })
  assert.match(grid, /data-icon="data"[\s\S]*class="fv-data-reference"/)
  const literal = await r.render(multi, { view: { chart: 'table' } })
  assert.match(literal, /<table/)
  assert.match(literal, /data-icon="data"/)
  const comparison = compareOrdinary([categoryAxis(3)])
  const comparisonResolution = resolved(comparison)
  assert.equal(comparisonResolution.view.chart, 'comparison')
  if (comparisonResolution.view.chart === 'comparison') {
    const html = await r.shell(comparison, comparisonResolution.classification, {
      ...comparisonResolution.view,
      style: 'table',
    })
    assert.match(html, /<table/)
    assert.match(html, /data-icon="data"/)
  }
  const alignment = align(categoryAxis(3))
  const alignmentResolution = resolved(alignment)
  assert.equal(alignmentResolution.view.chart, 'alignment')
  if (alignmentResolution.view.chart === 'alignment') {
    const html = await r.shell(alignment, alignmentResolution.classification, {
      ...alignmentResolution.view,
      style: 'table',
    })
    assert.match(html, /<table/)
    assert.match(html, /data-icon="data"/)
  }
})

test('no computed numbers: every drawn number is a saved cell', async () => {
  // Contributions 1..4 and a total of 10 (equal by fixture); floating ends 3 and 6 are layout.
  const html = await r.render(attributeAdditive())
  const facts = factualText(html)
  for (const saved of [1, 2, 3, 4, 10])
    assert.match(facts, new RegExp(`(?:r[0-3]|total) ${saved}\\.00(?:[\\s;<]|$)`))
  assert.doesNotMatch(facts, /contribution: 6\.00(?:[\s;<]|$)/)
  // Category bars: the sum 6 of revenue 1..3 never appears.
  const bars = await r.render(observeCategory(3))
  assert.doesNotMatch(factualText(bars), /revenue: 6\.00(?:[\s;<]|$)/)
})

test('time × category shares draw one 0–100% track per period', async () => {
  const html = await r.render(
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
  assert.equal(count(html, /class="recharts-surface"/), 2)
  assert.ok(count(html, /100%/) >= 2)
})

test('week ticks use ISO week labels', async () => {
  const week = {
    kind: 'calendar' as const,
    timezone: 'Asia/Shanghai',
    grain: { kind: 'builtin' as const, unit: 'week' as const, step: 1 },
  }
  const html = await r.render(observeTime(2, 1, week))
  assert.match(html, />2025-W01</)
  assert.match(html, />2025-W05</)
})

test('saved views that do not resolve show an error instead of another chart', async () => {
  const html = await r.render(observeTime(6), {
    view: { chart: 'line', encoding: { axis: 'missing' } },
  })
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /data-frame-view=/)
})

test('correlation titles name the captured operands; records freeze every key column', async () => {
  assert.match(await r.render(correlate(false)), /class="[^"]*fv-title"[^>]*>revenue ↔ orders</)
  assert.match(await r.render(records()), /data-frozen="1"/)
})
