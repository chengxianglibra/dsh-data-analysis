import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  analysisCatalogBuild,
  analysisCatalogId,
} from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  ANALYSIS_UI_FORMAT,
  analysisRecordId,
  parseAnalysisDocument,
} from '../../src/presentation/contracts/analysis-document.ts'
import { pointFromDocument } from '../../src/presentation/point-reference.ts'
import { publishPresentation } from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import {
  comparisonOf,
  decompositionOf,
  frame,
  pairStatistic,
  statistic,
} from '../unified-analysis-ui/frame-fixtures.ts'

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  artifactId: string | null = 'marivo-artifact',
) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'frame-point-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const snapshot = frame({
    axes: [{ name: 'region', keys: ['A', 'B'] }],
    values: [
      { name: 'left', type: 'int64', values: ['9007199254740993', '2'] },
      { name: 'right', type: 'int64', values: ['3', '9'] },
      { name: 'left_present', type: 'boolean', values: [true, true], presence: true },
      { name: 'right_present', type: 'boolean', values: [true, false], presence: true },
    ],
    alignments: [
      {
        left: {
          values: ['left'],
          presence: ['left_present'],
          coordinates: [{ kind: 'axis', axisToken: 't_region', endpoint: 'self' }],
        },
        right: {
          values: ['right'],
          presence: ['right_present'],
          coordinates: [{ kind: 'axis', axisToken: 't_region', endpoint: 'self' }],
        },
      },
    ],
  })
  snapshot.source.sessionId = 'marivo-session'
  snapshot.source.artifactId = artifactId
  snapshot.frame.description = artifactId === null ? null : 'January 2025 saved analysis'
  const makeDocument = (buildId: string) =>
    parseAnalysisDocument({
      schemaVersion: ANALYSIS_UI_FORMAT,
      workspaceId: 'workspace',
      reportId: 'report',
      buildId,
      recordId: analysisRecordId('report', buildId),
      title: 'Point',
      locale: 'en-US',
      generatedAt: '2026-10-31T00:00:00Z',
      catalog: { id: analysisCatalogId, build: analysisCatalogBuild },
      program: 'root = AnalysisFrameView("data");',
      resources: {
        data: {
          kind: 'snapshot',
          declaration: { kind: 'frame-snapshot', snapshotRef: 'test' },
          snapshot:
            buildId === 'second'
              ? {
                  ...snapshot,
                  source: {
                    ...snapshot.source,
                    sessionId: 'other-marivo-session',
                    artifactId: 'other-marivo-artifact',
                  },
                }
              : snapshot,
          binding: {
            workspaceId: 'workspace',
            sessionId: 'session',
            callId: 'call',
            codeRef: {
              executionId: '00000000-0000-4000-8000-000000000000',
              sha256: 'a'.repeat(64),
            },
          },
        },
      },
    })
  await publishPresentation(root, makeDocument('first'), null, async () => {}, undefined, {
    kind: 'agent',
    sessionId: 'session',
    surface: 'tab',
  })
  await publishPresentation(root, makeDocument('second'), 'first', async () => {}, undefined, {
    kind: 'agent',
    sessionId: 'session',
    surface: 'tab',
  })
  return {
    root,
    makeDocument,
    request: {
      sessionId: 'session',
      workspaceId: 'workspace',
      recordId: analysisRecordId('report', 'first'),
      resourceName: 'data',
      row: 0,
      field: 'left',
    },
  }
}

test('point references bind exact published build, raw typed keys and precise value', async (t) => {
  const f = await fixture(t)
  const service = new MarivoPresentationFileService((id) =>
    id === 'session' ? { id: 'workspace', path: f.root } : undefined,
  )
  const result = await service.point('point/prepare', f.request)
  if (!('envelope' in result) || !result.envelope) throw new Error('expected-envelope')
  const envelope = result.envelope
  assert.equal(envelope.recordId, 'marivo-ui:report:first')
  assert.equal(envelope.point.value, '9007199254740993')
  assert.equal(envelope.point.role, 'left')
  assert.equal(envelope.point.description, 'January 2025 saved analysis')
  assert.deepEqual(envelope.point.axes[0]!.keys[0], {
    id: 'region',
    slotId: 'k_region',
    dtype: { type: 'string' },
    value: 'A',
  })
  const serialized = await service.point('point/serialize', { envelope })
  if (!('text' in serialized) || !serialized.text) throw new Error('expected-text')
  assert.match(serialized.text, /9007199254740993/)
  assert.match(serialized.text, /January 2025 saved analysis/)
  assert.match(serialized.text, /marivo-ui:report:first/)
  const serializedPoint = JSON.parse(serialized.text.slice(serialized.text.indexOf('\n') + 1))
  assert.deepEqual(serializedPoint.marivoFrame, {
    sessionId: 'marivo-session',
    artifactId: 'marivo-artifact',
  })
  const current = await service.point('point/prepare', {
    ...f.request,
    recordId: analysisRecordId('report', 'second'),
  })
  if (!('envelope' in current) || !current.envelope) throw new Error('expected-envelope')
  const serializedCurrent = await service.point('point/serialize', { envelope: current.envelope })
  if (!('text' in serializedCurrent) || !serializedCurrent.text) throw new Error('expected-text')
  const currentPoint = JSON.parse(
    serializedCurrent.text.slice(serializedCurrent.text.indexOf('\n') + 1),
  )
  assert.deepEqual(currentPoint.marivoFrame, {
    sessionId: 'other-marivo-session',
    artifactId: 'other-marivo-artifact',
  })
  await assert.rejects(
    service.point('point/serialize', {
      envelope: { ...envelope, marivoFrame: { sessionId: 'other', artifactId: 'other' } },
    }),
    /invalid-request/,
  )
  await assert.rejects(
    service.point('point/serialize', {
      envelope: { ...envelope, point: { ...envelope.point, value: '5' } },
    }),
    /point-mismatch/,
  )
  await assert.rejects(
    service.point('point/serialize', {
      envelope: { ...envelope, point: { ...envelope.point, role: 'right' } },
    }),
    /point-mismatch/,
  )
  await assert.rejects(
    service.point('point/serialize', {
      envelope: {
        ...envelope,
        point: {
          ...envelope.point,
          axes: [
            {
              ...envelope.point.axes[0],
              keys: [{ ...envelope.point.axes[0]!.keys[0], value: 'B' }],
            },
          ],
        },
      },
    }),
    /point-mismatch/,
  )
  await assert.rejects(
    service.point('point/prepare', { ...f.request, row: 1, field: 'right' }),
    /point-unavailable/,
  )
  await assert.rejects(
    service.point('point/prepare', { ...f.request, row: 9 }),
    /point-unavailable/,
  )
  await assert.rejects(
    service.point('point/prepare', { ...f.request, field: 'region' }),
    /point-unavailable/,
  )
  await assert.rejects(
    service.point('point/prepare', { ...f.request, workspaceId: 'other' }),
    /workspace-unavailable/,
  )
  await assert.rejects(
    service.point('point/prepare', { ...f.request, sessionId: 'other' }),
    /workspace-unavailable/,
  )
  await service.close()
})

test('point serialization reports an in-memory Frame without an artifact', async (t) => {
  const f = await fixture(t, null)
  const service = new MarivoPresentationFileService((id) =>
    id === 'session' ? { id: 'workspace', path: f.root } : undefined,
  )
  const result = await service.point('point/prepare', f.request)
  if (!('envelope' in result) || !result.envelope) throw new Error('expected-envelope')
  const serialized = await service.point('point/serialize', { envelope: result.envelope })
  if (!('text' in serialized) || !serialized.text) throw new Error('expected-text')
  const serializedPoint = JSON.parse(serialized.text.slice(serialized.text.indexOf('\n') + 1))
  assert.deepEqual(serializedPoint.marivoFrame, { sessionId: 'marivo-session', artifactId: null })
  assert.match(serialized.text, /memory|in-memory/i)
  assert.match(serialized.text, /cannot|not.*recover/i)
  await service.close()
})

test('selection enforces comparison-side presence and rejects parent totals and broadcast values', async (t) => {
  const f = await fixture(t)
  const comparison = comparisonOf({ kind: 'ordinary' }, [
    {
      name: 'trips',
      values: [
        ['current', 'current'],
        ['baseline', 'baseline'],
        ['absolute', 'delta'],
      ],
    },
  ])
  comparison.presence = { current: 'current_present', baseline: 'baseline_present', enclosing: [] }
  const comparisonFrame = frame({
    axes: [{ name: 'region', keys: ['A'] }],
    values: [
      { name: 'current', values: [5] },
      { name: 'baseline', values: [7] },
      { name: 'delta', values: [-2] },
      { name: 'current_present', type: 'boolean', values: [true], presence: true },
      { name: 'baseline_present', type: 'boolean', values: [false], presence: true },
    ],
    comparisons: [comparison],
  })
  const source = f.makeDocument('first')
  const resource = source.resources.data
  assert(resource?.kind === 'snapshot')
  const make = (snapshot: typeof comparisonFrame) => ({
    ...source,
    resources: { data: { ...resource, snapshot } },
  })
  assert.equal(
    pointFromDocument(make(comparisonFrame), { ...f.request, field: 'current' }).point.role,
    'current',
  )
  assert.throws(
    () => pointFromDocument(make(comparisonFrame), { ...f.request, field: 'baseline' }),
    /point-unavailable/,
  )
  assert.throws(
    () => pointFromDocument(make(comparisonFrame), { ...f.request, field: 'delta' }),
    /point-unavailable/,
  )
  const totalFrame = frame({
    axes: [{ name: 'region', keys: ['A'] }],
    values: [{ name: 'total', values: [5] }],
    decompositions: [decompositionOf([['total', 'total']])],
  })
  assert.throws(
    () => pointFromDocument(make(totalFrame), { ...f.request, field: 'total' }),
    /point-unavailable/,
  )
  const broadcast = frame({
    axes: [{ name: 'region', keys: ['A'] }],
    values: [{ name: 'mean', values: [5], context: statistic('mean', []) }],
  })
  assert.throws(
    () => pointFromDocument(make(broadcast), { ...f.request, field: 'mean' }),
    /point-unavailable/,
  )
})

test('point serialization detects workspace identity changes and cancellation', async (t) => {
  const f = await fixture(t)
  let count = 0
  const changing = new MarivoPresentationFileService(() => ({
    id: 'workspace',
    path: ++count === 1 ? f.root : path.join(f.root, 'other'),
  }))
  await assert.rejects(changing.point('point/prepare', f.request), /workspace-changed/)
  const controller = new AbortController()
  controller.abort(new Error('cancel-point'))
  await assert.rejects(
    changing.point('point/prepare', f.request, controller.signal),
    /cancel-point/,
  )
  await changing.close()
})

test('decomposition side values require an unambiguous present side without blocking entry and exit effects', async (t) => {
  const f = await fixture(t)
  const decomposition = decompositionOf([
    ['value', 'detail'],
    ['current', 'current'],
    ['baseline', 'baseline'],
    ['absolute', 'absolute'],
    ['contribution', 'contribution'],
    ['effect_entry_exit', 'entry_exit'],
    ['numerator_current', 'numerator_current'],
    ['denominator', 'denominator'],
  ])
  decomposition.outputs.push(
    { fieldKind: 'presence', role: 'value_present', name: 'has_value' },
    { fieldKind: 'presence', role: 'current_present', name: 'has_current' },
    { fieldKind: 'presence', role: 'baseline_present', name: 'has_baseline' },
  )
  const axes = [{ name: 'region', keys: ['A', 'B'] }]
  const values = [
    { name: 'detail', values: [4, 5] },
    { name: 'current', values: [4, 5] },
    { name: 'baseline', values: [7, 8] },
    { name: 'absolute', values: [-3, -3] },
    { name: 'contribution', values: [-3, -3] },
    { name: 'entry_exit', values: [-3, -3] },
    { name: 'numerator_current', values: [4, 5] },
    { name: 'denominator', values: [7, 8] },
    { name: 'has_value', type: 'boolean' as const, values: [true, false], presence: true },
    { name: 'has_current', type: 'boolean' as const, values: [true, true], presence: true },
    { name: 'has_baseline', type: 'boolean' as const, values: [true, false], presence: true },
  ]
  const source = f.makeDocument('first')
  const resource = source.resources.data
  assert(resource?.kind === 'snapshot')
  const make = (output: typeof decomposition) => ({
    ...source,
    resources: {
      data: { ...resource, snapshot: frame({ axes, values, decompositions: [output] }) },
    },
  })
  const document = make(decomposition)
  for (const field of ['detail', 'current', 'baseline', 'absolute'])
    assert.equal(
      pointFromDocument(document, { ...f.request, field }).point.value,
      field === 'absolute' ? -3 : field === 'baseline' ? 7 : 4,
    )
  for (const field of ['detail', 'baseline', 'absolute'])
    assert.throws(
      () => pointFromDocument(document, { ...f.request, row: 1, field }),
      /point-unavailable/,
    )
  for (const field of ['current', 'contribution', 'entry_exit'])
    assert.doesNotThrow(() => pointFromDocument(document, { ...f.request, row: 1, field }))
  for (const field of ['numerator_current', 'denominator'])
    assert.throws(() => pointFromDocument(document, { ...f.request, field }), /point-unavailable/)
  const ambiguous = {
    ...decomposition,
    outputs: [
      ...decomposition.outputs,
      { fieldKind: 'presence' as const, role: 'current_present' as const, name: 'has_value' },
    ],
  }
  assert.throws(
    () => pointFromDocument(make(ambiguous), { ...f.request, field: 'current' }),
    /point-unavailable/,
  )
  const missing = {
    ...decomposition,
    outputs: decomposition.outputs.filter((item) => item.role !== 'value_present'),
  }
  assert.throws(
    () => pointFromDocument(make(missing), { ...f.request, field: 'detail' }),
    /point-unavailable/,
  )
})

test('comparison and decomposition reject multiple roles for the same field', async (t) => {
  const f = await fixture(t)
  const source = f.makeDocument('first')
  const resource = source.resources.data
  assert(resource?.kind === 'snapshot')
  const axes = [{ name: 'region', keys: ['A'] }]
  const values = [{ name: 'shared', values: [5] }]
  const comparison = comparisonOf({ kind: 'ordinary' }, [
    {
      name: 'trips',
      values: [
        ['current', 'shared'],
        ['baseline', 'shared'],
      ],
    },
  ])
  const ambiguousComparison = frame({ axes, values, comparisons: [comparison] })
  assert.throws(
    () =>
      pointFromDocument(
        { ...source, resources: { data: { ...resource, snapshot: ambiguousComparison } } },
        { ...f.request, field: 'shared' },
      ),
    /point-unavailable/,
  )
  const decomposition = decompositionOf([
    ['contribution', 'shared'],
    ['effect_mix', 'shared'],
  ])
  const ambiguousDecomposition = frame({ axes, values, decompositions: [decomposition] })
  assert.throws(
    () =>
      pointFromDocument(
        { ...source, resources: { data: { ...resource, snapshot: ambiguousDecomposition } } },
        { ...f.request, field: 'shared' },
      ),
    /point-unavailable/,
  )
})

test('correlation requires and serializes the exact same-scope pair count', async (t) => {
  const f = await fixture(t)
  const correlation = frame({
    values: [
      { name: 'coefficient', values: [0.75], context: pairStatistic('pearson', []) },
      {
        name: 'n_pairs',
        type: 'int64',
        values: ['9007199254740993'],
        context: pairStatistic('pair_count', []),
      },
    ],
  })
  const source = f.makeDocument('third')
  const resource = source.resources.data
  assert(resource?.kind === 'snapshot')
  const document = { ...source, resources: { data: { ...resource, snapshot: correlation } } }
  await publishPresentation(f.root, document, 'second', async () => {}, undefined, {
    kind: 'agent',
    sessionId: 'session',
    surface: 'tab',
  })
  const service = new MarivoPresentationFileService(() => ({ id: 'workspace', path: f.root }))
  const prepared = await service.point('point/prepare', {
    ...f.request,
    recordId: analysisRecordId('report', 'third'),
    field: 'coefficient',
  })
  if (!('envelope' in prepared) || !prepared.envelope) throw new Error('expected-envelope')
  assert.equal(prepared.envelope.point.related[0]?.value, '9007199254740993')
  assert.equal(prepared.envelope.point.related[0]?.column.id, 'n_pairs')
  const serialized = await service.point('point/serialize', { envelope: prepared.envelope })
  if (!('text' in serialized) || !serialized.text) throw new Error('expected-text')
  assert.match(serialized.text, /9007199254740993/)
  await assert.rejects(
    service.point('point/serialize', {
      envelope: {
        ...prepared.envelope,
        point: { ...prepared.envelope.point, related: [] },
      },
    }),
    /point-mismatch/,
  )
  const withoutCount = frame({
    values: [{ name: 'coefficient', values: [0.75], context: pairStatistic('pearson', []) }],
  })
  assert.throws(
    () =>
      pointFromDocument(
        { ...source, resources: { data: { ...resource, snapshot: withoutCount } } },
        {
          ...f.request,
          recordId: analysisRecordId('report', 'third'),
          field: 'coefficient',
        },
      ),
    /point-unavailable/,
  )
  await service.close()
})

test('component reference binds the saved Frame and the admitted view configuration', async (t) => {
  const f = await fixture(t)
  const service = new MarivoPresentationFileService((id) =>
    id === 'session' ? { id: 'workspace', path: f.root } : undefined,
  )
  const { row: _row, field: _field, ...identity } = f.request
  const request = { ...identity, component: { kind: 'frame' as const } }
  const prepared = await service.component('component/prepare', request)
  if (!('envelope' in prepared) || !prepared.envelope) throw new Error('expected-envelope')
  const sent = await service.component('component/serialize', { envelope: prepared.envelope })
  if (!('text' in sent) || !sent.text) throw new Error('expected-text')
  const data = JSON.parse(sent.text.slice(sent.text.indexOf('\n') + 1))
  assert.equal(data.recordId, identity.recordId)
  assert.equal(data.resource, 'data')
  assert.equal(data.component.kind, 'frame')
  assert.deepEqual(data.marivoFrame, { sessionId: 'marivo-session', artifactId: 'marivo-artifact' })
  assert.equal(
    data.rows[0][data.columns.findIndex((column: { id: string }) => column.id === 'left')],
    '9007199254740993',
  )
  assert.equal(data.report.program, 'root = AnalysisFrameView("data");')
  await assert.rejects(
    service.component('component/prepare', {
      ...request,
      component: { kind: 'frame', view: { chart: 'table' } },
    }),
    /component-unavailable/,
  )
  await assert.rejects(
    service.component('component/prepare', { ...request, component: { kind: 'dataset' } }),
    /component-unavailable/,
  )
  await assert.rejects(
    service.component('component/serialize', {
      envelope: { ...prepared.envelope, digest: '0'.repeat(64) },
    }),
    /component-mismatch/,
  )
  await assert.rejects(
    service.component('component/prepare', { ...request, sessionId: 'other' }),
    /workspace-unavailable/,
  )
  await service.close()
})

test('component reference matches inline saved view props independent of object key order', async (t) => {
  const f = await fixture(t)
  const document = {
    ...f.makeDocument('first'),
    program:
      'root = Stack([AnalysisFrameView("data", {chart:"table",columns:["left"]}), AnalysisFrameView("data", {chart:"table",columns:["right"]})]);',
  }
  const { componentFromDocument } = await import('../../src/presentation/component-reference.ts')
  const { row: _row, field: _field, ...identity } = f.request
  const select = {
    ...identity,
    component: { kind: 'frame' as const, view: { columns: ['right'], chart: 'table' } },
  }
  const match = componentFromDocument(document, select)
  assert.deepEqual(match.view, { chart: 'table', columns: ['right'] })
  assert.throws(
    () =>
      componentFromDocument(document, {
        ...select,
        component: { ...select.component, view: { chart: 'table', columns: ['left', 'right'] } },
      }),
    /component-unavailable/,
  )
  assert.throws(
    () =>
      componentFromDocument(document, {
        ...select,
        component: { ...select.component, statementId: 'missing' },
      }),
    /component-unavailable/,
  )
  assert.throws(
    () => componentFromDocument(document, { ...identity, component: { kind: 'frame' } }),
    /component-unavailable/,
  )
})

test('component references admit an empty Dataset without fabricating a row', async (t) => {
  const f = await fixture(t)
  const { datasetSnapshot } = await import('../unified-analysis-ui/dataset-fixtures.ts')
  const { componentFromDocument } = await import('../../src/presentation/component-reference.ts')
  const { datasetContext } = await import('../../src/presentation/dataset-reference.ts')
  const original = f.makeDocument('first')
  const resource = original.resources.data!
  if (resource.kind !== 'snapshot') throw new Error('expected-snapshot')
  const document = {
    ...original,
    program: 'root = DatasetView("data");',
    resources: { data: { ...resource, snapshot: datasetSnapshot([]) } },
  }
  const { row: _row, field: _field, ...identity } = f.request
  const result = componentFromDocument(document, { ...identity, component: { kind: 'dataset' } })
  if (result.snapshot.kind !== 'dataset') throw new Error('expected-dataset')
  const preview = datasetContext(result.snapshot)
  assert.deepEqual(preview.rows, [])
  assert.equal(preview.previewTruncated, false)
  assert.equal(result.envelope.schema, 'dsh-data-analysis-component/v1')
})

test('Frame component preview bounds escaped data and discloses omitted rows and metadata', async () => {
  const { frameContext } = await import('../../src/presentation/frame-reference.ts')
  const snapshot = frame({ values: [{ name: 'value', type: 'string', values: ['x', 'y'] }] })
  snapshot.data.rows[0]![0] = '\u0001'.repeat(20_000)
  snapshot.data.rows[1]![0] = 'y'.repeat(30_000)
  snapshot.frame.description = '\u0001'.repeat(20_000)
  const preview = frameContext(snapshot)
  assert.equal(preview.previewTruncated, true)
  assert.equal(preview.rows.length, 0)
  assert.equal(preview.metadata.truncated, true)
  assert.equal(preview.metadata.value, null)
  assert.ok(Buffer.byteLength(JSON.stringify(preview), 'utf8') < 170_000)
})

test('component references admit saved multi-byte views and long statement IDs', async (t) => {
  const f = await fixture(t)
  const { datasetSnapshot } = await import('../unified-analysis-ui/dataset-fixtures.ts')
  const { parseComponentEnvelope, parseComponentRequest } = await import(
    '../../src/presentation/contracts/component-reference.ts'
  )
  const statementId = `v${'a'.repeat(7_399)}`
  const names = Array.from(
    { length: 64 },
    (_, i) => `${String(i).padStart(2, '0')}${'列'.repeat(254)}`,
  )
  const columns = names.map((id) => ({ id, label: id, type: 'string' as const, nullable: false }))
  const snapshot = datasetSnapshot([names.map(() => 'x'.repeat(1600))], columns)
  const program = `root = Stack([${statementId}]);\n${statementId} = DatasetView("data", {chart:"table",columns:${JSON.stringify(names)}});`
  assert.ok(program.length > 31_000 && program.length <= 32_768)
  const original = f.makeDocument('third')
  const existing = original.resources.data!
  if (existing.kind !== 'snapshot') throw new Error('expected-snapshot')
  const document = parseAnalysisDocument({
    ...original,
    program,
    resources: {
      data: {
        ...existing,
        declaration: { kind: 'dataset-snapshot', snapshotRef: 'test' },
        snapshot,
      },
    },
  })
  await publishPresentation(f.root, document, 'second', async () => {}, undefined, {
    kind: 'agent',
    sessionId: 'session',
    surface: 'tab',
  })
  const service = new MarivoPresentationFileService((id) =>
    id === 'session' ? { id: 'workspace', path: f.root } : undefined,
  )
  const request = {
    sessionId: 'session',
    workspaceId: 'workspace',
    recordId: document.recordId,
    resourceName: 'data',
    component: { kind: 'dataset' as const, statementId, view: { chart: 'table', columns: names } },
  }
  assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') > 32_768)
  assert.deepEqual(parseComponentRequest(request), request)
  const prepared = await service.component('component/prepare', request)
  if (!('envelope' in prepared) || !prepared.envelope) throw new Error('expected-envelope')
  assert.deepEqual(parseComponentEnvelope(prepared.envelope), prepared.envelope)
  const { createComponentReferenceSource } = await import('../../src/client/component-reference.ts')
  const codec = createComponentReferenceSource(
    { call: async () => ({ ok: true, value: { text: 'ok' } }) },
    new AbortController().signal,
  ).codec
  assert.ok(codec)
  assert.equal(codec.clipboardText(JSON.stringify(prepared.envelope)), '@data')
  const serialized = await service.component('component/serialize', { envelope: prepared.envelope })
  if (!('text' in serialized) || !serialized.text) throw new Error('expected-text')
  assert.ok(Buffer.byteLength(serialized.text, 'utf8') <= 262_144)
  const context = JSON.parse(serialized.text.slice(serialized.text.indexOf('\n') + 1))
  assert.deepEqual(context.component.view.columns, names)
  assert.equal(context.component.statementId, statementId)
  assert.equal(context.report.programTruncated, true)
  await service.close()
})

test('component reference byte limits reject oversize input', async () => {
  const { COMPONENT_REFERENCE_MAX_BYTES, parseComponentEnvelope, parseComponentRequest } =
    await import('../../src/presentation/contracts/component-reference.ts')
  const request = {
    sessionId: 's',
    workspaceId: 'w',
    recordId: 'marivo-ui:r:b',
    resourceName: 'data',
    component: { kind: 'dataset', view: { tooLarge: '界'.repeat(COMPONENT_REFERENCE_MAX_BYTES) } },
  }
  assert.throws(() => parseComponentRequest(request), /invalid-request/)
  assert.throws(
    () =>
      parseComponentEnvelope({
        ...request,
        schema: 'dsh-data-analysis-component/v1',
        digest: 'a'.repeat(64),
      }),
    /invalid-request/,
  )
  const base = { ...request, component: { kind: 'dataset', statementId: 'a'.repeat(32_768) } }
  assert.equal(parseComponentRequest(base).component.statementId?.length, 32_768)
  assert.throws(
    () =>
      parseComponentRequest({
        ...base,
        component: { ...base.component, statementId: 'a'.repeat(32_769) },
      }),
    /invalid-request/,
  )
})

test('overall component model text budget truncates preview but preserves complete view', async () => {
  const { componentModelText } = await import('../../src/presentation/component-reference.ts')
  const { datasetSnapshot } = await import('../unified-analysis-ui/dataset-fixtures.ts')
  const snapshot = datasetSnapshot(
    Array.from({ length: 3 }, () => ['数'.repeat(10_000)]),
    [{ id: 'v', label: 'Value', type: 'string', nullable: false }],
  )
  const view = { arbitrary: '列'.repeat(70_000) }
  const request = {
    sessionId: 's',
    workspaceId: 'w',
    recordId: 'marivo-ui:r:b',
    resourceName: 'data',
    component: { kind: 'dataset' as const, view },
  }
  const text = componentModelText(
    { title: 'Report', program: 'root = DatasetView("data");' },
    request,
    snapshot,
    view,
    undefined,
  )
  assert.ok(Buffer.byteLength(text, 'utf8') <= 262_144)
  const context = JSON.parse(text.slice(text.indexOf('\n') + 1))
  assert.deepEqual(context.component.view, view)
  assert.equal(context.contextTruncated, true)
  assert.equal(context.report.programTruncated, true)
  assert.equal(context.previewTruncated, true)
  assert.equal(context.columnsTruncated, true)
  assert.deepEqual(context.rows, [])
})

test('Frame component overall budget keeps Marivo identity when preview is omitted', async () => {
  const { componentModelText } = await import('../../src/presentation/component-reference.ts')
  const snapshot = frame({
    values: [{ name: 'value', type: 'string', values: ['x'.repeat(30_000), 'y'.repeat(30_000)] }],
  })
  snapshot.source.sessionId = 'marivo-session'
  snapshot.source.artifactId = 'artifact'
  const view = { arbitrary: '列'.repeat(78_000) }
  const request = {
    sessionId: 's',
    workspaceId: 'w',
    recordId: 'marivo-ui:r:b',
    resourceName: 'data',
    component: { kind: 'frame' as const, view },
  }
  const text = componentModelText(
    { title: 'Report', program: 'root = AnalysisFrameView("data");' },
    request,
    snapshot,
    view,
    undefined,
  )
  assert.ok(Buffer.byteLength(text, 'utf8') <= 262_144)
  const context = JSON.parse(text.slice(text.indexOf('\n') + 1))
  assert.deepEqual(context.component.view, view)
  assert.deepEqual(context.marivoFrame, { sessionId: 'marivo-session', artifactId: 'artifact' })
  assert.equal(context.contextTruncated, true)
  assert.equal(context.metadata.truncated, true)
  assert.equal(context.sections.truncated, true)
  assert.equal(context.coordinates.truncated, true)
  assert.equal(context.previewTruncated, true)
})
