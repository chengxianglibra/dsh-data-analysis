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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-comparison-layout-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { comparedSinglePeriodMultiGroup } from './tests/unified-analysis-ui/frame-fixtures.ts';
const snapshot = comparedSinglePeriodMultiGroup();
const resources = {
  r: {
    kind: 'snapshot',
    declaration: { kind: 'frame-snapshot', snapshotRef: 'ref' },
    snapshot,
    binding: { workspaceId: 'w' },
  },
};
const program = 'root = Stack([auto, literal], "column");\\nauto = AnalysisFrameView("r");\\nliteral = AnalysisFrameView("r", {chart: "table"});';
createRoot(document.getElementById('root')).render(
  createElement(AnalysisRenderer, {
    program,
    title: 'Comparison layout',
    locale: 'en-US',
    resources,
  }),
);`,
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
  page = await browser.newPage({ viewport: { width: 720, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-frame-view="comparison-grid"]').waitFor()
  await page.locator('[data-table-layout="comparison"]').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const grid = () => page.locator('[data-frame-view="comparison-grid"]')
const table = () => page.locator('[data-frame-view="table"] [data-table-layout="comparison"]')

test('single-row multi-group comparison renders one headline block per metric by default', async () => {
  assert.equal(await page.locator('[data-frame-view]').count(), 2)
  const blocks = grid().locator('.fv-comparison-grid-item')
  assert.equal(await blocks.count(), 2)
  assert.equal(await blocks.nth(0).locator('h4').innerText(), 'sales')
  assert.equal(await blocks.nth(0).locator('.fv-kpi-values dt').count(), 4)
  assert.equal(await grid().locator('[data-slot=card-title]').count(), 0)
  assert.equal(await grid().locator('table').count(), 0)
  // The grid keeps the exact comparison table behind its data icon.
  assert.equal(await grid().locator('[data-icon="data"]').count(), 1)
  assert.equal(await page.locator('[data-frame-view="table"] [data-icon="data"]').count(), 1)
  assert.ok((await overflow()) <= 1)
})

test('the grid reflows at narrow widths without page overflow', async () => {
  await page.setViewportSize({ width: 390, height: 900 })
  assert.ok((await overflow()) <= 1)
  const columns = await grid()
    .locator('.fv-comparison-grid')
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  assert.equal(columns, 2)
  for (const block of await grid().locator('.fv-comparison-grid-item').all()) {
    const box = await block.boundingBox()
    assert.ok(box && box.width <= 390)
  }
  await page.setViewportSize({ width: 320, height: 900 })
  assert.equal(
    await grid()
      .locator('.fv-comparison-grid')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
    1,
  )
  assert.ok((await overflow()) <= 1)
})

test('a small KPI set remains readable without expanding across an ultrawide view', async () => {
  await page.setViewportSize({ width: 1920, height: 900 })
  for (const block of await grid().locator('.fv-comparison-grid-item').all()) {
    const box = await block.boundingBox()
    assert.ok(box && box.width <= 361, JSON.stringify(box))
  }
})

test('five and seven KPI blocks keep equal widths and aligned columns without filling the last row', async () => {
  const collection = grid().locator('.fv-comparison-grid')
  for (const count of [5, 7]) {
    await collection.evaluate((node, total) => {
      const first = node.firstElementChild
      if (!first) throw new Error('Missing KPI fixture')
      const value = first.querySelector('.fv-kpi-value')
      const baseline = first.querySelector('.fv-kpi-reference dd')
      if (!value || !baseline) throw new Error('Missing KPI values')
      value.textContent = '118,393,545.05'
      baseline.textContent = '123,430,419.10 USD'
      while (node.children.length < total) node.append(first.cloneNode(true))
      while (node.children.length > total) node.lastElementChild?.remove()
      node.setAttribute('data-count', String(total))
      node.setAttribute('style', `max-width:${total * 360}px`)
    }, count)
    for (const width of [900, 1200, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      const layout = await collection.evaluate((node) => {
        const parent = node.getBoundingClientRect()
        const items = [...node.children].map((child) => child.getBoundingClientRect())
        return {
          parent: { left: parent.left, right: parent.right },
          items: items.map(({ left, right, top, width }) => ({ left, right, top, width })),
        }
      })
      const firstRow = layout.items.filter((item) => Math.abs(item.top - layout.items[0]!.top) < 1)
      for (const [index, item] of layout.items.entries()) {
        assert.ok(Math.abs(item.width - layout.items[0]!.width) < 1, JSON.stringify(layout))
        assert.ok(
          Math.abs(item.left - firstRow[index % firstRow.length]!.left) < 1,
          JSON.stringify(layout),
        )
      }
      const lastRow = layout.items.filter(
        (item) => Math.abs(item.top - layout.items.at(-1)!.top) < 1,
      )
      if (lastRow.length < firstRow.length) {
        assert.ok(lastRow.at(-1)!.right < layout.parent.right - 1, JSON.stringify(layout))
      }
      assert.ok((await overflow()) <= 1)
      const clipped = await collection
        .locator('.fv-kpi-value, .fv-kpi-reference dd')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => node.textContent),
        )
      assert.deepEqual(clipped, [], JSON.stringify({ count, width, clipped }))
    }
  }
})

test('the explicit comparison table fits or scrolls inside the card at 720px', async () => {
  await page.setViewportSize({ width: 720, height: 900 })
  const measured = await table().evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  assert.ok(measured.scrollWidth <= measured.clientWidth + 1, JSON.stringify(measured))
  const numeric = table().locator('td.pr-numeric').first()
  assert.equal(await numeric.evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap')
  const header = table().locator('thead th').nth(1)
  assert.equal(await header.evaluate((node) => getComputedStyle(node).textAlign), 'right')
  assert.equal(await numeric.evaluate((node) => getComputedStyle(node).textAlign), 'right')
})

test('the comparison table keeps the page free of horizontal overflow at 390px', async () => {
  await page.setViewportSize({ width: 390, height: 900 })
  assert.ok((await overflow()) <= 1)
  const box = await table().boundingBox()
  assert.ok(box && box.width <= 390)
  // Narrow cards may scroll the table inside the card; the page itself must not.
  assert.equal(await table().evaluate((node) => getComputedStyle(node).overflowX), 'auto')
})

test('narrow comparison preserves long labels and formatted saved values', async () => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.locator('#root').evaluate((node) => {
    node.style.width = '243px'
  })
  const label = table().locator('tbody th[scope="row"]').first()
  await label.evaluate((node) => {
    node.textContent = 'plausible_fare_revenue (USD)'
  })
  const measured = await label.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
    whiteSpace: getComputedStyle(node).whiteSpace,
  }))
  assert.equal(measured.whiteSpace, 'nowrap')
  assert.ok(measured.width > 100 && measured.height < 50, JSON.stringify(measured))
  assert.ok((await overflow()) <= 1)
  const toolbar = page.locator('[data-frame-view="table"] .fv-comparison-toolbar').first()
  const hint = toolbar.locator('.fv-scroll-hint')
  await hint.waitFor({ state: 'visible' })
  assert.equal(await hint.getAttribute('title'), 'Scroll horizontally to see more')
  assert.equal(await table().getAttribute('aria-describedby'), await hint.getAttribute('id'))
  await table().focus()
  assert.equal(await table().evaluate((node) => node === document.activeElement), true)
  const cell = table().locator('tbody td').first()
  assert.ok((await cell.textContent())?.trim())
  assert.equal(await cell.getAttribute('title'), null)
  assert.equal(await toolbar.getByRole('button', { name: 'Show exact values' }).count(), 0)
})
