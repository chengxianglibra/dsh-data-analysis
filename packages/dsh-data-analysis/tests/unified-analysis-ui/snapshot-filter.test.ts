import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isSnapshotFilterSelectionValid,
  resolveSnapshotFilter,
  resolveSnapshotFilterBinding,
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
  assert.throws(
    () =>
      validateAnalysisResources(
        program('f, v').replace('{chart: "table"}', '{chart: "table", columns: ["missing"]}'),
        resources,
      ),
    (error) => {
      assert(error instanceof AnalysisViewError)
      assert.equal(error.code, 'analysis-columns-invalid')
      assert.equal(error.path, 'v/view/columns/0')
      assert(error.details.candidates?.includes('category'))
      return true
    },
  )
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

test('shared day and date ranges project saved rows across resources', () => {
  const days = Array.from(
    { length: 7 },
    (_, index) => `2026-11-${String(index + 7).padStart(2, '0')}`,
  )
  const daily = datasetSnapshot(
    days.map((day) => [day]),
    [{ id: 'day', label: 'Day', type: 'string', nullable: false }],
  )
  const hourly = datasetSnapshot(
    days.flatMap((day, index) =>
      Array.from({ length: index === 6 ? 14 : 24 }, (_, hour) => [
        day,
        `${day}T${String(hour).padStart(2, '0')}:00:00+08:00`,
      ]),
    ),
    [
      { id: 'business_day', label: 'Day', type: 'string', nullable: false },
      { id: 'timestamp', label: 'Time', type: 'datetime', nullable: false },
    ],
  )
  const day = resolveSnapshotFilter(daily, {
    filterId: 'day',
    ref: 'daily',
    field: { kind: 'column', name: 'day' },
    label: 'Day',
    options: { allowAll: false, defaultPolicy: 'latest' },
  })
  assert.deepEqual(day.defaultValues, ['2026-11-13'])
  const dayBinding = resolveSnapshotFilterBinding(hourly, day, {
    kind: 'column',
    name: 'business_day',
  })
  assert.deepEqual(
    visibleSnapshotRows(158, [{ ...dayBinding, selected: day.defaultValues }]),
    Array.from({ length: 14 }, (_, i) => 144 + i),
  )

  const range = resolveSnapshotFilter(daily, {
    filterId: 'range',
    ref: 'daily',
    field: { kind: 'column', name: 'day' },
    label: 'Range',
    mode: 'date-range',
    options: { defaultPolicy: 'latest' },
  })
  assert.deepEqual(range.defaultValues, ['2026-11-13', '2026-11-13'])
  const time = resolveSnapshotFilterBinding(hourly, range, { kind: 'column', name: 'timestamp' })
  assert.deepEqual(
    visibleSnapshotRows(158, [
      { ...time, mode: 'date-range', selected: ['2026-11-12', '2026-11-13'] },
    ]),
    Array.from({ length: 38 }, (_, i) => 120 + i),
  )
  assert.equal(isSnapshotFilterSelectionValid(range, ['2026-11-13', '2026-11-13']), true)
  assert.equal(isSnapshotFilterSelectionValid(range, ['2026-11-13', '2026-11-12']), false)
  assert.equal(isSnapshotFilterSelectionValid(day, []), false)
  assert.throws(
    () => resolveSnapshotFilterBinding(hourly, day, { kind: 'column', name: 'timestamp' }),
    /analysis-filter-field-invalid/,
  )
})

test('dimension combinations use AND across filters', () => {
  const data = datasetSnapshot(
    [
      ['2026-11-12', 'east', 'A'],
      ['2026-11-12', 'east', 'B'],
      ['2026-11-12', 'south', 'C'],
      ['2026-11-13', 'east', 'A'],
      ['2026-11-13', 'east', 'B'],
      ['2026-11-13', 'south', 'C'],
    ],
    ['day', 'region', 'cluster'].map((id) => ({
      id,
      label: id,
      type: 'string' as const,
      nullable: false,
    })),
  )
  const filter = (name: string, mode: 'multiple' | 'date-range') =>
    resolveSnapshotFilter(data, {
      filterId: name,
      ref: 'data',
      field: { kind: 'column', name },
      label: name,
      mode,
    })
  const region = filter('region', 'multiple')
  const cluster = filter('cluster', 'multiple')
  const day = filter('day', 'date-range')
  const select = (regions: string[], dates: string[]) =>
    visibleSnapshotRows(6, [
      { values: region.values, selected: regions },
      { values: cluster.values, selected: ['A', 'B'] },
      { values: day.values, selected: dates, mode: 'date-range' },
    ])
  assert.deepEqual(select(['east'], []), [0, 1, 3, 4])
  assert.deepEqual(select(['east'], ['2026-11-13', '2026-11-13']), [3, 4])
  assert.deepEqual(select(['south'], []), [])
})

test('range validates the entire date domain and uses each saved datetime offset', () => {
  const columns = [{ id: 'date', label: 'Date', type: 'string' as const, nullable: true }]
  const decl = {
    filterId: 'd',
    ref: 'data',
    field: { kind: 'column' as const, name: 'date' },
    label: 'Date',
  }
  for (const invalid of ['2026-02-30', '2026-1-03', '']) {
    const data = datasetSnapshot([['2026-11-13'], [invalid], [null]], columns)
    assert.throws(
      () => resolveSnapshotFilter(data, { ...decl, mode: 'date-range' }),
      /analysis-filter-date-invalid/,
    )
    assert.throws(
      () => resolveSnapshotFilter(data, { ...decl, options: { defaultPolicy: 'latest' } }),
      /analysis-filter-default-invalid/,
    )
  }
  const nullable = datasetSnapshot([[null], ['2026-11-12'], ['2026-11-13']], columns)
  assert.deepEqual(
    resolveSnapshotFilter(nullable, { ...decl, options: { defaultPolicy: 'latest' } })
      .defaultValues,
    ['2026-11-13'],
  )
  assert.throws(
    () =>
      resolveSnapshotFilter(datasetSnapshot([[null]], columns), {
        ...decl,
        options: { defaultPolicy: 'latest' },
      }),
    /analysis-filter-default-invalid/,
  )
  const moments = datasetSnapshot(
    [['2026-11-13T00:30:00+08:00'], ['2026-11-12T16:30:00+00:00']],
    [{ ...columns[0]!, type: 'datetime' }],
  )
  const range = resolveSnapshotFilter(moments, { ...decl, mode: 'date-range' })
  assert.deepEqual(range.values, ['2026-11-13', '2026-11-12'])
  assert.deepEqual(
    visibleSnapshotRows(2, [
      { values: range.values, mode: 'date-range', selected: ['2026-11-13', '2026-11-13'] },
    ]),
    [0],
  )
})

test('calendar ranges interpret UTC keys in the axis timezone and reject unsupported grains', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parseAnalysisSnapshot } = await import('../../src/presentation/contracts/snapshot.ts')
  const raw = await readFile(
    new URL('./fixtures/frames/over-broadcast.json', import.meta.url),
    'utf8',
  )
  const frame = parseAnalysisSnapshot(JSON.parse(raw))
  if (frame.kind !== 'frame') throw new Error('Frame fixture required')
  const axis = frame.frame.axes[0]!
  if (axis.variant.kind !== 'calendar') throw new Error('Calendar axis required')
  axis.variant.grain = { kind: 'builtin', unit: 'hour', step: 1 }
  axis.variant.timezone = 'America/Los_Angeles'
  const declaration = {
    filterId: 'date',
    ref: 'frame',
    field: { kind: 'axis' as const, name: axis.name },
    label: 'Date',
    mode: 'date-range' as const,
  }
  const resolved = resolveSnapshotFilter(frame, declaration)
  assert.equal(resolved.values[0], '2026-06-30')
  assert.equal(resolved.calendarTimezone, 'America/Los_Angeles')
  const utc = structuredClone(frame)
  const utcAxis = utc.frame.axes[0]!
  if (utcAxis.variant.kind !== 'calendar') throw new Error('Calendar axis required')
  utcAxis.variant.timezone = 'UTC'
  assert.throws(
    () => resolveSnapshotFilterBinding(utc, resolved, declaration.field),
    /analysis-filter-calendar-invalid/,
  )
  axis.variant.grain = { kind: 'builtin', unit: 'hour', step: 2 }
  assert.throws(() => resolveSnapshotFilter(frame, declaration), /analysis-filter-calendar-invalid/)
  axis.variant.grain = { kind: 'builtin', unit: 'month', step: 1 }
  assert.throws(() => resolveSnapshotFilter(frame, declaration), /analysis-filter-calendar-invalid/)
})
