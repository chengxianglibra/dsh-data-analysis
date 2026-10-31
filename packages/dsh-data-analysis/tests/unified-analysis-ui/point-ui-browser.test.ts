import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('a sorted Frame cell selects the original row and adds its exact value to a question', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-point-ui-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { frame, categoryAxis, observeTime } from './tests/unified-analysis-ui/frame-fixtures.ts';
const snapshot = frame({axes: [categoryAxis(2, 'region'), {name:'channel', role:'identity', keys:['web','app']}],
  values: [{name:'amount',type:'int64',values:['9007199254740993','2']}]});
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
const resources = {result: resource(snapshot), large: resource(observeTime(70))};
window.pointRequests = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([table, large]);\\ntable = AnalysisFrameView("result", {chart:"table"});\\nlarge = AnalysisFrameView("large");', title:'Point test', locale:'en-US', resources,
  askPoint: async point => {window.pointRequests.push(point)}
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
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    await page.getByRole('button', { name: /Sort by amount/ }).click()
    const cell = page.locator('[data-row-index="0"] [data-column-id="amount"] .pr-cell-select')
    await cell.click()
    const details = page.getByRole('region', { name: 'Selected data' })
    await details.getByText('9007199254740993').waitFor()
    await details.getByText('web', { exact: true }).first().waitFor()
    await details.getByRole('button', { name: 'Add to question' }).click()
    await details.getByText('Added to the question draft.').waitFor()
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointRequests')), [
      { resourceName: 'result', row: 0, field: 'amount' },
    ])
    const choices = page
      .locator('[data-resource="large"] details')
      .filter({ hasText: 'Select a data point' })
      .first()
    await choices.locator('summary').click()
    await choices.locator(':scope > div > button').first().waitFor()
    assert.equal(await choices.locator(':scope > div > button').count(), 50)
    await choices.getByRole('button', { name: 'Next page' }).click()
    assert.equal(await choices.locator(':scope > div > button').count(), 20)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
