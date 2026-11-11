import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('result shells preserve exact Dataset cells, resource questions and candidate operation isolation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-custom-results-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { flushSync } from 'react-dom';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { OverlayProvider } from './src/client/ui/overlays.tsx';
import { datasetSnapshot } from './tests/unified-analysis-ui/dataset-fixtures.ts';
import { frame, timeAxis } from './tests/unified-analysis-ui/frame-fixtures.ts';
import restricted from './tests/unified-analysis-ui/fixtures/frames/attribute-where.json';
const column = {id:'value',label:'Value',type:'decimal',nullable:false,unit:'USD'};
const resource = snapshot => ({kind:'snapshot',declaration:{kind:snapshot.kind === 'frame' ? 'frame-snapshot':'dataset-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w',codeRef:{executionId:'6f9619ff-8b86-4d01-b42d-00cf4fc964ff',sha256:'a'.repeat(64)}}});
const resources = {
 restricted:resource(restricted),
 metric:resource(datasetSnapshot([['9007199254740993.2300']], [column])),
 table:resource(datasetSnapshot()), chart:resource(datasetSnapshot()),
 partial:resource(frame({axes:[timeAxis(3)],values:[{name:'amount',values:[1,2,3]}],totalRows:5})),
 full:resource(frame({axes:[timeAxis(3)],values:[{name:'amount',values:[1,2,3]}]})),
};
const root = createRoot(document.getElementById('root'));
const portal = new URLSearchParams(location.search).has('portal');
const PortalShell = ({open,title,className,children,onAfterClose}) => { const previous=useRef(open); useEffect(() => {if(previous.current && !open) onAfterClose?.();previous.current=open},[open,onAfterClose]); return open ? createPortal(createElement('div',{role:'dialog','aria-label':title,className},children),document.body) : null; };
window.calls = {code:0,ask:0,copy:0}; window.datasetRequests = []; window.resourceRequests = [];
window.renderBuild = (recordId, candidate = new URLSearchParams(location.search).has('candidate')) => { const surface = createElement(AnalysisRenderer, {
 recordId, resources:{...resources},title:'Results',locale:'en-US',candidate,
 program:'root = Stack([metric, table, chart, partial, full, restricted]);\\nmetric = DatasetView("metric");\\ntable = DatasetView("table");\\nchart = DatasetView("chart", {chart:"line",encoding:{axis:"category",values:["value"]}});\\npartial = AnalysisFrameView("partial", {chart:"auto"}, {density:"compact"});\\nfull = AnalysisFrameView("full");\\nrestricted = AnalysisFrameView("restricted", {chart:"auto"}, {density:"compact"});',
 readCode:async () => {window.calls.code++;return new Promise(resolve => {window.resolveCode = () => resolve({text:'print("old build")',sha256:(window.mismatch ? 'b' : 'a').repeat(64),datasources:[{name:'warehouse',backend:'duckdb'}]})})},
 askResource:async request => {window.resourceRequests.push(request);return () => document.getElementById('background-composer').focus();},
 askPoint:async () => {window.calls.ask++;await new Promise(resolve=>setTimeout(resolve,10));return () => document.getElementById('background-composer').focus();},
 askDataset:async selection => {window.datasetRequests.push(selection); await new Promise((resolve, reject) => {window.resolveAskDataset = resolve; window.rejectAskDataset = reject}); return () => document.getElementById('background-composer').focus();}
});root.render(portal ? createElement(OverlayProvider,{shell:PortalShell},surface) : surface);};
window.replaceMetric = () => { resources.metric = {...resources.metric, snapshot:{...resources.metric.snapshot}}; flushSync(() => window.renderBuild('build-1')); };
window.setMetricSha = (sha) => {
 resources.metric = {...resources.metric,binding:{...resources.metric.binding,codeRef:{...resources.metric.binding.codeRef,sha256:sha.repeat(64)}}};
 flushSync(() => window.renderBuild('build-1'));
 return document.querySelector('[role="dialog"]')?.textContent ?? '';
};
window.renderBuild('build-1');`,
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
      '<!doctype html><button id="background-composer">Composer</button><button id="other-focus">Other</button><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage({ viewport: { width: 420, height: 800 } })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            Reflect.set(window, 'copiedText', text)
            const calls = Reflect.get(window, 'calls')
            calls.copy++
          },
        },
      })
    })
    const url = pathToFileURL(path.join(directory, 'index.html')).href
    await page.goto(url)
    await page.locator('.au-result').first().waitFor()
    assert.equal(await page.locator('.au-result').count(), 6)
    const metric = page.locator('[data-resource="metric"]')
    assert.equal(
      await metric.locator('.au-metric-value strong').textContent(),
      '9007199254740993.2300',
    )
    assert.equal(await metric.locator('.au-metric-value span').textContent(), 'USD')
    const askWholeMetric = metric.getByRole('button', { name: 'Ask about this data' })
    await askWholeMetric.click()
    await page.waitForFunction(() => document.activeElement?.id === 'background-composer')
    const wholeMetric = (await page.evaluate(() => Reflect.get(window, 'resourceRequests')))[0]
    assert.equal(wholeMetric.resourceName, 'metric')
    assert.equal(wholeMetric.component.kind, 'dataset')
    assert.equal(wholeMetric.component.statementId, 'metric')
    const partial = page.locator('[data-resource="partial"]')
    const partialStatus = partial.locator('.au-result-header').getByRole('status')
    assert.equal(await partialStatus.getAttribute('aria-label'), 'Captured 3 / 5 rows')
    assert.equal(await partialStatus.textContent(), '3 / 5 rows')
    assert.equal(
      await partial.locator('[data-icon="coverage"] circle').last().getAttribute('stroke'),
      'var(--mv-quality)',
    )
    const compactAsk = page
      .locator('[data-resource="partial"]')
      .getByRole('button', { name: 'Ask about this data' })
    assert.equal(await compactAsk.count(), 1)
    assert.equal(
      await metric.getByRole('button', { name: 'Ask about this', exact: true }).count(),
      0,
    )
    const metricPoint = metric.getByRole('button', { name: /Select a data point: Value/ })
    await metricPoint.focus()
    await metricPoint.press('Enter')
    const askDataset = page.getByRole('menuitem', { name: 'Ask about this', exact: true })
    await askDataset.click()
    assert.equal(await askDataset.getAttribute('aria-disabled'), 'true')
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'datasetRequests')), [
      { resourceName: 'metric', row: 0, field: 'value' },
    ])
    await page.evaluate(() => Reflect.get(window, 'resolveAskDataset')())
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    await metricPoint.click()
    await askDataset.click()
    await page.evaluate(() => Reflect.get(window, 'rejectAskDataset')(new Error('unavailable')))
    await page.getByRole('status').filter({ hasText: 'Could not add this data.' }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await metricPoint.evaluate((node) => node === document.activeElement), true)
    await metricPoint.click()
    await askDataset.click()
    await page.locator('#other-focus').click()
    await page.evaluate(async () => {
      Reflect.get(window, 'resolveAskDataset')()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await page.waitForFunction(() => document.activeElement?.id === 'other-focus')
    await metricPoint.click()
    await askDataset.click()
    await page.keyboard.press('Escape')
    await page.evaluate(async () => {
      Reflect.get(window, 'rejectAskDataset')(new Error('unavailable'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await metricPoint.click()
    await askDataset.click()
    await page.evaluate(() => Reflect.get(window, 'replaceMetric')())
    await page.evaluate(async () => {
      Reflect.get(window, 'resolveAskDataset')()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await metricPoint.click()
    await askDataset.waitFor()
    await page.keyboard.press('Escape')
    await metric.getByRole('button', { name: 'Data source and scope', exact: true }).click()
    const source = page.getByRole('dialog', { name: 'Data source and scope', exact: true })
    await source.waitFor()
    assert.match((await source.textContent()) ?? '', /6f9619ff-8b86-4d01-b42d-00cf4fc964ff/)
    assert.match((await source.textContent()) ?? '', new RegExp('a'.repeat(64)))
    await page.waitForFunction(() => Reflect.get(window, 'calls').code === 1)
    await page.evaluate(() => Reflect.get(window, 'resolveCode')())
    await source.locator('pre code').waitFor()
    const sourceText = (await source.textContent()) ?? ''
    assert.match(sourceText, /print\("old build"\)/)
    assert.match(sourceText, /warehouse/)
    assert.match(sourceText, /duckdb/)
    assert.doesNotMatch(sourceText, /Captured \d+ \/ \d+ rows/)
    assert.doesNotMatch(sourceText, /SQL:|File provenance:|Execution warnings:/)
    assert.equal(await metric.locator('[data-icon="python"]').count(), 0)
    const sourceCode = source.locator('.au-source-code')
    const copyButton = sourceCode.getByRole('button', { name: 'Copy code', exact: true })
    assert.equal(await copyButton.textContent(), '')
    const codeLayout = await sourceCode.evaluate((node) => {
      const code = node.querySelector('pre')!.getBoundingClientRect()
      const copy = node.querySelector('button')!.getBoundingClientRect()
      return { height: code.height, copyInside: copy.top >= code.top && copy.right <= code.right }
    })
    assert.ok(codeLayout.height > 240)
    assert.equal(codeLayout.copyInside, true)
    await source.locator('[data-icon="copy-code"] button').click()
    await source.getByRole('status').filter({ hasText: 'Copied' }).waitFor()
    assert.equal(await page.evaluate(() => Reflect.get(window, 'copiedText')), 'print("old build")')
    const switchedSource = await page.evaluate(() => Reflect.get(window, 'setMetricSha')('b'))
    assert.doesNotMatch(switchedSource, /print\("old build"\)/)
    assert.doesNotMatch(switchedSource, /warehouse|duckdb/)
    await page.waitForFunction(() => Reflect.get(window, 'calls').code === 2)
    await page.evaluate(() => Reflect.get(window, 'resolveCode')())
    await source.getByText('The execution record sha256 does not match.').waitFor()
    assert.equal(await source.locator('pre code').count(), 0)
    assert.doesNotMatch((await source.textContent()) ?? '', /warehouse|duckdb/)
    await source.getByRole('button', { name: 'Close', exact: true }).click()
    const table = page.locator('[data-resource="table"]')
    await table.getByRole('table', { name: 'table', exact: true }).waitFor()
    await table.getByRole('button', { name: 'Sort by Value' }).click()
    const tablePoint = table.locator(
      '[data-row-index="2"] [data-column-id="value"] .pr-cell-select',
    )
    await tablePoint.click()
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'datasetRequests'))).at(-1), {
      resourceName: 'table',
      row: 2,
      field: 'value',
    })
    await page.evaluate(() => Reflect.get(window, 'resolveAskDataset')())
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape')
    await metric.locator('[data-icon="data"] button').click()
    const tableDialog = page.getByRole('dialog')
    await tableDialog.getByRole('table', { name: 'metric', exact: true }).waitFor()
    const dialogPoint = tableDialog.locator(
      '[data-row-index="0"] [data-column-id="value"] .pr-cell-select',
    )
    await dialogPoint.click()
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'datasetRequests'))).at(-1), {
      resourceName: 'metric',
      row: 0,
      field: 'value',
    })
    await page.evaluate(() => Reflect.get(window, 'resolveAskDataset')())
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    await tableDialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.id === 'background-composer')
    await page.evaluate(() => Reflect.set(window, 'mismatch', true))
    await table.locator('[data-icon="source"] button').click()
    const mismatch = page.getByRole('dialog', { name: 'Data source and scope', exact: true })
    await page.waitForFunction(() => Reflect.get(window, 'calls').code === 3)
    await page.evaluate(() => Reflect.get(window, 'resolveCode')())
    await mismatch.getByText('The execution record sha256 does not match.').waitFor()
    assert.equal(await mismatch.locator('pre code').count(), 0)
    await mismatch.getByRole('button', { name: 'Close', exact: true }).click()
    assert.equal(await table.locator('[data-icon="data"]').count(), 0)
    assert.equal(
      await table.getByRole('button', { name: 'Select columns', exact: true }).count(),
      0,
    )
    assert.equal(
      await table
        .getByRole('status')
        .filter({ hasText: /\d+ rows/ })
        .count(),
      0,
    )
    assert.equal(await table.getByRole('button', { name: 'Copy saved data' }).count(), 0)
    await page
      .locator('[data-resource="restricted"]')
      .getByRole('status', { name: 'Only the restricted member scope is shown.' })
      .waitFor()
    assert.equal(await partial.getAttribute('data-density'), 'compact')
    assert.match((await partial.getByRole('status').first().textContent()) ?? '', /3.*5/)
    const chart = page.locator('[data-resource="chart"]')
    const chartPoint = chart.locator('g[data-frame-point="0:value"]').first()
    await chartPoint.focus()
    await chartPoint.press('Enter')
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'datasetRequests'))).at(-1), {
      resourceName: 'chart',
      row: 0,
      field: 'value',
    })
    await page.evaluate(() => Reflect.get(window, 'resolveAskDataset')())
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape')
    await chart.locator('[data-icon="data"] button').click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.match((await dialog.textContent()) ?? '', /12345678901234\.5678/)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator('[data-resource="full"] [data-icon="data"] button').click()
    const frameDialog = page.getByRole('dialog')
    const point = frameDialog.locator('.pr-cell-select').first()
    for (const key of ['Tab', 'Shift+Tab']) {
      await point.click()
      await page.getByRole('menuitem', { name: 'Ask about this', exact: true }).waitFor()
      await page.keyboard.press(key)
      await page.getByRole('menu').waitFor({ state: 'hidden' })
      assert.equal(
        await frameDialog.evaluate((node) => node.contains(document.activeElement)),
        true,
      )
    }
    await point.click()
    await page.getByRole('menuitem', { name: 'Ask about this', exact: true }).press('Enter')
    await page.waitForFunction(() => Reflect.get(window, 'calls').ask === 1)
    await frameDialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.id === 'background-composer')
    await page.locator('[data-resource="full"] [data-icon="python"] button').click()
    await page.waitForFunction(() => Reflect.get(window, 'calls').code === 4)
    await page.evaluate(() => Reflect.get(window, 'renderBuild')('build-2'))
    await page.locator('[data-analysis-record="build-2"]').waitFor()
    assert.equal(await page.getByRole('status').filter({ hasText: 'Copied' }).count(), 0)
    await page.evaluate(() => Reflect.get(window, 'resolveCode')())
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.locator('pre code').count(), 0)
    await page.goto(`${url}?candidate`)
    await page.locator('.au-result').first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'Ask about this', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Ask about this data' }).count(), 0)
    assert.equal(
      await page
        .locator('[data-icon="copy-data"], [data-icon="python"], [data-icon="origins"]')
        .count(),
      0,
    )
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('button'))
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'calls')), {
      code: 0,
      ask: 0,
      copy: 0,
    })
    await page.goto(`${url}?portal`)
    await page.locator('[data-resource="full"] [data-icon="data"] button').click()
    const portalDialog = page.getByRole('dialog')
    const portalPoint = portalDialog.locator('.pr-cell-select').first()
    await portalPoint.click()
    const action = page.getByRole('menuitem', { name: 'Ask about this', exact: true })
    await action.press('Enter')
    await portalDialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.id === 'background-composer')
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
