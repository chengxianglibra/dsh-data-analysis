import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('filtered tables and charts retain saved row identity, sorting, pagination and line gaps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-filter-projection-'))
  const browser = await chromium.launch()
  try {
    const table = datasetSnapshot(
      Array.from({ length: 125 }, (_, i) => [`Row ${i}`, String(125 - i)]),
    )
    const chart = datasetSnapshot([
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
    ])
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {DatasetTable} from './src/client/presentation/table.tsx';
import {datasetChartModel} from './src/client/analysis-ui/charts/dataset-model.ts';
import {TimeChart} from './src/client/analysis-ui/charts/observation.tsx';
import {ChartSelectionContext} from './src/client/analysis-ui/charts/selection-context.tsx';
import {ReportReading} from './src/client/analysis-ui/reading-state.tsx';
const table=${JSON.stringify(table.data)}, chart=${JSON.stringify(chart.data)};
const root=createRoot(document.getElementById('root')); window.selected=[];
const reading={tabs:new Map(),accordions:new Map(),tables:new Map(),scroll:new Map()};
window.renderFilter=(indices,filterSelectionKey,showTable=true)=>root.render(h('div',null,
  showTable && h(ReportReading.Provider,{value:reading},h(DatasetTable,{data:table,caption:'Rows',visibleRowIndices:indices,filterSelectionKey,selectCell:(row,field)=>window.selected.push({row,field}),selectableColumns:new Set(['value'])})),
  h(ChartSelectionContext.Provider,{value:{select:(row,field)=>window.selected.push({row,field})}},
    h(TimeChart,{model:datasetChartModel(chart,['category'],indices),view:{chart:'line',axis:'category',values:['value'],broadcast:[]}}))));
window.renderFilter(undefined);`,
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
    await page.getByRole('button', { name: 'Sort by Value', exact: true }).click()
    await page.evaluate(() =>
      Reflect.get(window, 'renderFilter')(
        Array.from({ length: 125 }, (_, i) => i),
        'first selection',
      ),
    )
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await page.evaluate(() =>
      Reflect.get(window, 'renderFilter')(
        Array.from({ length: 125 }, (_, i) => i),
        'second selection',
      ),
    )
    await page.waitForFunction(
      () => document.querySelector('tbody tr')?.getAttribute('data-row-index') === '124',
    )
    assert.equal(
      await page.getByRole('button', { name: 'Previous page', exact: true }).isEnabled(),
      false,
    )
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await page.evaluate(() =>
      Reflect.get(window, 'renderFilter')(undefined, 'second selection', false),
    )
    await page.waitForFunction(() => document.querySelector('table') === null)
    await page.evaluate(() =>
      Reflect.get(window, 'renderFilter')(
        Array.from({ length: 125 }, (_, i) => i),
        'second selection',
      ),
    )
    await page.waitForFunction(
      () => document.querySelector('tbody tr')?.getAttribute('data-row-index') === '104',
    )
    await page.evaluate(() =>
      Reflect.get(window, 'renderFilter')(undefined, 'second selection', false),
    )
    await page.waitForFunction(() => document.querySelector('table') === null)
    await page.evaluate(() =>
      Reflect.get(window, 'renderFilter')(
        Array.from({ length: 125 }, (_, i) => i),
        'third selection',
      ),
    )
    await page.waitForFunction(
      () => document.querySelector('tbody tr')?.getAttribute('data-row-index') === '124',
    )
    assert.equal(
      await page.getByRole('button', { name: 'Previous page', exact: true }).isEnabled(),
      false,
    )
    await page.getByRole('button', { name: 'Next page', exact: true }).click()
    await page.evaluate(() => Reflect.get(window, 'renderFilter')([0, 2]))
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2)
    assert.deepEqual(
      await page
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['2', '0'],
    )
    await page.locator('tbody tr[data-row-index="2"] [data-column-id="value"] button').click()
    const point = page.locator('[data-frame-point="2:value"]').first()
    await point.hover()
    const pointBox = await point.boundingBox()
    assert.ok(pointBox)
    await page.mouse.click(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2)
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'selected')), [
      { row: 2, field: 'value' },
      { row: 2, field: 'value' },
    ])
    assert.equal(await page.locator('[data-frame-point="1:value"]').count(), 0)
    const pathData = await page.locator('.recharts-line-curve').first().getAttribute('d')
    assert.ok(
      pathData && (pathData.match(/M/g) ?? []).length >= 2,
      `expected disconnected line segments: ${pathData}`,
    )
    await page.evaluate(() => Reflect.get(window, 'renderFilter')([]))
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 0)
    assert.equal(await page.locator('[data-frame-point]').count(), 0)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
