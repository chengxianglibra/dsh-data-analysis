import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { resolveFrameView } from '../../src/presentation/contracts/frame-view.ts'
import { categoryAxis, frame } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('explicit stacked composition uses saved values, calculated shares, and original row bindings', async () => {
  const snapshot = frame({
    axes: [categoryAxis(4)],
    values: [{ name: 'v', values: [2, 5, 3, 0] }],
  })
  const html = await renderer.render(snapshot, {
    view: { chart: 'pie', style: 'stacked' },
    askPoint: true,
  })
  assert.match(html, /data-chart="category-composition"/)
  assert.doesNotMatch(html, /data-chart="pie"/)
  assert.match(html, /Share of shown values/)
  const list = html.match(/<ul class="fv-share-list">[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.ok(list.indexOf('r1') < list.indexOf('r2'))
  assert.ok(list.indexOf('r2') < list.indexOf('r0'))
  assert.ok(list.indexOf('r0') < list.indexOf('r3'))
  assert.match(list, /50\.00%/)
  assert.match(list, /30\.00%/)
  assert.match(list, /20\.00%/)
  assert.match(list, /0\.00%/)
  for (const row of [0, 1, 2, 3]) assert.match(list, new RegExp(`data-frame-point="${row}:v"`))
  assert.equal((list.match(/data-frame-point=/g) ?? []).length, 4)
  assert.equal((html.match(/<rect x=/g) ?? []).length, 3)
})

test('large Decimal values keep correct shares and precise sorting; tiny values remain nonzero', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [{ name: 'v', type: 'decimal', values: ['1e308', '1e308', '1e-400'] }],
  })
  const html = await renderer.render(snapshot, { view: { chart: 'pie', style: 'stacked' } })
  assert.match(html, /data-chart="category-composition"/)
  assert.equal((html.match(/50\.00%/g) ?? []).length >= 2, true)
  assert.match(html, /&lt;0\.01%/)
})

test('both categorical views scale exact Decimals before converting their shares to floats', async () => {
  const cases = [
    { values: ['1e-400', '2e-400'], shares: ['33.33%', '66.67%'] },
    { values: ['4e-324', '6e-324'], shares: ['40.00%', '60.00%'] },
    { values: ['1e400', '2e400'], shares: ['33.33%', '66.67%'] },
    {
      values: ['1e-999999999999999999999', '2e-999999999999999999999'],
      shares: ['33.33%', '66.67%'],
    },
    {
      values: ['1e999999999999999999999', '2e999999999999999999999'],
      shares: ['33.33%', '66.67%'],
    },
  ]
  for (const example of cases) {
    const snapshot = frame({
      axes: [categoryAxis(2)],
      values: [{ name: 'v', type: 'decimal', values: example.values }],
    })
    for (const view of [
      { chart: 'pie' as const },
      { chart: 'pie' as const, style: 'stacked' as const },
    ]) {
      const html = await renderer.render(snapshot, { view, askPoint: true })
      assert.match(html, view.style ? /data-chart="category-composition"/ : /data-chart="pie"/)
      for (const share of example.shares)
        assert.ok(html.includes(share), `${example.values}: ${share}`)
      for (const value of example.values)
        assert.ok(html.includes(value), `${example.values}: ${value}`)
      if (view.style) {
        const list = html.match(/<ul class="fv-share-list">[\s\S]*?<\/ul>/)?.[0] ?? ''
        assert.ok(list.indexOf('r1') < list.indexOf('r0'))
        assert.match(list, /data-frame-point="1:v"/)
        assert.match(list, /data-frame-point="0:v"/)
      }
    }
  }
})

test('extreme mixed magnitudes preserve positive and zero labels without overflow', async () => {
  const snapshot = frame({
    axes: [categoryAxis(4)],
    values: [{ name: 'v', type: 'decimal', values: ['1e-99999', '1e99999', '0e99999', '1e20'] }],
  })
  for (const view of [
    { chart: 'pie' as const },
    { chart: 'pie' as const, style: 'stacked' as const },
  ]) {
    const html = await renderer.render(snapshot, { view })
    assert.match(html, /100\.00%/)
    assert.match(html, /&lt;0\.01%/)
    assert.match(html, /0\.00%/)
    assert.doesNotMatch(html, /10000000000000000000000\.00%/)
  }
})

test('the original pie remains the default and does not silently become a stack', async () => {
  const snapshot = frame({ axes: [categoryAxis(2)], values: [{ name: 'v', values: [2, 1] }] })
  const html = await renderer.render(snapshot, { view: { chart: 'pie' } })
  assert.match(html, /data-chart="pie"/)
  assert.doesNotMatch(html, /data-chart="category-composition"/)
})

test('stacked composition rejects missing, negative, all-zero and truncated source values', () => {
  for (const values of [
    [2, null],
    [2, -1],
    [0, 0],
  ]) {
    const snapshot = frame({ axes: [categoryAxis(2)], values: [{ name: 'v', values }] })
    const resolved = resolveFrameView(snapshot, { chart: 'pie', style: 'stacked' })
    assert.equal(resolved.ok, false)
    if (!resolved.ok) assert.equal(resolved.code, 'view-pie-invalid-values')
  }
  const partial = frame({ axes: [categoryAxis(2)], values: [{ name: 'v', values: [1, 2] }] })
  partial.coverage.complete = false
  partial.data.truncated = true
  const resolved = resolveFrameView(partial, { chart: 'pie', style: 'stacked' })
  assert.equal(resolved.ok, false)
  if (!resolved.ok) assert.equal(resolved.code, 'view-requires-complete-snapshot')
})
