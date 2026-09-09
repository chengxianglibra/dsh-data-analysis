/** Real alpha Host and browser; isolated profile, real tools, scripted model boundary. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, chromium, type Locator, type Page } from 'playwright'
import { presentationEdits } from '../src/presentation/contracts/editing.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'

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
  'import marivo.datasource as md\nmd.duckdb(name="protected",path=":memory:",http_scope="http://127.0.0.1/",http_bearer_token_env="RIGHT_TABS_TEST_TOKEN")\n',
)
const server = await startPresentationWebHost(
  workspaceRoot,
  path.join(outputRoot, 'web'),
  python,
  inputs.draftPaths,
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
  const draftSnapshot = () =>
    page!.evaluate(() => (window as any).__askDshProbe.read('right-tabs-native'))
  const askCell = async (reader: Locator, cellId = 'bar') => {
    const cell = reader.locator(`[data-mode=interactive] [data-block-id="${cellId}"]`)
    await cell.getByRole('button', { name: 'cell 更多操作' }).click()
    await cell.getByRole('menuitem', { name: 'Ask DSH', exact: true }).click()
  }
  const assertAskIdentity = async (
    reader: Locator,
    identity: {
      workspaceId: string
      reportId: string
      buildId: string
    },
    cellId = 'bar',
  ) => {
    const before = await draftSnapshot()
    const callCount = await page!.evaluate(() => (window as any).__askDshProbe.audit().calls.length)
    await askCell(reader, cellId)
    const after = await draftSnapshot()
    assert.ok(after.draft.startsWith(before.draft), 'preserve existing draft')
    const lines = after.draft.slice(before.draft.length).split('\n')
    assert.ok(lines.includes('【报告上下文】'))
    assert.ok(lines.includes(`Workspace: ${identity.workspaceId}`))
    assert.ok(lines.includes(`Report ID: ${identity.reportId}`))
    assert.ok(lines.includes(`Build ID: ${identity.buildId}`))
    assert.ok(lines.includes(`Cell: ${cellId}`))
    assert.equal(lines.filter((line: string) => line.startsWith('Build ID: ')).length, 1)
    assert.deepEqual(after.occurrences, before.occurrences)
    assert.deepEqual(after.attachmentIds, before.attachmentIds)
    const calls = await page!.evaluate(
      (start) => (window as any).__askDshProbe.audit().calls.slice(start),
      callCount,
    )
    assert.equal(
      calls.some((call: { endpoint: string }) => /submit|send|serialize/i.test(call.endpoint)),
      false,
    )
  }
  await select(server.sessionId)
  await page.locator('[data-presentation-card]').first().waitFor()
  assert.equal(await opens(), 0)
  record('initial persisted deliveries do not automatically open')
  await select('right-tabs-native')
  const native = await run('native')
  await page.locator(`[data-rt-build="${native.receipt.buildId}"]`).waitFor({ timeout: 45_000 })
  assert.equal(await opens(), 1)
  record('live Native delivery opens fixed Build once')
  const cardDownloadEvent = page.waitForEvent('download')
  await page
    .locator(`[data-presentation-card="${native.receipt.buildId}"]`)
    .getByRole('button', { name: '下载 HTML', exact: true })
    .click()
  const cardDownload = await cardDownloadEvent
  const cardPath = path.join(outputRoot, 'card-report.html')
  await cardDownload.saveAs(cardPath)
  assert.deepEqual(await readFile(cardPath), await readFile(native.receipt.files.html.path))
  assert.equal(await page.locator('dialog.pd-dialog[open]').count(), 0)
  record('default client card downloads its fixed Build without opening an overlay')
  await page.getByRole('button', { name: '打开报告', exact: true }).first().click()
  await page.locator('[data-rt-kind=reports] .pd-report-title').first().waitFor()
  await page.screenshot({ path: path.join(outputRoot, 'report-directory.png'), fullPage: true })
  await page
    .locator('[data-rt-kind=reports]')
    .getByRole('button', { name: '查看历史', exact: true })
    .first()
    .click()
  await page.locator('[data-rt-kind=report] .pd-history').waitFor()
  record('catalog history action opens the native current page at its history panel')
  await page.evaluate(
    ({ workspaceId, reportId }) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId,
        reportId,
      }),
    native.receipt,
  )
  await page.locator('[data-rt-kind=report]').filter({ hasText: 'current · 当前版本' }).waitFor()
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
    .filter({ hasText: 'current · 当前版本' })
    .waitFor()
  record('explicit reopen current resolves latest Build')
  const currentPage = page
    .locator('[data-rt-kind=report]')
    .filter({ hasText: 'current · 当前版本' })
  const currentTab = await currentPage.getAttribute('data-rt-tab')
  await currentPage.getByRole('button', { name: '编辑报告', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '分析快照', exact: true })
  await editor.getByRole('textbox', { name: '报告标题', exact: true }).fill('原生 Tab 保存验收')
  await editor.getByRole('button', { name: '保存编辑', exact: true }).click()
  await editor.getByRole('heading', { name: '原生 Tab 保存验收', exact: true }).waitFor()
  await editor.getByRole('button', { name: '关闭分析快照', exact: true }).click()
  await currentPage.getByRole('button', { name: '查看新版本', exact: true }).waitFor()
  assert.equal(await currentPage.getAttribute('data-rt-build'), updated.receipt.buildId)
  await assertAskIdentity(currentPage, updated.receipt)
  record('Ask DSH on current with a newer-version hint references the displayed old Build')
  await currentPage.getByRole('button', { name: '查看新版本', exact: true }).click()
  await currentPage.getByRole('heading', { name: '原生 Tab 保存验收', exact: true }).waitFor()
  record('editor save updates directory and announces current; reader changes only after refresh')
  const saved = await page.evaluate(
    async ({ workspaceId, reportId }) =>
      (
        await (window as any).__s4Rpc('/marivo-presentation', 'reports/resolve', {
          workspaceId,
          reportId,
        })
      ).value,
    updated.receipt,
  )
  await assertAskIdentity(currentPage, saved)
  record('Ask DSH after current refresh references the new displayed Build')
  await currentPage.getByRole('button', { name: '编辑报告', exact: true }).click()
  await editor.getByRole('textbox', { name: '报告标题', exact: true }).fill('冲突时保留的草稿')
  const savedDocument = JSON.parse(await readFile(saved.files.document.path, 'utf8'))
  const externalEdits = { ...presentationEdits(savedDocument), title: '另一窗口保存' }
  const conflict = await page.evaluate(
    async (payload) => (window as any).__s4Rpc('/marivo-presentation', 'reports/save', payload),
    {
      workspaceId: saved.workspaceId,
      reportId: saved.reportId,
      expectedBuildId: saved.buildId,
      edits: externalEdits,
    },
  )
  assert.equal(conflict.ok, true)
  await editor.getByRole('button', { name: '保存编辑', exact: true }).click()
  await editor
    .getByText('报告已被其他窗口保存。你的编辑已保留，请重新打开报告后再编辑。', { exact: true })
    .waitFor()
  assert.equal(
    await editor.getByRole('textbox', { name: '报告标题', exact: true }).inputValue(),
    '冲突时保留的草稿',
  )
  await editor.getByRole('button', { name: '取消编辑', exact: true }).click()
  await editor.getByRole('button', { name: '关闭分析快照', exact: true }).click()
  record('save conflict preserves draft; cancel returns to original current reader')
  const chart = currentPage.locator('[data-mode=interactive] [data-block-id=bar]')
  await chart.getByRole('button', { name: 'cell 更多操作' }).click()
  await chart.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  const explorer = currentPage.getByRole('region', { name: '探索图表', exact: true })
  await explorer.getByRole('combobox', { name: '图形类型', exact: true }).selectOption('area')
  await explorer.getByRole('button', { name: '关闭探索图表', exact: true }).click()
  await page.evaluate((id) => (window as any).__rtHost.sidebar.float(id), currentTab)
  await currentPage.waitFor()
  await chart.getByRole('button', { name: 'cell 更多操作' }).click()
  await chart.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  assert.equal(
    await explorer.getByRole('combobox', { name: '图形类型', exact: true }).inputValue(),
    'area',
  )
  await explorer.getByRole('button', { name: '关闭探索图表', exact: true }).click()
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
  const fixedDocument = JSON.parse(await readFile(native.receipt.files.document.path, 'utf8'))
  await assertAskIdentity(
    page.locator(`[data-rt-kind=report][data-rt-build="${native.receipt.buildId}"]`).last(),
    native.receipt,
    fixedDocument.blocks[0].id,
  )
  record('Ask DSH on parallel fixed Build keeps its own Workspace, Report, Build and cell identity')
  await page.screenshot({ path: path.join(outputRoot, 'parallel-builds.png'), fullPage: true })
  record('fixed/current parallel panes; chart exploration survives float/dock remount')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.focus(id), currentTab)
  const downloadEvent = page.waitForEvent('download')
  await currentPage.getByRole('button', { name: '导出报告', exact: true }).click()
  await currentPage.getByRole('menuitem', { name: '下载完整报告', exact: true }).click()
  const download = await downloadEvent,
    downloadPath = path.join(outputRoot, 'report.html')
  await download.saveAs(downloadPath)
  assert.deepEqual(await readFile(downloadPath), await readFile(saved.files.html.path))
  const offline = await browser.newContext({ offline: true })
  const portable = await offline.newPage()
  await portable.goto(pathToFileURL(downloadPath).href)
  await portable.getByRole('heading', { name: saved.title, exact: true }).first().waitFor()
  await offline.close()
  record('download matches displayed Build and works offline')
  await assertAskIdentity(currentPage, saved)
  const draftBeforeFailure = await draftSnapshot()
  await page.evaluate(() => (window as any).__askDshProbe.failNext('write'))
  await askCell(currentPage)
  await currentPage.getByRole('status').filter({ hasText: 'Ask DSH validation:' }).waitFor()
  assert.deepEqual(await draftSnapshot(), draftBeforeFailure)
  assert.equal(await currentPage.getAttribute('data-rt-build'), saved.buildId)
  await assertAskIdentity(currentPage, saved)
  assert.equal(
    await currentPage.getByText('Ask DSH validation: draft write failed', { exact: true }).count(),
    0,
  )
  record('Ask DSH write failure preserves the native reader and complete draft; retry appends once')
  record('Ask DSH uses input editing without reference serialization or automatic submission')
  await page.setViewportSize({ width: 430, height: 900 })
  await page.screenshot({ path: path.join(outputRoot, 'narrow-reader.png'), fullPage: true })
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.evaluate(() => (window as any).__rtHost.sidebar.toggleExpanded())
  await page.evaluate(() => (window as any).__rtHost.sidebar.toggleExpanded())
  await currentPage.waitFor()
  await page.waitForFunction(() => {
    const svg = document.querySelector(
      '[data-rt-kind=report] [data-block-id=bar] [data-chart-type] svg',
    )
    const bounds = svg?.getBoundingClientRect()
    return !!bounds && bounds.width > 100 && bounds.height > 100
  })
  const chartMenu = chart.getByRole('button', { name: 'cell 更多操作' })
  await chartMenu.focus()
  await page.keyboard.press('Enter')
  await chart.getByRole('menu', { name: 'cell 操作' }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await chartMenu.evaluate((node) => node === document.activeElement), true)
  record('chart dimensions recover and keyboard menu returns focus after Escape')
  record('narrow fullscreen and collapse/expand preserve the reader')
  const galleryReceipt = server.deliveries[3]!.receipt
  await page.evaluate(
    (receipt) =>
      (window as any).__rightTabs.navigate('right-tabs-native', {
        kind: 'report',
        workspaceId: receipt.workspaceId,
        reportId: receipt.reportId,
        buildId: receipt.buildId,
      }),
    galleryReceipt,
  )
  const gallery = page.locator(`[data-rt-kind=report][data-rt-build="${galleryReceipt.buildId}"]`)
  await gallery.getByRole('button', { name: /展示范围/ }).click()
  await gallery.getByRole('menuitemradio', { name: '第二条观测', exact: true }).click()
  const galleryTab = await gallery.getAttribute('data-rt-tab')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.float(id), galleryTab)
  await gallery.getByRole('button', { name: /展示范围.*第二条观测/ }).waitFor()
  const galleryPane = await gallery.getAttribute('data-rt-panel')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.dock(id), galleryPane)
  await gallery.getByRole('button', { name: /展示范围.*第二条观测/ }).waitFor()
  await page.evaluate((id) => (window as any).__rtHost.sidebar.close(id), galleryTab)
  record('global filter selection survives float/dock with shared reader memory')

  await page.getByRole('button', { name: '打开语义层', exact: true }).click()
  await page.locator('[data-rt-kind=semantic] .sb-objects button').first().waitFor()
  await page.setViewportSize({ width: 600, height: 900 })
  await page.getByRole('combobox', { name: '窄格对象类型', exact: true }).selectOption('metric')
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
    await page.getByRole('combobox', { name: '窄格对象类型', exact: true }).inputValue(),
    'metric',
  )
  await page.screenshot({ path: path.join(outputRoot, 'semantic-directory.png'), fullPage: true })
  await page.getByRole('combobox', { name: '窄格对象类型', exact: true }).selectOption('')
  await page.setViewportSize({ width: 1680, height: 1100 })
  record('semantic narrow-pane filters remain accessible and repeat entry preserves state')
  await page.locator('[data-rt-kind=semantic] .sb-objects button').first().click()
  await page.getByRole('button', { name: '在独立标签页打开', exact: true }).click()
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
  await page.getByRole('button', { name: '关系', exact: true }).click()
  const semanticTab = await page.locator('[data-rt-kind=semantic]').getAttribute('data-rt-tab')
  const semanticRef = await page.locator('[data-rt-kind=semantic] .sb-detail > .sb-ref').innerText()
  const another = page.locator('[data-rt-kind=semantic] .sb-relation-list button:enabled').first()
  await another.click()
  await page.waitForFunction(
    (old) => (window as any).__rtHost.sidebar.active().id !== old,
    semanticTab,
  )
  assert.notEqual(
    await page.locator('[data-rt-kind=semantic] .sb-detail > .sb-ref').innerText(),
    semanticRef,
  )
  await page.evaluate((id) => (window as any).__rtHost.sidebar.focus(id), semanticTab)
  assert.equal(
    await page.locator('[data-rt-kind=semantic] .sb-detail > .sb-ref').innerText(),
    semanticRef,
  )
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  record('semantic resource navigation preserves original reference and returns to directory')
  await page.getByRole('button', { name: '打开数据源', exact: true }).click()
  const datasourceSelect = page.getByRole('combobox', { name: '选择数据源' })
  await datasourceSelect.waitFor()
  const selectedDatasource = await datasourceSelect.locator('option').last().getAttribute('value')
  await datasourceSelect.selectOption(selectedDatasource!)
  await page.getByRole('button', { name: '配置数据源与凭证', exact: true }).click()
  await page.locator('dialog.mc-dialog[open]').waitFor()
  await page.waitForFunction(
    (token) => (window as any).__rightTabs.credentials.getSnapshot().selected === token,
    selectedDatasource,
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => {
    const select = document.querySelector<HTMLSelectElement>('[aria-label="选择数据源"]')
    return select && !select.disabled
  })
  assert.equal(await datasourceSelect.inputValue(), selectedDatasource)
  await page.screenshot({ path: path.join(outputRoot, 'datasource-directory.png'), fullPage: true })
  record('semantic detail opens a resource; datasource uses existing configuration dialog')
  await page.evaluate(() => {
    ;(window as any).__staleReportPage = [...(window as any).__rightTabs.pages.values()].find(
      (p: any) =>
        p.sessionId === 'right-tabs-native' && p.target.kind === 'report' && !p.target.buildId,
    )
  })
  await select('right-tabs-credentials')
  const staleAttempt = await page.evaluate(() => {
    const app = (window as any).__rightTabs,
      host = (window as any).__rtHost
    const before = host.input('right-tabs-credentials').state.getSnapshot().draft
    let rejected = false
    try {
      app.ask((window as any).__staleReportPage, 'stale-report-context')
    } catch {
      rejected = true
    }
    return {
      rejected,
      unchanged: before === host.input('right-tabs-credentials').state.getSnapshot().draft,
    }
  })
  assert.deepEqual(staleAttempt, { rejected: true, unchanged: true })
  record('stale report callback cannot write another Session draft')
  await run('credentials', 'credential-start')
  await page.locator('dialog.mc-dialog[open]').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '等待配置凭证', exact: true }).click()
  const credentialDialog = page.locator('dialog.mc-dialog[open]')
  await credentialDialog.locator('input[type=password]').fill('isolated-prototype-test-value')
  await credentialDialog.getByRole('button', { name: '提交凭证并继续', exact: true }).click()
  await run('credentials', 'credential-idle')
  await page.keyboard.press('Escape')
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
  const ptc = await run('ptc')
  await page.locator(`[data-rt-build="${ptc.receipt.buildId}"]`).waitFor()
  const beforeDuplicate = await opens()
  await run('ptc', 'duplicate')
  await page.waitForTimeout(300)
  assert.equal(await opens(), beforeDuplicate)
  await select('right-tabs-native')
  await page.getByRole('button', { name: '打开报告', exact: true }).first().click()
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
  const backgroundCurrent = page
    .locator('[data-rt-kind=report]')
    .filter({ hasText: 'current · 当前版本' })
  await backgroundCurrent.locator('[data-presentation-reader]').first().waitFor()
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
  assert.equal(await opens(), beforeDuplicate)
  await page.screenshot({
    path: path.join(outputRoot, 'background-current-hint.png'),
    fullPage: true,
  })
  record(
    'background delivery refreshes Workspace catalog and hints current without switching Build or focus',
  )
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
  assert.equal(await opens(), beforeDuplicate)
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
  assert.equal(await opens(), beforeDuplicate)
  record('PTC opens once; duplicate and background delivery do not reopen')
  const fixedPage = page.locator(`[data-rt-kind=report][data-rt-build="${ptc.receipt.buildId}"]`)
  await fixedPage
    .locator('[data-mode=interactive] [data-block-id]')
    .first()
    .getByRole('button', { name: 'cell 更多操作' })
    .click()
  await fixedPage.getByRole('menuitem', { name: '数据源', exact: true }).click()
  const sourceDialog = page.locator('dialog.pr-source-dialog[open]')
  await sourceDialog.locator('.pr-semantic-link').first().click()
  await page.locator('[data-rt-kind=semantic] .sb-detail').waitFor()
  assert.equal(await sourceDialog.count(), 0)
  record('report source reference opens semantic Tab and releases source modal')
  const rejectsUnknown = await page.evaluate(() => {
    try {
      ;(window as any).__rtHost.sidebar.openResource('dsh-resource://marivo-report/malformed')
      return false
    } catch {
      return true
    }
  })
  assert.equal(rejectsUnknown, true)
  const fileLink = page.getByText(/s4-produced-.*\.txt/).first()
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
  await page.waitForFunction(
    () =>
      [...(window as any).__rightTabs.pages.values()].some((p: any) =>
        p.getSnapshot().error?.includes('连接'),
      ),
    {},
    { timeout: 30_000 },
  )
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
  await page
    .locator('[data-rt-kind=report] [data-presentation-reader][data-mode=interactive]')
    .first()
    .waitFor()
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
  await page
    .locator('[data-presentation-card]')
    .first()
    .getByRole('button', { name: '打开分析' })
    .click()
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  await page.getByRole('button', { name: '打开数据源', exact: true }).click()
  await page
    .getByRole('combobox', { name: '选择数据源' })
    .locator('option')
    .first()
    .waitFor({ state: 'attached' })
  await page.getByRole('button', { name: '配置数据源与凭证', exact: true }).click()
  await page.locator('dialog.mc-dialog[open]').waitFor()
  await page.waitForFunction(() => !(window as any).__rightTabs.credentials.getSnapshot().loading)
  const beforeDetachReads = await page.evaluate(() =>
    (window as any).__rtHost.delay.overviewReads(),
  )
  await run('ptc', 'detach')
  await page.evaluate(() => (window as any).__rtHost.delay.release())
  await page.locator('dialog.mc-dialog[open]').waitFor({ state: 'detached' })
  await page.getByText('Workspace 已变化或不可用，请重新打开页面。', { exact: true }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(
    await page.evaluate(() => (window as any).__rtHost.delay.overviewReads()),
    beforeDetachReads,
  )
  assert.equal(await page.getByRole('combobox', { name: '选择数据源' }).count(), 0)
  await page.screenshot({ path: path.join(outputRoot, 'revoked-datasource.png'), fullPage: true })
  record(
    'Workspace revocation closes configuration without re-reading or reviving its datasource Tab',
  )
  assert.equal(await page.locator('[data-rt-kind=report] [data-presentation-reader]').count(), 0)
  assert.equal(
    await page.evaluate(() => {
      const reports = [...(window as any).__rightTabs.pages.values()].filter(
        (p: any) => p.sessionId === 'right-tabs-ptc' && p.target.kind === 'report',
      ) as any[]
      return (
        reports.length > 0 &&
        reports.every((p) => p.getSnapshot().error && !p.reader.getSnapshot().document)
      )
    }),
    true,
  )
  record('Workspace detachment invalidates old reader and actions')
  await page
    .locator('[data-presentation-card]')
    .first()
    .getByRole('button', { name: '打开分析' })
    .click()
  await page
    .getByRole('alert')
    .filter({ hasText: '所属 Session 或 Workspace 已变化' })
    .first()
    .waitFor()
  record('failed opening retains the delivery card with explicit feedback')
  await run('ptc', 'attach')
  await page.evaluate(() => (window as any).__rtHost.delay.arm())
  await page
    .locator('[data-presentation-card]')
    .first()
    .getByRole('button', { name: '打开分析' })
    .click()
  await page.waitForFunction(() => (window as any).__rtHost.delay.held())
  const withoutSession = await page.evaluate((receipt) => {
    const host = (window as any).__rtHost
    host.clear()
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
  await page.getByRole('button', { name: '打开报告', exact: true }).click()
  const fallback = page.locator('dialog.pd-dialog[open]')
  await fallback.locator('.pd-report-title').first().waitFor()
  await fallback.locator('.pd-report-title').first().click()
  await fallback.locator('[data-presentation-reader][data-mode=interactive]').waitFor()
  assert.equal(await page.evaluate(() => (window as any).__rtHost.current()), undefined)
  await page.screenshot({ path: path.join(outputRoot, 'no-session-reader.png'), fullPage: true })
  await fallback.getByRole('button', { name: '关闭分析快照', exact: true }).click()
  record('Workspace reports remain readable without a Session using the retained fallback')
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
          'Real alpha Host, production tools and Runtime; scripted model; packaged default client',
        checks,
        audit,
        beforePaginationAudit,
        afterReloadAudit: await page.evaluate(() => (window as any).__rightTabs.audit),
        workspaceRoot,
        profile: server.profile,
        dshVersion: '0.1.5-alpha.1',
        nodeVersion: process.version,
        browserVersion: browser.version(),
        productionModuleDigests: server.moduleDigests,
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
  await rm(path.join(outputRoot, 'web'), { recursive: true, force: true })
  await rm(workspaceRoot, { recursive: true, force: true })
}
