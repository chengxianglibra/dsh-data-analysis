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

test('attribution keeps saved periods, contributions and exact point selection', async () => {
  const card = page.locator('[data-resource="attribution"]')
  const region = card.locator('.fv-decomposition-details')
  const row = region.locator('tbody tr').first()
  assert.deepEqual(await row.locator('.fv-decomposition-field-label').allTextContents(), [
    'Baseline',
    'Current',
    'Contribution',
    'Contribution share',
  ])
  assert.match(await row.innerText(), /3,907,565/)
  assert.match(await row.innerText(), /3,650,127/)
  assert.match(await row.innerText(), /-257,438,678/)
  assert.equal(await region.locator('[data-frame-point="1:current"]').count(), 0)
  await row.locator('[data-frame-point="0:contribution"]').click()
  await page.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'requests')), [
    { resourceName: 'attribution', row: 0, field: 'contribution' },
  ])
})
