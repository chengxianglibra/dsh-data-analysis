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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-responsive-frame-'))
  await build({
    stdin: {
      contents: `import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
import {frame, categoryAxis, timeAxis, observed, comparisonOf, decompositionOf} from './tests/unified-analysis-ui/frame-fixtures.ts';
const facts=decompositionOf([['contribution','contribution'],['total','total'],['share','share'],['current','current'],['baseline','baseline']]);
facts.target={kind:'absolute',comparison:0,group:'sales'};
facts.outputs.push({fieldKind:'presence',role:'current_present',name:'current_present'});
const attribution=frame({axes:[{name:'region',keys:['A very long regional member name that must wrap safely','Other']}],values:[
 {name:'contribution',values:[-257438678,null]}, {name:'total',values:[-257438678,-257438678]}, {name:'share',values:[1,null]},
 {name:'current',values:[3650127,999999999]}, {name:'baseline',values:[3907565,12]},
 {name:'current_present',type:'boolean',values:[true,false],presence:true}
],comparisons:[comparisonOf({kind:'ordinary'},[{name:'sales',values:[]}])],decompositions:[facts]});
attribution.data.columns.find(c=>c.id==='contribution').label='contribution.previous.absolute.revenue';
attribution.data.columns.find(c=>c.id==='share').label='contribution_share.previous.absolute.revenue';
const months=frame({axes:[timeAxis(12)],values:[{name:'trips',values:[1,2,3,4,5,6,7,8,9,10,11,12],context:observed()}]});
const regions=frame({axes:[{...categoryAxis(2),keys:['An exceptionally long region name that remains in the title','Other']}],values:[{name:'trips',values:[187466,123456789],context:observed()}]});
const res=snapshot=>({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
window.requests=[];createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer,{title:'Width',locale:'en-US',resources:{attribution:res(attribution),months:res(months),regions:res(regions)},program:'root = Stack([a, b, c]);\\na = AnalysisFrameView("attribution");\\nb = AnalysisFrameView("months", {chart:"bar"});\\nc = AnalysisFrameView("regions");',askPoint:async x=>window.requests.push(x)}));`,
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
  page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="attribution"] .fv-decomposition-table').waitFor()
  await page.locator('[data-resource="regions"] svg.recharts-surface').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

test('narrow attribution keeps both periods, contribution, share, direction and exact selection visible', async () => {
  const card = page.locator('[data-resource="attribution"]')
  const region = card.locator('.fv-decomposition-details')
  const row = region.locator('tbody tr').first()
  assert.ok((await region.evaluate((e) => e.scrollWidth - e.clientWidth)) <= 1)
  assert.ok((await row.locator('.fv-decomposition-track').boundingBox())!.width >= 80)
  assert.deepEqual(await row.locator('.fv-decomposition-field-label').allTextContents(), [
    'Baseline',
    'Current',
    'Contribution',
    'Contribution share',
  ])
  assert.match(await row.innerText(), /3,907,565/)
  assert.match(await row.innerText(), /3,650,127/)
  assert.match(await row.innerText(), /-257,438,678/)
  const value = row.locator('[data-frame-point="0:contribution"]')
  const lines = await value.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getClientRects().length
  })
  assert.equal(lines, 1, 'the full contribution stays on one line')
  assert.equal(await region.locator('[data-frame-point="1:current"]').count(), 0)
  await row.locator('[data-frame-point="0:contribution"]').click()
  await page.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'requests')), [
    { resourceName: 'attribution', row: 0, field: 'contribution' },
  ])
})

test('narrow attribution scrolls rather than breaking a long contribution', async () => {
  await page.setViewportSize({ width: 190, height: 900 })
  const region = page.locator('[data-resource="attribution"] .fv-decomposition-details')
  const value = region.locator('[data-frame-point="0:contribution"]')
  assert.equal(
    await value.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    }),
    1,
  )
  const bounds = await region
    .locator('tbody tr')
    .first()
    .evaluate((row) => {
      const track = row.querySelector('.fv-decomposition-track')!.getBoundingClientRect()
      const amount = row
        .querySelector('[data-frame-point="0:contribution"]')!
        .getBoundingClientRect()
      return { trackRight: track.right, amountLeft: amount.left }
    })
  assert.ok(bounds.trackRight <= bounds.amountLeft, JSON.stringify(bounds))
  assert.ok(await region.evaluate((element) => element.scrollWidth > element.clientWidth))
  await region.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  const visible = await value.evaluate((element) => {
    const region = element.closest('.fv-decomposition-details')!.getBoundingClientRect()
    const amount = element.getBoundingClientRect()
    return amount.left >= region.left && amount.right <= region.right + 1
  })
  assert.ok(visible, 'scrolling exposes the entire contribution')
  await page.setViewportSize({ width: 390, height: 900 })
})

test('twelve monthly bars and long-label horizontal bars adapt to a 390px viewport', async () => {
  for (const name of ['months', 'regions']) {
    const card = page.locator(`[data-resource="${name}"]`)
    const plot = card.locator('.fv-plot')
    await page
      .waitForFunction(
        (resource) => {
          const element = document.querySelector(`[data-resource="${resource}"] .fv-plot`)
          return !!element && element.scrollWidth <= element.clientWidth + 1
        },
        name,
        { timeout: 3000 },
      )
      .catch(async () => {
        const size = await plot.evaluate((e) => ({
          client: e.clientWidth,
          scroll: e.scrollWidth,
          html: e.outerHTML.slice(0, 500),
        }))
        throw new Error(`${name}: ${JSON.stringify(size)}`)
      })
    assert.ok((await plot.evaluate((e) => e.scrollWidth - e.clientWidth)) <= 1)
  }
  assert.equal(await page.locator('[data-resource="months"] [data-mark="bar"]').count(), 12)
  const region = page.locator('[data-resource="regions"]')
  assert.equal(await region.locator('[data-mark="bar"]').count(), 2)
  assert.match(
    (await region.locator('[data-row-label] title').first().textContent()) ?? '',
    /exceptionally long region/,
  )
  assert.match((await region.locator('.recharts-label-list').textContent()) ?? '', /123,456,789/)
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1,
  )
})

test('a single decomposition parent fills a wide card', async () => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const parents = page.locator('[data-resource="attribution"] .fv-parents')
  const parent = parents.locator('.fv-parent')
  assert.equal(await parent.count(), 1)
  const widths = await parents.evaluate((element) => ({
    available: element.getBoundingClientRect().width,
    parent: element.firstElementChild!.getBoundingClientRect().width,
  }))
  assert.ok(widths.available > 1280)
  assert.ok(Math.abs(widths.available - widths.parent) < 1, JSON.stringify(widths))
})
