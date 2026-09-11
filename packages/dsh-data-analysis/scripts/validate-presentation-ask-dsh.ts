/** Focused real DSH Web acceptance; disposable profile, production plugin, scripted model. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, chromium, type Page } from 'playwright'
import { verifyAskDsh } from './presentation-s4/ask-dsh.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'

assert.equal(process.argv.length, 2, 'Usage: validate-presentation-ask-dsh.ts')
const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-ask-dsh-')))
const workspaceRoot = path.join(outputRoot, 'workspace')
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
await mkdir(workspaceRoot)
process.stdout.write(`Ask DSH isolated Web acceptance: ${outputRoot}\n`)
const inputs = await preparePresentationInputs(workspaceRoot, pythonExecutable)
const server = await startPresentationWebHost(
  workspaceRoot,
  await mkdtemp(path.join(outputRoot, 'web-')),
  pythonExecutable,
  inputs.draftPaths,
  'native-first',
  { askDshProbe: true, rightTabsAcceptance: true },
)
let browser: Browser | undefined
let page: Page | undefined
const errors: string[] = []
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
  await page.getByText('S4 production Tool delivery', { exact: true }).first().click()
  await page.waitForFunction(() => !!(window as any).__rightTabs)
  assert.equal(await page.locator('[data-presentation-card]').count(), 0)
  assert.ok(server.durableSessionId)
  const checks = await verifyAskDsh(
    page,
    browser,
    server.deliveries,
    server.durableSessionId,
    outputRoot,
  )
  assert.deepEqual(errors, [])
  const evidence = {
    status: 'passed',
    dshVersion: createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version,
    boundary:
      'Real installed DSH Web composer and packed production native report Tab; scripted model adapter, not real-model analysis acceptance',
    workspaceRoot,
    isolatedProfile: server.profile,
    moduleDigests: server.moduleDigests,
    checks,
  }
  await writeFile(path.join(outputRoot, 'ask-dsh-evidence.json'), JSON.stringify(evidence, null, 2))
  process.stdout.write(`Ask DSH real Web acceptance passed: ${outputRoot}\n`)
} catch (error) {
  if (page) {
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await page.locator('body').innerText(),
    )
    await page.screenshot({ path: path.join(outputRoot, 'failure.png'), fullPage: true })
  }
  await writeFile(
    path.join(outputRoot, 'failure.json'),
    JSON.stringify({ error: String(error), errors }, null, 2),
  )
  throw error
} finally {
  await browser?.close()
  await server.stop()
  await rm(workspaceRoot, { recursive: true, force: true })
  await rm(path.dirname(server.home), { recursive: true, force: true })
}
