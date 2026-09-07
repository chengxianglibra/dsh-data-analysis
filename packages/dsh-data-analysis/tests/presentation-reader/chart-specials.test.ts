import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chartGallery } from '../../scripts/presentation-chart-gallery.ts'
import type { ChartBlock } from '../../src/client/presentation/model.ts'
import { chartColumns } from '../../src/presentation/contracts/charts.ts'
import type {
  DocumentDataset,
  PresentationDocument,
} from '../../src/presentation/contracts/types.ts'

let directory: string
let gallery: PresentationDocument
let render: (
  dataset: DocumentDataset,
  block: ChartBlock,
  options?: { mode?: string; rowIndices?: number[]; hidden?: string[] },
) => string
let tooltip: (dataset: DocumentDataset, block: ChartBlock, rowIndex: number) => string

before(async () => {
  gallery = await chartGallery()
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-special-charts-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartRenderer } from './src/client/presentation/chart-renderer.tsx';
import { ExactTooltip } from './src/client/presentation/chart-tooltip.tsx';
export function render(dataset, block, options = {}) { return renderToStaticMarkup(createElement(ChartRenderer, { dataset, block, mode: 'interactive', ...options })); }
export function tooltip(dataset, block, rowIndex) { return renderToStaticMarkup(createElement(ExactTooltip, { dataset, block, rowIndex })); }`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  ;({ render, tooltip } = await import(pathToFileURL(outfile).href))
})

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

function fixture(type: ChartBlock['chart']) {
  const block = gallery.blocks.find(
    (block): block is ChartBlock => block.kind === 'chart' && block.chart === type,
  )!
  return { block, dataset: gallery.datasets.find((dataset) => dataset.id === block.datasetId)! }
}

test('all 18 chart families render interactive and exact static output without changing the snapshot', () => {
  const before = JSON.stringify(gallery)
  for (const block of gallery.blocks) {
    if (block.kind !== 'chart') continue
    const dataset = gallery.datasets.find((dataset) => dataset.id === block.datasetId)!
    const html = render(dataset, block)
    assert.match(html, new RegExp(`data-chart-type="${block.chart}"`))
    assert.doesNotMatch(html, /NaN|Infinity/)
    const table = render(dataset, block, { mode: 'static' })
    for (const column of chartColumns(block))
      assert.ok(table.includes(`data-column-id="${column}"`), `${block.chart} includes ${column}`)
  }
  assert.equal(JSON.stringify(gallery), before)
})

test('histogram uses declared bin widths and original filtered source rows', () => {
  const { block, dataset } = fixture('histogram')
  const html = render(dataset, block)
  const widths = [...html.matchAll(/<rect[^>]*?\swidth="([^"]+)"/g)].map((match) =>
    Number(match[1]),
  )
  assert.equal(widths.length, 3)
  assert.ok(Math.abs(widths[1]! / widths[0]! - 2) < 1e-12)
  assert.ok(Math.abs(widths[2]! / widths[0]! - 3) < 1e-12)
  const filtered = render(dataset, block, { rowIndices: [2] })
  assert.match(filtered, /data-source-row-index="2"/)
  assert.doesNotMatch(filtered, /data-source-row-index="0"/)
  assert.match(tooltip(dataset, block, 2), /<dt>lower<\/dt><dd>3<\/dd>/)
  assert.match(tooltip(dataset, block, 2), /<dt>upper<\/dt><dd>6<\/dd>/)
})

test('heatmap visibility controls do not imply categorical colors on a shared value scale', () => {
  const { block, dataset } = fixture('heatmap')
  const html = render(dataset, block)
  assert.match(html, /aria-label="显示系列 a"/)
  assert.match(html, /aria-label="显示系列 b"/)
  assert.doesNotMatch(html, /class="pr-swatch"/)
})

test('box plots draw all five summary components, and missing summaries have no fabricated box', () => {
  const { block, dataset } = fixture('boxPlot')
  const html = render(dataset, block)
  assert.equal((html.match(/data-box-part="whisker"/g) ?? []).length, 2)
  assert.equal((html.match(/data-box-part="cap"/g) ?? []).length, 4)
  assert.equal((html.match(/data-box-part="box"/g) ?? []).length, 2)
  assert.equal((html.match(/data-box-part="median"/g) ?? []).length, 2)
  const missing = structuredClone(dataset)
  missing.data.rows[0]![1] = null
  const sparse = render(missing, block)
  assert.equal((sparse.match(/data-box-part="box"/g) ?? []).length, 1)
})

test('pie filtering preserves authored angular offsets, values and denominator shares', () => {
  const { block, dataset } = fixture('pie')
  const filtered = render(dataset, block, { rowIndices: [1] })
  assert.match(filtered, /data-source-row-index="1"/)
  assert.match(filtered, /data-share-start="0\.6"/)
  assert.match(filtered, /data-share-end="0\.8999999999999999"/)
  assert.match(filtered, /B: 30 · 0\.3/)
  assert.equal((filtered.match(/<path /g) ?? []).length, 1)
})

test('heatmap duplicate categories stay separate and waterfall geometry uses authored roles', () => {
  const { block, dataset } = fixture('heatmap')
  const duplicate = structuredClone(dataset)
  duplicate.data.rows[1]![0] = duplicate.data.rows[0]![0]!
  const html = render(duplicate, block, { rowIndices: [0, 1] })
  assert.equal((html.match(/data-chart-mark="heatmap:/g) ?? []).length, block.y.length * 2)
  const waterfall = fixture('waterfall')
  const geometry = render(waterfall.dataset, waterfall.block)
  assert.match(geometry, /data-waterfall-role="start"/)
  assert.match(geometry, /data-waterfall-role="delta"/)
  assert.match(geometry, /data-waterfall-role="total"/)
})

test('special value labels and reference lines have real SVG output', () => {
  for (const type of ['histogram', 'boxPlot', 'leaderboard', 'waterfall'] as const) {
    const { block, dataset } = fixture(type)
    const axis = type === 'boxPlot' || type === 'leaderboard' ? 'x' : 'y'
    const html = render(dataset, {
      ...block,
      options: { valueLabels: 'all', referenceLines: [{ axis, value: 2, label: '参考值' }] },
    })
    assert.match(html, /class="pr-chart-label"/)
    assert.match(html, new RegExp(`data-reference-line="${axis}"`))
    assert.match(html, /参考值/)
  }
})

test('waterfall totals connect at the authored total endpoint and missing roles stay unpainted', () => {
  const { block, dataset } = fixture('waterfall')
  const data = structuredClone(dataset)
  const row = (name: string, value: number, start: number, end: number, role: string | null) =>
    data.data.columns.map((column) => {
      if (column.id === block.x) return name
      if (column.id === block.y[0]) return value
      if (column.id === block.bindings!.start) return start
      if (column.id === block.bindings!.end) return end
      if (column.id === block.bindings!.role) return role
      return null
    })
  data.data.rows = [
    row('opening', 10, 0, 10, 'start'),
    row('change', -3, 10, 7, 'delta'),
    row('ending', 7, 0, 7, 'total'),
  ]
  data.data.rowCount = 3
  const html = render(data, block)
  const connectors = [
    ...html.matchAll(
      /<line[^>]*y1="([^"]+)"[^>]*y2="([^"]+)"[^>]*data-waterfall-connector="true"/g,
    ),
  ]
  assert.equal(connectors.length, 2)
  assert.ok(connectors.every((match) => match[1] === match[2]))
  data.data.rows = [row('missing', 7, 0, 7, null)]
  data.data.rowCount = 1
  assert.doesNotMatch(render(data, block), /<rect/)
})

test('scatter color identities distinguish null and empty strings from their display text', () => {
  const { block, dataset } = fixture('scatter')
  const data = structuredClone(dataset)
  const color = data.data.columns.findIndex((column) => column.id === block.bindings!.color)
  assert.ok(color >= 0)
  data.data.rows = data.data.rows.slice(0, 2)
  data.data.rows[0]![color] = null
  data.data.rows[1]![color] = '—'
  const html = render(data, block)
  assert.equal((html.match(/class="pr-swatch"/g) ?? []).length, 2)
  assert.match(html, /var\(--pr-chart-1\)/)
  assert.match(html, /var\(--pr-chart-2\)/)
})
