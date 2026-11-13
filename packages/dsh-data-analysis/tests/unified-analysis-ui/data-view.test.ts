import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Page } from 'playwright'
import type { FrameView } from '../../src/presentation/contracts/frame-view.ts'
import {
  type AnalysisSnapshot,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import { browserTestsEnabled, skipBrowserTest } from '../browser-test.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'
import { frameSnapshot } from './fixtures.ts'

let directory: string
let browser: Browser
let page: Page
let chartSequence = 0
async function renderChart(snapshot: AnalysisSnapshot, view: FrameView) {
  await page.evaluate(
    ({ snapshot, view, sequence }) => {
      Reflect.get(window, 'renderDataset')(snapshot, view, sequence)
    },
    { snapshot, view, sequence: ++chartSequence },
  )
  await page.locator('.recharts-surface').waitFor()
  await page.locator('[data-mark]').first().waitFor()
  return page.locator('#root').innerHTML()
}
let render: (
  snapshot: AnalysisSnapshot,
  semantic?: boolean,
  view?: FrameView,
  candidate?: boolean,
) => string
let renderOrigins: (section: unknown) => string
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'dsh-analysis-data-view-'))
  const outfile = path.join(directory, 'render.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisDataView } from './src/client/analysis-ui/data-view.tsx';
import { AnalysisResources } from './src/client/analysis-ui/context.tsx';
import { SemanticOrigins } from './src/client/analysis-ui/metadata-view.tsx';
export function renderOrigins(section) {
  return renderToStaticMarkup(createElement(AnalysisResources.Provider,
    {value: {openSemanticRef: () => {}}}, createElement(SemanticOrigins, {section})));
}
export function render(snapshot, semantic, view, candidate) {
  return renderToStaticMarkup(createElement(AnalysisResources.Provider,
    {value: {candidate, readResource: () => ({kind: 'snapshot', snapshot, binding: {}}),
             openSemanticRef: semantic ? () => {} : undefined}},
    createElement(AnalysisDataView, {kind: snapshot.kind, resourceName: 'result', view})));
}`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  ;({ render, renderOrigins } = await import(pathToFileURL(outfile).href))
  if (!browserTestsEnabled) return
  const chartFile = path.join(directory, 'chart.js')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalysisDataView } from './src/client/analysis-ui/data-view.tsx';
import { AnalysisResources } from './src/client/analysis-ui/context.tsx';
import { UIStyleSheet } from './src/client/ui/theme.ts';
const root = createRoot(document.getElementById('root'));
window.renderDataset = (snapshot, view, sequence) => root.render(createElement('div', {className:'mv-ui'}, createElement(UIStyleSheet), createElement(AnalysisResources.Provider,
  {key:sequence,value:{candidate:false, readResource:()=>({kind:'snapshot',snapshot,binding:{}})}},
  createElement(AnalysisDataView,{kind:snapshot.kind,resourceName:'result',view}))));`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile: chartFile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ path: chartFile })
})
after(async () => {
  await browser?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

function singleFrame(coordinate: boolean) {
  const s = parseAnalysisSnapshot(frameSnapshot())
  if (s.kind !== 'frame') throw new Error('frame-required')
  const index = coordinate ? 0 : 1
  s.data.columns = [s.data.columns[index]!]
  s.data.rows = [[s.data.rows[0]![index]!]]
  s.data.rowCount = 1
  s.data.truncated = false
  s.coverage.totalRows = 1
  s.coverage.complete = true
  s.coverage.columns = s.data.columns.map((c) => c.id)
  s.frame.fields = [s.frame.fields[index]!]
  s.frame.layout = [s.frame.layout[index]!]
  s.frame.slots = [s.frame.slots[index]!]
  if (!coordinate) {
    s.frame.axes = []
    s.frame.coordinates = {}
  }
  const parsed = parseAnalysisSnapshot(s)
  assert.equal(parsed.kind, 'frame')
  if (parsed.kind !== 'frame') throw new Error('frame-required')
  return parsed
}

test('auto uses Frame axes and value roles while preserving complete scalar Dataset display', () => {
  const coordinate = singleFrame(true)
  assert.match(render(coordinate), /class="fv-members-preview"/)
  assert.doesNotMatch(render(coordinate), /data-frame-view="metric"/)

  const scalar = singleFrame(false)
  assert.match(render(scalar), /data-frame-view="metric"/)
  const presence = structuredClone(scalar)
  presence.frame.fields[0]!.role = 'presence'
  assert.match(render(parseAnalysisSnapshot(presence)), /<table/)

  const withPresence = structuredClone(scalar)
  withPresence.data.columns.push({
    id: 'present',
    label: 'Present',
    type: 'boolean',
    nullable: false,
  })
  withPresence.data.rows[0]!.push(true)
  withPresence.coverage.columns.push('present')
  withPresence.frame.fields.push({ id: 'present', role: 'presence', slotId: 'presence' })
  withPresence.frame.layout.push({ kind: 'field', name: 'present', slotId: 'presence' })
  withPresence.frame.slots.push({
    id: 'present',
    slotId: 'presence',
    dtype: { type: 'boolean' },
    nullable: false,
    unit: null,
  })
  assert.match(render(parseAnalysisSnapshot(withPresence)), /data-frame-view="metric"/)

  scalar.data.rowCount = 2
  scalar.data.truncated = true
  scalar.coverage.totalRows = 2
  scalar.coverage.complete = false
  assert.match(render(parseAnalysisSnapshot(scalar)), /<table/)
  const dataset = parseAnalysisSnapshot({
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: coordinate.fetchedAt,
    data: coordinate.data,
    coverage: coordinate.coverage,
    source: { kind: 'dataframe', details: 'not-captured' },
  })
  assert.match(render(dataset), /au-metric-group/)
})

function semanticSections() {
  return {
    semantics: {
      status: 'captured',
      columns: [
        {
          role: 'value',
          id: 'amount',
          valueOrigins: [{ kind: 'metric', path: 'sales.revenue', definitionId: 'def-1' }],
          contextOrigins: [],
          omittedOrigins: 0,
        },
      ],
    },
  }
}

test('current Frame keeps its table and semantic origins entry', () => {
  const value = frameSnapshot() as Record<string, any>
  value.frame.sections = { ...value.frame.sections, ...semanticSections() }
  const snapshot = parseAnalysisSnapshot(value)
  const html = render(snapshot, true)
  assert.match(html, /<table/)
  assert.match(html, /data-icon="origins"/)
})

test('semantic origins show distinct concrete objects and exclude datasource and entity', () => {
  const metric = { kind: 'metric', path: 'sales.revenue', definitionId: 'metric-1' }
  const dimension = { kind: 'time_dimension', path: 'sales.orders.date', definitionId: 'time-1' }
  const section = {
    status: 'captured',
    columns: [
      {
        role: 'value',
        id: 'revenue',
        valueOrigins: [
          { kind: 'datasource', path: 'warehouse', definitionId: 'source-1' },
          { kind: 'entity', path: 'sales.orders', definitionId: 'entity-1' },
          metric,
        ],
        contextOrigins: [dimension],
        omittedOrigins: 0,
      },
      {
        role: 'value',
        id: 'reference.revenue',
        valueOrigins: [metric],
        contextOrigins: [dimension],
        omittedOrigins: 0,
      },
    ],
  }
  const html = renderOrigins(section)
  assert.equal((html.match(/sales\.revenue/g) ?? []).length, 1)
  assert.equal((html.match(/sales\.orders\.date/g) ?? []).length, 1)
  assert.doesNotMatch(html, /warehouse|entity-1|reference\.revenue/)
  assert.equal((html.match(/<button/g) ?? []).length, 2)
})

test('Dataset line/area/bar preserve exact values and null gaps', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = datasetSnapshot()
  for (const chart of ['line', 'area', 'bar'] as const) {
    const html = await renderChart(snapshot, {
      chart,
      encoding: { axis: 'category', values: ['value'] },
    })
    assert.match(html, new RegExp(`data-dataset-view="${chart}"`))
    assert.match(html, /12345678901234\.5678/)
    assert.doesNotMatch(html, /role="alert"/)
    assert.match(html, /aria-haspopup="dialog"/)
  }
  await renderChart(
    datasetSnapshot([
      ['A', '1'],
      ['B', '2'],
      ['C', null],
      ['D', '3'],
      ['E', '4'],
    ]),
    { chart: 'area', encoding: { axis: 'category', values: ['value'] } },
  )
  const areaPath = await page.locator('.recharts-area-area').getAttribute('d')
  assert.equal((areaPath?.match(/M/g) ?? []).length, 2, 'saved null splits the area into two paths')
})

test('Dataset charts expose saved numeric values accessibly', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = datasetSnapshot(
    [
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ],
    [
      { id: 'category', label: 'Category', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'float64', nullable: false },
    ],
  )
  for (const chart of ['line', 'area', 'bar'] as const) {
    const html = await renderChart(snapshot, {
      chart,
      encoding: { axis: 'category', values: ['value'] },
    })
    assert.match(html, /aria-label="Value: 3 items\. A\nValue: 1; B\nValue: 2; C\nValue: 3"/)
  }
})

test('Dataset heatmap retains raw large keys, exact values and empty combinations', async (t) => {
  if (skipBrowserTest(t)) return
  const snapshot = datasetSnapshot(
    [
      ['9007199254740993', 'A', '1.2300'],
      ['9007199254740992', 'B', null],
    ],
    [
      { id: 'x', label: 'X', type: 'int64', nullable: false },
      { id: 'y', label: 'Y', type: 'string', nullable: false },
      { id: 'value', label: 'Value', type: 'decimal', nullable: true },
    ],
  )
  const html = await renderChart(snapshot, {
    chart: 'heatmap',
    encoding: { x: 'x', y: 'y', value: 'value' },
  })
  assert.match(html, /data-dataset-view="heatmap"/)
  assert.match(html, /9007199254740993/)
  assert.match(html, /9007199254740992/)
  assert.match(html, /1\.2300/)
  const grid = page.locator('[data-heatmap-missing-count]')
  const missing = Number(await grid.getAttribute('data-heatmap-missing-count'))
  const nulls = Number(await grid.getAttribute('data-heatmap-null-count'))
  assert.equal(missing, 2)
  assert.equal(nulls, 1)
  assert.equal(missing + nulls, 3)
  assert.equal(await page.locator('[data-mark="cell"]').count(), 1)
  assert.equal(await page.locator('[data-mark="empty"]').count(), 1)
})

test('invalid Dataset views fail locally in saved and candidate rendering', () => {
  const snapshot = datasetSnapshot()
  const view: FrameView = { chart: 'bar', encoding: { axis: 'missing', values: ['value'] } }
  assert.match(render(snapshot, false, view), /role="alert"/)
  assert.match(render(snapshot, false, view, true), /role="alert"/)
})
