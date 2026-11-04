import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  align,
  attributeAdditive,
  attributeEffects,
  categoryAxis,
  compareOrdinary,
  correlate,
  shareByRegion,
} from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('comparison marks identify current and baseline fields independently', async () => {
  const html = await renderer.render(compareOrdinary([categoryAxis(3)]), { askPoint: true })
  assert.match(html, /data-frame-point="0:sales"/)
  assert.match(html, /data-frame-point="0:prior\.baseline\.sales"/)
})

test('alignment never exposes a point for a missing side', async () => {
  const snapshot = align(categoryAxis(3))
  const i = snapshot.data.columns.findIndex((c) => c.id === 'right_present')
  snapshot.data.rows[0]![i] = false
  const html = await renderer.render(snapshot, { askPoint: true })
  assert.match(html, /data-frame-point="0:left\.revenue"/)
  assert.doesNotMatch(html, /data-frame-point="0:right\.revenue"/)
})

test('waterfall exposes contributions, not the parent total', async () => {
  const html = await renderer.render(attributeAdditive(), { askPoint: true })
  assert.match(html, /data-frame-point="0:contribution"/)
  assert.doesNotMatch(html, /data-frame-point="\d+:total"/)
})

test('effect segments preserve their own saved field identity', async () => {
  const html = await renderer.render(attributeEffects(), { askPoint: true })
  assert.match(html, /data-frame-point="0:effect_within"/)
  assert.match(html, /data-frame-point="0:effect_mix"/)
  assert.match(html, /data-frame-point="0:contribution"/)
})

test('domain point labels use the same numeric and semantic formatting as the view', async () => {
  const aligned = align(categoryAxis(3))
  const value = aligned.data.columns.findIndex((column) => column.id === 'left.revenue')
  aligned.data.rows[0]![value] = 1.23456
  const alignment = await renderer.render(aligned, { askPoint: true })
  assert.match(alignment, /left\.revenue: 1\.23/)
  assert.doesNotMatch(alignment, /left\.revenue: 1\.23456/)

  const correlation = await renderer.render(correlate(true), { askPoint: true })
  assert.match(correlation, /coefficient: 0\.500/)
  const share = await renderer.render(shareByRegion(), { askPoint: true })
  assert.match(share, /revenue_share: 25\.00%/)
})
