import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('Dataset charts select their saved row and field with pointer and keyboard', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-dataset-point-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { datasetSnapshot } from './tests/unified-analysis-ui/dataset-fixtures.ts';
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'dataset-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
const columns = [{id:'x',label:'X',type:'string',nullable:false},{id:'y',label:'Y',type:'string',nullable:false},{id:'value',label:'Value',type:'int64',nullable:false}];
const small = datasetSnapshot([['a','p','1'],['b','p','2'],['a','q','3']],columns);
const dense = datasetSnapshot(Array.from({length:2001},(_,i)=>[String(i),'p',String(i)]),columns);
const resources = {area:resource(small), bar:resource(small), heat:resource(small), dense:resource(dense)};
const program='root = Stack([area, bar, heat, dense]);\\narea = DatasetView("area", {chart:"area",encoding:{axis:"x",series:"y",values:["value"]}});\\nbar = DatasetView("bar", {chart:"bar",encoding:{axis:"x",series:"y",values:["value"]}});\\nheat = DatasetView("heat", {chart:"heatmap",encoding:{x:"x",y:"y",value:"value"}});\\ndense = DatasetView("dense", {chart:"line",encoding:{axis:"x",values:["value"]}});';
window.requests = [];
const root = createRoot(document.getElementById('root'));
window.render = candidate => root.render(createElement(AnalysisRenderer,{program,title:'Dataset points',locale:'en-US',resources,candidate,askDataset:async selection=>window.requests.push(selection)}));
window.render(false);`,
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
    page.setDefaultTimeout(5000)
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    for (const [resourceName, row] of [
      ['area', 2],
      ['bar', 1],
      ['heat', 2],
    ] as const) {
      const mark = page
        .locator(`[data-resource="${resourceName}"] [data-frame-point="${row}:value"]`)
        .first()
      await mark.hover()
      const box = await mark.boundingBox()
      assert.ok(box)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.getByRole('menuitem', { name: 'Ask about this' }).click()
      assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'requests'))).at(-1), {
        resourceName,
        row,
        field: 'value',
      })
      await page.keyboard.press('Escape')
    }
    const navigator = page.locator('[data-resource="dense"] [data-chart-navigator]')
    assert.equal(await navigator.getAttribute('data-point-count'), '2001')
    const inspect = navigator.getByRole('button', { name: /Inspect chart point/ })
    await inspect.focus()
    await inspect.press('End')
    await inspect.press('ArrowLeft')
    await inspect.press('Enter')
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'requests'))).at(-1), {
      resourceName: 'dense',
      row: 1999,
      field: 'value',
    })
    await page.keyboard.press('Escape')
    await page.evaluate(() => Reflect.get(window, 'render')(true))
    assert.equal(await page.locator('[data-resource="area"] [data-frame-point]').count(), 0)
    assert.equal(await page.locator('[data-resource="heat"] [data-frame-point]').count(), 0)
    assert.equal(await page.locator('[data-resource="dense"] [data-chart-navigator]').count(), 0)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
