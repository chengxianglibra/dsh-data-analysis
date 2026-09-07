import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright'
import { formatCell, parsePresentationDocument } from '../../src/presentation/contracts/index.ts'
import type { PresentationDocument } from '../../src/presentation/contracts/types.ts'
import { buildS0Artifacts } from './build.ts'
import { sha256 } from './files.ts'
import { validateS0Host } from './host.ts'
import { prepareS0WebHost } from './web-host.ts'

const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s0-web-'))
const workspaceRoot = path.join(outputRoot, 'workspace')
await mkdir(workspaceRoot)
const fixtureNames = ['artifact', 'computed', 'source-only']
const documents = await Promise.all(
  fixtureNames.map(async (name) =>
    parsePresentationDocument(
      JSON.parse(
        await readFile(
          new URL(`../../tests/presentation-s0/fixtures/${name}.document.json`, import.meta.url),
          'utf8',
        ),
      ),
    ),
  ),
)
const host = await prepareS0WebHost(workspaceRoot, outputRoot)
for (const document of documents) document.workspaceId = host.workspaceId
const built = await buildS0Artifacts(host.workspaceRoot, documents)
await writeFile(path.join(outputRoot, 'receipts.json'), JSON.stringify(built.receipts, null, 2))
await writeFile(
  path.join(outputRoot, 'bundle-evidence.json'),
  JSON.stringify(
    {
      hostBytes: built.hostBytes,
      portableBytes: built.portableBytes,
      host: built.hostMetafile,
      portable: built.portableMetafile,
    },
    null,
    2,
  ),
)
const dispatch = await validateS0Host(
  built.receipts[0]!,
  workspaceRoot,
  path.join(outputRoot, 'dispatch'),
)
await writeFile(path.join(outputRoot, 'host-evidence.json'), JSON.stringify(dispatch, null, 2))
const server = await host.start(built.client)
let browser: Browser | undefined
let webPage: Page | undefined
const errors: string[] = []
const checks: Record<string, unknown>[] = []

async function verifyData(page: Page, document: PresentationDocument, fallback = false) {
  const reader = page.locator(fallback ? '#fallback' : '.presentation-s0').last()
  await reader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  const text = await reader.innerText()
  for (const dataset of document.datasets) {
    for (const row of dataset.data.rows) {
      for (const [index, cell] of row.entries())
        assert.ok(
          text.includes(formatCell(cell, dataset.data.columns[index]!)),
          `Missing exact cell ${String(cell)}`,
        )
    }
  }
  for (const source of document.sources) {
    assert.ok(text.includes(source.ref.artifactRef))
    if (source.ref.findingId) assert.ok(text.includes(source.ref.findingId))
    if (source.status === 'unavailable') assert.ok(text.includes(source.reason))
  }
  for (const block of document.blocks) {
    if (block.kind !== 'metric') continue
    assert.ok(text.includes(block.label))
    const data = document.datasets.find((dataset) => dataset.id === block.datasetId)!.data
    const column = data.columns.find((column) => column.id === block.columnId)!
    if (column.unit) assert.ok(text.includes(column.unit))
  }
  if (!document.datasets.length) assert.equal(await reader.locator('table').count(), 0)
  if (!fallback) {
    for (const chart of document.blocks.filter((block) => block.kind === 'chart')) {
      await reader
        .getByRole('region', { name: `${chart.chart} 图形` })
        .locator('svg.recharts-surface')
        .waitFor()
    }
  }
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  })
  const page = await context.newPage()
  webPage = page
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api')) requests.push(request.url())
  })
  await page.goto(server.url)
  await page.getByRole('button', { name: '打开 S0 验证', exact: true }).waitFor({ timeout: 45000 })
  await page.screenshot({ path: path.join(outputRoot, 'initial.png') })
  await writeFile(path.join(outputRoot, 'initial-dom.txt'), await page.locator('body').innerText())
  process.stdout.write(`S0 Web ready: ${outputRoot}\n`)
  // A fresh isolated browser always gets DSH's asynchronously mounted preview notice.
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 15000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.screenshot({ path: path.join(outputRoot, 'after-notice.png') })
  await writeFile(
    path.join(outputRoot, 'after-notice-dom.txt'),
    await page.locator('body').innerText(),
  )
  await page.getByRole('button', { name: '打开 S0 验证', exact: true }).click()
  const reactVersion = await page.locator('[data-host-react]').getAttribute('data-host-react')
  assert.equal(reactVersion, '18.3.1')
  const boot = await page.evaluate(() => {
    const value = window as unknown as {
      __DSH_BOOT__?: unknown
      __ModuleLoader__?: { mode: string }
    }
    return { boot: value.__DSH_BOOT__, loaderMode: value.__ModuleLoader__?.mode }
  })
  assert.equal(boot.loaderMode, 'live')
  assert.ok(JSON.stringify(boot.boot).includes('dsh-presentation-s0'))
  for (const [index, document] of documents.entries()) {
    const receipt = built.receipts[index]!
    await page.getByRole('button', { name: document.title, exact: true }).click()
    await verifyData(page, document)
    await page
      .getByRole('dialog')
      .screenshot({ path: path.join(outputRoot, `${fixtureNames[index]}-web.png`) })
    const downloadWait = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 HTML', exact: true }).click()
    const download = await downloadWait
    const downloadedPath = path.join(outputRoot, download.suggestedFilename())
    await download.saveAs(downloadedPath)
    assert.equal(sha256(await readFile(downloadedPath)), receipt.files.html.sha256)

    const offline = await browser.newContext({
      offline: true,
      viewport: { width: 1100, height: 1000 },
    })
    const offlinePage = await offline.newPage()
    const network: string[] = []
    offlinePage.on('request', (request) => {
      if (!request.url().startsWith('file:')) network.push(request.url())
    })
    offlinePage.on('pageerror', (error) => errors.push(error.message))
    await offlinePage.goto(pathToFileURL(downloadedPath).href)
    await verifyData(offlinePage, document)
    const embedded = await offlinePage.locator('#presentation-data').textContent()
    assert.deepEqual(JSON.parse(embedded!), document)
    await offlinePage.screenshot({
      path: path.join(outputRoot, `${fixtureNames[index]}-offline.png`),
      fullPage: true,
    })
    await offlinePage.emulateMedia({ media: 'print' })
    assert.ok(await offlinePage.locator('#fallback').isVisible())
    assert.ok(!(await offlinePage.locator('#reader').isVisible()))
    assert.deepEqual(network, [])
    await offline.close()

    const noScript = await browser.newContext({ javaScriptEnabled: false, offline: true })
    const noScriptPage = await noScript.newPage()
    await noScriptPage.goto(pathToFileURL(downloadedPath).href)
    await verifyData(noScriptPage, document, true)
    await noScript.close()
    checks.push({
      fixture: fixtureNames[index],
      web: true,
      actualDownloadSha256: receipt.files.html.sha256,
      offline: true,
      offlineNetworkRequests: 0,
      noScript: true,
      printFallback: true,
      embeddedDocumentIdentical: true,
    })
  }
  assert.ok(requests.length >= 6)
  assert.deepEqual(errors, [])
  const result = {
    status: 'passed',
    outputRoot,
    url: server.url,
    workspaceId: host.workspaceId,
    browser: browser.version(),
    hostReact: reactVersion,
    host: dispatch.boundary,
    realDshBoot: boot,
    checks,
    pageErrors: errors,
    productionRegistrationChanged: false,
  }
  await writeFile(path.join(outputRoot, 'web-evidence.json'), JSON.stringify(result, null, 2))
  process.stdout.write(
    `${JSON.stringify({ status: result.status, outputRoot, checks }, null, 2)}\n`,
  )
} catch (error) {
  await writeFile(path.join(outputRoot, 'web-failure.txt'), String(error))
  if (webPage) {
    await webPage.screenshot({ path: path.join(outputRoot, 'failure.png') })
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await webPage.locator('body').innerText(),
    )
  }
  throw error
} finally {
  await browser?.close()
  await server.stop()
}
