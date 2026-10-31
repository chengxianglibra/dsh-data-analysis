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
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-frame-layout-'))
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { observeTime } from './tests/unified-analysis-ui/frame-fixtures.ts';
const snapshot = observeTime(3);
const resource = {
  kind: 'snapshot',
  declaration: { kind: 'frame-snapshot', snapshotRef: 'ref' },
  snapshot,
  binding: { workspaceId: 'w' },
};
const resources = { a: resource, b: resource, c: resource, d: resource, e: resource };
const five = [
  'root = Stack([a, b, c, d, e], "row", "m", "start", "start", true);',
  'a = AnalysisFrameView("a", {chart: "line"}, {density: "compact"});',
  'b = AnalysisFrameView("b", {chart: "line"}, {density: "compact"});',
  'c = AnalysisFrameView("c", {chart: "line"}, {density: "compact"});',
  'd = AnalysisFrameView("d", {chart: "line"}, {density: "compact"});',
  'e = AnalysisFrameView("e", {chart: "line"}, {density: "compact"});',
].join('\\n');
const one = [
  'root = Stack([a], "row", "m", "start", "start", true);',
  'a = AnalysisFrameView("a", {chart: "line"}, {density: "compact"});',
].join('\\n');
const options = { title: 'Frame layout', locale: 'en-US', resources };
createRoot(document.getElementById('root')).render(
  createElement(AnalysisRenderer, { ...options, program: five }),
);
createRoot(document.getElementById('single')).render(
  createElement(AnalysisRenderer, { ...options, program: one }),
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
    '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><body><div id="root"></div><div id="single"></div><script src="page.js"></script>',
  )
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 720, height: 900 } })
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
  await page.locator('#root section.fv').nth(4).waitFor()
  await page.locator('#single section.fv').waitFor()
})
after(async () => {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
})

interface CardBox {
  top: number
  width: number
}

async function cardBoxes(root: string): Promise<CardBox[]> {
  return page.locator(`${root} [data-direction="row"].au-stack > section.fv`).evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { top: Math.round(rect.top), width: rect.width }
    }),
  )
}

/** Article content width (padding excluded) and padding-box width. */
async function articleWidths(root: string): Promise<{ content: number; box: number }> {
  return page.locator(`${root} article.au-surface`).evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      content:
        node.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
      box: node.clientWidth,
    }
  })
}

async function horizontalOverflow(): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test('five compact frames wrap into rows inside the article at 720px', async () => {
  const stack = page.locator('#root [data-direction="row"].au-stack')
  assert.equal(await stack.count(), 1)
  assert.equal(await stack.locator(':scope > section.fv').count(), 5)
  const cards = await cardBoxes('#root')
  assert.equal(cards.length, 5)
  const rows = new Set(cards.map((card) => card.top))
  assert.ok(rows.size <= 3, `expected at most 3 rows, got ${rows.size}: ${JSON.stringify(cards)}`)
  assert.ok(rows.size >= 2, `expected cards to wrap, got ${rows.size} row(s)`)
  const { content, box } = await articleWidths('#root')
  for (const card of cards) {
    assert.ok(card.width > 260, `card width ${card.width} should exceed the 260px basis`)
    assert.ok(card.width < box, `card width ${card.width} should stay inside the article ${box}`)
  }
  // The final wrapped row holds one card, which flex-grow stretches to the
  // content width; the other cards share their row and stay narrower.
  const stretched = cards.filter((card) => Math.abs(card.width - content) <= 1)
  assert.equal(stretched.length, 1, `only the last row is stretched: ${JSON.stringify(cards)}`)
  for (const card of cards.filter((card) => card !== stretched[0]))
    assert.ok(card.width < content, `card width ${card.width} should be below ${content}`)
  assert.ok((await horizontalOverflow()) <= 1)
})

test('a single row card fills the article content width at 720px', async () => {
  const cards = await cardBoxes('#single')
  assert.equal(cards.length, 1)
  const { content } = await articleWidths('#single')
  assert.ok(
    Math.abs(cards[0]!.width - content) <= 1,
    `single card width ${cards[0]!.width} should equal content width ${content}`,
  )
})

test('cards stack and the page does not overflow horizontally at 390px', async () => {
  await page.setViewportSize({ width: 390, height: 900 })
  const cards = await cardBoxes('#root')
  assert.equal(cards.length, 5)
  assert.equal(new Set(cards.map((card) => card.top)).size, 5)
  const { content } = await articleWidths('#root')
  for (const card of cards) {
    assert.ok(card.width > 260, `card width ${card.width} should exceed the 260px basis`)
    assert.ok(
      Math.abs(card.width - content) <= 1,
      `card width ${card.width} should fill ${content}`,
    )
  }
  const single = await cardBoxes('#single')
  assert.equal(single.length, 1)
  const singleContent = (await articleWidths('#single')).content
  assert.ok(single[0]!.width > 260)
  assert.ok(Math.abs(single[0]!.width - singleContent) <= 1)
  assert.ok((await horizontalOverflow()) <= 1)
})
