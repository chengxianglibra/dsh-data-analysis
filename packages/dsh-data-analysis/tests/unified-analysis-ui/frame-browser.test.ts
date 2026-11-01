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
import { frame, categoryAxis, timeAxis, observeTime, observeTimeCategory, attributeEffects, compareOrdinary, align } from './tests/unified-analysis-ui/frame-fixtures.ts';
const ref = (sha256) => ({ executionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', sha256 });
const resource = (snapshot, codeRef) => ({ kind: 'snapshot',
  declaration: { kind: 'frame-snapshot', snapshotRef: 'ref' }, snapshot,
  binding: { workspaceId: 'w', codeRef } });
const records = frame({
  axes: [categoryAxis(3, 'identity'), { name: 'channel', role: 'identity', keys: ['web', 'app', 'store'] }],
  values: [{ name: 'note', type: 'string', values: ['a long saved note', 'b', 'c'] },
    { name: 'amount', values: [118393545.04998468, 8, 9] }],
});
const precise = frame({axes: [timeAxis(3)], values: [{name: 'amount', values: [118393545.04998468, 8, 9]}]});
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
const program = 'root = Stack([good, long, bad, records, heatmap, nullableHeatmap, effects, comparison, empty, blank, mixed, alignment, taxiHeatmap, nullableTaxiHeatmap, sparseTaxiHeatmap, taxiAlignment, precise, partial, inline]);\\ngood = AnalysisFrameView("good");\\nlong = AnalysisFrameView("long");\\nbad = AnalysisFrameView("bad");\\nrecords = AnalysisFrameView("records");\\nheatmap = AnalysisFrameView("heatmap");\\nnullableHeatmap = AnalysisFrameView("nullableHeatmap");\\neffects = AnalysisFrameView("effects");\\ncomparison = AnalysisFrameView("comparison");\\nempty = AnalysisFrameView("empty", {chart: "heatmap", encoding: {x: "month", y: "region", value: "amount"}});\\nblank = AnalysisFrameView("blank", {chart: "heatmap", encoding: {x: "month", y: "region", value: "amount"}});\\nmixed = AnalysisFrameView("mixed", {chart: "heatmap", encoding: {x: "month", y: "region", value: "amount"}});\\nalignment = AnalysisFrameView("alignment");\\ntaxiHeatmap = AnalysisFrameView("taxiHeatmap");\\nnullableTaxiHeatmap = AnalysisFrameView("nullableTaxiHeatmap");\\nsparseTaxiHeatmap = AnalysisFrameView("sparseTaxiHeatmap");\\ntaxiAlignment = AnalysisFrameView("taxiAlignment");\\nprecise = AnalysisFrameView("precise");\\npartial = AnalysisFrameView("partial");\\ninline = AnalysisFrameView("inline", {chart: "auto"}, {dataTable: "visible"});';
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
    '<!doctype html><meta charset="utf-8"><body style="width:420px"><div id="root"></div><script src="page.js"></script>',
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

test('the Python icon shows the bound source only when its sha256 matches', async () => {
  await page.locator('[data-resource="good"] [data-icon="python"] button').click()
  const code = page.locator('[data-resource="good"] dialog[open] pre code')
  assert.equal(await code.textContent(), CODE)
  await page.keyboard.press('Escape')
  await page.locator('[data-resource="bad"] [data-icon="python"] button').click()
  const dialog = page.locator('[data-resource="bad"] dialog[open]')
  await dialog.getByText('Execution record sha256 does not match').waitFor()
  assert.equal(await dialog.locator('pre code').count(), 0)
  await page.keyboard.press('Escape')
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

test('official chart fits a narrow card and its points are keyboard-selectable', async () => {
  const card = page.locator('[data-resource="good"]')
  const chart = card.locator('[data-chart-engine="openui"]')
  assert.equal(await chart.count(), 1)
  const spacing = await chart.evaluate((node) => ({
    chart: getComputedStyle(node).getPropertyValue('--openui-space-xs').trim(),
    frame: getComputedStyle(node.closest('.fv')!).getPropertyValue('--openui-space-xs').trim(),
    surface: getComputedStyle(node.closest('.au-surface')!)
      .getPropertyValue('--openui-space-xs')
      .trim(),
  }))
  assert.deepEqual(spacing, { chart: '6px', frame: '6px', surface: '4px' })
  const metrics = await chart.locator('.openui-bar-chart-x-tick').evaluateAll((ticks) =>
    ticks.map((tick) => ({
      left: tick.getBoundingClientRect().left,
      right: tick.getBoundingClientRect().right,
      size: Number.parseFloat(getComputedStyle(tick).fontSize),
    })),
  )
  assert.equal(metrics.length, 3)
  for (const [i, tick] of metrics.entries()) {
    assert.ok(tick.size >= 12, JSON.stringify(tick))
    if (i > 0) assert.ok(tick.left >= metrics[i - 1]!.right, JSON.stringify(metrics))
  }
  const fit = await chart.evaluate((node) => ({
    chartRight: node.getBoundingClientRect().right,
    cardRight: node.closest('section.fv')!.getBoundingClientRect().right,
  }))
  assert.ok(fit.chartRight <= fit.cardRight + 1, JSON.stringify(fit))
  const first = chart.locator('.fv-keyboard-points button').first()
  await first.focus()
  await page.keyboard.press('Enter')
  const selected = card.getByRole('menu')
  await selected.getByRole('menuitem', { name: 'Ask about this' }).click()
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
    { resourceName: 'good', row: 0, field: 'm0' },
  ])
})

test('Taxi heatmap preserves exact cells and supports point selection without aggregating', async () => {
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
      assert.match(tooltip ?? '', /Manhattan.*Cash.*41820207/)
      assert.doesNotMatch(tooltip ?? '', /Row avg|Column avg/i)
      assert.equal(await page.locator('.openui-chart-tooltip:visible').count(), 0)
      await manhattan.click()
      const selected = card.getByRole('menu')
      await page.evaluate(() => {
        Reflect.set(window, 'pointSelections', [])
      })
      await selected.getByRole('menuitem', { name: 'Ask about this' }).click()
      assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointSelections')), [
        { resourceName: 'taxiHeatmap', row: 3, field: 'trips' },
      ])
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    }
    const nullCard = page.locator('[data-resource="nullableTaxiHeatmap"]')
    assert.equal(await nullCard.locator('[data-mark="cell"]').count(), 7)
    assert.equal(await nullCard.locator('[data-mark="empty"]').count(), 1)
    const sparseCard = page.locator('[data-resource="sparseTaxiHeatmap"]')
    assert.equal(await sparseCard.locator('[data-mark="cell"]').count(), 3)
    assert.equal(await sparseCard.locator('[data-mark="empty"]').count(), 1)
  } finally {
    await page.setViewportSize({ width: 420, height: 900 })
    await page.locator('body').evaluate((body) => {
      body.style.width = '420px'
      body.style.margin = ''
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
      assert.ok(
        fills.every(
          ({ fill }) => fill === (mode === 'light' ? 'rgb(66, 99, 213)' : 'rgb(147, 180, 255)'),
        ),
      )
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

test('long-series fallback retains legible text and scrolls with the keyboard', async () => {
  const chart = page.locator('[data-resource="long"] .fv-svg')
  const scroll = chart.locator('..')
  const dimensions = await chart.evaluate((svg) => {
    const text = svg.querySelector('text')!
    return {
      svgWidth: svg.getBoundingClientRect().width,
      textPixels:
        Number.parseFloat(getComputedStyle(text).fontSize) * (text.getScreenCTM()?.a ?? 1),
      scrollWidth: svg.parentElement!.scrollWidth,
      clientWidth: svg.parentElement!.clientWidth,
    }
  })
  assert.ok(dimensions.svgWidth >= 640)
  assert.ok(dimensions.textPixels >= 12)
  assert.ok(dimensions.scrollWidth > dimensions.clientWidth)
  await page.waitForFunction(() =>
    document
      .querySelector('[data-resource="long"] .fv-svg')!
      .parentElement!.hasAttribute('aria-describedby'),
  )
  const hintId = await scroll.getAttribute('aria-describedby')
  assert.ok(hintId)
  assert.equal(
    await page.locator(`[id="${hintId}"]`).textContent(),
    'Scroll horizontally to see more',
  )
  await scroll.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(
    () => document.querySelector('[data-resource="long"] .fv-svg')!.parentElement!.scrollLeft > 0,
  )
  assert.ok((await scroll.evaluate((element) => element.scrollLeft)) > 0)
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '1000px'
  })
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-resource="long"] .fv-svg')!
        .parentElement!.hasAttribute('aria-describedby'),
  )
  assert.equal(await scroll.getAttribute('tabindex'), null)
  await page.setViewportSize({ width: 420, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '420px'
  })
})

test('chart regions scroll with arrow keys after expanding the data table', async () => {
  for (const name of ['long', 'nullableHeatmap', 'effects']) {
    const card = page.locator(`[data-resource="${name}"]`)
    await card.locator('[data-icon="data"] button').click()
    await card.locator('dialog[open] table').waitFor()
    await card.locator('dialog[open] button[aria-label="Close"]').click()
    const region = card.locator('.fv-chart section[tabindex="0"]').first()
    await region.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await region.evaluate((element) => element.scrollLeft), 80, name)
    await page.keyboard.press('ArrowLeft')
    assert.equal(await region.evaluate((element) => element.scrollLeft), 0, name)
  }
})

test('row labels stay aligned and readable while heatmap, comparison and effects charts scroll', async () => {
  for (const name of ['nullableHeatmap', 'comparison', 'effects']) {
    const card = page.locator(`[data-resource="${name}"]`)
    const region = card.locator('.fv-plot').first()
    const original = region.locator('svg[role="img"] .fv-row-label').first()
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
  const details = card.locator('dialog[open]')
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

test('chart data uses the icon row and a keyboard operable dialog with exact saved values', async () => {
  const frame = page.locator('[data-resource="precise"]')
  const toggle = frame.locator('[data-icon="data"] button')
  assert.equal(await frame.locator('.fv-icons > [data-icon="data"]').count(), 1)
  assert.equal(await frame.locator('.fv-icons > [data-icon="origins"]').count(), 1)
  assert.equal(await frame.locator('.fv-icons > [data-icon="python"]').count(), 1)
  assert.equal(await toggle.getAttribute('aria-haspopup'), 'dialog')
  await toggle.focus()
  await page.keyboard.press('Enter')
  const details = frame.locator('dialog[open]')
  const saved = details.locator('td[data-column-id="amount"]').first()
  await saved.waitFor()
  assert.equal(await saved.textContent(), '118393545.04998468')
  assert.equal(await details.locator('.fv-scroll-hint, .pr-table > p').count(), 0)
  await page.evaluate(() => Reflect.set(window, 'pointSelections', []))
  await saved.getByRole('button').click()
  const menu = details.getByRole('menu')
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
  assert.equal(await frame.locator('dialog[open]').count(), 0)
  assert.equal(await page.locator('[data-resource="records"] [data-icon="data"]').count(), 0)
})

test('data references retain pagination and truncation without row counts', async () => {
  const long = page.locator('[data-resource="long"]')
  await long.locator('[data-icon="data"] button').click()
  const dialog = long.locator('dialog[open]')
  assert.equal(await dialog.locator('.pr-pagination span').textContent(), 'Page 1 / 2')
  await dialog.getByRole('button', { name: 'Next' }).click()
  assert.equal(await dialog.locator('.pr-pagination span').textContent(), 'Page 2 / 2')
  assert.equal(await dialog.locator('tbody tr').count(), 4)
  await dialog.getByRole('button', { name: 'Close' }).click()

  const partial = page.locator('[data-resource="partial"]')
  await partial.locator('[data-icon="data"] button').click()
  const partialDialog = partial.locator('dialog[open]')
  assert.equal(await partialDialog.locator('.pr-notice').textContent(), 'Data truncated')
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
  assert.equal(await frame.locator('dialog[open]').count(), 0)
})

test('coincident comparison and alignment marks retain visible rings at wide and narrow widths', async () => {
  for (const width of [710, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('body').evaluate((body, value) => {
      body.style.width = `${value}px`
      body.style.margin = '0'
    }, width)
    for (const name of ['comparison', 'alignment']) {
      const card = page.locator(`[data-resource="${name}"]`)
      const row = card.locator('svg[role="img"] g[data-row]').first()
      const hollow = row.locator('circle[data-mark="hollow"]').first()
      const filled = row.locator('circle[data-mark="filled"]').first()
      assert.equal(await hollow.getAttribute('r'), '6.5', `${name}, ${width}`)
      assert.equal(await filled.getAttribute('r'), '3', `${name}, ${width}`)
      assert.equal(await hollow.getAttribute('cx'), await filled.getAttribute('cx'))
      assert.match((await row.locator('title').first().textContent()) ?? '', /1/)
    }
  }
  await page.setViewportSize({ width: 420, height: 900 })
  await page.locator('body').evaluate((body) => {
    body.style.width = '420px'
    body.style.margin = ''
  })
})

test('taxi heatmap headers fit their columns and alignment values fit the full chart', async () => {
  for (const width of [710, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('body').evaluate((body, value) => {
      body.style.width = `${value}px`
      body.style.margin = '0'
    }, width)
    const heatmap = page.locator('[data-resource="nullableTaxiHeatmap"] svg[role="img"]')
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

    const alignment = page.locator('[data-resource="taxiAlignment"] svg[role="img"]')
    const fit = await alignment.locator('g[data-row] text.fv-strong').evaluateAll((elements) =>
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
    body.style.margin = ''
  })
})

test('Host theme overrides the OS without remounting, while custom tokens remain authoritative', async () => {
  const card = page.locator('[data-resource="good"]')
  await card.evaluate((node) => node.setAttribute('data-theme-test', 'preserved'))
  const read = () =>
    card.evaluate((node) => ({
      palette: getComputedStyle(node).getPropertyValue('--fv-s1').trim(),
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
  assert.deepEqual(dark, {
    palette: '#93b4ff',
    background: 'rgb(28, 28, 31)',
    color: 'rgb(237, 237, 237)',
    scheme: 'dark',
    sentinel: 'preserved',
  })
  const palette = () =>
    card.evaluate((node) => {
      const css = getComputedStyle(node)
      return {
        mode: css.getPropertyValue('--fv-chart-mode').trim(),
        colors: Array.from({ length: 8 }, (_, index) =>
          css.getPropertyValue(`--fv-s${index + 1}`).trim(),
        ),
      }
    })
  const darkPalette = await palette()
  assert.equal(new Set(darkPalette.colors).size, 8)
  assert.deepEqual(darkPalette, {
    mode: 'dark',
    colors: [
      '#93b4ff',
      '#5dcead',
      '#f2ba68',
      '#b99af2',
      '#ed9eb9',
      '#a4b6cf',
      '#ff9d7c',
      '#72c6e8',
    ],
  })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-resource="good"] .openui-bar-chart-bar')
        ?.getAttribute('fill') === '#93b4ff',
  )

  await page.evaluate(() => {
    document.body.style.setProperty('--dsw-alias-bg-base', '#202020')
    document.body.style.setProperty('--dsw-alias-label-primary', '#ffffff')
  })
  assert.equal((await read()).background, 'rgb(32, 32, 32)')
  assert.equal((await read()).color, 'rgb(255, 255, 255)')

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => {
    document.body.style.removeProperty('--dsw-alias-bg-base')
    document.body.style.removeProperty('--dsw-alias-label-primary')
    document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-ds-theme-source', 'light')
    document.body.removeAttribute('data-ds-dark-theme')
  })
  const light = await read()
  assert.deepEqual(light, {
    palette: '#4263d5',
    background: 'rgb(255, 255, 255)',
    color: 'rgb(29, 48, 54)',
    scheme: 'light',
    sentinel: 'preserved',
  })
  const lightPalette = await palette()
  assert.equal(new Set(lightPalette.colors).size, 8)
  assert.deepEqual(lightPalette, {
    mode: 'light',
    colors: [
      '#4263d5',
      '#21867a',
      '#bd7b24',
      '#8661c5',
      '#ba6481',
      '#71849a',
      '#a34e36',
      '#3970a0',
    ],
  })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-resource="good"] .openui-bar-chart-bar')
        ?.getAttribute('fill') === '#4263d5',
  )

  // Host `system` still publishes the resolved scheme on body; OS preference alone is not the authority.
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-ds-theme-source', 'system')
    document.body.setAttribute('data-ds-dark-theme', '')
  })
  await page.emulateMedia({ colorScheme: 'light' })
  assert.equal((await read()).palette, '#93b4ff')
  assert.equal((await read()).background, 'rgb(28, 28, 31)')
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.emulateMedia({ colorScheme: 'dark' })
  assert.equal((await read()).palette, '#4263d5')
  assert.equal((await read()).background, 'rgb(255, 255, 255)')

  const contrast = (foreground: number[], background: number[]) => {
    const luminance = (rgb: number[]) => {
      const channels = rgb.map((value) => {
        const s = value / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    }
    const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
    return (a! + 0.05) / (b! + 0.05)
  }
  assert.ok(contrast([237, 237, 237], [28, 28, 31]) >= 4.5)
  assert.ok(contrast([29, 48, 54], [255, 255, 255]) >= 4.5)

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-ds-theme-source')
  })
  assert.equal((await read()).palette, '#93b4ff')
  assert.equal((await read()).scheme, 'dark')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  assert.equal((await read()).palette, '#4263d5')
  assert.equal((await read()).scheme, 'light')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await page.evaluate(() => document.body.setAttribute('data-theme', 'light'))
  assert.equal((await read()).palette, '#4263d5')
  assert.equal((await read()).background, 'rgb(255, 255, 255)')
  assert.equal((await read()).scheme, 'light')
  await page.evaluate(() => {
    document.body.removeAttribute('data-theme')
    document.body.classList.add('light')
  })
  assert.equal((await read()).palette, '#4263d5')
  assert.equal((await read()).scheme, 'light')
  await page.evaluate(() => {
    document.body.classList.remove('light')
    document.body.setAttribute('data-theme', 'dark')
  })
  await page.emulateMedia({ colorScheme: 'light' })
  assert.equal((await read()).palette, '#93b4ff')
  assert.equal((await read()).scheme, 'dark')
  await page.evaluate(() => document.body.removeAttribute('data-theme'))
})

test('official chart tooltip uses a scoped opaque surface in both Host themes', async () => {
  const bar = page.locator('[data-resource="good"] .openui-bar-chart-bar').first()
  const tooltip = page.locator('.dsh-frame-chart-portal .openui-chart-tooltip')
  await page.evaluate(() => {
    const other = document.createElement('div')
    other.id = 'unrelated-chart-tooltip'
    other.className = 'openui-chart-tooltip'
    other.style.setProperty('--openui-foreground', 'rgb(1, 2, 3)')
    other.style.setProperty('--openui-popover-background', 'rgb(4, 5, 6)')
    document.body.append(other)
  })
  const setTheme = async (mode: 'light' | 'dark') => {
    await page.evaluate((next) => {
      document.documentElement.setAttribute('data-ds-theme-source', next)
      document.body.toggleAttribute('data-ds-dark-theme', next === 'dark')
    }, mode)
    await page.waitForFunction(
      (color) =>
        document
          .querySelector('[data-resource="good"] .openui-bar-chart-bar')
          ?.getAttribute('fill') === color,
      mode === 'light' ? '#4263d5' : '#93b4ff',
    )
    await bar.hover()
    await tooltip.waitFor({ state: 'visible' })
    return tooltip.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderTopStyle,
        radius: style.borderRadius,
        shadow: style.boxShadow,
      }
    })
  }
  try {
    const light = await setTheme('light')
    assert.notEqual(light.background, 'rgba(0, 0, 0, 0)')
    assert.equal(light.border, 'solid')
    assert.equal(light.radius, '8px')
    assert.notEqual(light.shadow, 'none')
    const dark = await setTheme('dark')
    assert.notEqual(dark.background, 'rgba(0, 0, 0, 0)')
    assert.notEqual(dark.background, light.background)
    assert.notEqual(dark.color, light.color)
    assert.equal(dark.border, 'solid')
    assert.equal(dark.radius, '8px')
    assert.notEqual(dark.shadow, 'none')
    assert.equal(
      await page
        .locator('#unrelated-chart-tooltip')
        .evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgb(1, 2, 3)',
    )
  } finally {
    await page.evaluate(() => {
      document.querySelector('#unrelated-chart-tooltip')?.remove()
      document.documentElement.removeAttribute('data-ds-theme-source')
      document.body.removeAttribute('data-ds-dark-theme')
    })
  }
})
