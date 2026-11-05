import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { categoryAxis, frame } from './frame-fixtures.ts'
import { bundleRenderer, type Renderer } from './frame-render-fixtures.ts'

let renderer: Renderer
before(async () => {
  renderer = await bundleRenderer()
})
after(async () => {
  await renderer?.dispose()
})

function routes() {
  return frame({
    axes: [
      { ...categoryAxis(3), name: 'origin', keys: ['A', 'B', 'C'] },
      { ...categoryAxis(3), name: 'destination', keys: ['X', 'Y', 'Z'] },
    ],
    values: [
      { name: 'trips', type: 'int64', values: ['1234', '900', '5'] },
      { name: 'fare', values: [12.5, null, 42] },
      { name: 'other', values: [99, 98, 97] },
    ],
  })
}

const preview = {
  coordinates: ['origin', 'destination'],
  values: ['trips', 'fare'],
  limit: 2,
  label: 'Origin → Destination',
}

test('record previews keep the saved order, values, point identities and data entry', async () => {
  const html = await renderer.render(routes(), {
    view: { chart: 'table' },
    display: { recordPreview: preview },
    askPoint: true,
  })
  assert.match(html, /Origin → Destination/)
  assert.match(html, /A → X/)
  assert.match(html, /B → Y/)
  assert.doesNotMatch(html, /C → Z/)
  assert.match(html, /1,234/)
  assert.match(html, /12\.50/)
  assert.match(html, /data-cell-null="true"/)
  assert.match(html, /data-frame-point="0:trips"/)
  assert.match(html, /data-frame-point="1:trips"/)
  assert.doesNotMatch(html, /data-frame-point="1:fare"/)
  assert.match(html, /Showing first 2 of 3 saved rows/)
  assert.match(html, /data-icon="data"/)
  assert.doesNotMatch(html, /data-column-id="other"/)
})

test('record previews disclose truncated capture and use the requested height', async () => {
  const snapshot = routes()
  snapshot.coverage.complete = false
  snapshot.data.truncated = true
  snapshot.coverage.totalRows = 4
  snapshot.data.rowCount = 4
  const html = await renderer.render(snapshot, {
    view: { chart: 'table' },
    display: { recordPreview: preview, height: 140 },
  })
  assert.match(html, /Data truncated/)
  assert.match(html, /max-height:\s*140px/)
  assert.match(html, /Showing first 2 of 3 saved rows/)
})

test('an empty record preview retains the no-data status', async () => {
  const snapshot = frame({
    axes: [
      { ...categoryAxis(0), name: 'origin' },
      { ...categoryAxis(0), name: 'destination' },
    ],
    values: [
      { name: 'trips', type: 'int64', values: [] },
      { name: 'fare', values: [] },
    ],
  })
  const html = await renderer.render(snapshot, {
    view: { chart: 'table' },
    display: { recordPreview: preview },
  })
  assert.match(html, /role="status">No data/)
  assert.doesNotMatch(html, /Showing first/)
})

test('record preview selects the saved row and opens the full data table', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-record-preview-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
const snapshot = ${JSON.stringify(routes())};
const resource = {kind:'snapshot',declaration:{kind:'frame-snapshot',snapshotRef:'ref'},snapshot,binding:{workspaceId:'w'}};
window.requests = [];
createRoot(document.getElementById('root')).render(createElement(AnalysisRenderer, {
  program:'root = AnalysisFrameView("routes", {chart:"table"}, {recordPreview:{coordinates:["origin","destination"],values:["trips","fare"],limit:2,label:"Origin to destination"}});',
  title:'Routes',locale:'en-US',resources:{routes:resource},askPoint:async request => {window.requests.push(request)}
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
      '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="page.js"></script>',
    )
    const page = await browser.newPage()
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const card = page.locator('[data-resource="routes"]')
    await card.locator('[data-frame-point="1:trips"]').click()
    const menu = page.getByRole('menu')
    await menu.getByRole('menuitem', { name: 'Ask about this' }).click()
    await menu.waitFor({ state: 'hidden' })
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'requests')), [
      { resourceName: 'routes', row: 1, field: 'trips' },
    ])
    await page.keyboard.press('Escape')
    await card.locator('[data-icon="data"] button').click()
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.locator('tbody tr').count(), 3)
    assert.equal((await dialog.locator('[data-column-id="other"]').count()) > 0, true)
    assert.match(await dialog.innerText(), /Z/)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
