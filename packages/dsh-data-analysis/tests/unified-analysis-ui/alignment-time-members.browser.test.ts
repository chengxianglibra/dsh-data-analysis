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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-alignment-members-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { frame, observedMetric, paired, token } from './tests/unified-analysis-ui/frame-fixtures.ts';
import { parseAnalysisSnapshot } from './src/presentation/contracts/snapshot.ts';
const make = (periods, members, leftPresence) => frame({
  axes: [{name:'period',variant:paired,keys:periods}, {name:'region',keys:members}],
  values: [
    {name:'left',values:periods.map((_,i)=>10+i*10),context:observedMetric('sales')},
    {name:'right',values:periods.map((_,i)=>11+i*10),context:observedMetric('sales')},
    {name:'left_present',type:'boolean',values:leftPresence,presence:true},
    {name:'right_present',type:'boolean',values:periods.map(()=>true),presence:true},
  ],
  alignments: [{left:{values:['left'],presence:['left_present'],coordinates:[{kind:'axis',axisToken:token('period'),endpoint:'self'}]},right:{values:['right'],presence:['right_present'],coordinates:[{kind:'axis',axisToken:token('period'),endpoint:'self'}]}}],
});
const members=make(['p0','p0','p1','p1','p2'],['A','B','A','B','B'],[true,true,true,false,true]);
const duplicate=make(['p0','p0'],['A','A'],[true,false]);
const shared=make(['p0','p0','p0'],['A','A','A'],[false,false,false]);
shared.frame.sections.interpretation.alignments[0].right.values=['left'];
shared.data.rows[2][shared.data.columns.findIndex(column=>column.id==='right_present')]=false;
parseAnalysisSnapshot(shared);
const sameLabel=make(['p0','p0'],['A','—'],[true,true]);
sameLabel.data.rows[0][1]=null;
sameLabel.data.columns[1].nullable=true;
sameLabel.frame.coordinates.k_region.values[0]=null;
sameLabel.frame.coordinates.k_region.column.nullable=true;
sameLabel.frame.axes[1].keys[0].nullable=true;
sameLabel.frame.slots.find(slot=>slot.id==='region').nullable=true;
parseAnalysisSnapshot(sameLabel);
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([a, b, c, d]);\\na = AnalysisFrameView("members");\\nb = AnalysisFrameView("duplicate");\\nc = AnalysisFrameView("sameLabel");\\nd = AnalysisFrameView("shared");',
  title:'Alignment', locale:'en-US', resources:{members:resource(members),duplicate:resource(duplicate),sameLabel:resource(sameLabel),shared:resource(shared)},
  askPoint:async () => {},
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
    '<div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="members"] [data-alignment-pair]').first().waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

test('paired alignment plots each member and binds sparse points to their original rows', async () => {
  const card = page.locator('[data-resource="members"]')
  const plots = card.locator('[data-alignment-pair]')
  assert.equal(await plots.count(), 2)
  assert.match(await card.innerText(), /Panels use independent scales/)
  assert.deepEqual(await plots.locator('h4').allTextContents(), ['A', 'B'])
  for (const row of [0, 1, 2, 4]) {
    assert.equal(await card.locator(`[data-frame-point="${row}:left"]`).count(), 1)
    assert.equal(await card.locator(`[data-frame-point="${row}:right"]`).count(), 1)
  }
  assert.equal(await card.locator('[data-frame-point="3:left"]').count(), 0)
  assert.equal(await card.locator('[data-frame-point="3:right"]').count(), 1)
  assert.equal(await plots.nth(0).locator('[data-mark="hollow"], [data-mark="filled"]').count(), 4)
  assert.equal(await plots.nth(1).locator('[data-mark="hollow"], [data-mark="filled"]').count(), 5)
})

test('duplicate full coordinates fall back to a table retaining both saved rows', async () => {
  const card = page.locator('[data-resource="duplicate"]')
  assert.equal(await card.locator('[data-alignment-pair]').count(), 0)
  const rows = card.locator('.pr-table tbody tr')
  assert.equal(await rows.count(), 2)
  assert.match(await rows.nth(0).innerText(), /10\.00/)
  assert.doesNotMatch(await rows.nth(1).innerText(), /20\.00/)
  assert.match(await rows.nth(1).innerText(), /21\.00/)
})

test('distinct saved keys with the same displayed label do not merge', async () => {
  const card = page.locator('[data-resource="sameLabel"]')
  const plots = card.locator('[data-alignment-pair]')
  assert.equal(await plots.count(), 2)
  assert.deepEqual(await plots.locator('h4').allTextContents(), ['—', '—'])
  for (const row of [0, 1]) {
    assert.equal(await card.locator(`[data-frame-point="${row}:left"]`).count(), 1)
    assert.equal(await card.locator(`[data-frame-point="${row}:right"]`).count(), 1)
  }
})

test('duplicate coordinates preserve a shared field when either side is present', async () => {
  const card = page.locator('[data-resource="shared"]')
  assert.equal(await card.locator('[data-alignment-pair]').count(), 0)
  const rows = card.locator('.pr-table tbody tr')
  assert.equal(await rows.count(), 3)
  assert.match(await rows.nth(0).innerText(), /10\.00/)
  assert.match(await rows.nth(1).innerText(), /20\.00/)
  assert.doesNotMatch(await rows.nth(2).innerText(), /30\.00/)
  assert.equal(await rows.nth(0).locator('td').count(), 3)
})
