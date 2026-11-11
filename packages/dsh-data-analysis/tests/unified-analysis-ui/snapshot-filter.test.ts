import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveSnapshotFilter,
  snapshotFilterSchema,
  visibleSnapshotRows,
} from '../../src/presentation/contracts/snapshot-filter.ts'
import { datasetSnapshot } from './dataset-fixtures.ts'

const snapshot = datasetSnapshot(
  [
    ['', true, '9007199254740993'],
    [null, false, '9007199254740992'],
    ['null', true, '9007199254740992'],
    ['', false, '9007199254740993'],
  ],
  [
    { id: 'category', label: 'Same', type: 'string', nullable: true },
    { id: 'flag', label: 'Same', type: 'boolean', nullable: false },
    { id: 'large', label: 'Large', type: 'int64', nullable: false },
  ],
)
const definition = snapshotFilterSchema.parse({
  filterId: 'category',
  ref: 'sales',
  field: { kind: 'column', name: 'category' },
  label: 'Category',
  mode: 'multiple',
  defaultValues: [null],
})

test('saved category values preserve null, empty strings, booleans and large int64', () => {
  const original = JSON.stringify(snapshot)
  const category = resolveSnapshotFilter(snapshot, definition)
  const flag = resolveSnapshotFilter(snapshot, {
    ...definition,
    filterId: 'flag',
    field: { kind: 'column', name: 'flag' },
    defaultValues: [],
  })
  const large = resolveSnapshotFilter(snapshot, {
    ...definition,
    filterId: 'large',
    field: { kind: 'column', name: 'large' },
    defaultValues: [],
  })
  assert.deepEqual(category.options, ['', null, 'null'])
  assert.deepEqual(flag.options, [true, false])
  assert.deepEqual(large.options, ['9007199254740993', '9007199254740992'])
  assert.deepEqual(
    visibleSnapshotRows(4, [
      { values: category.values, selected: ['', null] },
      { values: flag.values, selected: [false] },
    ]),
    [1, 3],
  )
  assert.deepEqual(
    visibleSnapshotRows(4, [{ values: large.values, selected: ['9007199254740993'] }]),
    [0, 3],
  )
  assert.deepEqual(visibleSnapshotRows(4, [{ values: category.values, selected: ['missing'] }]), [])
  assert.deepEqual(
    visibleSnapshotRows(4, [{ values: category.values, selected: [] }]),
    [0, 1, 2, 3],
  )
  assert.equal(JSON.stringify(snapshot), original)
})

test('invalid defaults and unsupported fields are rejected', () => {
  assert.throws(
    () => resolveSnapshotFilter(snapshot, { ...definition, defaultValues: ['absent'] }),
    /analysis-filter-default-invalid/,
  )
  assert.throws(
    () => resolveSnapshotFilter(snapshot, { ...definition, defaultValues: ['', ''] }),
    /analysis-filter-default-invalid/,
  )
  assert.throws(
    () =>
      resolveSnapshotFilter(snapshot, { ...definition, mode: 'single', defaultValues: ['', null] }),
    /analysis-filter-default-invalid/,
  )
  assert.throws(
    () =>
      resolveSnapshotFilter(snapshot, { ...definition, field: { kind: 'axis', name: 'category' } }),
    /analysis-filter-field-invalid/,
  )
  const empty = datasetSnapshot([], snapshot.data.columns)
  assert.throws(() => resolveSnapshotFilter(empty, definition), /analysis-filter-default-invalid/)
  assert.deepEqual(resolveSnapshotFilter(empty, { ...definition, defaultValues: [] }).options, [])
})

test('document admission checks filter bindings on the complete saved snapshot', async () => {
  const { AnalysisViewError, validateAnalysisResources } = await import(
    '../../src/presentation/contracts/analysis-document.ts'
  )
  const resources = {
    sales: {
      kind: 'snapshot' as const,
      declaration: { kind: 'dataset-snapshot' as const, snapshotRef: 'data' },
      snapshot,
      binding: {
        workspaceId: 'workspace',
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
    other: {
      kind: 'snapshot' as const,
      declaration: { kind: 'dataset-snapshot' as const, snapshotRef: 'other' },
      snapshot,
      binding: {
        workspaceId: 'workspace',
        codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
        sessionId: 'session',
        callId: 'call',
      },
    },
  }
  const declaration =
    'f = SnapshotFilter("category", "sales", {kind: "column", name: "category"}, "Category", "multiple", [null]);'
  const view = 'v = DatasetView("sales", {chart: "table"}, {}, ["category"]);'
  const program = (children: string, extra = '') =>
    `root = Stack([${children}]);\n${declaration}\n${view}\n${extra}`
  assert.doesNotThrow(() => validateAnalysisResources(program('f, f, v'), resources))
  const wrongKind = program('f, v').replace('kind: "column"', 'kind: "axis"')
  assert.throws(
    () => validateAnalysisResources(wrongKind, resources),
    (error) => {
      assert(error instanceof AnalysisViewError)
      assert.equal(error.path, 'f/field/kind')
      assert.deepEqual(error.details, {
        received: 'axis',
        expectedKind: 'field-kind',
        candidates: ['column'],
      })
      validateAnalysisResources(
        wrongKind.replace('kind: "axis"', `kind: ${JSON.stringify(error.details.candidates[0])}`),
        resources,
      )
      return true
    },
  )
  const check = (source: string, code: string) => {
    assert.throws(
      () => validateAnalysisResources(source, resources),
      (error) => error instanceof AnalysisViewError && error.code === code && Boolean(error.path),
    )
  }
  check(program('v'), 'analysis-filter-unreachable')
  check(program('f, v', declaration), 'analysis-filter-declaration-duplicate')
  check(program('f'), 'analysis-filter-unused')
  check(
    program(
      'f, v',
      'f2 = SnapshotFilter("category", "sales", {kind: "column", name: "category"}, "Other");\nroot = Stack([f, f2, v]);',
    ),
    'analysis-filter-id-duplicate',
  )
  check(
    program('f, DatasetView("other", {chart: "table"}, {}, ["category"])'),
    'analysis-filter-resource-mismatch',
  )
  check(
    program('f, DatasetView("sales", {chart: "table"}, {}, ["missing"])'),
    'analysis-filter-reference-invalid',
  )
  check(
    program('f, DatasetView("sales", {chart: "table"}, {}, ["category", "category"])'),
    'analysis-filter-reference-invalid',
  )
  check(
    program(
      'f, DatasetView("sales", {chart: "heatmap", encoding: {x: "category", y: "flag", value: "large"}}, {}, ["category"])',
    ),
    'analysis-filter-view-unsupported',
  )
  check(program('f, v').replace('[null]', '["absent"]'), 'analysis-filter-default-invalid')
  check(
    program('f, v').replace('name: "category"', 'name: "missing"'),
    'analysis-filter-field-invalid',
  )
  check(
    `root = Stack([SnapshotFilter("category", "sales", {kind: "column", name: "category"}, "Category"), DatasetView("sales", {chart: "table"}, {}, ["category"])]);`,
    'analysis-filter-named-required',
  )
})

test('real Frame axes and interpretation gate filter admission and auto views', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parseAnalysisSnapshot } = await import('../../src/presentation/contracts/snapshot.ts')
  const { AnalysisViewError, validateAnalysisResources } = await import(
    '../../src/presentation/contracts/analysis-document.ts'
  )
  const load = async (name: string) => {
    const raw = await readFile(new URL(`./fixtures/frames/${name}.json`, import.meta.url), 'utf8')
    const parsed = parseAnalysisSnapshot(JSON.parse(raw))
    if (parsed.kind !== 'frame') throw new Error('Frame fixture required')
    return parsed
  }
  const observation = await load('observe-category')
  const declaration = snapshotFilterSchema.parse({
    filterId: 'region',
    ref: 'frame',
    field: { kind: 'axis', name: 'sales.customer.region' },
    label: 'Region',
    defaultValues: ['east'],
  })
  const resolved = resolveSnapshotFilter(observation, declaration)
  assert.deepEqual(resolved.options, ['east', 'south'])
  assert.deepEqual(
    visibleSnapshotRows(observation.data.rows.length, [
      { values: resolved.values, selected: ['east'] },
    ]),
    [0],
  )
  const source = (view: string) =>
    `root = Stack([f, AnalysisFrameView("frame", ${view}, {}, ["region"])]);\nf = SnapshotFilter("region", "frame", {kind:"axis", name:"sales.customer.region"}, "Region", "single", ["east"]);`
  const check = (snapshot: typeof observation, view: string) =>
    validateAnalysisResources(source(view), {
      frame: {
        kind: 'snapshot',
        declaration: { kind: 'frame-snapshot', snapshotRef: 'frame' },
        snapshot,
        binding: {
          workspaceId: 'workspace',
          codeRef: { executionId: 'run', sha256: 'a'.repeat(64) },
          sessionId: 'session',
          callId: 'call',
        },
      },
    })
  assert.doesNotThrow(() => check(observation, '{chart:"auto"}'))
  assert.doesNotThrow(() => check(observation, '{chart:"table"}'))
  const missing = structuredClone(observation)
  missing.frame.sections.interpretation = { status: 'unavailable', reason: 'read-failed' }
  assert.throws(
    () => check(missing, '{chart:"table"}'),
    (error) =>
      error instanceof AnalysisViewError && error.code === 'analysis-filter-view-unsupported',
  )
  const share = await load('share')
  assert.throws(
    () =>
      check(
        share,
        '{chart:"line", encoding:{axis:"calendar:month", series:"sales.customer.region", values:["region_share"]}}',
      ),
    (error) =>
      error instanceof AnalysisViewError && error.code === 'analysis-filter-view-unsupported',
  )
  const broadcast = await load('over-broadcast')
  assert.throws(
    () =>
      check(
        broadcast,
        '{chart:"line", encoding:{axis:"calendar:month", series:"sales.customer.region", values:["month_total"]}}',
      ),
    (error) =>
      error instanceof AnalysisViewError && error.code === 'analysis-filter-view-unsupported',
  )
})

test('filter fields and defaults use the existing snapshot text limits', async () => {
  const category = 'x'.repeat(2001)
  const data = datasetSnapshot(
    [[category]],
    [{ id: 'category', label: 'Category', type: 'string', nullable: false }],
  )
  const defaulted = snapshotFilterSchema.parse({
    filterId: 'filter',
    ref: 'data',
    field: { kind: 'column', name: 'category' },
    label: 'Category',
    defaultValues: [category],
  })
  assert.deepEqual(resolveSnapshotFilter(data, defaulted).options, [category])
  const { readFile } = await import('node:fs/promises')
  const { parseAnalysisSnapshot } = await import('../../src/presentation/contracts/snapshot.ts')
  const raw = JSON.parse(
    await readFile(new URL('./fixtures/frames/observe-category.json', import.meta.url), 'utf8'),
  )
  const axisName = 'a'.repeat(300)
  raw.frame.axes[0].name = axisName
  const snapshot = parseAnalysisSnapshot(raw)
  const axisFilter = snapshotFilterSchema.parse({
    filterId: 'filter',
    ref: 'frame',
    field: { kind: 'axis', name: axisName },
    label: 'Category',
  })
  assert.deepEqual(resolveSnapshotFilter(snapshot, axisFilter).options, ['east', 'south'])
  assert.equal(
    snapshotFilterSchema.safeParse({
      ...axisFilter,
      field: { kind: 'axis', name: 'a'.repeat(513) },
    }).success,
    false,
  )
})
