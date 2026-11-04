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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-chart-tooltip-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { datasetSnapshot } from './tests/unified-analysis-ui/dataset-fixtures.ts';
import { observeTime, compareCalendar } from './tests/unified-analysis-ui/frame-fixtures.ts';
const resource = (snapshot) => ({ kind: 'snapshot', declaration: {
  kind: snapshot.kind === 'frame' ? 'frame-snapshot' : 'dataset-snapshot', snapshotRef: 'ref'
}, snapshot, binding: { workspaceId: 'w' } });
const resources = {line: resource(observeTime(3)), area: resource(observeTime(3)),
  dense: resource(observeTime(2001)), dataset: resource(datasetSnapshot()),
  domain: resource(compareCalendar(6))};
const program = 'root = Stack([line, area, dense, dataset, domain]);\\nline = AnalysisFrameView("line", {chart: "line"});\\narea = AnalysisFrameView("area", {chart: "area"});\\ndense = AnalysisFrameView("dense", {chart: "line"});\\ndataset = DatasetView("dataset", {chart: "line", encoding: {axis: "category", values: ["value"]}});\\ndomain = AnalysisFrameView("domain", {chart: "comparison"});';
window.selections = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program, title: 'Chart tooltip', locale: 'en-US', resources,
  askPoint: async (selection) => { window.selections.push(selection); }
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
    '<!doctype html><meta charset="utf-8"><body style="width:900px;margin:0"><div id="root"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('[data-resource="line"] .recharts-line-dots circle').first().waitFor()
})

after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

async function checkSurface(name: string) {
  const card = page.locator(`[data-resource="${name}"]`)
  const svg = card.locator('svg.recharts-surface').first()
  await svg.waitFor()
  assert.equal(await svg.locator(':scope > title').textContent(), '')
  assert.ok((await svg.getAttribute('aria-label'))?.length)
  assert.equal(await svg.getAttribute('role'), 'application')
  assert.ok((await card.locator('.fv-plot').first().getAttribute('aria-label'))?.length)
  return card
}

async function checkTooltipInstant(card: ReturnType<Page['locator']>) {
  const tooltip = card.locator('.recharts-tooltip-wrapper:visible')
  await tooltip.waitFor()
  assert.equal(await tooltip.count(), 1)
  const styles = await tooltip.evaluate((node) => ({
    inlineTransition: (node as HTMLElement).style.transition,
    duration: getComputedStyle(node).transitionDuration,
    visible: getComputedStyle(node).visibility,
  }))
  assert.ok(
    styles.inlineTransition === '' || styles.inlineTransition === 'none',
    JSON.stringify(styles),
  )
  assert.equal(styles.duration, '0s')
  assert.equal(styles.visible, 'visible')
  return tooltip
}

test('Frame line and area keep one instantaneous tooltip and accessible points', async () => {
  for (const name of ['line', 'area']) {
    const card = await checkSurface(name)
    const mark = card.locator('[data-frame-point="0:m0"] circle').first()
    await mark.hover({ force: true })
    const tip = await checkTooltipInstant(card)
    assert.match(await tip.innerText(), /m0: 1\.00/)
    assert.equal(await card.locator('[data-frame-point] circle title').count(), 0)
    const firstPosition = await tip.evaluate((node) => node.getBoundingClientRect().x)
    const last = card.locator('[data-frame-point="2:m0"] circle').first()
    await last.hover({ force: true })
    await page.waitForFunction(
      (resource) =>
        document
          .querySelector(`[data-resource="${resource}"] .recharts-tooltip-wrapper`)
          ?.textContent?.includes('m0: 3.00'),
      name,
    )
    const lastPosition = await tip.evaluate((node) => node.getBoundingClientRect().x)
    assert.notEqual(firstPosition, lastPosition)
    assert.equal(await tip.evaluate((node) => getComputedStyle(node).transitionDuration), '0s')
    const firstBox = await mark.boundingBox()
    const secondBox = await card.locator('[data-frame-point="1:m0"] circle').first().boundingBox()
    assert.ok(firstBox && secondBox)
    await page.mouse.move(
      firstBox.x + firstBox.width / 2 + (secondBox.x - firstBox.x) / 4,
      firstBox.y + firstBox.height / 2 + (secondBox.y - firstBox.y) / 4,
    )
    await page.waitForFunction(
      (resource) =>
        document
          .querySelector(`[data-resource="${resource}"] .recharts-tooltip-wrapper`)
          ?.textContent?.includes('m0: 1.00'),
      name,
    )
    assert.equal(await card.locator('.recharts-tooltip-wrapper:visible').count(), 1)
    const point = card.locator('[data-frame-point="0:m0"]').first()
    assert.match((await point.getAttribute('aria-label')) ?? '', /m0: 1\.00/)
    await point.focus()
    assert.equal(await point.evaluate((node) => node === document.activeElement), true)
    await page.keyboard.press('Enter')
    await page.getByRole('menu').getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'selections')), [
      { resourceName: name, row: 0, field: 'm0' },
    ])
    await page.evaluate(() => Reflect.set(window, 'selections', []))
  }
})

test('Dataset exact values and domain series use accessible roots and no native summary title', async () => {
  const dataset = await checkSurface('dataset')
  await dataset.locator('.recharts-line-dots circle').first().hover({ force: true })
  const tip = await checkTooltipInstant(dataset)
  assert.match(await tip.innerText(), /12345678901234\.5678/)

  const domain = await checkSurface('domain')
  const dot = domain.locator('[data-frame-point] circle').first()
  await dot.hover({ force: true })
  const domainTip = await checkTooltipInstant(domain)
  assert.match(await domainTip.innerText(), /sales/)
  assert.equal(await domain.locator('[data-frame-point] circle title').count(), 0)
})

test('dense line still exposes summary and activates tooltip without static points', async () => {
  const card = await checkSurface('dense')
  const svg = card.locator('svg.recharts-surface')
  assert.equal(await svg.locator('.recharts-line-dots circle').count(), 0)
  await svg.scrollIntoViewIfNeeded()
  const bounds = await svg.boundingBox()
  assert.ok(bounds)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  const tip = await checkTooltipInstant(card)
  assert.match(await tip.innerText(), /m0:/)
})
