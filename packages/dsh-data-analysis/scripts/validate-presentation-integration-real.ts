/** S4 actual production Tool/Host/Web/portable delivery in a disposable private profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'
import {
  formatCell,
  type PresentationDocument,
  parsePresentationDocument,
} from '../src/presentation/contracts/index.ts'
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
if (agentEvidence) assert.equal(agentEvidence.status, 'passed')
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
      draftPaths: agentEvidence.draftPaths,
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
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function verifyReader(target: Page, document: PresentationDocument, staticMode = false) {
  const reader = target.locator(
    `[data-presentation-reader][data-mode="${staticMode ? 'static' : 'interactive'}"]`,
  )
  await reader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  while (await reader.locator('details:not([open])').count())
    await reader.locator('details:not([open])').first().locator(':scope > summary').click()
  const text = await reader.innerText()
  for (const dataset of document.datasets)
    for (const row of dataset.data.rows)
      for (const [index, cell] of row.entries())
        assert.ok(
          text.includes(formatCell(cell, dataset.data.columns[index]!)),
          `Missing cell ${String(cell)}`,
        )
  for (const source of document.sources) {
    assert.ok(text.includes(source.ref.artifactRef))
    if (source.status === 'unavailable') assert.ok(text.includes(source.reason))
  }
  if (!document.datasets.length) assert.equal(await reader.locator('table').count(), 0)
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
    const card = page.locator(`[data-presentation-card="${receipt.buildId}"]`)
    await card.getByRole('button', { name: '打开分析', exact: true }).click()
    const overlay = page.getByRole('dialog', { name: '分析快照', exact: true })
    await verifyReader(page, document)
    await overlay.evaluate((element) => element.scrollTo({ top: 0 }))
    await overlay.screenshot({ path: path.join(outputRoot, `${index}-web.png`) })
    const waitDownload = page.waitForEvent('download')
    await overlay.getByRole('button', { name: '下载 HTML', exact: true }).click()
    const download = await waitDownload
    const downloadPath = path.join(outputRoot, `${index}-${download.suggestedFilename()}`)
    await download.saveAs(downloadPath)
    assert.equal(sha256(await readFile(downloadPath)), receipt.files.html.sha256)
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
    assert.deepEqual(
      JSON.parse((await offlinePage.locator('#presentation-data').textContent())!),
      document,
    )
    assert.deepEqual(network, [])
    await offlinePage.screenshot({
      path: path.join(outputRoot, `${index}-offline.png`),
      fullPage: true,
    })
    await offline.close()
    const noScript = await browser.newContext({ offline: true, javaScriptEnabled: false })
    const noScriptPage = await noScript.newPage()
    await noScriptPage.goto(pathToFileURL(downloadPath).href)
    await verifyReader(noScriptPage, document, true)
    await noScript.close()
    await overlay.getByRole('button', { name: '关闭分析快照', exact: true }).click()
    checks.push({
      title: document.title,
      buildId: receipt.buildId,
      actualTool: true,
      actualWebCard: true,
      open: true,
      downloadSha256: receipt.files.html.sha256,
      offlineNetworkRequests: 0,
      noScript: true,
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
  await page.locator('[data-presentation-card]').first().waitFor({ timeout: 30_000 })
  assert.equal(await page.locator('[data-presentation-card]').count(), inputs.draftPaths.length)
  checks.push({
    digestMismatch: digest.error.message,
    changedDocumentBytesRejected: changedBytes.error.message,
    workspaceDetachRejected: workspace.error.message,
    reattachRestoresAccess: true,
    duplicatePersistedEventCards: inputs.draftPaths.length,
    reconnect: true,
  })
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
      durablePath: server.durablePath,
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
