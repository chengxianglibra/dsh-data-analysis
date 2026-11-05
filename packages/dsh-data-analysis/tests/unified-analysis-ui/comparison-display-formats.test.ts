import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { categoryAxis, comparedRoles, comparisonOf, frame } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer.dispose()
})

function currencyComparison() {
  const snapshot = frame({
    values: [
      { name: 'sales', type: 'decimal', values: ['82040902.13'] },
      { name: 'prior.baseline.sales', type: 'decimal', values: ['84296905.34'] },
      { name: 'prior.absolute.sales', type: 'decimal', values: ['-2256003.21'] },
      { name: 'prior.relative.sales', values: [-0.0268] },
    ],
    comparisons: [
      comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: comparedRoles('sales') }]),
    ],
  })
  for (const column of snapshot.data.columns)
    if (column.id !== 'prior.relative.sales') column.unit = 'USD'
  return snapshot
}

test('explicit currency formatting preserves symbols and rounds saved KPI and delta values', async () => {
  const snapshot = currencyComparison()
  const formats = ['sales', 'prior.baseline.sales', 'prior.absolute.sales'].map((value) => ({
    value,
    format: 'currency' as const,
    decimals: 0,
  }))
  const html = await renderer.render(snapshot, {
    display: {
      formats: [...formats, { value: 'prior.relative.sales', format: 'percent', decimals: 1 }],
    },
  })
  assert.match(html, /\$82,040,902/)
  assert.match(html, /\$84,296,905/)
  assert.match(html, /▼\$2,256,003/)
  assert.match(html, /▼2\.7%/)
  const numbers = html.match(/<dl class="fv-kpi-values">[\s\S]*?<\/dl>/)?.[0] ?? ''
  assert.doesNotMatch(numbers, /fv-kpi-unit[^>]*>\s*USD/)
  assert.equal(snapshot.data.rows[0]![0], '82040902.13')
})

test('number formatting on category changes retains sign, unit and original point identity', async () => {
  const snapshot = frame({
    axes: [categoryAxis(2)],
    values: [
      { name: 'sales', type: 'decimal', values: ['2.34', '1.45'] },
      { name: 'prior.baseline.sales', type: 'decimal', values: ['4.56', '0.45'] },
      { name: 'prior.absolute.sales', type: 'decimal', values: ['-2.22', '1.00'] },
      { name: 'prior.relative.sales', values: [-0.4, 2] },
    ],
    comparisons: [
      comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: comparedRoles('sales') }]),
    ],
  })
  snapshot.data.columns.find((column) => column.id === 'prior.absolute.sales')!.unit = 'USD'
  const html = await renderer.render(snapshot, {
    view: { chart: 'comparison', style: 'delta' },
    display: { formats: [{ value: 'prior.absolute.sales', format: 'number', decimals: 0 }] },
    askPoint: true,
  })
  assert.match(html, /data-frame-point="0:prior.absolute.sales"[^>]*>▼2 USD/)
  assert.match(html, /data-frame-point="1:prior.absolute.sales"[^>]*>▲1 USD/)
})

test('an explicitly formatted missing endpoint and its change remain masked', async () => {
  const comparison = comparisonOf({ kind: 'ordinary' }, [
    { name: 'sales', values: comparedRoles('sales') },
  ])
  comparison.presence = { current: 'current_present', baseline: 'baseline_present', enclosing: [] }
  const snapshot = frame({
    values: [
      { name: 'sales', values: [10] },
      { name: 'prior.baseline.sales', values: [999999] },
      { name: 'prior.absolute.sales', values: [999999] },
      { name: 'prior.relative.sales', values: [0.1] },
      { name: 'current_present', type: 'boolean', values: [true], presence: true },
      { name: 'baseline_present', type: 'boolean', values: [false], presence: true },
    ],
    comparisons: [comparison],
  })
  const html = await renderer.render(snapshot, {
    display: {
      formats: [
        { value: 'prior.baseline.sales', format: 'number', decimals: 0 },
        { value: 'prior.absolute.sales', format: 'number', decimals: 0 },
      ],
    },
  })
  assert.doesNotMatch(html, /999,999/)
  assert.match(html, /—/)
})
