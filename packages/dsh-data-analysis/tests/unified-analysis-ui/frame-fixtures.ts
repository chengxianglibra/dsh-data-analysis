import {
  type FrameAxisVariant,
  type FrameComparison,
  type FrameDecomposition,
  type FrameGroup,
  type FrameInterpretation,
  type FramePeriods,
  type FrameSnapshotV2,
  type FrameValueContext,
  isFrameSnapshotV2,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import type { Cell, ColumnType } from '../../src/presentation/contracts/types.ts'

/** One-key axis; the token is `t_<name>` so tests can tell names from tokens. */
export interface AxisSpec {
  name: string
  role?: 'field' | 'identity'
  variant?: FrameAxisVariant
  type?: ColumnType
  keys: Cell[]
}
export interface ValueSpec {
  name: string
  type?: ColumnType
  values: Cell[]
  presence?: boolean
  context?: FrameValueContext
}
export interface FrameSpec {
  axes?: AxisSpec[]
  values?: ValueSpec[]
  /** Total rows in the Frame; more than the written rows makes the snapshot incomplete. */
  totalRows?: number
  comparisons?: FrameComparison[]
  decompositions?: FrameDecomposition[]
  alignments?: FrameInterpretation['alignments']
  periods?: FramePeriods['pages']
}

export const token = (name: string) => `t_${name}`
const TIMEZONE = 'Asia/Shanghai'
export const ordinary: FrameAxisVariant = { kind: 'ordinary' }
export const calendar: FrameAxisVariant = {
  kind: 'calendar',
  timezone: TIMEZONE,
  grain: { kind: 'builtin', unit: 'month', step: 1 },
}
export const interval: FrameAxisVariant = { kind: 'interval', timezone: TIMEZONE }
export const paired: FrameAxisVariant = {
  kind: 'paired',
  left: {
    kind: 'calendar',
    name: 'left',
    at: null,
    timezone: TIMEZONE,
    grain: { kind: 'builtin', unit: 'month', step: 1 },
  },
  right: {
    kind: 'calendar',
    name: 'right',
    at: null,
    timezone: TIMEZONE,
    grain: { kind: 'builtin', unit: 'month', step: 1 },
  },
}

/** Month starts as datetime keys, 2025-01 onwards. */
export function months(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const year = 2025 + Math.floor(i / 12)
    return `${year}-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00+08:00`
  })
}
export const labels = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`)
export const numbers = (count: number, start = 1) =>
  Array.from({ length: count }, (_, i) => start + i)
export const repeat = <T>(items: T[], times: number) =>
  Array.from({ length: items.length * times }, (_, i) => items[Math.floor(i / times)]!)
export const cycle = <T>(items: T[], times: number) =>
  Array.from({ length: items.length * times }, (_, i) => items[i % items.length]!)

export const timeAxis = (count: number, variant: FrameAxisVariant = calendar): AxisSpec => ({
  name: 'month',
  variant,
  type: 'datetime',
  keys: months(count),
})
export const categoryAxis = (count: number, role: 'field' | 'identity' = 'field'): AxisSpec => ({
  name: 'region',
  role,
  keys: labels('r', count),
})
export const value = (name: string, count: number, context?: FrameValueContext): ValueSpec => ({
  name,
  type: 'float64',
  values: numbers(count),
  ...(context ? { context } : {}),
})

export const axisGroups = (...names: string[]): FrameGroup[] =>
  names.map((name) => ({ kind: 'axis', axisToken: token(name) }))
export const observed = (): FrameValueContext => ({
  kind: 'observation',
  subject: null,
  time: null,
  window: { kind: 'trailing_periods', count: 12 },
})
export const statistic = (
  kind: 'sum' | 'mean' | 'row_count',
  groups: FrameGroup[],
  rowScope: 'complete' | 'restricted' = 'complete',
): FrameValueContext => ({ kind: 'statistic', statistic: kind, groups, rowScope })
export const pairStatistic = (
  kind: 'pearson' | 'spearman' | 'pair_count',
  groups: FrameGroup[],
): FrameValueContext => ({
  kind: 'pair_statistic',
  statistic: kind,
  x: { kind: 'named', name: 'revenue', subject: null },
  y: { kind: 'named', name: 'orders', subject: null },
  groups,
  rowScope: 'complete',
})
export const shareOf = (along: FrameGroup[]): FrameValueContext => ({
  kind: 'share',
  numerator: { kind: 'named', name: 'revenue', subject: null },
  groups: [],
  along,
  rowScope: 'complete',
})

type Role = FrameComparison['groups'][number]['values'][number]['role']
export function comparisonOf(
  binding: FrameComparison['binding'],
  groups: { name: string; values: [Role, string][] }[],
): FrameComparison {
  return {
    alias: null,
    groups: groups.map((g) => ({
      name: g.name,
      values: g.values.map(([role, name]) => ({ role, name })),
      currentContext: null,
      baselineContext: null,
    })),
    binding,
    presence: null,
    currentFixedAxes: [],
    baselineFixedAxes: [],
  }
}
export const calendarBinding = (axis = 'month'): FrameComparison['binding'] => ({
  kind: 'calendar',
  axisToken: token(axis),
  endpoint: 'self',
  baseline: {
    kind: 'calendar',
    name: 'baseline',
    at: null,
    timezone: TIMEZONE,
    grain: { kind: 'builtin', unit: 'month', step: 1 },
  },
})
/** current/baseline/absolute/relative for `sales`, as compare names them. */
export const comparedValues = (name: string, count: number, roles: Role[] = ROLES) =>
  roles.map((role) => value(role === 'current' ? name : `prior.${role}.${name}`, count))
export const comparedRoles = (name: string, roles: Role[] = ROLES): [Role, string][] =>
  roles.map((role) => [role, role === 'current' ? name : `prior.${role}.${name}`])
const ROLES: Role[] = ['current', 'baseline', 'absolute', 'relative']

type OutputRole = FrameDecomposition['outputs'][number]['role']
export function decompositionOf(
  outputs: [OutputRole, string][],
  options: { groups?: FrameGroup[]; rowScope?: 'complete' | 'restricted' } = {},
): FrameDecomposition {
  return {
    target: { kind: 'level', name: 'revenue', context: observed() },
    groups: options.groups ?? [],
    rowScope: options.rowScope ?? 'complete',
    outputs: outputs.map(([role, name]) => ({ fieldKind: 'value', role, name })),
  }
}

/** read_periods page for an axis with `total` periods, of which the first `items` are written. */
export function axisPeriods(axis: string, total: number, items = total): FramePeriods['pages'] {
  return [
    {
      target: { kind: 'axis', axisToken: token(axis) },
      totalCount: total,
      hasMore: items < total,
      items: months(items).map((start, i) => {
        const end = months(items + 1)[i + 1]!
        return {
          kind: 'calendar',
          key: [start],
          timezone: TIMEZONE,
          start,
          end,
          label: start.slice(0, 7),
          nominalStart: start,
          nominalEnd: end,
        }
      }),
    },
  ]
}

/**
 * Build a schemaVersion 2 Frame snapshot and validate it with parseAnalysisSnapshot.
 * Coordinate key columns come first in axis order, then value and presence fields.
 */
export function frame(spec: FrameSpec): FrameSnapshotV2 {
  const axes = spec.axes ?? []
  const values = spec.values ?? []
  const rows = axes[0]?.keys.length ?? values[0]?.values.length ?? 1
  const total = spec.totalRows ?? rows
  const columns: { id: string; label: string; type: ColumnType; nullable: boolean }[] = []
  const layout: unknown[] = []
  const fields: unknown[] = []
  const slots: unknown[] = []
  const coordinates: Record<string, unknown> = {}
  const frameAxes: unknown[] = []
  for (const axis of axes) {
    const type = axis.type ?? 'string'
    const key = {
      id: axis.name,
      slotId: `k_${axis.name}`,
      dtype: { type },
      nullable: false,
      unit: null,
    }
    const column = { id: axis.name, label: axis.name, type, nullable: false }
    slots.push(key)
    columns.push(column)
    layout.push({
      kind: 'coordinate',
      name: axis.name,
      axisToken: token(axis.name),
      endpoint: 'self',
      part: 'key',
    })
    fields.push({ id: axis.name, role: 'coordinate', axisToken: token(axis.name) })
    coordinates[key.slotId] = { column, values: axis.keys }
    frameAxes.push({
      token: token(axis.name),
      name: axis.name,
      role: axis.role ?? 'field',
      keys: [key],
      variant: axis.variant ?? ordinary,
    })
  }
  const valueContexts: Record<string, FrameValueContext> = {}
  for (const item of values) {
    const type = item.type ?? 'float64'
    const nullable = item.values.includes(null)
    const slotId = `v_${item.name}`
    slots.push({ id: item.name, slotId, dtype: { type }, nullable, unit: null })
    columns.push({ id: item.name, label: item.name, type, nullable })
    layout.push({ kind: 'field', name: item.name, slotId })
    fields.push({ id: item.name, role: item.presence ? 'presence' : 'value', slotId })
    if (item.context) valueContexts[item.name] = item.context
  }
  const data = {
    schemaVersion: 1,
    columns,
    rows: Array.from({ length: rows }, (_, i) => [
      ...axes.map((a) => a.keys[i]!),
      ...values.map((v) => v.values[i]!),
    ]),
    rowCount: total,
    limit: Math.max(rows, 1),
    truncated: total > rows,
  }
  const snapshot = parseAnalysisSnapshot({
    schemaVersion: 2,
    kind: 'frame',
    fetchedAt: '2026-10-30T00:00:00Z',
    data,
    coverage: {
      start: 0,
      totalRows: total,
      capturedRows: rows,
      complete: total === rows,
      columns: columns.map((c) => c.id),
      business: 'unknown',
    },
    source: { kind: 'frame', sessionId: 'session', artifactId: null },
    frame: {
      inputId: 'input',
      description: null,
      fields,
      layout,
      slots,
      axes: frameAxes,
      coordinates,
      readStats: { dataRowsRead: rows, coordinateRowsRead: rows, receiptBytesHashed: 0 },
      sections: {
        semantics: 'not-captured',
        interpretation: {
          status: 'captured',
          fixedAxes: [],
          valueContexts,
          comparisons: spec.comparisons ?? [],
          decompositions: spec.decompositions ?? [],
          alignments: spec.alignments ?? [],
        },
        periods: spec.periods ? { status: 'captured', pages: spec.periods } : 'not-captured',
      },
    },
  })
  if (!isFrameSnapshotV2(snapshot)) throw new Error('frame-v2-required')
  return snapshot
}

// One builder per row of the design's operation table.

/** session.observe with `by=()`; `count` named Metric values. */
export const observeScalar = (count = 1) =>
  frame({ values: labels('m', count).map((name) => value(name, 1, observed())) })
/** session.observe by a calendar or interval axis. */
export const observeTime = (
  periods: number,
  valueCount = 1,
  variant: FrameAxisVariant = calendar,
) =>
  frame({
    axes: [timeAxis(periods, variant)],
    values: labels('m', valueCount).map((name) => value(name, periods, observed())),
  })
/** session.observe by a field axis; `total` above `rows` leaves the snapshot incomplete. */
export const observeCategory = (rows: number, total = rows) =>
  frame({
    axes: [categoryAxis(rows)],
    values: [value('revenue', rows, observed())],
    totalRows: total,
  })
/** session.observe by month and region. */
export const observeTimeCategory = (categories: number, valueCount = 1) => {
  const periods = 3
  return frame({
    axes: [
      { ...timeAxis(periods), keys: repeat(months(periods), categories) },
      { ...categoryAxis(categories), keys: cycle(labels('r', categories), periods) },
    ],
    values: labels('m', valueCount).map((name) => value(name, periods * categories, observed())),
  })
}
/** session.observe by two field axes. */
export const observeMatrix = (valueCount = 1) =>
  frame({
    axes: [
      { name: 'region', keys: repeat(['a', 'b'], 2) },
      { name: 'channel', keys: cycle(['x', 'y'], 2) },
    ],
    values: labels('m', valueCount).map((name) => value(name, 4, observed())),
  })
/** reduce by month: the statistic groups equal every remaining axis. */
export const reduceByMonth = () =>
  frame({
    axes: [timeAxis(6)],
    values: [
      value('total', 6, statistic('sum', axisGroups('month'))),
      value('average', 6, statistic('mean', axisGroups('month'))),
      {
        name: 'rows',
        type: 'int64',
        values: numbers(6).map(String),
        context: statistic('row_count', axisGroups('month')),
      },
    ],
  })
/** select with `over(by=())`: a partition statistic broadcast to every month. */
export const overBroadcast = (periods = 6) =>
  frame({
    axes: [timeAxis(periods)],
    values: [
      value('revenue', periods, observed()),
      { name: 'mean_revenue', values: Array(periods).fill(3), context: statistic('mean', []) },
    ],
  })
/** correlate by region: coefficient and n_pairs share x, y, groups and row scope. */
export const correlate = (by: boolean, method: 'pearson' | 'spearman' = 'pearson') => {
  const rows = by ? 3 : 1
  const groups = by ? axisGroups('region') : []
  return frame({
    ...(by ? { axes: [categoryAxis(rows)] } : {}),
    values: [
      {
        name: 'coefficient',
        values: Array(rows).fill(0.5),
        context: pairStatistic(method, groups),
      },
      {
        name: 'n_pairs',
        type: 'int64',
        values: Array(rows).fill('30'),
        context: pairStatistic('pair_count', groups),
      },
    ],
  })
}
/** select with `share(along=region)`. */
export const shareByRegion = (rows = 3, total = rows) =>
  frame({
    axes: [categoryAxis(rows)],
    values: [
      value('revenue', rows, observed()),
      {
        name: 'revenue_share',
        values: Array(rows).fill(0.25),
        context: shareOf(axisGroups('region')),
      },
    ],
    totalRows: total,
  })
/** align two observations; `pairedAxis` makes the paired time axis. */
/** Observation of one metric; align pairs left/right values only by this subject. */
export const observedMetric = (path: string): FrameValueContext => ({
  kind: 'observation',
  subject: { kind: 'metric', path, definitionId: `sha256:${path}` },
  time: null,
  window: { kind: 'trailing_periods', count: 12 },
})
/** align two observations; `rightMetrics` overrides the right side's subjects. */
export const align = (axis: AxisSpec, rightMetrics = ['sales.revenue', 'sales.order_count']) => {
  const rows = axis.keys.length
  const side = (prefix: string) => ({
    values: [`${prefix}.revenue`, `${prefix}.orders`],
    presence: [`${prefix}_present`],
    coordinates: [
      { kind: 'axis' as const, axisToken: token(axis.name), endpoint: 'self' as const },
    ],
  })
  return frame({
    axes: [axis],
    values: [
      value('left.revenue', rows, observedMetric('sales.revenue')),
      value('left.orders', rows, observedMetric('sales.order_count')),
      value('right.revenue', rows, observedMetric(rightMetrics[0]!)),
      value('right.orders', rows, observedMetric(rightMetrics[1]!)),
      { name: 'left_present', type: 'boolean', values: Array(rows).fill(true), presence: true },
      { name: 'right_present', type: 'boolean', values: Array(rows).fill(true), presence: true },
    ],
    alignments: [{ left: side('left'), right: side('right') }],
  })
}
/** compare against the previous year on the calendar axis. */
export const compareCalendar = (periods = 6, roles?: Role[]) =>
  frame({
    axes: [timeAxis(periods)],
    values: comparedValues('sales', periods, roles),
    comparisons: [
      comparisonOf(calendarBinding(), [{ name: 'sales', values: comparedRoles('sales', roles) }]),
    ],
  })
/** One saved calendar row comparing two metrics: the transposed comparison table. */
export function comparedSinglePeriodMultiGroup() {
  return frame({
    axes: [timeAxis(1)],
    values: [...comparedValues('sales', 1), ...comparedValues('orders', 1)],
    comparisons: [
      comparisonOf(calendarBinding(), [
        { name: 'sales', values: comparedRoles('sales') },
        { name: 'orders', values: comparedRoles('orders') },
      ]),
    ],
  })
}

/** One saved interval row comparing two metrics; endpoints are civil months in New York. */
export function comparedIntervalMonth() {
  const timezone = 'America/New_York'
  const current = {
    kind: 'interval' as const,
    key: ['2025-06-01T00:00:00-04:00'],
    timezone,
    start: '2025-06-01T00:00:00-04:00',
    end: '2025-07-01T00:00:00-04:00',
  }
  const baseline = {
    kind: 'interval' as const,
    key: ['2025-05-01T00:00:00-04:00'],
    timezone,
    start: '2025-05-01T00:00:00-04:00',
    end: '2025-06-01T00:00:00-04:00',
  }
  return frame({
    axes: [{ ...timeAxis(1, { kind: 'interval', timezone }), keys: [current.start] }],
    values: [...comparedValues('sales', 1), ...comparedValues('orders', 1)],
    comparisons: [
      comparisonOf(
        {
          kind: 'interval',
          axisToken: token('month'),
          endpoint: 'self',
          baseline: { kind: 'interval', name: 'baseline', at: null, timezone },
        },
        [
          { name: 'sales', values: comparedRoles('sales') },
          { name: 'orders', values: comparedRoles('orders') },
        ],
      ),
    ],
    periods: [
      {
        target: { kind: 'comparison', comparison: 0 },
        totalCount: 1,
        hasMore: false,
        items: [{ kind: 'comparison', key: current.key, current, baseline, absentReason: null }],
      },
    ],
  })
}

/** compare two fixed regions by channel (ordinary binding). */
export const compareOrdinary = (axes: AxisSpec[], roles?: Role[]) => {
  const rows = axes[0]?.keys.length ?? 1
  return frame({
    axes,
    values: [...comparedValues('sales', rows, roles), value('orders', rows, observed())],
    comparisons: [
      comparisonOf({ kind: 'ordinary' }, [
        { name: 'sales', values: comparedRoles('sales', roles) },
      ]),
    ],
  })
}
/** attribute with an additive rule by region. */
export const attributeAdditive = (
  options: { total?: number; rowScope?: 'complete' | 'restricted' } = {},
) => {
  const rows = 4
  return frame({
    axes: [categoryAxis(rows)],
    values: [
      value('contribution', rows),
      { name: 'total', values: Array(rows).fill(10) },
      { name: 'observed_total', values: Array(rows).fill(10) },
    ],
    decompositions: [
      decompositionOf(
        [
          ['contribution', 'contribution'],
          ['total', 'total'],
          ['observed_total', 'observed_total'],
        ],
        options.rowScope ? { rowScope: options.rowScope } : {},
      ),
    ],
    totalRows: options.total ?? rows,
  })
}
/** attribute with a rate/mix rule: effect columns per region. */
export const attributeEffects = (total?: number) => {
  const rows = 3
  return frame({
    axes: [categoryAxis(rows)],
    values: [
      value('contribution', rows),
      { name: 'total', values: Array(rows).fill(6) },
      value('effect_within', rows),
      value('effect_mix', rows),
    ],
    decompositions: [
      decompositionOf([
        ['contribution', 'contribution'],
        ['total', 'total'],
        ['effect_within', 'effect_within'],
        ['effect_mix', 'effect_mix'],
      ]),
    ],
    ...(total === undefined ? {} : { totalRows: total }),
  })
}
/** attribute with contribution_share, for `style: "share"`. */
export const attributeShare = (total?: number) => {
  const rows = 3
  return frame({
    axes: [categoryAxis(rows)],
    values: [
      value('contribution', rows),
      { name: 'total', values: Array(rows).fill(6) },
      { name: 'contribution_share', values: [0.2, 0.3, 0.5] },
    ],
    decompositions: [
      decompositionOf([
        ['contribution', 'contribution'],
        ['total', 'total'],
        ['share', 'contribution_share'],
      ]),
    ],
    ...(total === undefined ? {} : { totalRows: total }),
  })
}
/** attribute a calendar comparison: the change target keeps the comparison facts. */
export const attributeChange = () => {
  const rows = 3
  const comparison = comparisonOf(calendarBinding(), [{ name: 'sales', values: [] }])
  return frame({
    axes: [timeAxis(rows)],
    values: [value('contribution', rows), { name: 'total', values: Array(rows).fill(6) }],
    comparisons: [comparison],
    decompositions: [
      {
        ...decompositionOf([
          ['contribution', 'contribution'],
          ['total', 'total'],
        ]),
        target: { kind: 'absolute', comparison: 0, group: 'sales' },
        groups: axisGroups('month'),
      },
    ],
  })
}
/** where/top after reduce: restricted statistics over fewer rows. */
export const whereRestricted = () =>
  frame({
    axes: [categoryAxis(3)],
    values: [value('total', 3, statistic('sum', axisGroups('region'), 'restricted'))],
    totalRows: 3,
  })
/** session.frame: a Population with no values. */
export const members = () => frame({ axes: [categoryAxis(3, 'identity')] })
/** session.read: entity attributes on an identity axis. */
export const records = () =>
  frame({
    axes: [categoryAxis(3, 'identity')],
    values: [{ name: 'name', type: 'string', values: ['a', 'b', 'c'] }, value('age', 3)],
  })
/** align on two calendar axes yields a paired axis. */
export const pairedAxis = (count = 3): AxisSpec => ({
  name: 'period',
  variant: paired,
  keys: labels('p', count),
})
