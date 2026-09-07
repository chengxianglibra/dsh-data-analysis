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

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-reader-render-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationReader } from './src/client/presentation/reader.tsx';
import { Markdown } from './src/client/presentation/markdown.tsx';
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
  ;({ renderDocument, renderMarkdown } = await import(pathToFileURL(outfile).href))
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
  assert.match(html, /来源不可用/)
  assert.match(html, /art_000000000000000000000000/)
  assert.match(html, /共 5 行/)
  assert.doesNotMatch(html, /<button|<select|<details|<svg/)
})

test('source-only reader has no synthetic dataset and keeps unreferenced saved sources readable', async () => {
  const document = await fixture('source-only')
  document.blocks = [{ id: 'text', kind: 'markdown', text: '只保留来源。' }]
  const html = renderDocument(document)
  assert.match(html, /来源不可用/)
  assert.match(html, /art_000000000000000000000000/)
  assert.doesNotMatch(html, /<table/)
})

test('static line and bar are exact tables; interactive selected coordinates retain original units and decimal spelling', async () => {
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
  assert.match(html, /图形为近似编码/)
  assert.match(html, /精确数据/)
  assert.match(html, /12345678901234\.5678/)
  const interactive = renderDocument(document, 'interactive')
  assert.match(interactive, /不同单位分图展示/)
  assert.match(interactive, /12345678901234\.5678 CNY/)
  assert.match(interactive, /12 次/)
  assert.match(interactive, /aria-label="选择图表数据行"/)
})

test('read-only Markdown renders structure while refusing executable HTML, image requests and unsafe URLs', () => {
  const html = renderMarkdown(
    '# 标题\n\n**重点** 和 *斜体* 与 `代码`\n\n- 项目\n\n> 引用\n\n```js\n<script>evil()</script>\n```\n\n[安全](https://example.com) [坏](javascript:evil) ![图片](https://example.com/image.png)\n\n<img src="https://example.com/raw.png">',
  )
  assert.match(html, /<h2>标题<\/h2>/)
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
