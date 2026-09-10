/** Three pages in one Chrome context, real isolated Harness with native HMR and Runtime. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type Browser, chromium } from 'playwright'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'

const output = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-report-read-latency-')))
console.log(`Isolated acceptance: ${output}`)
const workspace = path.join(output, 'workspace')
await mkdir(workspace)
const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('DSH_DATA_ANALYSIS_PYTHON required')
const inputs = await preparePresentationInputs(workspace, python)
const server = await startPresentationWebHost(
  workspace,
  path.join(output, 'web'),
  python,
  inputs.draftPaths,
  'native-first',
  { rightTabsAcceptance: true },
)
let browser: Browser | undefined
let releasePublishing = () => {}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } })
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()])
  const errors: string[] = []
  const watches: Array<{ cursor: boolean; duration?: number }> = []
  let hmr = 0
  for (const page of pages) {
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/plugins/events') hmr++
      if (url.pathname.endsWith('/dsh-data-analysis-credentials/watch')) {
        const record = { cursor: Object.hasOwn(request.postDataJSON(), 'cursor') } as {
          cursor: boolean
          duration?: number
        }
        watches.push(record)
        void request.response().then(() => {
          record.duration = request.timing().responseEnd
        })
      }
    })
    await page.goto(server.url)
    const agree = page.getByRole('button', { name: '继续', exact: true })
    if (await agree.isVisible()) await agree.click()
    const later = page.getByRole('button', { name: '稍后配置', exact: true })
    if (await later.isVisible()) await later.click()
    await page.waitForFunction(() => !!(window as any).__rightTabs)
    await page.waitForFunction(
      (id) => (window as any).__rtHost.sessions.getSnapshot().ids.includes(id),
      server.sessionId,
    )
    await page.evaluate((id) => (window as any).__rtHost.select(id), server.sessionId)
    await page.getByRole('button', { name: '打开报告', exact: true }).first().waitFor()
  }
  const timings: Array<{ page: number; kind: string; elapsed: number }> = []
  for (let round = -1; round < 5; round++) {
    await Promise.all(
      pages.map(async (page, index) => {
        await page.getByRole('button', { name: '打开报告', exact: true }).first().click()
        const catalog = page.locator('[data-rt-kind=reports]')
        await catalog.locator('.pd-report-title').first().waitFor()
        const start = await page.evaluate(() => performance.now())
        await catalog.getByRole('button', { name: '刷新', exact: true }).click()
        await catalog.getByText('正在读取报告列表…', { exact: true }).waitFor({ state: 'hidden' })
        await catalog.locator('.pd-report-title').first().waitFor()
        const listed = await page.evaluate(() => performance.now())
        await catalog.locator('.pd-report-title').first().click()
        const reader = page.locator('[data-rt-kind=report]')
        await reader.locator('[data-mode=interactive]').waitFor()
        const opened = await page.evaluate(() => performance.now())
        if (round >= 0)
          timings.push(
            { page: index, kind: 'list', elapsed: listed - start },
            { page: index, kind: 'document', elapsed: opened - listed },
          )
        else await page.evaluate(() => performance.clearResourceTimings())
      }),
    )
  }
  const resources = (
    await Promise.all(
      pages.map((page) =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .filter((e) =>
              /\/marivo-presentation\/(reports\/list|reports\/resolve|files\/read)$/.test(
                new URL(e.name).pathname,
              ),
            )
            .map((e) => {
              const r = e as PerformanceResourceTiming
              return {
                path: new URL(r.name).pathname,
                queue: r.requestStart - r.fetchStart,
                duration: r.duration,
                protocol: r.nextHopProtocol,
              }
            }),
        ),
      ),
    )
  ).flat()
  const p95 = (values: number[]) =>
    values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!
  const metrics = {
    sendQueueP95: p95(resources.map((r) => r.queue)),
    listP95: p95(timings.filter((t) => t.kind === 'list').map((t) => t.elapsed)),
    documentP95: p95(timings.filter((t) => t.kind === 'document').map((t) => t.elapsed)),
  }
  console.log(JSON.stringify({ metrics, samples: timings.length, requests: resources.length }))
  assert.ok(resources.length >= 45, `missing request timings: ${resources.length}`)
  assert.ok(hmr >= 3, 'native HMR SSE remains active')
  assert.ok(watches.length >= 3, 'all pages received initial credential snapshots')
  assert.ok(
    watches.every((w) => !w.cursor),
    'new clients must never send watch cursors',
  )
  const beforeIdle = watches.length
  await pages[0]!.waitForTimeout(26_000)
  assert.equal(watches.length, beforeIdle, 'unchanged Host heartbeat must not poll HTTP')
  const beforeReconnect = watches.length
  const reconnected = pages[0]!.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/dsh-data-analysis-credentials/watch'),
  )
  await pages[0]!.evaluate(() => (window as any).__rtHost.reconnect())
  await reconnected
  await pages[0]!.waitForFunction(
    () => !!(window as any).__rightTabs.credentials.getSnapshot().revision,
  )
  assert.ok(watches.length > beforeReconnect, 'reconnect reloads the credential baseline')
  // Hold a real publishing request while reading, editing and history remain available.
  const page = pages[0]!
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
    releasePublishing = resolve
  })
  await page.route('**/dsh-report-publishing/describe', async (route) => {
    await held
    await route.continue().catch(() => {})
  })
  await page.getByRole('button', { name: '打开报告', exact: true }).first().click()
  await page.locator('[data-rt-kind=reports] .pd-report-title').first().click()
  const reader = page.locator('[data-rt-kind=report]')
  await reader.locator('[data-mode=interactive]').waitFor()
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await reader.getByRole('menuitem', { name: '刷新', exact: true }).click()
  await reader.locator('[data-mode=interactive]').waitFor()
  await reader.getByRole('button', { name: '报告更多操作', exact: true }).click()
  await reader.getByText('正在读取发布配置…', { exact: true }).first().waitFor()
  assert.equal(await reader.getByRole('menuitem', { name: /下载完整报告/ }).isDisabled(), true)
  assert.equal(await reader.getByRole('menuitem', { name: /导出当前视图/ }).isDisabled(), true)
  assert.equal(
    await reader.getByRole('menuitem', { name: '编辑报告', exact: true }).isEnabled(),
    true,
  )
  assert.equal(
    await reader.getByRole('menuitem', { name: '历史版本', exact: true }).isEnabled(),
    true,
  )
  release()
  await reader.getByText('正在读取发布配置…', { exact: true }).first().waitFor({ state: 'hidden' })
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ metrics, timings, resources, watches, hmr, errors }, null, 2),
  )
  console.log(
    JSON.stringify({ metrics, requests: resources.length, watches: watches.length, hmr, output }),
  )
  assert.ok(metrics.sendQueueP95 < 250)
  assert.ok(metrics.listP95 < 1000)
  assert.ok(metrics.documentP95 < 1000)
} finally {
  releasePublishing()
  try {
    await browser?.close()
  } finally {
    await server.stop()
  }
}
