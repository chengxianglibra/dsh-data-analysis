import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Frame copy icons retain locale, keyboard access, feedback and exact saved data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-frame-copy-'))
  const browser = await chromium.launch()
  const code = 'print("taxi")\n'
  // codeRef identifies the verified execution record, not the text alone.
  const sha = 'a'.repeat(64)
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { frame, categoryAxis } from './tests/unified-analysis-ui/frame-fixtures.ts';
const snapshot = frame({axes:[categoryAxis(2,'region')], values:[{name:'trips',type:'int64',values:['9007199254740993','2']}]});
const codeRef = {executionId:'6f9619ff-8b86-4d01-b42d-00cf4fc964ff',sha256:${JSON.stringify(sha)}};
const resource = {kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w',codeRef}};
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = AnalysisFrameView("result", {chart:"table"});',title:'Frame',locale:new URLSearchParams(location.search).get('locale') || 'en-US',
  resources:{result:resource},readCode:async () => ({text:${JSON.stringify(code)},sha256:${JSON.stringify(sha)}})
}));`,
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      },
      outfile: path.join(directory, 'page.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    })
    await writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (value: string) => {
            if (Reflect.get(window, 'copyFailure')) throw new Error('clipboard unavailable')
            Reflect.set(window, 'copiedText', value)
          },
        },
      })
    })
    const url = pathToFileURL(path.join(directory, 'index.html')).href
    await page.goto(`${url}?locale=en-US`)
    const button = page.getByRole('button', { name: 'Copy saved data' })
    assert.equal(await button.locator('svg[aria-hidden="true"]').count(), 1)
    assert.equal((await button.textContent())?.trim(), '')
    const tooltip = page.locator('[data-slot=tooltip-content]')
    assert.equal(await button.getAttribute('aria-describedby'), null)
    await button.focus()
    await tooltip.waitFor({ state: 'visible' })
    await page.keyboard.press('Enter')
    await page.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
    assert.match(
      String(await page.evaluate(() => Reflect.get(window, 'copiedText'))),
      /9007199254740993/,
    )
    await page.evaluate(() => Reflect.set(window, 'copyFailure', true))
    await button.click()
    await page.getByRole('status').filter({ hasText: 'Copy failed. Try again.' }).waitFor()

    await page.evaluate(() => Reflect.set(window, 'copyFailure', false))
    await page.locator('[data-icon="python"] button').click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('pre code').waitFor()
    const copyCode = dialog.getByRole('button', { name: 'Copy code' })
    await copyCode.focus()
    await page.keyboard.press('Enter')
    await dialog.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
    assert.equal(await page.evaluate(() => Reflect.get(window, 'copiedText')), code)
    const close = dialog.getByRole('button', { name: 'Close' })
    assert.equal(await close.locator('svg[aria-hidden="true"]').count(), 1)
    await close.click()

    await page.goto(`${url}?locale=zh-CN`)
    const chinese = page.getByRole('button', { name: '复制已保存数据' })
    await chinese.waitFor()
    assert.equal((await chinese.textContent())?.trim(), '')
    const chineseTip = page.locator('[data-slot=tooltip-content]')
    await chinese.focus()
    await chineseTip.waitFor({ state: 'visible' })
    assert.match((await chineseTip.textContent()) ?? '', /复制已保存数据/)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
