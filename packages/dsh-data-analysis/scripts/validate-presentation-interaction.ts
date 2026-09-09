/** Isolated production reader / editor / file-service acceptance. No Harness or model claims. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Locator, type Page } from 'playwright'
import { buildPresentation } from '../src/presentation/build/index.ts'
import { publishPresentation } from '../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../src/presentation/rpc.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { verifyBrowserZoom } from './presentation-browser-zoom.ts'
import { chartGallery } from './presentation-chart-gallery.ts'
import {
  verifyGalleryResizeState,
  verifyResizeState,
  verifyResponsiveGallery,
} from './presentation-responsive-browser.ts'
import { verifyAllChartFilters } from './presentation-s4/editing.ts'

async function verifyFlatFilterLayout(reader: Locator) {
  const region = reader.locator('.pr-interaction-region')
  const style = await region.evaluate((element) => {
    const css = getComputedStyle(element)
    return [
      css.borderTopWidth,
      css.borderRightWidth,
      css.borderBottomWidth,
      css.borderLeftWidth,
      css.paddingTop,
      css.paddingRight,
      css.paddingBottom,
      css.paddingLeft,
      css.borderRadius,
      css.backgroundColor,
    ]
  })
  assert.deepEqual(style, [...Array(9).fill('0px'), 'rgba(0, 0, 0, 0)'])
  assert.equal(await reader.locator('.pr-region-divider').count(), 2)
  const bounds = await reader.locator('[data-block-id="chart"]').boundingBox()
  const fixed = await reader.locator('.pr-fixed-region').first().boundingBox()
  assert(bounds && fixed)
  assert.ok(Math.abs(bounds.x - fixed.x) < 1)
  assert.ok(Math.abs(bounds.width - fixed.width) < 1)
}

const output = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-global-filters-')))
process.stdout.write(`Interaction acceptance: ${output}\n`)
const { document } = await interactionFixture()
const workspace = path.join(output, 'workspace')
await mkdir(workspace)
const receipt = await publishPresentation(workspace, document, null, async () => {})
const gallery = await chartGallery()
gallery.workspaceId = document.workspaceId
gallery.reportId = 'chart-gallery'
const galleryReceipt = await publishPresentation(workspace, gallery, null, async () => {})
const originalHtml = await readFile(receipt.files.html.path)
const portablePath = path.join(output, 'interaction.html')
await writeFile(portablePath, originalHtml)
const delivery = {
  kind: 'marivo.presentation.delivery',
  schemaVersion: 2,
  dshSessionId: 'test',
  turn: 0,
  receipt,
}
const galleryDelivery = { ...delivery, receipt: galleryReceipt }
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const hostBundle = await build({
  loader: { '.wasm': 'binary' },
  stdin: {
    resolveDir: packageRoot,
    loader: 'tsx',
    contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PresentationCards, PresentationOverlay } from './src/client/presentation/install.tsx';
import { PresentationDeliveryModel } from './src/client/presentation/delivery-model.ts';
const delivery = ${JSON.stringify(delivery)};
const galleryDelivery = ${JSON.stringify(galleryDelivery)};
const model = new PresentationDeliveryModel({call: async (_channel, endpoint, payload, signal) =>
  (await fetch('/rpc', {method:'POST', body:JSON.stringify({endpoint,payload}), signal})).json()});
const workspaces = [{workspaceId: delivery.receipt.workspaceId, sessionIds: ['test']}];
createRoot(document.getElementById('app')).render(<>
<PresentationCards matched={[delivery,galleryDelivery]} sessionId="test" workspaces={workspaces} model={model}/>
<PresentationOverlay sessionId="test" workspaceId={delivery.receipt.workspaceId} model={model}/>
</>);`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const service = new MarivoPresentationFileService(async (session) =>
  session === 'test' ? { id: document.workspaceId, path: workspace } : undefined,
)
const requests: string[] = []
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/rpc' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const { endpoint, payload } = JSON.parse(Buffer.concat(chunks).toString())
      requests.push(endpoint)
      const value =
        endpoint === 'files/read'
          ? await service.read(payload)
          : await service.report(endpoint, payload)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, value }))
      return
    }
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript')
      res.end(hostBundle.outputFiles[0]!.text)
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>全局筛选 Host 验收</title><div id="app"></div><script src="/app.js"></script></html>',
    )
  } catch (error) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: { message: String(error) } }))
  }
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
const browser = await chromium.launch({ headless: true })
const errors: string[] = []
const checks: unknown[] = []
const choose = async (reader: Locator, field: string, option: string) => {
  await reader.getByRole('button', { name: new RegExp(`^${field}`) }).click()
  await reader.getByRole('menuitemradio', { name: option, exact: true }).click()
}
const expectData = async (
  reader: Locator,
  count: string,
  failed: string,
  rate: string,
  rows: number[],
) => {
  for (const [id, value] of [
    ['fixed', '550'],
    ['count', count],
    ['failed', failed],
    ['rate', rate],
  ])
    assert.equal(
      await reader.locator(`[data-block-id="${id}"] [data-metric-value]`).innerText(),
      value,
    )
  assert.deepEqual(
    await reader
      .locator('[data-block-id="table"] tbody tr[data-row-index]')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-row-index')))),
    rows,
  )
  const indices = await reader
    .locator('[data-block-id="chart"] [data-source-row-index]')
    .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-source-row-index'))))
  assert(indices.length > 0 && indices.every((index) => rows.includes(index)))
}
async function exercise(page: Page, reader: Locator) {
  await reader.locator('[data-block-id="chart"] svg').first().waitFor()
  await expectData(reader, '550', '15', '2.73', [0, 1])
  await choose(reader, '日期', '周一')
  await expectData(reader, '250', '8', '3.20', [6, 7])
  await choose(reader, '集群', '甲集群')
  await expectData(reader, '150', '3', '2.00', [8, 9])
  const chart = reader.locator('[data-block-id="chart"]')
  await chart.getByRole('button', { name: 'cell 更多操作' }).click()
  await chart.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  await chart.getByRole('combobox', { name: '已准备视图', exact: true }).selectOption('horizontal')
  await expectData(reader, '150', '3', '2.00', [8, 9])
  assert.equal(await chart.getByText('分类过滤', { exact: true }).count(), 0)
  await chart.getByRole('button', { name: '关闭探索图表' }).click()
  for (const id of ['chart', 'table', 'count']) {
    const cell = reader.locator(`[data-block-id="${id}"]`)
    await cell.getByRole('button', { name: 'cell 更多操作' }).click()
    await cell.getByRole('menuitem', { name: '数据源', exact: true }).click()
    const dialog = reader.getByRole('dialog', { name: '数据源', exact: true })
    await dialog.getByText('当前筛选：日期：周一 · 集群：甲集群', { exact: true }).waitFor()
    await dialog.getByRole('tab', { name: '数据预览', exact: true }).click()
    assert.deepEqual(
      await dialog
        .locator('tbody tr[data-row-index]')
        .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-row-index')))),
      id === 'count' ? [4] : [8, 9],
    )
    await dialog.press('Escape')
  }
  // Search, keyboard selection, focus return and outside dismissal.
  const day = reader.getByRole('button', { name: /^日期/ })
  await day.click()
  await reader.getByRole('searchbox').fill('周二')
  await reader.getByRole('searchbox').press('ArrowDown')
  await page.keyboard.press('Enter')
  assert.equal(await day.evaluate((node) => node === window.document.activeElement), true)
  await expectData(reader, '180', '3', '1.67', [14, 15])
  await day.click()
  await reader.getByRole('searchbox').press('Escape')
  assert.equal(await day.getAttribute('aria-expanded'), 'false')
  await day.click()
  await reader.locator('.pr-interaction-header h2').click()
  assert.equal(await day.getAttribute('aria-expanded'), 'false')
  await reader.getByRole('button', { name: '重置筛选' }).click()
  await expectData(reader, '550', '15', '2.73', [0, 1])
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.getByRole('button', { name: '打开分析', exact: true }).first().click()
  const overlay = page.getByRole('dialog', { name: '分析快照', exact: true })
  const reader = overlay.locator('[data-mode="interactive"]')
  await exercise(page, reader)
  await choose(reader, '日期', '周一')
  await choose(reader, '集群', '甲集群')
  const countCell = reader.locator('[data-block-id="count"]')
  await countCell.getByRole('button', { name: 'cell 更多操作' }).click()
  await countCell.getByRole('menuitem', { name: '复制上下文', exact: true }).click()
  await countCell.getByText('已复制', { exact: true }).waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.match(copied, /"filterId":"day","optionId":"mon","label":"日期：周一"/)
  assert.match(copied, /"filterId":"cluster","optionId":"a"/)
  assert.equal(requests.filter((endpoint) => endpoint === 'reports/save').length, 0)
  await overlay.screenshot({ path: path.join(output, 'host-desktop.png') })
  const requestsBeforeExport = requests.length
  await reader.getByRole('button', { name: '导出报告', exact: true }).click()
  const currentDownload = page.waitForEvent('download')
  await reader.getByRole('menuitem', { name: '导出当前视图', exact: true }).click()
  await (await currentDownload).saveAs(path.join(output, 'host-current-view.html'))
  const currentHtml = await readFile(path.join(output, 'host-current-view.html'), 'utf8')
  assert.match(currentHtml, /日期：周一 · 集群：甲集群/)
  assert.match(currentHtml, /来源 Build：interaction-test/)
  assert.doesNotMatch(currentHtml, /<script\b|presentation-data/)
  assert.equal(requests.length, requestsBeforeExport)
  const downloadEvent = page.waitForEvent('download')
  await overlay.getByRole('button', { name: '导出报告', exact: true }).click()
  await overlay.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const download = await downloadEvent
  await download.saveAs(path.join(output, 'download.html'))
  assert.deepEqual(await readFile(path.join(output, 'download.html')), originalHtml)
  await page.emulateMedia({ media: 'print' })
  assert.equal(
    await overlay
      .locator('[data-mode="static"] [data-block-id="count"] [data-metric-value]')
      .innerText(),
    '550',
  )
  assert.equal(
    await overlay.locator('[data-mode="static"] [data-block-id="table"] tbody tr').count(),
    2,
  )
  await page.emulateMedia({ media: 'screen' })
  await overlay.getByRole('button', { name: '编辑报告', exact: true }).click()
  await reader.getByRole('button', { name: '导出报告', exact: true }).click()
  const disabledExport = reader.getByRole('menuitem', { name: '导出当前视图', exact: true })
  assert.equal(await disabledExport.getAttribute('aria-disabled'), 'true')
  assert.match(await disabledExport.innerText(), /请先保存或取消编辑/)
  await disabledExport.press('Escape')
  await choose(reader, '日期', '周一')
  assert.equal(await overlay.getByText('有未保存的编辑', { exact: true }).count(), 0)
  assert.equal(
    await countCell.getByRole('button', { name: '上移', exact: true }).isDisabled(),
    true,
  )
  await countCell.getByRole('button', { name: '删除 cell' }).click()
  await overlay.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await countCell.count(), 1)
  await overlay.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await countCell.count(), 0)
  await overlay.getByRole('button', { name: '撤销', exact: true }).click()
  await reader.getByRole('textbox', { name: '报告标题', exact: true }).fill('全局筛选 · 保存验收')
  checks.push(
    await verifyResizeState(page, async () => {
      assert.equal(
        await reader.getByRole('textbox', { name: '报告标题', exact: true }).inputValue(),
        '全局筛选 · 保存验收',
      )
      await overlay.getByText('有未保存的编辑', { exact: true }).waitFor()
      assert.match(await reader.getByRole('button', { name: /^日期/ }).innerText(), /周一/)
    }),
  )
  await overlay.getByRole('button', { name: '保存编辑', exact: true }).click()
  await reader.getByRole('heading', { name: '全局筛选 · 保存验收', exact: true }).waitFor()
  await expectData(reader, '550', '15', '2.73', [0, 1])
  const savedReceipt = await service.report('reports/resolve', {
    sessionId: 'test',
    reportId: receipt.reportId,
  })
  const saved = JSON.parse(await readFile(savedReceipt.files.document.path, 'utf8'))
  assert.deepEqual(saved.interaction, document.interaction)
  await choose(reader, '日期', '周一')
  await overlay.getByRole('button', { name: '关闭分析快照' }).click()
  await page.getByRole('button', { name: '打开分析', exact: true }).first().click()
  await reader.getByRole('heading', { name: '全局筛选 · 保存验收', exact: true }).waitFor()
  await expectData(reader, '550', '15', '2.73', [0, 1])
  checks.push({
    host: true,
    rpcSave: true,
    undoRedo: true,
    defaultPrintAndDownload: true,
    copy: true,
  })
  const offline = await context.newPage()
  offline.on('pageerror', (error) => errors.push(error.message))
  const external: string[] = []
  offline.on('request', (request) => {
    if (!request.url().startsWith('file:')) external.push(request.url())
  })
  await offline.goto(pathToFileURL(portablePath).href)
  const portableReader = offline.locator('[data-mode="interactive"]')
  await exercise(offline, portableReader)
  await verifyFlatFilterLayout(portableReader)
  await portableReader.screenshot({ path: path.join(output, 'portable-desktop.png') })
  await offline.setViewportSize({ width: 390, height: 844 })
  await verifyFlatFilterLayout(portableReader)
  await portableReader.getByRole('button', { name: /^集群/ }).click()
  await portableReader
    .locator('.pr-filter-popup')
    .screenshot({ path: path.join(output, 'filter-menu.png') })
  assert(await offline.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth))
  await offline.screenshot({ path: path.join(output, 'portable-narrow.png'), fullPage: true })
  await offline.reload()
  await expectData(portableReader, '550', '15', '2.73', [0, 1])
  assert.deepEqual(external, [])
  const noScript = await browser.newContext({ javaScriptEnabled: false })
  const staticPage = await noScript.newPage()
  await staticPage.goto(pathToFileURL(portablePath).href)
  assert.equal(
    await staticPage.locator('[data-block-id="count"] [data-metric-value]').innerText(),
    '550',
  )
  assert.equal(await staticPage.locator('[data-block-id="chart"] tbody tr').count(), 2)
  assert.equal(await staticPage.locator('[data-block-id="table"] tbody tr').count(), 2)
  await verifyFlatFilterLayout(staticPage.locator('.pr-reader'))
  await staticPage.emulateMedia({ media: 'print' })
  await verifyFlatFilterLayout(staticPage.locator('.pr-reader'))
  await noScript.close()
  checks.push({
    offline: true,
    noScript: true,
    narrow: true,
    keyboard: true,
    noExternalRequests: true,
  })
  await overlay.getByRole('button', { name: '关闭分析快照' }).click()
  await page.getByRole('button', { name: '打开分析', exact: true }).last().click()
  await reader.locator('[data-block-id="gallery-line"] svg').first().waitFor()
  const galleryRequestsBefore = requests.length
  checks.push(await verifyResponsiveGallery(page, output, 'gallery-overlay', 'overlay'))
  checks.push({ hostGallery: await verifyGalleryResizeState(page) })
  assert.deepEqual(
    requests.slice(galleryRequestsBefore),
    [],
    'Resizing and filtering must stay reader-local',
  )
  const galleryHtml = await buildPresentation(gallery)
  const galleryPath = path.join(output, 'chart-gallery.html')
  await writeFile(galleryPath, galleryHtml.htmlBytes)
  await offline.setViewportSize({ width: 1440, height: 1100 })
  await offline.goto(pathToFileURL(galleryPath).href)
  checks.push(await verifyResponsiveGallery(offline, output, 'gallery-portable', 'portable'))
  checks.push({ portableGallery: await verifyGalleryResizeState(offline) })
  checks.push(await verifyAllChartFilters(offline, gallery))
  const galleryReader = offline.locator('[data-mode="interactive"]')
  await choose(galleryReader, '展示范围', '第二条观测')
  const galleryLine = galleryReader.locator('[data-block-id="gallery-line"]')
  await galleryLine.getByRole('button', { name: 'cell 更多操作' }).click()
  await galleryLine.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  await galleryLine
    .getByRole('combobox', { name: '已准备视图', exact: true })
    .selectOption('prepared-histogram')
  await galleryLine.locator('[data-chart-mark="histogram"][data-source-row-index="1"]').waitFor()
  await galleryLine.getByRole('button', { name: 'cell 更多操作' }).click()
  await galleryLine.getByRole('menuitem', { name: '数据源', exact: true }).click()
  const preparedDialog = galleryReader.getByRole('dialog', { name: '数据源', exact: true })
  await preparedDialog.getByRole('tab', { name: '数据预览', exact: true }).click()
  assert.deepEqual(
    await preparedDialog
      .locator('tbody tr')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-row-index'))),
    ['1'],
  )
  await preparedDialog.getByRole('tab', { name: '概要', exact: true }).click()
  await preparedDialog.getByText('charts-bins', { exact: true }).waitFor()
  await preparedDialog.press('Escape')
  checks.push({ crossDatasetPreparedView: true })
  assert.deepEqual(external, [], 'Portable responsive interactions must not request network data')
  checks.push(await verifyBrowserZoom(galleryPath, output))
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(output, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        scope:
          'Synthetic production UI and file-service validation; no real Agent or Harness runtime',
        output,
        checks,
        errors,
      },
      null,
      2,
    ),
  )
  process.stdout.write(`PASS ${path.join(output, 'evidence.json')}\n`)
} catch (error) {
  const pages = browser.contexts().flatMap((context) => context.pages())
  for (const [index, page] of pages.entries())
    await page
      .screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true })
      .catch(() => {})
  process.stderr.write(JSON.stringify({ errors }) + '\n')
  throw error
} finally {
  await browser.close()
  await service.close()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
