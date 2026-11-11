import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('a sorted category value asks about its original saved row, not the computed share', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-category-composition-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { categoryAxis, frame } from './tests/unified-analysis-ui/frame-fixtures.ts';
const snapshot = frame({axes:[categoryAxis(3)], values:[{name:'v',values:[2,5,3]}]});
const resource = {kind:'snapshot', declaration:{kind:'frame-snapshot',snapshotRef:'ref'}, snapshot, binding:{workspaceId:'w'}};
window.selections=[];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = AnalysisFrameView("categories", {chart: "pie", style: "stacked"});',
  title:'Categories', locale:'en-US', resources:{categories:resource},
  askPoint:async selection => {window.selections.push(selection)},
}));
createRoot(document.getElementById('pie')).render(createElement(AnalysisRenderer, {
  program:'root = AnalysisFrameView("categories", {chart: "pie"});',
  title:'Categories', locale:'en-US', resources:{categories:resource},
  askPoint:async selection => {window.selections.push(selection)},
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
      '<!doctype html><meta charset="utf-8"><div id="root"></div><div id="pie"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const list = page.locator('[data-chart="category-composition"] .fv-share-list')
    await list.waitFor()
    assert.match(await list.locator('.fv-share-row').nth(1).innerText(), /r1/)
    assert.equal(await list.locator('button').count(), 3)
    await list.locator('button[data-frame-point="1:v"]').click()
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'selections')), [
      { resourceName: 'categories', row: 1, field: 'v' },
    ])
    const pie = page.locator('[data-chart="pie"]')
    const first = pie.locator('[data-pie-row="0"]')
    const second = pie.locator('[data-pie-row="1"]')
    await first.locator('[role="button"]').focus()
    assert.equal(await first.getAttribute('opacity'), '1')
    assert.equal(await second.getAttribute('opacity'), '0.38')
    assert.equal(await first.locator('path').getAttribute('stroke-width'), '64')
    await first.locator('[role="button"]').blur()
    assert.equal(await second.getAttribute('opacity'), '1')
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
