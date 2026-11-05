import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { align, categoryAxis } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('alignment axis is compact while its label retains each saved endpoint', async () => {
  const snapshot = align(categoryAxis(3))
  const left = snapshot.data.columns.findIndex((item) => item.id === 'left.revenue')
  const right = snapshot.data.columns.findIndex((item) => item.id === 'right.revenue')
  snapshot.data.rows[0]![left] = 59259589.579998724
  snapshot.data.rows[0]![right] = 56906020.59
  const html = await renderer.render(snapshot)
  assert.match(html, /59\.3M/)
  assert.match(html, /59,259,589\.58/)
  assert.match(html, /56,906,020\.59/)
  assert.match(html, /data-chart-end-label="" x="100%"/)
})
