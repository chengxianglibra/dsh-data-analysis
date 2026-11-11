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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-chart-controls-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { align, categoryAxis, frame, observed, statistic } from './tests/unified-analysis-ui/frame-fixtures.ts';
const paired = align(categoryAxis(4));
for (const [i, value] of [1, 2, 3, 100].entries()) for (const name of ['left.revenue', 'right.revenue']) paired.data.rows[i][paired.data.columns.findIndex(c => c.id === name)] = value;
paired.data.rows[1][paired.data.columns.findIndex(c => c.id === 'left_present')] = false;
const bars = frame({axes:[categoryAxis(15)], values:[
  {name:'trips',values:Array.from({length:15}, (_,i)=>100-i),context:observed()},
  {name:'fare',type:'decimal',values:Array.from({length:15}, (_,i)=>i===1 ? '1'.repeat(120) + '.12' : String(1000-i)),context:observed()},
  {name:'average',values:Array(15).fill(42),context:statistic('mean',[])},
]});
for (const col of bars.data.columns) if (col.id === 'fare' || col.id === 'average') col.unit='USD';
const resource = snapshot => ({kind:'snapshot', declaration:{kind:'frame-snapshot',snapshotRef:'ref'}, snapshot, binding:{workspaceId:'w'}});
window.selections=[];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([a, b]);\\na = AnalysisFrameView("paired");\\nb = AnalysisFrameView("bars", {chart: "auto"}, {height: 200});',
  title:'Charts', locale:'en-US', resources:{paired:resource(paired), bars:resource(bars)},
  askPoint:async selection => {window.selections.push(selection)},
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
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="paired"] .fv-alignment-controls').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

test('alignment switches saved metrics and preserves row identity across independent scales', async () => {
  const card = page.locator('[data-resource="paired"]')
  const controls = card.locator('.fv-alignment-controls button')
  assert.equal(await controls.count(), 2)
  assert.equal(await controls.first().getAttribute('aria-pressed'), 'true')
  assert.equal(await card.locator('.fv-chart svg').count(), 2)
  assert.match(await card.locator('.fv-alignment-facets').innerText(), /independent scales/i)
  const firstLabels = await card.locator('[data-chart-end-label]').allTextContents()
  assert.match(firstLabels[0]!, /100\.00/)
  assert.equal(firstLabels.length, 4)
  assert.equal(await card.locator('[data-frame-point="1:left.revenue"]').count(), 0)
  assert.equal(await card.locator('[data-frame-point="1:right.revenue"]').count(), 1)
  await controls.nth(1).click()
  assert.equal(await controls.nth(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await card.locator('[data-frame-point="1:left.orders"]').count(), 0)
  assert.equal(await card.locator('[data-frame-point="1:right.orders"]').count(), 1)
  assert.equal(await card.locator('[data-frame-point="1:right.revenue"]').count(), 0)
})

test('horizontal chart numeric and category ticks use theme secondary text color', async () => {
  const card = page.locator('[data-resource="bars"]')
  await card.evaluate((element) =>
    (element as HTMLElement).style.setProperty('--muted-foreground', 'rgb(170, 180, 190)'),
  )
  for (const selector of [
    '.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value',
    '[data-row-label] text',
  ]) {
    const tick = card.locator(selector).first()
    await tick.waitFor({ state: 'attached' })
    assert.equal(
      await tick.evaluate((element) => getComputedStyle(element).fill),
      'rgb(170, 180, 190)',
    )
  }
  await card.evaluate((element) =>
    (element as HTMLElement).style.removeProperty('--muted-foreground'),
  )
})

test('horizontal metric selection retains same-unit references and all rows within the requested height', async () => {
  const card = page.locator('[data-resource="bars"]')
  const controls = card.locator('.fv-hbar-controls button')
  assert.equal(await controls.count(), 2)
  assert.equal(await card.locator('[data-mark="bar"]').count(), 15)
  const side = card.locator('[data-hbar-side-values]')
  assert.equal(await side.locator('[data-frame-point="0:fare"]').count(), 1)
  assert.match((await side.textContent()) ?? '', /1,000/)
  const longValue = side.locator('[data-frame-point="1:fare"]')
  assert.match((await longValue.getAttribute('aria-label')) ?? '', /^r1 · fare.*: /)
  assert.match((await longValue.textContent()) ?? '', /111,111,111/)
  const fits = await longValue.locator('text').evaluate((text) => {
    const bounds = text.getBoundingClientRect()
    const svg = text.closest('svg')!.getBoundingClientRect()
    return bounds.right <= svg.right + 1
  })
  assert.equal(fits, true)
  assert.ok(
    await card
      .locator('.fv-plot')
      .first()
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  )
  await controls.nth(1).click()
  assert.equal(await controls.nth(1).getAttribute('aria-pressed'), 'true')
  assert.equal(await card.locator('[data-mark="bar"]').count(), 15)
  assert.equal(await card.locator('.mv-broadcast-reference').count(), 1)
  assert.equal(await card.locator('[data-frame-point="0:fare"]').count(), 1)
  assert.equal(await side.locator('[data-frame-point="0:trips"]').count(), 1)
  const size = await card.locator('.fv-hbar-controls + section').evaluate((node) => ({
    height: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }))
  assert.equal(size.height, 200)
  assert.ok(size.scrollHeight > size.height)
  assert.match((await card.locator('.recharts-label-list').first().textContent()) ?? '', /1,000/)
})
