import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Dataset and Frame preserve exact values and accessible data actions', async () => {
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
 formatted:resource(datasetSnapshot([["A", "0.237"], ["B", "0.125"]],columns)),
 formattedMetric:resource(datasetSnapshot([["0.237"]],scalarColumn)),
 formattedChart:resource(datasetSnapshot([["A", "0.237"], ["B", "0.125"]],columns)),
 formattedLarge:resource(datasetSnapshot(rows,columns)),
 numericAxis:resource(datasetSnapshot([['0.231', '1'], ['0.234', '2']],[columns[1],{id:'other',label:'other',type:'decimal',nullable:false}])),
 mixed:resource(datasetSnapshot([["A", "0.237", "12.5"], ["B", "0.125", "20"]],[columns[0],{...columns[1],unit:'1'},{id:'other',label:'other',type:'decimal',nullable:false,unit:'1'}])),
};
window.calls = {code:0,ask:0,copy:0};
const root = createRoot(document.getElementById('root'));
const candidate = new URLSearchParams(location.search).has('candidate');
root.render(createElement(AnalysisRenderer,{resources,title:'Alignment',locale:'en-US',candidate,
 program:'root = Stack([datasetMetric,frameMetric,datasetTable,frameTable,datasetChart,frameChart,datasetPartial,formatted,formattedMetric,formattedChart,formattedLarge,mixed,numericAxis]);\\ndatasetMetric = DatasetView("datasetMetric");\\nframeMetric = AnalysisFrameView("frameMetric");\\ndatasetTable = DatasetView("datasetTable",{chart:"table"});\\nframeTable = AnalysisFrameView("frameTable",{chart:"table"});\\ndatasetChart = DatasetView("datasetChart",{chart:"bar",encoding:{axis:"category",values:["value"]}});\\nframeChart = AnalysisFrameView("frameChart",{chart:"bar",encoding:{axis:"category",values:["value"]}});\\ndatasetPartial = DatasetView("datasetPartial");\\nformatted = DatasetView("formatted",{chart:"table"},{title:"Families",subtitle:"Details",formats:[{value:"value",format:"percent",decimals:1}]});\\nformattedMetric = DatasetView("formattedMetric",{chart:"metric",encoding:{value:"value"}},{formats:[{value:"value",format:"percent",decimals:1}]});\\nformattedChart = DatasetView("formattedChart",{chart:"bar",encoding:{axis:"category",values:["value"]}},{formats:[{value:"value",format:"percent",decimals:1}]});\\nformattedLarge = DatasetView("formattedLarge",{chart:"table"},{formats:[{value:"value",format:"number",decimals:4}]});\\nmixed = DatasetView("mixed",{chart:"bar",encoding:{axis:"category",values:["value","other"]}},{formats:[{value:"value",format:"percent",decimals:1},{value:"other",format:"number",decimals:1}]});\\nnumericAxis = DatasetView("numericAxis",{chart:"bar",encoding:{axis:"value",values:["other"]}},{formats:[{value:"value",format:"percent",decimals:0}]});',
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
    await page.goto(url)
    await page.locator('[data-resource="frameChart"] .recharts-surface').waitFor()
    for (const [dataset, frame] of [
      ['datasetMetric', 'frameMetric'],
      ['datasetTable', 'frameTable'],
      ['datasetChart', 'frameChart'],
    ]) {
      const a = page.locator(`[data-resource="${dataset}"]`)
      const b = page.locator(`[data-resource="${frame}"]`)
      for (const card of [a, b]) {
        assert.equal(
          await card
            .locator('.fv-icons button')
            .evaluateAll((buttons) => buttons.every((button) => button.getAttribute('aria-label'))),
          true,
        )
      }
      if (dataset === 'datasetTable') continue
      const open = a.locator('[data-icon="data"] button')
      await open.focus()
      await open.press('Enter')
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert.match((await dialog.textContent()) ?? '', /12345678901234\.5678/)
      await dialog.getByRole('button', { name: 'Close', exact: true }).press('Enter')
      await dialog.waitFor({ state: 'detached' })
    }
    const formatted = page.locator('[data-resource="formatted"]')
    assert.equal(await formatted.getByRole('heading', { name: 'Families' }).count(), 1)
    assert.match((await formatted.textContent()) ?? '', /Details/)
    assert.match((await formatted.textContent()) ?? '', /23\.7%/)
    assert.equal(await formatted.locator('[data-row-index="0"] [title="0.237"]').count(), 1)
    assert.match(
      (await page.locator('[data-resource="formattedMetric"]').textContent()) ?? '',
      /23\.7%/,
    )
    await formatted.getByRole('button', { name: 'Sort by value' }).click()
    assert.equal(await formatted.locator('tbody tr').first().getAttribute('data-row-index'), '1')
    const large = page.locator('[data-resource="formattedLarge"]')
    assert.match((await large.textContent()) ?? '', /12,345,678,901,234\.5678/)
    const mixed = page.locator('[data-resource="mixed"]')
    assert.equal(await mixed.locator('.fv-parent').count(), 2)
    assert.match(
      (await mixed
        .locator('.fv-parent')
        .first()
        .locator('.recharts-yAxis-tick-labels')
        .textContent()) ?? '',
      /%/,
    )
    assert.doesNotMatch(
      (await mixed
        .locator('.fv-parent')
        .last()
        .locator('.recharts-yAxis-tick-labels')
        .textContent()) ?? '',
      /%/,
    )
    const numericAxis = page.locator('[data-resource="numericAxis"]')
    assert.equal(await numericAxis.locator('.recharts-bar-rectangle').count(), 2)
    const labels = await numericAxis
      .locator('.recharts-xAxis-tick-labels [data-tick] > text')
      .allTextContents()
    assert.deepEqual(labels, ['23%', '23%'])
    const chart = page.locator('[data-resource="formattedChart"]')
    assert.match((await chart.locator('.recharts-yAxis-tick-labels').textContent()) ?? '', /%/)
    await chart.locator('[data-icon="data"] button').click()
    assert.match((await page.getByRole('dialog').textContent()) ?? '', /0\.237/)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
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
