import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationDocument } from '../../src/presentation/contracts/types.ts'

let directory: string
let renderDocument: (document: PresentationDocument, mode?: 'static' | 'interactive') => string
let renderMarkdown: (text: string) => string
let renderExplorer: (document: PresentationDocument) => string
let renderHost: (document: PresentationDocument) => string

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-reader-render-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationReader } from './src/client/presentation/reader.tsx';
import { Markdown } from './src/client/presentation/markdown.tsx';
import { ChartExplorer } from './src/client/presentation/chart-explorer.tsx';
import { initialChartExploration } from './src/client/presentation/chart-view.ts';
import { HostPresentationReader } from './src/client/presentation/host-entry.tsx';
export function renderExplorer(document) { const block = document.blocks.find(b => b.kind === 'chart'); const data = document.datasets.find(d => d.id === block.datasetId).data; return renderToStaticMarkup(createElement(ChartExplorer, { block, data, state: initialChartExploration(block), onChange() {}, onClose() {} })); }
export function renderHost(document) { return renderToStaticMarkup(createElement(HostPresentationReader, { document })); }
export function renderDocument(document, mode = 'static') { return renderToStaticMarkup(createElement(PresentationReader, { document, mode })); }
export function renderMarkdown(text) { return renderToStaticMarkup(createElement(Markdown, { text })); }`,
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
  ;({ renderDocument, renderMarkdown, renderExplorer, renderHost } = await import(
    pathToFileURL(outfile).href
  ))
})

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

async function fixture(name: string) {
  return parsePresentationDocument(
    JSON.parse(
      await fs.readFile(
        new URL(`../presentation-s0/fixtures/${name}.document.json`, import.meta.url),
        'utf8',
      ),
    ),
  )
}

test('static reader keeps exact data, null metric units, sources omitted from blocks, diagnostics and every saved row', async () => {
  const document = await fixture('computed')
  document.blocks = [
    {
      id: 'metric',
      kind: 'metric',
      datasetId: 'computed',
      columnId: 'amount',
      rowIndex: 1,
      label: '空指标',
    },
    { id: 'table', kind: 'table', datasetId: 'computed' },
  ]
  const html = renderDocument(document)
  assert.match(html, /data-mode="static"/)
  assert.match(html, /12345678901234\.5678/)
  assert.match(html, /9007199254740993/)
  assert.match(html, /0\.1000/)
  assert.match(html, /金额 \(CNY\)/)
  assert.match(html, /data-cell-null="true"/)
  assert.match(html, /The declared Artifact is not available/)
  assert.match(html, /显示 3 \/ 5 行（已截断）/)
  assert.doesNotMatch(html, /<button|<select|<svg/)
  assert.match(html, /<details/)
})

test('source-only reader has no synthetic dataset and keeps unreferenced saved sources readable', async () => {
  const document = await fixture('source-only')
  document.blocks = [{ id: 'text', kind: 'markdown', text: '只保留来源。' }]
  const html = renderDocument(document)
  assert.match(html, /The declared Artifact is not available/)
  assert.doesNotMatch(html, /<table/)
})

test('explorer exposes all types with unavailable prepared statistics disabled and native keyboard controls', async () => {
  const document = await fixture('computed')
  const html = renderExplorer(document)
  assert.match(html, /aria-label="探索图表"/)
  assert.match(html, /aria-label="关闭探索图表"/)
  for (const type of [
    'line',
    'area',
    'stackedArea',
    'sparkline',
    'bar',
    'horizontalBar',
    'stackedBar',
    'stackedBar100',
    'horizontalStackedBar',
    'horizontalStackedBar100',
    'histogram',
    'boxPlot',
    'scatter',
    'heatmap',
    'pie',
    'leaderboard',
    'funnel',
    'waterfall',
  ])
    assert.ok(html.includes(`value="${type}"`), type)
  assert.match(html, /value="histogram" disabled=""/)
  assert.match(html, /value="stackedBar100" disabled=""/)
  assert.match(html, /数值系列/)
  assert.match(html, /X 字段/)
  assert.match(html, /保留分类值/)
  assert.match(html, /<select[^>]+multiple=""/)
  assert.match(html, /恢复原图/)
  assert.doesNotMatch(html, /<script|fetch\(|localStorage/)
})

test('Host includes an original full exact snapshot for printing independently of interactive exploration', async () => {
  const document = await fixture('computed')
  const html = renderHost(document)
  assert.match(html, /class="pr-host-live"/)
  assert.match(html, /class="pr-host-print"><article[^>]+data-mode="static"/)
  assert.match(html, /\.pr-host-live \{ display:none!important \}/)
  assert.match(html, /\.pr-host-print \{ display:block!important \}/)
  assert.match(html, /9007199254740993/)
  assert.match(html, /0\.1000/)
})

test('cell and filter identifiers matching Object prototype names remain ordinary snapshot identifiers', async () => {
  const document = await fixture('computed')
  const block = document.blocks.find((entry) => entry.kind === 'chart')!
  assert.equal(block.kind, 'chart')
  const dataset = document.datasets.find((entry) => entry.id === block.datasetId)!
  dataset.data.columns.find((column) => column.id === block.x)!.id = 'constructor'
  document.blocks = [{ ...block, id: 'constructor', x: 'constructor' }]
  assert.match(renderDocument(document, 'interactive'), /data-block-id="constructor"/)
  assert.match(renderExplorer(document), /data-chart-explorer="constructor"/)
})

test('static charts keep exact tables while interactive chart details live behind cell tools', async () => {
  const document = await fixture('computed')
  document.blocks = [
    {
      id: 'decimal-chart',
      kind: 'chart',
      datasetId: 'computed',
      chart: 'line',
      x: 'period',
      y: ['amount', 'count'],
      numericMode: 'approximate',
    },
  ]
  const html = renderDocument(document)
  assert.doesNotMatch(html, /图形为近似编码|近似绘图/)
  assert.match(html, /精确数据/)
  assert.match(html, /12345678901234\.5678/)
  const interactive = renderDocument(document, 'interactive')
  assert.equal((interactive.match(/class="pr-chart-group"/g) ?? []).length, 2)
  assert.doesNotMatch(interactive, /pr-axis-unit|不同单位分图展示|纵轴：/)
  assert.match(interactive, /近似绘图/)
  assert.match(interactive, /aria-label="cell 更多操作"/)
  assert.doesNotMatch(interactive, /选择图表数据行|查看数据|pr-exact-data|<table/)
})

test('read-only Markdown renders structure while refusing executable HTML, image requests and unsafe URLs', () => {
  const html = renderMarkdown(
    '# 标题\n\n**重点** 和 *斜体* 与 `代码`\n\n- 项目\n\n> 引用\n\n```js\n<script>evil()</script>\n```\n\n[安全](https://example.com) [坏](javascript:evil) ![图片](https://example.com/image.png)\n\n<img src="https://example.com/raw.png">',
  )
  assert.match(html, /<h2>标题<\/h2>/)
  assert.match(renderMarkdown('## 章节\n\n### 子章节'), /<h2>章节<\/h2><h3>子章节<\/h3>/)
  assert.match(html, /<strong>重点<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<blockquote>/)
  assert.match(html, /href="https:\/\/example.com"/)
  assert.doesNotMatch(html, /<script|<img|href="javascript:/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /图片：图片/)
  assert.match(renderMarkdown('>'.repeat(32_768)), /&gt;/)
})

test('maximum-size malformed link delimiters remain complete plain text', () => {
  for (const text of ['['.repeat(32_768), '[a]('.repeat(8_192)]) {
    assert.equal(renderMarkdown(text), `<div class="pr-markdown"><p>${text}</p></div>`)
  }
  assert.match(
    renderMarkdown('[普通链接](https://example.com/path?q=value)'),
    /href="https:\/\/example.com\/path\?q=value"/,
  )
})

test('reader keeps authored cells and document intact while presenting concise cell tools', async () => {
  const document = await fixture('computed')
  const metric = {
    id: 'first',
    kind: 'metric' as const,
    datasetId: 'computed',
    columnId: 'count',
    rowIndex: 0,
    label: '原始指标',
  }
  document.blocks = [
    metric,
    { ...metric, id: 'second' },
    { ...metric, id: 'third' },
    { id: 'body', kind: 'markdown', text: '原始正文：未经任何解释性改写。' },
    { ...metric, id: 'fourth' },
    { id: 'sources', kind: 'source', sourceIds: document.sources.map((source) => source.id) },
  ]
  document.diagnostics = [
    { code: 'definition_unavailable', message: 'original definition message', path: '/sources/0' },
    { code: 'definition_unavailable', message: 'original definition message', path: '/sources/1' },
    { code: 'unknown_warning', message: '保留未知提示', path: '/datasets/0' },
  ]
  const before = structuredClone(document)
  for (const mode of ['static', 'interactive'] as const) {
    const html = renderDocument(document, mode)
    assert.equal(html.split('class="pr-metric-group"').length - 1, 2)
    const positions = document.blocks.map((block) => html.indexOf(`data-block-id="${block.id}"`))
    assert.ok(
      positions.every(
        (position, index) => position >= 0 && (!index || position > positions[index - 1]!),
      ),
    )
    assert.match(html, /原始正文：未经任何解释性改写。/)
    for (const source of document.sources) {
      assert.equal(
        html.split(`data-source-id="${source.id}"`).length - 1,
        mode === 'static' ? 1 : 0,
      )
    }
    assert.doesNotMatch(html, /original definition message|\/sources\/0|\/sources\/1/)
    assert.ok(html.indexOf('保留未知提示') < html.indexOf('data-block-id="first"'))
    assert.doesNotMatch(
      html,
      /pr-diagnostics-secondary|pr-footer|pr-source-links|继续分析|声明关联|计算已验证|保存数据第/,
    )
    assert.doesNotMatch(html, /aria-label="复制 cell 上下文"/)
    assert.equal(
      html.split('aria-label="cell 更多操作"').length - 1,
      mode === 'interactive' ? document.blocks.length : 0,
    )
    assert.doesNotMatch(html, /class="pr-source-dialog"/)
    assert.deepEqual(document, before)
  }
})
