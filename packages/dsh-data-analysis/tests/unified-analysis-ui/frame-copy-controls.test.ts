import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Frame resource questions preserve component identity, focus and Python copy', async () => {
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
const root=createRoot(document.getElementById('root')); window.requests=[];window.aborts=0;window.commits=0;
window.renderView = view => root.render(createElement(AnalysisRenderer, {
  program:'root = AnalysisFrameView("result", {chart:"'+view+'"});',title:'Frame',locale:new URLSearchParams(location.search).get('locale') || 'en-US',
  resources:{result:resource},readCode:async () => ({text:${JSON.stringify(code)},sha256:${JSON.stringify(sha)}}),
  askResource: (request,signal) => { window.requests.push(request); signal.addEventListener('abort',()=>window.aborts++);return new Promise((resolve,reject)=>{window.resolveAsk=()=>{if(!signal.aborted){window.commits++;resolve(()=>document.getElementById('composer').focus())}else reject(Error('aborted'))};window.rejectAsk=()=>reject(Error('failed'))}) }
}));window.renderView('table');`,
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
      '<!doctype html><button id="composer">Composer</button><div id="root"></div><script src="page.js"></script>',
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
    const button = page.getByRole('button', { name: 'Ask about this data' })
    assert.equal(await button.locator('svg[aria-hidden="true"]').count(), 1)
    assert.equal((await button.textContent())?.trim(), '')
    const tooltip = page.locator('[data-slot=tooltip-content]')
    await button.focus()
    await tooltip.waitFor({ state: 'visible' })
    await page.keyboard.press('Enter')
    assert.equal(await button.getAttribute('aria-busy'), 'true')
    const request = (await page.evaluate(() => Reflect.get(window, 'requests')))[0]
    assert.equal(request.resourceName, 'result')
    assert.deepEqual(request.component.view, { chart: 'table' })
    assert.equal(request.component.kind, 'frame')
    await page.evaluate(() => Reflect.get(window, 'resolveAsk')())
    await page.waitForFunction(() => document.activeElement?.id === 'composer')
    await button.click()
    await page.evaluate(() => Reflect.get(window, 'rejectAsk')())
    await page.getByRole('status').filter({ hasText: 'Could not add this data.' }).waitFor()
    await button.click()
    await page.evaluate(() => Reflect.get(window, 'renderView')('auto'))
    await page.waitForFunction(() => Reflect.get(window, 'aborts') === 1)
    await page.evaluate(() => Reflect.get(window, 'resolveAsk')())
    assert.equal(await page.evaluate(() => Reflect.get(window, 'commits')), 1)
    await button.waitFor()
    assert.equal(await button.getAttribute('aria-busy'), null)

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
    const chinese = page.getByRole('button', { name: '就此数据提问' })
    await chinese.waitFor()
    assert.equal((await chinese.textContent())?.trim(), '')
    const chineseTip = page.locator('[data-slot=tooltip-content]')
    await chinese.focus()
    await chineseTip.waitFor({ state: 'visible' })
    assert.match((await chineseTip.textContent()) ?? '', /就此数据提问/)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
