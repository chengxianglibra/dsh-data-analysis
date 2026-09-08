/** Production portable and isolated Host layout acceptance; no Harness or data execution. */
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Locator, type Page } from 'playwright'
import { buildPresentation } from '../src/presentation/build/index.ts'
import { parsePresentationDocument } from '../src/presentation/contracts/index.ts'
import type { PresentationBlock } from '../src/presentation/contracts/types.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { chartGallery } from './presentation-chart-gallery.ts'
import { waitForResponsiveLayout } from './presentation-responsive-browser.ts'

const output = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-layout-')))
process.stdout.write(`Layout acceptance: ${output}\n`)
const { document } = await interactionFixture()
const gallery = await chartGallery()
const fixed = document.blocks.find((block) => block.id === 'fixed')!
const originalChart = document.blocks.find((block) => block.id === 'chart')!
assert(originalChart.kind === 'chart')
const pie = gallery.blocks.find((block) => block.kind === 'chart' && block.chart === 'pie')!
assert(pie.kind === 'chart')
const detail = document.datasets.find((dataset) => dataset.id === originalChart.datasetId)!
// An explicit second synthetic series lets resize checks observe local legend state.
detail.data.columns.push({ id: 'reference', label: '参考查询数', type: 'int64', nullable: false })
for (const row of detail.data.rows) row.push(row[1]!)
document.datasets.push(gallery.datasets.find((dataset) => dataset.id === pie.datasetId)!)
const text = (id: string, title: string): PresentationBlock => ({
  id,
  kind: 'markdown',
  text: `## ${title}\n\n这是用于检查布局的合成示例，正文、指标与图形应根据所在容器调整。${'宽屏正文应利用可用内容宽度，窄屏保留完整阅读顺序。'.repeat(10)}`,
})
const charts = (prefix: string, count: number): PresentationBlock[] =>
  Array.from({ length: count }, (_, index) => ({
    ...originalChart,
    id: `${prefix}-${index + 1}`,
    y: ['query_count', 'reference'],
  }))
const metrics = (prefix: string, count: number): PresentationBlock[] =>
  Array.from({ length: count }, (_, index) => ({ ...fixed, id: `${prefix}-${index + 1}` }))
const dynamic = document.blocks.filter((block) =>
  ['count', 'failed', 'rate', 'table'].includes(block.id),
)
document.title = '文本、KPI 与并排图形 · 布局验收（合成数据）'
document.blocks = [
  text('intro', '单张 KPI'),
  ...metrics('single', 1),
  text('two-kpis', '两张 KPI'),
  ...metrics('two', 2),
  text('many-kpis', '多张 KPI'),
  ...metrics('many', 6),
  text('pair-heading', '两张图形'),
  ...charts('pair', 2),
  text('triple-heading', '三张图形'),
  ...charts('triple', 3),
  text('quad-heading', '四张图形'),
  ...charts('quad', 4),
  text('pie-heading', '两张环形图'),
  { ...pie, id: 'pie-1' },
  { ...pie, id: 'pie-2' },
  text('boundary-heading', '固定与筛选内容边界'),
  ...charts('fixed-before', 1),
  ...charts('dynamic', 2),
  ...dynamic,
  ...charts('dynamic-end', 1),
  ...charts('fixed-after', 1),
  text('end', '结束'),
]
document.interaction!.blockIds = [
  'dynamic-1',
  'dynamic-2',
  ...dynamic.map((block) => block.id),
  'dynamic-end-1',
]
parsePresentationDocument(document)
const portablePath = path.join(output, 'layout.html')
const built = await buildPresentation(document)
await writeFile(portablePath, built.htmlBytes)
await writeFile(path.join(output, 'layout.json'), built.documentBytes)

const hostBundle = await build({
  loader: { '.wasm': 'binary' },
  stdin: {
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    loader: 'tsx',
    contents: `import React from 'react';
import {createRoot} from 'react-dom/client';
import {HostPresentationReader} from './src/client/presentation/host-entry.tsx';
createRoot(document.getElementById('app')).render(<HostPresentationReader document={${JSON.stringify(document)}}/>);`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('content-type', 'text/javascript')
    response.end(hostBundle.outputFiles[0]!.text)
  } else {
    response.setHeader('content-type', 'text/html')
    response.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Host 布局验收</title><style>body{margin:0}#app{width:100%;margin:0 auto;min-width:0}</style><div id="app"></div><script src="/app.js"></script></html>',
    )
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const browser = await chromium.launch({ headless: true })
const errors: string[] = []
const network: string[] = []
const checks: unknown[] = []

async function pageFits(page: Page) {
  const bounds = await page.evaluate(() => ({
    viewport: window.document.documentElement.clientWidth,
    scroll: window.document.documentElement.scrollWidth,
  }))
  assert.ok(bounds.scroll <= bounds.viewport + 1, `Page overflows: ${JSON.stringify(bounds)}`)
  return bounds
}

async function rectangle(locator: Locator) {
  const bounds = await locator.boundingBox()
  assert(bounds)
  return bounds
}

async function contentBounds(reader: Locator) {
  return reader.evaluate((node) => {
    const bounds = node.getBoundingClientRect()
    const css = getComputedStyle(node)
    const left = Number.parseFloat(css.paddingLeft)
    const right = Number.parseFloat(css.paddingRight)
    return { x: bounds.x + left, width: bounds.width - left - right }
  })
}

async function chartRows(reader: Locator, prefix: string, count: number) {
  const blocks = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      rectangle(reader.locator(`[data-block-id="${prefix}-${index + 1}"]`)),
    ),
  )
  const rows: (typeof blocks)[] = []
  for (const block of blocks) {
    const previous = rows.at(-1)
    if (previous && Math.abs(previous[0]!.y - block.y) < 1) previous.push(block)
    else rows.push([block])
  }
  return { blocks, rows }
}

async function verifyGeometry(page: Page, reader: Locator, label: string) {
  await waitForResponsiveLayout(page)
  const content = await contentBounds(reader)
  const pageWidth = await pageFits(page)
  const order = await reader
    .locator('[data-block-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-block-id')))
  assert.deepEqual(
    order,
    document.blocks.map((block) => block.id),
    `${label}: authored order changed`,
  )
  for (const markdown of await reader.locator('.pr-block-markdown').all()) {
    const bounds = await rectangle(markdown)
    assert.ok(
      Math.abs(bounds.width - content.width) < 1,
      `${label}: Markdown does not fill content`,
    )
    assert.ok(Math.abs(bounds.x - content.x) < 1, `${label}: Markdown is misaligned`)
  }
  const metricWidths = []
  for (const metric of await reader.locator('[data-block-kind="metric"]').all()) {
    const bounds = await rectangle(metric)
    assert.ok(bounds.width <= 480.01, `${label}: KPI exceeds 480px (${bounds.width})`)
    assert.ok(bounds.width >= Math.min(240, content.width) - 1, `${label}: KPI became too narrow`)
    metricWidths.push(bounds.width)
  }
  const single = await rectangle(reader.locator('[data-block-id="single-1"]'))
  assert.ok(Math.abs(single.x - content.x) < 1, `${label}: single KPI must start at left edge`)
  const results = []
  for (const [prefix, count, minimum] of [
    ['pair', 2, 560],
    ['triple', 3, 560],
    ['quad', 4, 560],
    ['pie', 2, 720],
  ] as const) {
    const { blocks, rows } = await chartRows(reader, prefix, count)
    const canPair = content.width >= minimum * 2 + 32 - 0.5
    assert.deepEqual(
      rows.map((row) => row.length),
      canPair
        ? Array.from({ length: Math.ceil(count / 2) }, (_, i) => Math.min(2, count - i * 2))
        : Array(count).fill(1),
      `${label}: ${prefix} rows at ${content.width}px`,
    )
    for (const row of rows) {
      assert.ok(Math.abs(row[0]!.x - content.x) < 1, `${label}: chart row starts incorrectly`)
      if (row.length === 1) {
        assert.ok(
          Math.abs(row[0]!.width - content.width) < 1,
          `${label}: trailing chart must fill its row`,
        )
      } else {
        assert.ok(
          row[1]!.x >= row[0]!.x + row[0]!.width + 31,
          `${label}: charts overlap or lose their gap`,
        )
        assert.ok(
          row.every((block) => block.width >= minimum - 1),
          `${label}: paired chart is too narrow`,
        )
      }
    }
    results.push({ prefix, blocks, rowCounts: rows.map((row) => row.length) })
  }
  for (const [before, after] of [
    ['fixed-before-1', 'dynamic-1'],
    ['dynamic-end-1', 'fixed-after-1'],
  ]) {
    const first = await rectangle(reader.locator(`[data-block-id="${before}"]`))
    const next = await rectangle(reader.locator(`[data-block-id="${after}"]`))
    assert.ok(
      next.y >= first.y + first.height,
      `${label}: chart row crossed an interaction boundary`,
    )
  }
  return { label, content, pageWidth, metricWidths, charts: results }
}

async function choose(reader: Locator, field: string, value: string) {
  await reader.getByRole('button', { name: new RegExp(`^${field}`) }).click()
  await reader.getByRole('menuitemradio', { name: value, exact: true }).click()
}

async function verifyState(page: Page, reader: Locator, resize: (width: number) => Promise<void>) {
  await choose(reader, '日期', '周一')
  await choose(reader, '集群', '甲集群')
  const chart = reader.locator('[data-block-id="dynamic-1"]')
  const legend = chart.getByRole('button', { name: '显示系列 参考查询数', exact: true })
  await legend.click()
  const original = await chart.elementHandle()
  assert(original)
  for (const width of [1920, 768, 390, 1440, 2560]) {
    await resize(width)
    await waitForResponsiveLayout(page)
    assert.equal(
      await chart.evaluate((node, prior) => node === prior, original),
      true,
      'Resize remounted chart',
    )
    assert.equal(await legend.getAttribute('aria-pressed'), 'false', 'Resize lost hidden series')
    assert.equal(
      await reader.locator('[data-block-id="count"] [data-metric-value]').innerText(),
      '150',
    )
    assert.equal(await reader.locator('.pr-filter-status').innerText(), '日期：周一 · 集群：甲集群')
    await pageFits(page)
  }
  await original.dispose()
  return { statePreserved: true, selectedCount: '150', hiddenSeries: '参考查询数' }
}

async function verifyStatic(page: Page, reader: Locator, label: string) {
  await reader.waitFor({ state: 'visible' })
  for (const [prefix, count] of [
    ['pair', 2],
    ['triple', 3],
    ['quad', 4],
    ['pie', 2],
  ] as const) {
    const { blocks, rows } = await chartRows(reader, prefix, count)
    assert.ok(
      rows.every((row) => row.length === 1),
      `${label}: exact chart tables must stack`,
    )
    for (let index = 1; index < blocks.length; index++)
      assert.ok(blocks[index]!.y >= blocks[index - 1]!.y + blocks[index - 1]!.height)
    assert.equal(await reader.locator(`[data-block-id^="${prefix}-"] table`).count(), count)
  }
  assert.equal(
    await reader.locator('[data-block-id="count"] [data-metric-value]').innerText(),
    '550',
  )
  assert.equal(await reader.locator('.pr-filter-status').innerText(), '日期：全部 · 集群：全部')
  return { label, defaultCount: '550', exactChartTablesStacked: true, page: await pageFits(page) }
}

try {
  const portable = await browser.newContext({
    offline: true,
    viewport: { width: 1920, height: 1100 },
  })
  const page = await portable.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url())
  })
  await page.goto(pathToFileURL(portablePath).href)
  const reader = page.locator('[data-mode="interactive"]')
  await reader.waitFor()
  for (const width of [390, 768, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1100 })
    checks.push(await verifyGeometry(page, reader, `portable-${width}`))
    await reader.locator('[data-block-id="pair-1"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, `portable-charts-${width}.png`) })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(output, `portable-kpis-${width}.png`) })
  }
  checks.push(
    await verifyState(page, reader, (width) => page.setViewportSize({ width, height: 1100 })),
  )
  await page.emulateMedia({ media: 'print' })
  checks.push(
    await verifyStatic(
      page,
      page.locator('#presentation-fallback [data-mode="static"]'),
      'portable-print',
    ),
  )
  await page.pdf({
    path: path.join(output, 'layout-print.pdf'),
    format: 'A4',
    printBackground: true,
  })
  await page.emulateMedia({ media: 'screen' })

  const noScript = await browser.newPage({
    javaScriptEnabled: false,
    offline: true,
    viewport: { width: 1920, height: 1100 },
  })
  await noScript.goto(pathToFileURL(portablePath).href)
  checks.push(await verifyStatic(noScript, noScript.locator('[data-mode="static"]'), 'no-script'))

  const host = await browser.newPage({ viewport: { width: 2560, height: 1100 } })
  host.on('pageerror', (error) => errors.push(error.message))
  await host.goto(`http://127.0.0.1:${address.port}`)
  const hostReader = host.locator('.pr-host-live [data-mode="interactive"]')
  const resizeHost = async (width: number) => {
    await host.locator('#app').evaluate((node: HTMLElement, next) => {
      node.style.width = `${next}px`
    }, width)
  }
  for (const width of [390, 768, 1440, 1920, 2560]) {
    await resizeHost(width)
    checks.push(await verifyGeometry(host, hostReader, `host-container-${width}-viewport-2560`))
  }
  // Sweep the real content width immediately around both two-column thresholds.
  for (const width of [1148, 1156, 1468, 1476]) {
    await resizeHost(width)
    await hostReader.evaluate((node: HTMLElement) => {
      node.style.paddingInline = '0'
    })
    checks.push(await verifyGeometry(host, hostReader, `host-content-${width}`))
  }
  await hostReader.evaluate((node: HTMLElement) => {
    node.style.removeProperty('padding-inline')
  })
  checks.push(await verifyState(host, hostReader, resizeHost))
  await resizeHost(1920)
  await host.emulateMedia({ media: 'print' })
  checks.push(
    await verifyStatic(host, host.locator('.pr-host-print [data-mode="static"]'), 'host-print'),
  )
  assert.deepEqual(errors, [], 'Browser page errors')
  assert.deepEqual(network, [], 'Portable layout interactions requested network data')
  const evidence = { browser: browser.version(), portablePath, errors, network, checks }
  await writeFile(path.join(output, 'layout-evidence.json'), JSON.stringify(evidence, null, 2))
  process.stdout.write(`Layout acceptance passed: ${output}\n`)
} catch (error) {
  await writeFile(
    path.join(output, 'layout-failure.json'),
    JSON.stringify(
      {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errors,
        network,
        checks,
      },
      null,
      2,
    ),
  )
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {})
  }
  throw error
} finally {
  await browser.close()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
