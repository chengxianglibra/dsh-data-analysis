import { z } from 'zod/v4'
import type { DatasetViewResolution } from './dataset-view.ts'
import type { FrameViewResolution } from './frame-view.ts'
import { validatePresentationDate } from './index.ts'
import type { AnalysisSnapshot } from './snapshot.ts'
import { PRESENTATION_BUDGETS } from './types.ts'

const value = z.union([z.string().max(PRESENTATION_BUDGETS.text), z.boolean(), z.literal(null)])
export const snapshotFilterSchema = z.strictObject({
  filterId: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  ref: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  field: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('column'), name: z.string().min(1).max(256) }),
    z.strictObject({ kind: z.literal('axis'), name: z.string().min(1).max(512) }),
  ]),
  label: z.string().trim().min(1).max(512),
  mode: z.enum(['single', 'multiple', 'date-range']).optional(),
  defaultValues: z.array(value).optional(),
  options: z
    .strictObject({
      allowAll: z.boolean().optional(),
      defaultPolicy: z.literal('latest').optional(),
    })
    .optional(),
})
export type SnapshotFilter = z.infer<typeof snapshotFilterSchema>
export const snapshotFilterBindingSchema = z.union([
  snapshotFilterSchema.shape.filterId,
  z.strictObject({
    filter: snapshotFilterSchema.shape.filterId,
    field: snapshotFilterSchema.shape.field,
  }),
])
export type SnapshotFilterBinding = z.infer<typeof snapshotFilterBindingSchema>
export type SnapshotFilterValue = string | boolean | null
export type ResolvedSnapshotFilter = {
  declaration: SnapshotFilter
  options: SnapshotFilterValue[]
  values: SnapshotFilterValue[]
  defaultValues: SnapshotFilterValue[]
  type: string
  calendarTimezone?: string
}
export type ResolvedSnapshotFilterBinding = {
  values: SnapshotFilterValue[]
  type: string
  calendarTimezone?: string
}

export function snapshotFilterViewIssue(
  snapshot: AnalysisSnapshot,
  resolution: DatasetViewResolution | FrameViewResolution,
): string | undefined {
  const ordinaryHint = 'Use a supported table or ordinary chart.'
  if (!resolution.ok) return ordinaryHint
  const { view } = resolution
  if (snapshot.kind === 'dataset')
    return ['table', 'metric', 'line', 'area', 'bar'].includes(view.chart)
      ? undefined
      : ordinaryHint

  const interpretation = snapshot.frame.sections.interpretation
  if (
    interpretation.status !== 'captured' ||
    !('classification' in resolution) ||
    resolution.classification.class !== 'observation'
  )
    return 'Use an observation table or ordinary chart with captured interpretation.'
  if (view.chart === 'table') return undefined
  if (view.chart === 'metric') {
    return view.values.some((name) => {
      const context = interpretation.valueContexts[name]
      return (
        !context ||
        context.kind === 'share' ||
        context.kind === 'pair_statistic' ||
        resolution.classification.broadcastValues.includes(name)
      )
    })
      ? 'Chart values must not depend on the unfiltered range.'
      : undefined
  }
  if (
    (view.chart !== 'line' &&
      view.chart !== 'area' &&
      view.chart !== 'bar' &&
      view.chart !== 'hbar') ||
    !('broadcast' in view)
  )
    return ordinaryHint
  if (
    view.broadcast.length ||
    view.values.some((name) => {
      const context = interpretation.valueContexts[name]
      return !context || context.kind === 'share' || context.kind === 'pair_statistic'
    })
  )
    return 'Chart values must not depend on the unfiltered range.'
  return undefined
}

/** Exact saved cells, without label conversion or numeric coercion. */
const filterType = (type: string | undefined) =>
  type === 'string' || type === 'boolean' || type === 'int64' || type === 'date'
const rangeType = (type: string | undefined) =>
  type === 'string' || type === 'date' || type === 'datetime'

/** Strict calendar dates are shared by default resolution, admission and controls. */
export function isSnapshotFilterDate(value: unknown): value is string {
  try {
    validatePresentationDate(value, '/date', false)
    return true
  } catch {
    return false
  }
}

export function snapshotFilterFieldNames(snapshot: AnalysisSnapshot) {
  return snapshot.kind === 'dataset'
    ? snapshot.data.columns
        .filter(({ type }) => filterType(type) || rangeType(type))
        .map(({ id }) => id)
    : snapshot.frame.axes
        .filter(
          (axis) =>
            axis.keys.length === 1 &&
            ((axis.variant.kind === 'ordinary' &&
              (filterType(axis.keys[0]?.dtype.type) || rangeType(axis.keys[0]?.dtype.type))) ||
              (axis.variant.kind === 'calendar' && axis.keys[0]?.dtype.type === 'datetime')),
        )
        .map(({ name }) => name)
}

function readField(
  snapshot: AnalysisSnapshot,
  field: SnapshotFilter['field'],
  mode: SnapshotFilter['mode'],
): ResolvedSnapshotFilterBinding {
  let cells: unknown[]
  let type: string
  let nullable: boolean
  let calendarTimezone: string | undefined
  if (snapshot.kind === 'dataset' && field.kind === 'column') {
    const index = snapshot.data.columns.findIndex((column) => column.id === field.name)
    const column = snapshot.data.columns[index]
    if (!column) throw new Error('analysis-filter-field-invalid')
    type = column.type
    nullable = column.nullable
    cells = snapshot.data.rows.map((row) => row[index])
  } else if (snapshot.kind === 'frame' && field.kind === 'axis') {
    const axis = snapshot.frame.axes.find((item) => item.name === field.name)
    if (axis?.keys.length !== 1) throw new Error('analysis-filter-field-invalid')
    const key = axis.keys[0]!
    const coordinate = snapshot.frame.coordinates[key.slotId]
    if (!coordinate) throw new Error('analysis-filter-field-invalid')
    if (axis.variant.kind === 'calendar' && mode === 'date-range') {
      const { grain, timezone } = axis.variant
      if (
        key.dtype.type !== 'datetime' ||
        grain.kind !== 'builtin' ||
        !['hour', 'day'].includes(grain.unit) ||
        grain.step !== 1
      )
        throw new Error('analysis-filter-calendar-invalid')
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
      } catch {
        throw new Error('analysis-filter-calendar-invalid')
      }
      calendarTimezone = timezone
    } else if (axis.variant.kind !== 'ordinary') throw new Error('analysis-filter-field-invalid')
    type = key.dtype.type
    nullable = key.nullable
    cells = coordinate.values
  } else throw new Error('analysis-filter-field-invalid')
  if (!(mode === 'date-range' ? rangeType(type) : filterType(type)))
    throw new Error('analysis-filter-field-invalid')
  const valid = (cell: unknown): cell is SnapshotFilterValue =>
    cell === null
      ? nullable
      : type === 'boolean'
        ? typeof cell === 'boolean'
        : typeof cell === 'string'
  if (!cells.every(valid)) throw new Error('analysis-filter-field-invalid')
  if (mode !== 'date-range') return { values: cells, type }

  const formatter = calendarTimezone
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: calendarTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    : undefined
  const values = cells.map((cell) => {
    if (cell === null) return null
    try {
      if (typeof cell !== 'string') throw new Error('invalid date')
      if (type === 'datetime') validatePresentationDate(cell, '/date', true)
      else if (!isSnapshotFilterDate(cell)) throw new Error('invalid date')
      if (!formatter) return cell.slice(0, 10)
      const parts = formatter.formatToParts(new Date(cell))
      const part = (name: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === name)?.value
      const day = `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`
      if (!isSnapshotFilterDate(day)) throw new Error('invalid date')
      return day
    } catch {
      throw new Error('analysis-filter-date-invalid')
    }
  })
  return { values, type, ...(calendarTimezone ? { calendarTimezone } : {}) }
}

/** Validate an applied selection at the same boundary used for authored defaults. */
export function isSnapshotFilterSelectionValid(
  definition: ResolvedSnapshotFilter,
  selected: readonly SnapshotFilterValue[],
): boolean {
  const { declaration, options } = definition
  if (!selected.length) return declaration.options?.allowAll !== false
  if (declaration.mode === 'date-range')
    return (
      selected.length === 2 &&
      isSnapshotFilterDate(selected[0]) &&
      isSnapshotFilterDate(selected[1]) &&
      selected[0] <= selected[1]
    )
  if (declaration.mode !== 'multiple' && selected.length !== 1) return false
  return (
    new Set(selected).size === selected.length && selected.every((item) => options.includes(item))
  )
}

export function resolveSnapshotFilter(
  snapshot: AnalysisSnapshot,
  declaration: SnapshotFilter,
): ResolvedSnapshotFilter {
  const field = readField(snapshot, declaration.field, declaration.mode)
  const options = [...new Set(field.values)]
  const defaults = declaration.defaultValues ?? []
  const definition: ResolvedSnapshotFilter = {
    declaration,
    ...field,
    options,
    defaultValues: defaults,
  }
  if (declaration.options?.defaultPolicy === 'latest') {
    if (
      defaults.length ||
      declaration.mode === 'multiple' ||
      (declaration.mode !== 'date-range' && field.type !== 'string' && field.type !== 'date')
    )
      throw new Error('analysis-filter-default-invalid')
    const dates = field.values.filter(
      (item): item is string => item !== null && typeof item === 'string',
    )
    if (!dates.length || !dates.every(isSnapshotFilterDate))
      throw new Error('analysis-filter-default-invalid')
    const latest = dates.reduce((left, right) => (left > right ? left : right))
    definition.defaultValues = declaration.mode === 'date-range' ? [latest, latest] : [latest]
  }
  if (!isSnapshotFilterSelectionValid(definition, definition.defaultValues))
    throw new Error('analysis-filter-default-invalid')
  return definition
}

/** Read a declared consumer field; normal selections require the same saved type. */
export function resolveSnapshotFilterBinding(
  snapshot: AnalysisSnapshot,
  definition: ResolvedSnapshotFilter,
  field: SnapshotFilter['field'],
): ResolvedSnapshotFilterBinding {
  const result = readField(snapshot, field, definition.declaration.mode)
  if (definition.declaration.mode !== 'date-range' && result.type !== definition.type)
    throw new Error('analysis-filter-type-mismatch')
  if (
    definition.calendarTimezone &&
    result.calendarTimezone &&
    definition.calendarTimezone !== result.calendarTimezone
  )
    throw new Error('analysis-filter-calendar-invalid')
  return result
}

/** OR within ordinary selections, inclusive range matching, AND between controls. */
export function visibleSnapshotRows(
  rowCount: number,
  filters: readonly {
    values: readonly SnapshotFilterValue[]
    selected: readonly SnapshotFilterValue[]
    mode?: SnapshotFilter['mode']
  }[],
): number[] {
  const prepared = filters.map((filter) => ({ ...filter, keys: new Set(filter.selected) }))
  const rows: number[] = []
  for (let row = 0; row < rowCount; row++)
    if (
      prepared.every((filter) => {
        if (!filter.selected.length) return true
        const value = filter.values[row]
        if (filter.mode === 'date-range') {
          const [start, end] = filter.selected
          return (
            typeof value === 'string' &&
            typeof start === 'string' &&
            typeof end === 'string' &&
            value >= start &&
            value <= end
          )
        }
        return value !== undefined && filter.keys.has(value)
      })
    )
      rows.push(row)
  return rows
}
