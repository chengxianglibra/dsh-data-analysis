import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { datasetSnapshot } from './dataset-fixtures.ts'
import { categoryAxis, frame } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

test('category bars mark saved nulls visibly without turning them into selectable zeroes', async () => {
  const snapshot = frame({
    axes: [{ ...categoryAxis(3), keys: ['Known', 'Null', 'Zero'] }],
    values: [{ name: 'revenue', values: [5, null, 0] }],
  })
  for (const view of [undefined, { chart: 'bar' } as const]) {
    const html = await renderer.render(snapshot, { view, askPoint: true })
    assert.equal((html.match(/data-mark="missing"/g) ?? []).length, 1)
    assert.match(html, /data-mark="missing"[^>]*>NA<\/text>/)
    assert.doesNotMatch(html, /data-frame-point="1:revenue"/)
    assert.match(html, /data-frame-point="2:revenue"/)
  }
})

test('Dataset bars display saved nulls distinctly from zero', async () => {
  const snapshot = datasetSnapshot([
    ['Known', '5'],
    ['Null', null],
    ['Zero', '0'],
  ])
  const html = await renderer.render(snapshot, {
    view: { chart: 'bar', encoding: { axis: 'category', values: ['value'] } },
    askPoint: true,
  })
  assert.equal((html.match(/data-mark="missing"/g) ?? []).length, 1)
  assert.match(html, /data-mark="missing"[^>]*>NA<\/text>/)
  assert.doesNotMatch(html, /data-frame-point="1:value"/)
  assert.match(html, /data-mark="zero"/)
})

test('an absent category-series combination is not labeled as a saved null', async () => {
  const snapshot = datasetSnapshot(
    [
      ['A', 'one', null],
      ['A', 'two', '3'],
      ['B', 'one', '5'],
    ],
    [
      { id: 'category', label: 'Category', type: 'string', nullable: false },
      { id: 'series', label: 'Series', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'decimal', nullable: true },
    ],
  )
  const html = await renderer.render(snapshot, {
    view: { chart: 'bar', encoding: { axis: 'category', series: 'series', values: ['value'] } },
  })
  assert.equal((html.match(/data-mark="missing"/g) ?? []).length, 1)
})

test('dense bars retain saved nulls', async () => {
  const count = 60
  const snapshot = frame({
    axes: [categoryAxis(count)],
    values: [{ name: 'revenue', values: Array(count).fill(null) }],
  })
  const html = await renderer.render(snapshot, { view: { chart: 'bar' } })
  assert.equal((html.match(/<g data-mark="missing"/g) ?? []).length, count)
  assert.match(html, /data-missing-key=""[^>]*><span[^>]*>× <\/span>NA/)
  assert.match(html, /data-mark="missing"><desc>r0 · revenue: NA<\/desc>/)
})

test('grouped bars retain saved nulls', async () => {
  const snapshot = frame({
    axes: [categoryAxis(3)],
    values: Array.from({ length: 8 }, (_, i) => ({ name: `v${i}`, values: [null, null, null] })),
  })
  for (const column of snapshot.data.columns) if (column.id.startsWith('v')) column.unit = 'USD'
  const html = await renderer.render(snapshot, { view: { chart: 'bar' } })
  assert.equal((html.match(/<g data-mark="missing"/g) ?? []).length, 24)
  assert.match(html, /data-missing-key=""/)
})

test('a single null remains identifiable in a large grouped category chart', async () => {
  const columns = [
    { id: 'category', label: 'Category', type: 'string' as const, nullable: false },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `v${i}`,
      label: `Value ${i}`,
      type: 'float64' as const,
      nullable: true,
      unit: 'USD',
    })),
  ]
  const rows = Array.from({ length: 500 }, (_, i) => [
    `Category ${i}`,
    ...Array.from({ length: 8 }, (_, j) => (i === 250 && j === 3 ? null : i + j)),
  ])
  const html = await renderer.render(datasetSnapshot(rows, columns), {
    view: {
      chart: 'bar',
      encoding: { axis: 'category', values: columns.slice(1).map((column) => column.id) },
    },
  })
  assert.equal((html.match(/<g data-mark="missing"/g) ?? []).length, 1)
  assert.match(html, /data-missing-key=""/)
})
