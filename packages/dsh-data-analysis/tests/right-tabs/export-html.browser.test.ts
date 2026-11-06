import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('report export downloads the displayed build and rejects stale views', {
  skip: process.env.DSH_DATA_ANALYSIS_BROWSER_TESTS !== '1',
}, async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './src/client/i18n/context.tsx';
import {translator} from './src/client/i18n/copy.ts';
import {ReportActions} from './src/client/right-tabs/report-actions.tsx';
const root=createRoot(document.getElementById('root'));
let current=true;
window.historyClicks=0;
window.renderExport=(buildId)=>root.render(<CopyProvider t={translator('en-US')}><ReportActions key={buildId} document={{reportId:'r',buildId}} isCurrent={()=>current} onHistory={()=>window.historyClicks++}/></CopyProvider>);
window.setCurrent=(value)=>{current=value};
window.anchorClicks=0;
const originalClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){window.anchorClicks++;return originalClick.call(this)};
window.renderExport('current');
`,
    },
    plugins: [
      {
        name: 'export-fixture',
        setup(builder) {
          builder.onResolve({ filter: /analysis-ui\/offline-export\.ts$/ }, () => ({
            path: 'https://export.invalid/fixture.js',
            external: true,
          }))
        },
      },
    ],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
  })
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage()
  let releaseModule: (() => void) | undefined
  const moduleRequested = new Promise<void>((resolve) => {
    void page.route('https://export.invalid/fixture.js', async (route) => {
      resolve()
      await new Promise<void>((release) => {
        releaseModule = release
      })
      await route.fulfill({
        contentType: 'text/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: "export const exportAnalysisHtml = (document) => { if (document.buildId === 'failure') throw Error('fixture'); return 'build:' + document.buildId }",
      })
    })
  })
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0]?.text })
  const menu = page.getByRole('button', { name: 'Report actions' })
  const button = page.getByRole('menuitem', { name: 'Export HTML' })
  await menu.click()
  await page.getByRole('menuitem', { name: 'History' }).click()
  assert.equal(await page.evaluate(() => (window as any).historyClicks), 1)
  await menu.click()
  await page.getByText(/including data not currently visible/).waitFor()
  // Change version while the first module request is pending.
  await button.click()
  await moduleRequested
  await page.evaluate(() => {
    ;(window as any).setCurrent(false)
    ;(window as any).renderExport('historical')
  })
  releaseModule?.()
  await menu.click()
  await button.waitFor()
  assert.equal(await page.evaluate(() => (window as any).anchorClicks), 0)
  await page.evaluate(() => (window as any).setCurrent(true))
  const first = page.waitForEvent('download')
  await button.click()
  const historical = await first
  assert.equal(historical.suggestedFilename(), 'report-r-historical.html')
  assert.equal(await readFile(await historical.path(), 'utf8'), 'build:historical')
  await page.getByRole('status').getByText('HTML download started.').waitFor()
  assert.equal(await button.count(), 0)
  await page.getByRole('status').waitFor({ state: 'detached', timeout: 7_000 })
  await page.evaluate(() => (window as any).renderExport('current'))
  await menu.click()
  const second = page.waitForEvent('download')
  await button.click()
  const current = await second
  assert.equal(current.suggestedFilename(), 'report-r-current.html')
  assert.equal(await readFile(await current.path(), 'utf8'), 'build:current')
  await page.evaluate(() => (window as any).renderExport('failure'))
  await menu.click()
  await button.click()
  await page.getByRole('alert').getByText('Export failed. Try again.').waitFor()
  assert.equal(await button.count(), 0)
  await page.getByRole('button', { name: 'Dismiss export notification' }).click()
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(await page.evaluate(() => (window as any).anchorClicks), 2)
})
