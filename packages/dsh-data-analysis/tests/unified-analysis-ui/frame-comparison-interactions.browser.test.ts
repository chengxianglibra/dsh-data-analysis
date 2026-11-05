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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-comparison-interactions-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { frame, comparisonOf, comparedRoles, comparedSinglePeriodMultiGroup } from './tests/unified-analysis-ui/frame-fixtures.ts';
const roles = comparedRoles('sales');
const comparison = { ...comparisonOf({kind:'ordinary'}, [{name:'sales', values:roles}]), presence: {current:'current.present', baseline:'baseline.present', enclosing:[]} };
const category = frame({
  axes: [{name:'region', keys:['Manhattan', 'Queens', 'Brooklyn', 'Absent', 'Zero baseline']}],
  values: [
    {name:'sales', values:[3650127, 439031, 188423, 9, 5]},
    {name:'prior.baseline.sales', values:[3907565, 454009, 180940, 111, 0]},
    {name:'prior.absolute.sales', values:[-257439, -14978, 7483, 99, 5]},
    {name:'prior.relative.sales', values:[-.0658, -.20, .0414, .99, null]},
    {name:'current.present', type:'boolean', values:[true,true,true,true,true], presence:true},
    {name:'baseline.present', type:'boolean', values:[true,true,true,false,true], presence:true},
  ], comparisons:[comparison],
});
const kpi = comparedSinglePeriodMultiGroup();
for (const [name, val] of Object.entries({'sales':118393545.05, 'prior.baseline.sales':123430419.10, 'prior.absolute.sales':-5036874.05, 'prior.relative.sales':-.0408})) {
  kpi.data.rows[0][kpi.data.columns.findIndex(column => column.id === name)] = val;
}
const switching = frame({
  axes: [{name:'region', keys:['First', 'Second']}],
  values: [
    {name:'sales', values:[10, 20]},
    {name:'a.baseline.sales', values:[13, 24]},
    {name:'a.absolute.sales', values:[-3, -4]},
    {name:'a.relative.sales', values:[-.3, -.1]},
    {name:'b.absolute.sales', values:[-1, -10]},
  ],
  comparisons: [
    {...comparisonOf({kind:'ordinary'}, [{name:'sales', values:[['current','sales'],['baseline','a.baseline.sales'],['absolute','a.absolute.sales'],['relative','a.relative.sales']]}]), alias:'A'},
    {...comparisonOf({kind:'ordinary'}, [{name:'sales', values:[['current','sales'],['absolute','b.absolute.sales']]}]), alias:'B'},
  ],
});
const unavailableDelta = (absolute, current, baselinePresent) => frame({
  axes:[{name:'region', keys:['First','Second']}],
  values:[
    {name:'sales', values:current},
    {name:'prior.baseline.sales', values:[9,19]},
    {name:'prior.absolute.sales', values:absolute},
    {name:'current.present', type:'boolean', values:[true,true], presence:true},
    {name:'baseline.present', type:'boolean', values:baselinePresent, presence:true},
  ],
  comparisons:[{...comparisonOf({kind:'ordinary'}, [{name:'sales', values:comparedRoles('sales',['current','baseline','absolute'])}]), presence:{current:'current.present',baseline:'baseline.present',enclosing:[]}}],
});
const nullDelta = unavailableDelta([null,null], [10,20], [true,true]);
const maskedDelta = unavailableDelta([2,null], [10,20], [false,true]);
const missingEndpoint = unavailableDelta([2,null], [null,20], [true,true]);
const hugeDecimal = frame({
  axes:[{name:'region', keys:['Larger','Missing','Negative','Smaller']}],
  values:[
    {name:'sales', values:[1,1,1,1]},
    {name:'prior.baseline.sales', values:[1,1,1,1]},
    {name:'prior.absolute.sales', type:'decimal', values:['2e400',null,'-1e400','1e400']},
  ],
  comparisons:[comparisonOf({kind:'ordinary'}, [{name:'sales', values:comparedRoles('sales',['current','baseline','absolute'])}])],
});
const resource = snapshot => ({kind:'snapshot', declaration:{kind:'frame-snapshot', snapshotRef:'ref'}, snapshot, binding:{workspaceId:'w'}});
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([category, kpi, switching, nullDelta, maskedDelta, missingEndpoint, explicitNullDelta, hugeDecimal], "column");\\ncategory = AnalysisFrameView("category");\\nkpi = AnalysisFrameView("kpi");\\nswitching = AnalysisFrameView("switching", {chart: "comparison", encoding: {value: "a.baseline.sales"}});\\nnullDelta = AnalysisFrameView("nullDelta");\\nmaskedDelta = AnalysisFrameView("maskedDelta");\\nmissingEndpoint = AnalysisFrameView("missingEndpoint");\\nexplicitNullDelta = AnalysisFrameView("explicitNullDelta", {chart: "comparison", style: "delta"});\\nhugeDecimal = AnalysisFrameView("hugeDecimal");',
  title:'Comparison interactions', locale:'en-US', resources:{category:resource(category), kpi:resource(kpi), switching:resource(switching), nullDelta:resource(nullDelta), maskedDelta:resource(maskedDelta), missingEndpoint:resource(missingEndpoint), explicitNullDelta:resource(nullDelta), hugeDecimal:resource(hugeDecimal)}, askPoint: async () => {},
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
    '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="category"]').waitFor()
  await page.locator('[data-resource="kpi"]').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

const category = () => page.locator('[data-resource="category"]')
const kpi = () => page.locator('[data-resource="kpi"]')

test('comparison offers saved deltas with both endpoints and keeps an absent baseline masked', async () => {
  const view = category().locator('[data-comparison-rows="delta"]')
  await view.waitFor()
  const text = await view.innerText()
  for (const value of [
    'Manhattan',
    '3,650,127',
    '3,907,565',
    '257,439',
    '6.58%',
    'Brooklyn',
    '7,483',
    '4.14%',
  ]) {
    assert.ok(text.includes(value), `missing ${value}: ${text}`)
  }
  // Deliberately inconsistent saved deltas must be shown, never recomputed from endpoints.
  assert.ok(!text.includes('257,438'))
  const zero = view.getByText('Zero baseline', { exact: true }).locator('xpath=ancestor::tr')
  assert.match(await zero.innerText(), /0\.00.*5\.00.*—/s)
  // The absent baseline and its saved changes are not evidence for a comparison.
  const absent = view.getByText('Absent', { exact: true }).locator('xpath=ancestor::tr')
  assert.doesNotMatch(await absent.innerText(), /111|99\.00|99\.00%/)
})

test('column headers sort saved values with keyboard access and missing values last', async () => {
  const view = category()
  assert.equal(await view.getByRole('group', { name: 'View' }).count(), 0)
  assert.equal(await view.getByRole('group', { name: 'Sort' }).count(), 0)
  const relative = view.getByRole('button', { name: 'Sort by Δ%' })
  await relative.focus()
  await page.keyboard.press('Enter')
  assert.equal(await relative.locator('xpath=..').getAttribute('aria-sort'), 'ascending')
  let rows = await view.locator('[data-comparison-rows="delta"] tbody tr').allTextContents()
  assert.match(rows[0] ?? '', /Queens/)
  assert.match(rows[1] ?? '', /Manhattan/)
  assert.match(rows[3] ?? '', /Absent/)
  assert.match(rows[4] ?? '', /Zero baseline/)
  await page.keyboard.press('Enter')
  assert.equal(await relative.locator('xpath=..').getAttribute('aria-sort'), 'descending')
  rows = await view.locator('[data-comparison-rows="delta"] tbody tr').allTextContents()
  assert.match(rows[0] ?? '', /Brooklyn/)
  assert.match(rows[3] ?? '', /Absent/)
  assert.match(rows[4] ?? '', /Zero baseline/)
  await view.getByRole('button', { name: 'Sort by Baseline' }).click()
  rows = await view.locator('[data-comparison-rows="delta"] tbody tr').allTextContents()
  assert.match(rows[0] ?? '', /Zero baseline/)
  assert.match(rows[4] ?? '', /Absent/)
  await view.getByRole('button', { name: 'Sort by Metric' }).click()
  rows = await view.locator('[data-comparison-rows="delta"] tbody tr').allTextContents()
  assert.match(rows[0] ?? '', /Absent/)
  const point = view.locator('[data-frame-point]').first()
  assert.ok(await point.getAttribute('aria-label'))
  await point.focus()
  assert.equal(await point.evaluate((node) => node === document.activeElement), true)
})

test('sorts saved decimal changes beyond the floating point range exactly', async () => {
  const view = page.locator('[data-resource="hugeDecimal"]')
  const sort = view.getByRole('button', { name: 'Sort by Δ', exact: true })
  const labels = () => view.locator('[data-comparison-rows="delta"] tbody tr th').allTextContents()
  await sort.click()
  assert.deepEqual(await labels(), ['Negative', 'Smaller', 'Larger', 'Missing'])
  await sort.click()
  assert.deepEqual(await labels(), ['Larger', 'Smaller', 'Negative', 'Missing'])
})

test('large saved KPI values stay readable without splitting digits on narrow screens', async () => {
  await page.setViewportSize({ width: 390, height: 900 })
  const block = kpi().locator('[data-comparison-group="sales"]')
  const current = block.locator('.fv-kpi-current')
  assert.match(await current.innerText(), /118,393,545\.05/)
  assert.match(await block.innerText(), /123,430,419\.10/)
  assert.match(await block.innerText(), /5,036,874\.05/)
  assert.match(await block.innerText(), /4\.08%/)
  const value = current.locator('.fv-kpi-value')
  const visible = await value.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
    const bounds = node.closest('.fv-comparison-grid-item')!.getBoundingClientRect()
    return {
      lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
      fits: rects.every((rect) => rect.left >= bounds.left && rect.right <= bounds.right),
    }
  })
  assert.deepEqual(visible, { lines: 1, fits: true })
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1,
  )
})

test('switching aliases resets sorting and orders by saved absolute change', async () => {
  await page.setViewportSize({ width: 1000, height: 900 })
  const view = page.locator('[data-resource="switching"]')
  const aliases = view.getByRole('group', { name: 'Compared with' })
  await view.getByRole('button', { name: 'Sort by Δ%' }).click()
  await aliases.getByRole('button', { name: 'B', exact: true }).click()
  assert.equal(await view.getByRole('button', { name: 'Sort by Δ%' }).count(), 0)
  const rows = await view.locator('[data-comparison-rows="delta"] tbody tr').allTextContents()
  assert.match(rows[0] ?? '', /Second/)
  assert.match(rows[1] ?? '', /First/)
})

test('comparison preserves endpoints and shows no invented bars for unavailable deltas', async () => {
  for (const name of ['nullDelta', 'maskedDelta', 'missingEndpoint', 'explicitNullDelta']) {
    const view = page.locator(`[data-resource="${name}"]`)
    await view.waitFor()
    assert.equal(await view.locator('[data-comparison-rows="delta"]').count(), 1, name)
    assert.equal(await view.locator('[data-series="current"]').count(), 0, name)
  }
  for (const name of ['nullDelta', 'maskedDelta', 'explicitNullDelta']) {
    assert.equal(await page.locator(`[data-resource="${name}"] .fv-delta-bar`).count(), 0, name)
  }
})
