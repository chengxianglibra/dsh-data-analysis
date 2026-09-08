import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Locator, type Page } from 'playwright'
import {
  cellText,
  columnLabel,
  datasetById,
  metricText,
  selectedSources,
  valueWithUnit,
} from '../src/client/presentation/model.ts'
import { sourceTabs } from '../src/client/presentation/source-code-model.ts'
import { semanticKindLabel, sourceOverviewFacts } from '../src/client/presentation/source-facts.ts'
import { chartColumns } from '../src/presentation/contracts/charts.ts'
import {
  type PresentationDocument,
  parsePresentationDocument,
} from '../src/presentation/contracts/index.ts'
import { defaultSelection, interactionRows } from '../src/presentation/contracts/interaction.ts'
import type {
  PresentationBlock,
  SourceSnapshot,
  TypedDataset,
} from '../src/presentation/contracts/types.ts'
import { verifyChartGallery, verifyChartReopen } from './presentation-chart-browser.ts'
import { chartGallery } from './presentation-chart-gallery.ts'
import {
  verifyGalleryResizeState,
  verifyResizeState,
  verifyResponsiveGallery,
} from './presentation-responsive-browser.ts'
import { prepareS0WebHost } from './presentation-s0/web-host.ts'

// This exercises the production reader through an actual isolated DSH Web module loader.
// The validation-only shell overlay supplies snapshots. It does not register present, issue
// receipts, or claim S4 Tool/RPC/download delivery or a fresh S2 Runtime execution.
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = path.resolve(packageRoot, '../..')
const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s3-reader-'))
process.stdout.write(`S3 reader evidence: ${outputRoot}\n`)
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const args = process.argv.slice(2)
const options = new Map<string, string>()
for (let index = 0; index < args.length; index += 2) {
  const option = args[index]!
  assert.ok(['--projection-evidence', '--agent-document'].includes(option))
  assert.ok(args[index + 1] && !options.has(option))
  options.set(option, args[index + 1]!)
}
assert.ok(
  args.length % 2 === 0 && args.length <= 4,
  'Usage: validate-presentation-reader-real.ts [--projection-evidence /path/projection-evidence.json] [--agent-document /path/presentation.json]',
)
const cases: { name: string; document: PresentationDocument; provenance: string }[] = []
for (const name of ['artifact', 'computed', 'source-only']) {
  const document = parsePresentationDocument(
    JSON.parse(
      await readFile(
        path.join(packageRoot, `tests/presentation-s0/fixtures/${name}.document.json`),
        'utf8',
      ),
    ),
  )
  cases.push({ name: `s0-${name}`, document, provenance: 'checked-in S0 fixture' })
}
let projectionEvidence: { path: string; sha256: string; runtime: unknown } | undefined
if (options.has('--projection-evidence')) {
  const evidencePath = path.resolve(options.get('--projection-evidence')!)
  const bytes = await readFile(evidencePath)
  const evidence = JSON.parse(bytes.toString()) as Record<string, unknown>
  assert.equal(evidence.status, 'passed', 'S2 evidence must record a passed projection run')
  for (const [name, key] of [
    ['artifact', 'artifact'],
    ['computed', 'computed'],
    ['source-only', 'sourceOnly'],
  ] as const) {
    cases.push({
      name: `s2-${name}`,
      document: parsePresentationDocument(evidence[key]),
      provenance: 'existing S2 real Runtime output snapshot, re-read in this S3 run',
    })
  }
  projectionEvidence = { path: evidencePath, sha256: sha256(bytes), runtime: evidence.runtime }
}

const attack =
  '</script><img src="https://presentation.invalid/xss" onerror="window.__presentationXss=true">'
const interaction = parsePresentationDocument({
  schemaVersion: 2,
  workspaceId: 's3-validation-workspace',
  reportId: 'report',
  buildId: 's3-interactions',
  title: 'S3 交互与安全验证',
  generatedAt: '2026-09-07T00:00:00Z',
  datasets: [
    {
      id: 'values',
      origin: 'computed',
      sourceIds: ['declared', 'missing'],
      data: {
        schemaVersion: 1,
        columns: [
          { id: 'name', label: '分组', type: 'string', nullable: false },
          { id: 'amount', label: '精确金额', type: 'decimal', nullable: false, unit: 'CNY' },
          { id: 'count', label: '数量', type: 'float64', nullable: true, unit: '次' },
          { id: 'other', label: '对照', type: 'float64', nullable: false, unit: '次' },
        ],
        rows: Array.from({ length: 25 }, (_, index) => [
          index === 24 ? attack : `分组 ${String(25 - index).padStart(2, '0')}`,
          `${9007199254740992n + BigInt(24 - index)}.1000`,
          index === 2 ? null : 25 - index,
          index + 1,
        ]),
        rowCount: 25,
        limit: 25,
        truncated: false,
      },
    },
    {
      id: 'empty',
      origin: 'computed',
      sourceIds: [],
      data: {
        schemaVersion: 1,
        columns: [{ id: 'empty', label: '空数据', type: 'string', nullable: true }],
        rows: [],
        rowCount: 0,
        limit: 20,
        truncated: false,
      },
    },
    {
      id: 'negative-values',
      origin: 'computed',
      sourceIds: [],
      data: {
        schemaVersion: 1,
        columns: [
          { id: 'category', label: '类别', type: 'string', nullable: false },
          { id: 'change', label: '变化量', type: 'float64', nullable: false, unit: '次' },
        ],
        rows: [
          ['A', -0.05],
          ['B', -0.01],
        ],
        rowCount: 2,
        limit: 2,
        truncated: false,
      },
    },
    {
      id: 'single-value',
      origin: 'computed',
      sourceIds: [],
      data: {
        schemaVersion: 1,
        columns: [
          { id: 'category', label: '类别', type: 'string', nullable: false },
          { id: 'count', label: '数量', type: 'float64', nullable: false, unit: '次' },
        ],
        rows: [['唯一类别', 12]],
        rowCount: 1,
        limit: 1,
        truncated: false,
      },
    },
  ],
  sources: [
    {
      id: 'declared',
      ref: { sessionId: 's3-session', artifactRef: 's3-artifact', findingId: 's3-finding' },
      status: 'available',
      label: '声明来源',
      facts: [{ label: '安全文本', value: attack }],
    },
    {
      id: 'missing',
      ref: { sessionId: 's3-session', artifactRef: 's3-missing' },
      status: 'unavailable',
      reason: '保存时来源不可用；仅保留声明身份。',
    },
  ],
  blocks: [
    {
      id: 'intro',
      kind: 'markdown',
      text: `## 已保存的正文\n\n**精确值**与来源保持原样。\n\n${attack}\n\n[危险链接](javascript:window.__presentationXss=true)`,
    },
    {
      id: 'amount',
      kind: 'metric',
      datasetId: 'values',
      columnId: 'amount',
      rowIndex: 0,
      label: '首行精确金额',
    },
    {
      id: 'line',
      kind: 'chart',
      datasetId: 'values',
      chart: 'line',
      x: 'name',
      y: ['count', 'other'],
      numericMode: 'exact',
    },
    {
      id: 'approximate',
      kind: 'chart',
      datasetId: 'values',
      chart: 'bar',
      x: 'name',
      y: ['amount'],
      numericMode: 'approximate',
    },
    {
      id: 'negative-bar',
      kind: 'chart',
      datasetId: 'negative-values',
      chart: 'bar',
      x: 'category',
      y: ['change'],
      numericMode: 'exact',
    },
    {
      id: 'single-bar',
      kind: 'chart',
      datasetId: 'single-value',
      chart: 'bar',
      x: 'category',
      y: ['count'],
      numericMode: 'exact',
    },
    { id: 'table', kind: 'table', datasetId: 'values' },
    { id: 'empty-table', kind: 'table', datasetId: 'empty' },
    { id: 'sources', kind: 'source', sourceIds: ['declared', 'missing'] },
  ],
  diagnostics: [],
})
cases.push({
  name: 'interactions',
  document: interaction,
  provenance: 'synthetic interaction/security fixture',
})
cases.push({
  name: 'chart-gallery',
  document: await chartGallery(),
  provenance: 'runnable synthetic Skill chart examples',
})
let agentDocumentEvidence: { path: string; sha256: string } | undefined
if (options.has('--agent-document')) {
  const filename = path.resolve(options.get('--agent-document')!)
  const bytes = await readFile(filename)
  cases.push({
    name: 'agent-complex-charts',
    document: parsePresentationDocument(JSON.parse(bytes.toString())),
    provenance: 'saved Agent document re-read by current reader; generation verified separately',
  })
  agentDocumentEvidence = { path: filename, sha256: sha256(bytes) }
}

const { buildPresentation } = (await import(
  pathToFileURL(path.join(packageRoot, 'lib/presentation/build/index.js')).href
)) as {
  buildPresentation(document: PresentationDocument): Promise<{
    document: PresentationDocument
    documentBytes: Buffer
    htmlBytes: Buffer
  }>
}
const portableFiles = new Map<string, string>()
for (const item of cases) {
  const result = await buildPresentation(item.document)
  assert.deepEqual(result.document, item.document)
  assert.deepEqual(JSON.parse(result.documentBytes.toString()), item.document)
  const filename = path.join(outputRoot, `${item.name}.html`)
  await writeFile(filename, result.htmlBytes)
  await writeFile(path.join(outputRoot, `${item.name}.json`), result.documentBytes)
  portableFiles.set(item.name, filename)
}

const productionClient = await readFile(path.join(packageRoot, 'lib/client.js'), 'utf8')
assert.ok(productionClient.includes('HostPresentationReader'), 'Run npm run build first')
assert.ok(
  productionClient.includes('window.__ModuleLoader__.load('),
  'Build the production client module-loader bundle before this validation',
)
const overlay = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: repoRoot,
    contents: `
import {useEffect,useState,version} from 'react';
import {HostPresentationReader} from '@chengxianglibra/dsh-data-analysis/client';
const cases=${JSON.stringify(cases.map(({ name, document }) => ({ name, document })))};
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze)}return value}
cases.forEach(freeze);
export const inject=['slots','theme'];
export function apply(ctx){
 ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'presentation-s3-open'},()=>
  <button type="button" onClick={()=>window.dispatchEvent(new Event('presentation-s3-open'))}>打开 S3 验证</button>));
 ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'presentation-s3-reader'},function Validation(){
  const [index,setIndex]=useState(0);
  const [open,setOpen]=useState(false);
  const [theme,setTheme]=useState(()=>ctx.theme.getTheme());
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('presentation-s3-open',show);return ()=>window.removeEventListener('presentation-s3-open',show)},[]);
  useEffect(()=>ctx.on('theme/change',()=>setTheme(ctx.theme.getTheme())),[]);
  if(!open)return null;
  return <div role="dialog" aria-label="S3 reader 验证" style={{position:'fixed',inset:0,zIndex:10000,overflow:'auto',background:'var(--presentation-bg,#fff)'}}>
   <nav aria-label="验证样例">{cases.map((item,i)=><button type="button" key={item.name} onClick={()=>setIndex(i)}>{item.name}</button>)}</nav>
   <nav aria-label="验证主题"><button type="button" onClick={()=>ctx.theme.setTheme('light')}>Host 浅色</button><button type="button" onClick={()=>ctx.theme.setTheme('dark')}>Host 深色</button><output data-host-theme={theme.preference}>{theme.active.colorScheme}</output></nav>
   <small data-host-react={version}>Host React {version}</small>
   <HostPresentationReader key={cases[index].name} document={cases[index].document}/>
  </div>
 }));
}`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/*', '@chengxianglibra/dsh-data-analysis/client'],
})
const client = `${productionClient}\nwindow.__ModuleLoader__.load({id:'dsh-presentation-s0',factory:(require)=>{var module={exports:{}};var exports=module.exports;${overlay.outputFiles[0]!.text};return module.exports;}});`
const host = await prepareS0WebHost(path.join(outputRoot, 'workspace'), outputRoot)
const server = await host.start(client)
let browser: Browser | undefined
let activePage: Page | undefined
const errors: string[] = []
const checks: Record<string, unknown>[] = []

async function expandDetails(reader: Locator) {
  // Open visible parents before nested disclosures; CSS-hidden summaries stay untouched.
  while (true) {
    let expanded = false
    for (const summary of await reader.locator('details:not([open]) > summary').all()) {
      if (!(await summary.isVisible())) continue
      await summary.focus()
      await summary.press('Enter')
      expanded = true
      break
    }
    if (!expanded) return
  }
}

function sourceSelection(document: PresentationDocument, block: PresentationBlock) {
  const ids =
    block.kind === 'source'
      ? block.sourceIds
      : 'datasetId' in block
        ? datasetById(document, block.datasetId).sourceIds
        : []
  return selectedSources(document, ids)
}

async function verifySourceOverview(
  overview: Locator,
  document: PresentationDocument,
  sources: SourceSnapshot[],
) {
  assert.ok(await overview.isVisible())
  assert.equal(
    await overview.locator(':scope > .pr-source-overview-grid time').getAttribute('datetime'),
    document.generatedAt,
  )
  const snapshot: Record<string, unknown>[] = []
  let expectedCards = 0
  for (const source of sources) {
    const { createdAt, semanticGroups, issues, notices } = sourceOverviewFacts(source)
    const included =
      source.status === 'unavailable' ||
      Boolean(createdAt || semanticGroups.length || issues.length || notices.length)
    const card = overview.locator(`[data-source-id="${source.id}"]`)
    assert.equal(await card.count(), included ? 1 : 0, `source ${source.id}: unexpected card count`)
    if (!included) continue
    expectedCards++
    assert.ok(await card.isVisible())
    const text = await card.innerText()
    if (source.status === 'unavailable') assert.ok(text.includes(source.reason))
    if (createdAt) {
      if (Number.isNaN(Date.parse(createdAt))) assert.ok(text.includes(createdAt))
      else assert.equal(await card.locator('time').getAttribute('datetime'), createdAt)
    }
    for (const group of semanticGroups) {
      assert.ok(text.includes(semanticKindLabel(group.kind)))
      for (const semanticPath of group.paths) assert.ok(text.includes(semanticPath))
    }
    for (const issue of issues) {
      assert.ok(text.includes(issue.kind))
      if (issue.severity) assert.ok(text.includes(issue.severity))
    }
    for (const notice of notices) assert.ok(text.includes(notice))
    snapshot.push({ source: source.id, text: text.trim() })
  }
  assert.equal(await overview.locator('[data-source-id]').count(), expectedCards)
  return snapshot
}

async function openCellMenu(cell: Locator) {
  const trigger = cell.getByRole('button', { name: 'cell 更多操作', exact: true })
  await trigger.focus()
  await trigger.press('Enter')
  const menu = cell.getByRole('menu', { name: 'cell 操作', exact: true })
  await menu.waitFor({ state: 'visible' })
  assert.equal(await menu.getByRole('menuitem', { name: '复制上下文', exact: true }).count(), 1)
  return { menu, trigger }
}

async function openSourceDialog(reader: Locator, cell: Locator) {
  const { menu, trigger } = await openCellMenu(cell)
  assert.equal(
    await menu.getByRole('menuitem').count(),
    (await cell.getAttribute('data-block-kind')) === 'chart' ? 3 : 2,
  )
  await menu.getByRole('menuitem', { name: '数据源', exact: true }).press('Enter')
  const dialog = reader.getByRole('dialog', { name: '数据源', exact: true })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.count(), 1)
  return { dialog, trigger }
}

async function closeSourceDialog(dialog: Locator, trigger: Locator) {
  await dialog.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.ok(await trigger.evaluate((node) => node.ownerDocument.activeElement === node))
}

async function verifyDatasetTable(
  container: Locator,
  dataset: TypedDataset,
  columns: string[],
  staticMode: boolean,
) {
  const table = container.locator('table')
  assert.equal(await table.count(), 1)
  assert.ok(await table.isVisible())
  assert.deepEqual(
    await table
      .locator('thead th')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-column-id'))),
    columns,
  )
  const indices = columns.map((id) => dataset.columns.findIndex((column) => column.id === id))
  const rows = dataset.rows.slice(0, staticMode ? undefined : 20)
  const expected = rows.flatMap((row) =>
    indices.map((index) => cellText(row[index]!, dataset.columns[index]!)),
  )
  const actual = await table.locator('tbody td').allTextContents()
  assert.deepEqual(actual, expected)
  assert.equal(await table.locator('tbody tr').count(), rows.length)
  if (dataset.truncated) assert.match(await container.innerText(), /已截断/)
  return actual
}

async function verifyEmbeddedDocument(page: Page, expected: PresentationDocument) {
  const embedded = JSON.parse((await page.locator('#presentation-data').textContent())!)
  assert.deepEqual(embedded, expected)
  assert.deepEqual(embedded.sources, expected.sources)
}

async function verifyReader(
  page: Page,
  document: PresentationDocument,
  staticMode = false,
  printMode = false,
) {
  assert.ok(!printMode || staticMode, 'Print validation must inspect the static fallback')
  const reader = page.locator(
    `[data-presentation-reader][data-mode="${staticMode ? 'static' : 'interactive'}"]`,
  )
  await reader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  if (printMode) assert.equal(await reader.locator('details[open]').count(), 0)
  else if (staticMode) await expandDetails(reader)
  assert.equal(
    await reader.getByRole('button', { name: 'cell 更多操作', exact: true }).count(),
    staticMode ? 0 : document.blocks.length,
  )
  const snapshot: Record<string, unknown>[] = []
  for (const block of document.blocks) {
    const node = reader.locator(`[data-block-id="${block.id}"]`)
    await node.waitFor()
    if (block.kind === 'markdown') {
      const text = await node.locator('.pr-markdown').innerText()
      if (document.buildId === interaction.buildId) {
        assert.ok(text.includes('已保存的正文'))
        assert.ok(text.includes('精确值'))
        assert.ok(text.includes(attack))
      } else {
        // These fixtures use basic headings, lists, emphasis and inline code; their syntax
        // is not literal reader text. The embedded document retains the complete source.
        const plain = block.text
          .replace(/^\s*#{1,6}\s+/gm, '')
          .replace(/^\s*[-*+]\s+/gm, '')
          .replace(/`([^`\n]+)`/g, '$1')
          .replace(/\*\*([^\n]+?)\*\*/g, '$1')
          .replace(/\s+/g, ' ')
          .trim()
        assert.ok(text.replace(/\s+/g, ' ').includes(plain), `markdown ${block.id} lost its body`)
      }
      snapshot.push({ id: block.id, markdown: text.trim() })
      if (!staticMode) {
        const { menu, trigger } = await openCellMenu(node)
        assert.equal(await menu.getByRole('menuitem').count(), 1)
        assert.equal(await menu.getByRole('menuitem', { name: '数据源', exact: true }).count(), 0)
        await menu.getByRole('menuitem', { name: '复制上下文', exact: true }).press('Escape')
        await menu.waitFor({ state: 'detached' })
        assert.ok(
          await trigger.evaluate((element) => element.ownerDocument.activeElement === element),
        )
      }
      continue
    }
    const dataset = 'datasetId' in block ? datasetById(document, block.datasetId).data : undefined
    const selected = dataset
      ? block.kind === 'chart'
        ? chartColumns(block)
        : block.kind === 'table' && block.columns
          ? block.columns
          : dataset.columns.map((column) => column.id)
      : []
    if (block.kind === 'metric') {
      const index = dataset!.columns.findIndex((column) => column.id === block.columnId)
      const column = dataset!.columns[index]!
      const value =
        dataset!.rows[
          block.rowSelection === 'slice'
            ? interactionRows(
                document.interaction,
                defaultSelection(document.interaction!),
                block,
              )![0]!
            : block.rowIndex
        ]![index]!
      const metric = node.locator('[data-metric-value]')
      assert.equal(await metric.count(), 1, `metric ${block.id} must have one displayed value`)
      assert.equal(await metric.innerText(), metricText(value, column))
      assert.equal(
        await metric.getAttribute('title'),
        value === null ? '缺失值' : valueWithUnit(value, column),
      )
      snapshot.push({ id: block.id, metric: await metric.innerText() })
    }
    if (block.kind === 'table' || (block.kind === 'chart' && staticMode)) {
      snapshot.push({
        id: block.id,
        cells: await verifyDatasetTable(node, dataset!, selected, staticMode),
      })
    }
    if (block.kind === 'chart' && !staticMode) {
      if (dataset!.truncated) assert.match(await node.innerText(), /已截断/)
      if (dataset!.rows.length) {
        await node.locator('svg').first().waitFor()
        const marks =
          block.chart === 'line' || block.chart === 'sparkline'
            ? '.recharts-line-curve'
            : block.chart === 'bar' ||
                block.chart === 'horizontalBar' ||
                block.chart.includes('StackedBar') ||
                block.chart.startsWith('stackedBar')
              ? '.recharts-bar-rectangle'
              : '[data-chart-mark],.recharts-area-area,.recharts-scatter-symbol'
        assert.ok(await node.locator(marks).count(), `${block.chart} has no plotted marks`)
      }
      assert.equal(await node.locator('table,select').count(), 0)
    }
    if (!staticMode) {
      const { dialog, trigger } = await openSourceDialog(reader, node)
      const overview = dialog.locator('.pr-source-overview')
      const sources = await verifySourceOverview(
        overview,
        document,
        sourceSelection(document, block),
      )
      snapshot.push({ id: block.id, sources })
      if (dataset) {
        const overviewColumns = block.kind === 'metric' ? [block.columnId] : selected
        assert.deepEqual(
          await overview.locator('.pr-source-fields li').allTextContents(),
          overviewColumns.map((id) =>
            columnLabel(dataset.columns.find((column) => column.id === id)!),
          ),
        )
        assert.equal(await dialog.getByRole('tab').count(), sourceTabs(true).length)
        await dialog.getByRole('tab', { name: '数据预览', exact: true }).click()
        const preview = dialog.getByRole('tabpanel', { name: '数据预览', exact: true })
        await preview.waitFor({ state: 'visible' })
        snapshot.push({
          id: block.id,
          previewCells: await verifyDatasetTable(preview, dataset, selected, false),
        })
      } else assert.equal(await dialog.getByRole('tab').count(), sourceTabs(false).length)
      await closeSourceDialog(dialog, trigger)
    }
  }
  if (staticMode && document.sources.length) {
    const summary = reader.locator('details.pr-source-summary')
    assert.equal(await summary.count(), 1)
    snapshot.push({
      sources: await verifySourceOverview(
        summary.locator('.pr-source-overview'),
        document,
        document.sources,
      ),
    })
  }
  if (printMode) assert.equal(await reader.locator('details[open]').count(), 0)
  if (!document.datasets.length) assert.equal(await reader.locator('table').count(), 0)
  assert.equal(
    await reader.locator('img,script,iframe,object,embed,a[href^="javascript:"]').count(),
    0,
  )
  assert.equal(await page.evaluate(() => '__presentationXss' in window), false)
  return snapshot
}

const yAxisTickSelector = '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value'
const yAxisTitleSelector = '.recharts-label[transform^="rotate(-90"]'

async function verifyBarGeometry(reader: Locator) {
  const snapshots = []
  for (const [blockId, expectedCount, direction] of [
    ['negative-bar', 2, 'negative'],
    ['single-bar', 1, 'positive'],
  ] as const) {
    const cell = reader.locator(`[data-block-id="${blockId}"]`)
    const rectangles = cell.locator('.recharts-bar-rectangle')
    assert.equal(await rectangles.count(), expectedCount, `${blockId}: a nonzero bar disappeared`)
    const zeroLine = cell.locator('.recharts-reference-line-line')
    assert.equal(await zeroLine.count(), 1, `${blockId}: zero baseline is missing`)
    assert.equal(await zeroLine.getAttribute('y1'), await zeroLine.getAttribute('y2'))
    const ticks = cell.locator(yAxisTickSelector)
    assert.ok((await ticks.count()) > 0, `${blockId}: numeric tick labels are missing`)
    assert.ok(
      (await ticks.allTextContents()).includes('0'),
      `${blockId}: numeric axis must retain the zero tick`,
    )
    const zeroY = await zeroLine.evaluate((node) => node.getBoundingClientRect().top)
    const bars = []
    for (const rectangle of await rectangles.all()) {
      const bounds = await rectangle.boundingBox()
      assert.ok(bounds && bounds.height > 0, `${blockId}: expected a nonzero bar height`)
      assert.ok(bounds.width > 0 && bounds.width <= 48.01, `${blockId}: bar width exceeds 48px`)
      const zeroEdge = direction === 'negative' ? bounds.y : bounds.y + bounds.height
      assert.ok(Math.abs(zeroEdge - zeroY) <= 1, `${blockId}: bar does not start from zero`)
      bars.push({ width: bounds.width, height: bounds.height })
    }
    snapshots.push({ blockId, zeroTick: true, bars })
  }
  return snapshots
}

async function verifyInteractions(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
  const barGeometry = await verifyBarGeometry(reader)
  const table = reader.locator('[data-block-id="table"]')
  assert.equal(await table.locator('tbody tr').count(), 20)
  const sort = table.getByRole('button', { name: '按 精确金额 排序', exact: true })
  await sort.focus()
  await sort.press('Enter')
  assert.ok((await table.locator('tbody tr').first().innerText()).includes('9007199254740992.1000'))
  await sort.press('Enter')
  assert.ok((await table.locator('tbody tr').first().innerText()).includes('9007199254741016.1000'))
  await table.getByRole('button', { name: '下一页', exact: true }).click()
  assert.equal(await table.locator('tbody tr').count(), 5)
  assert.ok((await table.innerText()).includes('9007199254740992.1000'))
  const pageRows = await table.locator('tbody tr').allTextContents()
  const paginationResize = await verifyResizeState(page, async () => {
    assert.deepEqual(await table.locator('tbody tr').allTextContents(), pageRows)
  })
  await table.getByRole('button', { name: '上一页', exact: true }).click()
  assert.equal(await table.locator('tbody tr').count(), 20)
  const chart = reader.locator('[data-block-id="line"]')
  const series = chart.getByRole('button', { name: '显示系列 对照', exact: true })
  assert.equal(await series.getAttribute('aria-pressed'), 'true')
  assert.equal(await chart.locator('.recharts-line-curve').count(), 2)
  await series.focus()
  await series.press('Space')
  assert.equal(await series.getAttribute('aria-pressed'), 'false')
  assert.equal(await chart.locator('.recharts-line-curve').count(), 1)
  await series.press('Space')
  assert.equal(await chart.locator('.recharts-line-curve').count(), 2)
  const approximate = reader.locator('[data-block-id="approximate"]')
  const { dialog, trigger } = await openSourceDialog(reader, approximate)
  const overviewTab = dialog.getByRole('tab', { name: '概要', exact: true })
  const previewTab = dialog.getByRole('tab', { name: '数据预览', exact: true })
  assert.equal(await overviewTab.getAttribute('aria-selected'), 'true')
  await overviewTab.focus()
  await overviewTab.press('ArrowRight')
  assert.equal(await previewTab.getAttribute('aria-selected'), 'true')
  assert.ok(await previewTab.evaluate((node) => node.ownerDocument.activeElement === node))
  const preview = dialog.getByRole('tabpanel', { name: '数据预览', exact: true })
  await verifyDatasetTable(preview, interaction.datasets[0]!.data, ['name', 'amount'], false)
  await previewTab.press('Home')
  assert.equal(await overviewTab.getAttribute('aria-selected'), 'true')
  assert.ok(await overviewTab.evaluate((node) => node.ownerDocument.activeElement === node))
  await overviewTab.press('End')
  assert.equal(await dialog.getByRole('tab').last().getAttribute('aria-selected'), 'true')
  await dialog.getByRole('tab').last().press('Home')
  await overviewTab.press('ArrowRight')
  await previewTab.press('Tab')
  assert.ok(await dialog.evaluate((node) => node.contains(node.ownerDocument.activeElement)))
  await closeSourceDialog(dialog, trigger)
  await approximate.locator('.recharts-bar-rectangle').first().hover()
  const pointerTooltip = approximate.locator('.recharts-tooltip-wrapper [data-chart-tooltip]')
  await pointerTooltip.waitFor({ state: 'visible' })
  assert.ok((await pointerTooltip.innerText()).includes('9007199254741016.1000'))
  const followUp = chart.locator('.pr-copy')
  const { menu: copyMenu, trigger: copyTrigger } = await openCellMenu(chart)
  await copyMenu.getByRole('menuitem', { name: '复制上下文', exact: true }).press('Enter')
  await copyMenu.waitFor({ state: 'detached' })
  await followUp.getByText('已复制', { exact: true }).waitFor()
  assert.ok(await copyTrigger.evaluate((node) => node.ownerDocument.activeElement === node))
  const clipboard = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return null
    }
  })
  const copied =
    clipboard ?? (await followUp.getByLabel('cell 上下文', { exact: true }).inputValue())
  assert.ok(copied.includes('Cell: line'))
  assert.ok(copied.includes('"x":"name","y":["count","other"]'))
  assert.ok(!copied.includes('保存行索引'))
  assert.ok(!copied.includes('9007199254741016.1000'))
  assert.ok(copied.includes('s3-artifact'))
  assert.ok(copied.includes('s3-session'))
  assert.equal(await reader.locator('.pr-header .pr-copy').count(), 0)
  return {
    sortingExactDecimal: true,
    pagination: true,
    paginationResize,
    seriesKeyboard: true,
    pointerTooltip: true,
    sourceModalKeyboardTabs: true,
    sourceEscapeFocus: true,
    exactPreview: true,
    cellContextCopied: true,
    copiedSourceIdentity: true,
    barGeometry,
  }
}

async function verifyHostTheme(page: Page) {
  const snapshots = []
  for (const [hostPreference, osPreference, label] of [
    ['dark', 'light', 'Host 深色'],
    ['light', 'dark', 'Host 浅色'],
  ] as const) {
    await page.emulateMedia({ colorScheme: osPreference })
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.locator(`[data-host-theme="${hostPreference}"]`).waitFor()
    const snapshot = await page.evaluate(() => {
      const reader = getComputedStyle(document.querySelector('[data-mode="interactive"]')!)
      return {
        darkAttribute: document.body.hasAttribute('data-ds-dark-theme'),
        hostBackgroundToken: getComputedStyle(document.body)
          .getPropertyValue('--dsw-alias-bg-base')
          .trim(),
        readerBackgroundToken: reader.getPropertyValue('--pr-bg').trim(),
        background: reader.backgroundColor,
        color: reader.color,
      }
    })
    assert.equal(snapshot.darkAttribute, hostPreference === 'dark')
    assert.equal(snapshot.readerBackgroundToken, snapshot.hostBackgroundToken)
    snapshots.push({ hostPreference, osPreference, ...snapshot })
    await page
      .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
      .evaluate((node) => node.scrollTo(0, 0))
    await page.screenshot({ path: path.join(outputRoot, `host-manual-${hostPreference}.png`) })
  }
  assert.notEqual(snapshots[0]!.background, snapshots[1]!.background)
  await page.emulateMedia({ colorScheme: 'light' })
  return {
    boundary:
      'Actual Host ThemeRuntime.setTheme and theme/change through validation buttons; actual ThemePresenter applies body attributes/tokens',
    snapshots,
  }
}

async function waitForResponsiveCharts(page: Page) {
  // ResizeObserver must publish the new container width before inspecting SVG geometry.
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>('.pr-chart .recharts-wrapper')].every((node) => {
      if (!node.getBoundingClientRect().width) return true
      const chart = node.closest<HTMLElement>('.pr-chart')!
      return node.getBoundingClientRect().width <= chart.clientWidth + 1
    }),
  )
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url })
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  // The fresh isolated DSH profile's first-use notice is owned by the Host.
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.getByRole('button', { name: '打开 S3 验证', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
    .waitFor({ timeout: 45_000 })
  const hostReact = await page.locator('[data-host-react]').getAttribute('data-host-react')
  assert.equal(hostReact, '18.3.1')
  const loaderMode = await page.evaluate(
    () => (window as unknown as { __ModuleLoader__: { mode: string } }).__ModuleLoader__.mode,
  )
  assert.equal(loaderMode, 'live')
  for (const item of cases) {
    await page
      .getByRole('navigation', { name: '验证样例', exact: true })
      .getByRole('button', { name: item.name, exact: true })
      .click()
    const hostSnapshot = await verifyReader(page, item.document)
    await page
      .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
      .evaluate((node) => node.scrollTo(0, 0))
    await page
      .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
      .screenshot({ path: path.join(outputRoot, `${item.name}-host.png`) })
    const offline = await browser.newContext({
      offline: true,
      viewport: { width: 1440, height: 1100 },
    })
    const offlinePage = await offline.newPage()
    const requests: string[] = []
    offlinePage.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url())
    })
    offlinePage.on('pageerror', (error) => errors.push(error.message))
    await offlinePage.goto(pathToFileURL(portableFiles.get(item.name)!).href)
    await offlinePage.waitForFunction(
      () => document.documentElement.dataset.presentationReady === 'true',
    )
    await verifyEmbeddedDocument(offlinePage, item.document)
    assert.deepEqual(await verifyReader(offlinePage, item.document), hostSnapshot)
    await offlinePage.screenshot({
      path: path.join(outputRoot, `${item.name}-offline.png`),
      fullPage: true,
    })
    let interactions: unknown
    if (item.name === 'chart-gallery') {
      interactions = {
        hostResponsive: await verifyResponsiveGallery(
          page,
          outputRoot,
          'gallery-host',
          'module-loader',
        ),
        portableResponsive: await verifyResponsiveGallery(
          offlinePage,
          outputRoot,
          'gallery-portable',
          'portable',
        ),
        hostResizeState: await verifyGalleryResizeState(page),
        portableResizeState: await verifyGalleryResizeState(offlinePage),
        host: await verifyChartGallery(page),
        portable: await verifyChartGallery(offlinePage),
        hostReopen: await verifyChartReopen(page, async () => {
          const navigation = page.getByRole('navigation', { name: '验证样例', exact: true })
          await navigation.getByRole('button', { name: 's0-artifact', exact: true }).click()
          await navigation.getByRole('button', { name: item.name, exact: true }).click()
        }),
        portableReopen: await verifyChartReopen(offlinePage, async () => {
          await offlinePage.reload()
          await offlinePage.waitForFunction(
            () => document.documentElement.dataset.presentationReady === 'true',
          )
        }),
      }
      await verifyEmbeddedDocument(offlinePage, item.document)
      await offlinePage.setViewportSize({ width: 375, height: 812 })
      await offlinePage.emulateMedia({ colorScheme: 'dark' })
      await waitForResponsiveCharts(offlinePage)
      assert.equal(
        await offlinePage.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        true,
      )
      await offlinePage.screenshot({
        path: path.join(outputRoot, 'chart-gallery-narrow-dark.png'),
        fullPage: true,
      })
      await offlinePage.setViewportSize({ width: 1440, height: 1100 })
      await offlinePage.emulateMedia({ colorScheme: 'light' })
    }
    if (item.name === 'interactions') {
      interactions = {
        hostTheme: await verifyHostTheme(page),
        host: await verifyInteractions(page),
        portable: await verifyInteractions(offlinePage),
      }
      const lightBackground = await offlinePage
        .locator('[data-presentation-reader][data-mode="interactive"]')
        .evaluate((node) => getComputedStyle(node).backgroundColor)
      await offlinePage.setViewportSize({ width: 375, height: 812 })
      await offlinePage.emulateMedia({ colorScheme: 'dark' })
      await waitForResponsiveCharts(offlinePage)
      const layout = await offlinePage.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        background: getComputedStyle(document.querySelector('[data-mode="interactive"]')!)
          .backgroundColor,
        color: getComputedStyle(document.querySelector('[data-mode="interactive"]')!).color,
      }))
      assert.notEqual(layout.background, lightBackground, 'dark theme did not change reader colors')
      const luminance = (color: string) => {
        const channels = color
          .match(/\d+/g)!
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const fg = luminance(layout.color)
      const bg = luminance(layout.background)
      const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
      assert.ok(contrast >= 4.5, `dark body contrast is only ${contrast}`)
      assert.ok(
        layout.scrollWidth <= layout.width + 1,
        `narrow reader overflows: ${JSON.stringify(layout)}`,
      )
      await offlinePage.screenshot({
        path: path.join(outputRoot, 'interactions-narrow-dark-full.png'),
        fullPage: true,
      })
      await offlinePage.evaluate(() => window.scrollTo(0, 0))
      await offlinePage.screenshot({ path: path.join(outputRoot, 'interactions-narrow-dark.png') })
      for (const [blockId, mark] of [
        ['line', '.recharts-line-curve'],
        ['approximate', '.recharts-bar-rectangle'],
        ['negative-bar', '.recharts-bar-rectangle'],
        ['single-bar', '.recharts-bar-rectangle'],
      ] as const) {
        const chart = offlinePage.locator(`[data-mode="interactive"] [data-block-id="${blockId}"]`)
        await chart
          .locator(':scope > h2')
          .evaluate((node) => node.scrollIntoView({ block: 'start' }))
        const surface = await chart.locator('svg.recharts-surface').boundingBox()
        assert.ok(surface)
        assert.ok((await chart.locator(yAxisTickSelector).count()) > 0)
        assert.equal(await chart.locator(yAxisTitleSelector).count(), 1)
        for (const label of await chart
          .locator(`${yAxisTickSelector}, ${yAxisTitleSelector}`)
          .all()) {
          const bounds = await label.boundingBox()
          assert.ok(
            bounds && bounds.x >= 0 && bounds.x + bounds.width <= layout.width + 1,
            `narrow ${blockId} Y-axis title or tick is clipped horizontally`,
          )
          assert.ok(
            bounds.y >= surface.y - 1 && bounds.y + bounds.height <= surface.y + surface.height + 1,
            `narrow ${blockId} Y-axis title or tick is clipped vertically`,
          )
        }
        // Two trend paths can cross at their bounding-box centers; the last path is topmost.
        await chart.locator(mark).last().hover()
        const tooltip = chart.locator('.recharts-tooltip-wrapper [data-chart-tooltip]')
        await tooltip.waitFor({ state: 'visible' })
        const bounds = await tooltip.boundingBox()
        await offlinePage.screenshot({
          path: path.join(outputRoot, `interactions-narrow-dark-${blockId}.png`),
        })
        assert.ok(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= 376,
          `narrow ${blockId} tooltip is clipped horizontally: ${JSON.stringify(bounds)}`,
        )
      }
      const longLabelChart = offlinePage.locator(
        '[data-mode="interactive"] [data-block-id="approximate"]',
      )
      await longLabelChart.locator('.recharts-bar-rectangle').last().hover()
      const longLabelTooltip = longLabelChart.locator(
        '.recharts-tooltip-wrapper [data-chart-tooltip]',
      )
      await longLabelTooltip.waitFor({ state: 'visible' })
      assert.ok((await longLabelTooltip.innerText()).includes(attack))
      const longLabelBounds = await longLabelTooltip.boundingBox()
      assert.ok(
        longLabelBounds &&
          longLabelBounds.x >= 0 &&
          longLabelBounds.x + longLabelBounds.width <= 376,
        `Long category tooltip is clipped: ${JSON.stringify(longLabelBounds)}`,
      )
      await offlinePage.screenshot({
        path: path.join(outputRoot, 'interactions-narrow-long-label.png'),
      })
      checks.push({
        narrowDark: { ...layout, contrast },
        longCategoryTooltip: true,
        keyboard: true,
        barGeometry: await verifyBarGeometry(
          offlinePage.locator('[data-presentation-reader][data-mode="interactive"]'),
        ),
      })
    }
    await offlinePage.emulateMedia({ media: 'print', colorScheme: 'light' })
    assert.ok(await offlinePage.locator('#presentation-fallback').isVisible())
    assert.ok(!(await offlinePage.locator('#reader').isVisible()))
    await verifyReader(offlinePage, item.document, true, true)
    await offlinePage.pdf({
      path: path.join(outputRoot, `${item.name}-print.pdf`),
      format: 'A4',
      printBackground: true,
    })
    assert.deepEqual(requests, [])
    await offline.close()
    const noScript = await browser.newContext({ javaScriptEnabled: false, offline: true })
    const noScriptPage = await noScript.newPage()
    const noScriptRequests: string[] = []
    noScriptPage.on('request', (request) => {
      if (!request.url().startsWith('file:')) noScriptRequests.push(request.url())
    })
    await noScriptPage.goto(pathToFileURL(portableFiles.get(item.name)!).href)
    await verifyEmbeddedDocument(noScriptPage, item.document)
    await verifyReader(noScriptPage, item.document, true)
    assert.deepEqual(noScriptRequests, [])
    await noScript.close()
    checks.push({
      name: item.name,
      provenance: item.provenance,
      hostPortableParity: true,
      offlineRequests: requests,
      noScriptRequests,
      staticAndPrintReadable: true,
      defaultPrintDisclosures: true,
      noScriptSourcesExpandable: true,
      embeddedSourceSnapshotsUnchanged: true,
      interactions,
    })
    process.stdout.write(`S3 reader passed: ${item.name}\n`)
  }
  assert.deepEqual(errors, [])
  const evidence = {
    status: 'passed',
    outputRoot,
    browser: browser.version(),
    hostReact,
    loaderMode,
    productionClientSha256: sha256(productionClient),
    boundary:
      'Production lib/client.js loaded unchanged by actual DSH Web module loader with Host React; validation-only snapshot overlay. Production portable builder, file:// offline, no-JS and print.',
    excluded: [
      'S4 present/receipt/RPC/download delivery',
      'fresh S2 Runtime execution',
      'real Agent routing',
    ],
    projectionEvidence,
    agentDocumentEvidence,
    checks,
    errors,
  }
  await writeFile(path.join(outputRoot, 'reader-evidence.json'), JSON.stringify(evidence, null, 2))
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
} catch (error) {
  await writeFile(path.join(outputRoot, 'reader-failure.txt'), String(error))
  await writeFile(
    path.join(outputRoot, 'reader-partial-evidence.json'),
    JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2),
  )
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(outputRoot, 'failure.png') }).catch(() => {})
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await activePage.locator('body').innerText(),
    ).catch(() => {})
  }
  throw error
} finally {
  await browser?.close()
  await server.stop()
}
