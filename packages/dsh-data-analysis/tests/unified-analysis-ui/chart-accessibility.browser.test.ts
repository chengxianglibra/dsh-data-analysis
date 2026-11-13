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
import { frame, observeTime, compareCalendar, token, value, observed, categoryAxis } from './tests/unified-analysis-ui/frame-fixtures.ts';
const resource = (snapshot) => ({ kind: 'snapshot', declaration: {
  kind: snapshot.kind === 'frame' ? 'frame-snapshot' : 'dataset-snapshot', snapshotRef: 'ref'
}, snapshot, binding: { workspaceId: 'w' } });
const keys = ['2026-11-10T05:00:00.000000+08:00','2026-11-10T06:00:00.000000+08:00'];
const hourly = frame({ axes: [{name:'hour', type:'datetime', keys, variant:{kind:'calendar',timezone:'Asia/Shanghai',grain:{kind:'builtin',unit:'hour',step:1}}}],
  values:[value('m0',2,observed())], periods:[{target:{kind:'axis',axisToken:token('hour')}, totalCount:2,hasMore:false,
    items:keys.map(key=>({kind:'calendar',key:[key],label:key,timezone:'Asia/Shanghai',selection:'full',cutoff:null}))}] });
const heatmap = frame({axes:[{name:'hour',type:'datetime',keys,variant:{kind:'calendar',timezone:'Asia/Shanghai',grain:{kind:'builtin',unit:'hour',step:1}}},categoryAxis(2)],
  values:[value('m0',2,observed())]});
const dataset = datasetSnapshot([[keys[0],'1'],['2026-11-10T05:00:00.012300+08:00','2']],[
  {id:'timestamp',label:'Timestamp',type:'datetime',nullable:false},{id:'value',label:'Value',type:'decimal',nullable:false}]);
const datasetHeatmap = datasetSnapshot([[keys[0],'A','1'],[keys[1],'B','2']],[
  {id:'timestamp',label:'Timestamp',type:'datetime',nullable:false},{id:'group',label:'Group',type:'string',nullable:false},
  {id:'value',label:'Value',type:'decimal',nullable:false}]);
const resources = {line: resource(observeTime(3)), area: resource(observeTime(3)),
  bar: resource(hourly), heatmap: resource(heatmap), formattedHeatmap: resource(heatmap), datasetHeatmap: resource(datasetHeatmap), dense: resource(observeTime(2001)), dataset: resource(dataset),
  domain: resource(compareCalendar(6))};
const program = 'root = Stack([line, area, bar, heatmap, formattedHeatmap, datasetHeatmap, dense, dataset, domain]);\\nline = AnalysisFrameView("line", {chart: "line"});\\narea = AnalysisFrameView("area", {chart: "area"});\\nbar = AnalysisFrameView("bar", {chart: "bar"});\\nheatmap = AnalysisFrameView("heatmap", {chart: "heatmap",encoding:{x:"hour",y:"region",value:"m0"}});\\nformattedHeatmap = AnalysisFrameView("formattedHeatmap", {chart:"heatmap",encoding:{x:"hour",y:"region",value:"m0"}}, {time:{tickFormat:"date-time",showTimezone:false}});\\ndatasetHeatmap = DatasetView("datasetHeatmap", {chart:"heatmap",encoding:{x:"timestamp",y:"group",value:"value"}}, {time:{tickFormat:"date-time",showTimezone:false}});\\ndense = AnalysisFrameView("dense", {chart: "line"});\\ndataset = DatasetView("dataset", {chart: "line", encoding: {axis: "timestamp", values: ["value"]}});\\ndomain = AnalysisFrameView("domain", {chart: "comparison"});';
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

test('time chart ticks use the theme secondary text color', async () => {
  const card = page.locator('[data-resource="line"]')
  await card.evaluate((element) =>
    (element as HTMLElement).style.setProperty('--muted-foreground', 'rgb(170, 180, 190)'),
  )
  for (const selector of [
    '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
    '[data-tick] text',
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

test('hourly bars show one hover tooltip at the same grain as the tick', async () => {
  const card = await checkSurface('bar')
  const bar = card.locator('[data-mark="bar"]').first()
  await bar.hover()
  const tooltip = card.locator('.recharts-tooltip-wrapper')
  await tooltip.getByText('2026-11-10 05:00 +08:00 · Full period', { exact: true }).waitFor()
  assert.equal(await tooltip.count(), 1)
  assert.equal(await bar.locator('title').count(), 0)
  assert.equal(await card.locator('[data-time-cursor] text').count(), 0)
  assert.equal(await card.locator('[data-tick="11-10 05:00"] text').textContent(), '11-10 05:00')
  assert.match(
    (await card.locator('[data-frame-point="0:m0"]').getAttribute('aria-label')) ?? '',
    /2026-11-10 05:00 \+08:00/,
  )
})

test('heatmap hover uses the declared hour and one tooltip', async () => {
  const card = await checkSurface('heatmap')
  const cell = card.locator('[data-mark="cell"]').first()
  await cell.hover()
  const tooltip = card.locator('.recharts-tooltip-wrapper')
  await tooltip.getByText('2026-11-10 05:00 +08:00 · r0', { exact: true }).waitFor()
  assert.equal(await cell.locator('title').count(), 0)
})

test('explicit time formatting also applies to heatmaps without captured periods', async () => {
  for (const [name, group] of [
    ['formattedHeatmap', 'r0'],
    ['datasetHeatmap', 'A'],
  ]) {
    const card = await checkSurface(name!)
    const label = card.locator('[data-heatmap-column="2026-11-10 05:00"]')
    assert.equal(await label.count(), 1)
    assert.equal(await card.locator('[data-mark="cell"]').count(), 2)
    await card.locator('[data-mark="cell"]').first().hover()
    await card
      .locator('.recharts-tooltip-wrapper')
      .getByText(new RegExp(`2026-11-10T05:00:00\\.000000\\+08:00 · ${group}`))
      .waitFor()
  }
})

test('Dataset and domain charts expose accessible roots', async () => {
  const dataset = await checkSurface('dataset')
  const timestamp = await dataset.locator('svg.recharts-surface').first().getAttribute('aria-label')
  assert.match(timestamp ?? '', /2026-11-10T05:00:00\+08:00/)
  assert.match(timestamp ?? '', /2026-11-10T05:00:00\.0123\+08:00/)
  await checkSurface('domain')
})

test('dense line exposes an accessible summary', async () => {
  await checkSurface('dense')
})
