import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../src/presentation/contracts/frame-view.ts'
import { resolveFrameView } from '../../src/presentation/contracts/frame-view.ts'
import type { FrameSnapshotV2 } from '../../src/presentation/contracts/snapshot.ts'
import {
  align,
  attributeAdditive,
  attributeEffects,
  attributeShare,
  axisGroups,
  categoryAxis,
  compareCalendar,
  comparedIntervalMonth,
  compareOrdinary,
  correlate,
  cycle,
  frame,
  labels,
  members,
  months,
  observeCategory,
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
  /<div class="pr-table fv-comparison-table"[\s\S]*?<\/table><\/div>/.exec(html)?.[0] ?? ''
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
      assert.match(html, /<svg class="fv-svg"[^>]*role="img" aria-label="[^"]+"/, name)
  }
})

test('observation shapes draw lines, areas, bars, heatmaps and frozen record tables', () => {
  const line = r.render(observeTime(18))
  assert.equal(segments(line).length, 1)
  assert.match(r.render(observeTime(6), { view: { chart: 'area' } }), /class="fv-area"/)
  assert.match(r.render(observeTime(6)), /data-mark="bar"/)
  const interval = r.render(observeTime(4, 1, { kind: 'interval', timezone: 'Asia/Shanghai' }))
  assert.doesNotMatch(interval, /class="fv-line"/)
  const series = r.render(observeTimeCategory(3))
  assert.equal(count(series, /data-series="/), 3)
  assert.match(series, /<ul class="fv-legend">/)
  assert.match(r.render(observeMatrix()), /data-mark="cell"/)
  assert.match(r.render(records()), /class="fv-frozen"/)
  // Statistic symbols prefix value names.
  const reduced = r.render(reduceByMonth())
  assert.match(reduced, /Σ total/)
  assert.match(reduced, /μ average/)
  assert.match(reduced, /# rows/)
})

test('broadcast values are reference lines labelled with the saved partition value', () => {
  const time = r.render(overBroadcast(6))
  assert.equal(count(time, /data-mark="reference"/), 1)
  assert.match(time, /μ mean_revenue/)
  const bars = r.render(categoryBroadcast())
  assert.equal(count(bars, /data-mark="reference"/), 1)
  assert.match(bars, /9[,.]?00K|9K/)
  // The broadcast value is not drawn as its own bar series.
  assert.equal(count(bars, /data-mark="bar"/), 3)
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
  assert.match(block, /^<div class="pr-table fv-comparison-table" data-table-layout="comparison"/)
  // metric | current | baseline | Δ | Δ% — endpoints come from the comparison.
  assert.equal(count(block, /<th scope="col">/), 5)
  for (const header of ['Metric', 'Current', 'Baseline', 'Δ', 'Δ%'])
    assert.ok(block.includes(`>${header}</th>`), header)
  // Two groups on one saved row: two data rows in one tbody, no section headers.
  assert.equal(count(block, /<tr><th scope="row">/), 2)
  // Current/baseline/Δ/Δ% are numeric cells for both rows.
  assert.equal(count(block, /<td class="pr-numeric"/), 8)
  assert.equal(count(block, /<tbody>/), 1)
  assert.doesNotMatch(block, /fv-comparison-section/)
  // Raw role column ids stay in the collapsed audit table, never in the display table.
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
  assert.match(block, /<th scope="col">2025-06<\/th>/)
  assert.match(block, /<th scope="col">2025-05<\/th>/)
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
  assert.match(html, /Not captured when saved/)
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
  assert.ok(r.codeMatches('', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'))
  assert.ok(!r.codeMatches('x', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'))
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
  bare.frame.sections.interpretation = 'not-captured'
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
