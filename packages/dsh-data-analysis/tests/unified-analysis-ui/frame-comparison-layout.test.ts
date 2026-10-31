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
const program = 'root = AnalysisFrameView("r");';
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
  await page.locator('[data-table-layout="comparison"]').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

test('single-row multi-group comparison renders one transposed table by default', async () => {
  assert.equal(await page.locator('section.fv').count(), 1)
  assert.equal(await page.locator('section.fv').getAttribute('data-frame-view'), 'table')
  const table = page.locator('[data-table-layout="comparison"]')
  assert.equal(await table.locator('thead th').count(), 5)
  assert.equal(await table.locator('tbody tr').count(), 2)
  const text = await table.innerText()
  assert.doesNotMatch(text, /prior\.(?:baseline|absolute|relative)\./)
  assert.match(await page.locator('section.fv h3').innerText(), /⇄/)
  // The collapsed audit table stays available below the transposed view.
  assert.equal(await page.locator('section.fv details.fv-table table').count(), 1)
  assert.ok((await overflow()) <= 1)
})

test('the comparison table fits or scrolls inside the card at 720px', async () => {
  await page.setViewportSize({ width: 720, height: 900 })
  const measured = await page.locator('[data-table-layout="comparison"]').evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  assert.ok(measured.scrollWidth <= measured.clientWidth + 1, JSON.stringify(measured))
  const numeric = await page.locator('[data-table-layout="comparison"] td.pr-numeric').first()
  assert.equal(await numeric.evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap')
})

test('the comparison table keeps the page free of horizontal overflow at 390px', async () => {
  await page.setViewportSize({ width: 390, height: 900 })
  assert.ok((await overflow()) <= 1)
  const table = page.locator('[data-table-layout="comparison"]')
  const box = await table.boundingBox()
  assert.ok(box && box.width <= 390)
  // Narrow cards may scroll the table inside the card; the page itself must not.
  assert.equal(await table.evaluate((node) => getComputedStyle(node).overflowX), 'auto')
})
