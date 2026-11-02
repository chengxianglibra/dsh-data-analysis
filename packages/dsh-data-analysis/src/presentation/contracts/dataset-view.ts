import { z } from 'zod'
import type { FrameView, FrameViewFailure } from './frame-view.ts'
import type { DatasetSnapshot } from './snapshot.ts'
import { PRESENTATION_BUDGETS } from './types.ts'

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
  height: z.number().int().positive().max(1200).optional(),
})
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
const fail = (code: FrameViewFailure['code'], path: string): FrameViewFailure => ({
  ok: false,
  code,
  path,
})

/** Column mappings only. No aggregation, analysis classification or inferred periods. */
export function resolveDatasetView(
  snapshot: DatasetSnapshot,
  view?: FrameView,
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
        return fail('view-name-unknown', `/view/columns/${i}`)
    return ok({ chart: 'table', columns: names })
  }
  if (view.chart === 'metric') {
    const value = view.encoding?.value ?? (ids.length === 1 ? ids[0] : undefined)
    if (!value || !ids.includes(value)) return fail('view-name-unknown', '/view/encoding/value')
    return single
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
      ['float64', 'int64', 'decimal'].includes(columns[index]?.type ?? '') &&
      rows.every((row) => row[index] === null || Number.isFinite(Number(row[index])))
    )
  }
  const check = (name: string, path: string, number = false) =>
    !ids.includes(name)
      ? fail('view-name-unknown', path)
      : number && !numeric(name)
        ? fail('view-dtype-not-drawable', path)
        : undefined
  // Keys use original typed cells, never formatted labels or floating plot coordinates.
  const unique = (names: string[]) => {
    const indices = names.map((name) => ids.indexOf(name))
    const keys = rows.map((row) => JSON.stringify(indices.map((i) => row[i])))
    return new Set(keys).size === rows.length
  }
  if (view.chart === 'heatmap') {
    const e = view.encoding
    if (!e) return fail('view-encoding-required', '/view/encoding')
    for (const key of ['x', 'y', 'value'] as const) {
      const error = check(e[key], `/view/encoding/${key}`, key === 'value')
      if (error) return error
    }
    if (e.x === e.y || !unique([e.x, e.y])) return fail('view-target-ambiguous', '/view/encoding')
    const cardinality = (name: string) =>
      new Set(rows.map((row) => JSON.stringify(row[ids.indexOf(name)]))).size
    if (cardinality(e.x) * cardinality(e.y) > PRESENTATION_BUDGETS.cells)
      return fail('view-budget', '/view/encoding')
    return ok({ chart: 'heatmap', ...e })
  }
  if (view.chart === 'line' || view.chart === 'area' || view.chart === 'bar') {
    const e = view.encoding
    if (!e?.axis || !e.values?.length) return fail('view-encoding-required', '/view/encoding')
    const axisError = check(e.axis, '/view/encoding/axis')
    if (axisError) return axisError
    if (e.series) {
      const error = check(e.series, '/view/encoding/series')
      if (error) return error
      if (new Set(rows.map((row) => JSON.stringify(row[ids.indexOf(e.series!)]))).size > 8)
        return fail('view-budget', '/view/encoding/series')
    }
    for (const [i, name] of e.values.entries()) {
      const error = check(name, `/view/encoding/values/${i}`, true)
      if (error) return error
    }
    if (
      new Set(e.values).size !== e.values.length ||
      !unique([e.axis, ...(e.series ? [e.series] : [])])
    )
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
