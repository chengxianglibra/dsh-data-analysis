/** Isolated real Harness native report Tab with synthetic interaction fixtures. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { chromium, type Locator, type Page } from 'playwright'
import { buildPresentation } from '../src/presentation/build/index.ts'
import { publishPresentation } from '../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../src/presentation/rpc.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { verifyBrowserZoom } from './presentation-browser-zoom.ts'
import { chartGallery } from './presentation-chart-gallery.ts'
import { presentationHtml } from './presentation-html.ts'
import {
  verifyGalleryResizeState,
  verifyResizeState,
  verifyResponsiveGallery,
} from './presentation-responsive-browser.ts'
import { verifyAllChartFilters } from './presentation-s4/editing.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'
import { closeReport, openReport, reportAction } from './right-tabs/browser.ts'

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
const python =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
const inputs = await preparePresentationInputs(workspace, python)
const server = await startPresentationWebHost(
  workspace,
  path.join(output, 'web'),
  python,
  inputs.draftPaths,
  'native-first',
  { rightTabsAcceptance: true, askDshProbe: true },
)
document.workspaceId = server.workspaceId
const receipt = await publishPresentation(workspace, document, null, async () => {})
const gallery = await chartGallery()
gallery.workspaceId = document.workspaceId
gallery.reportId = 'chart-gallery'
const galleryReceipt = await publishPresentation(workspace, gallery, null, async () => {})
const originalHtml = await presentationHtml(receipt)
const portablePath = path.join(output, 'interaction.html')
await writeFile(portablePath, originalHtml)
const service = new MarivoPresentationFileService(
  async (session) =>
    session === server.sessionId ? { id: document.workspaceId, path: workspace } : undefined,
  async (id) => (id === document.workspaceId ? { id, path: workspace } : undefined),
)
let page: Page
const requests = async (): Promise<string[]> =>
  page.evaluate(() =>
    (window as any).__askDshProbe
      .audit()
      .calls.map((call: { endpoint: string }) => call.endpoint)
      .filter((endpoint: string) => endpoint.startsWith('marivo-presentation/')),
  )
const browser = await chromium.launch({ channel: 'chrome', headless: true })
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
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  })
  page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  await page.evaluate((id) => (window as any).__rtHost.select(id), server.sessionId)
  await page.getByRole('button', { name: '打开报告', exact: true }).waitFor()
  await openReport(page, server.sessionId, {
    workspaceId: receipt.workspaceId,
    reportId: receipt.reportId,
  })
  const report = page.locator('[data-rt-kind=report]:visible')
  const reader = report.locator('[data-mode="interactive"]')
  await exercise(page, reader)
  await choose(reader, '日期', '周一')
  await choose(reader, '集群', '甲集群')
  const countCell = reader.locator('[data-block-id="count"]')
  await countCell.getByRole('button', { name: 'cell 更多操作' }).click()
  await countCell.getByRole('menuitem', { name: '加入提问', exact: true }).click()
  await page.waitForFunction(
    (id) => (window as any).__askDshProbe.read(id).draft.includes('Cell: "count"'),
    server.sessionId,
  )
  const copied = await page.evaluate(
    (id) => (window as any).__askDshProbe.read(id).draft,
    server.sessionId,
  )
  assert.match(copied, /"filterId":"day","optionId":"mon","label":"日期：周一"/)
  assert.match(copied, /"filterId":"cluster","optionId":"a"/)
  assert.equal((await requests()).filter((endpoint) => endpoint.endsWith('reports/save')).length, 0)
  await report.screenshot({ path: path.join(output, 'host-desktop.png') })
  const requestsBeforeExport = (await requests()).length
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  const currentDownload = page.waitForEvent('download')
  await reader.getByRole('menuitem', { name: '导出当前视图', exact: true }).click()
  await (await currentDownload).saveAs(path.join(output, 'host-current-view.html'))
  const currentHtml = await readFile(path.join(output, 'host-current-view.html'), 'utf8')
  assert.match(currentHtml, /日期：周一 · 集群：甲集群/)
  assert.match(currentHtml, /来源 Build：interaction-test/)
  assert.doesNotMatch(currentHtml, /<script\b|presentation-data/)
  assert.equal((await requests()).length, requestsBeforeExport)
  const downloadEvent = page.waitForEvent('download')
  await report.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await report.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const download = await downloadEvent
  await download.saveAs(path.join(output, 'download.html'))
  assert.deepEqual(await readFile(path.join(output, 'download.html')), originalHtml)
  await page.emulateMedia({ media: 'print' })
  assert.equal(
    await report
      .locator('[data-mode="static"] [data-block-id="count"] [data-metric-value]')
      .innerText(),
    '550',
  )
  assert.equal(
    await report.locator('[data-mode="static"] [data-block-id="table"] tbody tr').count(),
    2,
  )
  await page.emulateMedia({ media: 'screen' })
  await reportAction(report, '编辑报告')
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  const disabledExport = reader.getByRole('menuitem', { name: '导出当前视图', exact: true })
  assert.equal(await disabledExport.getAttribute('aria-disabled'), 'true')
  assert.match(await disabledExport.innerText(), /请先保存或取消编辑/)
  await disabledExport.press('Escape')
  await choose(reader, '日期', '周一')
  assert.equal(await report.getByText('有未保存的编辑', { exact: true }).count(), 0)
  assert.equal(
    await countCell.getByRole('button', { name: '上移', exact: true }).isDisabled(),
    true,
  )
  await countCell.getByRole('button', { name: '删除 cell' }).click()
  await report.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await countCell.count(), 1)
  await report.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await countCell.count(), 0)
  await report.getByRole('button', { name: '撤销', exact: true }).click()
  await reader.getByRole('textbox', { name: '报告标题', exact: true }).fill('全局筛选 · 保存验收')
  checks.push(
    await verifyResizeState(page, async () => {
      assert.equal(
        await reader.getByRole('textbox', { name: '报告标题', exact: true }).inputValue(),
        '全局筛选 · 保存验收',
      )
      await report.getByText('有未保存的编辑', { exact: true }).waitFor()
      assert.match(await reader.getByRole('button', { name: /^日期/ }).innerText(), /周一/)
    }),
  )
  await report.getByRole('button', { name: '保存编辑', exact: true }).click()
  await reader.getByRole('heading', { name: '全局筛选 · 保存验收', exact: true }).waitFor()
  await expectData(reader, '550', '15', '2.73', [0, 1])
  const savedReceipt = await service.report('reports/resolve', {
    workspaceId: document.workspaceId,
    reportId: receipt.reportId,
  })
  const saved = JSON.parse(await readFile(savedReceipt.files.document.path, 'utf8'))
  assert.deepEqual(saved.interaction, document.interaction)
  await choose(reader, '日期', '周一')
  await closeReport(page, report)
  await openReport(page, server.sessionId, {
    workspaceId: receipt.workspaceId,
    reportId: receipt.reportId,
  })
  await reader.getByRole('heading', { name: '全局筛选 · 保存验收', exact: true }).waitFor()
  await expectData(reader, '550', '15', '2.73', [0, 1])
  checks.push({
    host: true,
    rpcSave: true,
    undoRedo: true,
    defaultPrintAndDownload: true,
    askDshFilterReference: true,
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
  await closeReport(page, report)
  await openReport(page, server.sessionId, {
    workspaceId: galleryReceipt.workspaceId,
    reportId: galleryReceipt.reportId,
  })
  await reader.locator('[data-block-id="gallery-line"] svg').first().waitFor()
  const galleryRequestsBefore = (await requests()).length
  checks.push(await verifyResponsiveGallery(page, output, 'gallery-native-tab', 'native-tab'))
  checks.push({ hostGallery: await verifyGalleryResizeState(page) })
  assert.deepEqual(
    (await requests()).slice(galleryRequestsBefore),
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
      .getByRole('tabpanel', { name: '数据预览', exact: true })
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
          'Real isolated Harness and packed production native report Tab; synthetic interaction data and scripted initial model, not fresh model analysis',
        output,
        productionModuleDigests: server.moduleDigests,
        packageIntegrity: server.packageIntegrity,
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
  await server.stop()
}
