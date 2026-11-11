import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  analysisRecordId,
  parseAnalysisDocument,
} from '../../src/presentation/contracts/analysis-document.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

test('one filter state synchronizes bound views without changing an unbound view or calling Host', async () => {
  const snapshot = datasetSnapshot(
    [
      [null, '9007199254740992', true],
      ['', '9007199254740993', false],
      ['Missing value', '9007199254740993', true],
      ['', '9007199254740992', false],
    ],
    [
      { id: 'category', label: 'Category', type: 'string', nullable: true },
      { id: 'large', label: 'ID', type: 'int64', nullable: false },
      { id: 'flag', label: 'Flag', type: 'boolean', nullable: false },
    ],
  )
  const report = parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    contentReview: 'not-needed',
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    recordId: analysisRecordId('report', 'build'),
    title: 'Filter integration',
    locale: 'en-US',
    generatedAt: '2026-11-05T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program: `root = Stack([category, large, first, second, baseline], "row", "m", "start", "start", true);
category = SnapshotFilter("category", "sales", {kind:"column",name:"category"}, "Category filter", "multiple", []);
large = SnapshotFilter("large", "sales", {kind:"column",name:"large"}, "ID filter", "multiple", []);
first = DatasetView("sales", {chart:"table"}, {}, ["category", "large"]);
second = DatasetView("sales", {chart:"table"}, {}, ["category", "large"]);
baseline = DatasetView("sales", {chart:"table"});`,
    resources: {
      sales: {
        kind: 'snapshot',
        declaration: { kind: 'dataset-snapshot', snapshotRef: 'ref' },
        snapshot,
        binding: {
          workspaceId: 'workspace',
          sessionId: 'session',
          callId: 'call',
          codeRef: {
            executionId: '12345678-1234-4123-8123-123456789abc',
            sha256: 'a'.repeat(64),
          },
        },
      },
    },
  })
  const replacement = datasetSnapshot(
    [
      ['New', '9007199254740992', true],
      ['Another', '9007199254740993', false],
      ['', '9007199254740993', true],
    ],
    snapshot.data.columns,
  )
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-filter-surface-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
const doc=${JSON.stringify(report)};
window.hostCalls=[];
const hostCall=(name)=>async()=>{window.hostCalls.push(name)};
window.fetch=async()=>{window.hostCalls.push('fetch');throw new Error('unexpected-fetch')};
const root=createRoot(document.getElementById('root'));
const replacement={sales:{...doc.resources.sales,snapshot:${JSON.stringify(replacement)}}};
window.renderReport=(stage='saved')=>{
  const candidate=stage!=='saved';
  const useReplacement=stage==='replacement' || stage==='unsupported';
  let program=candidate?doc.program.replace('"Category filter", "multiple", []','"Category filter", "multiple", '+(useReplacement?'[""]':'[null]')):doc.program;
  if(stage==='unsupported') program=program.replace('first = DatasetView("sales", {chart:"table"}', 'first = DatasetView("sales", {chart:"heatmap",encoding:{x:"category",y:"large",value:"large"}}');
  root.render(h('div',{'data-stage':stage},h(AnalysisRenderer,{
    program,title:doc.title,locale:doc.locale,resources:useReplacement?replacement:doc.resources,recordId:doc.recordId,
    viewId:'reader',candidate,isStreaming:candidate,
    askPoint:hostCall('askPoint'),askDataset:hostCall('askDataset'),askResource:hostCall('askResource'),
    readCode:hostCall('readCode'),openSemanticRef:hostCall('openSemanticRef')
  })));
};
window.renderReport();`,
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
    const remoteRequests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) remoteRequests.push(request.url())
    })
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href)
    const category = page.locator('[data-snapshot-filter="category"]')
    const large = page.locator('[data-snapshot-filter="large"]')
    const assertRows = async (selected: string[], first = selected, all = ['0', '1', '2', '3']) => {
      const expected = [first, selected, all]
      await page.waitForFunction((target) => {
        const cards = [...document.querySelectorAll('[data-resource="sales"]')]
        return (
          cards.length === target.length &&
          cards.every((card, index) => {
            const rows = [...card.querySelectorAll('tbody tr')].map((row) =>
              row.getAttribute('data-row-index'),
            )
            return JSON.stringify(rows) === JSON.stringify(target[index])
          })
        )
      }, expected)
    }
    await assertRows(['0', '1', '2', '3'])
    assert.equal(await page.locator('.au-stack > .au-filter-summary').count(), 0)
    assert.equal(await page.locator('[data-resource="sales"] .au-filter-summary').count(), 2)
    await category.getByRole('checkbox', { name: 'Missing value', exact: true }).check()
    await assertRows(['0'])
    await category.getByRole('checkbox', { name: 'Empty string', exact: true }).check()
    await assertRows(['0', '1', '3'])
    await category.getByRole('checkbox', { name: 'Missing value', exact: true }).uncheck()
    await category.getByRole('checkbox', { name: '"Missing value"', exact: true }).check()
    await assertRows(['1', '2', '3'])
    await large.getByRole('checkbox', { name: '9007199254740993', exact: true }).check()
    await assertRows(['1', '2'])
    await category.getByRole('button', { name: 'Clear', exact: true }).click()
    await assertRows(['1', '2'])
    await large.getByRole('checkbox', { name: '9007199254740993', exact: true }).uncheck()
    await large.getByRole('checkbox', { name: '9007199254740992', exact: true }).check()
    await assertRows(['0', '3'])
    const first = page.locator('[data-resource="sales"]').first()
    const sort = first.locator('th[data-column-id="large"] button')
    await sort.click()
    await sort.click()
    await category.getByRole('checkbox', { name: '"Missing value"', exact: true }).check()
    await assertRows([])
    assert.equal(await first.getByText('No matching rows', { exact: true }).isVisible(), true)
    await category.getByRole('button', { name: 'Clear', exact: true }).click()
    await large.getByRole('button', { name: 'Clear', exact: true }).click()
    await assertRows(['0', '1', '2', '3'], ['1', '2', '0', '3'])

    const renderStage = async (stage: string) => {
      await page.evaluate((value) => Reflect.get(window, 'renderReport')(value), stage)
      await page.locator(`[data-stage="${stage}"]`).waitFor()
    }
    await renderStage('candidate')
    await assertRows(['0'])
    await renderStage('unsupported')
    await assertRows(['2'], ['0'], ['0', '1', '2'])
    assert.match((await first.locator('.au-filter-summary').textContent()) ?? '', /Missing value/)
    await renderStage('replacement')
    await assertRows(['2'], ['2'], ['0', '1', '2'])
    assert.match((await first.locator('.au-filter-summary').textContent()) ?? '', /Empty string/)
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'hostCalls')), [])
    assert.deepEqual(remoteRequests, [])
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
