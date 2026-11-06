import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('a sorted Frame cell selects the original row and adds its exact value to a question', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-point-ui-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
import { frame, categoryAxis, observeTime } from './tests/unified-analysis-ui/frame-fixtures.ts';
const snapshot = frame({axes: [categoryAxis(2, 'region'), {name:'channel', role:'identity', keys:['web','app']}],
  values: [{name:'amount',type:'int64',values:['9007199254740993','2']}]});
const resource = snapshot => ({kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}});
const resources = {result: resource(snapshot), large: resource(observeTime(70)), dense:resource(observeTime(2501))};
window.pointRequests = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = Stack([table, large, dense]);\\ntable = AnalysisFrameView("result", {chart:"table"});\\nlarge = AnalysisFrameView("large");\\ndense = AnalysisFrameView("dense");', title:'Point test', locale:'en-US', resources,
  askPoint: async point => {window.pointRequests.push(point)}
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
      '<!doctype html><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    const waitForMenuPosition = () =>
      page.waitForFunction(() => {
        const menu = document.querySelector('[role="menu"]')
        if (!menu || getComputedStyle(menu).transform !== 'none') return false
        const box = menu.getBoundingClientRect()
        return box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
      })
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    await page.getByRole('button', { name: /Sort by amount/ }).click()
    const cell = page.locator('[data-row-index="0"] [data-column-id="amount"] .pr-cell-select')
    await cell.click()
    const menu = page.getByRole('menu')
    assert.equal(await menu.locator('svg[aria-hidden="true"]').count(), 1)
    await menu.getByRole('menuitem', { name: 'Ask about this' }).click()
    await menu.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'pointRequests')), [
      { resourceName: 'result', row: 0, field: 'amount' },
    ])
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    assert.equal(await menu.count(), 0)
    const point = page.locator('[data-resource="large"] g[role="button"]').nth(1)
    assert.equal(await page.locator('[data-resource="large"] g[role="button"]').count(), 70)
    await point.focus()
    await page.keyboard.press('Enter')
    const action = page.getByRole('menuitem', { name: 'Ask about this' })
    await action.waitFor()
    // Radix positions and animates the menu after it becomes visible. Measure its final geometry.
    await waitForMenuPosition()
    const pointBox = await point.boundingBox()
    const menuBox = await menu.boundingBox()
    assert.ok(pointBox && menuBox)
    assert.ok(menuBox.x >= pointBox.x + pointBox.width - 1, JSON.stringify({ pointBox, menuBox }))
    assert.ok(menuBox.y + menuBox.height <= pointBox.y + 1, JSON.stringify({ pointBox, menuBox }))
    assert.equal(await action.evaluate((node) => node === document.activeElement), true)
    await page.keyboard.press('Escape')
    assert.equal(await menu.count(), 0)
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-frame-point') === '1:m0',
    )
    await point.press('Enter')
    await waitForMenuPosition()
    const box = await page.getByRole('menu').boundingBox()
    assert.ok(
      box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 720,
      JSON.stringify(box),
    )
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-frame-point') === '1:m0',
    )
    await point.click()
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'pointRequests'))).at(-1), {
      resourceName: 'large',
      row: 1,
      field: 'm0',
    })
    await page.keyboard.press('Escape')
    const navigator = page.locator('[data-resource="dense"] [data-chart-navigator]')
    assert.equal(await navigator.getAttribute('data-point-count'), '2501')
    assert.equal(await page.locator('[data-resource="dense"] .recharts-line-curve').count(), 1)
    assert.equal(await page.locator('[data-resource="dense"] g[data-frame-point]').count(), 0)
    const inspect = navigator.getByRole('button', { name: /Inspect chart point/ })
    await inspect.focus()
    await inspect.press('End')
    await inspect.press('ArrowLeft')
    await inspect.press('Enter')
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'pointRequests'))).at(-1), {
      resourceName: 'dense',
      row: 2499,
      field: 'm0',
    })
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
