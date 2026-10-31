import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('selected point details remove only provably duplicate coordinates', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-frame-details-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { parseAnalysisSnapshot } from './src/presentation/contracts/snapshot.ts';
import { frame, correlate, members } from './tests/unified-analysis-ui/frame-fixtures.ts';
const normal = frame({axes:[{name:'pickup_borough',keys:['Bronx']},{name:'payment_type',keys:['Cash']}],
  values:[{name:'trips',type:'int64',values:['9007199254740993']}]});
normal.frame.description = 'January taxi trips';
normal.frame.sections.periods = {status:'unavailable',reason:'read-failed'};
for (const axis of normal.frame.axes) {
  const key = axis.keys[0]; key.id = 'taxi.' + axis.name;
  normal.frame.slots.find(slot => slot.slotId === key.slotId).id = key.id;
  normal.frame.coordinates[key.slotId].column.id = key.id;
}
parseAnalysisSnapshot(normal);
const compact = structuredClone(normal);
const time = frame({axes:[{name:'month',type:'datetime',keys:['2025-01-01T00:00:00-05:00']}],
  values:[{name:'trips',type:'int64',values:['562']}]});
time.frame.coordinates.k_month.values[0] = '2025-01-01T05:00:00+00:00';
const multi = frame({axes:[{name:'pair',keys:['same']}],values:[{name:'trips',values:[3]}]});
const key = {id:'pair.second',slotId:'k_second',dtype:{type:'string'},nullable:false,unit:null};
multi.frame.axes[0].keys.push(key); multi.frame.slots.push(key);
multi.frame.coordinates.k_second = {column:{id:'pair.second',label:'pair.second',type:'string',nullable:false},values:['same']};
parseAnalysisSnapshot(multi);
const endpoint = frame({axes:[{name:'month',type:'datetime',keys:['2025-02-01T00:00:00+00:00']}],values:[{name:'trips',values:[1]}]});
endpoint.frame.layout[0].endpoint = 'left';
parseAnalysisSnapshot(endpoint);
const start = frame({axes:[{name:'month',type:'datetime',keys:['2025-03-01T00:00:00+00:00']}],values:[{name:'trips',values:[1]}]});
start.frame.layout[0].part = 'start';
parseAnalysisSnapshot(start);
const membersFull = members();
const membersPartial = frame({axes:[{name:'region',role:'identity',keys:['A','B']}],totalRows:4});
const membersEmpty = frame({axes:[{name:'region',role:'identity',keys:[]}]});
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
const resources = {normal:resource(normal),compact:resource(compact),time:resource(time),multi:resource(multi),endpoint:resource(endpoint),start:resource(start),corr:resource(correlate(true)),membersFull:resource(membersFull),membersPartial:resource(membersPartial),membersEmpty:resource(membersEmpty)};
window.requests = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([a,b,c,d,e,f,g,h,i,j]);\\na = AnalysisFrameView("normal",{chart:"table"});\\nb = AnalysisFrameView("compact",{chart:"table"},{density:"compact"});\\nc = AnalysisFrameView("time",{chart:"table"});\\nd = AnalysisFrameView("multi",{chart:"table"});\\ne = AnalysisFrameView("corr");\\nf = AnalysisFrameView("endpoint",{chart:"table"});\\ng = AnalysisFrameView("start",{chart:"table"});\\nh = AnalysisFrameView("membersFull");\\ni = AnalysisFrameView("membersPartial");\\nj = AnalysisFrameView("membersEmpty");',
  title:'Details',locale:'en-US',resources,askPoint:async request => {window.requests.push(request)}
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
      '<!doctype html><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)

    const normal = page.locator('[data-resource="normal"]')
    await normal.locator('[data-column-id="trips"] .pr-cell-select').click()
    const details = normal.getByRole('region', { name: 'Selected data' })
    assert.equal(await normal.getByText('January taxi trips', { exact: true }).count(), 1)
    assert.equal(await details.getByText('Bronx', { exact: true }).count(), 1)
    assert.equal(await details.getByText('Cash', { exact: true }).count(), 1)
    assert.equal(
      await details.locator('dt[title="taxi.pickup_borough"]').textContent(),
      'pickup_borough',
    )
    assert.equal(
      await details.locator('dt[title="taxi.payment_type"]').textContent(),
      'payment_type',
    )
    assert.equal(await details.locator('dl > div').count(), 3)
    await details.getByText('9007199254740993', { exact: true }).waitFor()
    const period = details.locator('.fv-period-unavailable summary')
    assert.equal(await period.textContent(), 'Period unavailable')
    assert.equal(
      await period.getAttribute('aria-label'),
      'Period details were not captured; do not infer missing periods.',
    )
    await period.focus()
    await page.keyboard.press('Enter')
    await details.locator('.fv-period-unavailable > p').waitFor({ state: 'visible' })
    await details.getByRole('button', { name: 'Add to question' }).click()
    await details.getByText('Added to the question draft.').waitFor()
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'requests')), [
      { resourceName: 'normal', row: 0, field: 'trips' },
    ])

    const compact = page.locator('[data-resource="compact"]')
    await compact.locator('[data-column-id="trips"] .pr-cell-select').click()
    assert.equal(await compact.locator('.fv-desc').count(), 0)
    await compact
      .getByRole('region', { name: 'Selected data' })
      .getByText('January taxi trips')
      .waitFor()

    const time = page.locator('[data-resource="time"]')
    await time.locator('[data-column-id="trips"] .pr-cell-select').click()
    const timeDetails = time.getByRole('region', { name: 'Selected data' })
    await timeDetails.getByText('2025-01-01T00:00:00-05:00', { exact: true }).waitFor()
    await timeDetails.getByText('2025-01-01T05:00:00+00:00', { exact: true }).waitFor()

    const multi = page.locator('[data-resource="multi"]')
    await multi.locator('[data-column-id="trips"] .pr-cell-select').click()
    assert.equal(
      await multi
        .getByRole('region', { name: 'Selected data' })
        .getByText('same', { exact: true })
        .count(),
      3,
    )

    const endpoint = page.locator('[data-resource="endpoint"]')
    await endpoint.locator('[data-column-id="trips"] .pr-cell-select').click()
    assert.equal(
      await endpoint
        .getByRole('region', { name: 'Selected data' })
        .getByText('2025-02-01T00:00:00+00:00', { exact: true })
        .count(),
      2,
    )
    const start = page.locator('[data-resource="start"]')
    await start.locator('[data-column-id="trips"] .pr-cell-select').click()
    assert.equal(
      await start
        .getByRole('region', { name: 'Selected data' })
        .getByText('2025-03-01T00:00:00+00:00', { exact: true })
        .count(),
      2,
    )

    const correlation = page.locator('[data-resource="corr"]')
    await correlation.locator('g[role="button"]').first().click()
    const correlationDetails = correlation.getByRole('region', { name: 'Selected data' })
    await correlationDetails.getByText('n_pairs', { exact: true }).waitFor()
    await correlationDetails.getByText('30', { exact: true }).waitFor()
    const tableToggle = correlation.locator('details.fv-table > summary')
    assert.equal(await tableToggle.getAttribute('aria-label'), 'Table')
    assert.equal(await tableToggle.locator('svg[aria-hidden="true"]').count(), 1)
    await tableToggle.focus()
    await page.keyboard.press('Enter')
    assert.equal(await correlation.locator('details.fv-table').getAttribute('open'), '')

    const fullMembers = page.locator('[data-resource="membersFull"]')
    assert.equal(await fullMembers.getByText('3', { exact: true }).count(), 1)
    assert.equal(await fullMembers.locator('.pr-table > p').count(), 0)
    const partialMembers = page.locator('[data-resource="membersPartial"]')
    assert.equal(
      await partialMembers.locator('.pr-table > p').textContent(),
      'Showing 2 / 4 rows (truncated)',
    )
    const emptyMembers = page.locator('[data-resource="membersEmpty"]')
    assert.equal(await emptyMembers.locator('.pr-table > p').textContent(), 'No data')
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
