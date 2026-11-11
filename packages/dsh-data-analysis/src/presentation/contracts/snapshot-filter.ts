import { z } from 'zod/v4'
import type { DatasetViewResolution } from './dataset-view.ts'
import type { FrameViewResolution } from './frame-view.ts'
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
  mode: z.enum(['single', 'multiple']).optional(),
  defaultValues: z.array(value).optional(),
})
export type SnapshotFilter = z.infer<typeof snapshotFilterSchema>
export type SnapshotFilterValue = string | boolean | null
export type ResolvedSnapshotFilter = {
  declaration: SnapshotFilter
  options: SnapshotFilterValue[]
  values: SnapshotFilterValue[]
}

export function snapshotFilterViewIssue(
  snapshot: AnalysisSnapshot,
  resolution: DatasetViewResolution | FrameViewResolution,
): string | undefined {
  const ordinaryHint = 'Use a supported table or ordinary chart.'
  if (!resolution.ok) return ordinaryHint
  const { view } = resolution
  if (snapshot.kind === 'dataset')
    return ['table', 'line', 'area', 'bar'].includes(view.chart) ? undefined : ordinaryHint

  const interpretation = snapshot.frame.sections.interpretation
  if (
    interpretation.status !== 'captured' ||
    !('classification' in resolution) ||
    resolution.classification.class !== 'observation'
  )
    return 'Use an observation table or ordinary chart with captured interpretation.'
  if (view.chart === 'table') return undefined
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
  type === 'string' || type === 'boolean' || type === 'int64'
const filterAxis = (axis: Extract<AnalysisSnapshot, { kind: 'frame' }>['frame']['axes'][number]) =>
  axis.variant.kind === 'ordinary' && axis.keys.length === 1 && filterType(axis.keys[0]?.dtype.type)

export function snapshotFilterFieldNames(snapshot: AnalysisSnapshot) {
  return snapshot.kind === 'dataset'
    ? snapshot.data.columns.filter(({ type }) => filterType(type)).map(({ id }) => id)
    : snapshot.frame.axes.filter(filterAxis).map(({ name }) => name)
}

export function resolveSnapshotFilter(
  snapshot: AnalysisSnapshot,
  declaration: SnapshotFilter,
): ResolvedSnapshotFilter {
  let values: unknown[]
  let type: string
  let nullable: boolean
  if (snapshot.kind === 'dataset' && declaration.field.kind === 'column') {
    const index = snapshot.data.columns.findIndex((column) => column.id === declaration.field.name)
    const column = snapshot.data.columns[index]
    if (!column || !filterType(column.type)) throw new Error('analysis-filter-field-invalid')
    type = column.type
    nullable = column.nullable
    values = snapshot.data.rows.map((row) => row[index])
  } else if (snapshot.kind === 'frame' && declaration.field.kind === 'axis') {
    const axis = snapshot.frame.axes.find((item) => item.name === declaration.field.name)
    if (!axis || !filterAxis(axis)) throw new Error('analysis-filter-field-invalid')
    const key = axis.keys[0]!
    const coordinate = snapshot.frame.coordinates[key.slotId]
    if (!coordinate) throw new Error('analysis-filter-field-invalid')
    type = key.dtype.type
    nullable = key.nullable
    values = coordinate.values
  } else throw new Error('analysis-filter-field-invalid')
  const valid = (cell: unknown): cell is SnapshotFilterValue =>
    cell === null
      ? nullable
      : type === 'boolean'
        ? typeof cell === 'boolean'
        : typeof cell === 'string'
  if (!values.every(valid)) throw new Error('analysis-filter-field-invalid')
  const options = [...new Set(values)]
  const defaults = declaration.defaultValues ?? []
  if (
    (declaration.mode !== 'multiple' && defaults.length > 1) ||
    new Set(defaults).size !== defaults.length ||
    defaults.some((item) => !valid(item) || !options.includes(item))
  )
    throw new Error('analysis-filter-default-invalid')
  return { declaration, values, options }
}

/** OR within each selection and AND between selections; empty selection means all. */
export function visibleSnapshotRows(
  rowCount: number,
  filters: readonly {
    values: readonly SnapshotFilterValue[]
    selected: readonly SnapshotFilterValue[]
  }[],
): number[] {
  const selected = filters.map((filter) => ({
    values: filter.values,
    keys: new Set(filter.selected),
  }))
  const rows: number[] = []
  for (let row = 0; row < rowCount; row++)
    if (selected.every((filter) => filter.keys.size === 0 || filter.keys.has(filter.values[row]!)))
      rows.push(row)
  return rows
}
