import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { translator } from './../../src/client/i18n/copy.ts'
import type { ChartBlock, ReaderMode } from '../../src/client/presentation/model.ts'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationDocument } from '../../src/presentation/contracts/types.ts'

let directory: string
let renderChart: (document: PresentationDocument, block: ChartBlock, mode?: ReaderMode) => string

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-chart-render-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { CopyProvider } from './src/client/i18n/context.tsx';
import { translator as fixtureTranslator } from './src/client/i18n/copy.ts';
const renderToStaticMarkup = node => renderMarkup(createElement(CopyProvider, { t: fixtureTranslator('zh-CN') }, node));
import { ChartRenderer } from './src/client/presentation/chart-renderer.tsx';
export function renderChart(document, block, mode = 'interactive') { return renderToStaticMarkup(createElement(ChartRenderer, { dataset: document.datasets[0], block, mode })); }`,
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
  ;({ renderChart } = await import(pathToFileURL(outfile).href))
})

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture() {
  return parsePresentationDocument(
    JSON.parse(
      await fs.readFile(
        new URL('../presentation-s0/fixtures/computed.document.json', import.meta.url),
        'utf8',
      ),
    ),
  )
}

const block: ChartBlock = {
  id: 'chart',
  kind: 'chart',
  datasetId: 'computed',
  chart: 'bar',
  x: 'period',
  y: ['amount'],
  numericMode: 'approximate',
}

test('interactive chart leaves exact data access to the source card without duplicate controls', async () => {
  const document = await fixture()
  const data = document.datasets[0]!.data
  data.truncated = false
  data.rowCount = data.rows.length
  const html = renderChart(document, block)
  assert.doesNotMatch(
    translator('zh-CN')(html),
    /<select|<details|<table|复制|pr-coordinate|已保存/,
  )
  assert.doesNotMatch(translator('zh-CN')(html), /aria-label="图表系列"/)
  assert.match(translator('zh-CN')(html), /近似绘图/)
})

test('interactive truncation and approximation stay visible alongside distinct series controls', async () => {
  const document = await fixture()
  const html = renderChart(document, { ...block, y: ['amount', 'count'] })
  assert.match(translator('zh-CN')(html), /显示 3 \/ 5 行（已截断）/)
  assert.match(translator('zh-CN')(html), /近似绘图/)
  assert.equal((html.match(/显示 3 \/ 5 行（已截断）/g) ?? []).length, 1)
  assert.match(translator('zh-CN')(html), /aria-label="图表系列"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /var\(--pr-chart-1\)/)
  assert.match(html, /var\(--pr-chart-2\)/)
  assert.equal((html.match(/class="pr-chart-group"/g) ?? []).length, 2)
  assert.doesNotMatch(translator('zh-CN')(html), /pr-axis-unit|不同单位分图展示|纵轴：/)
})

test('static charts retain every saved exact row and visible data limits without interactive controls', async () => {
  const document = await fixture()
  const html = renderChart(document, block, 'static')
  assert.doesNotMatch(translator('zh-CN')(html), /近似/)
  assert.match(translator('zh-CN')(html), /显示 3 \/ 5 行（已截断）/)
  assert.match(translator('zh-CN')(html), /精确数据/)
  assert.match(html, /12345678901234\.5678/)
  assert.match(html, /0\.1000/)
  assert.match(html, /data-cell-null="true"/)
  assert.equal(
    (html.match(/data-row-index=/g) ?? []).length,
    document.datasets[0]!.data.rows.length,
  )
  assert.doesNotMatch(html, /<details|<button|<select/)
})
