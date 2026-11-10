import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import {
  align,
  attributeAdditive,
  attributeEffects,
  attributeShare,
  calendarBinding,
  categoryAxis,
  compareCalendar,
  comparedIntervalMonth,
  comparedRoles,
  comparedValues,
  compareOrdinary,
  comparisonOf,
  frame,
  observeCategory,
  pairedAxis,
  shareByRegion,
  timeAxis,
} from './frame-fixtures.ts'
import {
  comparedCalendarWithPeriods,
  comparedCategories,
  comparedScalar,
  comparedSinglePeriodMultiGroup,
  comparedTimeCategory,
  twoAliases,
} from './frame-render-fixtures.ts'
import {
  comparisonTable,
  count,
  factualText,
  segments,
  sharedRenderer,
  viewOf,
} from './frame-render-helpers.ts'

const r = sharedRenderer()

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
    const html = await r().render(snapshot)
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

test('restricted decompositions detach the total; has_more falls back to a table', async () => {
  const closed = await r().render(attributeAdditive())
  assert.match(closed, /mv-connector-total/)
  assert.match(closed, /data-mark-total="closed"/)
  const restricted = await r().render(attributeAdditive({ rowScope: 'restricted' }))
  assert.doesNotMatch(restricted, /mv-connector-total/)
  assert.match(restricted, /data-mark-total="detached"/)
  for (const [snapshot, coverage] of [
    [attributeAdditive({ total: 9 }), '4/9'],
    [attributeShare(9), '3/9'],
    [observeCategory(3, 9), '3/9'],
    [shareByRegion(3, 9), '3/9'],
  ] as const) {
    const html = await r().render(snapshot)
    assert.equal(viewOf(html), 'table')
    assert.match(html, /data-icon="coverage"/)
    assert.match(html, new RegExp(coverage))
    assert.doesNotMatch(html, new RegExp(`<span>${coverage}</span>`))
  }
})

test('a missing decomposition contribution is marked and does not close the waterfall', async () => {
  const snapshot = attributeAdditive()
  const index = snapshot.data.columns.findIndex((column) => column.id === 'contribution')
  snapshot.data.columns[index]!.nullable = true
  snapshot.data.rows[1]![index] = null
  const html = await r().render(snapshot)
  assert.match(html, /data-mark-total="detached"/)
  assert.doesNotMatch(html, /mv-connector-total/)
  assert.match(html, /—/)
})

test('comparison numbers label saved changes and keep direction marks', async () => {
  const html = await r().render(
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
  const zero = await r().render(
    comparedScalar({ current: 5, baseline: 0, absolute: 5, relative: null }),
  )
  assert.match(zero, /<dt>Change rate<\/dt><dd>—<\/dd>/)
  const down = await r().render(
    comparedScalar({ current: 1, baseline: 2, absolute: -1, relative: -0.5 }),
  )
  assert.match(down, /▼1\.00</)
  assert.match(down, /▼50\.00%/)
  assert.doesNotMatch(down, /#(?:e34948|008300|ff0000|00ff00)|\bred\b|\bgreen\b/i)
  const flat = await r().render(
    comparedScalar({ current: 1, baseline: 1, absolute: 0, relative: 0 }),
  )
  assert.match(flat, /<dt>Change<\/dt><dd>0\.00</)
  assert.match(flat, /<dt>Change rate<\/dt><dd>0\.00%/)
  const tiny = await r().render(
    comparedScalar({ current: 1, baseline: 1, absolute: -0.00001, relative: -0.000001 }),
  )
  assert.match(tiny, /▼0\.00</)
  assert.match(tiny, /▼&lt;0\.01%/)
  const tinyUp = await r().render(
    comparedScalar({ current: 1, baseline: 1, absolute: 0.00001, relative: 0.000001 }),
  )
  assert.match(tinyUp, /▲0\.00</)
  assert.match(tinyUp, /▲&lt;0\.01%/)
})

test('a single-row multi-group comparison is one headline block per metric', async () => {
  const html = await r().render(comparedSinglePeriodMultiGroup())
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

test('interval comparison endpoints name inclusive civil months', async () => {
  const html = await r().render(comparedIntervalMonth())
  assert.equal(viewOf(html), 'comparison-grid')
  assert.match(html, /<dt[^>]*>2025-06<\/dt>/)
  assert.match(html, /<dt[^>]*>2025-05<\/dt>/)
  assert.match(html, /<div data-slot="card-title"[^>]*>2025-06 ⇄ 2025-05<\/div>/)
  assert.doesNotMatch(html, /07-01/)
  assert.doesNotMatch(html, /06-01 – 07-01/)
})

test('comparison table titles show captured endpoints only when specific', async () => {
  const generic = await r().render(comparedSinglePeriodMultiGroup(), { view: { chart: 'table' } })
  assert.doesNotMatch(generic, /<div data-slot="card-title"[^>]*>Current ⇄ Baseline<\/div>/)
  const specific = await r().render(comparedIntervalMonth(), { view: { chart: 'table' } })
  assert.match(specific, /<div data-slot="card-title"[^>]*>2025-06 ⇄ 2025-05<\/div>/)
})

test('time comparison draws a solid current line, dashed baseline and a Δ strip', async () => {
  const html = await r().render(compareCalendar(6))
  assert.match(html, /stroke-dasharray="5 4"/)
  assert.equal(segments(html).length, 2)
  assert.match(html, /data-strip="delta"/)
  const periods = await r().render(comparedCalendarWithPeriods(3))
  assert.match(periods, /data-icon="periods"/)
  assert.match(periods, /2025-01 – 2025-03 ⇄ 2026-01 – 2026-03/)
})

test('category comparisons draw a dumbbell, a delta bar, small multiples and alias segments', async () => {
  const comparison = await r().render(compareOrdinary([categoryAxis(3)]))
  assert.match(comparison, /data-comparison-rows="delta"/)
  const delta = await r().render(compareOrdinary([categoryAxis(3)]), {
    view: { chart: 'comparison', style: 'delta' },
  })
  assert.doesNotMatch(delta, /mv-domain-link/)
  assert.equal(count(delta, /class="fv-delta-bar /), 3)
  const multiples = await r().render(comparedTimeCategory())
  assert.equal(count(multiples, /data-multiple="/), 3)
  const aliases = await r().render(twoAliases(), {
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
  const mixed = await r().render(withSavedMembers, {
    view: { chart: 'comparison', encoding: { value: 'lastyear.baseline.sales' } },
  })
  // A captured endpoint is clearer than its alias; the incomplete pair still uses its alias.
  assert.match(mixed, /aria-pressed="true"[^>]*>east</)
  assert.match(mixed, /aria-pressed="false"[^>]*>plan</)
  assert.doesNotMatch(mixed, /aria-pressed="true"[^>]*>lastyear</)
})

test('decompositions draw the waterfall, effect segments with ◆ and the share track', async () => {
  const waterfall = await r().render(attributeAdditive())
  assert.equal(count(waterfall, /mv-connector"/), 3)
  assert.match(waterfall, /data-number="total"/)
  const effects = await r().render(attributeEffects())
  assert.equal(count(effects, /data-mark="contribution"/), 3)
  assert.match(effects, /Within/)
  assert.match(effects, /Mix/)
  const share = await r().render(attributeShare(), {
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
  const html = await r().render(s)
  assert.match(html, /-20\.00%/)
  assert.match(html, /140\.00%/)
})

test('align draws hollow left and filled right pairs, or two lines on a paired axis', async () => {
  const dumbbell = await r().render(align(categoryAxis(3)))
  assert.equal(count(dumbbell, /mv-domain-link/), 3)
  assert.match(dumbbell, /aria-pressed="true"/)
  assert.match(dumbbell, /left\.revenue/)
  const line = await r().render(align(pairedAxis(3)))
  assert.equal(segments(line).length, 4)
  // Unmatched subjects draw no pairs; both sides stay in the saved table.
  const unmatched = await r().render(align(categoryAxis(3), ['sales.aov', 'sales.margin']))
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
  const html = await r().render(parsed)
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
  const comparison = await r().render(compared)
  assert.match(comparison, /data-comparison-rows="delta"/)
  assert.doesNotMatch(comparison, /777,777|888,888|666,666|555,555/)

  const aligned = align(categoryAxis(4))
  const column = (id: string) => aligned.data.columns.findIndex((item) => item.id === id)
  aligned.data.rows[1]![column('right_present')] = false
  aligned.data.rows[1]![column('right.revenue')] = 999999
  aligned.data.rows[2]![column('right.revenue')] = 3.00000001
  aligned.data.rows[3]![column('right.revenue')] = 8
  const alignedChart =
    (await r().render(aligned)).match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0] ?? ''
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
    (await r().render(snapshot)).match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0] ?? ''
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
    const html = await r().render(snapshot, { view })
    const facts = html
    for (const i of [1, 2, 3])
      assert.doesNotMatch(facts, new RegExp(`800,00${1 + i}\\.00|45\\.${(1 + i) * 10}%`))
    assert.match(facts, /800,001\.00/)
    assert.match(facts, /800,005\.00/)
    // Detailed comparison retains endpoint masking for absent sides.
    const details = await r().render(snapshot, { view, display: { dataTable: 'visible' } })
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
  const grid = await r().render(snapshot)
  assert.equal(viewOf(grid), 'comparison-grid')
  assert.doesNotMatch(grid, /432100|432,100|43,210,000/)
  // Absent baseline roles are omitted from headline blocks; Δ and Δ% stay masked.
  assert.ok(count(grid, /—/) >= 4)
  const table = comparisonTable(await r().render(snapshot, { view: { chart: 'table' } }))
  assert.doesNotMatch(table, /432100|432,100|43,210,000/)
  assert.ok(count(table, /—/) >= 6)
  const numbers = await r().render(snapshot, {
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
  const html = await r().render(snapshot)
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
    const html = await r().render(snapshot)
    const chart = html.match(/<svg[^>]*role="application"[\s\S]*?<\/svg>/)?.[0]
    assert.ok(chart)
    assert.doesNotMatch(chart, /987654321|988M/)
    assert.match(chart, /—/)
  }
})
