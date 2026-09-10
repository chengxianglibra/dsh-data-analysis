/** S4 actual production Tool/Host/Web/portable delivery in a disposable private profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from 'playwright'
import {
  cellText,
  columnLabel,
  datasetById,
  metricText,
  selectedSources,
  selectMetric,
  snapshotDate,
} from '../src/client/presentation/model.ts'
import { sourceOverviewFacts } from '../src/client/presentation/source-facts.ts'
import { chartColumns, chartTransition } from '../src/presentation/contracts/charts.ts'
import {
  type PresentationDocument,
  parsePresentationDocument,
} from '../src/presentation/contracts/index.ts'
import type { PresentationBlock, TypedDataset } from '../src/presentation/contracts/types.ts'
import { presentationHtml } from './presentation-html.ts'
import {
  verifyAllChartFilters,
  verifyEditing,
  verifyPreparedFilters,
} from './presentation-s4/editing.ts'
import { validatePresentationHost } from './presentation-s4/host.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'

const arguments_ = process.argv.slice(2)
assert.ok(
  arguments_.length === 0 ||
    (arguments_.length === 2 && ['--resume-web', '--agent'].includes(arguments_[0]!)),
  'Usage: validate-presentation-integration-real.ts [--resume-web /path/to/host-evidence-root | --agent /path/to/agent-evidence.json]',
)
const resume = arguments_[0] === '--resume-web' ? arguments_[1] : undefined
const agentEvidencePath = arguments_[0] === '--agent' ? path.resolve(arguments_[1]!) : undefined
const agentEvidence = agentEvidencePath
  ? JSON.parse(await readFile(agentEvidencePath, 'utf8'))
  : undefined
if (agentEvidence)
  assert.ok(
    ['passed', 'passed-awaiting-semantic-review'].includes(agentEvidence.status),
    'Use successful execution evidence; Web validation does not certify semantic conclusions',
  )
const outputRoot = await realpath(
  resume ?? (await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s4-real-'))),
)
const resumedInputs = resume
  ? JSON.parse(await readFile(path.join(outputRoot, 'runtime-inputs.json'), 'utf8'))
  : undefined
const workspaceRoot =
  agentEvidence?.workspaceRoot ?? resumedInputs?.workspaceRoot ?? path.join(outputRoot, 'workspace')
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    resolveDshHome(),
    'dsh-data-analysis/runtimes/marivo',
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )
await mkdir(workspaceRoot, { recursive: true })
process.stdout.write(`S4 isolated validation: ${outputRoot}\n`)
const inputs: Pick<
  Awaited<ReturnType<typeof preparePresentationInputs>>,
  'binding' | 'draftPaths' | 'generated'
> = resumedInputs ??
(agentEvidence
  ? {
      binding: agentEvidence.binding,
      draftPaths: agentEvidence.draftPaths.map((draft: string) => {
        const relative = path.relative(workspaceRoot, path.resolve(workspaceRoot, draft))
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
        return relative
      }),
      generated: { agentEvidencePath, draftSha256: agentEvidence.draftSha256 },
    }
  : await preparePresentationInputs(workspaceRoot, pythonExecutable))
assert.equal(inputs.binding.pythonExecutable, pythonExecutable)
if (agentEvidence) {
  assert.equal(inputs.draftPaths.length, 1)
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(workspaceRoot, inputs.draftPaths[0]!)))
      .digest('hex'),
    agentEvidence.draftSha256,
    'Real Agent draft changed before Web validation',
  )
}
await writeFile(
  path.join(outputRoot, 'runtime-inputs.json'),
  JSON.stringify({ ...inputs, workspaceRoot }, null, 2),
)
const host: Awaited<ReturnType<typeof validatePresentationHost>> = resume
  ? JSON.parse(await readFile(path.join(outputRoot, 'host-evidence.json'), 'utf8'))
  : await validatePresentationHost(workspaceRoot, outputRoot, pythonExecutable, inputs.draftPaths)
assert.equal(host.status, 'passed')
await writeFile(path.join(outputRoot, 'host-evidence.json'), JSON.stringify(host, null, 2))
process.stdout.write(
  'S4 production Native/both/Code and durable headless checks passed. Starting real DSH Web.\n',
)
const server = await startPresentationWebHost(
  workspaceRoot,
  await mkdtemp(path.join(outputRoot, 'web-attempt-')),
  pythonExecutable,
  inputs.draftPaths,
)
let browser: Browser | undefined, page: Page | undefined
const errors: string[] = []
const checks: Record<string, unknown>[] = []
// Turn 1 has only pre-tool prose: its native closing boundary precedes the
// produced file. The report node must appear even though that tail stays empty.
const expectedProducedRows = Math.max(0, inputs.draftPaths.length - 1)
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function selectedColumns(block: PresentationBlock, data: TypedDataset): string[] {
  return block.kind === 'chart'
    ? chartColumns(block)
    : block.kind === 'metric'
      ? [block.columnId]
      : block.kind === 'table' && block.columns
        ? block.columns
        : data.columns.map((column) => column.id)
}
async function verifyExactTable(
  node: Locator,
  data: TypedDataset,
  columns: string[],
  staticMode: boolean,
) {
  const seen = new Set<number>()
  for (const id of columns)
    assert.equal(await node.locator(`thead [data-column-id="${id}"]`).count(), 1)
  while (true) {
    for (const row of await node.locator('tbody tr').all()) {
      const identity = await row.getAttribute('data-row-index')
      assert.notEqual(identity, null)
      const index = Number(identity)
      assert.ok(Number.isSafeInteger(index) && index >= 0 && index < data.rows.length)
      assert.ok(!seen.has(index), `Snapshot row ${index} appeared twice`)
      seen.add(index)
      for (const id of columns) {
        const field = data.columns.findIndex((column) => column.id === id)
        assert.equal(
          await row.locator(`[data-column-id="${id}"]`).textContent(),
          cellText('zh-CN', data.rows[index]![field]!, data.columns[field]!),
          `Exact preview changed ${id} at saved row ${index}`,
        )
      }
    }
    const next = node.getByRole('button', { name: '下一页', exact: true })
    if (staticMode || !(await next.count()) || (await next.isDisabled())) break
    await next.click()
  }
  assert.equal(
    seen.size,
    data.rows.length,
    'Preview must expose every saved row through pagination',
  )
}
async function verifyReader(target: Page, document: PresentationDocument, staticMode = false) {
  const reader = target.locator(
    `[data-presentation-reader][data-mode="${staticMode ? 'static' : 'interactive'}"]`,
  )
  await reader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  if (staticMode)
    while (await reader.locator('details:not([open])').count())
      await reader.locator('details:not([open])').first().locator(':scope > summary').click()
  for (const block of document.blocks) {
    const node = reader.locator(`[data-block-id="${block.id}"]`)
    await node.waitFor()
    if (block.kind === 'markdown') continue
    const dataset = 'datasetId' in block ? datasetById(document, block.datasetId) : undefined
    const columns = dataset ? selectedColumns(block, dataset.data) : []
    if (block.kind === 'metric' && dataset) {
      const metric = selectMetric('zh-CN', dataset.data, block)
      assert.equal(
        await node.locator('[data-metric-value]').textContent(),
        metricText('zh-CN', metric.value, metric.column),
      )
    }
    if (dataset && (block.kind === 'table' || (block.kind === 'chart' && staticMode)))
      await verifyExactTable(node, dataset.data, columns, staticMode)
    if (staticMode) continue
    await node.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
    await node.getByRole('menuitem', { name: '数据源', exact: true }).click()
    const dialog = reader.getByRole('dialog', { name: '数据源', exact: true })
    await dialog.waitFor()
    const overview = dialog.locator('.pr-source-overview')
    if (dataset) {
      assert.ok((await overview.innerText()).includes(dataset.id))
      assert.deepEqual(
        await overview.locator('.pr-source-fields li').allTextContents(),
        columns.map((id) => columnLabel(dataset.data.columns.find((column) => column.id === id)!)),
      )
    }
    const sources = selectedSources(
      document,
      block.kind === 'source' ? block.sourceIds : dataset!.sourceIds,
    )
    for (const source of sources) {
      const card = overview.locator(`[data-source-id="${source.id}"]`)
      if (source.status === 'unavailable') {
        assert.ok((await card.innerText()).includes(source.reason))
        continue
      }
      const facts = sourceOverviewFacts(source)
      const labels = [
        ...facts.semanticGroups.flatMap((group) => group.paths),
        ...facts.issues.map((issue) => issue.kind),
        ...facts.notices,
        ...(facts.createdAt
          ? [
              Number.isNaN(Date.parse(facts.createdAt))
                ? facts.createdAt
                : snapshotDate('zh-CN', facts.createdAt),
            ]
          : []),
      ]
      if (labels.length) {
        const visible = await card.innerText()
        for (const label of labels)
          assert.ok(visible.includes(label), `Missing saved source fact ${label}`)
      }
    }
    if (dataset) {
      await dialog.getByRole('tab', { name: '数据预览', exact: true }).click()
      await verifyExactTable(
        dialog.getByRole('tabpanel', { name: '数据预览', exact: true }),
        dataset.data,
        columns,
        false,
      )
    }
    await dialog.getByRole('button', { name: '关闭数据源', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
  }
  if (staticMode)
    for (const source of document.sources)
      if (source.status === 'unavailable')
        assert.ok((await reader.innerText()).includes(source.reason))
  if (!document.datasets.length) assert.equal(await reader.locator('table').count(), 0)
}
async function openFirstOrdinaryChart(target: Page, document: PresentationDocument) {
  const block = document.blocks.find(
    (entry) => entry.kind === 'chart' && (entry.chart === 'line' || entry.chart === 'bar'),
  )
  if (block?.kind !== 'chart') return undefined
  const cell = target.locator(
    `[data-presentation-reader][data-mode="interactive"] [data-block-id="${block.id}"]`,
  )
  await cell.getByRole('button', { name: 'cell 更多操作', exact: true }).click()
  await cell.getByRole('menuitem', { name: '探索图表', exact: true }).click()
  const panel = cell.getByRole('region', { name: '探索图表', exact: true })
  await panel.waitFor()
  return { block, cell, panel }
}
async function exploreReader(target: Page, document: PresentationDocument) {
  const selected = await openFirstOrdinaryChart(target, document)
  if (!selected) return { skipped: 'No authored line/bar chart in this document' }
  const { block, cell, panel } = selected
  const type = block.chart === 'line' ? 'bar' : 'line'
  assert.ok(chartTransition(block, type, datasetById(document, block.datasetId).data))
  const picker = panel.getByRole('combobox', { name: '图形类型', exact: true })
  assert.equal(await picker.inputValue(), block.chart)
  await picker.selectOption(type)
  assert.equal(await picker.inputValue(), type)
  const retained = panel.getByRole('listbox', { name: '保留分类值', exact: true })
  let filter: { column: string; value: string } | undefined
  if ((await retained.count()) && (await retained.locator('option').count())) {
    const value = (await retained.locator('option').first().getAttribute('value'))!
    const column = await panel.getByRole('combobox', { name: '过滤字段', exact: true }).inputValue()
    await retained.selectOption(value)
    assert.deepEqual(
      await retained.evaluate((node: HTMLSelectElement) =>
        [...node.selectedOptions].map((option) => option.value),
      ),
      [value],
    )
    filter = { column, value }
  }
  if (await cell.locator('[data-chart-type]').count())
    assert.equal(
      await cell.locator('[data-chart-type]').first().getAttribute('data-chart-type'),
      type,
    )
  return {
    cellId: block.id,
    originalType: block.chart,
    exploredType: type,
    filter,
    pageLocalOnly: true,
  }
}
async function verifyReopenedChart(target: Page, document: PresentationDocument) {
  const selected = await openFirstOrdinaryChart(target, document)
  if (!selected) return false
  const { block, panel } = selected
  assert.equal(
    await panel.getByRole('combobox', { name: '图形类型', exact: true }).inputValue(),
    block.chart,
  )
  assert.equal(
    await panel.getByRole('combobox', { name: 'X 字段', exact: true }).inputValue(),
    block.x,
  )
  for (const input of await panel.locator('.pr-explorer-visible input').all())
    assert.ok(await input.isChecked())
  const retained = panel.getByRole('listbox', { name: '保留分类值', exact: true })
  if (await retained.count())
    assert.equal(
      await retained.evaluate((node: HTMLSelectElement) => node.selectedOptions.length),
      await retained.locator('option').count(),
    )
  await panel.getByRole('button', { name: '关闭探索图表', exact: true }).click()
  return true
}
async function rpc(channel: string, endpoint: string, payload: unknown) {
  return page!.evaluate(
    async ({ channel, endpoint, payload }) => {
      const test = window as unknown as {
        __s4Rpc: (channel: string, endpoint: string, payload: unknown) => Promise<any>
      }
      return test.__s4Rpc(channel, endpoint, payload)
    },
    { channel, endpoint, payload },
  )
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  })
  page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const modelNotice = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await modelNotice.isVisible()) await modelNotice.click()
  await writeFile(path.join(outputRoot, 'initial-dom.txt'), await page.locator('body').innerText())
  await page.screenshot({ path: path.join(outputRoot, 'initial.png') })
  await page.getByText('S4 production Tool delivery', { exact: true }).first().click()
  await page.locator('[data-presentation-card]').first().waitFor({ timeout: 45_000 })
  assert.equal(await page.locator('[data-presentation-card]').count(), inputs.draftPaths.length)
  const producedFiles = page.locator('[data-produced-files-row]')
  assert.equal(await producedFiles.count(), expectedProducedRows)
  assert.ok((await producedFiles.allTextContents()).every((text) => text.includes('s4-produced-')))
  await page.setViewportSize({ width: 1440, height: 1800 })
  await page.locator('[data-presentation-card]').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(outputRoot, 'cards-overview.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  const boot = await page.evaluate(() => {
    const value = window as unknown as {
      __DSH_BOOT__?: unknown
      __ModuleLoader__?: { mode: string }
    }
    return { boot: value.__DSH_BOOT__, loaderMode: value.__ModuleLoader__?.mode }
  })
  assert.equal(boot.loaderMode, 'live')
  assert.ok(JSON.stringify(boot.boot).includes('dsh-presentation-s4'))
  for (const [index, delivery] of server.deliveries.entries()) {
    const receipt = delivery.receipt
    const document = parsePresentationDocument(
      JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
    )
    const originalHtml = await presentationHtml(receipt)
    assert.equal(receipt.files.html, undefined)
    const card = page.locator(`[data-presentation-card="${receipt.buildId}"]`)
    await card.getByRole('button', { name: '打开分析', exact: true }).click()
    const overlay = page.getByRole('dialog', { name: '分析快照', exact: true })
    await verifyReader(page, document)
    await overlay.evaluate((element) => element.scrollTo({ top: 0 }))
    await overlay.screenshot({ path: path.join(outputRoot, `${index}-web.png`) })
    const hostExploration = await exploreReader(page, document)
    const allChartFilters =
      !agentEvidence && index === 3 ? await verifyAllChartFilters(page, document) : undefined
    await overlay.screenshot({ path: path.join(outputRoot, `${index}-web-explored.png`) })
    await overlay.getByRole('button', { name: '关闭分析快照', exact: true }).click()
    await overlay.waitFor({ state: 'detached' })
    const waitDownload = page.waitForEvent('download')
    await card.getByRole('button', { name: '下载 HTML', exact: true }).click()
    const download = await waitDownload
    const downloadPath = path.join(outputRoot, `${index}-${download.suggestedFilename()}`)
    await download.saveAs(downloadPath)
    const downloadedHtml = await readFile(downloadPath)
    assert.equal(sha256(downloadedHtml), sha256(originalHtml))
    assert.ok(downloadedHtml.equals(originalHtml), 'Exploration changed downloaded HTML bytes')
    await card.getByRole('button', { name: '打开分析', exact: true }).click()
    await verifyReader(page, document)
    const reopenedAuthorConfiguration = await verifyReopenedChart(page, document)
    await overlay.getByRole('button', { name: '关闭分析快照', exact: true }).click()
    await overlay.waitFor({ state: 'detached' })
    const offline: BrowserContext = await browser.newContext({
      offline: true,
      viewport: { width: 1200, height: 1000 },
    })
    const offlinePage: Page = await offline.newPage()
    const network: string[] = []
    offlinePage.on('request', (request) => {
      if (!request.url().startsWith('file:')) network.push(request.url())
    })
    await offlinePage.goto(pathToFileURL(downloadPath).href)
    await verifyReader(offlinePage, document)
    const portableExploration = await exploreReader(offlinePage, document)
    const portableAllChartFilters =
      !agentEvidence && index === 3 ? await verifyAllChartFilters(offlinePage, document) : undefined
    assert.deepEqual(
      JSON.parse((await offlinePage.locator('#presentation-data').textContent())!),
      document,
    )
    assert.deepEqual(network, [])
    await offlinePage.screenshot({
      path: path.join(outputRoot, `${index}-offline.png`),
      fullPage: true,
    })
    await offlinePage.reload()
    await verifyReader(offlinePage, document)
    const portableReopenedAuthorConfiguration = await verifyReopenedChart(offlinePage, document)
    assert.deepEqual(network, [])
    assert.ok((await readFile(downloadPath)).equals(originalHtml))
    await offline.close()
    const noScript = await browser.newContext({ offline: true, javaScriptEnabled: false })
    const noScriptPage = await noScript.newPage()
    await noScriptPage.goto(pathToFileURL(downloadPath).href)
    await verifyReader(noScriptPage, document, true)
    await noScript.close()
    checks.push({
      title: document.title,
      buildId: receipt.buildId,
      actualTool: true,
      actualWebCard: true,
      open: true,
      downloadSha256: sha256(originalHtml),
      downloadedAfterReaderClosed: true,
      originalHtmlBytesRetained: true,
      hostExploration,
      allChartFilters,
      portableAllChartFilters,
      reopenedAuthorConfiguration,
      portableExploration,
      portableReopenedAuthorConfiguration,
      offlineNetworkRequests: 0,
      noScript: true,
    })
  }
  if (!agentEvidence) checks.push(await verifyPreparedFilters(page, server.deliveries[3]!))
  if (!agentEvidence)
    checks.push(
      await verifyEditing(
        page,
        browser,
        server.deliveries[1]!,
        server.durableSessionId!,
        outputRoot,
        server.processAuditPath,
      ),
    )
  const receipt = server.deliveries[0]!.receipt
  const payload = { sessionId: server.sessionId, receipt, asset: 'presentation.json' }
  const read = await rpc('/marivo-presentation', 'files/read', payload)
  assert.equal(read.ok, true)
  const tampered = structuredClone(payload)
  tampered.receipt.files.document.sha256 = '0'.repeat(64)
  const digest = await rpc('/marivo-presentation', 'files/read', tampered)
  assert.equal(digest.ok, false)
  assert.equal(digest.error.message, 'asset-digest-mismatch')
  const savedDocument = await readFile(receipt.files.document.path)
  let changedBytes: { ok: boolean; error: { message: string } } | undefined
  try {
    await writeFile(receipt.files.document.path, Buffer.concat([savedDocument, Buffer.from('\n')]))
    changedBytes = await rpc('/marivo-presentation', 'files/read', payload)
    assert.ok(changedBytes)
    assert.equal(changedBytes.ok, false)
    assert.equal(changedBytes.error.message, 'asset-digest-mismatch')
  } finally {
    await writeFile(receipt.files.document.path, savedDocument)
  }
  assert.ok(changedBytes)
  await rpc('/presentation-s4-validation', 'detach', {})
  const workspace = await rpc('/marivo-presentation', 'files/read', payload)
  assert.equal(workspace.ok, false)
  assert.equal(workspace.error.message, 'workspace-unavailable')
  await rpc('/presentation-s4-validation', 'attach', {})
  assert.equal((await rpc('/marivo-presentation', 'files/read', payload)).ok, true)
  assert.equal(server.duplicatedCodeReceiptEvents, 1)
  await page.reload()
  await page.locator('[data-presentation-card]').first().waitFor({ timeout: 30_000 })
  assert.equal(await page.locator('[data-presentation-card]').count(), inputs.draftPaths.length)
  checks.push({
    digestMismatch: digest.error.message,
    changedDocumentBytesRejected: changedBytes.error.message,
    workspaceDetachRejected: workspace.error.message,
    reattachRestoresAccess: true,
    duplicatePersistedEventCards: inputs.draftPaths.length,
    coexistingProducedFilesRows: await page.locator('[data-produced-files-row]').count(),
    reconnect: true,
  })
  const reversed = await startPresentationWebHost(
    workspaceRoot,
    await mkdtemp(path.join(outputRoot, 'web-reversed-')),
    pythonExecutable,
    inputs.draftPaths,
    'report-first',
  )
  try {
    const reversedContext = await browser.newContext()
    const reversedPage = await reversedContext.newPage()
    await reversedPage.goto(reversed.url)
    await reversedPage.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
    await reversedPage.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
    const notice = reversedPage.getByRole('button', { name: '稍后配置', exact: true })
    if (await notice.isVisible()) await notice.click()
    await reversedPage.getByText('S4 production Tool delivery', { exact: true }).first().click()
    await reversedPage.locator('[data-presentation-card]').first().waitFor({ timeout: 45_000 })
    assert.equal(
      await reversedPage.locator('[data-presentation-card]').count(),
      inputs.draftPaths.length,
    )
    assert.equal(
      await reversedPage.locator('[data-produced-files-row]').count(),
      expectedProducedRows,
    )
    if (!agentEvidence) {
      const previous = server.deliveries[1]!.receipt
      const resolved = await reversedPage.evaluate(
        ({ sessionId, reportId }) =>
          (window as any).__s4Rpc('/marivo-presentation', 'reports/resolve', {
            sessionId,
            reportId,
          }),
        { sessionId: reversed.sessionId, reportId: previous.reportId },
      )
      assert.equal(resolved.ok, false)
      checks.push({ samePathDifferentWorkspaceCannotResolveSavedReport: true })
    }
    assert.equal(await reversedPage.evaluate(() => (window as any).__s4ClientOrder), 'report-first')
    await reversedPage.screenshot({
      path: path.join(outputRoot, 'reversed-client-order.png'),
      fullPage: true,
    })
    checks.push({
      clientOrder: reversed.clientOrder,
      reportCards: inputs.draftPaths.length,
      producedFilesRows: expectedProducedRows,
    })
    await reversedContext.close()
  } finally {
    await reversed.stop()
  }
  if (!agentEvidence) {
    const eventsBeforeRestart = await rpc('/presentation-s4-validation', 'events', {})
    assert.equal(eventsBeforeRestart.ok, true)
    assert.ok(eventsBeforeRestart.value.length > 0)
    const restarted = await server.restart()
    assert.notEqual(restarted.pid, server.pid)
    assert.equal(restarted.workspaceId, server.workspaceId)
    const restartContext = await browser.newContext()
    const restartPage = await restartContext.newPage()
    await restartPage.goto(restarted.url)
    await restartPage
      .getByText('S4 production Tool delivery', { exact: true })
      .first()
      .waitFor({ timeout: 45_000 })
    const notice = restartPage.getByRole('button', { name: '稍后配置', exact: true })
    if (await notice.isVisible()) await notice.click()
    await restartPage.getByText('S4 production Tool delivery', { exact: true }).first().click()
    const card = restartPage.locator(
      `[data-presentation-card="${server.deliveries[1]!.receipt.buildId}"]`,
    )
    await card
      .getByRole('heading', { name: '另一个窗口的保存', exact: true })
      .waitFor({ timeout: 30_000 })
    assert.equal(
      await restartPage.locator('[data-presentation-card]').count(),
      inputs.draftPaths.length,
    )
    await card.getByRole('button', { name: '打开分析', exact: true }).click()
    await restartPage
      .locator('[data-mode="interactive"]')
      .getByText('这份报告尚无 cell。数据与来源仍保留。', { exact: true })
      .waitFor()
    await restartPage.screenshot({
      path: path.join(outputRoot, 'editing-restarted-original-card.png'),
    })
    const eventsAfterRestart = await restartPage.evaluate(() =>
      (window as any).__s4Rpc('/presentation-s4-validation', 'events', {}),
    )
    assert.deepEqual(eventsAfterRestart, eventsBeforeRestart)
    checks.push({
      sameProfileRestart: true,
      originalCardOpensLatestAfterRestart: true,
      cardCount: inputs.draftPaths.length,
      workspaceIdentityPreserved: true,
      noNewAgentEvents: true,
    })
    await restartContext.close()
  }
  assert.deepEqual(errors, [])
  const evidence = {
    status: 'passed',
    outputRoot,
    workspaceRoot,
    binding: inputs.binding,
    generated: inputs.generated,
    host,
    web: {
      mode: server.mode,
      sessionId: server.sessionId,
      workspaceId: server.workspaceId,
      durableSessionId: server.durableSessionId,
      codeDispatches: server.codeDispatches,
      duplicatedCodeReceiptEvents: server.duplicatedCodeReceiptEvents,
      firstTurnHasNoPostToolAssistantText: server.firstTurnHasNoPostToolAssistantText,
      browser: browser.version(),
      boot,
      checks,
      pageErrors: errors,
      moduleDigests: server.moduleDigests,
    },
    userProfileOrCredentialsModified: false,
    validationProfile: server.profile,
    excluded: [
      'This runner uses scripted model dispatch; real-model routing has separate evidence',
    ],
    boundary:
      'production plugin Tool/receipt/RPC/client on installed Harness with deterministic model adapter; isolated DSH Web CLI and actual downloaded portable bytes',
  }
  await writeFile(
    path.join(outputRoot, 'integration-evidence.json'),
    JSON.stringify(evidence, null, 2),
  )
  process.stdout.write(
    JSON.stringify(
      {
        status: 'passed',
        outputRoot,
        evidencePath: path.join(outputRoot, 'integration-evidence.json'),
        checks,
      },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  await writeFile(path.join(outputRoot, 'web-failure.txt'), String(error))
  if (page) {
    await page.screenshot({ path: path.join(outputRoot, 'failure.png') })
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await page.locator('body').innerText(),
    )
  }
  throw error
} finally {
  await browser?.close()
  await server.stop()
}
