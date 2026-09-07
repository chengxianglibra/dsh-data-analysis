import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import {
  semanticKindLabel,
  sourceOverviewFacts,
} from '../../src/client/presentation/source-facts.ts'
import type {
  PresentationBlock,
  PresentationDocument,
  SourceSnapshot,
} from '../../src/presentation/contracts/types.ts'

let directory: string
let renderSummary: (document: PresentationDocument, block?: PresentationBlock) => string
let renderDialog: (document: PresentationDocument, block: PresentationBlock) => string

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-source-render-'))
  const outfile = path.join(directory, 'sources.mjs')
  await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceSummary } from './src/client/presentation/sources.tsx';
import { SourceDialog } from './src/client/presentation/source-dialog.tsx';
export function renderSummary(document, block) { return renderToStaticMarkup(createElement(SourceSummary, { document, block })); }
export function renderDialog(document, block) { return renderToStaticMarkup(createElement(SourceDialog, { document, block, onClose() {} })); }`,
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
  ;({ renderSummary, renderDialog } = await import(pathToFileURL(outfile).href))
})

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

const source: SourceSnapshot = {
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
    schemaVersion: 1,
    workspaceId: 'workspace_saved',
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

test('source overview exposes saved dataset fields, semantic paths and issues without technical facts or inferred filters', () => {
  const document = fixture()
  const saved = structuredClone(document)
  const html = renderDialog(document, document.blocks[0]!)
  assert.match(html, /<dialog[^>]+aria-labelledby=/)
  assert.match(html, /关闭数据源/)
  assert.match(html, /收入指标原文/)
  assert.match(html, /regional-sales/)
  assert.match(html, /收入 \(CNY\)/)
  assert.match(html, /来源创建时间/)
  assert.match(html, /2026-09-07T10:00:00Z/)
  assert.match(html, /报告生成时间/)
  assert.match(html, /<div><dt>数据集<\/dt><dd>regional-sales<\/dd><\/div>/)
  assert.match(html, /<div><dt>来源创建时间<\/dt><dd><time/)
  assert.doesNotMatch(html, /<dl class="pr-source-overview-grid"><dt/)
  assert.match(html, /sales.revenue/)
  assert.equal(html.split('sales.region').length - 1, 1)
  assert.match(html, /null_rate_high · warning/)
  assert.doesNotMatch(
    html,
    /session_saved|art_saved|hash_saved|读取时间|not_requested|Evidence status|complete|Historical definition|Unknown field|sampleSize|unknownCheck|outputColumn|revenue_internal|dimension_axis|声明关联|原始值|技术详情|未声明来源|Filters|过滤条件|SQL/,
  )
  assert.deepEqual(document, saved)
})

test('data preview is a modal tab with precise saved values and necessary truncation status', () => {
  const document = fixture()
  const html = renderDialog(document, document.blocks[0]!)
  assert.equal(html.split('role="tab"').length - 1, 2)
  assert.match(html, /role="tab"[^>]+aria-selected="true"[^>]*>概要<\/button>/)
  assert.match(html, /role="tab"[^>]+aria-selected="false"[^>]*>数据预览<\/button>/)
  assert.match(html, /role="tabpanel"[^>]+hidden=""/)
  assert.match(html, /12345678901234\.5678/)
  assert.match(html, /9007199254740993/)
  assert.match(html, /0\.1000/)
  assert.match(html, /显示 2 \/ 5 行（已截断）/)
  assert.doesNotMatch(html, /9007199254740992|复制选中行|复制完整数据行|选择图表数据行/)
})

test('chart previews use the selected cell columns and source-only dialogs omit data and SQL tabs', () => {
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
  assert.doesNotMatch(onlySources, /role="tab"|数据预览|SQL|暂无数据|未声明来源/)
})

test('native static summary keeps unavailable reasons and valuable source fields without buttons or technical disclosures', () => {
  const document = fixture()
  document.sources.push({
    id: 'missing',
    status: 'unavailable',
    reason: 'Original unavailable reason',
    ref: { sessionId: 'session_missing', artifactRef: 'art_missing' },
  })
  const html = renderSummary(document)
  assert.match(html, /^<details class="pr-source-summary"><summary>数据来源<\/summary>/)
  assert.equal(html.split('data-source-id="sales"').length - 1, 1)
  assert.equal(html.split('data-source-id="missing"').length - 1, 1)
  assert.match(html, /Original unavailable reason/)
  assert.match(html, /sales.revenue/)
  assert.doesNotMatch(html, /<button|<dialog|技术详情|原始值|session_missing|art_missing/)
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
  assert.doesNotMatch(renderSummary(document), /数据问题|暂无|没有|成功|failedCheckCount|not JSON/)
  document.sources[0] = {
    ...source,
    facts: [
      { label: '公开语义引用', value: '[{"kind":"metric","path":"<script>evil()</script>"}]' },
      { label: 'Issues', value: '[{"kind":"<img src=x>","severity":"warning"}]' },
    ],
  }
  const html = renderSummary(document)
  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img src=x&gt;/)
})
