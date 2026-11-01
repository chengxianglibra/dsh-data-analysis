import { z } from 'zod'
import { parseTypedDataset } from './index.ts'
import { PRESENTATION_BUDGETS, type TypedDataset } from './types.ts'
import { PresentationContractError } from './values.ts'

const text = z
  .string()
  .min(1)
  .max(512)
  .refine((s) => !s.includes('\0'))
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const dtype = z.strictObject({
  type: z.enum(['string', 'boolean', 'float64', 'int64', 'decimal', 'date', 'datetime']),
  precision: count.optional(),
  scale: count.optional(),
  timeUnit: z.enum(['s', 'ms', 'us', 'ns']).optional(),
  timezone: text.optional(),
})
const slot = z.strictObject({
  id: text,
  slotId: text,
  dtype,
  nullable: z.boolean(),
  unit: text.nullable(),
})
const layout = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('field'), name: text, slotId: text }),
  z.strictObject({
    kind: z.literal('coordinate'),
    name: text,
    axisToken: text,
    endpoint: z.enum(['self', 'left', 'right']),
    // Marivo CoordinateExportColumn.part; `.start` is the actual observation start.
    part: z.enum(['key', 'label', 'start', 'end', 'nominal_start', 'nominal_end']),
  }),
])
const column = z.strictObject({
  id: text.max(256),
  label: text.max(256),
  type: dtype.shape.type,
  nullable: z.boolean(),
  unit: text.max(128).optional(),
})
// Frame metadata mirrors the presentation-kit budgets; every section is optional
// for the data result and states whether it was captured, missing or unreadable.
const bounded = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !s.includes('\0'))
const identity = bounded(2048).min(1)
const origin = z.strictObject({ kind: identity, path: identity, definitionId: identity })
const section = <T extends z.ZodTypeAny>(captured: T) =>
  z.union([
    z.strictObject({
      status: z.literal('unavailable'),
      reason: z.enum(['runtime-incompatible', 'read-failed', 'identity-mismatch', 'budget']),
    }),
    captured,
  ])
const semantics = section(
  z.strictObject({
    status: z.literal('captured'),
    columns: z
      .array(
        z.strictObject({
          role: z.enum(['value', 'presence', 'axis']),
          id: identity,
          valueOrigins: z.array(origin).max(32),
          contextOrigins: z.array(origin).max(32),
          omittedOrigins: count,
        }),
      )
      .max(PRESENTATION_BUDGETS.columns),
  }),
)

// schemaVersion 2: bounded projections of public Frame interpretation facts.
// Internal IDs are resolved at capture time to current names, axis tokens or
// indexes into this snapshot; key cells use the codec of the owning axis keys.
const cell = z.union([bounded(2000), z.boolean(), z.number(), z.null()])
const key = z.array(cell).min(1).max(PRESENTATION_BUDGETS.columns)
const instant = z.string().datetime({ offset: true })
const index = z.number().int().nonnegative().max(15)
const rowScope = z.enum(['complete', 'restricted'])
const axisEndpoint = z.enum(['self', 'left', 'right'])
const grain = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('builtin'),
    unit: z.enum(['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']),
    step: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal('named'), ref: origin, level: text }),
])
const calendarEndpoint = z.strictObject({
  kind: z.literal('calendar'),
  name: text,
  at: instant.nullable(),
  timezone: text,
  grain,
})
const intervalEndpoint = z.strictObject({
  kind: z.literal('interval'),
  name: text,
  at: instant.nullable(),
  timezone: text,
})
const timeEndpoint = z.discriminatedUnion('kind', [calendarEndpoint, intervalEndpoint])
const axisVariant = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ordinary') }),
  z.strictObject({ kind: z.literal('calendar'), timezone: text, grain }),
  z.strictObject({ kind: z.literal('interval'), timezone: text }),
  z.strictObject({ kind: z.literal('paired'), left: timeEndpoint, right: timeEndpoint }),
])
const fixedAxis = z.strictObject({
  token: text,
  name: text,
  role: z.enum(['field', 'identity']),
  keys: z.array(slot).min(1).max(PRESENTATION_BUDGETS.columns),
  key,
  origins: z.array(origin).max(32),
})
const group = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('axis'), axisToken: text }),
  z.strictObject({ kind: z.literal('fixed'), fixed: fixedAxis }),
])
const groups = z.array(group).max(32)
const valueInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('named'), name: text, subject: origin.nullable() }),
  z.strictObject({ kind: z.literal('derived'), origins: z.array(origin).max(32) }),
])
const observationTime = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('axis'), axisToken: text, endpoint: axisEndpoint }),
  z.strictObject({
    kind: z.literal('compared'),
    comparison: index,
    endpoint: z.enum(['current', 'baseline']),
  }),
  z.strictObject({ kind: z.literal('fixed'), start: instant, end: instant, timezone: text }),
])
const observationWindow = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all_history') }),
  z.strictObject({ kind: z.literal('since'), start: instant }),
  z.strictObject({ kind: z.literal('to_date'), grain }),
  z.strictObject({ kind: z.literal('trailing_duration'), seconds: z.number().positive() }),
  z.strictObject({ kind: z.literal('trailing_periods'), count: z.number().int().positive() }),
])
const valueContext = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observation'),
    subject: origin.nullable(),
    time: observationTime.nullable(),
    window: observationWindow.nullable(),
  }),
  z.strictObject({
    kind: z.literal('statistic'),
    statistic: z.enum(['sum', 'mean', 'row_count']),
    groups,
    rowScope,
  }),
  z.strictObject({
    kind: z.literal('share'),
    numerator: valueInput,
    groups,
    along: groups,
    rowScope,
  }),
  z.strictObject({
    kind: z.literal('pair_statistic'),
    statistic: z.enum(['pearson', 'spearman', 'pair_count']),
    x: valueInput,
    y: valueInput,
    groups,
    rowScope,
  }),
])
const comparison = z.strictObject({
  alias: text.nullable(),
  groups: z
    .array(
      z.strictObject({
        name: text,
        values: z
          .array(
            z.strictObject({
              role: z.enum(['current', 'baseline', 'absolute', 'relative']),
              name: text,
            }),
          )
          .max(PRESENTATION_BUDGETS.columns),
        currentContext: valueContext.nullable(),
        baselineContext: valueContext.nullable(),
      }),
    )
    .max(PRESENTATION_BUDGETS.columns),
  binding: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ordinary') }),
    z.strictObject({
      kind: z.literal('calendar'),
      axisToken: text,
      endpoint: axisEndpoint,
      baseline: calendarEndpoint,
    }),
    z.strictObject({
      kind: z.literal('interval'),
      axisToken: text,
      endpoint: axisEndpoint,
      baseline: intervalEndpoint,
    }),
  ]),
  presence: z
    .strictObject({ current: text, baseline: text, enclosing: z.array(text).max(32) })
    .nullable(),
  currentFixedAxes: z.array(fixedAxis).max(32),
  baselineFixedAxes: z.array(fixedAxis).max(32),
})
export const FRAME_DECOMPOSITION_ROLES = [
  'contribution',
  'total',
  'observed_total',
  'share',
  'value',
  'current',
  'baseline',
  'absolute',
  'numerator',
  'denominator',
  'valid_count',
  'current_present',
  'baseline_present',
  'value_present',
  'numerator_current',
  'numerator_baseline',
  'denominator_current',
  'denominator_baseline',
  'valid_count_current',
  'valid_count_baseline',
  'effect_within',
  'effect_mix',
  'effect_entry_exit',
  'effect_additive',
  'contribution_std_error',
] as const
const decomposition = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('level'), name: text, context: valueContext.nullable() }),
    z.strictObject({ kind: z.literal('absolute'), comparison: index, group: text }),
    z.strictObject({ kind: z.literal('relative'), comparison: index, group: text }),
  ]),
  groups,
  rowScope,
  outputs: z
    .array(
      z.strictObject({
        fieldKind: z.enum(['value', 'presence']),
        role: z.enum(FRAME_DECOMPOSITION_ROLES),
        name: text,
      }),
    )
    .max(PRESENTATION_BUDGETS.columns),
})
const alignmentSide = z.strictObject({
  values: z.array(text).max(PRESENTATION_BUDGETS.columns),
  presence: z.array(text).min(1).max(32),
  coordinates: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('axis'), axisToken: text, endpoint: axisEndpoint }),
        z.strictObject({ kind: z.literal('fixed'), fixed: fixedAxis }),
      ]),
    )
    .max(32),
})
const interpretation = section(
  z.strictObject({
    status: z.literal('captured'),
    fixedAxes: z.array(fixedAxis).max(32),
    valueContexts: z.record(text, valueContext),
    comparisons: z.array(comparison).max(16),
    decompositions: z.array(decomposition).max(16),
    alignments: z.array(z.strictObject({ left: alignmentSide, right: alignmentSide })).max(16),
  }),
)
const legacyCalendarPeriod = z.strictObject({
  kind: z.literal('calendar'),
  key,
  timezone: text,
  start: instant,
  end: instant,
  label: cell,
  nominalStart: instant,
  nominalEnd: instant,
})
const calendarPeriod = z.strictObject({
  kind: z.literal('calendar'),
  key,
  timezone: text,
  label: cell,
  selection: z.enum(['full', 'prefix', 'partial', 'unavailable']),
  cutoff: text.nullable(),
})
const intervalPeriod = z.strictObject({
  kind: z.literal('interval'),
  key,
  timezone: text,
  start: instant,
  end: instant,
})
const period = z.union([legacyCalendarPeriod, calendarPeriod, intervalPeriod])
const periods = section(
  z.strictObject({
    status: z.literal('captured'),
    pages: z
      .array(
        z.strictObject({
          target: z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('axis'), axisToken: text }),
            z.strictObject({ kind: z.literal('comparison'), comparison: index }),
          ]),
          totalCount: count,
          hasMore: z.boolean(),
          items: z
            .array(
              z.union([
                legacyCalendarPeriod,
                calendarPeriod,
                intervalPeriod,
                z.strictObject({
                  kind: z.literal('paired'),
                  key,
                  left: period.nullable(),
                  right: period.nullable(),
                }),
                z.strictObject({
                  kind: z.literal('comparison'),
                  key,
                  current: period,
                  baseline: period.nullable(),
                  absentReason: z.enum(['period_absent', 'cutoff_absent', 'unmatched']).nullable(),
                }),
              ]),
            )
            .max(PRESENTATION_BUDGETS.rows),
        }),
      )
      .max(PRESENTATION_BUDGETS.columns),
  }),
)
const sections = z.strictObject({
  semantics,
  interpretation,
  periods,
})
export type FrameSections = z.infer<typeof sections>
export type FrameInterpretation = Extract<FrameSections['interpretation'], { status: 'captured' }>
export type FramePeriods = Extract<FrameSections['periods'], { status: 'captured' }>
export type FrameValueContext = z.infer<typeof valueContext>
export type FrameComparison = z.infer<typeof comparison>
export type FrameDecomposition = z.infer<typeof decomposition>
export type FrameGroup = z.infer<typeof group>
export type FrameFixedAxis = z.infer<typeof fixedAxis>
export type FrameAxisVariant = z.infer<typeof axisVariant>
export type FrameGrain = z.infer<typeof grain>

const common = {
  schemaVersion: z.literal(1),
  fetchedAt: z.string().datetime({ offset: true }),
  data: z.unknown().transform((v) => parseTypedDataset(v)),
  coverage: z.strictObject({
    start: z.literal(0),
    totalRows: count,
    capturedRows: count,
    complete: z.boolean(),
    columns: z.array(text).max(PRESENTATION_BUDGETS.columns),
    business: z.literal('unknown'),
  }),
}
const schema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('dataset'),
    source: z.strictObject({ kind: z.literal('dataframe'), details: z.literal('not-captured') }),
  }),
  z.strictObject({
    ...common,
    schemaVersion: z.literal(2),
    kind: z.literal('frame'),
    // A capture_frame snapshot of a computed memory Frame has no artifact; its
    // Python source is the Host-bound codeRef, never a field of this snapshot.
    source: z.strictObject({
      kind: z.literal('frame'),
      sessionId: text,
      artifactId: text.nullable(),
    }),
    frame: z.strictObject({
      inputId: text,
      description: bounded(2000).nullable(),
      fields: z
        .array(
          z.strictObject({
            id: text,
            role: z.enum(['value', 'presence', 'coordinate']),
            slotId: text.optional(),
            axisToken: text.optional(),
          }),
        )
        .max(PRESENTATION_BUDGETS.columns),
      layout: z.array(layout).max(PRESENTATION_BUDGETS.columns),
      slots: z.array(slot).max(PRESENTATION_BUDGETS.cells),
      axes: z
        .array(
          z.strictObject({
            token: text,
            name: text,
            role: text,
            keys: z.array(slot).min(1).max(PRESENTATION_BUDGETS.columns),
            variant: axisVariant,
          }),
        )
        .max(PRESENTATION_BUDGETS.columns),
      coordinates: z.record(
        text,
        z.strictObject({
          column,
          values: z
            .array(z.union([z.string(), z.boolean(), z.number(), z.null()]))
            .max(PRESENTATION_BUDGETS.rows),
        }),
      ),
      readStats: z.strictObject({
        dataRowsRead: count,
        coordinateRowsRead: count,
        receiptBytesHashed: count,
      }),
      sections,
    }),
  }),
])

export type AnalysisSnapshot = z.infer<typeof schema>
export type FrameSnapshot = Extract<AnalysisSnapshot, { kind: 'frame' }>
export type DatasetSnapshot = Extract<AnalysisSnapshot, { kind: 'dataset' }>

export function parseAnalysisSnapshot(value: unknown): AnalysisSnapshot {
  const invalid = (): never => {
    throw new PresentationContractError(
      'invalid_snapshot',
      '/snapshot',
      'Snapshot structure, identity or coverage is invalid.',
    )
  }
  let result: AnalysisSnapshot
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > PRESENTATION_BUDGETS.datasetBytes)
      invalid()
    result = schema.parse(value)
  } catch {
    return invalid()
  }
  const { data, coverage } = result
  if (
    coverage.totalRows !== data.rowCount ||
    coverage.capturedRows !== data.rows.length ||
    coverage.complete !== !data.truncated ||
    JSON.stringify(coverage.columns) !== JSON.stringify(data.columns.map((c) => c.id))
  )
    invalid()
  if (result.kind === 'frame') {
    const frame = result.frame
    const unique = (values: string[]) => new Set(values).size === values.length
    const slots = new Map(frame.slots.map((s) => [s.slotId, s]))
    const keys = frame.axes.flatMap((a) => a.keys)
    if (
      !unique(frame.slots.map((s) => s.slotId)) ||
      !unique(frame.axes.map((a) => a.token)) ||
      !unique(keys.map((s) => s.slotId)) ||
      frame.layout.length !== data.columns.length ||
      frame.fields.length !== frame.layout.length ||
      keys.length !== Object.keys(frame.coordinates).length
    )
      invalid()
    for (const [i, item] of frame.layout.entries()) {
      const field = frame.fields[i]!
      if (item.name !== data.columns[i]!.id || field.id !== item.name) invalid()
      if (item.kind === 'field') {
        const source = slots.get(item.slotId)
        if (
          !source ||
          source.dtype.type !== data.columns[i]!.type ||
          source.nullable !== data.columns[i]!.nullable ||
          field.slotId !== item.slotId ||
          field.axisToken !== undefined ||
          field.role === 'coordinate'
        )
          invalid()
      } else if (
        !frame.axes.some((a) => a.token === item.axisToken) ||
        field.axisToken !== item.axisToken ||
        field.role !== 'coordinate' ||
        field.slotId !== undefined
      )
        invalid()
    }
    for (const key of keys) {
      const coordinate = frame.coordinates[key.slotId]
      if (!coordinate) return invalid()
      if (
        JSON.stringify(slots.get(key.slotId)) !== JSON.stringify(key) ||
        coordinate.column.id !== key.id ||
        coordinate.column.type !== key.dtype.type ||
        coordinate.column.nullable !== key.nullable ||
        coordinate.values.length !== data.rows.length
      )
        invalid()
      try {
        parseTypedDataset({
          schemaVersion: 1,
          columns: [coordinate.column],
          rows: coordinate.values.map((v) => [v]),
          rowCount: data.rows.length,
          limit: data.limit,
          truncated: false,
        } satisfies TypedDataset)
      } catch {
        invalid()
      }
    }
    if (data.rows.length * (data.columns.length + keys.length) > PRESENTATION_BUDGETS.cells)
      invalid()
    validateInterpretation(frame, invalid)
  }
  return result
}

export type FrameSnapshotV2 = FrameSnapshot
/** Narrows the current snapshot union to a captured Frame. */
export function isFrameSnapshotV2(snapshot: AnalysisSnapshot): snapshot is FrameSnapshotV2 {
  return snapshot.kind === 'frame' && snapshot.schemaVersion === 2
}

function validateInterpretation(frame: FrameSnapshotV2['frame'], invalid: () => never) {
  const tokens = new Set(frame.axes.map((a) => a.token))
  const keyWidth = new Map(frame.axes.map((a) => [a.token, a.keys.length]))
  const axis = (token: string) => {
    if (!tokens.has(token)) invalid()
  }
  const fixed = (item: FrameFixedAxis) => {
    if (item.key.length !== item.keys.length) invalid()
  }
  const groupsOf = (items: FrameGroup[]) => {
    for (const g of items) g.kind === 'axis' ? axis(g.axisToken) : fixed(g.fixed)
  }
  const section = frame.sections.interpretation
  const comparisons =
    typeof section === 'object' && section.status === 'captured' ? section.comparisons.length : 0
  const context = (c: FrameValueContext | null) => {
    if (!c) return
    if (c.kind === 'observation') {
      if (c.time?.kind === 'axis') axis(c.time.axisToken)
      if (c.time?.kind === 'compared' && c.time.comparison >= comparisons) invalid()
    } else {
      groupsOf(c.groups)
      if (c.kind === 'share') groupsOf(c.along)
    }
  }
  if (typeof section === 'object' && section.status === 'captured') {
    section.fixedAxes.forEach(fixed)
    Object.values(section.valueContexts).forEach(context)
    for (const item of section.comparisons) {
      item.currentFixedAxes.forEach(fixed)
      item.baselineFixedAxes.forEach(fixed)
      if (item.binding.kind !== 'ordinary') axis(item.binding.axisToken)
      for (const g of item.groups) {
        context(g.currentContext)
        context(g.baselineContext)
      }
    }
    for (const item of section.decompositions) {
      groupsOf(item.groups)
      if (item.target.kind === 'level') context(item.target.context)
      else if (
        item.target.comparison >= comparisons ||
        !section.comparisons[item.target.comparison]!.groups.some(
          (g) => g.name === (item.target as { group: string }).group,
        )
      )
        invalid()
    }
    for (const item of section.alignments)
      for (const side of [item.left, item.right])
        for (const c of side.coordinates) c.kind === 'axis' ? axis(c.axisToken) : fixed(c.fixed)
  }
  const periods = frame.sections.periods
  if (typeof periods === 'object' && periods.status === 'captured') {
    let items = 0
    for (const page of periods.pages) {
      items += page.items.length
      if (page.items.length > page.totalCount) invalid()
      if (page.target.kind === 'axis') axis(page.target.axisToken)
      else if (page.target.comparison >= comparisons) invalid()
      const width = page.target.kind === 'axis' ? keyWidth.get(page.target.axisToken) : undefined
      if (width !== undefined && page.items.some((p) => p.key.length !== width)) invalid()
    }
    if (items > PRESENTATION_BUDGETS.rows) invalid()
  }
}
