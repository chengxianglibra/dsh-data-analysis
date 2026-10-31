import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  align,
  attributeAdditive,
  attributeEffects,
  categoryAxis,
  compareOrdinary,
} from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('comparison marks identify current and baseline fields independently', () => {
  const html = renderer.render(compareOrdinary([categoryAxis(3)]), { askPoint: true })
  assert.match(html, /data-frame-point="0:sales"/)
  assert.match(html, /data-frame-point="0:prior\.baseline\.sales"/)
})

test('alignment never exposes a point for a missing side', () => {
  const snapshot = align(categoryAxis(3))
  const i = snapshot.data.columns.findIndex((c) => c.id === 'right_present')
  snapshot.data.rows[0]![i] = false
  const html = renderer.render(snapshot, { askPoint: true })
  assert.match(html, /data-frame-point="0:left\.revenue"/)
  assert.doesNotMatch(html, /data-frame-point="0:right\.revenue"/)
})

test('waterfall exposes contributions, not the parent total', () => {
  const html = renderer.render(attributeAdditive(), { askPoint: true })
  assert.match(html, /data-frame-point="0:contribution"/)
  assert.doesNotMatch(html, /data-frame-point="\d+:total"/)
})

test('effect segments preserve their own saved field identity', () => {
  const html = renderer.render(attributeEffects(), { askPoint: true })
  assert.match(html, /data-frame-point="0:effect_within"/)
  assert.match(html, /data-frame-point="0:effect_mix"/)
  assert.match(html, /data-frame-point="0:contribution"/)
})
