import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chartGallery } from '../../scripts/presentation-chart-gallery.ts'
import type { ChartBlock } from '../../src/client/presentation/model.ts'
import type {
  DocumentDataset,
  PresentationDocument,
} from '../../src/presentation/contracts/types.ts'

let directory: string
let gallery: PresentationDocument
let render: (dataset: DocumentDataset, block: ChartBlock) => string

before(async () => {
  gallery = await chartGallery()
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-special-layout-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpecialChart } from './src/client/presentation/chart-specials.tsx';
export function render(dataset, block) {
  return renderToStaticMarkup(createElement(SpecialChart, {
    dataset, block, title: block.chart,
    rowIndices: dataset.data.rows.map((_, index) => index), visible: new Set(block.y),
  }));
}`,
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
  ;({ render } = await import(pathToFileURL(outfile).href))
})

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true })
})

function fixture(type: ChartBlock['chart']) {
  const block = gallery.blocks.find(
    (block): block is ChartBlock => block.kind === 'chart' && block.chart === type,
  )!
  return { block, dataset: gallery.datasets.find((dataset) => dataset.id === block.datasetId)! }
}

test('special charts start with pixel-matched SVG dimensions and stable row heights', () => {
  for (const type of [
    'histogram',
    'boxPlot',
    'heatmap',
    'pie',
    'funnel',
    'waterfall',
    'leaderboard',
  ] as const) {
    const { dataset, block } = fixture(type)
    const count = dataset.data.rows.length
    const expectedHeight = {
      histogram: 320,
      boxPlot: 74 + Math.max(count, 1) * 46,
      heatmap: Math.max(130, 96 + count * 40),
      pie: Math.max(320, count * 30 + 44),
      funnel: Math.max(130, 44 + count * 48),
      waterfall: 320,
      leaderboard: 74 + Math.max(count, 1) * 40,
    }[type]
    const html = render(dataset, block)
    assert.match(
      html,
      new RegExp(`width="720" height="${expectedHeight}" viewBox="0 0 720 ${expectedHeight}"`),
      type,
    )
  }
})

test('capped waterfall columns keep connectors at bar edges and labels centered', () => {
  const { dataset, block } = fixture('waterfall')
  const html = render(dataset, { ...block, options: { ...block.options, valueLabels: 'all' } })
  const bars = [...html.matchAll(/<rect\s+x="([^"]+)"[^>]*\swidth="([^"]+)"/g)].map((match) => ({
    x: Number(match[1]),
    width: Number(match[2]),
  }))
  assert.equal(bars.length, dataset.data.rows.length)
  assert.ok(bars.every((bar) => bar.width === 48))
  const connectors = [
    ...html.matchAll(/<line\s+x1="([^"]+)"\s+x2="([^"]+)"[^>]*data-waterfall-connector="true"/g),
  ]
  assert.equal(connectors.length, bars.length - 1)
  for (const [index, connector] of connectors.entries()) {
    assert.equal(Number(connector[1]), bars[index]!.x + bars[index]!.width)
    assert.equal(Number(connector[2]), bars[index + 1]!.x)
  }
  const labels = [...html.matchAll(/<text class="pr-chart-label" x="([^"]+)"/g)]
  assert.equal(labels.length, bars.length)
  for (const [index, label] of labels.entries())
    assert.equal(Number(label[1]), bars[index]!.x + bars[index]!.width / 2)
})
