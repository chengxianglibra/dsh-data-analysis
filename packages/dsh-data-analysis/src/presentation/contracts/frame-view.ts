import { z } from 'zod'
import {
  type AnalysisSnapshot,
  type FrameInterpretation,
  type FrameSnapshot,
  type FrameSnapshotV2,
  type FrameValueContext,
  isFrameSnapshotV2,
} from './snapshot.ts'
import type { ColumnType } from './types.ts'

/** AnalysisFrameView/DatasetView `view` argument; names are public value or axis names only. */
const names = z.array(z.string().min(1).max(512)).min(1).max(64)
export const frameViewSchema = z.union([
  z.strictObject({ chart: z.literal('auto') }),
  z.strictObject({ chart: z.literal('table'), columns: names.optional() }),
  z.strictObject({
    chart: z.literal('metric'),
    encoding: z.strictObject({ value: z.string().min(1) }).optional(),
  }),
  z.strictObject({
    chart: z.enum(['line', 'area', 'bar']),
    encoding: z
      .strictObject({
        values: names.optional(),
        axis: z.string().min(1).optional(),
        series: z.string().min(1).optional(),
      })
      .optional(),
  }),
  z.strictObject({
    chart: z.literal('heatmap'),
    encoding: z
      .strictObject({ x: z.string().min(1), y: z.string().min(1), value: z.string().min(1) })
      .optional(),
  }),
  z.strictObject({
    chart: z.literal('comparison'),
    encoding: z.strictObject({ value: z.string().min(1) }).optional(),
    style: z.enum(['auto', 'delta']).optional(),
  }),
  z.strictObject({
    chart: z.literal('decomposition'),
    encoding: z.strictObject({ value: z.string().min(1) }).optional(),
    style: z.enum(['auto', 'share']).optional(),
  }),
])
export const frameDisplaySchema = z.strictObject({
  height: z.number().int().positive().max(1200).optional(),
  density: z.enum(['full', 'compact']).optional(),
  dataTable: z.enum(['collapsed', 'visible']).optional(),
})
export type FrameView = z.infer<typeof frameViewSchema>
export type FrameDisplay = z.infer<typeof frameDisplaySchema>

/** Semantic class: first matching rule in docs/designs/analysis-frame-view.md#识别规则. */
export type FrameClass =
  | 'members'
  | 'decomposition'
  | 'comparison'
  | 'alignment'
  | 'correlation'
  | 'observation'
/** Axis shape; `other` covers every remaining axis combination and renders as a table. */
export type FrameShape =
  | 'scalar'
  | 'time'
  | 'category'
  | 'time-category'
  | 'matrix'
  | 'records'
  | 'paired-time'
  | 'other'
export interface FrameClassification {
  class: FrameClass
  shape: FrameShape
  /** Calendar or interval axis token for time shapes. */
  timeAxis?: string
  /** Ordinary (field/identity) axis tokens in Frame order. */
  categoryAxes: string[]
  /** Value names drawn by the main view of this class; others appear only in the data table. */
  primaryValues: string[]
  /** Values whose statistic groups are fewer than the current axes (`over` broadcasts). */
  broadcastValues: string[]
  /** Statistic symbol per value name: Σ sum, μ mean, # row_count, n pair_count. */
  symbols: Record<string, 'Σ' | 'μ' | '#' | 'n'>
}

/**
 * Deterministic main view chosen by `auto` or validated from an explicit `view`.
 * Renderers draw only this plan and never re-derive class or shape themselves.
 */
export type ResolvedFrameView =
  /** `layout: 'comparison'` is a client-only transposed table, never stored in `frameViewSchema`. */
  | { chart: 'table'; columns: string[]; layout?: 'comparison' }
  | { chart: 'metric'; values: string[] }
  | {
      chart: 'line' | 'area' | 'bar' | 'interval-bar'
      axis: string
      series?: string
      values: string[]
      broadcast: string[]
    }
  | { chart: 'hbar'; axis: string; values: string[]; broadcast: string[] }
  | { chart: 'heatmap'; x: string; y: string; value: string }
  | {
      chart: 'comparison'
      /** Index into interpretation.comparisons. */
      comparison: number
      group: string
      style: 'numbers' | 'line' | 'dumbbell' | 'delta' | 'small-multiples' | 'table'
    }
  | {
      chart: 'decomposition'
      /** Index into interpretation.decompositions. */
      decomposition: number
      style: 'waterfall' | 'effects' | 'share'
    }
  | {
      chart: 'correlation'
      /** Coefficient values (pearson/spearman). */
      values: string[]
      /** pair_count value with the same x, y, groups and row scope, per coefficient. */
      counts: Record<string, string>
    }
  | {
      chart: 'alignment'
      /** Index into interpretation.alignments. */
      alignment: number
      /** Left and right values observing the same subject; only names present in data.columns. */
      pairs: { left: string; right: string }[]
      style: 'dumbbell' | 'line' | 'table'
    }
  | { chart: 'share'; values: string[]; axis?: string }
  | { chart: 'members' }

export type FrameViewErrorCode =
  | 'view-name-unknown'
  | 'view-dtype-not-drawable'
  | 'view-target-ambiguous'
  | 'view-role-missing'
  | 'view-metric-requires-complete-single-row'
  | 'view-axis-not-time'
  | 'view-requires-complete-snapshot'
  | 'view-unsupported-for-snapshot'
export interface FrameViewFailure {
  ok: false
  code: FrameViewErrorCode
  path: string
  /** Distinct output value names (at most 8), filled when a target lookup is ambiguous. */
  candidates?: string[]
}
export type FrameViewResolution =
  | { ok: true; classification: FrameClassification; view: ResolvedFrameView }
  | FrameViewFailure

const DRAWABLE = new Set<ColumnType>(['float64', 'int64', 'decimal'])
const EFFECT_ROLES = new Set([
  'effect_within',
  'effect_mix',
  'effect_entry_exit',
  'effect_additive',
])
const SYMBOLS = { sum: 'Σ', mean: 'μ', row_count: '#', pair_count: 'n' } as const
const CATEGORY_ROWS = 30
const MAX_SERIES = 8
const BAR_PERIODS = 12
const METRIC_VALUES = 4
const RECORD_VALUES = 6
const MAX_CANDIDATES = 8

type FrameAxis = FrameSnapshotV2['frame']['axes'][number]
type Fail = Extract<FrameViewResolution, { ok: false }>
const fail = (code: FrameViewErrorCode, path: string, candidates?: string[]): Fail => ({
  ok: false,
  code,
  path,
  ...(candidates?.length ? { candidates } : {}),
})
const failed = (value: unknown): value is Fail =>
  typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false

const isTime = (axis: FrameAxis) =>
  axis.variant?.kind === 'calendar' || axis.variant?.kind === 'interval'
const isOrdinary = (axis: FrameAxis) => axis.variant?.kind === 'ordinary'
const isCoefficient = (context: FrameValueContext | undefined) =>
  context?.kind === 'pair_statistic' && context.statistic !== 'pair_count'

function interpretationOf(snapshot: FrameSnapshotV2): FrameInterpretation | undefined {
  const section = snapshot.frame.sections.interpretation
  return typeof section === 'object' && section.status === 'captured' ? section : undefined
}
/** Value field names present in data.columns, in column order. */
function valueNames(snapshot: FrameSnapshotV2) {
  return snapshot.frame.fields.filter((f) => f.role === 'value').map((f) => f.id)
}

/**
 * Classify from structure only: axes, interpretation facts, dtypes and value roles.
 * Broadcast compares the axis-kind statistic groups with the current axes so a `fix`
 * that turns a partition axis into a fixed group keeps a constant value marked broadcast.
 */
export function classifyFrame(snapshot: FrameSnapshotV2): FrameClassification {
  const { frame, data } = snapshot
  const facts = interpretationOf(snapshot)
  const contexts = facts?.valueContexts ?? {}
  const values = valueNames(snapshot)
  const types = new Map(data.columns.map((c) => [c.id, c.type]))
  const numeric = values.filter((v) => DRAWABLE.has(types.get(v)!))
  const axes = frame.axes
  const time = axes.filter(isTime)
  const ordinary = axes.filter(isOrdinary)

  let shape: FrameShape
  if (axes.some((a) => a.variant?.kind === 'paired')) shape = 'paired-time'
  else if (
    ordinary.some((a) => a.role === 'identity') &&
    (numeric.length < values.length || numeric.length > RECORD_VALUES)
  )
    shape = 'records'
  else if (axes.length === 0) shape = 'scalar'
  else if (axes.length === 1) shape = time.length ? 'time' : ordinary.length ? 'category' : 'other'
  else if (axes.length === 2 && time.length === 1 && ordinary.length === 1) shape = 'time-category'
  else if (axes.length === 2 && ordinary.length === 2) shape = 'matrix'
  else shape = 'other'

  const comparisons = facts?.comparisons ?? []
  const decompositions = facts?.decompositions ?? []
  const alignments = facts?.alignments ?? []
  const frameClass: FrameClass = !values.length
    ? 'members'
    : decompositions.length
      ? 'decomposition'
      : comparisons.some((c) => c.groups.some((g) => g.values.length))
        ? 'comparison'
        : alignments.length
          ? 'alignment'
          : values.some((v) => isCoefficient(contexts[v]))
            ? 'correlation'
            : 'observation'

  const owned = new Set<string>(
    frameClass === 'decomposition'
      ? decompositions.flatMap((d) =>
          d.outputs.filter((o) => o.fieldKind === 'value').map((o) => o.name),
        )
      : frameClass === 'comparison'
        ? comparisons.flatMap((c) => c.groups.flatMap((g) => g.values.map((v) => v.name)))
        : frameClass === 'alignment'
          ? alignments.flatMap((a) => [...a.left.values, ...a.right.values])
          : frameClass === 'correlation'
            ? values.filter((v) => contexts[v]?.kind === 'pair_statistic')
            : values,
  )
  const broadcastValues: string[] = []
  const symbols: FrameClassification['symbols'] = {}
  for (const name of values) {
    const context = contexts[name]
    if (context?.kind !== 'statistic' && context?.kind !== 'pair_statistic') continue
    if (context.groups.filter((g) => g.kind === 'axis').length < axes.length)
      broadcastValues.push(name)
    if (context.statistic !== 'pearson' && context.statistic !== 'spearman')
      symbols[name] = SYMBOLS[context.statistic]
  }
  const timeAxis = shape === 'time' || shape === 'time-category' ? time[0]!.token : undefined
  return {
    class: frameClass,
    shape,
    ...(timeAxis === undefined ? {} : { timeAxis }),
    categoryAxes: ordinary.map((a) => a.token),
    primaryValues: values.filter((v) => owned.has(v)),
    broadcastValues,
    symbols,
  }
}

/**
 * Resolve `view` against a saved snapshot. v1 Frame and Dataset snapshots support only
 * auto/table/metric (auto falls back to table or a complete single-row metric). Their
 * classification is minimal: class `observation` (`members` for a value-less Frame), shape
 * `scalar` for a 0-axis Frame and `other` otherwise, primary values are the value columns,
 * and no broadcast values or symbols, because v1 carries no interpretation facts.
 */
export function resolveFrameView(
  snapshot: AnalysisSnapshot | FrameSnapshot,
  view?: FrameView,
): FrameViewResolution {
  return isFrameSnapshotV2(snapshot) ? resolveV2(snapshot, view) : resolveLegacy(snapshot, view)
}

function tableColumns(snapshot: AnalysisSnapshot, columns: string[] | undefined): string[] | Fail {
  const ids = snapshot.data.columns.map((c) => c.id)
  if (!columns) return ids
  for (const [i, name] of columns.entries())
    if (!ids.includes(name) || columns.indexOf(name) !== i)
      return fail('view-name-unknown', `/view/columns/${i}`)
  return columns
}
const singleRow = (snapshot: AnalysisSnapshot) =>
  snapshot.coverage.complete && snapshot.data.rowCount === 1

function resolveLegacy(snapshot: AnalysisSnapshot, view?: FrameView): FrameViewResolution {
  const ids = snapshot.data.columns.map((c) => c.id)
  const values =
    snapshot.kind === 'frame'
      ? snapshot.frame.fields.filter((f) => f.role === 'value').map((f) => f.id)
      : ids
  const classification: FrameClassification = {
    class: snapshot.kind === 'frame' && !values.length ? 'members' : 'observation',
    shape: snapshot.kind === 'frame' && snapshot.frame.axes.length === 0 ? 'scalar' : 'other',
    categoryAxes: [],
    primaryValues: values,
    broadcastValues: [],
    symbols: {},
  }
  const ok = (resolved: ResolvedFrameView): FrameViewResolution => ({
    ok: true,
    classification,
    view: resolved,
  })
  // Today's auto metric: a 0-axis Frame with one value field, or a one-column Dataset.
  const autoValue =
    snapshot.kind === 'frame'
      ? snapshot.frame.axes.length === 0 && values.length === 1 && ids.includes(values[0]!)
        ? values[0]
        : undefined
      : ids.length === 1
        ? ids[0]
        : undefined
  if (!view || view.chart === 'auto')
    return ok(
      autoValue !== undefined && singleRow(snapshot)
        ? { chart: 'metric', values: [autoValue] }
        : { chart: 'table', columns: ids },
    )
  if (view.chart === 'table') {
    const columns = tableColumns(snapshot, view.columns)
    return failed(columns) ? columns : ok({ chart: 'table', columns })
  }
  if (view.chart === 'metric') {
    const name = view.encoding?.value ?? autoValue
    if (name === undefined || !ids.includes(name))
      return fail('view-name-unknown', '/view/encoding/value')
    if (!singleRow(snapshot)) return fail('view-metric-requires-complete-single-row', '/view')
    return ok({ chart: 'metric', values: [name] })
  }
  return fail('view-unsupported-for-snapshot', '/view/chart')
}

interface Context {
  snapshot: FrameSnapshotV2
  classification: FrameClassification
  facts: FrameInterpretation | undefined
  types: Map<string, ColumnType>
  values: Set<string>
  complete: boolean
}
interface ComparisonTarget {
  comparison: number
  group: string
  roles: Map<'current' | 'baseline' | 'absolute' | 'relative', string>
}
interface DecompositionTarget {
  decomposition: number
  roles: Map<string, string>
}

function resolveV2(snapshot: FrameSnapshotV2, view?: FrameView): FrameViewResolution {
  const classification = classifyFrame(snapshot)
  const context: Context = {
    snapshot,
    classification,
    facts: interpretationOf(snapshot),
    types: new Map(snapshot.data.columns.map((c) => [c.id, c.type])),
    values: new Set(valueNames(snapshot)),
    complete: snapshot.coverage.complete,
  }
  const resolved = !view || view.chart === 'auto' ? auto(context) : explicit(context, view)
  return failed(resolved) ? resolved : { ok: true, classification, view: resolved }
}

const drawable = (x: Context, name: string) => DRAWABLE.has(x.types.get(name)!)
/** Observation subject of a value; computed values have none. */
function subjectOf(x: Context, name: string) {
  const context = x.facts?.valueContexts[name]
  return context?.kind === 'observation' && context.subject
    ? `${context.subject.kind}:${context.subject.path}`
    : undefined
}
/**
 * Left and right values observing the same semantic subject, once per side.
 * Order and names prove nothing; values without a unique shared subject stay in the table.
 */
function alignmentPairs(x: Context, alignment: FrameInterpretation['alignments'][number]) {
  const bySubject = (names: string[]) => {
    const found = new Map<string, string[]>()
    for (const name of names) {
      const subject = x.values.has(name) ? subjectOf(x, name) : undefined
      if (subject) found.set(subject, [...(found.get(subject) ?? []), name])
    }
    return found
  }
  const right = bySubject(alignment.right.values)
  return [...bySubject(alignment.left.values)].flatMap(([subject, lefts]) => {
    const rights = right.get(subject)
    return lefts.length === 1 && rights?.length === 1
      ? [{ left: lefts[0]!, right: rights[0]! }]
      : []
  })
}
const targetKind = (x: Context, t: DecompositionTarget) =>
  x.facts!.decompositions[t.decomposition]!.target.kind
const allColumns = (x: Context): ResolvedFrameView => ({
  chart: 'table',
  columns: x.snapshot.data.columns.map((c) => c.id),
})
/** All raw columns kept for CopyData and the collapsed audit table; the client transposes groups. */
const comparisonTable = (x: Context): ResolvedFrameView => ({
  chart: 'table',
  columns: x.snapshot.data.columns.map((c) => c.id),
  layout: 'comparison',
})
function axisNamed(x: Context, name: string) {
  return x.snapshot.frame.axes.find((a) => a.name === name)
}
function axisToken(x: Context, token: string) {
  return x.snapshot.frame.axes.find((a) => a.token === token)!
}
/** Distinct key tuples of one axis over the captured rows; a structural count, no values read. */
function distinctKeys(x: Context, token: string) {
  const columns = axisToken(x, token).keys.map(
    (k) => x.snapshot.frame.coordinates[k.slotId]!.values,
  )
  const seen = new Set<string>()
  for (let i = 0; i < x.snapshot.data.rows.length; i++)
    seen.add(JSON.stringify(columns.map((c) => c[i])))
  return seen.size
}
/** Periods of a time axis from `read_periods` when captured, so empty periods count too. */
function periodCount(x: Context, token: string) {
  const periods = x.snapshot.frame.sections.periods
  const page =
    typeof periods === 'object' && periods.status === 'captured'
      ? periods.pages.find((p) => p.target.kind === 'axis' && p.target.axisToken === token)
      : undefined
  return page?.totalCount ?? x.snapshot.data.rowCount
}
function shareAxis(x: Context, name: string) {
  const context = x.facts?.valueContexts[name]
  if (context?.kind !== 'share') return undefined
  const tokens = new Set(x.snapshot.frame.axes.map((a) => a.token))
  for (const g of context.along)
    if (g.kind === 'axis' && tokens.has(g.axisToken)) return g.axisToken
  return undefined
}
function split(x: Context, names: string[]) {
  const broadcast = new Set(x.classification.broadcastValues)
  return {
    values: names.filter((v) => !broadcast.has(v)),
    broadcast: names.filter((v) => broadcast.has(v)),
  }
}

function comparisonTargets(x: Context): ComparisonTarget[] {
  return (x.facts?.comparisons ?? []).flatMap((c, comparison) =>
    c.groups.flatMap((g) => {
      const present = g.values.filter((v) => x.values.has(v.name))
      return present.length
        ? [{ comparison, group: g.name, roles: new Map(present.map((v) => [v.role, v.name])) }]
        : []
    }),
  )
}
function decompositionTargets(x: Context): DecompositionTarget[] {
  return (x.facts?.decompositions ?? []).flatMap((d, decomposition) => {
    const present = d.outputs.filter((o) => o.fieldKind === 'value' && x.values.has(o.name))
    return present.length
      ? [{ decomposition, roles: new Map(present.map((o) => [o.role as string, o.name])) }]
      : []
  })
}
/** Distinct role output names across targets, in target order; capped for the error text. */
function candidatesOf<T extends { roles: Map<string, string> }>(targets: T[]): string[] {
  return [...new Set(targets.flatMap((t) => [...t.roles.values()]))].slice(0, MAX_CANDIDATES)
}
/** Exactly one target, located by any of its output value names when `value` is given. */
function pick<T extends { roles: Map<string, string> }>(
  x: Context,
  targets: T[],
  value: string | undefined,
): T | Fail {
  if (value === undefined)
    return targets.length === 1
      ? targets[0]!
      : fail('view-target-ambiguous', '/view', candidatesOf(targets))
  if (!x.types.has(value)) return fail('view-name-unknown', '/view/encoding/value')
  const matches = targets.filter((t) => [...t.roles.values()].includes(value))
  return matches.length === 1
    ? matches[0]!
    : fail('view-target-ambiguous', '/view/encoding/value', candidatesOf(targets))
}
/** Every role present and drawable, otherwise the matching error. */
function requireRoles(x: Context, roles: Map<string, string>, needed: string[]): Fail | undefined {
  for (const role of needed) {
    const name = roles.get(role)
    if (name === undefined) return fail('view-role-missing', '/view')
    if (!drawable(x, name)) return fail('view-dtype-not-drawable', '/view')
  }
  return undefined
}

type ComparisonStyle = Extract<ResolvedFrameView, { chart: 'comparison' }>['style']
function comparisonStyle(
  x: Context,
  target: ComparisonTarget,
  style: 'auto' | 'delta',
): ComparisonStyle | Fail {
  if (style === 'delta') return requireRoles(x, target.roles, ['absolute']) ?? 'delta'
  // One saved row has one point per series: numbers read better than a one-point line.
  if (singleRow(x.snapshot)) return 'numbers'
  const { shape, categoryAxes } = x.classification
  const pair = () => requireRoles(x, target.roles, ['current', 'baseline'])
  switch (shape) {
    case 'scalar':
      return 'numbers'
    case 'time':
      return pair() ?? 'line'
    case 'category':
      return pair() ?? 'dumbbell'
    case 'time-category':
      return (
        pair() ?? (distinctKeys(x, categoryAxes[0]!) <= MAX_SERIES ? 'small-multiples' : 'table')
      )
    default:
      return 'table'
  }
}
type DecompositionStyle = Extract<ResolvedFrameView, { chart: 'decomposition' }>['style']
function decompositionStyle(
  x: Context,
  target: DecompositionTarget,
  style: 'auto' | 'share',
): DecompositionStyle | Fail {
  if (style === 'share') {
    const missing = requireRoles(x, target.roles, ['share'])
    return missing ? { ...missing, path: '/view/style' } : 'share'
  }
  const effects = [...target.roles.keys()].filter((r) => EFFECT_ROLES.has(r))
  if (effects.length) return requireRoles(x, target.roles, effects) ?? 'effects'
  return requireRoles(x, target.roles, ['contribution', 'total']) ?? 'waterfall'
}
const readsWhole = (style: DecompositionStyle) => style === 'waterfall' || style === 'share'

function auto(x: Context): ResolvedFrameView {
  const { classification: c, snapshot } = x
  switch (c.class) {
    case 'members':
      return { chart: 'members' }
    case 'decomposition': {
      // attribute over a comparison also keeps per-endpoint level decompositions;
      // the change target carries the effects and is what the Frame explains.
      const kinds = ['absolute', 'relative', 'level']
      const target = decompositionTargets(x).sort(
        (a, b) => kinds.indexOf(targetKind(x, a)) - kinds.indexOf(targetKind(x, b)),
      )[0]
      const style = target && decompositionStyle(x, target, 'auto')
      if (!target || !style || failed(style) || (readsWhole(style) && !x.complete))
        return allColumns(x)
      return { chart: 'decomposition', decomposition: target.decomposition, style }
    }
    case 'comparison': {
      const targets = comparisonTargets(x)
      if (!targets.length) return allColumns(x)
      if (singleRow(snapshot)) {
        // One card: a single group is numbers, several groups transpose into one table.
        if (targets.length > 1) return comparisonTable(x)
        const target = targets[0]!
        return {
          chart: 'comparison',
          comparison: target.comparison,
          group: target.group,
          style: 'numbers',
        }
      }
      const target = targets[0]!
      const style = comparisonStyle(x, target, 'auto')
      return {
        chart: 'comparison',
        comparison: target.comparison,
        group: target.group,
        style: failed(style) ? 'table' : style,
      }
    }
    case 'alignment': {
      const pairs = alignmentPairs(x, x.facts!.alignments[0]!)
      const plotted =
        pairs.length && pairs.every((p) => drawable(x, p.left) && drawable(x, p.right))
      const style =
        plotted && c.shape === 'category'
          ? 'dumbbell'
          : plotted && c.shape === 'paired-time'
            ? 'line'
            : 'table'
      return { chart: 'alignment', alignment: 0, pairs, style }
    }
    case 'correlation': {
      const contexts = x.facts!.valueContexts
      const values = c.primaryValues.filter((v) => isCoefficient(contexts[v]))
      const counts: Record<string, string> = {}
      for (const value of values) {
        const { statistic: _s, ...scope } = contexts[value] as Extract<
          FrameValueContext,
          { kind: 'pair_statistic' }
        >
        const count = c.primaryValues.find((v) => {
          const other = contexts[v]
          if (other?.kind !== 'pair_statistic' || other.statistic !== 'pair_count') return false
          const { statistic: _o, ...rest } = other
          return JSON.stringify(rest) === JSON.stringify(scope)
        })
        if (count !== undefined) counts[value] = count
      }
      return { chart: 'correlation', values, counts }
    }
  }
  const { values, broadcast } = split(
    x,
    c.primaryValues.filter((v) => drawable(x, v)),
  )
  const shares = values.filter((v) => x.facts?.valueContexts[v]?.kind === 'share')
  const axis = shares.length ? shareAxis(x, shares[0]!) : undefined
  // time × category: one track per period when every share is normalized along the category.
  const perPeriod =
    c.shape === 'time-category' &&
    axis === c.categoryAxes[0] &&
    shares.every((v) => shareAxis(x, v) === axis)
  if (shares.length && (c.shape === 'scalar' || c.shape === 'category' || perPeriod)) {
    if (!x.complete) return allColumns(x)
    return { chart: 'share', values: shares, ...(axis === undefined ? {} : { axis }) }
  }
  switch (c.shape) {
    case 'scalar':
      return singleRow(snapshot) && c.primaryValues.length <= METRIC_VALUES
        ? { chart: 'metric', values: c.primaryValues }
        : allColumns(x)
    case 'time': {
      if (!values.length) return allColumns(x)
      const axis = c.timeAxis!
      const chart =
        axisToken(x, axis).variant?.kind === 'interval'
          ? 'interval-bar'
          : periodCount(x, axis) <= BAR_PERIODS && values.length === 1
            ? 'bar'
            : 'line'
      return { chart, axis, values, broadcast }
    }
    case 'category':
      return values.length && x.complete && snapshot.data.rowCount <= CATEGORY_ROWS
        ? { chart: 'hbar', axis: c.categoryAxes[0]!, values, broadcast }
        : allColumns(x)
    case 'time-category': {
      if (!values.length) return allColumns(x)
      const series = c.categoryAxes[0]!
      if (distinctKeys(x, series) <= MAX_SERIES)
        return { chart: 'line', axis: c.timeAxis!, series, values, broadcast }
      return values.length === 1
        ? { chart: 'heatmap', x: c.timeAxis!, y: series, value: values[0]! }
        : allColumns(x)
    }
    case 'matrix':
      return values.length === 1
        ? { chart: 'heatmap', x: c.categoryAxes[0]!, y: c.categoryAxes[1]!, value: values[0]! }
        : allColumns(x)
    default:
      return allColumns(x)
  }
}

/** A drawable value field present in data.columns, or the error at `path`. */
function drawableValue(x: Context, name: string, path: string): Fail | undefined {
  if (!x.values.has(name)) return fail('view-name-unknown', path)
  return drawable(x, name) ? undefined : fail('view-dtype-not-drawable', path)
}

function explicit(
  x: Context,
  view: Exclude<FrameView, { chart: 'auto' }>,
): ResolvedFrameView | Fail {
  const { classification: c, snapshot } = x
  const axes = snapshot.frame.axes
  switch (view.chart) {
    case 'table': {
      if (
        view.columns === undefined &&
        c.class === 'comparison' &&
        singleRow(snapshot) &&
        comparisonTargets(x).length > 0
      )
        return comparisonTable(x)
      const columns = tableColumns(snapshot, view.columns)
      return failed(columns) ? columns : { chart: 'table', columns }
    }
    case 'metric': {
      const value = view.encoding?.value
      if (value !== undefined && !x.types.has(value))
        return fail('view-name-unknown', '/view/encoding/value')
      const values = value === undefined ? c.primaryValues : [value]
      if (!values.length) return fail('view-target-ambiguous', '/view')
      if (!singleRow(snapshot)) return fail('view-metric-requires-complete-single-row', '/view')
      return { chart: 'metric', values }
    }
    case 'line':
    case 'area':
    case 'bar': {
      const encoding = view.encoding ?? {}
      let axis: FrameAxis | undefined
      if (encoding.axis !== undefined) {
        axis = axisNamed(x, encoding.axis)
        if (!axis) return fail('view-name-unknown', '/view/encoding/axis')
        if (!isTime(axis)) return fail('view-axis-not-time', '/view/encoding/axis')
      } else {
        const time = axes.filter(isTime)
        if (time.length !== 1)
          return fail(
            time.length ? 'view-target-ambiguous' : 'view-axis-not-time',
            '/view/encoding/axis',
          )
        axis = time[0]!
      }
      let series: string | undefined
      if (encoding.series !== undefined) {
        const found = axisNamed(x, encoding.series)
        if (!found || found.token === axis.token)
          return fail('view-name-unknown', '/view/encoding/series')
        series = found.token
      } else {
        const others = axes.filter((a) => a.token !== axis.token)
        if (others.length > 1) return fail('view-target-ambiguous', '/view/encoding/series')
        series = others[0]?.token
      }
      let names: string[]
      if (encoding.values) {
        for (const [i, name] of encoding.values.entries()) {
          const path = `/view/encoding/values/${i}`
          if (encoding.values.indexOf(name) !== i) return fail('view-name-unknown', path)
          const error = drawableValue(x, name, path)
          if (error) return error
        }
        names = encoding.values
      } else {
        names = c.primaryValues.filter((v) => drawable(x, v))
        if (!names.length) return fail('view-dtype-not-drawable', '/view')
      }
      const chart =
        view.chart === 'bar' && axis.variant?.kind === 'interval' ? 'interval-bar' : view.chart
      return {
        chart,
        axis: axis.token,
        ...(series === undefined ? {} : { series }),
        ...split(x, names),
      }
    }
    case 'heatmap': {
      if (view.encoding) {
        const { x: xName, y: yName, value } = view.encoding
        const xAxis = axisNamed(x, xName)
        if (!xAxis) return fail('view-name-unknown', '/view/encoding/x')
        const yAxis = axisNamed(x, yName)
        if (!yAxis || yAxis.token === xAxis.token)
          return fail('view-name-unknown', '/view/encoding/y')
        return (
          drawableValue(x, value, '/view/encoding/value') ?? {
            chart: 'heatmap',
            x: xAxis.token,
            y: yAxis.token,
            value,
          }
        )
      }
      const grid =
        c.shape === 'matrix'
          ? [c.categoryAxes[0]!, c.categoryAxes[1]!]
          : c.shape === 'time-category'
            ? [c.timeAxis!, c.categoryAxes[0]!]
            : undefined
      const values = split(
        x,
        c.primaryValues.filter((v) => drawable(x, v)),
      ).values
      if (!grid || values.length !== 1) return fail('view-target-ambiguous', '/view')
      return { chart: 'heatmap', x: grid[0]!, y: grid[1]!, value: values[0]! }
    }
    case 'comparison': {
      const targets = comparisonTargets(x)
      // Several groups on one saved row are one comparison table, unless a value or style was chosen.
      if (
        view.encoding?.value === undefined &&
        view.style === undefined &&
        singleRow(snapshot) &&
        targets.length > 1
      )
        return comparisonTable(x)
      const target = pick(x, targets, view.encoding?.value)
      if (failed(target)) return target
      const style = comparisonStyle(x, target, view.style ?? 'auto')
      if (failed(style)) return style
      return { chart: 'comparison', comparison: target.comparison, group: target.group, style }
    }
    case 'decomposition': {
      const target = pick(x, decompositionTargets(x), view.encoding?.value)
      if (failed(target)) return target
      const style = decompositionStyle(x, target, view.style ?? 'auto')
      if (failed(style)) return style
      if (readsWhole(style) && !x.complete) return fail('view-requires-complete-snapshot', '/view')
      return { chart: 'decomposition', decomposition: target.decomposition, style }
    }
  }
}
