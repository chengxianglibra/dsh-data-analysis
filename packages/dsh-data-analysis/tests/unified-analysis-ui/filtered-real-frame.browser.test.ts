import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { validateAnalysisResources } from '../../src/presentation/contracts/analysis-document.ts'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'

test('a real Frame filter preserves saved point identities and table rows', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-filter-real-frame-'))
  const browser = await chromium.launch()
  try {
    const fixture = await readFile(
      new URL('./fixtures/frames/observe-time-category.json', import.meta.url),
      'utf8',
    )
    const snapshot = parseAnalysisSnapshot(JSON.parse(fixture))
    if (snapshot.kind !== 'frame') throw new Error('Frame fixture required')
    const resource = {
      kind: 'snapshot' as const,
      declaration: { kind: 'frame-snapshot' as const, snapshotRef: 'frame' },
      snapshot,
      binding: {
        workspaceId: 'workspace',
        sessionId: 'session',
        callId: 'call',
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
      },
    }
    const program =
      'root = Stack([filter, chart, table]);\nfilter = SnapshotFilter("region", "frame", {kind:"axis", name:"sales.customer.region"}, "Region", "single", []);\nchart = AnalysisFrameView("frame", {chart:"auto"}, {}, ["region"]);\ntable = AnalysisFrameView("frame", {chart:"table"}, {}, ["region"]);'
    validateAnalysisResources(program, { frame: resource })
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
const resource=${JSON.stringify(resource)};
window.requests=[];
window.snapshot=resource.snapshot;
createRoot(document.getElementById('root')).render(h(AnalysisRenderer,{program:${JSON.stringify(program)},title:'Frame filter',locale:'en-US',recordId:'saved-build',resources:{frame:resource},askPoint:async selection=>window.requests.push(selection)}));`,
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
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const chart = page.locator('[data-frame-view="line"]')
    const table = page.locator('[data-frame-view="table"]')
    const southPoint = chart.locator('[data-frame-point="3:revenue"] circle').first()
    await southPoint.waitFor()
    assert.deepEqual(
      await table
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['0', '1', '2', '3', '4', '5'],
    )
    await page.getByRole('combobox', { name: 'Region' }).selectOption({ label: '"south"' })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-frame-view="table"] tbody tr').length === 3,
    )
    assert.deepEqual(
      await table
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['3', '4', '5'],
    )
    assert.equal(await chart.locator('[data-frame-point="0:revenue"]').count(), 0)
    await table.getByRole('button', { name: 'Sort by revenue', exact: true }).click()
    assert.deepEqual(
      await table
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['5', '4', '3'],
    )
    await table.locator('tbody tr[data-row-index="5"] [data-column-id="revenue"] button').click()
    await page.getByRole('menuitem', { name: 'Ask about this' }).click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'requests'))).at(-1), {
      resourceName: 'frame',
      row: 5,
      field: 'revenue',
    })
    await chart.getByRole('button', { name: 'Table', exact: true }).click()
    const dialog = page.getByRole('dialog')
    assert.deepEqual(
      await dialog
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-index'))),
      ['3', '4', '5'],
    )
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const chartPoint = chart.locator('[data-frame-point="4:revenue"]').first()
    await chartPoint.focus()
    assert.equal(await chartPoint.evaluate((node) => node === document.activeElement), true)
    await page.keyboard.press('Enter')
    const action = page.getByRole('menuitem', { name: 'Ask about this' })
    await action.waitFor()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await action.evaluate((node) => node === document.activeElement), true)
    await action.click()
    assert.deepEqual((await page.evaluate(() => Reflect.get(window, 'requests'))).at(-1), {
      resourceName: 'frame',
      row: 4,
      field: 'revenue',
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'snapshot')), snapshot)
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
