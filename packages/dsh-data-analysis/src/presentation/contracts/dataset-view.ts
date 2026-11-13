import { z } from 'zod'
import { commonDisplayFields, seriesLayoutIssue } from './display-fields.ts'
import type { FrameView, FrameViewFailure, ResolvedFrameView } from './frame-view.ts'
import type { DatasetSnapshot } from './snapshot.ts'
import { PRESENTATION_BUDGETS } from './types.ts'
import { availableNames, numericViewType } from './view-fields.ts'
import { uniqueRowKeys, type ViewFilterContext } from './view-filter-context.ts'

const name = z.string().min(1).max(256)
export const datasetViewSchema = z.union([
  z.strictObject({ chart: z.literal('auto') }),
  z.strictObject({ chart: z.literal('table'), columns: z.array(name).min(1).max(64).optional() }),
  z.strictObject({ chart: z.literal('metric'), encoding: z.strictObject({ value: name }) }),
  z.strictObject({
    chart: z.enum(['line', 'area', 'bar']),
    encoding: z.strictObject({
      axis: name,
      values: z.array(name).min(1).max(64),
      series: name.optional(),
    }),
  }),
  z.strictObject({
    chart: z.literal('heatmap'),
    encoding: z.strictObject({ x: name, y: name, value: name }),
  }),
])
export const datasetDisplaySchema = z.strictObject({
  ...commonDisplayFields,
})
export type DatasetDisplay = z.infer<typeof datasetDisplaySchema>

/** Validate author format references against saved numeric column IDs. */
export function datasetDisplayIssue(
  snapshot: DatasetSnapshot,
  display?: DatasetDisplay,
  view?: ResolvedDatasetView | ResolvedFrameView,
) {
  if (view) {
    const issue = seriesLayoutIssue(snapshot.data.columns, view, display)
    if (issue) return { path: issue }
  }
  const names = (display?.formats ?? []).map(({ value }) => value)
  const numeric = snapshot.data.columns
    .filter((column) => numericViewType(column.type))
    .map(({ id }) => id)
  for (const [i, name] of names.entries()) {
    if (!numeric.includes(name) || names.indexOf(name) !== i) {
      return {
        path: `/display/formats/${i}/value`,
        expectedKind: 'column' as const,
        candidates: availableNames(numeric, names, i),
      }
    }
  }
  return undefined
}

export function validateDatasetDisplay(
  snapshot: DatasetSnapshot,
  display?: DatasetDisplay,
  view?: ResolvedDatasetView | ResolvedFrameView,
) {
  return datasetDisplayIssue(snapshot, display, view)?.path.split('/').slice(0, 3).join('/')
}
export type DatasetView = z.infer<typeof datasetViewSchema>
export type ResolvedDatasetView =
  | { chart: 'table'; columns: string[] }
  | { chart: 'metric'; values: string[] }
  | {
      chart: 'line' | 'area' | 'bar'
      axis: string
      values: string[]
      series?: string
      broadcast: string[]
    }
  | { chart: 'heatmap'; x: string; y: string; value: string }
export type DatasetViewResolution = { ok: true; view: ResolvedDatasetView } | FrameViewFailure
const fail = (
  code: FrameViewFailure['code'],
  path: string,
  candidates?: string[],
): FrameViewFailure => ({
  ok: false,
  code,
  path,
  ...(candidates?.length ? { candidates: candidates.slice(0, 8) } : {}),
})

/** Column mappings only. No aggregation, analysis classification or inferred periods. */
export function resolveDatasetView(
  snapshot: DatasetSnapshot,
  view?: FrameView,
  filters?: ViewFilterContext,
): DatasetViewResolution {
  const { columns, rows } = snapshot.data
  const ids = columns.map((c) => c.id)
  const single = snapshot.coverage.complete && snapshot.data.rowCount === 1
  const ok = (resolved: ResolvedDatasetView): DatasetViewResolution => ({
    ok: true,
    view: resolved,
  })
  if (!view || view.chart === 'auto')
    return ok(
      single && ids.length === 1
        ? { chart: 'metric', values: ids }
        : { chart: 'table', columns: ids },
    )
  if (view.chart === 'table') {
    const names = view.columns ?? ids
    for (const [i, name] of names.entries())
      if (!ids.includes(name) || names.indexOf(name) !== i)
        return fail('view-name-unknown', `/view/columns/${i}`, availableNames(ids, names, i))
    return ok({ chart: 'table', columns: names })
  }
  if (view.chart === 'metric') {
    const value = view.encoding?.value ?? (ids.length === 1 ? ids[0] : undefined)
    if (!value || !ids.includes(value))
      return fail('view-name-unknown', '/view/encoding/value', ids)
    return (filters ? snapshot.coverage.complete && filters.metricEligible : single)
      ? ok({ chart: 'metric', values: [value] })
      : fail('view-metric-requires-complete-single-row', '/view')
  }
  if (!['line', 'area', 'bar', 'heatmap'].includes(view.chart))
    return fail('view-unsupported-for-snapshot', '/view/chart')
  if (!snapshot.coverage.complete) return fail('view-requires-complete-snapshot', '/view')
  if (!datasetViewSchema.safeParse(view).success)
    return fail('view-encoding-required', '/view/encoding')
  const numeric = (name: string) => {
    const index = ids.indexOf(name)
    return (
      numericViewType(columns[index]?.type) &&
      rows.every((row) => row[index] === null || Number.isFinite(Number(row[index])))
    )
  }
  const check = (name: string, path: string, candidates: () => string[], number = false) =>
    !ids.includes(name)
      ? fail('view-name-unknown', path, candidates())
      : number && !numeric(name)
        ? fail('view-dtype-not-drawable', path, candidates())
        : undefined
  // Keys use original typed cells, never formatted labels or floating plot coordinates.
  const unique = (names: string[]) => {
    const indices = names.map((name) => ids.indexOf(name))
    return uniqueRowKeys(
      [
        ...(view.chart === 'heatmap' ? [] : (filters?.requiredSingles ?? [])),
        ...indices.map((i) => rows.map((row) => row[i])),
      ],
      rows.length,
    )
  }
  const cardinality = (name: string) =>
    new Set(rows.map((row) => JSON.stringify(row[ids.indexOf(name)]))).size
  const seriesNames = (axis: string) => ids.filter((id) => id !== axis && unique([axis, id]))
  if (view.chart === 'heatmap') {
    const e = view.encoding
    if (!e) return fail('view-encoding-required', '/view/encoding')
    const heatmapAxes = (other: string) =>
      ids.includes(other)
        ? ids.filter(
            (id) =>
              id !== other &&
              unique([id, other]) &&
              cardinality(id) * cardinality(other) <= PRESENTATION_BUDGETS.cells,
          )
        : ids
    const error =
      check(e.x, '/view/encoding/x', () => heatmapAxes(e.y)) ??
      check(e.y, '/view/encoding/y', () => heatmapAxes(e.x)) ??
      check(e.value, '/view/encoding/value', () => ids.filter(numeric), true)
    if (error) return error
    if (e.x === e.y) return fail('view-target-ambiguous', '/view/encoding/y', heatmapAxes(e.x))
    if (!unique([e.x, e.y])) return fail('view-target-ambiguous', '/view/encoding')
    if (cardinality(e.x) * cardinality(e.y) > PRESENTATION_BUDGETS.cells)
      return fail('view-budget', '/view/encoding')
    return ok({ chart: 'heatmap', ...e })
  }
  if (view.chart === 'line' || view.chart === 'area' || view.chart === 'bar') {
    const e = view.encoding
    if (!e?.axis || !e.values?.length) return fail('view-encoding-required', '/view/encoding')
    const axis = e.axis
    const selected = e.values
    const axisError = check(axis, '/view/encoding/axis', () => {
      const series = e.series
      if (!series) return ids.filter((id) => unique([id]))
      if (!ids.includes(series)) return ids
      return ids.filter((id) => id !== series && unique([id, series]))
    })
    if (axisError) return axisError
    if (e.series) {
      const error = check(e.series, '/view/encoding/series', () => seriesNames(axis))
      if (error) return error
    }
    for (const [i, name] of selected.entries()) {
      const alternatives = () => availableNames(ids.filter(numeric), selected, i)
      const path = `/view/encoding/values/${i}`
      if (selected.indexOf(name) !== i) return fail('view-target-ambiguous', path, alternatives())
      const error = check(name, path, alternatives, true)
      if (error) return error
    }
    if (!unique([e.axis, ...(e.series ? [e.series] : [])]))
      return fail('view-target-ambiguous', '/view/encoding')
    return ok({
      chart: view.chart,
      axis: e.axis,
      values: e.values,
      series: e.series,
      broadcast: [],
    })
  }
  return fail('view-unsupported-for-snapshot', '/view/chart')
}
