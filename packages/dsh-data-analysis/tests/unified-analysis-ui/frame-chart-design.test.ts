import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { calendarBinding, categoryAxis, comparisonOf, frame, timeAxis } from './frame-fixtures.ts'
import { axisPage, bundleRenderer, monthPeriods, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('pie displays each saved category and its share, including a zero value', async () => {
  const snapshot = frame({ axes: [categoryAxis(3)], values: [{ name: 'v', values: [2, 1, 0] }] })
  const markup = await renderer.render(snapshot, { view: { chart: 'pie' }, askPoint: true })
  assert.match(markup, /data-chart="pie"/)
  assert.equal((markup.match(/data-pie-row=/g) ?? []).length, 2)
  assert.match(markup, /66\.67%/)
  assert.match(markup, /33\.33%/)
  assert.match(markup, /0\.00%/)
  assert.match(markup, /data-frame-point="0:v"/)
})

test('pie shares stay finite when the sum of finite inputs overflows', async () => {
  const snapshot = frame({
    axes: [categoryAxis(2)],
    values: [{ name: 'v', type: 'decimal', values: ['1e308', '1e308'] }],
  })
  const markup = await renderer.render(snapshot, { view: { chart: 'pie' } })
  assert.equal((markup.match(/50\.00%/g) ?? []).length >= 2, true)
  assert.doesNotMatch(markup, /NaN|Infinity/)
})

test('time comparison renders distinct baseline and positive and negative saved deltas', async () => {
  const snapshot = frame({
    axes: [timeAxis(3)],
    values: [
      { name: 'sales', values: [10, 14, 8] },
      { name: 'prior.baseline.sales', values: [9, 10, 14] },
      { name: 'prior.absolute.sales', values: [1, 4, -6] },
      { name: 'prior.relative.sales', values: [0.1, 0.4, -0.4] },
    ],
    comparisons: [
      comparisonOf(calendarBinding(), [
        {
          name: 'sales',
          values: [
            ['current', 'sales'],
            ['baseline', 'prior.baseline.sales'],
            ['absolute', 'prior.absolute.sales'],
            ['relative', 'prior.relative.sales'],
          ],
        },
      ]),
    ],
    periods: [axisPage(monthPeriods(3))],
  })
  const markup = await renderer.render(snapshot)
  assert.match(markup, /data-strip="delta"/)
})

test('Frame time charts show formatted labels on both positive and negative bars', async () => {
  const snapshot = frame({
    axes: [timeAxis(2)],
    values: [{ name: 'v', values: [1234.5, -2500.25] }],
    periods: [axisPage(monthPeriods(2))],
  })
  for (const chart of ['line', 'bar'] as const) {
    const markup = await renderer.render(snapshot, { view: { chart } })
    assert.match(markup, /1,234\.50/)
    assert.match(markup, /-2,500\.25/)
  }
})
