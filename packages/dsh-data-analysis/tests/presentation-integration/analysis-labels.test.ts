import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAnalysisLabels, createAnalysisDocument } from '../../src/presentation/analysis.ts'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  type AnalysisDocument,
  type AnalysisPresentInput,
  type AnalysisResource,
  analysisPresentInput,
  analysisRecordId,
} from '../../src/presentation/contracts/analysis-document.ts'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import type { DatasetColumn } from '../../src/presentation/contracts/types.ts'
import { frameSnapshotV2 } from './frame-v2-fixture.ts'

const workspaceId = 'workspace'
const capture = {
  executionId: '00000000-0000-4000-8000-000000000000',
  sha256: 'a'.repeat(64),
}
const signal = new AbortController().signal

function snapshot(doc: AnalysisDocument, name = 'result') {
  const resource = doc.resources[name]
  if (resource?.kind !== 'snapshot') throw new Error('expected a snapshot resource')
  return resource.snapshot
}

function labels(doc: AnalysisDocument) {
  return snapshot(doc).data.columns.map((column) => column.label)
}

/** All resources are inherited, so resolving the Runtime projection must never happen. */
const source = {
  projectRoot: '/workspace',
  projection: () => {
    throw new Error('projection must not be resolved')
  },
}

function identity(buildId: string, base?: AnalysisDocument) {
  return { workspaceId, reportId: base?.reportId ?? 'report', buildId }
}

async function update(
  input: AnalysisPresentInput,
  base: AnalysisDocument,
  buildId = 'build-2',
): Promise<AnalysisDocument> {
  return createAnalysisDocument(input, source, identity(buildId, base), signal, base)
}

function baseDocument(): AnalysisDocument {
  const parsed = parseAnalysisSnapshot(frameSnapshotV2())
  if (parsed.kind !== 'frame') throw new Error('expected a Frame snapshot')
  // Inherited labels that differ from the ids make replacement and reset observable.
  parsed.data.columns[0]!.label = 'Region name'
  parsed.data.columns[1]!.label = 'Amount'
  return {
    schemaVersion: ANALYSIS_UI_FORMAT,
    workspaceId,
    reportId: 'report',
    buildId: 'build-1',
    recordId: analysisRecordId('report', 'build-1'),
    title: 'Base',
    locale: 'zh-CN',
    generatedAt: '2026-10-28T00:00:00.000Z',
    catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
    program: 'root = AnalysisFrameView("result", {chart:"table",columns:["region","amount"]});',
    resources: {
      result: {
        kind: 'snapshot',
        declaration: { kind: 'frame-snapshot', snapshotRef: 'frame-ref' },
        snapshot: parsed,
        binding: { workspaceId, codeRef: capture, sessionId: 'session', callId: 'call' },
      },
    },
  }
}

/** A minimal valid dataset resource used for label-budget boundaries. */
function datasetResource(columnCount: number, prefix: string): AnalysisResource {
  const columns: DatasetColumn[] = Array.from({ length: columnCount }, (_, index) => ({
    id: `${prefix}${index}`,
    label: `${prefix}${index}`,
    type: 'decimal',
    nullable: true,
  }))
  const ids = columns.map((column) => column.id)
  return {
    kind: 'snapshot',
    declaration: { kind: 'dataset-snapshot', snapshotRef: `ref-${prefix}` },
    snapshot: {
      schemaVersion: 1,
      kind: 'dataset',
      fetchedAt: '2026-10-28T00:00:00Z',
      source: { kind: 'dataframe', details: 'not-captured' },
      data: {
        schemaVersion: 1,
        columns,
        rows: [],
        rowCount: 0,
        limit: 5000,
        truncated: false,
      },
      coverage: {
        start: 0,
        totalRows: 0,
        capturedRows: 0,
        complete: true,
        columns: ids,
        business: 'unknown',
      },
    },
    binding: { workspaceId, codeRef: capture, sessionId: 'session', callId: 'call' },
  }
}

function labelMap(prefix: string, columnCount: number, value: string) {
  return Object.fromEntries(
    Array.from({ length: columnCount }, (_, index) => [`${prefix}${index}`, value]),
  )
}

function isBudgetError(error: Error) {
  assert.match(error.message, /^analysis-label-budget at \/labels: /)
  return true
}

test('present labels merge into the embedded snapshot without changing ids or the base', async () => {
  const base = baseDocument()
  const input = analysisPresentInput.parse({
    labels: { result: { amount: '乘客支付金额' } },
  })
  const doc = await update(input, base)
  assert.deepEqual(
    snapshot(doc).data.columns.map((column) => [column.id, column.label]),
    [
      ['region', 'region'],
      ['amount', '乘客支付金额'],
    ],
  )
  assert.deepEqual(labels(base), ['Region name', 'Amount'])
  assert.notEqual(snapshot(doc), snapshot(base))
})

test('omitted labels on update inherit the base snapshot labels', async () => {
  const base = baseDocument()
  const doc = await update(analysisPresentInput.parse({}), base)
  assert.deepEqual(labels(doc), ['Region name', 'Amount'])
})

test('an empty label map resets that resource labels to its column ids', async () => {
  const base = baseDocument()
  const doc = await update(analysisPresentInput.parse({ labels: { result: {} } }), base)
  assert.deepEqual(labels(doc), ['region', 'amount'])
  assert.deepEqual(labels(base), ['Region name', 'Amount'])
})

test('unknown resources and columns reject with the exact label path', () => {
  const base = baseDocument()
  assert.throws(
    () => applyAnalysisLabels(structuredClone(base.resources), { missing: { amount: 'x' } }),
    (error: Error) => {
      assert.match(error.message, /^analysis-label-unknown at \/labels\/missing: /)
      return true
    },
  )
  assert.throws(
    () => applyAnalysisLabels(structuredClone(base.resources), { result: { missing: 'x' } }),
    (error: Error) => {
      assert.match(error.message, /^analysis-label-unknown at \/labels\/result\/missing: /)
      return true
    },
  )
})

test('label budgets bound each resource and the total UTF-8 bytes', () => {
  assert.throws(
    () =>
      applyAnalysisLabels(
        { large: datasetResource(65, 'large') },
        { large: labelMap('large', 65, 'x') },
      ),
    isBudgetError,
  )
  const twoResources = { a: datasetResource(64, 'a'), b: datasetResource(64, 'b') }
  assert.throws(
    () =>
      applyAnalysisLabels(twoResources, {
        a: labelMap('a', 64, 'x'.repeat(256)),
        b: labelMap('b', 64, 'x'.repeat(256)),
      }),
    isBudgetError,
  )
  // Exactly 64 labels and exactly 16 KiB remain admissible.
  const atBudget = { result: datasetResource(64, 'c') }
  applyAnalysisLabels(atBudget, { result: labelMap('c', 64, 'x'.repeat(256)) })
  const resource = atBudget.result
  assert(resource?.kind === 'snapshot')
  assert.equal(resource.snapshot.data.columns[0]?.label, 'x'.repeat(256))
})

test('analysisPresentInput accepts the documented label shape and rejects blank values', () => {
  assert.deepEqual(
    analysisPresentInput.parse({ labels: { result: { amount: '乘客支付金额' } } }).labels,
    { result: { amount: '乘客支付金额' } },
  )
  for (const labels of [
    { result: { amount: '' } },
    { result: { amount: '   ' } },
    { result: { amount: 42 } },
  ])
    assert.throws(() => analysisPresentInput.parse({ labels }))
  assert.throws(() =>
    analysisPresentInput.parse({ labels: { result: { amount: 'x' } }, extra: true }),
  )
})
