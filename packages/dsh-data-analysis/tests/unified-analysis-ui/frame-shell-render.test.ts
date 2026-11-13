import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  FrameClassification,
  ResolvedFrameView,
} from '../../src/presentation/contracts/frame-view.ts'
import {
  align,
  attributeAdditive,
  categoryAxis,
  compareOrdinary,
  frame,
  members,
  observeCategory,
  observeMatrix,
  observeScalar,
  observeTime,
  records,
  token,
} from './frame-fixtures.ts'
import {
  comparedCalendarWithPeriods,
  comparedScalar,
  comparedSinglePeriodMultiGroup,
} from './frame-render-fixtures.ts'
import { count, factualText, resolved, sharedRenderer, viewOf } from './frame-render-helpers.ts'

const r = sharedRenderer()

test('heatmap retains sparse axis members and distinguishes missing cells from zero', async () => {
  const snapshot = observeMatrix()
  snapshot.data.rows.splice(0, 1)
  for (const coordinate of Object.values(snapshot.frame.coordinates)) coordinate.values.splice(0, 1)
  const value = snapshot.frame.fields.find((field) => field.role === 'value')!
  const index = snapshot.data.columns.findIndex((column) => column.id === value.id)
  snapshot.data.rows[0]![index] = 0
  const html = await r().render(snapshot, { askPoint: true })
  assert.match(html, /data-heatmap-missing-count="1"/)
  assert.equal(count(html, /data-mark="empty"/), 0)
  assert.equal(count(html, /data-mark="cell"/), 3)
  assert.equal(count(html, /role="button" tabindex="0"/), 3)
  assert.match(html, /data-heatmap-scale=/)
  assert.match(html, />0\.00<\/span>/)
  assert.match(html, /aria-label="[^"]*: 0\.00" data-frame-point=/)
  assert.doesNotMatch(html, /Row avg|Column avg/)
})

test('a frame table shows grouped values without an exact-value tooltip', async () => {
  const html = await r().render(
    frame({
      axes: [categoryAxis(2)],
      values: [{ name: 'amount', values: [118393545.04998468, 8] }],
    }),
    { view: { chart: 'table' } },
  )
  assert.match(html, />118,393,545\.05</)
  assert.doesNotMatch(html, /118393545\.04998468/)
})

test('members show the saved count and a compact key preview', async () => {
  const html = await r().render(members())
  assert.match(html, /data-number="members"><dd[^>]*>3</)
  assert.match(html, /class="fv-members-key"/)
  assert.match(html, /data-icon="data"/)
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
    const html = await r().shell(s, c, view)
    assert.equal(viewOf(html), view.chart)
    assert.match(html, /Σ m0/)
  }
  const table = await r().shell(s, c, { chart: 'table', columns: ['m0'] })
  assert.match(table, /data-column-id="m0"/)
  assert.doesNotMatch(table, /data-column-id="month"/)
})

test('compact density keeps the name, header numbers or the main view and only useful icons', async () => {
  const kpi = await r().render(
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
  const trend = await r().render(observeTime(18), { display: { density: 'compact' } })
  assert.match(trend, /class="recharts-surface"/)
  assert.equal(count(trend, /data-icon="/), 1)
  assert.match(trend, /data-icon="data"/)
  const periods = await r().render(comparedCalendarWithPeriods(3), {
    display: { density: 'compact' },
  })
  assert.equal(count(periods, /data-icon="/), 2)
  assert.match(periods, /data-icon="periods"/)
})

test('icons grey out for missing sections and Python sources, never as zero items', async () => {
  const html = await r().render(observeCategory(3, 9))
  assert.match(html, /data-icon="coverage"/)
  assert.doesNotMatch(html, /<span>3\/9<\/span>/)
  assert.doesNotMatch(html, /data-icon="coverage" data-unavailable/)
  assert.match(html, /data-icon="origins"/)
  assert.doesNotMatch(html, /data-icon="origins"[\s\S]*?<span>0<\/span>/)
  assert.match(html, /data-icon="python" data-unavailable="true"/)
  assert.match(html, /aria-label="Python"/)
  assert.doesNotMatch(html, /data-icon="periods"/)
  // Complete snapshots show no coverage icon; incomplete ones show the captured fraction.
  assert.doesNotMatch(await r().render(observeTime(6)), /data-icon="coverage"/)
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
  const origins = await r().render(s, {
    codeRef: { executionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sha256: 'a'.repeat(64) },
    readCode: true,
  })
  assert.doesNotMatch(origins, /data-icon="origins" data-unavailable/)
  // The source icon carries no count badge; the dialog lists the deduplicated objects.
  assert.doesNotMatch(origins, /<span>1<\/span>/)
  assert.doesNotMatch(origins, /data-icon="python" data-unavailable/)
  // sessionId and artifactId only live in the (closed) developer area of the Python dialog.
  assert.doesNotMatch(origins, /sessionId|artifactId|>session</)
})

test('chart data shares the icon row and explicit visible data stays inline', async () => {
  const html = await r().render(observeTime(6))
  assert.match(html, /month · 6/)
  assert.match(html, /data-icon="origins"[\s\S]*aria-haspopup="dialog"/)
  assert.match(html, /<div class="fv-icons(?: [^"]*)?"><span class="fv-icon" data-icon="data"/)
  assert.match(html, /data-icon="data"[\s\S]*aria-haspopup="dialog"/)
  // The chart data entry is an icon like the rest of the row, not a text link.
  assert.doesNotMatch(html, /fv-data-label|Table ↗/)
  const visible = await r().render(observeTime(6), { display: { dataTable: 'visible' } })
  assert.match(visible, /data-icon="data"[\s\S]*aria-expanded="true"/)
  assert.match(visible, /class="fv-data-reference"/)
  assert.doesNotMatch(visible, />6 rows</)
  const bare = observeScalar(1)
  bare.frame.sections.interpretation = { status: 'unavailable', reason: 'read-failed' }
  assert.doesNotMatch(await r().render(bare), /fv-chips/)
})

test('table-shaped main views retain the data entry', async () => {
  for (const snapshot of [records(), members()]) {
    for (const display of [undefined, { dataTable: 'visible' as const }]) {
      const html = await r().render(snapshot, { display })
      assert.match(html, /data-icon="data"/)
      if (display) assert.match(html, /class="fv-data-reference"/)
    }
  }
  // A single-row comparison defaults to headline blocks and keeps the table behind the data icon.
  const multi = comparedSinglePeriodMultiGroup()
  const grid = await r().render(multi, { display: { dataTable: 'visible' } })
  assert.match(grid, /class="fv-data-reference"[\s\S]*data-icon="data"/)
  const literal = await r().render(multi, { view: { chart: 'table' } })
  assert.match(literal, /<table/)
  assert.match(literal, /data-icon="data"/)
  const comparison = compareOrdinary([categoryAxis(3)])
  const comparisonResolution = resolved(comparison)
  assert.equal(comparisonResolution.view.chart, 'comparison')
  if (comparisonResolution.view.chart === 'comparison') {
    const html = await r().shell(comparison, comparisonResolution.classification, {
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
    const html = await r().shell(alignment, alignmentResolution.classification, {
      ...alignmentResolution.view,
      style: 'table',
    })
    assert.match(html, /<table/)
    assert.match(html, /data-icon="data"/)
  }
})

test('no computed numbers: every drawn number is a saved cell', async () => {
  // Contributions 1..4 and a total of 10 (equal by fixture); floating ends 3 and 6 are layout.
  const html = await r().render(attributeAdditive())
  const facts = factualText(html)
  for (const saved of [1, 2, 3, 4, 10])
    assert.match(facts, new RegExp(`(?:r[0-3]|total) ${saved}\\.00(?:[\\s;<]|$)`))
  assert.doesNotMatch(facts, /contribution: 6\.00(?:[\s;<]|$)/)
  // Category bars: the sum 6 of revenue 1..3 never appears.
  const bars = await r().render(observeCategory(3))
  assert.doesNotMatch(factualText(bars), /revenue: 6\.00(?:[\s;<]|$)/)
})

test('saved views that do not resolve show an error instead of another chart', async () => {
  const html = await r().render(observeTime(6), {
    view: { chart: 'line', encoding: { axis: 'missing' } },
  })
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /data-frame-view=/)
})
