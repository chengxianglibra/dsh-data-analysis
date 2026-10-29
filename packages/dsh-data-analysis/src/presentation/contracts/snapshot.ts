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
    part: z.enum(['key', 'label', 'start', 'end', 'actual_start', 'actual_end', 'timezone']),
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
const display = bounded(2000).nullable()
const fact = z.strictObject({ name: bounded(512), value: display })
const facts = z.array(fact).max(32)
const scope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('row'), rowIndex: count }),
  z.strictObject({ kind: z.enum(['row-unmatched', 'partial', 'unscoped', 'unresolved']) }),
])
const recordCoordinates = z
  .array(z.strictObject({ slotId: identity, name: bounded(512).nullable(), value: display }))
  .max(32)
const truncated = z.literal(true).optional()
const auditPage = <T extends z.ZodTypeAny>(item: T) =>
  z.strictObject({
    status: z.literal('captured'),
    totalCount: count,
    hasMore: z.boolean(),
    items: z.array(item).max(20),
  })
const origin = z.strictObject({ kind: identity, path: identity, definitionId: identity })
const section = <T extends z.ZodTypeAny>(captured: T) =>
  z.union([
    // Snapshots saved before P4 recorded every section as not captured.
    z.literal('not-captured'),
    z.strictObject({
      status: z.literal('unavailable'),
      reason: z.enum(['runtime-incompatible', 'read-failed', 'identity-mismatch', 'budget']),
    }),
    captured,
  ])
const sections = z.strictObject({
  evidence: section(
    auditPage(
      z.strictObject({
        kind: z.enum(['declaration', 'read', 'check']),
        summary: bounded(4096).min(1),
        values: facts,
        coordinates: recordCoordinates,
        scope,
        truncated,
      }),
    ),
  ),
  findings: section(
    auditPage(
      z.strictObject({
        findingId: identity,
        type: identity,
        committedAt: z.string().datetime({ offset: true }),
        values: facts,
        coordinates: recordCoordinates,
        scope,
        truncated,
      }),
    ),
  ),
  methods: section(
    z.strictObject({
      status: z.literal('captured'),
      totalCount: count,
      items: z
        .array(
          z.strictObject({
            kind: identity,
            originResultId: identity,
            targets: z
              .array(
                z.strictObject({
                  path: bounded(512),
                  kind: z.enum(['level', 'absolute', 'relative']),
                }),
              )
              .max(32),
            parentCount: count,
            coordinateCount: count,
            truncated,
          }),
        )
        .max(20),
    }),
  ),
  semantics: section(
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
  ),
})
export type FrameSections = z.infer<typeof sections>

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
    kind: z.literal('frame'),
    source: z.strictObject({ kind: z.literal('frame'), sessionId: text, artifactId: text }),
    frame: z.strictObject({
      inputId: text,
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
    for (const name of ['evidence', 'findings'] as const) {
      const section = frame.sections[name]
      if (typeof section === 'object' && section.status === 'captured') {
        if (section.items.length > section.totalCount) invalid()
        for (const item of section.items)
          if (item.scope.kind === 'row' && item.scope.rowIndex >= data.rows.length) invalid()
      }
    }
  }
  return result
}
