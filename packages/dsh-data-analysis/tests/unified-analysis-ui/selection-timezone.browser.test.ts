import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('a skipped local default date preserves candidate content and reports a saved error locally', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-selection-timezone-'))
  const browser = await chromium.launch()
  try {
    const snapshot = datasetSnapshot(
      [
        ['2011-12-29', '1'],
        ['2011-12-30', '2'],
      ],
      [
        { id: 'day', label: 'Day', type: 'date', nullable: false },
        { id: 'value', label: 'Value', type: 'int64', nullable: false },
      ],
    )
    const sources = {
      period: {
        ref: 'data',
        field: { kind: 'column', name: 'day' },
        mode: 'date-range',
        defaultValues: ['2011-12-29', '2011-12-29'],
      },
    }
    const program = `$period = {};
root = Stack([filtered, independent]);
filtered = DatasetView("data", {chart:"table"}, {title:"Filtered"}, [{source:"period",selection:$period}]);
independent = DatasetView("data", {chart:"table"}, {title:"Independent"});`
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        loader: 'tsx',
        contents: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisRenderer } from './src/client/analysis-ui/surface.tsx';
const snapshot = ${JSON.stringify(snapshot)};
const resources = { data: { kind: 'snapshot', snapshot, declaration: { kind:'dataset-snapshot', snapshotRef:'ref' }, binding: { workspaceId:'workspace' } } };
const root = createRoot(document.getElementById('root'));
const initial = ${JSON.stringify(sources)};
const skipped = { period: { ...initial.period, defaultValues:['2011-12-30','2011-12-30'] } };
window.renderStage = (stage) => root.render(<div data-stage={stage}><AnalysisRenderer program={${JSON.stringify(program)}} title="Report" locale="en-US" resources={resources} selectionSources={stage === 'initial' ? initial : skipped} recordId="build" candidate={stage === 'candidate'} isStreaming={stage === 'candidate'} /></div>);
window.renderStage('initial');`,
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
    const context = await browser.newContext({ timezoneId: 'Pacific/Apia' })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    await page.getByText('Independent').waitFor()
    assert.equal(await page.locator('tbody tr[data-row-index]').count(), 3)
    await page.evaluate(() => Reflect.get(window, 'renderStage')('candidate'))
    await page.locator('[data-stage="candidate"]').waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await page.locator('tbody tr[data-row-index]').count(), 3)
    await page.evaluate(() => Reflect.get(window, 'renderStage')('saved'))
    await page.locator('[data-stage="saved"]').waitFor()
    const alert = page.getByRole('alert')
    await alert.waitFor()
    assert.match((await alert.textContent()) ?? '', /period.*cannot be represented/)
    assert.equal(await page.getByText('Independent').count(), 1)
    assert.equal(await page.locator('tbody tr[data-row-index]').count(), 2)
    assert.deepEqual(errors, [])
    await context.close()
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
