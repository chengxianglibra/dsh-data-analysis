import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'
import {
  categoryAxis,
  comparisonOf,
  decompositionOf,
  frame,
  observeCategory,
} from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer.dispose()
})

test('row limit previews saved rows with their original point identity and exposes the complete table', async () => {
  const snapshot = observeCategory(15)
  const html = await renderer.render(snapshot, {
    askPoint: true,
    display: { rowLimit: 3, dataTable: 'visible' },
  })
  assert.equal((html.match(/data-mark="bar"/g) ?? []).length, 3)
  assert.match(html, /data-frame-point="2:revenue"/)
  assert.doesNotMatch(html, /data-mark="bar"[^>]*data-frame-point="3:revenue"/)
  const table = html.split('class="fv-data-reference"')[1] ?? ''
  assert.match(table, /data-row-index="14"/)
  assert.match(table, /data-column-id="revenue"/)
  assert.match(html, /data-icon="data"/)
})

test('a limited horizontal bar keeps the original selected row and full data dialog', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-limited-bars-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
const snapshot = ${JSON.stringify(observeCategory(15))};
const resource = {kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}};
window.requests = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = AnalysisFrameView("bars", {chart:"auto"}, {rowLimit:3});',
  title:'Bars',locale:'en-US',resources:{bars:resource},askPoint:async request => {window.requests.push(request)}
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
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const card = page.locator('[data-resource="bars"]')
    await card.locator('[data-frame-point="2:revenue"]').click()
    const menu = page.getByRole('menu')
    await menu.getByRole('menuitem', { name: 'Ask about this' }).click()
    await menu.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'requests')), [
      { resourceName: 'bars', row: 2, field: 'revenue' },
    ])
    assert.equal(await card.locator('[data-mark="bar"]').count(), 3)
    await page.keyboard.press('Escape')
    await card.locator('[data-icon="data"] button').click()
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 15)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Frame and Dataset charts retain their saved categories and values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-narrow-bars-'))
  const browser = await chromium.launch()
  const fullLabel = 'Upper East Side South A Very Long Category Name'
  const snapshot = frame({
    axes: [{ ...categoryAxis(2), keys: ['JFK Airport', fullLabel] }],
    values: [{ name: 'revenue', values: [187466, 156673] }],
  })
  const dataset = datasetSnapshot([
    ['First category', '12345.67'],
    ['Second category', '123.45'],
  ])
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { HBarChart } from './src/client/analysis-ui/charts/observation.tsx';
import { datasetChartModel } from './src/client/analysis-ui/charts/dataset-model.ts';
const snapshot = ${JSON.stringify(snapshot)};
const dataset = ${JSON.stringify(dataset.data)};
const resource = {kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}};
const chart = createElement(HBarChart,{model:datasetChartModel(dataset,['category']),view:{chart:'hbar',axis:'category',values:['value'],broadcast:[]}});
const report = createElement(AnalysisRenderer,{program:'root = AnalysisFrameView("bars");',title:'Bars',locale:'en-US',resources:{bars:resource}});
createRoot(document.getElementById('root')).render(createElement('div',null,
  createElement('div',{'data-case':'frame',style:{width:500}},report),
  createElement('div',{'data-case':'dataset',style:{width:500}},chart)
));`,
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
      '<!doctype html><meta charset="utf-8"><style>.fv-plot{max-width:100%;overflow-x:auto}</style><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const framePlot = page.locator('[data-case="frame"] .fv-plot')
    await framePlot.locator('[data-mark="bar"]').first().waitFor()
    assert.equal(await framePlot.locator('[data-mark="bar"]').count(), 2)
    assert.deepEqual(await framePlot.locator('[data-row-label] title').allTextContents(), [
      'JFK Airport',
      fullLabel,
    ])
    const visibleValues = await framePlot.locator('.recharts-label-list text').allTextContents()
    assert.deepEqual(visibleValues, ['187,466.00', '156,673.00'])
    const datasetPlot = page.locator('[data-case="dataset"] .fv-plot')
    await datasetPlot.locator('[data-mark="bar"]').first().waitFor()
    assert.equal(await datasetPlot.locator('[data-mark="bar"]').count(), 2)
    assert.deepEqual(
      await datasetPlot.locator('[data-row-label] .fv-row-label').allTextContents(),
      ['First category', 'Second category'],
    )
    assert.deepEqual(await datasetPlot.locator('.recharts-label-list text').allTextContents(), [
      '12345.67',
      '123.45',
    ])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})

function decomposition() {
  const baseline = decompositionOf([['total', 'baseline_total']])
  const current = decompositionOf([['total', 'current_total']])
  const absolute = decompositionOf([
    ['contribution', 'absolute_contribution'],
    ['total', 'absolute_total'],
  ])
  absolute.target = { kind: 'absolute', comparison: 0, group: 'sales' }
  return frame({
    axes: [categoryAxis(3)],
    values: [
      { name: 'baseline_total', values: [110, 110, 110] },
      { name: 'current_total', values: [100, 100, 100] },
      { name: 'absolute_contribution', values: [-8, -3, 1] },
      { name: 'absolute_total', values: [-10, -10, -10] },
    ],
    comparisons: [comparisonOf({ kind: 'ordinary' }, [{ name: 'sales', values: [] }])],
    decompositions: [baseline, current, absolute],
  })
}

test('explicit decomposition totals use only repeated, consistent saved endpoint values', async () => {
  const display = {
    decompositionTotals: {
      baseline: 'baseline_total',
      current: 'current_total',
      baselineLabel: 'May total',
      currentLabel: 'June total',
    },
  }
  const options = {
    view: { chart: 'decomposition' as const, encoding: { value: 'absolute_contribution' } },
    display,
  }
  const snapshot = decomposition()
  const html = await renderer.render(snapshot, options)
  assert.match(html, /data-number="baseline_total"[^>]*>[\s\S]*?110\.00[\s\S]*?May total/)
  assert.match(html, /data-number="current_total"[^>]*>[\s\S]*?100\.00[\s\S]*?June total/)
  for (const name of ['baseline_total', 'current_total'] as const)
    for (const missing of [null, 111] as const) {
      const broken = decomposition()
      const column = broken.data.columns.findIndex((item) => item.id === name)
      broken.data.rows[1]![column] = missing
      const variant = await renderer.render(broken, options)
      assert.doesNotMatch(variant, new RegExp(`data-number="${name}"`))
      assert.match(
        variant,
        new RegExp(
          `data-number="${name === 'baseline_total' ? 'current_total' : 'baseline_total'}"`,
        ),
      )
    }
})

test('display rounding affects the headline while the detailed table retains its original precision', async () => {
  const snapshot = frame({ values: [{ name: 'fare', type: 'decimal', values: ['82040902.13'] }] })
  snapshot.data.columns[0]!.unit = 'USD'
  const original = JSON.stringify(snapshot)
  const html = await renderer.render(snapshot, {
    view: { chart: 'metric' },
    display: {
      dataTable: 'visible',
      formats: [{ value: 'fare', format: 'currency', decimals: 0 }],
    },
  })
  assert.match(html, /\$82,040,902(?:<|\s)/)
  const table = html.split('class="fv-data-reference"')[1] ?? ''
  assert.match(table, /\$82,040,902\.13/)
  assert.equal(JSON.stringify(snapshot), original)
})
