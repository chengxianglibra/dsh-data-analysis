/** Focused isolated Host acceptance for the blank homepage navigation. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { type Browser, chromium, type Page } from 'playwright'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'
import { verifyHomepageShortcuts } from './right-tabs/homepage-shortcuts.ts'

const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-homepage-shortcuts-')))
const workspace = path.join(outputRoot, 'workspace')
await mkdir(workspace)
const python =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
process.stdout.write(`Homepage acceptance: ${outputRoot}\n`)
const inputs = await preparePresentationInputs(workspace, python)
const host = await startPresentationWebHost(
  workspace,
  path.join(outputRoot, 'web'),
  python,
  inputs.draftPaths,
  'native-first',
  { rightTabsAcceptance: true, askDshProbe: true },
)
let browser: Browser | undefined
let page: Page | undefined
const errors: string[] = []
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 } })
  page.setDefaultTimeout(25_000)
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(host.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.waitForFunction(() => !!(window as any).__rtHost)
  await verifyHomepageShortcuts(page, outputRoot)
  const result = await page.evaluate(() =>
    (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
      mode: 'native',
      action: 'run',
    }),
  )
  assert.equal(result.ok, true, JSON.stringify(result))
  await page.locator('.marivo-workspace-shortcuts').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '打开报告', exact: true }).click()
  await page.locator('[data-rt-kind="reports"]').waitFor()
  await page.evaluate(() => (window as any).__rtHost.select('right-tabs-ptc'))
  await page.locator('.marivo-workspace-shortcuts').waitFor()
  assert.deepEqual(errors, [])
  await writeFile(
    path.join(outputRoot, 'results.json'),
    JSON.stringify(
      {
        status: 'passed',
        node: process.version,
        browser: browser.version(),
        packageIntegrity: host.packageIntegrity,
        productionModuleDigests: host.moduleDigests,
        runtime: inputs.binding,
        modelBoundary: 'scripted model; real isolated Host, composer and directories',
        checks: [
          'absent Session',
          'blank Session',
          'desktop workspace, preset and directory controls share one row without overlap',
          'three directory identities and reuse',
          'keyboard activation',
          'foreground Session change at click',
          'inline error and recovery',
          'rich draft unchanged',
          'locale',
          '390px visible labels and actionable buttons',
          'first turn hides shortcuts',
          'active header navigation',
          'another blank Session restores shortcuts',
        ],
      },
      null,
      2,
    ),
  )
  process.stdout.write(`Homepage acceptance passed: ${outputRoot}\n`)
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(outputRoot, 'failure.png'), fullPage: true })
      .catch(() => {})
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await page
        .locator('body')
        .innerText()
        .catch(() => 'page unavailable'),
    )
  }
  throw error
} finally {
  try {
    await browser?.close()
  } finally {
    await host.stop()
  }
}
