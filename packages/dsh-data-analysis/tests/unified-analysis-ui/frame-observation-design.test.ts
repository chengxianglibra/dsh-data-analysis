import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  axisGroups,
  categoryAxis,
  correlate,
  frame,
  shareByRegion,
  shareOf,
} from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('complete composition sorts saved shares descending while retaining original row identities', async () => {
  const snapshot = shareByRegion()
  const index = snapshot.data.columns.findIndex((column) => column.id === 'revenue_share')
  for (const [row, value] of [0.25, 0.5, 0.25].entries()) snapshot.data.rows[row]![index] = value
  const html = await renderer.render(snapshot, { askPoint: true })
  const list = html.match(/<ul class="fv-share-list">[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.ok(list)
  assert.ok(list.indexOf('r1') < list.indexOf('r0'))
  assert.ok(list.indexOf('r0') < list.indexOf('r2'))
  for (const row of [0, 1, 2])
    assert.match(list, new RegExp(`data-frame-point="${row}:revenue_share"`))
})

test('decimal shares preserve tiny positive and zero values in a complete composition', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [
      {
        name: 'fraction',
        type: 'decimal',
        values: ['1', '1e-400', '0e-400'],
        context: shareOf(axisGroups('region')),
      },
    ],
  })
  const html = await renderer.render(snapshot, { askPoint: true })
  const list = html.match(/<ul class="fv-share-list">[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.match(list, /data-frame-point="1:fraction"[^>]*>&lt;0\.01%<\/button>/)
  assert.match(list, /data-frame-point="2:fraction"[^>]*>0\.00%<\/button>/)
})

test('negative decimal underflow is not treated as a nonnegative composition', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [
      {
        name: 'fraction',
        type: 'decimal',
        values: ['1', '-1e-400', '0e-400'],
        context: shareOf(axisGroups('region')),
      },
    ],
  })
  const html = await renderer.render(snapshot)
  assert.doesNotMatch(html, /data-chart="share-composition"/)
  assert.match(html, /&gt;-0\.01%/)
  assert.match(html, /0\.00%/)
})

test('pie legend distinguishes a positive underflow share from zero', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: [{ name: 'v', type: 'decimal', values: ['1e308', '1e-400', '0e-400'] }],
  })
  const html = await renderer.render(snapshot, { view: { chart: 'pie' } })
  const legend = html.match(/<ul class="fv-pie-legend">[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.match(legend, /&lt;0\.1%/)
  assert.match(legend, /0\.00%/)
})

test('a scalar correlation uses a compact fixed scale and keeps its selectable saved coefficient', async () => {
  const html = await renderer.render(correlate(false), { askPoint: true })
  assert.match(html, /data-chart="correlation-scale"/)
  assert.match(html, /aria-label="[^"]*0\.500[^"]*n 30/)
  assert.match(html, /data-frame-point="0:coefficient"/)
  assert.match(html, />−1<\/text>/)
  assert.match(html, />\+1<\/text>/)
  assert.match(html, /<title>[^<]*n 30<\/title>/)
})

test('multi-row correlation retains the general plot and individual points', async () => {
  const html = await renderer.render(correlate(true), { askPoint: true })
  assert.doesNotMatch(html, /data-chart="correlation-scale"/)
  for (const row of [0, 1, 2])
    assert.match(html, new RegExp(`data-frame-point="${row}:coefficient"`))
})
