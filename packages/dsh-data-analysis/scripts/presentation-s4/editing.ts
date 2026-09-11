/** Actual browser editing against the packed production plugin and isolated Workspace. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import { presentationEdits } from '../../src/presentation/contracts/editing.ts'
import {
  parsePresentationDocument,
  parsePresentationReceipt,
} from '../../src/presentation/contracts/index.ts'
import type { PresentationDelivery } from '../../src/presentation/receipt.ts'
import { presentationHtml } from '../presentation-html.ts'
import { closeReport, openReport, reportAction } from '../right-tabs/browser.ts'

export async function verifyEditing(
  page: Page,
  browser: Browser,
  delivery: PresentationDelivery,
  durableSessionId: string,
  outputRoot: string,
  processAuditPath: string,
) {
  const rpc = (endpoint: string, payload: unknown) =>
    page.evaluate(
      ({ endpoint, payload }) => (window as any).__s4Rpc('/marivo-presentation', endpoint, payload),
      { endpoint, payload },
    )
  const request = { sessionId: delivery.dshSessionId, reportId: delivery.receipt.reportId }
  const original = parsePresentationDocument(
    JSON.parse(await readFile(delivery.receipt.files.document.path, 'utf8')),
  )
  const events = await page.evaluate(
    (id) => (window as any).__s4Rpc('/presentation-s4-validation', 'events', { sessionId: id }),
    durableSessionId,
  )
  const processEvents = await readFile(processAuditPath)
  assert.match(processEvents.toString(), /spawn|exec/)
  const open = () =>
    openReport(page, delivery.dshSessionId, {
      workspaceId: delivery.receipt.workspaceId,
      reportId: delivery.receipt.reportId,
    })
  const report = page.locator('[data-rt-kind=report]:visible')
  const reader = report.locator('[data-presentation-reader][data-mode="interactive"]')
  const cell = (id: string) => reader.locator(`[data-block-id="${id}"]`)
  await open()
  await reader.getByRole('heading', { name: original.title, exact: true }).waitFor()
  assert.equal(await reader.getByRole('group', { name: '全局筛选' }).count(), 0)
  await page.emulateMedia({ media: 'print' })
  assert.equal(
    await report.locator('[data-mode="static"] [data-block-id="table"] tbody tr').count(),
    2,
  )
  await page.emulateMedia({ media: 'screen' })
  const downloadPending = page.waitForEvent('download')
  await report.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await report.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const download = await downloadPending
  const originalDownload = path.join(outputRoot, 'editing-download.html')
  await download.saveAs(originalDownload)
  assert.deepEqual(await readFile(originalDownload), await presentationHtml(delivery.receipt))
  await reportAction(report, '编辑报告')
  assert.equal(await cell('table').locator('tbody tr').count(), 2)
  await reader.getByRole('textbox', { name: '报告标题', exact: true }).fill('阅读器保存验收')
  await reader
    .getByRole('textbox', { name: '正文 intro', exact: true })
    .fill('## 已编辑正文\n\n保留所有数据与来源。')
  await cell('metric').getByRole('textbox', { name: '指标标签', exact: true }).fill('固定首行账户')
  await cell('bar').getByRole('button', { name: 'cell 更多操作' }).click()
  await cell('bar').getByRole('menuitem', { name: '探索图表', exact: true }).click()
  const explorer = reader.getByRole('region', { name: '探索图表', exact: true })
  await explorer.getByRole('combobox', { name: '图形类型', exact: true }).selectOption('area')
  await explorer.getByRole('button', { name: '关闭探索图表', exact: true }).click()
  await cell('table').getByRole('checkbox', { name: 'account', exact: true }).uncheck()
  await cell('table').getByRole('button', { name: '左移列 decimal', exact: true }).click()
  await cell('intro').getByRole('button', { name: '下移', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(
    await reader.locator('[data-block-id]').first().getAttribute('data-block-id'),
    'metric',
  )
  await cell('sources').getByRole('button', { name: '删除 cell', exact: true }).click()
  assert.equal(await cell('sources').count(), 0)
  await report.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await cell('sources').count(), 1)
  await report.getByRole('button', { name: '重做', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await report.screenshot({ path: path.join(outputRoot, 'editing-narrow.png') })
  await report.getByRole('button', { name: '保存编辑', exact: true }).click()
  await reader.getByRole('heading', { name: '阅读器保存验收', exact: true }).waitFor()
  const resolved = await rpc('reports/resolve', request)
  assert.equal(resolved.ok, true)
  const receipt = parsePresentationReceipt(resolved.value)
  const saved = parsePresentationDocument(
    JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
  )
  for (const field of ['datasets', 'sources', 'diagnostics'] as const)
    assert.deepEqual(saved[field], original[field])
  assert.equal(saved.blocks.find((block) => block.id === 'bar')!.kind, 'chart')
  assert.equal((saved.blocks.find((block) => block.id === 'bar') as any).chart, 'area')
  assert.deepEqual((saved.blocks.find((block) => block.id === 'table') as any).columns, [
    'decimal',
    'region',
  ])
  assert.equal(
    saved.blocks.some((block) => block.id === 'sources'),
    false,
  )
  const savedDownloadPending = page.waitForEvent('download')
  await report.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await report.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const savedDownload = await savedDownloadPending
  const savedPath = path.join(outputRoot, 'editing-saved.html')
  await savedDownload.saveAs(savedPath)
  assert.deepEqual(await readFile(savedPath), await presentationHtml(receipt))
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ offline: true, javaScriptEnabled })
    const portable = await context.newPage()
    await portable.goto(pathToFileURL(savedPath).href)
    await portable.getByRole('heading', { name: saved.title, exact: true }).first().waitFor()
    assert.equal(await portable.getByRole('button', { name: '编辑报告', exact: true }).count(), 0)
    assert.equal(await portable.locator('[data-block-id="sources"]').count(), 0)
    if (javaScriptEnabled)
      assert.deepEqual(
        JSON.parse((await portable.locator('#presentation-data').textContent())!),
        saved,
      )
    await portable.screenshot({
      path: path.join(
        outputRoot,
        `editing-saved-${javaScriptEnabled ? 'offline' : 'no-script'}.png`,
      ),
      fullPage: true,
    })
    await context.close()
  }
  await closeReport(page, report)
  await page.reload()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  await page.waitForFunction(
    (id) => !!(window as any).__rtHost.sessions.getSnapshot().byId[id],
    delivery.dshSessionId,
  )
  await page.evaluate((id) => (window as any).__rtHost.select(id), delivery.dshSessionId)
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  await open()
  await reader.getByRole('heading', { name: saved.title, exact: true }).waitFor()
  await reportAction(report, '编辑报告')
  await reader.getByRole('textbox', { name: '报告标题' }).fill('冲突草稿')
  const external = await rpc('reports/save', {
    ...request,
    expectedBuildId: receipt.buildId,
    edits: { ...presentationEdits(saved), title: '另一个窗口的保存' },
  })
  assert.equal(external.ok, true)
  await report.getByRole('button', { name: '保存编辑', exact: true }).click()
  await report.getByRole('alert').filter({ hasText: '其他窗口' }).waitFor()
  assert.equal(await reader.getByRole('textbox', { name: '报告标题' }).inputValue(), '冲突草稿')
  page.once('dialog', (dialog) => dialog.dismiss())
  await report.getByRole('button', { name: '取消编辑', exact: true }).click()
  assert.equal(await report.isVisible(), true)
  page.once('dialog', (dialog) => dialog.accept())
  await report.getByRole('button', { name: '取消编辑', exact: true }).click()
  await closeReport(page, report)
  await open()
  await reader.getByRole('heading', { name: '另一个窗口的保存', exact: true }).waitFor()
  await reportAction(report, '编辑报告')
  while (await reader.getByRole('button', { name: '删除 cell', exact: true }).count())
    await reader.getByRole('button', { name: '删除 cell', exact: true }).first().click()
  await reader.getByText('这份报告尚无 cell。数据与来源仍保留。', { exact: true }).waitFor()
  await report.getByRole('button', { name: '保存编辑', exact: true }).click()
  await reader
    .getByRole('textbox', { name: '报告标题', exact: true })
    .waitFor({ state: 'detached' })
  const empty = parsePresentationReceipt((await rpc('reports/resolve', request)).value)
  const finalDownloadPending = page.waitForEvent('download')
  await report.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await report.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const finalDownload = await finalDownloadPending
  const finalPath = path.join(outputRoot, 'editing-empty-saved.html')
  await finalDownload.saveAs(finalPath)
  assert.deepEqual(await readFile(finalPath), await presentationHtml(empty))
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ offline: true, javaScriptEnabled })
    const portable = await context.newPage()
    await portable.goto(pathToFileURL(finalPath).href)
    await portable
      .locator(
        `[data-presentation-reader][data-mode="${javaScriptEnabled ? 'interactive' : 'static'}"]`,
      )
      .getByText('这份报告尚无 cell。数据与来源仍保留。', { exact: true })
      .first()
      .waitFor()
    assert.equal(await portable.getByRole('button', { name: '编辑报告', exact: true }).count(), 0)
    await context.close()
  }
  await reportAction(report, '编辑报告')
  await reader.getByRole('textbox', { name: '报告标题', exact: true }).fill('Workspace 失效草稿')
  await page.evaluate(() => (window as any).__s4Rpc('/presentation-s4-validation', 'detach', {}))
  await reader.waitFor({ state: 'detached' })
  assert.equal(await report.getByRole('textbox', { name: '报告标题', exact: true }).count(), 0)
  await page.evaluate(() => (window as any).__s4Rpc('/presentation-s4-validation', 'attach', {}))
  await closeReport(page, report)
  await page.setViewportSize({ width: 1440, height: 1100 })
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  assert.deepEqual(
    await page.evaluate(
      (id) => (window as any).__s4Rpc('/presentation-s4-validation', 'events', { sessionId: id }),
      durableSessionId,
    ),
    events,
    'Reader saves must not add Agent/Tool events',
  )
  assert.deepEqual(
    await readFile(processAuditPath),
    processEvents,
    'Reader editing must not spawn Python or other subprocesses',
  )
  return {
    reportId: receipt.reportId,
    savedBuildId: receipt.buildId,
    emptyBuildId: empty.buildId,
    editor: true,
    keyboard: true,
    narrow: true,
    undeclaredFiltersAbsent: true,
    downloadUnchanged: true,
    printUnfiltered: true,
    nativeCurrentReopen: true,
    conflictRetainsDraft: true,
    cancel: true,
    emptyReport: true,
    offline: true,
    noScript: true,
    durableAgentEventsUnchanged: true,
    subprocessCallsDuringEditing: 0,
    workspaceInvalidationClearsEditor: true,
  }
}

export async function verifyPreparedFilters(page: Page, delivery: PresentationDelivery) {
  const open = () =>
    openReport(page, delivery.dshSessionId, {
      workspaceId: delivery.receipt.workspaceId,
      reportId: delivery.receipt.reportId,
    })
  await open()
  const report = page.locator('[data-rt-kind=report]:visible')
  const reader = report.locator('[data-mode="interactive"]')
  await reader.getByRole('button', { name: /展示范围/ }).click()
  await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  const cell = reader.locator('[data-block-id="gallery-line"]')
  await cell.getByRole('button', { name: 'cell 更多操作' }).click()
  await cell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  const explorer = cell.locator('[data-chart-explorer]')
  const check = async (view: string) => {
    await explorer.getByRole('combobox', { name: '已准备视图', exact: true }).selectOption(view)
    assert.equal(await reader.getByRole('button', { name: /展示范围.*第二条观测/ }).count(), 1)
    await cell.getByRole('button', { name: 'cell 更多操作' }).click()
    await cell.getByRole('menuitem', { name: '数据源', exact: true }).click()
    const dialog = reader.getByRole('dialog', { name: '数据源', exact: true })
    await dialog.getByRole('tab', { name: '数据预览', exact: true }).click()
    assert.deepEqual(
      await dialog
        .getByRole('tabpanel', { name: '数据预览', exact: true })
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['1'],
    )
    await dialog.getByRole('button', { name: '关闭数据源', exact: true }).click()
  }
  await check('prepared-histogram')
  await check('')
  await check('prepared-scatter')
  await reportAction(report, '编辑报告')
  await cell.getByRole('button', { name: 'cell 更多操作' }).click()
  await cell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  const picker = explorer.getByRole('combobox', { name: '已准备视图', exact: true })
  await picker.selectOption('prepared-histogram')
  await report.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await picker.inputValue(), '')
  await report.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await picker.inputValue(), 'prepared-histogram')
  await report.getByRole('button', { name: '保存编辑', exact: true }).click()
  await reader
    .getByRole('textbox', { name: '报告标题', exact: true })
    .waitFor({ state: 'detached' })
  const resolved = await page.evaluate(
    ({ sessionId, reportId }) =>
      (window as any).__s4Rpc('/marivo-presentation', 'reports/resolve', { sessionId, reportId }),
    { sessionId: delivery.dshSessionId, reportId: delivery.receipt.reportId },
  )
  assert.equal(resolved.ok, true)
  const saved = parsePresentationDocument(
    JSON.parse(await readFile(resolved.value.files.document.path, 'utf8')),
  )
  const original = parsePresentationDocument(
    JSON.parse(await readFile(delivery.receipt.files.document.path, 'utf8')),
  )
  const savedBlock = saved.blocks.find((block) => block.id === 'gallery-line')!
  assert.equal(savedBlock.kind, 'chart')
  if (savedBlock.kind === 'chart') {
    assert.equal(savedBlock.datasetId, 'charts-bins')
    assert.equal(savedBlock.chart, 'histogram')
    assert.equal(Object.hasOwn(savedBlock, 'label'), false)
  }
  assert.deepEqual(saved.datasets, original.datasets)
  assert.deepEqual(saved.sources, original.sources)
  await closeReport(page, report)
  return {
    preparedViewUsesActualDataset: true,
    preparedViewSave: true,
    undoRedoPreparedView: true,
    preparedViewRetainsGlobalSelection: true,
  }
}

/** One shared dataset selection reaches every chart family, including prepared statistics. */
export async function verifyAllChartFilters(
  page: Page,
  document: import('../../src/presentation/contracts/types.ts').PresentationDocument,
) {
  const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
  const charts = document.blocks.filter((block) => block.kind === 'chart')
  const { CHART_TYPES } = await import('../../src/presentation/contracts/charts.ts')
  assert.deepEqual([...new Set(charts.map((block) => block.chart))].sort(), [...CHART_TYPES].sort())
  // Close any existing explorer so the visual configuration returns to the saved block.
  const close = reader.getByRole('button', { name: '关闭探索图表', exact: true })
  if (await close.count()) {
    const panel = reader.locator('[data-chart-explorer]')
    await panel.getByRole('button', { name: '恢复原图', exact: true }).click()
    await close.click()
  }
  await reader
    .getByRole('button', { name: '重置筛选', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      if (!button.disabled) button.click()
    })
  const facts = new Map<string, string[]>()
  for (const block of charts) {
    const cell = reader.locator(`[data-block-id="${block.id}"]`)
    await cell.scrollIntoViewIfNeeded()
    facts.set(
      block.id,
      await cell
        .locator('[data-chart-mark][data-source-row-index="1"]')
        .evaluateAll((marks) =>
          marks.map((mark) =>
            JSON.stringify([
              mark.getAttribute('aria-label'),
              mark.getAttribute('data-share-end') === null
                ? null
                : Number(
                    (
                      Number(mark.getAttribute('data-share-end')) -
                      Number(mark.getAttribute('data-share-start'))
                    ).toFixed(12),
                  ),
            ]),
          ),
        ),
    )
  }
  await reader.getByRole('button', { name: /展示范围/ }).click()
  await reader.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  const checked: string[] = []
  for (const block of charts) {
    const cell = reader.locator(`[data-block-id="${block.id}"]`)
    await cell.scrollIntoViewIfNeeded()
    const rows = await cell
      .locator('[data-source-row-index]')
      .evaluateAll((marks) => marks.map((mark) => mark.getAttribute('data-source-row-index')))
    const data = document.datasets.find((dataset) => dataset.id === block.datasetId)!.data
    const hasValue = block.y.some(
      (id) => data.rows[1]![data.columns.findIndex((column) => column.id === id)] !== null,
    )
    if (hasValue && block.options?.showPoints !== 'never')
      assert(rows.length > 0, `${block.id} must render the retained observation`)
    else
      assert.equal(rows.length, 0, `${block.id} must preserve null and explicit point visibility`)
    assert(
      rows.every((row) => row === '1'),
      `${block.chart} rendered a filtered-out row`,
    )
    if (facts.get(block.id)!.length)
      assert.deepEqual(
        await cell
          .locator('[data-chart-mark][data-source-row-index="1"]')
          .evaluateAll((marks) =>
            marks.map((mark) =>
              JSON.stringify([
                mark.getAttribute('aria-label'),
                mark.getAttribute('data-share-end') === null
                  ? null
                  : Number(
                      (
                        Number(mark.getAttribute('data-share-end')) -
                        Number(mark.getAttribute('data-share-start'))
                      ).toFixed(12),
                    ),
              ]),
            ),
          ),
        facts.get(block.id),
        `${block.chart} changed prepared values or shares`,
      )
    await cell.getByRole('button', { name: 'cell 更多操作' }).click()
    await cell.getByRole('menuitem', { name: '数据源', exact: true }).click()
    const dialog = reader.getByRole('dialog', { name: '数据源', exact: true })
    await dialog.getByRole('tab', { name: '数据预览', exact: true }).click()
    assert.deepEqual(
      await dialog
        .getByRole('tabpanel', { name: '数据预览', exact: true })
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['1'],
    )
    await dialog.getByRole('button', { name: '关闭数据源', exact: true }).click()
    checked.push(block.chart)
  }
  await reader.getByRole('button', { name: /展示范围/ }).click()
  await reader.getByRole('menuitemradio', { name: '空结果', exact: true }).click()
  for (const block of charts) {
    const cell = reader.locator(`[data-block-id="${block.id}"]`)
    assert.equal(
      await cell.locator('[data-source-row-index]').count(),
      0,
      `${block.chart} must support an empty selection`,
    )
    assert.equal(await cell.getByText('暂无可绘制数据。', { exact: true }).count(), 1)
  }
  return {
    chartTypes: [...new Set(checked)].sort(),
    count: CHART_TYPES.length,
    originalRowIdentity: true,
    sourcePreviewsLinked: true,
    preparedValuesPreserved: true,
    emptySelection: true,
  }
}
