/** Real installed Host and browser; isolated profile, real tools, scripted model boundary. */
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, chromium, type Page } from 'playwright'
import { analysisRecordId } from '../src/presentation/contracts/analysis-document.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'
import { analysisSurface, openHistory } from './right-tabs/browser.ts'
import { verifyHomepageShortcuts } from './right-tabs/homepage-shortcuts.ts'

const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-right-tabs-stage-one-')))
const workspaceRoot = path.join(outputRoot, 'workspace')
const python =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
await mkdir(workspaceRoot)
process.stdout.write(`Right Tabs isolated acceptance: ${outputRoot}\n`)
const inputs = await preparePresentationInputs(workspaceRoot, python)
await writeFile(
  path.join(workspaceRoot, 'models/datasources/protected.py'),
  'import marivo.datasource as md\nmd.duckdb(name="protected",path=":memory:",secrets=[md.http_bearer_secret(scope="http://127.0.0.1/",token=md.env("RIGHT_TABS_TEST_TOKEN"))])\n',
)
const server = await startPresentationWebHost(
  workspaceRoot,
  path.join(outputRoot, 'web'),
  python,
  inputs.requests,
  'native-first',
  { rightTabsAcceptance: true, askDshProbe: true },
)
let browser: Browser | undefined, page: Page | undefined
const checks: string[] = [],
  errors: string[] = []
const record = (message: string) => {
  checks.push(message)
  process.stdout.write(`PASS ${message}\n`)
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
  page.setDefaultTimeout(25_000)
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(server.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  const select = async (id: string) => {
    await page!.evaluate((id) => (window as any).__rtHost.select(id), id)
    await page!.waitForTimeout(200)
  }
  const run = async (mode: string, action = 'run') =>
    page!.evaluate(
      async ({ mode, action }) => {
        const result = await (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
          mode,
          action,
        })
        if (!result.ok) throw new Error(JSON.stringify(result))
        return result.value
      },
      { mode, action },
    )
  const opens = () =>
    page!.evaluate(
      () => (window as any).__rightTabs.audit.opens.filter((x: any) => x.automatic).length,
    )
  await select(server.sessionId)
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  assert.equal(await opens(), 0)
  record('initial persisted deliveries do not automatically open')
  await select('right-tabs-native')
  await verifyHomepageShortcuts(page, outputRoot)
  record(
    'blank homepage shortcuts open owning directories, deduplicate, localize and preserve rich drafts',
  )
  const native = await run('native')
  await page.locator('.marivo-workspace-shortcuts').waitFor({ state: 'hidden' })
  record('homepage shortcuts disappear after the first conversation turn')
  await page.locator(`[data-rt-build="${native.receipt.buildId}"]`).waitFor({ timeout: 45_000 })
  assert.equal(await opens(), 1)
  record('live Native delivery opens fixed Build once')
  assert.deepEqual(Object.keys(native.receipt.files), ['document'])
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  record('JSON-only report opens in right tab with no chat card')
  assert.equal(await page.getByRole('button', { name: '打开分析视图', exact: true }).count(), 1)
  assert.equal(
    await page
      .locator('[class*="_footerActions"]')
      .getByRole('button', { name: '打开分析视图', exact: true })
      .count(),
    0,
  )
  await page.getByRole('button', { name: '打开分析视图', exact: true }).first().click()
  const catalogPage = page.locator('[data-rt-kind=reports]')
  await catalogPage.locator('.pd-report-title').first().waitFor()
  const catalogSearch = catalogPage.getByRole('searchbox', { name: '按标题搜索', exact: true })
  const catalogRefresh = catalogPage.getByRole('button', { name: '刷新', exact: true })
  assert.equal(await catalogPage.getByRole('searchbox').count(), 1)
  assert.equal(await catalogPage.getByRole('button', { name: /刷新/ }).count(), 1)
  assert.deepEqual(await catalogPage.locator('thead th').allTextContents(), [
    '分析视图标题',
    '生成对话',
    '更新时间',
  ])
  assert.ok(
    await catalogPage
      .locator('tbody tr')
      .evaluateAll((rows) => rows.every((row) => row.querySelectorAll('td').length === 3)),
  )
  assert.equal(await catalogPage.locator('tbody p').count(), 0)
  assert.equal(await catalogPage.getByText(native.receipt.summary, { exact: true }).count(), 0)
  const catalogHeadingBounds = await catalogPage
    .getByRole('heading', { name: '分析视图', exact: true })
    .boundingBox()
  const catalogRefreshBounds = await catalogRefresh.boundingBox()
  assert.ok(catalogHeadingBounds && catalogRefreshBounds)
  assert.ok(catalogRefreshBounds.x > catalogHeadingBounds.x + catalogHeadingBounds.width)
  assert.ok(
    Math.abs(
      catalogHeadingBounds.y +
        catalogHeadingBounds.height / 2 -
        catalogRefreshBounds.y -
        catalogRefreshBounds.height / 2,
    ) < 3,
  )
  const updateTimes = (await catalogPage.locator('tbody td:nth-child(3)').allTextContents()).map(
    (value) => Date.parse(value),
  )
  assert.ok(
    updateTimes.every(
      (value, index) => Number.isFinite(value) && (index === 0 || updateTimes[index - 1]! >= value),
    ),
  )
  await catalogSearch.fill('不会匹配任何报告')
  await catalogPage.getByText('没有匹配标题的分析视图。', { exact: true }).waitFor()
  await catalogRefresh.click()
  await catalogPage.getByText('正在读取分析视图列表…', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await catalogSearch.inputValue(), '不会匹配任何报告')
  await catalogSearch.fill('')
  await catalogPage.locator('.pd-report-title').first().waitFor()
  record(
    'Workspace report entry has no footer shortcut; title-aligned refresh, live search and three-column recent-first rows',
  )
  await page.screenshot({ path: path.join(outputRoot, 'report-directory.png'), fullPage: true })
  await page.setViewportSize({ width: 900, height: 900 })
  assert.ok(
    await catalogPage.locator('tbody tr').evaluateAll((rows) =>
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
    ),
    'narrow native report pane retains one row with three columns per report',
  )
  await page.screenshot({
    path: path.join(outputRoot, 'report-directory-narrow.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 1680, height: 1100 })
  // The newest report was generated in right-tabs-native; its Session link must navigate there.
  await select(server.sessionId)
  await page.getByRole('button', { name: '打开分析视图', exact: true }).click()
  await page
    .locator('[data-rt-kind=reports] tbody tr')
    .first()
    .locator('td')
    .nth(1)
    .getByRole('button')
    .click()
  await page.waitForFunction(() => (window as any).__rtHost.current() === 'right-tabs-native')
  await catalogPage.locator('.pd-report-title').first().waitFor()
  record('report generation Session link navigates to its source conversation')
  await page.locator('[data-rt-kind=reports]').locator('.pd-report-title').first().click()
  await openHistory(page.locator('[data-rt-kind=report][data-rt-current=true]'))
  record(
    'report title opens the native current page and its history remains available in the reader',
  )
  await page.evaluate(
    ({ workspaceId, reportId }) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId,
        reportId,
      }),
    native.receipt,
  )
  await page.locator('[data-rt-kind=report][data-rt-current=true]').waitFor()
  const count = await page.evaluate(() => (window as any).__rightTabs.pages.size)
  await page.evaluate(
    ({ workspaceId, reportId }) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId,
        reportId,
      }),
    native.receipt,
  )
  assert.equal(await page.evaluate(() => (window as any).__rightTabs.pages.size), count)
  record('directory and current coexist; repeat resource navigation focuses')
  const updated = await run('native')
  await page.locator(`[data-rt-build="${updated.receipt.buildId}"]`).waitFor()
  await page.evaluate(
    ({ workspaceId, reportId }) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId,
        reportId,
      }),
    native.receipt,
  )
  await page
    .locator(`[data-rt-kind=report][data-rt-build="${updated.receipt.buildId}"]`)
    .and(page.locator('[data-rt-current=true]'))
    .waitFor()
  record('explicit reopen current resolves latest Build')
  const currentPage = page.locator('[data-rt-kind=report][data-rt-current=true]')
  assert.equal(
    await analysisSurface(currentPage).getAttribute('data-analysis-record'),
    analysisRecordId(updated.receipt.reportId, updated.receipt.buildId),
  )
  await openHistory(currentPage)
  await currentPage.locator('.pd-version').filter({ hasText: '当前版本' }).click()
  await analysisSurface(currentPage).waitFor()
  await page.screenshot({ path: path.join(outputRoot, 'report-header.png'), fullPage: true })
  record('current reader shows the latest saved record; history current selection returns to it')
  const currentTab = await currentPage.getAttribute('data-rt-tab')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.float(id), currentTab)
  await analysisSurface(currentPage).waitFor()
  await page.screenshot({ path: path.join(outputRoot, 'floating-reader.png'), fullPage: true })
  const floatingPane = await currentPage.getAttribute('data-rt-panel')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.dock(id), floatingPane)
  const pane = await page.evaluate(() => (window as any).__rtHost.sidebar.split())
  assert.ok(pane, 'Wide viewport must allow a second pane')
  await page.evaluate(
    ({ pane, receipt }) =>
      (window as any).__rtHost.sidebar.openResource(
        (window as any).__rightTabs.resourceAddress({
          kind: 'report',
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
        }),
        { paneId: pane, revealIfOpened: false },
      ),
    { pane, receipt: native.receipt },
  )
  await page.locator(`[data-rt-build="${native.receipt.buildId}"]`).last().waitFor()
  assert.equal(await currentPage.isVisible(), true)
  await page.screenshot({ path: path.join(outputRoot, 'parallel-builds.png'), fullPage: true })
  record('fixed/current parallel panes; the current reader survives float/dock remount')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.focus(id), currentTab)
  const history = (locale: 'zh' | 'en') =>
    currentPage.getByRole('button', {
      name: locale === 'zh' ? '分析视图操作' : 'Analysis view actions',
    })
  const surface = analysisSurface(currentPage)
  assert.equal(await surface.getAttribute('aria-label'), updated.receipt.title)
  await page.evaluate(() => (window as any).__rtHost.locale.setLocale('en'))
  await history('en').waitFor()
  assert.equal(await surface.getAttribute('aria-label'), updated.receipt.title)
  assert.equal(await currentPage.getAttribute('data-rt-build'), updated.receipt.buildId)
  await page.evaluate(() => (window as any).__rtHost.locale.setLocale('zh'))
  await history('zh').waitFor()
  record(
    'real Host locale switch updates reader controls and preserves fixed report content and Build',
  )
  // Keep this viewport shorter than the compact report so scrolling is testable.
  await page.setViewportSize({ width: 430, height: 600 })
  await history('zh').waitFor()
  const scroll = await currentPage.evaluate((node) => {
    const candidates = [node, ...node.querySelectorAll('*')]
    const target = candidates.find(
      (item) =>
        item instanceof HTMLElement &&
        item.scrollHeight > item.clientHeight + 10 &&
        /auto|scroll/.test(getComputedStyle(item).overflowY),
    ) as HTMLElement | undefined
    if (!target) return { found: false, moved: false }
    target.scrollTop = 50
    const moved = target.scrollTop > 0
    target.scrollTop = 0
    return { found: true, moved }
  })
  assert.deepEqual(scroll, { found: true, moved: true })
  record('narrow reader actions remain operable and its scroll container moves')
  await page.screenshot({ path: path.join(outputRoot, 'narrow-reader.png'), fullPage: true })
  await page.locator('[data-sidebar-right-panel=fullscreen][data-sidebar-right-open]').waitFor()
  await page.evaluate(() => (window as any).__rtHost.sidebar.toggleExpanded())
  await currentPage.waitFor({ state: 'hidden' })
  await page.evaluate(() => (window as any).__rtHost.sidebar.toggleExpanded())
  await history('zh').waitFor()
  assert.equal(await currentPage.getAttribute('data-rt-build'), updated.receipt.buildId)
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.getByRole('button', { name: '全屏', exact: true }).click()
  await page.locator('[data-sidebar-right-panel=fullscreen][data-sidebar-right-open]').waitFor()
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  await page.locator('[data-sidebar-right-panel=push][data-sidebar-right-open]').waitFor()
  await analysisSurface(currentPage).waitFor()
  record('narrow fullscreen and collapse/expand preserve the reader')

  await page.getByRole('button', { name: '打开语义层', exact: true }).click()
  await page.locator('[data-rt-kind=semantic] .sb-objects button').first().waitFor()
  await page.setViewportSize({ width: 600, height: 900 })
  await page.locator('.sb-kinds').getByRole('radio', { name: /^指标/ }).click()
  const semanticDirectoryTab = await page
    .locator('[data-rt-kind=semantic]')
    .getAttribute('data-rt-tab')
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.getByRole('button', { name: '打开语义层', exact: true }).click()
  assert.equal(
    await page.locator('[data-rt-kind=semantic]').getAttribute('data-rt-tab'),
    semanticDirectoryTab,
  )
  await page.setViewportSize({ width: 600, height: 900 })
  await page.waitForFunction((id) => {
    const owner = [...(window as any).__rightTabs.pages.values()].find(
      (item: any) => item.target.kind === 'semantic' && !('ref' in item.target),
    ) as any
    const state = owner?.semantic.getSnapshot()
    const view = state?.views[state.workspaceId]
    return document.querySelector(`[data-rt-tab="${id}"]`) && view && !view.loading
  }, semanticDirectoryTab)
  assert.equal(
    await page
      .locator('.sb-kinds')
      .getByRole('radio', { name: /^指标/ })
      .getAttribute('aria-checked'),
    'true',
  )
  await page.screenshot({ path: path.join(outputRoot, 'semantic-directory.png'), fullPage: true })
  await page
    .locator('.sb-kinds')
    .getByRole('radio', { name: /^全部对象/ })
    .click()
  await page.setViewportSize({ width: 1680, height: 1100 })
  record('semantic narrow-pane filters remain accessible and repeat entry preserves state')
  await page.locator('[data-rt-kind=semantic] .sb-objects button').first().click()
  assert.equal(await page.getByRole('button', { name: '在独立标签页打开', exact: true }).count(), 0)
  // Report source navigation uses this resource route; directory details stay in place.
  await page.evaluate(() => {
    const app = (window as any).__rightTabs
    const owner = [...app.pages.values()].find(
      (p: any) => p.target.kind === 'semantic' && !('ref' in p.target),
    ) as any
    const view = owner.semantic.getSnapshot().views[owner.target.workspaceId]
    app.navigate(owner.sessionId, {
      kind: 'semantic',
      workspaceId: owner.target.workspaceId,
      ref: view.snapshot.objects[0].ref,
    })
  })
  await page.waitForFunction(() =>
    [...(window as any).__rightTabs.pages.values()].some(
      (p: any) =>
        p.target.kind === 'semantic' &&
        'ref' in p.target &&
        p.semantic.getSnapshot().views[p.target.workspaceId]?.snapshot,
    ),
  )
  await page.evaluate(() => {
    const app = (window as any).__rightTabs
    const owner = [...app.pages.values()].find(
      (p: any) => p.target.kind === 'semantic' && 'ref' in p.target,
    ) as any
    const objects = owner.semantic.getSnapshot().views[owner.target.workspaceId].snapshot.objects
    const object = objects.find((o: any) =>
      o.relations.some((r: any) =>
        objects.some((v: any) => v.ref.kind === r.ref.kind && v.ref.path === r.ref.path),
      ),
    )
    if (!object) throw new Error('Fixture needs a semantic relation')
    app.navigate(owner.sessionId, {
      kind: 'semantic',
      workspaceId: owner.target.workspaceId,
      ref: object.ref,
    })
  })
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  const semanticTab = await page.locator('[data-rt-kind=semantic]').getAttribute('data-rt-tab')
  const semanticRef = await page
    .locator('[data-rt-kind=semantic] .sb-detail .sb-identity-text .sb-ref')
    .innerText()
  const another = page.locator('[data-rt-kind=semantic] .sb-relation-list button:enabled').first()
  await page.evaluate((id) => {
    const app = (window as any).__rightTabs
    const owner = [...app.pages.entries()].find(([key]) => JSON.parse(key)[1] === id)[1]
    ;(window as any).__semanticNavigationProbe = {
      model: owner.semantic,
      snapshot: owner.semantic.getSnapshot().views[owner.target.workspaceId].snapshot,
      opens: app.audit.opens.length,
    }
  }, semanticTab)
  await another.click()
  assert.equal(
    await page.locator('[data-rt-kind=semantic]').getAttribute('data-rt-tab'),
    semanticTab,
  )
  assert.notEqual(
    await page.locator('[data-rt-kind=semantic] .sb-detail .sb-identity-text .sb-ref').innerText(),
    semanticRef,
  )
  await page.getByRole('button', { name: '返回上个对象', exact: true }).click()
  assert.equal(
    await page.locator('[data-rt-kind=semantic] .sb-detail .sb-identity-text .sb-ref').innerText(),
    semanticRef,
  )
  assert.equal(
    await page.evaluate(() => {
      const probe = (window as any).__semanticNavigationProbe
      const state = probe.model.getSnapshot()
      const view = state.views[state.workspaceId]
      return (
        view.snapshot === probe.snapshot &&
        !view.loading &&
        (window as any).__rightTabs.audit.opens.length === probe.opens
      )
    }),
    true,
  )
  assert.equal(
    await page.locator('[data-rt-kind=semantic]').getByRole('button', { name: /刷新/ }).count(),
    1,
  )
  assert.equal(await page.locator('dialog.sb-dialog').count(), 0)
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  record(
    'semantic resource browsing keeps the same tab and snapshot, supports history and returns to list',
  )
  await page.getByRole('button', { name: '打开数据源与凭证', exact: true }).click()
  const datasourcePanel = page.locator('[data-rt-kind=datasources]')
  const datasourceButtons = datasourcePanel.getByRole('tab', { name: /^选择数据源 / })
  await datasourceButtons.last().click()
  const selectedDatasource = await datasourceButtons.last().getAttribute('aria-label')
  assert.equal(await datasourceButtons.last().getAttribute('aria-selected'), 'true')
  await datasourcePanel.getByRole('button', { name: '刷新数据源', exact: true }).click()
  await datasourcePanel.getByRole('tab', { name: selectedDatasource!, exact: true }).waitFor()
  assert.equal(
    await datasourcePanel
      .getByRole('tab', { name: selectedDatasource!, exact: true })
      .getAttribute('aria-selected'),
    'true',
  )
  assert.equal(await page.locator('dialog.mc-dialog').count(), 0)
  const layout = await datasourcePanel.evaluate((panel) => {
    const title = panel.querySelector('.rt-heading')!.getBoundingClientRect()
    const refresh = panel.querySelector('[aria-label="刷新数据源"]')!.getBoundingClientRect()
    const list = panel.querySelector('.mc-datasources')!.getBoundingClientRect()
    const detail = panel.querySelector('.mc-form')!.getBoundingClientRect()
    const selected = panel
      .querySelector('.mc-datasource[aria-selected=true]')!
      .getBoundingClientRect()
    return {
      aligned: Math.abs(title.y + title.height / 2 - refresh.y - refresh.height / 2) < 2,
      above: list.bottom <= detail.top,
      selectedVisible: selected.left >= list.left - 1 && selected.right <= list.right + 1,
      overflow: panel.scrollWidth > panel.clientWidth,
    }
  })
  assert.deepEqual(layout, { aligned: true, above: true, selectedVisible: true, overflow: false })
  await page.screenshot({ path: path.join(outputRoot, 'datasource-directory.png'), fullPage: true })
  record('datasource Tab owns top navigation and refresh without a dialog')
  await select('right-tabs-credentials')
  await run('credentials', 'credential-start')
  await page.locator('[data-rt-kind=datasources] .mc-request-status').waitFor()
  await page.getByRole('button', { name: '等待配置凭证', exact: true }).click()
  const credentialDialog = page.locator('[data-rt-kind=datasources] .mc-panel')
  await credentialDialog.locator('input[type=password]').fill('isolated-prototype-test-value')
  await credentialDialog.getByRole('button', { name: '提交凭证并继续', exact: true }).click()
  await run('credentials', 'credential-idle')
  record('isolated credential input completes the waiting production datasource call')
  await select('right-tabs-native')
  await run('credentials', 'history')
  await select('right-tabs-credentials')
  const beforePaginationAudit = await page.evaluate(() => (window as any).__rightTabs.audit)
  // A warm Session resumes its cached contiguous window. Reload to request a bounded tail page.
  await page.reload()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  await page.waitForFunction(
    () =>
      (window as any).__rtHost.history('right-tabs-credentials') ||
      (window as any).__rightTabs.audit.changes.some((x: any) => x.kind === 'prepend'),
  )
  await page.evaluate(() => (window as any).__rtHost.loadOlder('right-tabs-credentials'))
  assert.equal(await opens(), 0)
  assert.ok(
    await page.evaluate(() =>
      (window as any).__rightTabs.audit.changes.some((x: any) => x.kind === 'prepend'),
    ),
  )
  record('real history pagination publishes prepend without auto-open')
  await select('right-tabs-ptc')
  const beforePtc = await opens()
  const ptc = await run('ptc')
  await page.locator(`[data-rt-build="${ptc.receipt.buildId}"]`).waitFor()
  await page.waitForTimeout(300)
  assert.equal(await opens(), beforePtc + 1)
  const beforeBackground = await opens()
  await select('right-tabs-native')
  await page.getByRole('button', { name: '打开分析视图', exact: true }).first().click()
  await page.locator('[data-rt-kind=reports] .pd-report-title').first().waitFor()
  await page.evaluate(
    ({ workspaceId, reportId }) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId,
        reportId,
      }),
    ptc.receipt,
  )
  const backgroundCurrent = page.locator('[data-rt-kind=report][data-rt-current=true]')
  await analysisSurface(backgroundCurrent).waitFor()
  const beforeBackgroundTab = await backgroundCurrent.getAttribute('data-rt-tab')
  const backgroundUpdate = await run('ptc')
  await page.waitForFunction(({ reportId, buildId }) => {
    const pages = [...(window as any).__rightTabs.pages.values()] as any[]
    return (
      pages.some(
        (p) =>
          p.target.reportId === reportId &&
          !p.target.buildId &&
          p.getSnapshot().newer?.buildId === buildId,
      ) &&
      pages.some(
        (p) =>
          p.target.kind === 'reports' &&
          p.catalog.getSnapshot().catalog?.reports.some((r: any) => r.receipt.buildId === buildId),
      )
    )
  }, backgroundUpdate.receipt)
  assert.equal(await backgroundCurrent.getAttribute('data-rt-build'), ptc.receipt.buildId)
  assert.equal(
    await page.evaluate(() => (window as any).__rtHost.sidebar.active().id),
    beforeBackgroundTab,
  )
  assert.equal(await opens(), beforeBackground)
  await page.screenshot({
    path: path.join(outputRoot, 'background-current-hint.png'),
    fullPage: true,
  })
  record(
    'background delivery refreshes Workspace catalog and hints current without switching Build or focus',
  )
  await page.evaluate(
    (receipt) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId: receipt.workspaceId,
        reportId: receipt.reportId,
        buildId: receipt.buildId,
      }),
    backgroundUpdate.receipt,
  )
  const latestFixed = page.locator(
    `[data-rt-kind=report][data-rt-build="${backgroundUpdate.receipt.buildId}"]`,
  )
  await analysisSurface(latestFixed).waitFor()
  assert.equal(
    await page.evaluate(
      ({ reportId, buildId }) =>
        [...(window as any).__rightTabs.pages.values()].some(
          (p: any) =>
            p.target.kind === 'report' &&
            p.target.reportId === reportId &&
            !p.target.buildId &&
            p.reader.getSnapshot().analysisDocument?.buildId === buildId,
        ),
      ptc.receipt,
    ),
    true,
  )
  record('explicit fixed address opens the background Build without moving the current reader')
  const cold = await run('cold')
  await page.waitForFunction(
    ({ buildId }) =>
      [...(window as any).__rightTabs.pages.values()].some(
        (p: any) =>
          p.target.kind === 'reports' &&
          p.catalog.getSnapshot().catalog?.reports.some((r: any) => r.receipt.buildId === buildId),
      ),
    cold.receipt,
  )
  assert.equal(await opens(), beforeBackground)
  assert.equal(
    await page.evaluate(() =>
      (window as any).__rightTabs.audit.changes.some((x: any) => x.sessionId === 'right-tabs-cold'),
    ),
    false,
  )
  record(
    'cold background run refreshes publications without opening its history window or a report Tab',
  )
  await select('right-tabs-ptc')
  await page.waitForTimeout(300)
  assert.equal(await opens(), beforeBackground)
  record('PTC opens once; background delivery does not reopen')
  const rejectsUnknown = await page.evaluate(() => {
    try {
      ;(window as any).__rtHost.sidebar.openResource('dsh-resource://marivo-report/malformed')
      return false
    } catch {
      return true
    }
  })
  assert.equal(rejectsUnknown, true)
  await page
    .getByRole('button', { name: /^已完成，用时/ })
    .first()
    .click()
  await page
    .getByRole('button', { name: /运行了代码/ })
    .first()
    .click()
  const fileLink = page
    .locator('span:visible')
    .filter({ hasText: /s4-produced-.*\.txt/ })
    .first()
  await fileLink.click()
  assert.notEqual(
    await page.evaluate(() => (window as any).__rtHost.sidebar.active()?.kind),
    'marivo-report-resource',
  )
  record('unknown resource fails and original produced file still opens native preview')
  await page.evaluate(() => {
    ;(window as any).__rtHost.delay.arm()
  })
  await page.evaluate(
    (receipt) =>
      (window as any).__rtHost.sidebar.openResource(
        (window as any).__rightTabs.resourceAddress({
          kind: 'report',
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
        }),
        { revealIfOpened: false },
      ),
    ptc.receipt,
  )
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  const heldTab = await page.evaluate(() => (window as any).__rtHost.sidebar.active().id)
  await page.evaluate((id) => (window as any).__rtHost.sidebar.close(id), heldTab)
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await page.waitForTimeout(100)
  assert.equal(
    await page.evaluate(
      (id) =>
        [...(window as any).__rightTabs.pages.keys()].some(
          (key: any) => JSON.parse(key)[0] === 'right-tabs-ptc' && JSON.parse(key)[1] === id,
        ),
      heldTab,
    ),
    false,
  )
  record('late actual file response cannot resurrect a closed Tab')
  await page.evaluate(() => (window as any).__rtHost.delay.arm())
  await page.evaluate(
    (receipt) =>
      (window as any).__rtHost.sidebar.openResource(
        (window as any).__rightTabs.resourceAddress({
          kind: 'report',
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
        }),
        { revealIfOpened: false },
      ),
    ptc.receipt,
  )
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  const replaced = await page.evaluate(() => (window as any).__rtHost.sidebar.active().id)
  await page.evaluate(
    ({ receipt, replaced }) =>
      (window as any).__rtHost.sidebar.openResource(
        (window as any).__rightTabs.resourceAddress({
          kind: 'report',
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
        }),
        { replaceTab: replaced, revealIfOpened: false },
      ),
    { receipt: native.receipt, replaced },
  )
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await page.locator(`[data-rt-kind=report][data-rt-build="${native.receipt.buildId}"]`).waitFor()
  assert.equal(
    await page.evaluate(
      (id) =>
        [...(window as any).__rightTabs.pages.keys()].some(
          (key: any) => JSON.parse(key)[0] === 'right-tabs-ptc' && JSON.parse(key)[1] === id,
        ),
      replaced,
    ),
    false,
  )
  record('replacement navigation ignores an old delayed read')
  await page.evaluate(() => (window as any).__rtHost.delay.arm())
  await page.evaluate(
    (receipt) =>
      (window as any).__rtHost.sidebar.openResource(
        (window as any).__rightTabs.resourceAddress({
          kind: 'report',
          workspaceId: receipt.workspaceId,
          reportId: receipt.reportId,
          buildId: receipt.buildId,
        }),
        { revealIfOpened: false },
      ),
    ptc.receipt,
  )
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  const movingTab = await page.evaluate(() => (window as any).__rtHost.sidebar.active().id)
  await page.evaluate((id) => (window as any).__rtHost.sidebar.float(id), movingTab)
  const movingPage = page.locator(`[data-rt-tab="${movingTab}"]`)
  const movingPane = await movingPage.getAttribute('data-rt-panel')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.dock(id), movingPane)
  await page.evaluate(() => (window as any).__rtHost.sidebar.toggleExpanded())
  await page.evaluate(() => (window as any).__rtHost.sidebar.toggleExpanded())
  await select('right-tabs-native')
  const foregroundContent = await page.locator('[data-rt-kind=report]').allTextContents()
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await page.waitForTimeout(100)
  assert.deepEqual(await page.locator('[data-rt-kind=report]').allTextContents(), foregroundContent)
  await select('right-tabs-ptc')
  await page.locator(`[data-rt-kind=report][data-rt-build="${ptc.receipt.buildId}"]`).waitFor()
  record('delayed read survives float/dock/collapse and stays with its Session occurrence')
  const beforeReconnect = await opens()
  await page.context().setOffline(true)
  await page.evaluate(() => (window as any).__rtHost.reconnect())
  await page.waitForTimeout(1200)
  await page.context().setOffline(false)
  await page
    .getByRole('alert')
    .filter({ hasText: /Host 连接已(?:中断|重置)/ })
    .first()
    .waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => (window as any).__rtHost.generation())
  assert.equal(await opens(), beforeReconnect)
  record('actual network disconnect/reconnect invalidates pages without replay auto-open')
  await select('right-tabs-native')
  await page.evaluate(
    ({ workspaceId, reportId }) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId,
        reportId,
      }),
    native.receipt,
  )
  await page.locator('[data-rt-kind=report] [data-analysis-record]').first().waitFor()
  // The native surface animates into view; mounted/visible does not mean its geometry has settled.
  await page.waitForFunction(() => {
    const visible = [...document.querySelectorAll('[data-rt-kind=report]')]
      .map((node) => node.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0)
    return (
      visible.length > 0 &&
      visible.every((bounds) => bounds.width > 100 && bounds.right <= window.innerWidth + 1)
    )
  })
  record('reader container stays within the native viewport after reconnect')

  await page.screenshot({ path: path.join(outputRoot, 'native-tabs.png'), fullPage: true })
  const audit = await page.evaluate(() => (window as any).__rightTabs.audit)
  await page.reload()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  await page.waitForTimeout(500)
  assert.equal(await opens(), 0)
  record('reload reconstructs baseline without auto-opening')
  await select('right-tabs-ptc')
  await page.evaluate(() => (window as any).__rtHost.delay.arm())
  await page.evaluate(
    (receipt) =>
      (window as any).__rightTabs.navigate('right-tabs-ptc', {
        kind: 'report',
        workspaceId: receipt.workspaceId,
        reportId: receipt.reportId,
        buildId: receipt.buildId,
      }),
    ptc.receipt,
  )
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  await page.getByRole('button', { name: '打开数据源与凭证', exact: true }).click()
  await page
    .getByRole('tab', { name: /^选择数据源 / })
    .first()
    .waitFor()
  const beforeDetachReads = await page.evaluate(() =>
    (window as any).__rtHost.delay.overviewReads(),
  )
  await run('ptc', 'detach')
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await page.locator('[data-rt-kind=datasources] .mc-panel').waitFor({ state: 'detached' })
  await page.getByText('Workspace 已变化或不可用，请重新打开页面。', { exact: true }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(
    await page.evaluate(() => (window as any).__rtHost.delay.overviewReads()),
    beforeDetachReads,
  )
  assert.equal(await page.getByRole('tab', { name: /^选择数据源 / }).count(), 0)
  await page.screenshot({ path: path.join(outputRoot, 'revoked-datasource.png'), fullPage: true })
  record('Workspace revocation closes the datasource view without re-reading or reviving its Tab')
  assert.equal(await page.locator('[data-rt-kind=report] [data-analysis-record]').count(), 0)
  assert.equal(
    await page.evaluate(() => {
      const reports = [...(window as any).__rightTabs.pages.values()].filter(
        (p: any) => p.sessionId === 'right-tabs-ptc' && p.target.kind === 'report',
      ) as any[]
      return (
        reports.length > 0 &&
        reports.every((p) => p.getSnapshot().error && !p.reader.getSnapshot().analysisDocument)
      )
    }),
    true,
  )
  record('Workspace detachment invalidates old reader and actions')
  await assert.rejects(
    () =>
      page!.evaluate(
        (receipt) =>
          (window as any).__rightTabs.navigate('right-tabs-ptc', {
            kind: 'report',
            workspaceId: receipt.workspaceId,
            reportId: receipt.reportId,
            buildId: receipt.buildId,
          }),
        ptc.receipt,
      ),
    /marivo\.navigation\.the-owning-session-or-workspace-changed-return-to-its/,
  )
  record('revoked Workspace rejects report navigation')
  await run('ptc', 'attach')
  await page.evaluate(() => (window as any).__rtHost.delay.arm())
  await page.evaluate(
    (receipt) =>
      (window as any).__rightTabs.navigate('right-tabs-ptc', {
        kind: 'report',
        workspaceId: receipt.workspaceId,
        reportId: receipt.reportId,
        buildId: receipt.buildId,
      }),
    ptc.receipt,
  )
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  const withoutSession = await page.evaluate(async (receipt) => {
    const host = (window as any).__rtHost
    await host.clear()
    try {
      ;(window as any).__rightTabs.navigate('right-tabs-ptc', {
        kind: 'report',
        workspaceId: receipt.workspaceId,
        reportId: receipt.reportId,
        buildId: receipt.buildId,
      })
      return false
    } catch {
      return true
    }
  }, ptc.receipt)
  assert.equal(withoutSession, true)
  record('navigation without a foreground Session fails explicitly')
  assert.equal(await page.evaluate(() => (window as any).__rtHost.current()), undefined)
  assert.equal(await page.getByRole('button', { name: '打开分析视图', exact: true }).count(), 0)
  record('clearing the foreground Session leaves no removed footer report shortcut')
  await page.evaluate(() => (window as any).__rtHost.unload())
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  assert.equal(await page.evaluate(() => (window as any).__rightTabs.pages.size), 0)
  record('default client unload drains page models and registrations')
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(outputRoot, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        boundary:
          'Real installed Host, production tools and Runtime; scripted model; packaged default client',
        checks,
        audit,
        beforePaginationAudit,
        afterReloadAudit: await page.evaluate(() => (window as any).__rightTabs.audit),
        workspaceRoot,
        profile: server.profile,
        dshVersion: createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version,
        nodeVersion: process.version,
        browserVersion: browser.version(),
        productionModuleDigests: server.moduleDigests,
        packageIntegrity: server.packageIntegrity,
        modelBoundary: {
          configuredProviders: [
            'right-tabs-native',
            'right-tabs-ptc',
            'right-tabs-cold',
            'right-tabs-credentials',
            'right-tabs-semantic',
          ],
          model: 'deterministic-seam',
          scripted: true,
        },
        inputs: inputs.binding,
      },
      null,
      2,
    ),
  )
  process.stdout.write(`Right Tabs acceptance passed: ${outputRoot}\n`)
} catch (error) {
  if (page) {
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await page.locator('body').innerText(),
    )
    await page.screenshot({ path: path.join(outputRoot, 'failure.png'), fullPage: true })
    const audit = await page
      .evaluate(() => (window as any).__rightTabs?.audit)
      .catch(() => undefined)
    await writeFile(
      path.join(outputRoot, 'failure.json'),
      JSON.stringify({ error: String(error), errors, checks, audit }, null, 2),
    )
  }
  throw error
} finally {
  await browser?.close()
  await server.stop()
  // Only this invocation's generated Workspace/profile contain disposable test state.
  // Keep screenshots, HTML and audit evidence outside these directories.
  const skills = path.join(outputRoot, 'web', 'web-runtime-marker', 'plugin-skills')
  const entries = await readdir(skills, { recursive: true, withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    },
  )
  for (const entry of entries)
    if (entry.isDirectory()) await chmod(path.join(entry.parentPath, entry.name), 0o700)
  await rm(path.join(outputRoot, 'web'), { recursive: true, force: true })
  await rm(workspaceRoot, { recursive: true, force: true })
}
