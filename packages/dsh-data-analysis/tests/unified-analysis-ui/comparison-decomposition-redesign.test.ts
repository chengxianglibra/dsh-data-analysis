import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { compareMagnitude, divergingScale } from '../../src/client/analysis-ui/frame/magnitude.ts'
import {
  categoryAxis,
  comparedIntervalMonth,
  comparedRoles,
  comparedSinglePeriodMultiGroup,
  comparisonOf,
  decompositionOf,
  frame,
} from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('comparison KPI heading names a saved period only when endpoint metadata is specific', async () => {
  const specific = await renderer.render(comparedIntervalMonth())
  const heading = /<h4>([^<]*)<\/h4>/.exec(specific)?.[1]
  assert.ok(heading?.includes('2025-06'), heading)
  const unknown = await renderer.render(comparedSinglePeriodMultiGroup())
  const genericHeading = /<h4>([^<]*)<\/h4>/.exec(unknown)?.[1]
  assert.equal(genericHeading, 'sales')
  assert.match(unknown, />Current<\/dt>/)
})

test('absolute ordering keeps full saved precision, stable ties and missing values last', () => {
  const values = ['-9007199254740992', '9007199254740993', null, '9e15', '-9e15']
  const order = values
    .map((_, i) => i)
    .sort((a, b) => compareMagnitude(values[a]!, values[b]!) || a - b)
  assert.deepEqual(order, [1, 0, 3, 4, 2])
  assert.equal(compareMagnitude('-0.0000000000000000002', '1e-19'), -1)
})

test('zero axis preserves a common scale for both signs and handles extreme values', () => {
  const scale = divergingScale([-100, 25])
  assert.ok(scale.zero >= 20 && scale.zero <= 80)
  assert.ok(Math.abs(scale.width(-100) / scale.width(25) - 4) < 1e-12)
  assert.ok(scale.width(-100) <= scale.zero && scale.width(25) <= 100 - scale.zero)
  const extreme = divergingScale([-1e308, 1e308])
  assert.ok(Number.isFinite(extreme.width(1e308)))
  assert.equal(extreme.zero, 50)
})

test('comparison sorts by saved absolute change while preserving saved point identity', async () => {
  const snapshot = frame({
    axes: [categoryAxis(4)],
    values: [
      { name: 'sales', values: [5, 9, 1, 3] },
      { name: 'prior.baseline.sales', values: [6, 1, 1, 3] },
      { name: 'prior.absolute.sales', values: [-1, 8, 0, null] },
      { name: 'prior.relative.sales', values: [-0.1, 8, 0, null] },
    ],
    comparisons: [
      comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: comparedRoles('sales') }]),
    ],
  })
  const html = await renderer.render(snapshot, {
    view: { chart: 'comparison', style: 'delta' },
    askPoint: true,
  })
  const table =
    /<table[^>]*data-comparison-rows="delta"[\s\S]*?<\/table>/.exec(html)?.[0] ??
    /<[^>]*data-comparison-rows="delta"[\s\S]*?<\/table>/.exec(html)?.[0]
  assert.ok(table)
  const names = [...table.matchAll(/<th scope="row"[^>]*>([^<]+)/g)].map((match) => match[1])
  assert.deepEqual(names, ['r1', 'r0', 'r2', 'r3'])
  assert.match(table, /data-frame-point="1:prior.absolute.sales"/)
  assert.doesNotMatch(table, /data-frame-point="3:prior.absolute.sales"/)
})

test('attribution orders signed saved contributions, keeps endpoint presence and explains shares', async () => {
  const facts = decompositionOf([
    ['contribution', 'contribution'],
    ['total', 'total'],
    ['share', 'share'],
    ['current', 'current'],
    ['baseline', 'baseline'],
  ])
  facts.target = { kind: 'absolute', comparison: 0, group: 'sales' }
  facts.outputs.push(
    { fieldKind: 'presence', role: 'current_present', name: 'current_present' },
    { fieldKind: 'presence', role: 'baseline_present', name: 'baseline_present' },
  )
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [
      { name: 'contribution', values: [5, -20, null] },
      { name: 'total', values: [-15, -15, -15] },
      { name: 'share', values: [-1 / 3, 4 / 3, null] },
      { name: 'current', values: [25, 80, 999999] },
      { name: 'baseline', values: [20, 100, 30] },
      { name: 'current_present', type: 'boolean', values: [true, true, false], presence: true },
      { name: 'baseline_present', type: 'boolean', values: [true, true, true], presence: true },
    ],
    comparisons: [comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: [] }])],
    decompositions: [facts],
  })
  const html = await renderer.render(snapshot, { askPoint: true })
  const table = /<section[^>]*data-decomposition-rows="attribution"[\s\S]*?<\/section>/.exec(
    html,
  )?.[0]
  assert.ok(table)
  const names = [...table.matchAll(/<th scope="row"[^>]*>([^<]+)/g)].map((match) => match[1])
  assert.deepEqual(names, ['r1', 'r0', 'r2'])
  assert.match(table, /data-frame-point="0:contribution"[^>]*[^>]*>\+5\.00<\/button>/)
  assert.match(table, /data-contribution-sign="negative"/)
  assert.match(table, /fv-decomposition-note/)
  assert.doesNotMatch(table, /data-frame-point="2:current"|999,999/)
})

test('comparison retains tiny decimal change signs and never reveals a masked endpoint', async () => {
  const comparison = comparisonOf({ kind: 'ordinary' }, [
    { name: 'sales', values: comparedRoles('sales') },
  ])
  comparison.presence = { current: 'current_present', baseline: 'baseline_present', enclosing: [] }
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [
      { name: 'sales', values: [1, 2, 3] },
      { name: 'prior.baseline.sales', values: [1, 2, 3] },
      { name: 'prior.absolute.sales', values: [0, 0, 0] },
      { name: 'prior.relative.sales', type: 'decimal', values: ['1e-400', '-1e-400', '1e-400'] },
      { name: 'current_present', type: 'boolean', values: [true, true, true], presence: true },
      { name: 'baseline_present', type: 'boolean', values: [true, true, false], presence: true },
    ],
    comparisons: [comparison],
  })
  const html = await renderer.render(snapshot, { view: { chart: 'comparison', style: 'delta' } })
  const table = /<[^>]*data-comparison-rows="delta"[\s\S]*?<\/table>/.exec(html)?.[0]
  assert.ok(table)
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]!)
  assert.match(rows.find((row) => row.includes('r0'))!, /▲&lt;0\.01%/)
  assert.match(rows.find((row) => row.includes('r1'))!, /▼&lt;0\.01%/)
  assert.doesNotMatch(rows.find((row) => row.includes('r2'))!, /[▲▼]&lt;0\.01%/)
})

test('relative attribution keeps the signs of tiny saved Decimal contributions and totals', async () => {
  const facts = decompositionOf([
    ['contribution', 'contribution'],
    ['total', 'total'],
    ['current', 'current'],
    ['baseline', 'baseline'],
  ])
  facts.target = { kind: 'relative', comparison: 0, group: 'sales' }
  const snapshot = frame({
    axes: [categoryAxis(2)],
    values: [
      { name: 'contribution', type: 'decimal', values: ['1e-400', '-1e-400'] },
      { name: 'total', type: 'decimal', values: ['-1e-400', '-1e-400'] },
      { name: 'current', values: [1, 1] },
      { name: 'baseline', values: [1, 1] },
    ],
    comparisons: [comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: [] }])],
    decompositions: [facts],
  })
  const html = await renderer.render(snapshot)
  assert.match(html, /&gt;-0\.01%/)
  assert.match(html, /\+&lt;0\.01%/)
})

test('comparison KPI and transposed table retain tiny saved decimal signs', async () => {
  const values = ['sales', 'orders'].flatMap((name, index) => [
    { name, values: [1] },
    { name: `prior.baseline.${name}`, values: [1] },
    { name: `prior.absolute.${name}`, values: [0] },
    {
      name: `prior.relative.${name}`,
      type: 'decimal' as const,
      values: [index === 0 ? '1e-400' : '-1e-400'],
    },
  ])
  const snapshot = frame({
    values,
    comparisons: [
      comparisonOf({ kind: 'ordinary' }, [
        { name: 'sales', values: comparedRoles('sales') },
        { name: 'orders', values: comparedRoles('orders') },
      ]),
    ],
  })
  const grid = await renderer.render(snapshot)
  assert.match(grid, /\+&lt;0\.01%/)
  assert.match(grid, /−&lt;0\.01%/)
  const table = await renderer.render(snapshot, { view: { chart: 'table' } })
  assert.match(table, /▲&lt;0\.01%/)
  assert.match(table, /▼&lt;0\.01%/)
})
