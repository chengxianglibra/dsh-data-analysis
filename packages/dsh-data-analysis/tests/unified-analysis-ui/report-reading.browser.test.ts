import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('report table sorting and pagination survive save and reopening, and tolerate removed columns', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-report-reading-'))
  const browser = await chromium.launch()
  try {
    const snapshot = datasetSnapshot(
      Array.from({ length: 125 }, (_, i) => [`Row ${i}`, String(125 - i)]),
    )
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
import {ReportReading} from './src/client/analysis-ui/reading-state.tsx';
const root=createRoot(document.getElementById('root')),reading={tabs:new Map(),tables:new Map(),scroll:new Map()};
const snapshot=${JSON.stringify(snapshot)};
let host=0,saved=false;
function render(){root.render(h('section',{key:host},h(ReportReading.Provider,{value:reading},h(AnalysisRenderer,{
viewId:'stable-report',recordId:saved?'saved-record':undefined,program:'root=DatasetView("data", {chart:"table"});',title:'Reading state',locale:'en-US',resources:{},candidate:!saved,
readResource:()=>({kind:'snapshot',snapshot,declaration:{kind:'dataset-snapshot',snapshotRef:'ref'},binding:{workspaceId:'workspace'}})
}))));}
window.readingTest=mode=>{if(mode==='save')saved=true;if(mode==='reopen')host++;if(mode==='remove'){snapshot.data.columns=snapshot.data.columns.slice(0,1);snapshot.data.rows=snapshot.data.rows.map(row=>row.slice(0,1));snapshot.coverage.columns=['category'];}render();};render();`,
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
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    assert.equal(
      await page.locator('thead th').first().locator('.pr-column-meta').textContent(),
      'str',
    )
    assert.equal(
      await page.locator('thead th').nth(1).locator('.pr-column-meta').textContent(),
      'decimal',
    )
    assert.equal(await page.locator('.pr-pagination span').textContent(), 'Page 1 / 7')
    await page.getByRole('button', { name: 'Sort by Value', exact: true }).click()
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    assert.equal(await page.locator('.pr-pagination span').textContent(), 'Page 2 / 7')
    const firstRow = await page.locator('tbody tr').first().getAttribute('data-row-index')
    for (const mode of ['save', 'reopen']) {
      await page.evaluate((mode) => Reflect.get(window, 'readingTest')(mode), mode)
      await page.locator('th[aria-sort="ascending"]').waitFor()
      assert.equal(await page.locator('tbody tr').first().getAttribute('data-row-index'), firstRow)
      assert.equal(
        await page.getByRole('button', { name: 'Previous page', exact: true }).isEnabled(),
        true,
      )
    }
    await page.evaluate(() => Reflect.get(window, 'readingTest')('remove'))
    await page.waitForFunction(() => document.querySelectorAll('thead th').length === 1)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
