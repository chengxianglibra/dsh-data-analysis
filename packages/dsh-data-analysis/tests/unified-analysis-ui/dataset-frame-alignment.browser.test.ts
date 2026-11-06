import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Dataset and Frame share result layout and data actions at desktop and mobile widths', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-dataset-frame-alignment-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { datasetSnapshot } from './tests/unified-analysis-ui/dataset-fixtures.ts';
import { frame } from './tests/unified-analysis-ui/frame-fixtures.ts';
const columns = [{id:'category',label:'category',type:'string',nullable:false},{id:'value',label:'value',type:'decimal',nullable:false}];
const rows = [['A','12345678901234.5678'],['B','2.5000'],['C','3.0000']];
const axis = {name:'category',keys:rows.map(row=>row[0])};
const values = [{name:'value',type:'decimal',values:rows.map(row=>row[1])}];
const scalarColumn = [columns[1]];
const resource = snapshot => ({kind:'snapshot',declaration:{kind:snapshot.kind === 'frame' ? 'frame-snapshot':'dataset-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
const resources = {
 datasetMetric:resource(datasetSnapshot([[rows[0][1]]],scalarColumn)),
 frameMetric:resource(frame({values:[{name:'value',type:'decimal',values:[rows[0][1]]}]})),
 datasetTable:resource(datasetSnapshot(rows,columns)),
 frameTable:resource(frame({axes:[axis],values})),
 datasetChart:resource(datasetSnapshot(rows,columns)),
 frameChart:resource(frame({axes:[axis],values})),
 datasetPartial:resource(datasetSnapshot(rows,columns,false)),
};
window.calls = {code:0,ask:0,copy:0};
const root = createRoot(document.getElementById('root'));
const candidate = new URLSearchParams(location.search).has('candidate');
root.render(createElement(AnalysisRenderer,{resources,title:'Alignment',locale:'en-US',candidate,
 program:'root = Stack([datasetMetric,frameMetric,datasetTable,frameTable,datasetChart,frameChart,datasetPartial]);\\ndatasetMetric = DatasetView("datasetMetric");\\nframeMetric = AnalysisFrameView("frameMetric");\\ndatasetTable = DatasetView("datasetTable",{chart:"table"});\\nframeTable = AnalysisFrameView("frameTable",{chart:"table"});\\ndatasetChart = DatasetView("datasetChart",{chart:"bar",encoding:{axis:"category",values:["value"]}});\\nframeChart = AnalysisFrameView("frameChart",{chart:"bar",encoding:{axis:"category",values:["value"]}});\\ndatasetPartial = DatasetView("datasetPartial");',
 readCode:async () => {window.calls.code++;return null},askPoint:async () => {window.calls.ask++}
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
      '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="page.js"></script>',
    )
    const url = pathToFileURL(path.join(directory, 'index.html')).href
    const page = await browser.newPage()
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async () => {
            Reflect.get(window, 'calls').copy++
          },
        },
      })
    })
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url)
      await page.locator('[data-resource="frameChart"] .recharts-surface').waitFor()
      for (const [dataset, frame] of [
        ['datasetMetric', 'frameMetric'],
        ['datasetTable', 'frameTable'],
        ['datasetChart', 'frameChart'],
      ]) {
        const a = page.locator(`[data-resource="${dataset}"]`)
        const b = page.locator(`[data-resource="${frame}"]`)
        for (const selector of ['.fv-head', '.fv-header-actions', '[data-icon="data"]']) {
          assert.equal(await a.locator(selector).count(), 1, `${dataset} ${selector}`)
          assert.equal(await b.locator(selector).count(), 1, `${frame} ${selector}`)
        }
        assert.equal(await a.locator('.fv-chart-tag').count(), 0, `${dataset} chart type label`)
        assert.equal(await b.locator('.fv-chart-tag').count(), 0, `${frame} chart type label`)
        const structure = (selector: string) =>
          page.locator(selector).evaluate((node) => {
            const header = node.querySelector('.fv-head')!
            const content = header.nextElementSibling!
            const actions = node.querySelector('[data-icon="data"]')!.closest('.fv-icons')!
            return {
              header: header.className,
              content: content.className,
              actions: actions.className,
            }
          })
        assert.deepEqual(
          await structure(`[data-resource="${dataset}"]`),
          await structure(`[data-resource="${frame}"]`),
        )
        await a.locator('[data-icon="data"] button').click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        assert.match((await dialog.textContent()) ?? '', /12345678901234\.5678/)
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      }
      const metric = page.locator('[data-resource="datasetMetric"]')
      assert.equal(
        await metric.locator('.au-metric-value strong').textContent(),
        '12345678901234.5678',
      )
      assert.equal(await page.locator('[data-resource="datasetTable"] .pr-table').count(), 1)
      assert.equal(await page.locator('[data-resource="frameTable"] .pr-table').count(), 1)
      assert.equal(
        await page.locator('[data-resource="datasetChart"] .recharts-bar-rectangle').count(),
        3,
      )
      assert.equal(
        await page.locator('[data-resource="frameChart"] .recharts-bar-rectangle').count(),
        3,
      )
      assert.equal(
        await page.locator('[data-resource="datasetPartial"] [data-icon="coverage"]').count(),
        1,
      )
    }
    await page.goto(`${url}?candidate`)
    await page.locator('[data-resource="datasetMetric"]').waitFor()
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('[data-resource-kind="dataset"] button'))
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'calls')), {
      code: 0,
      ask: 0,
      copy: 0,
    })
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
