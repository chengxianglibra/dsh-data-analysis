/** Real isolated Harness UI + production package; scripted model, no production profile changes. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { chromium, type Page } from 'playwright'
import { parsePresentationDocument } from '../src/presentation/contracts/index.ts'
import { publishPresentation, readReportHistory } from '../src/presentation/reports.ts'
import { presentationHtml } from './presentation-html.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'
import { closeReport, openReport, reportAction } from './right-tabs/browser.ts'

const output = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-report-catalog-')))
const workspace = path.join(output, 'workspace')
await mkdir(workspace)
process.stdout.write(`Report catalog Web acceptance: ${output}\n`)
const python =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
const inputs = await preparePresentationInputs(workspace, python)
const server = await startPresentationWebHost(
  workspace,
  await mkdtemp(path.join(output, 'web-')),
  python,
  inputs.draftPaths,
  'native-first',
  { rightTabsAcceptance: true },
)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let page: Page | undefined
const errors: string[] = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } })
  page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const notice = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await notice.isVisible()) await notice.click()
  await page.getByText('S4 production Tool delivery', { exact: true }).first().click()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  assert.equal(await page.getByRole('button', { name: '打开报告', exact: true }).count(), 1)
  assert.equal(
    await page
      .locator('[class*="_footerActions"]')
      .getByRole('button', { name: '打开报告', exact: true })
      .count(),
    0,
  )
  const receipt = server.deliveries[0]!.receipt
  const original = parsePresentationDocument(
    JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
  )
  const updated = await publishPresentation(
    workspace,
    { ...original, title: '报告列表验收 · 当前版', buildId: randomUUID() },
    receipt.buildId,
    async () => {},
    undefined,
    { kind: 'agent', sessionId: server.deliveries[0]!.dshSessionId },
  )
  // Leave a complete losing Build on disk. It must never appear as history.
  await assert.rejects(
    publishPresentation(
      workspace,
      { ...original, title: '未发布版本', buildId: randomUUID() },
      receipt.buildId,
      async () => {},
    ),
    /report-save-conflict/,
  )
  await page.getByRole('button', { name: '打开报告', exact: true }).first().click()
  const dialog = page.locator('[data-rt-kind=reports]:visible')
  const search = dialog.getByRole('searchbox', { name: '按标题搜索', exact: true })
  const refresh = dialog.getByRole('button', { name: '刷新', exact: true })
  await search.waitFor()
  assert.equal(await dialog.getByRole('searchbox').count(), 1)
  assert.equal(await dialog.getByRole('button', { name: /刷新/ }).count(), 1)
  assert.equal(
    await dialog.locator('.pd-catalog-controls select, .pd-catalog-controls button').count(),
    0,
  )
  const titleBounds = await dialog.locator('.rt-heading').boundingBox()
  const refreshBounds = await refresh.boundingBox()
  assert.ok(titleBounds && refreshBounds)
  assert.ok(refreshBounds.x > titleBounds.x + titleBounds.width)
  assert.ok(
    Math.abs(titleBounds.y + titleBounds.height / 2 - refreshBounds.y - refreshBounds.height / 2) <
      3,
  )
  await search.fill('报告列表验收')
  await dialog.getByRole('button', { name: '报告列表验收 · 当前版', exact: true }).waitFor()
  assert.equal(await dialog.locator('tbody tr').count(), 1)
  assert.deepEqual(await dialog.locator('thead th').allTextContents(), [
    '报告标题',
    '生成对话',
    '更新时间',
  ])
  assert.equal(await dialog.locator('tbody tr td').count(), 3)
  assert.equal(await dialog.locator('tbody p').count(), 0)
  assert.equal(await dialog.getByText(receipt.summary, { exact: true }).count(), 0)
  assert.equal(await dialog.getByText(/Agent 更新 · |阅读器编辑 · |每行显示一个报告/).count(), 0)
  await refresh.click()
  await dialog.getByText('正在读取报告列表…', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await search.inputValue(), '报告列表验收')
  await dialog.getByRole('button', { name: '报告列表验收 · 当前版', exact: true }).click()
  const reader = page.locator('[data-rt-kind=report]:visible')
  await reportAction(reader, '历史版本')
  const history = reader.getByRole('complementary', { name: '历史版本' })
  await history.locator('li').nth(1).waitFor()
  assert.equal(await history.locator('li').count(), 2)
  assert.equal(await history.getByText('未发布版本', { exact: true }).count(), 0)
  await history.locator('li').nth(1).getByRole('button').first().click()
  await reader.locator(`[data-mode=interactive]`).waitFor()
  assert.equal(await reader.getAttribute('data-rt-build'), receipt.buildId)
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  assert.equal(
    await reader
      .getByRole('menuitem', { name: '编辑报告', exact: true })
      .getAttribute('aria-disabled'),
    'true',
  )
  await page.keyboard.press('Escape')
  const downloaded = page.waitForEvent('download')
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await reader.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const download = await downloaded
  const downloadPath = path.join(output, 'historical.html')
  await download.saveAs(downloadPath)
  assert.ok(download.suggestedFilename().includes(receipt.buildId))
  assert.deepEqual(await readFile(downloadPath), await presentationHtml(receipt))
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  const historicalView = page.waitForEvent('download')
  await reader.getByRole('menuitem', { name: '导出当前视图', exact: true }).click()
  const historicalViewPath = path.join(output, 'historical-view.html')
  await (await historicalView).saveAs(historicalViewPath)
  assert.ok((await readFile(historicalViewPath, 'utf8')).includes(`来源 Build：${receipt.buildId}`))
  await page.screenshot({ path: path.join(output, 'history-desktop.png'), fullPage: true })
  await closeReport(page, reader)
  await openReport(page, server.sessionId, {
    workspaceId: receipt.workspaceId,
    reportId: receipt.reportId,
  })
  await reportAction(reader, '编辑报告')
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  assert.equal(
    await reader
      .getByRole('menuitem', { name: '历史版本', exact: true })
      .getAttribute('aria-disabled'),
    'true',
  )
  await page.keyboard.press('Escape')
  await reader.getByRole('button', { name: '取消编辑', exact: true }).click()
  await closeReport(page, reader)
  await page.getByRole('button', { name: '打开报告', exact: true }).click()
  assert.equal(await dialog.getByRole('searchbox').inputValue(), '报告列表验收')
  await dialog.getByRole('searchbox').fill('不会匹配任何报告')
  await dialog.getByText('没有匹配标题的报告。', { exact: true }).waitFor()
  await dialog.getByRole('searchbox').fill('')
  await page.screenshot({ path: path.join(output, 'catalog-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileTitleBounds = await dialog.locator('.rt-heading').boundingBox()
  const mobileRefreshBounds = await refresh.boundingBox()
  assert.ok(mobileTitleBounds && mobileRefreshBounds)
  assert.ok(mobileRefreshBounds.x > mobileTitleBounds.x + mobileTitleBounds.width)
  assert.ok(
    Math.abs(
      mobileTitleBounds.y +
        mobileTitleBounds.height / 2 -
        mobileRefreshBounds.y -
        mobileRefreshBounds.height / 2,
    ) < 3,
  )
  assert.deepEqual(await dialog.locator('thead th').allTextContents(), [
    '报告标题',
    '生成对话',
    '更新时间',
  ])
  const rowsStayAligned = await dialog.locator('tbody tr').evaluateAll((rows) =>
    rows.every((row) => {
      const cells = Array.from(row.querySelectorAll('td'))
      return (
        cells.length === 3 &&
        cells.every(
          (cell) =>
            Math.abs(cell.getBoundingClientRect().y - cells[0]!.getBoundingClientRect().y) < 2,
        )
      )
    }),
  )
  assert.ok(rowsStayAligned, 'narrow list retains one table row with three columns per report')
  await page.screenshot({ path: path.join(output, 'catalog-mobile.png'), fullPage: true })
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    'mobile list fits its window',
  )
  await page.setViewportSize({ width: 1440, height: 1050 })
  // Reopening the published report uses the native current page and the same history.
  await openReport(page, server.sessionId, {
    workspaceId: receipt.workspaceId,
    reportId: receipt.reportId,
  })
  await reportAction(reader, '历史版本')
  await history.locator('li').nth(1).waitFor()
  assert.equal(
    (await readReportHistory(workspace, receipt.workspaceId, receipt.reportId)).currentBuildId,
    updated.buildId,
  )
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(output, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        boundary:
          'Real installed Harness Web and packed production plugin; scripted initial model and fixture publication, not fresh model analysis',
        checks: [
          'session header entry without footer shortcut',
          'single title-aligned refresh and live search without sorting controls',
          'three-column rows without summary metadata',
          'workspace list/search/empty state and refresh preserves query',
          'published-only history',
          'historical read-only',
          'exact historical HTML download',
          'return to current',
          'editing guards',
          'retained list search',
          'mobile fit',
          'native current page history',
        ],
        moduleDigests: server.moduleDigests,
        profile: server.profile,
      },
      null,
      2,
    ),
  )
  process.stdout.write(`Report catalog Web acceptance passed: ${output}\n`)
} catch (error) {
  if (page) {
    await writeFile(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText())
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
  }
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ error: String(error), errors }, null, 2),
  )
  throw error
} finally {
  await browser.close()
  await server.stop()
}
