import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type FrameSnapshotV2,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import {
  align,
  attributeAdditive,
  attributeEffects,
  axisGroups,
  categoryAxis,
  compareCalendar,
  compareOrdinary,
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
  value,
} from './frame-fixtures.ts'
import {
  categoryBroadcast,
  comparedSinglePeriodMultiGroup,
  monthly,
} from './frame-render-fixtures.ts'
import {
  count,
  factualText,
  resolved,
  segments,
  sharedRenderer,
  viewOf,
} from './frame-render-helpers.ts'

const r = sharedRenderer()

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
    const html = await r().render(snapshot)
    assert.equal(viewOf(html), chart, name)
    assert.equal(viewOf(html), resolved(snapshot).view.chart, name)
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
  const line = await r().render(observeTime(18))
  assert.equal(segments(line).length, 1)
  assert.match(await r().render(observeTime(6), { view: { chart: 'area' } }), /recharts-area-area/)
  assert.equal(count(await r().render(observeTime(6)), /data-mark="bar"/), 6)
  // Bars read an ordinary category axis as evenly spaced groups; no continuity is implied.
  const categoryBar = await r().render(observeCategory(3), { view: { chart: 'bar' } })
  assert.equal(viewOf(categoryBar), 'bar')
  assert.equal(count(categoryBar, /data-mark="bar"/), 3)
  assert.match(categoryBar, /data-tick="r0"/)
  const interval = await r().render(
    observeTime(4, 1, { kind: 'interval', timezone: 'Asia/Shanghai' }),
  )
  assert.doesNotMatch(interval, /class="recharts-layer recharts-line"/)
  const series = await r().render(observeTimeCategory(3))
  assert.equal(count(series, /class="recharts-layer recharts-line"/), 3)
  assert.match(series, /aria-label="Data series"/)
  assert.match(await r().render(observeMatrix()), /data-mark="cell"/)
  assert.match(await r().render(records()), /class="fv-frozen/)
  // Statistic symbols prefix value names.
  const reduced = await r().render(reduceByMonth())
  assert.match(reduced, /Σ total/)
  assert.match(reduced, /μ average/)
  assert.match(reduced, /# rows/)
})

test('time plots keep SVG marks and point identity across period and series counts', async () => {
  for (const periods of [1, 11, 12, 24]) {
    const html = await r().render(observeTime(periods), { view: { chart: 'line' }, askPoint: true })
    assert.equal(count(html, /class="recharts-layer recharts-line"/), 1)
    assert.equal(count(html, /role="button" tabindex="0"/), periods)
  }
  for (const categories of [7, 8]) {
    const snapshot = observeTimeCategory(categories)
    const html = await r().render(snapshot, { view: { chart: 'line' }, askPoint: true })
    assert.equal(count(html, /class="recharts-layer recharts-line"/), categories)
    assert.equal(count(html, /role="button" tabindex="0"/), snapshot.data.rows.length)
  }
})

test('category bars retain saved row order', async () => {
  const html = await r().render(observeCategory(3))
  assert.match(html, /r0[\s\S]*r1[\s\S]*r2/)
})

test('a legend is hidden only when it repeats the sole displayed metric', async () => {
  const singleBar = await r().render(observeCategory(3))
  assert.match(singleBar, /class="recharts-surface"/)
  assert.doesNotMatch(singleBar, /aria-label="Data series"/)
  const singleTime = await r().render(observeTime(6))
  assert.doesNotMatch(singleTime, /aria-label="Data series"/)
  const multiTime = await r().render(observeTimeCategory(3))
  assert.match(multiTime, /aria-label="Data series"/)
  const singleGroup = await r().render(
    frame({
      axes: [timeAxis(3), { ...categoryAxis(1), keys: ['m0', 'm0', 'm0'] }],
      values: [value('m0', 3, observed())],
    }),
  )
  assert.match(singleGroup, /aria-label="Data series"/)
  const long = await r().render(observeTime(18))
  assert.doesNotMatch(long, /aria-label="Data series"/)
  const withBroadcast = overBroadcast()
  for (const column of withBroadcast.data.columns) {
    if (column.id === 'revenue' || column.id === 'mean_revenue') column.unit = 'USD'
  }
  const broadcast = await r().render(withBroadcast)
  assert.match(broadcast, /aria-label="Data series"/)
})

test('SVG points expose keyboard activation only in an actionable surface', async () => {
  const snapshot = observeTime(6)
  const actionable = await r().render(snapshot, { askPoint: true })
  assert.equal(count(actionable, /role="button" tabindex="0"/), 6)
  const value =
    snapshot.data.rows[0]![snapshot.data.columns.findIndex((column) => column.id === 'm0')]
  assert.match(actionable, new RegExp(String(value)))
  const readOnly = await r().render(snapshot)
  assert.doesNotMatch(readOnly, /role="button" tabindex="0"/)
})

test('missing observations use the truthful renderer and offer only present values for selection', async () => {
  const snapshot = monthly([0, 2, null, 4])
  const html = await r().render(snapshot, { askPoint: true })
  assert.equal(count(html, /data-mark="zero"/), 1)
  assert.doesNotMatch(html, /Select a data point|选择数据点/)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
})

test('heatmap leaves NULL cells empty and selects only saved numeric values', async () => {
  const snapshot = observeMatrix()
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.rows[0]![index] = null
  snapshot.data.rows[1]![index] = 1234567.89
  const html = await r().render(snapshot, { askPoint: true })
  assert.equal(count(html, /data-mark="empty"/), 1)
  assert.equal(count(html, /data-mark="cell"/), 3)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
  assert.match(html, /<title>[^<]*: 1,234,567\.89<\/title>/)
  assert.doesNotMatch(html, /Row avg|Column avg/)
})

test('correlation and saved shares expose data points without selecting reference tracks', async () => {
  const correlation = await r().render(correlate(true), { askPoint: true })
  assert.match(correlation, /role="button" tabindex="0"[^>]*aria-label="[^"]*n /)
  assert.doesNotMatch(correlation, /Select a data point|选择数据点/)
  const shares = await r().render(shareByRegion(), { askPoint: true })
  assert.ok(count(shares, /role="button" tabindex="0"/) > 0)
  assert.doesNotMatch(shares, /Select a data point|选择数据点/)
  assert.doesNotMatch(shares, /data-reference-track[^>]*role="button"/)
})

test('time-category charts preserve distinct series and their point identities', async () => {
  const snapshot = observeTimeCategory(8, 3)
  for (const name of ['m0', 'm1', 'm2']) {
    const index = snapshot.data.columns.findIndex((column) => column.id === name)
    snapshot.data.columns[index]!.unit = 'USD'
    for (const row of snapshot.data.rows) row[index] = 50
  }
  const html = await r().render(snapshot, { view: { chart: 'line' }, askPoint: true })
  assert.equal(count(html, /<section class="fv-parent"/), 3)
  assert.equal(count(html, /aria-label="Data series"/), 1)
  assert.equal(count(html, /class="recharts-layer recharts-line"/), 24)
  // Every equal-valued point remains represented in its own series and exposes its formatted value.
  assert.equal(count(html, /data-mark="filled"/), 72)
  assert.equal(count(html, /role="button" tabindex="0" aria-label="[^"]*: \$50\.00"/), 72)
})

test('long time series never connect null gaps', async () => {
  const snapshot = frame({
    axes: [
      { ...timeAxis(45), keys: repeat(months(45), 2) },
      { ...categoryAxis(2), keys: cycle(labels('r', 2), 45) },
    ],
    values: [
      { name: 'amount', values: Array.from({ length: 90 }, (_, i) => (i === 40 ? null : i)) },
    ],
  })
  const html = await r().render(snapshot, { view: { chart: 'line' } })
  assert.equal(segments(html).length, 2)
  assert.ok(segments(html).some((segment) => segment === 2))
})

test('Frame titles reflect the values actually selected for observation charts', async () => {
  for (const chart of ['line', 'area', 'bar'] as const) {
    const html = await r().render(observeTime(3, 2), {
      view: { chart, encoding: { values: ['m1'] } },
    })
    const title = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(html)?.[1]
    assert.match(title ?? '', /m1/)
    assert.doesNotMatch(title ?? '', /m0/)
  }
  const metric = await r().render(observeScalar(2), {
    view: { chart: 'metric', encoding: { value: 'm1' } },
  })
  assert.match(metric, /<div data-slot="card-title"[^>]*>m1(?: \([^)]*\))?<\/div>/)
  const heatmap = await r().render(observeMatrix(2), {
    view: { chart: 'heatmap', encoding: { x: 'region', y: 'channel', value: 'm1' } },
  })
  const title = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(heatmap)?.[1]
  assert.match(title ?? '', /m1/)
  assert.doesNotMatch(title ?? '', /m0/)
  const broadcast = /<div data-slot="card-title"[^>]*>([^<]*)<\/div>/.exec(
    await r().render(overBroadcast(6)),
  )?.[1]
  assert.match(broadcast ?? '', /revenue/)
  assert.match(broadcast ?? '', /mean_revenue/)
  const table = await r().render(observeTime(3, 2), { view: { chart: 'table', columns: ['m1'] } })
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
  const html = await r().render(snapshot)
  assert.match(html, /data-heatmap-scale="diverging"/)
  assert.match(html, /m0 \(USD\)/)
  assert.match(html, /title="-\$2\.00"/)
  assert.match(html, /title="\$5\.00"/)
  for (const row of snapshot.data.rows) row[index] = null
  const empty = await r().render(snapshot)
  assert.doesNotMatch(empty, /data-heatmap-scale=/)
  assert.match(empty, /data-mark="empty"/)
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
  const mixed = await r().render(snapshot)
  assert.equal(count(mixed, /class="fv-chart /), 1)
  assert.match(mixed, /trips/)
  assert.match(mixed, /fare \(USD\)/)
  snapshot.data.columns.find((column) => column.id === 'fare')!.unit = '1'
  const shared = await r().render(snapshot)
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
  assert.equal(count(await r().render(time), /class="fv-chart /), 2)
})

test('broadcast values are reference lines labelled with the saved partition value', async () => {
  const time = await r().render(overBroadcast(6))
  assert.equal(count(time, /mv-broadcast-reference/), 1)
  assert.match(time, /μ mean_revenue/)
  const bars = await r().render(categoryBroadcast())
  assert.equal(count(bars, /mv-broadcast-reference/), 1)
  assert.match(bars, /9,000\.00/)
  // The broadcast value is not drawn as its own bar series.
  assert.equal(count(bars, /data-mark="bar"/), 3)
})

test('NA draws no mark and breaks the line; 0 is drawn on the baseline', async () => {
  const na = await r().render(monthly([1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))
  assert.deepEqual(segments(na), [2])
  assert.match(na, /—/)
  const bars = await r().render(monthly([0, 2, null, 4]))
  assert.equal(count(bars, /data-mark="zero"/), 1)
  assert.equal(count(bars, /data-mark="bar"/), 2)
})

test('a missing period keeps its tick and leaves a gap', async () => {
  const html = await r().render(
    monthly([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], {
      periods: 14,
      rows: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    }),
  )
  assert.match(factualText(html), /2025-03/)
  assert.match(html, /data-tick="2025-03"/)
  assert.deepEqual(segments(html), [2])
})

test('an incomplete period preserves the actual and nominal bounds', async () => {
  const actual = { 1: '2025-02-10T00:00:00+08:00' }
  const line = await r().render(
    monthly(
      Array.from({ length: 14 }, (_, i) => i + 1),
      { actual },
    ),
  )
  assert.match(line, /Actual 2025-02-10 00:00 – 2025-03-01 00:00\nNominal 2025-02-01 00:00/)
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
  const html = await r().render(parseAnalysisSnapshot(snapshot))
  assert.match(html, /data-tick="2025-01"/)
  assert.match(html, /Full period/)
  assert.match(html, /Period prefix, local cutoff: 2025-02-15T12:00:00.000000/)
  assert.match(html, /Partial period/)
  assert.match(html, /Period selection unavailable/)
  assert.doesNotMatch(html, /Nominal |Actual /)
})

test('saved field names cannot collide with plot row or label metadata', async () => {
  for (const name of ['savedEndLabel', 'index', 'values']) {
    const snapshot = parseAnalysisSnapshot(
      JSON.parse(JSON.stringify(shareByRegion()).replaceAll('revenue_share', name)),
    )
    const html = await r().render(snapshot, { askPoint: true })
    const chart = html.match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0] ?? ''
    assert.equal(count(chart, /data-chart-end-label=""/), 3)
    assert.equal(count(chart, /data-chart-end-label=""[^>]*>25\.00%<\/text>/), 3)
    for (let row = 0; row < 3; row++) {
      assert.ok(chart.includes(`data-frame-point="${row}:${name}"`), `${name}: saved row ${row}`)
    }
  }
})

test('correlation dots sit on a fixed [-1, 1] axis; NA draws no point and keeps n_pairs', async () => {
  const s = correlate(true)
  s.data.rows[1]![1] = null
  s.data.columns[1]!.nullable = true
  const html = await r().render(s)
  assert.equal(viewOf(html), 'correlation')
  assert.equal(count(html, /data-mark="filled"/), 2)
  for (const tick of ['-1', '0', '1']) assert.match(html, new RegExp(`>${tick}</(?:tspan|text)>`))
  assert.ok(count(factualText(html), /n 30/) >= 3)
  assert.match(html, /—/)
  const scalar = await r().render(correlate(false, 'spearman'))
  assert.match(scalar, /<dt[^>]*>ρ<\/dt>/)
  assert.match(scalar, /<dt[^>]*>n<\/dt>/)
})

test('composite member keys retain the requested table height', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3, 'identity'), { ...categoryAxis(3, 'identity'), name: 'district' }],
  })
  const html = await r().render(snapshot, { display: { height: 150 } })
  assert.match(html, /max-height:\s*150px/)
  assert.match(html, /data-column-id="region"/)
  assert.match(html, /data-column-id="district"/)
})

test('time × category shares draw one 0–100% track per period', async () => {
  const html = await r().render(
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
  const html = await r().render(observeTime(2, 1, week))
  assert.match(html, />2025-W01</)
  assert.match(html, />2025-W05</)
})

test('correlation titles name the captured operands; records freeze every key column', async () => {
  assert.match(await r().render(correlate(false)), /class="[^"]*fv-title"[^>]*>revenue ↔ orders</)
  assert.match(await r().render(records()), /data-frozen="1"/)
})
