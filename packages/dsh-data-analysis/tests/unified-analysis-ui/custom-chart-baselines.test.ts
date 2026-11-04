import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { bundleRenderer, monthly, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})
const render = (values: (number | null)[]) =>
  renderer.render(monthly(values), { view: { chart: 'area' } })
const area = (markup: string) =>
  /<path[^>]*class="recharts-curve recharts-area-area"[^>]*d="([^"]+)"/.exec(markup)?.[1] ?? ''
const zero = (markup: string) =>
  Number(/<line[^>]*y1="([^"]+)"[^>]*class="recharts-reference-line-line"/.exec(markup)?.[1])
const yValues = (path: string) =>
  [...path.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((match) => Number(match[2]))

test('positive and negative Recharts areas fill to the actual zero reference', async () => {
  for (const values of [
    [10, 20],
    [-20, -10],
  ]) {
    const markup = await render(values)
    const path = area(markup)
    assert.ok(path, 'actual browser renders an area')
    const baseline = zero(markup)
    assert.ok(Number.isFinite(baseline), 'a zero reference exists')
    const ys = yValues(path)
    assert.ok(ys.filter((y) => Math.abs(y - baseline) < 0.01).length >= 2)
    assert.ok(Math.abs(baseline - (values[0]! > 0 ? Math.max(...ys) : Math.min(...ys))) < 0.01)
  }
})
test('mixed signs use an interior zero baseline', async () => {
  const markup = await render([-20, 20])
  const ys = yValues(area(markup))
  const baseline = zero(markup)
  assert.ok(baseline > Math.min(...ys) && baseline < Math.max(...ys))
})
test('nulls break filled segments while zero remains a saved plotted value', async () => {
  const markup = await render([10, 20, null, 15, 25])
  assert.equal((area(markup).match(/M/g) ?? []).length, 2)
  assert.equal(area(await render([null, null])), '')
  assert.ok(area(await render([0, 0])))
})
