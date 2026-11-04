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
const resource = snapshot => ({kind:'snapshot', declaration:{kind:'frame-snapshot', snapshotRef:'ref'}, snapshot, binding:{workspaceId:'w'}});
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([category, kpi, switching, nullDelta, maskedDelta, missingEndpoint, explicitNullDelta], "column");\\ncategory = AnalysisFrameView("category");\\nkpi = AnalysisFrameView("kpi");\\nswitching = AnalysisFrameView("switching", {chart: "comparison", encoding: {value: "a.baseline.sales"}});\\nnullDelta = AnalysisFrameView("nullDelta");\\nmaskedDelta = AnalysisFrameView("maskedDelta");\\nmissingEndpoint = AnalysisFrameView("missingEndpoint");\\nexplicitNullDelta = AnalysisFrameView("explicitNullDelta", {chart: "comparison", style: "delta"});',
  title:'Comparison interactions', locale:'en-US', resources:{category:resource(category), kpi:resource(kpi), switching:resource(switching), nullDelta:resource(nullDelta), maskedDelta:resource(maskedDelta), missingEndpoint:resource(missingEndpoint), explicitNullDelta:resource(nullDelta)}, askPoint: async () => {},
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

test('changing sort and view is keyboard accessible and preserves the saved rows', async () => {
  const view = category()
  const sorting = view.getByRole('group', { name: 'Sort' })
  const relative = sorting.getByRole('button', { name: 'Δ%', exact: true })
  await relative.focus()
  await page.keyboard.press('Enter')
  assert.equal(await relative.getAttribute('aria-pressed'), 'true')
  const ordered = await view.locator('[data-comparison-rows="delta"]').innerText()
  assert.ok(ordered.indexOf('Queens') < ordered.indexOf('Manhattan'))
  const display = view.getByRole('group', { name: 'View' })
  await display.getByRole('button', { name: 'Values' }).click()
  assert.equal(
    await display.getByRole('button', { name: 'Values' }).getAttribute('aria-pressed'),
    'true',
  )
  for (const name of ['Manhattan', 'Queens', 'Brooklyn'])
    assert.ok((await view.innerText()).includes(name))
})

test('comparison point hover has one tooltip and remains a named keyboard target', async () => {
  await page.setViewportSize({ width: 1000, height: 900 })
  const view = category()
  await view.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Values' }).click()
  const point = view.locator('[data-frame-point]').first()
  await point.waitFor()
  assert.ok(await point.getAttribute('aria-label'))
  assert.equal(await point.locator('title').count(), 0)
  await point.focus()
  assert.equal(await point.evaluate((node) => node === document.activeElement), true)
  await point.hover()
  const tooltip = view.locator('.recharts-tooltip-wrapper:visible')
  await tooltip.waitFor()
  assert.equal(await tooltip.count(), 1)
  const lines = (await tooltip.innerText())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  assert.equal(new Set(lines).size, lines.length, lines.join(' | '))
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
  assert.equal(await value.evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap')
  assert.ok(
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1,
  )
})

test('switching comparison aliases resets unsupported view and sort states', async () => {
  await page.setViewportSize({ width: 1000, height: 900 })
  const view = page.locator('[data-resource="switching"]')
  const aliases = view.getByRole('group', { name: 'Compared with' })
  const display = view.getByRole('group', { name: 'View' })
  await display.getByRole('button', { name: 'Values' }).click()
  await aliases.getByRole('button', { name: 'B', exact: true }).click()
  await view.locator('[data-comparison-rows="delta"]').waitFor()
  assert.equal(await view.getByRole('group', { name: 'View' }).count(), 0)
  assert.match(await view.innerText(), /10\.00/)

  await aliases.getByRole('button', { name: 'A', exact: true }).click()
  const sorting = view.getByRole('group', { name: 'Sort' })
  await sorting.getByRole('button', { name: 'Δ%', exact: true }).click()
  assert.equal(
    await sorting.getByRole('button', { name: 'Δ%' }).getAttribute('aria-pressed'),
    'true',
  )
  await aliases.getByRole('button', { name: 'B', exact: true }).click()
  const nextSort = view.getByRole('group', { name: 'Sort' })
  assert.equal(await nextSort.getByRole('button', { name: 'Δ%', exact: true }).count(), 0)
  assert.equal(
    await nextSort.getByRole('button', { name: 'Δ', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  const rows = await view.locator('[data-comparison-rows="delta"] tbody tr').allTextContents()
  assert.match(rows[0] ?? '', /Second/)
  assert.match(rows[1] ?? '', /First/)
})

test('auto comparison uses endpoints when no saved delta has a present and drawable pair', async () => {
  for (const name of ['nullDelta', 'maskedDelta', 'missingEndpoint']) {
    const view = page.locator(`[data-resource="${name}"]`)
    await view.waitFor()
    assert.equal(await view.locator('[data-comparison-rows="delta"]').count(), 0, name)
    assert.ok(await view.locator('[data-series="current"]').count(), name)
  }
  const explicit = page.locator('[data-resource="explicitNullDelta"]')
  assert.equal(await explicit.locator('[data-comparison-rows="delta"]').count(), 1)
})
