import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { translator } from './../../src/client/i18n/copy.ts'
import { columnLabel } from '../../src/client/presentation/model.ts'
import {
  sourceCodeFacts,
  sourceTabForKey,
  sourceTabs,
} from '../../src/client/presentation/source-code-model.ts'
import {
  semanticKindLabel,
  sourceOverviewFacts,
} from '../../src/client/presentation/source-facts.ts'
import { kindLabels } from '../../src/client/semantic-browser/labels.ts'
import type {
  PresentationBlock,
  PresentationDocument,
  SourceSnapshot,
} from '../../src/presentation/contracts/types.ts'

let renderStatic: (document: PresentationDocument) => string
let directory: string
let renderOverview: (document: PresentationDocument, block?: PresentationBlock) => string
let renderDialog: (
  document: PresentationDocument,
  block: PresentationBlock,
  rowIndices?: number[],
  navigation?: boolean,
) => string
let formatSource: (text: string, language: 'python' | 'sql') => { text: string; formatted: boolean }

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-source-render-'))
  const outfile = path.join(directory, 'sources.mjs')
  await build({
    loader: { '.wasm': 'binary' },
    target: 'es2022',
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { CopyProvider } from './src/client/i18n/context.tsx';
import { translator as fixtureTranslator } from './src/client/i18n/copy.ts';
const renderToStaticMarkup = node => renderMarkup(createElement(CopyProvider, { t: fixtureTranslator('zh-CN') }, node));
import { SourceOverview } from './src/client/presentation/sources.tsx';
import { PresentationReader } from './src/client/presentation/reader.tsx';
import { SourceDialog } from './src/client/presentation/source-dialog.tsx';
export { formatSource } from './src/client/presentation/source-format.ts';
export function renderOverview(document, block) { return renderToStaticMarkup(createElement(SourceOverview, { document, block })); }
export function renderStatic(document) { return renderToStaticMarkup(createElement(PresentationReader, { document, mode: 'static' })); }
export function renderDialog(document, block, rowIndices, navigation) { return renderToStaticMarkup(createElement(SourceDialog, { document, block, rowIndices, onOpenSemanticRef: navigation ? () => {} : undefined, onClose() {} })); }`,
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'silent',
  })
  ;({ renderOverview, renderDialog, renderStatic, formatSource } = await import(
    pathToFileURL(outfile).href
  ))
})

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

const source: Extract<SourceSnapshot, { status: 'available' }> = {
  id: 'sales',
  status: 'available',
  label: 'metric_frame art_saved',
  ref: { sessionId: 'session_saved', artifactRef: 'art_saved' },
  facts: [
    { label: '内容身份', value: 'hash_saved' },
    { label: '读取时间', value: '2026-09-07T12:00:00Z' },
    { label: '创建时间', value: '2026-09-07T10:00:00Z' },
    { label: 'revalidation', value: 'not_requested' },
    { label: 'Evidence status', value: 'complete' },
    { label: '历史定义 unavailable', value: 'Historical definition is unavailable.' },
    { label: 'Unknown field', value: 'unchanged saved fact' },
    { label: 'Quality', value: '{"sampleSize":9007199254740993,"unknownCheck":null}' },
    {
      label: '公开语义引用',
      value:
        '[{"kind":"metric","path":"sales.revenue","role":"metric","outputColumn":"revenue_internal"},{"kind":"dimension","path":"sales.region","role":"slice"},{"kind":"dimension","path":"sales.region","role":"dimension_axis"}]',
    },
    { label: 'Issues', value: '[{"kind":"null_rate_high","severity":"warning"}]' },
  ],
}

function fixture(): PresentationDocument {
  return {
    schemaVersion: 3,
    locale: 'zh-CN',
    workspaceId: 'workspace_saved',
    reportId: 'report',
    buildId: 'build_saved',
    title: '报告原文',
    generatedAt: '2026-09-07T11:00:00Z',
    datasets: [
      {
        id: 'regional-sales',
        origin: 'computed',
        sourceIds: ['sales'],
        data: {
          schemaVersion: 1,
          columns: [
            { id: 'region', label: '地区', type: 'string', nullable: false },
            { id: 'revenue', label: '收入', type: 'decimal', unit: 'CNY', nullable: true },
            { id: 'count', label: '数量', type: 'int64', nullable: false },
          ],
          rows: [
            ['A', '12345678901234.5678', '9007199254740993'],
            ['B', '0.1000', '1'],
          ],
          rowCount: 5,
          limit: 2,
          truncated: true,
        },
      },
    ],
    sources: [structuredClone(source)],
    blocks: [
      {
        id: 'revenue',
        kind: 'metric',
        label: '收入指标原文',
        columnId: 'revenue',
        rowIndex: 0,
        datasetId: 'regional-sales',
      },
    ],
    diagnostics: [],
  }
}

test('only host navigation turns saved semantic references into buttons; offline and invalid references stay text', () => {
  const document = fixture()
  const html = renderDialog(document, document.blocks[0]!, undefined, true)
  assert.match(html, /class="pr-semantic-link"[^>]*>sales.revenue<\/button>/)
  assert.match(html, /class="pr-semantic-link"[^>]*>sales.region<\/button>/)
  assert.doesNotMatch(renderDialog(document, document.blocks[0]!), /pr-semantic-link/)
  assert.doesNotMatch(renderOverview(document), /pr-semantic-link/)
  const savedSource = document.sources[0]!
  if (savedSource.status !== 'available') throw new Error('Expected available source')
  savedSource.facts = [
    {
      label: '公开语义引用',
      value: JSON.stringify([
        { path: 'sales.untyped' },
        { kind: 'metric', path: 'x'.repeat(2049) },
      ]),
    },
  ]
  const invalid = renderDialog(document, document.blocks[0]!, undefined, true)
  assert.match(invalid, /sales.untyped/)
  assert.doesNotMatch(invalid, /pr-semantic-link/)
})

test('every semantic object kind, including entity and new Catalog kinds, remains navigable', () => {
  const document = fixture()
  const kinds = [...Object.keys(kindLabels), 'future_kind']
  const savedSource = document.sources[0]!
  if (savedSource.status !== 'available') throw new Error('Expected available source')
  savedSource.facts = [
    {
      label: '公开语义引用',
      value: JSON.stringify(kinds.map((kind) => ({ kind, path: `sales.${kind}_object` }))),
    },
  ]
  const html = renderDialog(document, document.blocks[0]!, undefined, true)
  for (const kind of kinds) {
    assert(html.includes(`>sales.${kind}_object</button>`), `${kind} must be clickable`)
    assert.equal(semanticKindLabel(kind), kindLabels[kind] ?? kind)
  }
  assert.match(translator('zh-CN')(html), /pr-source-overview-label">实体<\/h4>/)
  assert.equal((html.match(/class="pr-semantic-link"/g) ?? []).length, kinds.length)
  assert.doesNotMatch(renderOverview(document), /pr-semantic-link/)
})

test('source overview exposes saved dataset fields, semantic paths and issues without technical facts or inferred filters', () => {
  const document = fixture()
  const saved = structuredClone(document)
  const html = renderDialog(document, document.blocks[0]!)
  assert.match(html, /<dialog[^>]+aria-labelledby=/)
  assert.match(translator('zh-CN')(html), /关闭数据源/)
  assert.match(translator('zh-CN')(html), /收入指标原文/)
  assert.match(html, /regional-sales/)
  assert.match(translator('zh-CN')(html), /收入 \(CNY\)/)
  assert.match(translator('zh-CN')(html), /来源创建时间/)
  assert.match(html, /2026-09-07T10:00:00Z/)
  assert.match(translator('zh-CN')(html), /报告生成时间/)
  assert.match(translator('zh-CN')(html), /<div><dt>数据集<\/dt><dd>regional-sales<\/dd><\/div>/)
  assert.match(translator('zh-CN')(html), /<div><dt>来源创建时间<\/dt><dd><time/)
  assert.doesNotMatch(html, /<dl class="pr-source-overview-grid"><dt/)
  assert.match(html, /sales.revenue/)
  assert.equal(html.split('sales.region').length - 1, 1)
  assert.match(html, /null_rate_high · warning/)
  assert.doesNotMatch(
    translator('zh-CN')(html),
    /hash_saved|读取时间|not_requested|Evidence status|complete|Historical definition|Unknown field|sampleSize|unknownCheck|outputColumn|revenue_internal|dimension_axis|声明关联|原始值|技术详情|未声明来源|Filters|过滤条件|SQL/,
  )
  assert.deepEqual(document, saved)
})

test('data preview is a modal tab with precise saved values and necessary truncation status', () => {
  const document = fixture()
  const html = renderDialog(document, document.blocks[0]!)
  assert.equal(html.split('role="tab"').length - 1, 3)
  assert.match(translator('zh-CN')(html), /role="tab"[^>]+aria-selected="true"[^>]*>概要<\/button>/)
  assert.match(
    translator('zh-CN')(html),
    /role="tab"[^>]+aria-selected="false"[^>]*>数据预览<\/button>/,
  )
  assert.match(
    translator('zh-CN')(html),
    /role="tab"[^>]+aria-selected="false"[^>]*>相关查询<\/button>/,
  )
  assert.match(html, /role="tabpanel"[^>]+hidden=""/)
  assert.match(html, /12345678901234\.5678/)
  assert.match(html, /9007199254740993/)
  assert.match(html, /0\.1000/)
  assert.match(translator('zh-CN')(html), /显示 2 \/ 5 行（已截断）/)
  assert.doesNotMatch(
    translator('zh-CN')(html),
    /9007199254740992|复制选中行|复制完整数据行|选择图表数据行/,
  )
})

test('chart previews use the selected cell columns and source-only dialogs retain overview and code tabs', () => {
  const document = fixture()
  const chart: PresentationBlock = {
    id: 'chart',
    kind: 'chart',
    datasetId: 'regional-sales',
    chart: 'bar',
    x: 'region',
    y: ['revenue'],
    numericMode: 'approximate',
  }
  const html = renderDialog(document, chart)
  assert.match(html, /data-column-id="region"/)
  assert.match(html, /data-column-id="revenue"/)
  assert.doesNotMatch(html, /data-column-id="count"|9007199254740993/)
  const onlySources = renderDialog(document, {
    id: 'sources',
    kind: 'source',
    sourceIds: ['sales'],
  })
  assert.equal(onlySources.split('role="tab"').length - 1, 2)
  assert.match(translator('zh-CN')(onlySources), /role="tab"[^>]*>相关查询<\/button>/)
  assert.doesNotMatch(translator('zh-CN')(onlySources), /数据预览|SQL|暂无数据|未声明来源/)
})

const pythonText = 'secret_value = "retain-this-value"\nprint("<script>literal()</script>")\n'
const sqlText =
  "SELECT '<script>literal()</script>', 'retain-this-value'\nFROM sales WHERE region = '华东'\n"

function fixtureWithCode(): PresentationDocument {
  const document = fixture()
  document.datasets[0]!.code = [
    {
      language: 'python',
      text: pythonText,
      provenance: 'execution',
      executionId: '12345678-1234-4567-89ab-123456789abc',
      sha256: 'a'.repeat(64),
    },
  ]
  document.sources[0] = {
    ...source,
    code: {
      snippets: [
        {
          language: 'sql',
          text: sqlText,
          provenance: 'execution',
          runId: 'run_saved',
          queryId: 'query_saved',
          artifactRef: 'art_saved',
        },
      ],
      notices: [],
    },
  }
  return document
}

test('code tab formats and highlights display while preserving execution snapshots and escaping text', () => {
  const document = fixtureWithCode()
  const saved = structuredClone(document)
  const html = renderDialog(document, document.blocks[0]!)
  assert.match(html, /Python/)
  assert.match(html, /SQL/)
  assert.doesNotMatch(translator('zh-CN')(html), /该执行记录由作者关联到此数据集。/)
  assert.match(translator('zh-CN')(html), /复制代码/)
  assert.match(html, /<pre tabindex="0"><code class="language-python">/)
  assert.match(html, /<code class="language-sql">/)
  assert.match(html, /color:var\(--pr-code-keyword\)/)
  assert.doesNotMatch(translator('zh-CN')(html), /已格式化展示/)
  assert.match(html, /retain-this-value/)
  assert.match(html, /&lt;script&gt;literal\(\)&lt;\/script&gt;/)
  assert.doesNotMatch(translator('zh-CN')(html), /<script|作者提供|暂无相关查询/)
  assert.equal(sourceCodeFacts(document, document.blocks[0]!).entries[0]?.text, pythonText)
  assert.equal(sourceCodeFacts(document, document.blocks[0]!).entries[1]?.text, sqlText)
  assert.deepEqual(document, saved)
})

test('Python and SQL formatting expands compact code, preserves literals and never executes it', () => {
  const python = 'def total( values ):\n  return sum( values )\nraise Exception("never execute")\n'
  const formatted = formatSource(python, 'python')
  assert.equal(formatted.formatted, true)
  assert.match(formatted.text, /def total\(values\):\n {4}return sum\(values\)/)
  assert.match(formatted.text, /raise Exception\("never execute"\)/)
  const sql =
    "select region,sum(amount) as total from sales where note='a  b' group by region order by total desc"
  const query = formatSource(sql, 'sql')
  assert.equal(query.formatted, true)
  assert.match(query.text, /select\n {2}region,\n {2}sum\(amount\) as total\nfrom\n {2}sales/)
  assert.match(query.text, /'a {2}b'/)
  assert.match(query.text, /group by\n {2}region/)
})

test('invalid Python and unsupported SQL retain their original text without a formatting notice', () => {
  const python = 'def invalid(:\r\n  print("retain me")\r\n'
  const sql = 'select $$unsupported dollar string$$'
  assert.deepEqual(formatSource(python, 'python'), { text: python, formatted: false })
  assert.deepEqual(formatSource(sql, 'sql'), { text: sql, formatted: false })
  const document = fixtureWithCode()
  document.datasets[0]!.code![0]!.text = python
  assert.doesNotMatch(
    translator('zh-CN')(renderDialog(document, document.blocks[0]!)),
    /无法格式化，显示执行原文/,
  )
})

test('cell code follows only its selected binding and source-only code follows its source IDs', () => {
  const document = fixtureWithCode()
  document.datasets.push({
    ...structuredClone(document.datasets[0]!),
    id: 'other-data',
    sourceIds: ['other-source'],
    code: [
      {
        language: 'python',
        text: 'unselected_python()',
        provenance: 'execution',
        executionId: 'python_other',
        sha256: 'b'.repeat(64),
      },
    ],
  })
  document.sources.push({
    ...source,
    id: 'other-source',
    code: {
      snippets: [
        {
          language: 'sql',
          text: 'SELECT unselected_sql',
          provenance: 'execution',
          runId: 'run_other',
          queryId: 'query_other',
          artifactRef: 'art_other',
        },
      ],
      notices: [],
    },
  })
  const chart: PresentationBlock = {
    id: 'chart-code',
    kind: 'chart',
    datasetId: 'regional-sales',
    chart: 'bar',
    x: 'region',
    y: ['revenue'],
    numericMode: 'approximate',
    preparedViews: [
      {
        id: 'unselected',
        label: '未选视图',
        datasetId: 'other-data',
        chart: 'bar',
        x: 'region',
        y: ['revenue'],
        numericMode: 'approximate',
      },
    ],
  }
  const html = renderDialog(document, chart)
  assert.match(html, /retain-this-value/)
  assert.doesNotMatch(html, /unselected_python|unselected_sql/)
  const sourceOnly = renderDialog(document, {
    id: 'source-code',
    kind: 'source',
    sourceIds: ['other-source'],
  })
  assert.match(sourceOnly, /unselected_sql/)
  assert.doesNotMatch(sourceOnly, /Python|retain-this-value|unselected_python/)
})

test('execution SQL deduplicates by session, run and query, never by text alone', () => {
  const document = fixtureWithCode()
  const savedSource = document.sources[0]!
  assert.equal(savedSource.status, 'available')
  if (savedSource.status !== 'available') throw new Error('Expected available fixture')
  document.datasets[0]!.sourceIds.push('same-query', 'other-run', 'other-session')
  document.sources.push(
    { ...structuredClone(savedSource), id: 'same-query' },
    {
      ...structuredClone(savedSource),
      id: 'other-run',
      code: {
        snippets: [{ ...savedSource.code!.snippets[0]!, runId: 'run_other' }],
        notices: [],
      },
    },
    {
      ...structuredClone(savedSource),
      id: 'other-session',
      ref: { ...savedSource.ref, sessionId: 'session_other' },
    },
  )
  const { entries } = sourceCodeFacts(document, document.blocks[0]!)
  assert.equal(entries.filter((entry) => entry.language === 'sql').length, 3)
  assert.equal(entries.filter((entry) => entry.text === sqlText).length, 3)
})

test('saved source queries remain readable in the production source dialog', () => {
  const document = fixtureWithCode()
  const html = renderDialog(document, document.blocks[0]!)
  assert.match(html, /language-python/)
  assert.match(html, /secret_value/)
  assert.match(html, /SQL/)
  assert.match(html, /retain-this-value/)
  document.sources = []
  document.datasets[0]!.sourceIds = []
  assert.match(renderDialog(document, document.blocks[0]!), /Python/)
})

test('missing code and partial unavailable sources report saved facts explicitly', () => {
  const document = fixture()
  assert.match(translator('zh-CN')(renderDialog(document, document.blocks[0]!)), /暂无相关查询/)
  document.sources[0] = {
    ...source,
    code: { snippets: [], notices: ['执行记录未保存 SQL 文本'] },
  }
  document.sources.push({
    id: 'missing',
    ref: { sessionId: 'missing', artifactRef: 'missing' },
    status: 'unavailable',
    reason: 'Artifact 已不可用',
  })
  document.datasets[0]!.sourceIds.push('missing')
  const html = renderDialog(document, document.blocks[0]!)
  assert.match(translator('zh-CN')(html), /来源 sales：执行记录未保存 SQL 文本/)
  assert.match(translator('zh-CN')(html), /来源 missing 不可用：Artifact 已不可用/)
  assert.match(translator('zh-CN')(html), /暂无相关查询/)
})

test('source tabs support forward, backward, Home and End navigation for both tab sets', () => {
  assert.deepEqual(sourceTabs(true), ['overview', 'preview', 'code'])
  assert.deepEqual(sourceTabs(false), ['overview', 'code'])
  for (const tabs of [sourceTabs(true), sourceTabs(false)]) {
    assert.equal(sourceTabForKey(tabs, 'overview', 'Home'), 'overview')
    assert.equal(sourceTabForKey(tabs, 'overview', 'End'), 'code')
    assert.equal(sourceTabForKey(tabs, 'overview', 'ArrowLeft'), 'code')
    assert.equal(sourceTabForKey(tabs, 'code', 'ArrowRight'), 'overview')
    assert.equal(sourceTabForKey(tabs, 'overview', 'ArrowRight'), tabs[1])
    assert.equal(sourceTabForKey(tabs, 'code', 'Escape'), undefined)
  }
})

test('production static reader keeps unavailable reasons and valuable source fields without buttons or technical disclosures', () => {
  const document = fixture()
  document.sources.push({
    id: 'missing',
    status: 'unavailable',
    reason: 'Original unavailable reason',
    ref: { sessionId: 'session_missing', artifactRef: 'art_missing' },
  })
  document.blocks = [
    { id: 'sources', kind: 'source', sourceIds: document.sources.map((source) => source.id) },
  ]
  const html = renderStatic(document)
  assert.equal(html.split('data-source-id="sales"').length - 1, 1)
  assert.equal(html.split('data-source-id="missing"').length - 1, 1)
  assert.match(html, /Original unavailable reason/)
  assert.match(html, /sales.revenue/)
  assert.doesNotMatch(translator('zh-CN')(html), /<button|<dialog|技术详情|原始值/)
})

test('malformed optional fact structures are not interpreted and displayed strings are escaped', () => {
  assert.equal(semanticKindLabel('constructor'), 'constructor')
  assert.equal(semanticKindLabel('toString'), 'toString')
  const document = fixture()
  document.sources[0] = {
    ...source,
    facts: [
      { label: 'Issues', value: '[]' },
      { label: '公开语义引用', value: '{not JSON}' },
      { label: 'Quality', value: '{"failedCheckCount":0}' },
    ],
  }
  assert.deepEqual(sourceOverviewFacts(document.sources[0]!), {
    createdAt: undefined,
    semanticGroups: [],
    issues: [],
    notices: [],
  })
  assert.doesNotMatch(
    translator('zh-CN')(renderOverview(document)),
    /数据问题|没有|成功|failedCheckCount|not JSON/,
  )
  document.sources[0] = {
    ...source,
    facts: [
      { label: '公开语义引用', value: '[{"kind":"metric","path":"<script>evil()</script>"}]' },
      { label: 'Issues', value: '[{"kind":"<img src=x>","severity":"warning"}]' },
    ],
  }
  const html = renderOverview(document)
  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img src=x&gt;/)
})

test('current chart source includes auxiliary bindings and filters exact preview by original row identity', () => {
  const document = fixture()
  const block: PresentationBlock = {
    id: 'histogram',
    kind: 'chart',
    datasetId: 'regional-sales',
    chart: 'histogram',
    x: 'region',
    y: ['count'],
    bindings: { binStart: 'revenue', binEnd: 'count' },
    numericMode: 'approximate',
  }
  const html = renderDialog(document, block, [1])
  assert.doesNotMatch(translator('zh-CN')(html), /当前探索视图|pr-source-dialog-context|<caption>/)
  assert.match(html, /data-column-id="revenue"/)
  assert.match(html, /data-row-index="1"/)
  assert.doesNotMatch(html, /data-row-index="0"|12345678901234\.5678/)
  assert.match(html, /0\.1000/)
  assert.match(translator('zh-CN')(html), /当前筛选：已保存 2 行中命中 1 行/)
  const overview = renderOverview(document, block)
  assert.match(translator('zh-CN')(overview), /<td>收入<\/td><td>decimal<\/td><td>CNY<\/td>/)
  assert.match(translator('zh-CN')(overview), /数量/)
})

test('field details retain IDs, labels, types and units and avoid repeated label units', () => {
  const document = fixture()
  const column = document.datasets[0]!.data.columns[1]!
  column.label = '收入（CNY）'
  assert.equal(columnLabel(column), '收入（CNY）')
  assert.equal(columnLabel({ ...column, label: '收入 (CNY)' }), '收入 (CNY)')
  assert.equal(columnLabel({ ...column, label: '收入' }), '收入 (CNY)')
  const html = renderDialog(document, document.blocks[0]!)
  assert.match(
    translator('zh-CN')(html),
    /<code>revenue<\/code><\/td><td>收入（CNY）<\/td><td>decimal<\/td><td>CNY<\/td>/,
  )
  assert.doesNotMatch(
    html,
    /art_saved|session_saved|pr-artifact-details|<details|Session ID|Finding ID/,
  )
  assert.match(translator('zh-CN')(html), /<h3>来源 1<\/h3>/)
  assert.doesNotMatch(
    translator('zh-CN')(html),
    /收入（CNY） \(CNY\)|<caption>|pr-source-dialog-context/,
  )
})
