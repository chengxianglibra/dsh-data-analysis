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
import { frame, categoryAxis, timeAxis, observeTime, observeTimeCategory, attributeEffects, compareOrdinary, align } from './tests/unified-analysis-ui/frame-fixtures.ts';
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
const emptyHeatmap = frame({
  axes: [timeAxis(0), categoryAxis(0)],
  values: [{ name: 'amount', values: [] }],
});
const blankLabels = frame({
  axes: [timeAxis(1), {...categoryAxis(1), keys: ['']}],
  values: [{ name: 'amount', values: [null] }],
});
const mixedLabels = frame({
  axes: [{...timeAxis(1), keys: [timeAxis(1).keys[0], timeAxis(1).keys[0]]}, {...categoryAxis(2), keys: ['', 'zone']}],
  values: [{ name: 'amount', values: [null, 2] }],
});
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
const taxiAlignment = align({name: 'region', keys: ['Bronx', 'Brooklyn', 'EWR', 'Manhattan']});
for (const [index, value] of [377903, 1767304, 6056, 41820207].entries()) {
  for (const name of ['left.revenue', 'right.revenue']) {
    taxiAlignment.data.rows[index][taxiAlignment.data.columns.findIndex(column => column.id === name)] = value;
  }
}
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
  empty: resource(emptyHeatmap),
  blank: resource(blankLabels),
  mixed: resource(mixedLabels),
  effects: resource(attributeEffects()),
  comparison: resource(compareOrdinary([categoryAxis(3)])),
  alignment: resource(align(categoryAxis(3))),
  taxiHeatmap: resource(taxiHeatmap),
  nullableTaxiHeatmap: resource(withNull(taxiHeatmap)),
  sparseTaxiHeatmap: resource(sparseTaxiHeatmap),
  taxiAlignment: resource(taxiAlignment),
};
const program = 'root = Stack([good, long, bad, dataset, records, heatmap, nullableHeatmap, effects, comparison, empty, blank, mixed, alignment, taxiHeatmap, nullableTaxiHeatmap, sparseTaxiHeatmap, taxiAlignment, precise, partial, inline]);\\ndataset = DatasetView("dataset", {chart: "line", encoding: {axis: "category", values: ["value"]}});\\ngood = AnalysisFrameView("good");\\nlong = AnalysisFrameView("long", {chart: "line"});\\nbad = AnalysisFrameView("bad");\\nrecords = AnalysisFrameView("records");\\nheatmap = AnalysisFrameView("heatmap");\\nnullableHeatmap = AnalysisFrameView("nullableHeatmap");\\neffects = AnalysisFrameView("effects");\\ncomparison = AnalysisFrameView("comparison");\\nempty = AnalysisFrameView("empty", {chart: "heatmap", encoding: {x: "month", y: "region", value: "amount"}});\\nblank = AnalysisFrameView("blank", {chart: "heatmap", encoding: {x: "month", y: "region", value: "amount"}});\\nmixed = AnalysisFrameView("mixed", {chart: "heatmap", encoding: {x: "month", y: "region", value: "amount"}});\\nalignment = AnalysisFrameView("alignment");\\ntaxiHeatmap = AnalysisFrameView("taxiHeatmap");\\nnullableTaxiHeatmap = AnalysisFrameView("nullableTaxiHeatmap");\\nsparseTaxiHeatmap = AnalysisFrameView("sparseTaxiHeatmap");\\ntaxiAlignment = AnalysisFrameView("taxiAlignment");\\nprecise = AnalysisFrameView("precise");\\npartial = AnalysisFrameView("partial");\\ninline = AnalysisFrameView("inline", {chart: "auto"}, {dataTable: "visible"});';
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

test('line points have one hover tooltip and preserve saved keyboard selection', async () => {
  const card = page.locator('[data-resource="long"]')
  const point = card.locator('.recharts-line-dots [data-frame-point="0:m0"]').first()
  await point.waitFor()
  assert.match((await point.getAttribute('aria-label')) ?? '', /m0: 1\.00/)
  assert.equal(await card.locator('.recharts-line-dots circle title').count(), 0)
  await point.focus()
  assert.equal(await point.evaluate((node) => node === document.activeElement), true)
  await point.hover({ force: true })
  const tooltip = card.locator('.recharts-tooltip-wrapper:visible')
  await tooltip.waitFor()
  assert.equal(await tooltip.count(), 1)
  assert.match(await tooltip.innerText(), /m0: 1\.00/)
  const active = card.locator('.recharts-zIndex-layer_1200 [data-frame-point]')
  assert.equal(await active.count(), 1)
  assert.equal(await active.getAttribute('data-frame-point'), '0:m0')
  assert.match((await active.getAttribute('aria-label')) ?? '', /m0: 1\.00/)
  assert.equal(await active.locator('circle title').count(), 0)
  await point.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menu').getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'long', row: 0, field: 'm0' },
  ])
  await page.evaluate(() => Reflect.set(window, 'pointSelections', []))
})

test('Dataset line hover preserves exact decimal text without a second native tooltip', async () => {
  const card = page.locator('[data-resource="dataset"]')
  const point = card.locator('.recharts-line-dots circle').first()
  await point.waitFor()
  assert.equal(await point.locator('title').count(), 0)
  await point.hover()
  const tooltip = card.locator('.recharts-tooltip-wrapper:visible')
  await tooltip.waitFor({ timeout: 3000 })
  assert.equal(await tooltip.count(), 1)
  assert.match(await tooltip.innerText(), /12345678901234\.5678/)
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
    await page.locator('[data-resource="bad"] [data-icon="python"]').getAttribute('data-disabled'),
    'true',
  )
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

test('plugin charts scroll within a narrow card and their marks are keyboard-selectable', async () => {
  const card = page.locator('[data-resource="good"]')
  const chart = card.locator('svg.recharts-surface')
  assert.equal(await chart.count(), 1)
  const measured = await page.waitForFunction(() => {
    const ticks = document.querySelectorAll('[data-resource="good"] g[data-tick] text')
    if (ticks.length !== 3) return false
    const metrics = [...ticks].map((tick) => {
      const bounds = tick.getBoundingClientRect()
      return {
        connected: tick.isConnected,
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
        size: Number.parseFloat(getComputedStyle(tick).fontSize),
      }
    })
    return metrics.every((tick) => tick.connected && tick.width > 0 && tick.size >= 12)
      ? metrics
      : false
  })
  const metrics = await measured.jsonValue()
  assert.ok(metrics)
  assert.equal(metrics.length, 3)
  for (const [i, tick] of metrics.entries()) {
    assert.ok(tick.size >= 12, JSON.stringify(tick))
    if (i > 0) assert.ok(tick.left >= metrics[i - 1]!.right, JSON.stringify(metrics))
  }
  const fit = await card.locator('.fv-plot').evaluate((node) => ({
    plotRight: node.getBoundingClientRect().right,
    cardRight: node.closest('[data-frame-view]')!.getBoundingClientRect().right,
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  assert.ok(fit.plotRight <= fit.cardRight + 1, JSON.stringify(fit))
  assert.ok(fit.scrollWidth > fit.clientWidth, JSON.stringify(fit))
  const first = chart.getByRole('button').first()
  await first.focus()
  await page.keyboard.press('Enter')
  const selected = page.getByRole('menu')
  await selected.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'good', row: 0, field: 'm0' },
  ])
})

test('Taxi heatmap formats cells and supports point selection without aggregating', async () => {
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  try {
    for (const width of [710, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.locator('body').evaluate((body, value) => {
        body.style.width = `${value}px`
        body.style.margin = '0'
      }, width)
      const card = page.locator('[data-resource="taxiHeatmap"]')
      const cells = card.locator('[data-mark="cell"]')
      assert.equal(await cells.count(), 8)
      assert.equal(await card.locator('.openui-heatmap-chart-cell').count(), 0)
      const manhattan = cells.filter({ has: page.locator('title', { hasText: 'Manhattan' }) })
      await manhattan.hover()
      const tooltip = await manhattan.locator('title').textContent()
      assert.match(tooltip ?? '', /Manhattan.*Cash.*41,820,207\.00/)
      assert.doesNotMatch(tooltip ?? '', /Row avg|Column avg/i)
      assert.equal(await page.locator('.openui-chart-tooltip:visible').count(), 0)
      await manhattan.locator('rect').click()
      const selected = page.getByRole('menu')
      await page.evaluate(() => {
        Reflect.set(window, 'pointSelections', [])
      })
      await selected.getByRole('menuitem', { name: 'Ask about this' }).click()
      assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
        { resourceName: 'taxiHeatmap', row: 3, field: 'trips' },
      ])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      await page.keyboard.press('Escape')
      await selected.waitFor({ state: 'detached' })
    }
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
  } finally {
    await page.setViewportSize({ width: 420, height: 900 })
    await page.locator('body').evaluate((body) => {
      body.style.width = '420px'
      body.style.margin = '0'
    })
  }
})

test('Taxi heatmap orders its sequential colors by value in both Host themes', async () => {
  const selector = '[data-resource="taxiHeatmap"] [data-mark="cell"] rect'
  const values = [377903, 1767304, 6056, 41820207, 22200, 4647000, 4730, 80900]
  try {
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate((next) => {
        document.documentElement.setAttribute('data-ds-theme-source', next)
        document.body.toggleAttribute('data-ds-dark-theme', next === 'dark')
      }, mode)
      const fills = await page.locator(selector).evaluateAll((cells) =>
        cells.map((cell) => ({
          fill: getComputedStyle(cell).fill,
          opacity: Number(getComputedStyle(cell).fillOpacity),
        })),
      )
      assert.equal(fills.length, values.length)
      assert.ok(fills.every(({ fill }) => fill.length > 0 && fill !== 'none'))
      assert.equal(new Set(fills.map((item) => item.fill)).size, 1)
      const ordered = values.map((value, index) => ({ value, opacity: fills[index]!.opacity }))
      ordered.sort((left, right) => left.value - right.value)
      for (let index = 1; index < ordered.length; index++) {
        assert.ok(ordered[index]!.opacity >= ordered[index - 1]!.opacity)
      }
      assert.ok(ordered[0]!.opacity < ordered.at(-1)!.opacity)
    }
  } finally {
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-ds-theme-source')
      document.body.removeAttribute('data-ds-dark-theme')
    })
  }
})

test('long series retain legible text and scroll with the keyboard', async () => {
  const card = page.locator('[data-resource="long"]')
  const chart = card.locator('svg.recharts-surface')
  const scroll = card.locator('.fv-plot')
  assert.ok(await chart.evaluate((svg) => svg.getBoundingClientRect().width >= 640))
  assert.ok(
    await chart
      .locator('text')
      .first()
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize) >= 12),
  )
  assert.ok(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth))
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
    await page.keyboard.press('ArrowLeft')
    assert.equal(await region.evaluate((element) => element.scrollLeft), 0, name)
  }
})

test('row labels stay aligned and readable while heatmap and effects charts scroll', async () => {
  for (const name of ['nullableHeatmap', 'effects']) {
    const card = page.locator(`[data-resource="${name}"]`)
    const region = card.locator('.fv-plot').first()
    const original = region.locator('svg.recharts-surface .fv-row-label').first()
    await region.evaluate((node) => {
      node.scrollLeft = 0
    })
    await page.waitForFunction(
      (resource) => !document.querySelector(`[data-resource="${resource}"] [data-frame-rail]`),
      name,
    )
    const originalText = (await original.textContent())!.trim()
    await region.focus()
    await page.keyboard.press('ArrowRight')
    const rail = region.locator('[data-frame-rail]')
    await rail.waitFor({ state: 'visible' })
    const railText = rail.locator('[data-rail-row="0"]')
    const geometry = await railText.evaluate((element) => {
      const plot = element.closest('.fv-plot')!
      const source = plot.querySelector('.fv-row-label')!
      return {
        y: element.getBoundingClientRect().y,
        originalY: source.getBoundingClientRect().y,
        railLeft: element.closest('[data-frame-rail]')!.getBoundingClientRect().left,
        regionLeft: plot.getBoundingClientRect().left,
        originalVisibility: getComputedStyle(source).visibility,
        pointerEvents: getComputedStyle(element.closest('[data-frame-rail]')!).pointerEvents,
      }
    })
    assert.ok(Math.abs(geometry.y - geometry.originalY) < 1, `${name}: ${JSON.stringify(geometry)}`)
    assert.ok(Math.abs(geometry.railLeft - geometry.regionLeft) < 1, name)
    assert.equal(geometry.originalVisibility, 'hidden', name)
    assert.equal(geometry.pointerEvents, 'none', name)
    assert.equal(await rail.getAttribute('aria-hidden'), 'true', name)
    assert.ok(
      (await railText.locator('title').textContent())!.startsWith(originalText.replace(/…$/, '')),
      name,
    )
    await page.keyboard.press('ArrowLeft')
    await rail.waitFor({ state: 'detached' })
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

test('an empty heatmap never paints an opaque row-label rail', async () => {
  const card = page.locator('[data-resource="empty"]')
  const region = card.locator('.fv-plot')
  await region.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok((await region.evaluate((element) => element.scrollLeft)) > 0)
  assert.equal(await region.locator('[data-frame-rail]').count(), 0)
  assert.equal(
    await region.evaluate((element) => element.classList.contains('fv-plot-scrolled')),
    false,
  )
})

test('blank row labels do not paint an opaque rail, and mixed rows keep their positions', async () => {
  const blank = page.locator('[data-resource="blank"] .fv-plot')
  await blank.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok((await blank.evaluate((element) => element.scrollLeft)) > 0)
  assert.equal(await blank.locator('[data-frame-rail]').count(), 0)

  const mixed = page.locator('[data-resource="mixed"] .fv-plot')
  await mixed.focus()
  await page.keyboard.press('ArrowRight')
  const rail = mixed.locator('[data-frame-rail]')
  await rail.waitFor({ state: 'visible' })
  assert.equal(await rail.locator('[data-rail-row]').count(), 2)
  assert.equal(await rail.locator('[data-rail-row="0"] title').textContent(), '')
  assert.equal(await rail.locator('[data-rail-row="1"] title').textContent(), 'zone')
})

test('chart data uses the icon row and a keyboard operable dialog with formatted values', async () => {
  const frame = page.locator('[data-resource="precise"]')
  const toggle = frame.locator('[data-icon="data"] button')
  assert.equal(await frame.locator('.fv-icons > [data-icon="data"]').count(), 1)
  assert.equal(await frame.locator('.fv-icons > [data-icon="origins"]').count(), 1)
  assert.equal(await frame.locator('.fv-icons > [data-icon="python"]').count(), 1)
  assert.equal(await toggle.getAttribute('aria-haspopup'), 'dialog')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog')
  const saved = details.locator('td[data-column-id="amount"]').first()
  await saved.waitFor()
  assert.equal(await saved.textContent(), '118,393,545.05')
  assert.equal(await saved.getAttribute('title'), null)
  assert.equal(await details.locator('.fv-scroll-hint, .pr-table > p').count(), 0)
  await page.evaluate(() => Reflect.set(window, 'pointSelections', []))
  await saved.getByRole('button').click()
  const menu = page.getByRole('menu')
  await menu.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'precise', row: 0, field: 'amount' },
  ])
  await page.keyboard.press('Escape')
  assert.equal(await details.isVisible(), true)
  assert.equal(await menu.count(), 0)
  assert.equal(
    await saved.getByRole('button').evaluate((element) => element === document.activeElement),
    true,
  )
  await page.keyboard.press('Escape')
  await saved.waitFor({ state: 'detached' })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.locator('[data-resource="records"] [data-icon="data"]').count(), 0)
})

test('chart data and semantic origins are icon-only entries in one action row', async () => {
  const frame = page.locator('[data-resource="precise"]')
  const data = frame.locator('.fv-icons > [data-icon="data"]')
  const origins = frame.locator('.fv-icons > [data-icon="origins"]')
  assert.equal((await data.innerText()).trim(), '')
  assert.equal((await origins.innerText()).trim(), '')
  assert.equal(await data.locator('button > span').count(), 0)
  assert.equal(await origins.locator('button > span').count(), 0)
  assert.equal(
    await data.locator('button svg').evaluate((element) => getComputedStyle(element).display),
    'block',
  )
  assert.equal(await data.evaluate((element) => getComputedStyle(element).order), '0')
  assert.equal(await data.evaluate((element) => getComputedStyle(element).marginLeft), '0px')
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

test('coincident alignment marks retain visible rings at wide and narrow widths', async () => {
  for (const width of [710, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('body').evaluate((body, value) => {
      body.style.width = `${value}px`
      body.style.margin = '0'
    }, width)
    for (const name of ['alignment']) {
      const card = page.locator(`[data-resource="${name}"]`)
      const chart = card.locator('svg.recharts-surface').first()
      const hollow = chart.locator('circle[data-mark="hollow"]').first()
      const filled = chart.locator('circle[data-mark="filled"]').first()
      assert.ok(Number(await hollow.getAttribute('r')) > Number(await filled.getAttribute('r')))
      assert.equal(await hollow.getAttribute('cx'), await filled.getAttribute('cx'))
      assert.notEqual(
        await hollow.evaluate((node) => getComputedStyle(node).fill),
        await filled.evaluate((node) => getComputedStyle(node).fill),
      )
    }
  }
  await page.setViewportSize({ width: 420, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '420px'
    body.style.margin = '0'
  })
})

test('taxi heatmap headers fit their columns and alignment values fit the full chart', async () => {
  for (const width of [710, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('body').evaluate((body, value) => {
      body.style.width = `${value}px`
      body.style.margin = '0'
    }, width)
    const heatmap = page.locator('[data-resource="nullableTaxiHeatmap"] svg.recharts-surface')
    const manhattan = heatmap.locator('text[data-heatmap-column="Manhattan"]')
    const staten = heatmap.locator('text[data-heatmap-column="Staten Island"]')
    const brooklyn = heatmap.locator('text[data-heatmap-column="Brooklyn"]')
    const unknown = heatmap.locator('text[data-heatmap-column="Unknown"]')
    assert.equal(await manhattan.locator('title').textContent(), 'Manhattan')
    assert.equal(await staten.locator('title').textContent(), 'Staten Island')
    assert.equal((await manhattan.locator('tspan').allTextContents()).join(''), 'Manhattan')
    assert.equal((await staten.locator('tspan').allTextContents()).join(' '), 'Staten Island')
    assert.deepEqual(await brooklyn.locator('tspan').allTextContents(), ['Brooklyn'])
    assert.deepEqual(await unknown.locator('tspan').allTextContents(), ['Unknown'])
    const columns = await heatmap.locator('text[data-heatmap-column]').evaluateAll((elements) =>
      elements.map((element) => ({
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      })),
    )
    for (let i = 1; i < columns.length; i++)
      assert.ok(columns[i]!.left >= columns[i - 1]!.right, `${width}: ${JSON.stringify(columns)}`)

    const alignment = page.locator('[data-resource="taxiAlignment"] svg.recharts-surface')
    const fit = await alignment.locator('[data-chart-end-label]').evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent,
        right: element.getBoundingClientRect().right,
        svgRight: element.closest('svg')!.getBoundingClientRect().right,
      })),
    )
    assert.ok(fit.length > 0)
    for (const item of fit)
      assert.ok(item.right <= item.svgRight, `${width}: ${JSON.stringify(item)}`)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      0,
    )
  }
  await page.setViewportSize({ width: 420, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '420px'
    body.style.margin = '0'
  })
})

test('Host theme overrides the OS without remounting, while custom tokens remain authoritative', async () => {
  const card = page.locator('[data-resource="good"]')
  await card.evaluate((node) => node.setAttribute('data-theme-test', 'preserved'))
  const read = () =>
    card.evaluate((node) => ({
      colors: Array.from({ length: 8 }, (_, i) =>
        getComputedStyle(node)
          .getPropertyValue(`--chart-${i + 1}`)
          .trim(),
      ),
      background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color,
      scheme: getComputedStyle(node.closest('.au-surface')!).colorScheme,
      sentinel: node.getAttribute('data-theme-test'),
    }))
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ds-theme-source', 'dark')
    document.body.setAttribute('data-ds-dark-theme', '')
  })
  const dark = await read()
  assert.equal(dark.scheme, 'dark')
  assert.equal(dark.sentinel, 'preserved')
  assert.equal(new Set(dark.colors).size, 8)
  await page.evaluate(() => {
    document.body.style.setProperty('--dsw-alias-bg-base', '#202020')
    document.body.style.setProperty('--dsw-alias-label-primary', '#ffffff')
  })
  const custom = await read()
  assert.equal(custom.color, 'rgb(255, 255, 255)')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => {
    document.body.style.removeProperty('--dsw-alias-bg-base')
    document.body.style.removeProperty('--dsw-alias-label-primary')
    document.documentElement.setAttribute('data-ds-theme-source', 'light')
    document.body.removeAttribute('data-ds-dark-theme')
  })
  const light = await read()
  assert.equal(light.scheme, 'light')
  assert.equal(new Set(light.colors).size, 8)
  assert.notDeepEqual(light.colors, dark.colors)
  assert.equal(light.sentinel, 'preserved')
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ds-theme-source', 'system')
    document.body.setAttribute('data-ds-dark-theme', '')
  })
  await page.emulateMedia({ colorScheme: 'light' })
  assert.equal((await read()).scheme, 'dark')
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-ds-theme-source')
    document.body.removeAttribute('data-ds-dark-theme')
    document.body.setAttribute('data-theme', 'light')
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-resource=good]')!.closest('.au-surface')!)
        .colorScheme === 'light',
  )
  assert.equal((await read()).scheme, 'light')
  await page.evaluate(() => document.body.removeAttribute('data-theme'))
})

test('Dataset charts retain exact summaries and tooltips, local scrolling and the saved data dialog', async () => {
  // Earlier responsive, theme and keyboard tests share this page. Reset the fixture
  // so their final scroll and active-point state does not affect this interaction.
  await page.reload()
  const card = page.locator('[data-resource="dataset"]')
  const chart = card.locator('svg.recharts-surface')
  await chart.waitFor()
  assert.equal(await chart.count(), 1)
  assert.equal(await chart.getByRole('button').count(), 0)
  const plot = card.locator('.fv-plot')
  const summary = await plot.getAttribute('aria-label')
  assert.ok(summary)
  assert.ok(summary.includes('12345678901234.5678'))
  assert.ok(summary.includes('-2.5000'))
  const marks = chart.locator('.recharts-line-dots circle')
  await marks.first().hover()
  const tooltip = card.locator('.recharts-tooltip-wrapper:visible')
  await tooltip.waitFor()
  assert.match(await tooltip.innerText(), /12345678901234\.5678/)
  await marks.last().hover()
  await page.waitForFunction(() =>
    document
      .querySelector('[data-resource="dataset"] .recharts-tooltip-wrapper')
      ?.textContent?.includes('-2.5000'),
  )
  assert.match(await tooltip.innerText(), /-2\.5000/)
  assert.ok(await plot.evaluate((node) => node.scrollWidth > node.clientWidth))
  await plot.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok(await plot.evaluate((node) => node.scrollLeft > 0))
  await card.getByRole('button', { name: 'Table', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('12345678901234.5678', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
})
