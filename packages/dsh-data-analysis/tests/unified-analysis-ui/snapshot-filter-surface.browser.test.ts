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
import { frame, observed } from './frame-fixtures.ts'

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

test('shared date controls project saved rows and keep the KPI on its selected row', async () => {
  const days = Array.from(
    { length: 7 },
    (_, index) => `2026-11-${String(index + 7).padStart(2, '0')}`,
  )
  const daily = datasetSnapshot(
    days.map((day, index) => [day, index % 2 ? 'A' : 'B', String(100 + index)]),
    [
      { id: 'day', label: 'Day', type: 'string', nullable: false },
      { id: 'cluster', label: 'Cluster', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'decimal', nullable: false },
    ],
  )
  const hourly = datasetSnapshot(
    days.flatMap((day, dayIndex) =>
      Array.from({ length: dayIndex === 6 ? 14 : 24 }, (_, hour) => [
        day,
        `${day}T${String(hour).padStart(2, '0')}:00:00Z`,
        String(dayIndex * 24 + hour),
      ]),
    ),
    [
      { id: 'day', label: 'Day', type: 'string', nullable: false },
      { id: 'time', label: 'Time', type: 'datetime', nullable: false },
      { id: 'value', label: 'Value', type: 'decimal', nullable: false },
    ],
  )
  const dimensions = datasetSnapshot(
    ['2026-11-12', '2026-11-13'].flatMap((day) => [
      [day, 'East', 'A'],
      [day, 'East', 'B'],
      [day, 'South', 'C'],
    ]),
    [
      { id: 'day', label: 'Day', type: 'string', nullable: false },
      { id: 'region', label: 'Region', type: 'string', nullable: false },
      { id: 'cluster', label: 'Cluster', type: 'string', nullable: false },
    ],
  )
  const hourFrame = frame({
    axes: [
      {
        name: 'hour',
        type: 'datetime',
        keys: hourly.data.rows.map((row) => row[1]!),
        variant: {
          kind: 'calendar',
          timezone: 'UTC',
          grain: { kind: 'builtin', unit: 'hour', step: 1 },
        },
      },
    ],
    values: [
      {
        name: 'reading',
        type: 'float64',
        values: hourly.data.rows.map((_, index) => index),
        context: observed(),
      },
    ],
  })
  const resource = (snapshot: typeof daily) => ({
    kind: 'snapshot' as const,
    declaration: { kind: 'dataset-snapshot' as const, snapshotRef: 'ref' },
    snapshot,
    binding: {
      workspaceId: 'workspace',
      sessionId: 'session',
      callId: 'call',
      codeRef: { executionId: '12345678-1234-4123-8123-123456789abc', sha256: 'a'.repeat(64) },
    },
  })
  const report = parseAnalysisDocument({
    schemaVersion: ANALYSIS_UI_FORMAT,
    workspaceId: 'workspace',
    reportId: 'report',
    buildId: 'build',
    recordId: analysisRecordId('report', 'build'),
    title: 'Shared dates',
    locale: 'en-US',
    generatedAt: '2026-11-13T00:00:00Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program: `root = Stack([day, range, requiredCluster, region, clusters, metric, singleTrend, rangeTrend, frameTrend, details]);
day = SnapshotFilter("day", "daily", {kind:"column",name:"day"}, "Day", "single", [], {allowAll:false,defaultPolicy:"latest"});
range = SnapshotFilter("range", "daily", {kind:"column",name:"day"}, "Range", "date-range", [], {allowAll:false,defaultPolicy:"latest"});
requiredCluster = SnapshotFilter("requiredCluster", "daily", {kind:"column",name:"cluster"}, "KPI cluster", "single", ["B"], {allowAll:false});
region = SnapshotFilter("region", "dimensions", {kind:"column",name:"region"}, "Region", "single", []);
clusters = SnapshotFilter("clusters", "dimensions", {kind:"column",name:"cluster"}, "Clusters", "multiple", []);
metric = DatasetView("daily", {chart:"metric",encoding:{value:"value"}}, {}, ["day", "requiredCluster"]);
singleTrend = DatasetView("hourly", {chart:"line",encoding:{axis:"time",values:["value"]}}, {}, [{filter:"day",field:{kind:"column",name:"day"}}]);
rangeTrend = DatasetView("hourly", {chart:"line",encoding:{axis:"time",values:["value"]}}, {}, [{filter:"range",field:{kind:"column",name:"time"}}]);
frameTrend = AnalysisFrameView("hourFrame", {chart:"line",encoding:{axis:"hour",values:["reading"]}}, {}, [{filter:"range",field:{kind:"axis",name:"hour"}}]);
details = DatasetView("dimensions", {chart:"table"}, {}, [{filter:"range",field:{kind:"column",name:"day"}}, "region", "clusters"]);`,
    resources: {
      daily: resource(daily),
      hourly: resource(hourly),
      dimensions: resource(dimensions),
      hourFrame: {
        ...resource(daily),
        declaration: { kind: 'frame-snapshot', snapshotRef: 'frame' },
        snapshot: hourFrame,
      },
    },
  })
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-shared-filter-'))
  const browser = await chromium.launch()
  try {
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        contents: `
import {createElement as h} from 'react';
import {createRoot} from 'react-dom/client';
import {AnalysisRenderer} from './src/client/analysis-ui/surface.tsx';
const doc=${JSON.stringify(report)};
createRoot(document.getElementById('root')).render(h(AnalysisRenderer,{
  program:doc.program,title:doc.title,locale:doc.locale,resources:doc.resources,recordId:doc.recordId,
  askDataset:async()=>{},askResource:async()=>{},askPoint:async()=>{}
}));`,
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
    const metric = page.locator('[data-resource="daily"]')
    const single = page.locator('[data-resource="hourly"]').first()
    const range = page.locator('[data-resource="hourly"]').last()
    const frameChart = page.locator('[data-resource="hourFrame"]')
    const details = page.locator('[data-resource="dimensions"]')
    const tickTitles = async (view: typeof range) =>
      view.locator('[data-tick] title').allTextContents()
    await single.locator('[data-frame-point="157:value"]').first().waitFor()
    await range.locator('[data-frame-point="157:value"]').first().waitFor()
    await frameChart.locator('[data-frame-point="157:reading"]').first().waitFor()
    assert.equal(await single.locator('[data-frame-point$=":value"]').count(), 14)
    assert.equal(await range.locator('[data-frame-point$=":value"]').count(), 14)
    assert.equal(await frameChart.locator('[data-frame-point$=":reading"]').count(), 14)
    assert.deepEqual(
      [(await tickTitles(single))[0], (await tickTitles(single)).at(-1)],
      ['2026-11-13T00:00:00Z', '2026-11-13T13:00:00Z'],
    )
    assert.deepEqual(
      [(await tickTitles(range))[0], (await tickTitles(range)).at(-1)],
      ['2026-11-13T00:00:00Z', '2026-11-13T13:00:00Z'],
    )
    assert.match((await metric.textContent()) ?? '', /106/)
    await page.getByRole('combobox', { name: 'Day' }).selectOption({ label: '"2026-11-12"' })
    await single.locator('[data-frame-point="143:value"]').first().waitFor()
    assert.equal(await single.locator('[data-frame-point$=":value"]').count(), 24)
    await metric.getByRole('status').filter({ hasText: 'No matching rows' }).waitFor()
    assert.doesNotMatch((await metric.textContent()) ?? '', /106/)
    await page.getByRole('combobox', { name: 'KPI cluster' }).selectOption({ label: '"A"' })
    await metric.getByText('105', { exact: true }).waitFor()
    const start = page.getByLabel('Start date')
    const end = page.getByLabel('End date')
    await start.fill('2026-11-12')
    assert.equal(await range.locator('[data-frame-point$=":value"]').count(), 14)
    await page.getByRole('button', { name: 'Apply' }).click()
    await range.locator('[data-frame-point="120:value"]').first().waitFor()
    assert.equal(await range.locator('[data-frame-point$=":value"]').count(), 38)
    assert.equal(await range.locator('[data-frame-point="119:value"]').count(), 0)
    await frameChart.locator('[data-frame-point="120:reading"]').first().waitFor()
    assert.equal(await frameChart.locator('[data-frame-point$=":reading"]').count(), 38)
    assert.equal(await frameChart.locator('[data-frame-point="119:reading"]').count(), 0)
    assert.deepEqual(
      [(await tickTitles(range))[0], (await tickTitles(range)).at(-1)],
      ['2026-11-12T00:00:00Z', '2026-11-13T13:00:00Z'],
    )
    const frameTicks = await tickTitles(frameChart)
    assert.match(frameTicks[0] ?? '', /2026-11-12.*00:00/)
    assert.match(frameTicks.at(-1) ?? '', /2026-11-13.*13:00/)
    const waitForDetailRows = async (count: number) =>
      page.waitForFunction(
        (expected) =>
          document.querySelectorAll('[data-resource="dimensions"] tbody tr').length === expected,
        count,
      )
    await waitForDetailRows(6)
    await page.getByRole('combobox', { name: 'Region' }).selectOption({ label: '"East"' })
    await waitForDetailRows(4)
    await page.getByRole('checkbox', { name: 'A', exact: true }).check()
    await page.getByRole('checkbox', { name: 'B', exact: true }).check()
    await waitForDetailRows(4)
    await start.fill('2026-11-13')
    await page.getByRole('button', { name: 'Apply' }).click()
    await waitForDetailRows(2)
    await page.getByRole('combobox', { name: 'Region' }).selectOption({ label: '"South"' })
    await waitForDetailRows(0)
    await details.getByRole('status').filter({ hasText: 'No matching rows' }).waitFor()
    await start.fill('2026-11-12')
    await page.getByRole('button', { name: 'Apply' }).click()
    await range.locator('[data-frame-point="120:value"]').first().waitFor()
    await end.fill('2026-11-11')
    assert.equal(await page.getByRole('button', { name: 'Apply' }).isDisabled(), true)
    assert.equal(await range.locator('[data-frame-point$=":value"]').count(), 38)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
})
