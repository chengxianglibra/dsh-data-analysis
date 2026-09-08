/** Fresh persisted Marivo inputs for the production S4 Tool, isolated from user files. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import { CHART_TYPES } from '../../src/presentation/contracts/charts.ts'
import {
  type PresentationDraft,
  parsePresentationDraft,
  type SourceRef,
} from '../../src/presentation/contracts/index.ts'
import { chartGallery } from '../presentation-chart-gallery.ts'

export async function preparePresentationInputs(workspaceRoot: string, pythonExecutable: string) {
  await mkdir(path.join(workspaceRoot, 'models/datasources'), { recursive: true })
  await mkdir(path.join(workspaceRoot, 'models/semantic/sales'), { recursive: true })
  const files = {
    'marivo.toml': '[project]\nname = "presentation-s4-runtime"\n',
    'models/datasources/warehouse.py':
      "import marivo.datasource as md\nmd.duckdb(name='warehouse', path=':memory:')\n",
    'models/semantic/sales/__init__.py': '',
    'models/semantic/sales/_domain.py':
      "import marivo.semantic as ms\nms.domain(name='sales', owner='S4 validation')\n",
    'models/semantic/sales/datasets.py': [
      'import marivo.datasource as md',
      'import marivo.semantic as ms',
      "orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))",
      "region = ms.dimension_column(name='region', entity=orders, column='region')",
      "@ms.metric(entities=[orders], additivity='additive', name='revenue', unit='USD')",
      'def revenue(orders): return orders.amount.sum()',
      "@ms.metric(entities=[orders], additivity='non_additive', name='account_id')",
      'def account_id(orders): return orders.account_id.max()',
      "precise_orders = ms.entity(name='precise_orders', datasource=ms.ref.datasource('warehouse'), source=md.table('precise_orders'))",
      "precise_region = ms.dimension_column(name='region', entity=precise_orders, column='region')",
      "@ms.metric(entities=[precise_orders], additivity='additive', name='precision_revenue', unit='USD')",
      'def precision_revenue(precise_orders): return precise_orders.amount.sum()',
      "@ms.metric(entities=[precise_orders], additivity='non_additive', name='precision_account_id')",
      'def precision_account_id(precise_orders): return precise_orders.account_id.max()',
      '',
    ].join('\n'),
  }
  for (const [relative, content] of Object.entries(files))
    await writeFile(path.join(workspaceRoot, relative), content)
  const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
  const result = await environment.runChecked({
    program: await readFile(
      new URL('../presentation-s0/runtime-generate.py', import.meta.url),
      'utf8',
    ),
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  const generated = JSON.parse(result.stdout.toString('utf8'))
  const ref = (value: SourceRef): SourceRef => ({
    sessionId: value.sessionId,
    artifactRef: value.artifactRef,
    ...(value.findingId ? { findingId: value.findingId } : {}),
  })
  const sources = [
    { id: 'revenue', ref: ref(generated.primary) },
    { id: 'account', ref: ref(generated.secondary) },
    {
      id: 'missing',
      ref: { sessionId: generated.primary.sessionId, artifactRef: 'art_000000000000000000000000' },
    },
  ]
  const writer = await environment.runChecked({
    program: String.raw`
from decimal import Decimal
import dataclasses
import json
import pandas as pd
from dsh_data_analysis_presentation import write_dataset
frame = pd.DataFrame({"region": ["A", "B", "C"], "decimal": [Decimal("12345678901234.5678"), Decimal("0.1000"), None], "account": pd.Series([9007199254740993, 9223372036854775807, -9223372036854775808], dtype="int64")})
receipt = write_dataset(frame, "computed.json", row_limit=2)
print(json.dumps(dataclasses.asdict(receipt)))
`,
  })
  assert.equal(writer.exitCode, 0, writer.stderr.toString('utf8'))
  const chartWriter = await environment.runChecked({
    program: await readFile(
      new URL(
        '../../skills/dsh-data-analysis-presentation/references/examples/write-charts.py',
        import.meta.url,
      ),
      'utf8',
    ),
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(chartWriter.exitCode, 0, chartWriter.stderr.toString('utf8'))
  const chartWriterReceipts = JSON.parse(chartWriter.stdout.toString('utf8'))
  const chartDraft = parsePresentationDraft(
    JSON.parse(
      await readFile(
        new URL(
          '../../skills/dsh-data-analysis-presentation/references/examples/charts.draft.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  )
  assert.ok(Array.isArray(chartWriterReceipts))
  assert.equal(chartWriterReceipts.length, chartDraft.datasets.length)
  const chartTypes = [
    ...new Set(chartDraft.blocks.flatMap((block) => (block.kind === 'chart' ? [block.chart] : []))),
  ].sort()
  assert.deepEqual(
    chartTypes,
    [...CHART_TYPES].sort(),
    'S4 synthetic gallery must cover every supported chart type',
  )
  chartDraft.interaction = (await chartGallery()).interaction
  const drafts: PresentationDraft[] = [
    {
      schemaVersion: 1,
      title: 'S4 真实 Artifact',
      sources: sources.slice(0, 2),
      datasets: [
        {
          id: 'revenue',
          kind: 'artifact',
          sourceId: 'revenue',
          rowLimit: 4,
          columns: ['region', 'revenue'],
        },
        {
          id: 'account',
          kind: 'artifact',
          sourceId: 'account',
          rowLimit: 4,
          columns: ['region', 'account_id'],
        },
      ],
      blocks: [
        { id: 'revenue', kind: 'table', datasetId: 'revenue' },
        { id: 'account', kind: 'table', datasetId: 'account' },
        { id: 'sources', kind: 'source', sourceIds: ['revenue', 'account'] },
      ],
    },
    {
      schemaVersion: 1,
      title: 'S4 精确 computed',
      sources,
      datasets: [
        {
          id: 'computed',
          kind: 'computed',
          path: 'computed.json',
          sourceIds: sources.map((item) => item.id),
        },
      ],
      blocks: [
        { id: 'intro', kind: 'markdown', text: '## 编辑验收\n\n精确快照与同 dataset 联动。' },
        {
          id: 'metric',
          kind: 'metric',
          datasetId: 'computed',
          columnId: 'account',
          rowIndex: 0,
          label: '首行账户',
        },
        {
          id: 'bar',
          kind: 'chart',
          datasetId: 'computed',
          chart: 'bar',
          x: 'region',
          y: ['decimal'],
          numericMode: 'approximate',
        },
        {
          id: 'line',
          kind: 'chart',
          datasetId: 'computed',
          chart: 'line',
          x: 'region',
          y: ['decimal'],
          numericMode: 'approximate',
        },
        { id: 'table', kind: 'table', datasetId: 'computed' },
        { id: 'sources', kind: 'source', sourceIds: sources.map((item) => item.id) },
      ],
    },
    {
      schemaVersion: 1,
      title: 'S4 source-only',
      sources,
      datasets: [],
      blocks: [
        { id: 'summary', kind: 'markdown', text: '## 已保存的来源\n\n只展示已声明来源。' },
        { id: 'sources', kind: 'source', sourceIds: sources.map((item) => item.id) },
      ],
    },
    chartDraft,
  ]
  const draftPaths = [
    'artifact.draft.json',
    'computed.draft.json',
    'source-only.draft.json',
    'charts.draft.json',
  ]
  for (const [index, draft] of drafts.entries())
    await writeFile(path.join(workspaceRoot, draftPaths[index]!), JSON.stringify(draft, null, 2))
  return {
    binding: environment.binding,
    generated: {
      ...generated,
      chartGallery: {
        chartTypes,
        writerReceipts: chartWriterReceipts,
        provenance: 'Skill synthetic example executed in the bound Workspace Runtime',
      },
    },
    writerReceipt: JSON.parse(writer.stdout.toString('utf8')),
    draftPaths,
    drafts,
  }
}
