import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Page } from 'playwright'

const CODE = 'print("frame")\n'
let directory: string
let browser: Browser
let page: Page
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-frame-browser-'))
  const sha256 = 'a'.repeat(64)
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { datasetSnapshot } from './tests/unified-analysis-ui/dataset-fixtures.ts';
import { frame, categoryAxis, timeAxis, observeTime, observeTimeCategory, attributeEffects } from './tests/unified-analysis-ui/frame-fixtures.ts';
const ref = (sha256) => ({ executionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sha256 });
const resource = (snapshot, codeRef) => ({ kind: 'snapshot',
  declaration: { kind: snapshot.kind === 'frame' ? 'frame-snapshot' : 'dataset-snapshot', snapshotRef: 'ref' }, snapshot,
  binding: { workspaceId: 'w', codeRef } });
const records = frame({
  axes: [categoryAxis(3, 'identity'), { name: 'channel', role: 'identity', keys: ['web', 'app', 'store'] }],
  values: [{ name: 'note', type: 'string', values: ['a long saved note', 'b', 'c'] },
    { name: 'amount', values: [118393545.04998468, 8, 9] }],
});
const precise = frame({axes: [timeAxis(3)], values: [{name: 'amount', values: [118393545.04998468, 8, 9]}]});
// Two definition versions of one metric must still list a single semantic origin.
precise.frame.sections.semantics = {
  status: 'captured',
  columns: [{ role: 'value', id: 'amount', valueOrigins: [
    { kind: 'metric', path: 'sales.revenue', definitionId: 'v1' },
    { kind: 'metric', path: 'sales.revenue', definitionId: 'v2' },
  ], contextOrigins: [], omittedOrigins: 0 }],
};
const partial = frame({axes: [timeAxis(3)], values: [{name: 'amount', values: [1, 2, 3]}], totalRows: 5});
const heatmap = observeTimeCategory(9);
const longCategory = 'Long_original_category_name_abcdef';
const regionIndex = heatmap.data.columns.findIndex(column => column.id === 'region');
for (const row of heatmap.data.rows) if (row[regionIndex] === 'r0') row[regionIndex] = longCategory;
heatmap.frame.coordinates.k_region.values = heatmap.frame.coordinates.k_region.values.map(value => value === 'r0' ? longCategory : value);
// A saved null exercises the heatmap empty-cell path.
const withNull = source => {
  const copy = structuredClone(source);
  const index = copy.frame.fields.findIndex(field => field.role === 'value');
  copy.data.rows[0][index] = null;
  copy.data.columns[index].nullable = true;
  const field = copy.frame.fields[index];
  copy.frame.slots.find(slot => slot.slotId === field.slotId).nullable = true;
  return copy;
};
const nullableHeatmap = withNull(heatmap);
// Borough labels and comparable trip magnitudes come from the Yellow Taxi visual acceptance case.
const boroughs = ['Bronx', 'Brooklyn', 'EWR', 'Manhattan', 'N/A', 'Queens', 'Staten Island', 'Unknown'];
const taxiHeatmap = frame({
  axes: [{name: 'borough', keys: boroughs}, {name: 'payment', keys: boroughs.map(() => 'Cash')}],
  values: [{name: 'trips', values: [377903, 1767304, 6056, 41820207, 22200, 4647000, 4730, 80900]}],
});
const sparseTaxiHeatmap = frame({
  axes: [{name: 'borough', keys: ['Bronx', 'Bronx', 'Manhattan']}, {name: 'payment', keys: ['Cash', 'Card', 'Cash']}],
  values: [{name: 'trips', values: [377903, 1767304, 41820207]}],
});
const resources = {
  dataset: resource(datasetSnapshot()),
  good: resource(observeTime(3), ref(${JSON.stringify(sha256)})),
  long: resource(observeTime(24)),
  bad: resource(observeTime(3), ref('0'.repeat(64))),
  records: resource(records),
  precise: resource(precise),
  partial: resource(partial),
  inline: resource(precise),
  heatmap: resource(heatmap),
  nullableHeatmap: resource(nullableHeatmap),
  effects: resource(attributeEffects()),
  taxiHeatmap: resource(taxiHeatmap),
  nullableTaxiHeatmap: resource(withNull(taxiHeatmap)),
  sparseTaxiHeatmap: resource(sparseTaxiHeatmap),
};
const program = 'root = Stack([good, long, bad, dataset, records, heatmap, nullableHeatmap, effects, taxiHeatmap, nullableTaxiHeatmap, sparseTaxiHeatmap, precise, partial, inline]);\\ndataset = DatasetView("dataset", {chart: "line", encoding: {axis: "category", values: ["value"]}});\\ngood = AnalysisFrameView("good");\\nlong = AnalysisFrameView("long", {chart: "line"});\\nbad = AnalysisFrameView("bad");\\nrecords = AnalysisFrameView("records");\\nheatmap = AnalysisFrameView("heatmap");\\nnullableHeatmap = AnalysisFrameView("nullableHeatmap");\\neffects = AnalysisFrameView("effects");\\ntaxiHeatmap = AnalysisFrameView("taxiHeatmap");\\nnullableTaxiHeatmap = AnalysisFrameView("nullableTaxiHeatmap");\\nsparseTaxiHeatmap = AnalysisFrameView("sparseTaxiHeatmap");\\nprecise = AnalysisFrameView("precise");\\npartial = AnalysisFrameView("partial");\\ninline = AnalysisFrameView("inline", {chart: "auto"}, {dataTable: "visible"});';
window.pointSelections = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program, title: 'Frames', locale: 'en-US', resources,
  readCode: async () => ({ text: ${JSON.stringify(CODE)}, sha256: ${JSON.stringify(sha256)} }),
  askPoint: async (selection) => { window.pointSelections.push(selection); },
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
    '<!doctype html><meta charset="utf-8"><body style="width:420px;margin:0"><div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 420, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="records"] table').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

test('line points preserve saved keyboard selection', async () => {
  const card = page.locator('[data-resource="long"]')
  const point = card.locator('.recharts-line-dots [data-frame-point="0:m0"]').first()
  await point.waitFor()
  assert.match((await point.getAttribute('aria-label')) ?? '', /m0: 1\.00/)
  await point.focus()
  assert.equal(await point.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('Enter')
  await page.getByRole('menu').getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'long', row: 0, field: 'm0' },
  ])
  await page.evaluate(() => Reflect.set(window, 'pointSelections', []))
})

test('the Python icon shows the bound source only when its sha256 matches', async () => {
  await page.locator('[data-resource="good"] [data-icon="python"] button').click()
  const code = page.getByRole('dialog').locator('pre code')
  assert.equal(await code.textContent(), CODE)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('[data-resource="bad"] [data-icon="python"] button').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Execution record sha256 does not match').waitFor()
  assert.equal(await dialog.locator('pre code').count(), 0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(
    await page
      .locator('[data-resource="bad"] [data-icon="python"]')
      .getAttribute('data-unavailable'),
    'true',
  )
  const mismatchIcon = page.locator('[data-resource="bad"] [data-icon="python"] button')
  assert.equal(await mismatchIcon.getAttribute('aria-disabled'), null)
  await mismatchIcon.click()
  await page.getByRole('dialog').locator('[data-unavailable-details]').waitFor()
  assert.equal(await page.getByRole('dialog').locator('pre code').count(), 0)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  const missingIcon = page.locator('[data-resource="long"] [data-icon="python"] button')
  await missingIcon.click()
  const missing = page.getByRole('dialog').locator('[data-unavailable-details]')
  await missing.waitFor()
  assert.equal(await missing.locator('svg').count(), 1)
  assert.equal(await missing.locator('p').count(), 2)
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
})

test('record tables keep every key column in view while scrolling', async () => {
  const table = page.locator('[data-resource="records"] [data-frozen]').first()
  assert.equal(await table.getAttribute('data-frozen'), '2')
  const cells = await table.locator('thead th').evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item)
      return {
        position: style.position,
        left: style.left,
        width: (item as HTMLElement).offsetWidth,
      }
    }),
  )
  assert.equal(cells[0]!.position, 'sticky')
  assert.equal(cells[1]!.position, 'sticky')
  assert.equal(cells[1]!.left, `${cells[0]!.width}px`)
  assert.notEqual(cells[2]!.position, 'sticky')
})

test('Frame table headers preserve long names within their local scrolling region', async () => {
  const before = await page.evaluate(() => document.documentElement.scrollWidth)
  const header = page.locator('[data-resource="records"] thead th').first()
  await header.locator('.pr-column-label').evaluate((node) => {
    node.textContent = 'calendar:month.published_miles'
  })
  const layout = await header.evaluate((node) => ({
    whiteSpace: getComputedStyle(node).whiteSpace,
    height: node.getBoundingClientRect().height,
  }))
  assert.equal(layout.whiteSpace, 'nowrap')
  assert.ok(layout.height < 60, JSON.stringify(layout))
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= before + 1)
})

test('overflowing Frame tables describe the keyboard-scrollable region', async () => {
  const frame = page.locator('[data-resource="records"]')
  const region = frame.locator('.pr-table-scroll')
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-resource="records"] .pr-table-scroll')!
    return node.scrollWidth > node.clientWidth && node.hasAttribute('aria-describedby')
  })
  const hintId = await region.getAttribute('aria-describedby')
  assert.ok(hintId)
  assert.equal(
    await page.locator(`[id="${hintId}"]`).textContent(),
    'Scroll horizontally to see more',
  )
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(
    () => document.querySelector('[data-resource="records"] .pr-table-scroll')!.scrollLeft > 0,
  )
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '1000px'
  })
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-resource="records"] .pr-table-scroll')!
        .hasAttribute('aria-describedby'),
  )
  assert.equal(await region.getAttribute('aria-describedby'), null)
  await page.setViewportSize({ width: 420, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '420px'
  })
})

test('chart marks are keyboard-selectable', async () => {
  const card = page.locator('[data-resource="good"]')
  const first = card.locator('svg.recharts-surface [data-frame-point="0:m0"]').first()
  await first.press('Enter')
  const selected = page.getByRole('menu')
  await selected.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'good', row: 0, field: 'm0' },
  ])
})

test('Taxi heatmap supports point selection without aggregating', async () => {
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  const card = page.locator('[data-resource="taxiHeatmap"]')
  const cells = card.locator('[data-mark="cell"]')
  assert.equal(await cells.count(), 8)
  await cells.nth(3).locator('rect').click()
  const selected = page.getByRole('menu')
  await page.evaluate(() => Reflect.set(window, 'pointSelections', []))
  await selected.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'taxiHeatmap', row: 3, field: 'trips' },
  ])
  const nullCard = page.locator('[data-resource="nullableTaxiHeatmap"]')
  assert.equal(await nullCard.locator('[data-mark="cell"]').count(), 7)
  assert.equal(await nullCard.locator('[data-mark="empty"]').count(), 1)
  const sparseCard = page.locator('[data-resource="sparseTaxiHeatmap"]')
  assert.equal(await sparseCard.locator('[data-mark="cell"]').count(), 3)
  assert.equal(
    await sparseCard
      .locator('[data-heatmap-missing-count]')
      .getAttribute('data-heatmap-missing-count'),
    '1',
  )
  assert.equal(await sparseCard.locator('[data-mark="empty"]').count(), 0)
})

test('heatmap keeps the hovered row and column while dimming unrelated saved cells', async () => {
  const card = page.locator('[data-resource="heatmap"]')
  const mark = (row: number) => card.locator(`[data-frame-point="${row}:m0"] [data-mark="cell"]`)
  await mark(0).locator('rect').hover()
  await card
    .locator('[data-frame-point="10:m0"] [data-mark="cell"][opacity="0.3"]')
    .waitFor({ state: 'attached' })
  assert.equal(await mark(0).getAttribute('opacity'), '1')
  assert.equal(await mark(1).getAttribute('opacity'), '1')
  assert.equal(await mark(9).getAttribute('opacity'), '1')
  assert.equal(await mark(10).getAttribute('opacity'), '0.3')
  assert.equal(
    await card.locator('[data-heatmap-scale] span[aria-hidden="true"] > span').count(),
    5,
  )
})

test('heatmap cells match their legend in light and dark cards', async () => {
  const card = page.locator('[data-resource="taxiHeatmap"]')
  for (const background of ['oklch(1 0 0)', 'oklch(0.145 0 0)']) {
    const colors = await card.evaluate((element, cardColor) => {
      const card = element as HTMLElement
      card.style.setProperty('--chart-1', 'oklch(0.623 0.214 255)')
      card.style.setProperty('--card', cardColor)
      const swatches = [
        ...card.querySelectorAll<HTMLElement>(
          '[data-heatmap-scale] span[aria-hidden="true"] > span',
        ),
      ]
      return [...card.querySelectorAll<SVGRectElement>('[data-heat-level]')].map((cell) => ({
        level: Number(cell.dataset.heatLevel),
        cell: getComputedStyle(cell).fill,
        legend: getComputedStyle(swatches[Number(cell.dataset.heatLevel)]!).backgroundColor,
      }))
    }, background)
    assert.ok(colors.some((item) => item.level === 0))
    assert.ok(colors.some((item) => item.level === 4))
    for (const item of colors) assert.equal(item.cell, item.legend)
  }
  await card.evaluate((element) => {
    ;(element as HTMLElement).style.removeProperty('--chart-1')
    ;(element as HTMLElement).style.removeProperty('--card')
  })
})

test('long series scroll with the keyboard', async () => {
  const scroll = page.locator('[data-resource="long"] .fv-plot')
  await scroll.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok(await scroll.evaluate((node) => node.scrollLeft > 0))
  await page.keyboard.press('ArrowLeft')
  assert.equal(await scroll.evaluate((node) => node.scrollLeft), 0)
})

test('chart regions scroll with arrow keys after expanding the data table', async () => {
  for (const name of ['long', 'nullableHeatmap', 'effects']) {
    const card = page.locator(`[data-resource="${name}"]`)
    await card.locator('[data-icon="data"] button').click()
    await page.getByRole('dialog').locator('table').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const region = card.locator('.fv-chart section[tabindex="0"]').first()
    await region.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await region.evaluate((element) => element.scrollLeft), 80, name)
    if (name !== 'long') {
      const rail = card.locator('[data-frame-rail]')
      await rail.waitFor()
      assert.equal(await rail.getAttribute('aria-hidden'), 'true', name)
    }
    await page.keyboard.press('ArrowLeft')
    assert.equal(await region.evaluate((element) => element.scrollLeft), 0, name)
  }
})

test('a truncated row label remains available in the expanded data table', async () => {
  const card = page.locator('[data-resource="heatmap"]')
  await card.locator('[data-icon="data"] button').click()
  const details = page.getByRole('dialog')
  await details.locator('table').waitFor()
  assert.equal(
    await details.getByText('Long_original_category_name_abcdef', { exact: true }).count(),
    3,
  )
  await details.getByRole('button', { name: 'Close' }).click()
})

test('chart data uses a keyboard operable dialog with formatted values', async () => {
  const frame = page.locator('[data-resource="precise"]')
  const toggle = frame.locator('[data-icon="data"] button')
  assert.equal(await toggle.getAttribute('aria-haspopup'), 'dialog')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog')
  const saved = details.locator('td[data-column-id="amount"]').first()
  await saved.waitFor()
  assert.equal(await saved.textContent(), '118,393,545.05')
  await page.evaluate(() => Reflect.set(window, 'pointSelections', []))
  await saved.getByRole('button').click()
  const menu = page.getByRole('menu')
  await page.keyboard.press('Escape')
  assert.equal(await details.isVisible(), true)
  await menu.waitFor({ state: 'detached' })
  assert.equal(
    await saved.getByRole('button').evaluate((element) => element === document.activeElement),
    true,
  )
  await saved.getByRole('button').click()
  await menu.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'precise', row: 0, field: 'amount' },
  ])
  await saved.waitFor({ state: 'detached' })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await menu.count(), 0)
  assert.equal(await page.locator('[data-resource="records"] [data-icon="data"]').count(), 1)
})

test('chart metadata actions remain accessible and deduplicate origins', async () => {
  const frame = page.locator('[data-resource="precise"]')
  const data = frame.locator('[data-icon="data"]')
  const origins = frame.locator('[data-icon="origins"]')
  for (const entry of [data, origins])
    assert.ok(await entry.locator('button').getAttribute('aria-label'))
  await origins.locator('button').click()
  const dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByText(/sales\.revenue/).count(), 1)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await dialog.waitFor({ state: 'detached' })
})

test('data references retain pagination and truncation without row counts', async () => {
  const long = page.locator('[data-resource="long"]')
  await long.locator('[data-icon="data"] button').click()
  const dialog = page.getByRole('dialog')
  assert.equal(await dialog.locator('.pr-pagination span').textContent(), 'Page 1 / 2')
  await dialog.getByRole('button', { name: 'Next' }).click()
  assert.equal(await dialog.locator('.pr-pagination span').textContent(), 'Page 2 / 2')
  assert.equal(await dialog.locator('tbody tr').count(), 4)
  await dialog.getByRole('button', { name: 'Close' }).click()

  const partial = page.locator('[data-resource="partial"]')
  await partial.locator('[data-icon="data"] button').click()
  const partialDialog = page.getByRole('dialog')
  assert.equal(await partialDialog.getByRole('status').textContent(), 'Data truncated')
  await partialDialog.getByRole('button', { name: 'Close' }).click()
})

test('an explicitly visible data reference remains inline and can be toggled', async () => {
  const frame = page.locator('[data-resource="inline"]')
  const toggle = frame.locator('[data-icon="data"] button')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await frame.locator('.fv-data-reference table').count(), 1)
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await frame.locator('.fv-data-reference').count(), 0)
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(await frame.locator('.fv-data-reference table').count(), 1)
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})

test('Dataset chart summaries and data dialog retain exact saved values', async () => {
  await page.reload()
  const card = page.locator('[data-resource="dataset"]')
  const plot = card.locator('.fv-plot')
  const summary = await plot.getAttribute('aria-label')
  assert.ok(summary)
  assert.ok(summary.includes('12345678901234.5678'))
  assert.ok(summary.includes('-2.5000'))
  await plot.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok(await plot.evaluate((node) => node.scrollLeft > 0))
  await card.getByRole('button', { name: 'Table', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('12345678901234.5678', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
})
