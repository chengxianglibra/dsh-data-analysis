/** S4 actual production Tool/Host/Web delivery in a disposable private profile. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, chromium, type Page } from 'playwright'
import { readReceiptDocument } from '../src/presentation/reports.ts'
import { validatePresentationHost } from './presentation-s4/host.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'
import { analysisSurface, closeReport, openReport } from './right-tabs/browser.ts'

const arguments_ = process.argv.slice(2)
assert.ok(
  arguments_.length === 0 || (arguments_.length === 2 && arguments_[0] === '--resume-web'),
  'Usage: validate-presentation-integration-real.ts [--resume-web /path/to/host-evidence-root]',
)
const resume = arguments_[0] === '--resume-web' ? arguments_[1] : undefined
const outputRoot = await realpath(
  resume ?? (await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s4-real-'))),
)
const resumedInputs = resume
  ? JSON.parse(await readFile(path.join(outputRoot, 'runtime-inputs.json'), 'utf8'))
  : undefined
const workspaceRoot = resumedInputs?.workspaceRoot ?? path.join(outputRoot, 'workspace')
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
  'binding' | 'requests' | 'generated'
> = resumedInputs ?? (await preparePresentationInputs(workspaceRoot, pythonExecutable))
assert.equal(inputs.binding.pythonExecutable, pythonExecutable)
await writeFile(
  path.join(outputRoot, 'runtime-inputs.json'),
  JSON.stringify({ ...inputs, workspaceRoot }, null, 2),
)
const host: Awaited<ReturnType<typeof validatePresentationHost>> = resume
  ? JSON.parse(await readFile(path.join(outputRoot, 'host-evidence.json'), 'utf8'))
  : await validatePresentationHost(workspaceRoot, outputRoot, pythonExecutable, inputs.requests)
assert.equal(host.status, 'passed')
await writeFile(path.join(outputRoot, 'host-evidence.json'), JSON.stringify(host, null, 2))
process.stdout.write(
  'S4 production Native/both/Code and durable headless checks passed. Starting real DSH Web.\n',
)
const server = await startPresentationWebHost(
  workspaceRoot,
  await mkdtemp(path.join(outputRoot, 'web-attempt-')),
  pythonExecutable,
  inputs.requests,
  'native-first',
  { rightTabsAcceptance: true },
)
let browser: Browser | undefined, page: Page | undefined
const errors: string[] = []
const checks: Record<string, unknown>[] = []
// Turn 1 has only pre-tool prose: its native closing boundary precedes the
// produced file. Later closing prose names its actual produced file, allowing
// the Harness inline file-mention service to expose its native preview.
const expectedProducedMentions = Math.max(0, inputs.requests.length - 1)
async function verifyProducedMentions(target: Page, openPreview = false) {
  const mentions = target.locator('code button').filter({ hasText: /^s4-produced-.*\.txt$/ })
  await target.waitForFunction(
    (expected) =>
      [...document.querySelectorAll('code button')].filter((button) =>
        /^s4-produced-.*\.txt$/.test(button.textContent?.trim() ?? ''),
      ).length === expected,
    expectedProducedMentions,
  )
  const names = await mentions.allTextContents()
  assert.equal(names.length, expectedProducedMentions)
  for (const [index, name] of names.entries()) {
    assert.match(name, new RegExp(`^s4-produced-[a-f0-9-]+-${index + 1}\\.txt$`))
    assert.ok((await mentions.nth(index).getAttribute('title'))?.endsWith(name))
    assert.equal(
      await readFile(path.join(workspaceRoot, name), 'utf8'),
      'Ordinary Harness produced file before report delivery.\n',
    )
  }
  if (openPreview && names.length > 0) {
    await mentions.last().click()
    await target
      .locator('[data-rightbar-col] [data-document-preview]')
      .getByText('Ordinary Harness produced file before report delivery.', { exact: true })
      .waitFor()
  }
  return names
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
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
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  const producedFiles = await verifyProducedMentions(page, true)
  await page.setViewportSize({ width: 1440, height: 1800 })
  await page.screenshot({
    path: path.join(outputRoot, 'conversation-overview.png'),
    fullPage: true,
  })
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
    assert.deepEqual(
      Object.keys(receipt.files),
      ['document'],
      'Saved Builds contain only presentation.json',
    )
    const document = await readReceiptDocument(workspaceRoot, receipt)
    const report = await openReport(page, delivery.dshSessionId, {
      workspaceId: receipt.workspaceId,
      reportId: receipt.reportId,
      buildId: receipt.buildId,
    })
    const surface = analysisSurface(report)
    assert.equal(await surface.getAttribute('data-analysis-record'), document.recordId)
    await surface.getByRole('heading', { name: document.title, exact: true }).waitFor()
    const resources = Object.keys(document.resources).sort()
    assert.deepEqual(
      (
        await surface
          .locator('[data-resource]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-resource')))
      ).sort(),
      resources,
    )
    await report.evaluate((element) => element.scrollTo({ top: 0 }))
    await report.screenshot({ path: path.join(outputRoot, `${index}-web.png`) })
    await closeReport(page, report)
    checks.push({
      title: document.title,
      buildId: receipt.buildId,
      recordId: document.recordId,
      actualTool: true,
      jsonOnlyBuild: true,
      resources,
    })
  }
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
  await page.getByText('S4 production Tool delivery', { exact: true }).first().click()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  const reconnectedFiles = await verifyProducedMentions(page, true)
  assert.deepEqual(reconnectedFiles, producedFiles)
  checks.push({
    digestMismatch: digest.error.message,
    changedDocumentBytesRejected: changedBytes.error.message,
    workspaceDetachRejected: workspace.error.message,
    reattachRestoresAccess: true,
    replayedDeliveriesDoNotCreateCards: true,
    coexistingProducedFileMentions: reconnectedFiles,
    producedFilePreviewOpened: true,
    reconnect: true,
  })
  const reversed = await startPresentationWebHost(
    workspaceRoot,
    await mkdtemp(path.join(outputRoot, 'web-reversed-')),
    pythonExecutable,
    inputs.requests,
    'report-first',
    { rightTabsAcceptance: true },
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
    await reversedPage.waitForFunction(() => !!(window as any).__rightTabs)
    assert.equal(await reversedPage.locator('[data-presentation-card]').count(), 0)
    const reversedFiles = await verifyProducedMentions(reversedPage, true)
    {
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
      reports: inputs.requests.length,
      producedFileMentions: reversedFiles,
      producedFilePreviewOpened: true,
    })
    await reversedContext.close()
  } finally {
    await reversed.stop()
  }
  {
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
    await restartPage.waitForFunction(() => !!(window as any).__rightTabs)
    const latest = server.deliveries.at(-1)!.receipt
    const restartedReport = await openReport(restartPage, server.sessionId, {
      workspaceId: server.workspaceId,
      reportId: latest.reportId,
    })
    assert.equal(await restartPage.locator('[data-presentation-card]').count(), 0)
    assert.equal(await restartedReport.getAttribute('data-rt-build'), latest.buildId)
    await analysisSurface(restartedReport)
      .getByRole('heading', { name: latest.title, exact: true })
      .waitFor()
    await restartPage.screenshot({
      path: path.join(outputRoot, 'restarted-current-tab.png'),
    })
    const eventsAfterRestart = await restartPage.evaluate(() =>
      (window as any).__s4Rpc('/presentation-s4-validation', 'events', {}),
    )
    assert.deepEqual(eventsAfterRestart, eventsBeforeRestart)
    checks.push({
      sameProfileRestart: true,
      nativeCurrentOpensLatestAfterRestart: true,
      chatCards: 0,
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
      'production plugin Tool/receipt/RPC/client on installed Harness with deterministic model adapter; isolated DSH Web CLI',
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
