import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Page } from 'playwright'

let directory: string
let browser: Browser
let page: Page

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-chart-tooltip-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { datasetSnapshot } from './tests/unified-analysis-ui/dataset-fixtures.ts';
import { observeTime, compareCalendar } from './tests/unified-analysis-ui/frame-fixtures.ts';
const resource = (snapshot) => ({ kind: 'snapshot', declaration: {
  kind: snapshot.kind === 'frame' ? 'frame-snapshot' : 'dataset-snapshot', snapshotRef: 'ref'
}, snapshot, binding: { workspaceId: 'w' } });
const resources = {line: resource(observeTime(3)), area: resource(observeTime(3)),
  dense: resource(observeTime(2001)), dataset: resource(datasetSnapshot()),
  domain: resource(compareCalendar(6))};
const program = 'root = Stack([line, area, dense, dataset, domain]);\\nline = AnalysisFrameView("line", {chart: "line"});\\narea = AnalysisFrameView("area", {chart: "area"});\\ndense = AnalysisFrameView("dense", {chart: "line"});\\ndataset = DatasetView("dataset", {chart: "line", encoding: {axis: "category", values: ["value"]}});\\ndomain = AnalysisFrameView("domain", {chart: "comparison"});';
window.selections = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program, title: 'Chart tooltip', locale: 'en-US', resources,
  askPoint: async (selection) => { window.selections.push(selection); }
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
    '<!doctype html><meta charset="utf-8"><body style="width:900px;margin:0"><div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="line"] .recharts-line-dots circle').first().waitFor()
})

after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

async function checkSurface(name: string) {
  const card = page.locator(`[data-resource="${name}"]`)
  const svg = card.locator('svg.recharts-surface').first()
  await svg.waitFor()
  assert.ok((await svg.getAttribute('aria-label'))?.length)
  assert.equal(await svg.getAttribute('role'), 'application')
  assert.ok((await card.locator('.fv-plot').first().getAttribute('aria-label'))?.length)
  return card
}

test('Frame line and area expose accessible points with saved identities', async () => {
  for (const name of ['line', 'area']) {
    const card = await checkSurface(name)
    const point = card.locator('[data-frame-point="0:m0"]').first()
    assert.match((await point.getAttribute('aria-label')) ?? '', /m0: 1\.00/)
    await point.focus()
    assert.equal(await point.evaluate((node) => node === document.activeElement), true)
    await page.keyboard.press('Enter')
    await page.getByRole('menu').getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'selections')), [
      { resourceName: name, row: 0, field: 'm0' },
    ])
    await page.evaluate(() => Reflect.set(window, 'selections', []))
  }
})

test('Dataset and domain charts expose accessible roots', async () => {
  await checkSurface('dataset')
  await checkSurface('domain')
})

test('dense line exposes an accessible summary', async () => {
  await checkSurface('dense')
})
