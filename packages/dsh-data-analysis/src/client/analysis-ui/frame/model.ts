import type { FrameClassification } from '../../../presentation/contracts/frame-view.ts'
import type {
  FrameAxisVariant,
  FrameFixedAxis,
  FrameGrain,
  FrameInterpretation,
  FramePeriods,
  FrameSnapshotV2,
  FrameValueContext,
} from '../../../presentation/contracts/snapshot.ts'
import type {
  Cell,
  DatasetColumn,
  PresentationLocale,
} from '../../../presentation/contracts/types.ts'
import type { Translator } from '../../i18n/copy.ts'
import { displayCell } from '../../presentation/display.ts'
import { columnLabel } from '../../presentation/model.ts'
import { numberOf } from '../charts/model.ts'

export { exact, isNumeric, numberOf } from '../charts/model.ts'

/** Full, grouped numbers for Frame values; axis tick abbreviations are separate. */
export function compact(locale: PresentationLocale, value: Cell, column?: DatasetColumn): string {
  return displayCell(
    locale,
    value,
    column ?? { id: '', label: '', type: 'float64', nullable: true },
  )
}

// Pure read helpers over saved Frame facts. Nothing here aggregates or derives
// new numbers; positions and labels only format or select saved column values.

export type Snapshot = FrameSnapshotV2
export type FrameAxis = Snapshot['frame']['axes'][number]
type PeriodItem = FramePeriods['pages'][number]['items'][number]
type Period = Extract<PeriodItem, { kind: 'calendar' | 'interval' }>

const P = 'marivo.presentation.'

export function interpretationOf(s: Snapshot): FrameInterpretation | undefined {
  const section = s.frame.sections.interpretation
  return typeof section === 'object' && section.status === 'captured' ? section : undefined
}
export function periodsOf(s: Snapshot): FramePeriods | undefined {
  const section = s.frame.sections.periods
  return typeof section === 'object' && section.status === 'captured' ? section : undefined
}

export function columnOf(s: Snapshot, name: string) {
  const index = s.data.columns.findIndex((c) => c.id === name)
  return index < 0 ? undefined : { index, column: s.data.columns[index]! }
}
export function cellOf(s: Snapshot, row: number, name: string): Cell {
  const c = columnOf(s, name)
  return c ? (s.data.rows[row]?.[c.index] ?? null) : null
}
export function valueAt(s: Snapshot, row: number, name: string): number | null {
  return numberOf(cellOf(s, row, name), columnOf(s, name)?.column)
}
export function rowsOf(s: Snapshot): number[] {
  return s.data.rows.map((_, i) => i)
}

/** Δ in a neutral style: ▲/▼ plus the compact magnitude of the saved value. */
export function signed(locale: PresentationLocale, value: Cell, column?: DatasetColumn): string {
  const n = numberOf(value, column ?? { id: '', label: '', type: 'float64', nullable: true })
  if (value === null || n === null) return '—'
  const magnitude = typeof value === 'string' ? value.replace(/^-/, '') : Math.abs(n)
  const text = compact(locale, magnitude, column)
  return n > 0 ? `▲${text}` : n < 0 ? `▼${text}` : text
}
/** Saved fraction shown ×100 as a percent; `mark` adds ▲/▼ for relative change. */
export function percent(locale: PresentationLocale, value: number | null, mark: boolean): string {
  if (value === null) return '—'
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value) * 100)
  if (!mark) return `${value < 0 ? '-' : ''}${text}%`
  return value > 0 ? `▲${text}%` : value < 0 ? `▼${text}%` : `${text}%`
}

/** Display a Frame cell using the saved semantic role when one is available. */
export function displayFrameCell(
  s: Snapshot,
  locale: PresentationLocale,
  value: Cell,
  column: DatasetColumn,
  timezone = 'UTC',
): string {
  if (value === null) return '—'
  const facts = interpretationOf(s)
  const context = facts?.valueContexts[column.id]
  const relative = facts?.comparisons.some((comparison) =>
    comparison.groups.some((group) =>
      group.values.some((item) => item.name === column.id && item.role === 'relative'),
    ),
  )
  const share = facts?.decompositions.some((decomposition) =>
    decomposition.outputs.some((item) => item.name === column.id && item.role === 'share'),
  )
  if (context?.kind === 'share' || relative || share)
    return percent(locale, numberOf(value, column), !!relative)
  if (
    context?.kind === 'pair_statistic' &&
    (context.statistic === 'pearson' || context.statistic === 'spearman')
  ) {
    const number = numberOf(value, column)
    return number === null
      ? String(value)
      : new Intl.NumberFormat(locale, {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
        }).format(number)
  }
  return displayCell(locale, value, column, timezone)
}

export function valueName(s: Snapshot, c: FrameClassification | undefined, name: string): string {
  const column = columnOf(s, name)?.column
  const label = column ? columnLabel(column) : name
  const symbol = c?.symbols[name]
  return symbol ? `${symbol} ${label}` : label
}

export function axisOf(s: Snapshot, ref: string | undefined): FrameAxis | undefined {
  if (!ref) return undefined
  return s.frame.axes.find((a) => a.token === ref) ?? s.frame.axes.find((a) => a.name === ref)
}
function cellText(value: Cell | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}
export function axisKey(s: Snapshot, axis: FrameAxis, row: number): string {
  return JSON.stringify(axis.keys.map((k) => s.frame.coordinates[k.slotId]?.values[row] ?? null))
}
export function memberLabel(s: Snapshot, axis: FrameAxis, row: number): string {
  const label = s.frame.layout.findIndex(
    (l) =>
      l.kind === 'coordinate' &&
      l.axisToken === axis.token &&
      l.endpoint === 'self' &&
      l.part === 'label',
  )
  const saved = label < 0 ? null : (s.data.rows[row]?.[label] ?? null)
  if (saved !== null) return String(saved)
  return axis.keys.map((k) => cellText(s.frame.coordinates[k.slotId]?.values[row])).join(' · ')
}
export function membersLabel(s: Snapshot, axes: FrameAxis[], row: number): string {
  return axes.map((a) => memberLabel(s, a, row)).join(' · ')
}
export function fixedLabel(item: FrameFixedAxis): string {
  return item.key.map(cellText).join(' · ')
}
/** Rows grouped by axis keys in first-appearance (Frame) order. */
export function groupRows(s: Snapshot, axes: FrameAxis[], rows = rowsOf(s)) {
  const groups = new Map<string, { label: string; rows: number[] }>()
  for (const row of rows) {
    const key = JSON.stringify(axes.map((a) => axisKey(s, a, row)))
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { label: membersLabel(s, axes, row), rows: [row] })
  }
  return [...groups].map(([key, group]) => ({ key, ...group }))
}

function dateParts(iso: string, timezone: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    return {
      y: part('year'),
      m: part('month'),
      d: part('day'),
      h: part('hour'),
      mi: part('minute'),
    }
  } catch {
    return undefined
  }
}
type Unit = Extract<FrameGrain, { kind: 'builtin' }>['unit']
/** Tick text by grain: day MM-DD, month YYYY-MM; never computed from row positions. */
export function instantText(iso: string, timezone: string, unit: Unit | 'full' | 'date'): string {
  const p = dateParts(iso, timezone)
  if (!p) return iso
  switch (unit) {
    case 'year':
      return p.y
    case 'quarter':
      return `${p.y}-Q${Math.floor((Number(p.m) - 1) / 3) + 1}`
    case 'month':
      return `${p.y}-${p.m}`
    case 'week': {
      // ISO week of the period start, matching Marivo's YYYY-Www labels.
      const date = new Date(Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d)))
      const day = date.getUTCDay() || 7
      date.setUTCDate(date.getUTCDate() + 4 - day)
      const year = date.getUTCFullYear()
      const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
      return `${year}-W${String(week).padStart(2, '0')}`
    }
    case 'day':
      return `${p.m}-${p.d}`
    case 'date':
      return `${p.y}-${p.m}-${p.d}`
    case 'full':
      return `${p.y}-${p.m}-${p.d} ${p.h}:${p.mi}`
    default:
      return `${p.m}-${p.d} ${p.h}:${p.mi}`
  }
}

export interface Tick {
  key: string
  label: string
  title: string
  incomplete: boolean
}
/** Describe only saved calendar selection facts; its bounds are not available. */
export function periodDetail(t: Translator, item: Period | null): string {
  if (!item) return ''
  if (item.kind === 'calendar' && 'selection' in item) {
    const description = t(`${P}ui-frame-selection-${item.selection}`)
    return item.cutoff ? `${description}: ${item.cutoff}` : description
  }
  return periodRange(item)
}

function periodTick(t: Translator, item: Period, variant?: FrameAxisVariant): Tick {
  if (item.kind === 'calendar' && 'selection' in item) {
    const label = item.label === null ? '—' : String(item.label)
    // Builtin labels are saved civil strings; abbreviate them without timezone conversion.
    const grain = variant?.kind === 'calendar' ? variant.grain : undefined
    const abbreviated =
      grain?.kind === 'builtin' && grain.unit === 'day' && /^\d{4}-\d{2}-\d{2}/.test(label)
        ? label.slice(5, 10)
        : grain?.kind === 'builtin' && grain.unit === 'month' && /^\d{4}-\d{2}/.test(label)
          ? label.slice(0, 7)
          : label
    return {
      key: JSON.stringify(item.key),
      label: abbreviated,
      title: `${label} · ${periodDetail(t, item)}`,
      incomplete: item.selection !== 'full',
    }
  }
  const full = (iso: string) => instantText(iso, item.timezone, 'full')
  const range = `${full(item.start)} – ${full(item.end)}`
  if (item.kind === 'interval')
    return {
      key: JSON.stringify(item.key),
      label: instantText(item.start, item.timezone, 'day'),
      title: range,
      incomplete: false,
    }
  const grain = variant?.kind === 'calendar' ? variant.grain : undefined
  const label =
    grain?.kind === 'builtin'
      ? instantText(item.nominalStart, item.timezone, grain.unit)
      : item.label !== null
        ? String(item.label)
        : instantText(item.nominalStart, item.timezone, 'day')
  const incomplete = item.start !== item.nominalStart || item.end !== item.nominalEnd
  return {
    key: JSON.stringify(item.key),
    label,
    title: incomplete
      ? t(`${P}ui-frame-period-bounds`, {
          p0: full(item.start),
          p1: full(item.end),
          p2: full(item.nominalStart),
          p3: full(item.nominalEnd),
        })
      : range,
    incomplete,
  }
}
/**
 * Ticks for a time axis. A captured `read_periods` page keeps every period,
 * including those without a data row, so missing periods leave a gap.
 */
export function timeTicks(t: Translator, s: Snapshot, axis: FrameAxis) {
  const page = periodsOf(s)?.pages.find(
    (p) => p.target.kind === 'axis' && p.target.axisToken === axis.token,
  )
  const ticks: Tick[] = []
  for (const item of page?.items ?? [])
    if (item.kind === 'calendar' || item.kind === 'interval')
      ticks.push(periodTick(t, item, axis.variant))
  const index = new Map(ticks.map((tick, i) => [tick.key, i]))
  const variant = axis.variant
  const timezone = variant && 'timezone' in variant ? variant.timezone : 'UTC'
  const unit: Unit =
    variant?.kind === 'calendar' && variant.grain.kind === 'builtin' ? variant.grain.unit : 'day'
  for (const row of rowsOf(s)) {
    const key = axisKey(s, axis, row)
    if (index.has(key)) continue
    const first = s.frame.coordinates[axis.keys[0]!.slotId]?.values[row]
    const label =
      variant?.kind === 'calendar' && variant.grain.kind === 'named'
        ? memberLabel(s, axis, row)
        : typeof first === 'string' && Number.isFinite(Date.parse(first))
          ? instantText(first, timezone, unit)
          : memberLabel(s, axis, row)
    index.set(key, ticks.length)
    ticks.push({ key, label, title: memberLabel(s, axis, row), incomplete: false })
  }
  return { ticks, tickOf: (row: number) => index.get(axisKey(s, axis, row)) ?? -1 }
}

function grainLabel(t: Translator, grain: FrameGrain): string {
  if (grain.kind === 'named') return grain.level
  const unit = t(`${P}ui-frame-grain-${grain.unit}`)
  return grain.step === 1 ? unit : t(`${P}ui-frame-grain-step`, { p0: grain.step, p1: unit })
}
function windowLabel(
  t: Translator,
  w: NonNullable<Extract<FrameValueContext, { kind: 'observation' }>['window']>,
): string {
  switch (w.kind) {
    case 'all_history':
      return t(`${P}ui-frame-window-all-history`)
    case 'since':
      return t(`${P}ui-frame-window-since`, { p0: w.start.slice(0, 10) })
    case 'to_date':
      return t(`${P}ui-frame-window-to-date`, { p0: grainLabel(t, w.grain) })
    case 'trailing_periods':
      return t(`${P}ui-frame-window-trailing-periods`, { p0: w.count })
    case 'trailing_duration':
      return w.seconds % 86400 === 0
        ? t(`${P}ui-frame-window-trailing-days`, { p0: w.seconds / 86400 })
        : w.seconds % 3600 === 0
          ? t(`${P}ui-frame-window-trailing-hours`, { p0: w.seconds / 3600 })
          : t(`${P}ui-frame-window-trailing-seconds`, { p0: w.seconds })
  }
}

export interface Chip {
  label: string
  title?: string
}
/** Context chips from saved facts only; absent facts produce no chip. */
export function contextChips(t: Translator, s: Snapshot, values: string[]): Chip[] {
  const chips: Chip[] = []
  const add = (chip: Chip) => {
    if (!chips.some((c) => c.label === chip.label)) chips.push(chip)
  }
  const interpretation = interpretationOf(s)
  for (const item of interpretation?.fixedAxes ?? [])
    add({ label: fixedLabel(item), title: item.name })
  for (const name of values) {
    const context = interpretation?.valueContexts[name]
    if (context?.kind !== 'observation') continue
    if (context.window) add({ label: windowLabel(t, context.window) })
    if (context.time?.kind === 'fixed')
      add({
        label: `${instantText(context.time.start, context.time.timezone, 'day')} – ${instantText(context.time.end, context.time.timezone, 'day')}`,
        title: context.time.timezone,
      })
  }
  for (const axis of s.frame.axes) {
    const v = axis.variant
    if (v?.kind === 'calendar')
      add({ label: `${grainLabel(t, v.grain)} · ${v.timezone}`, title: axis.name })
    else if (v?.kind === 'interval') add({ label: v.timezone, title: axis.name })
  }
  return chips
}

/** Civil date text from a UTC day number, independent of the viewer's local time. */
function dayText(day: number): string {
  const date = new Date(day)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`
}
function intervalText(p: Extract<Period, { kind: 'interval' }>): string {
  const start = dateParts(p.start, p.timezone)
  const end = dateParts(p.end, p.timezone)
  if (!start || !end) return periodRange(p)
  // The saved end is exclusive; only civil-midnight endpoints name a calendar span.
  if (start.h !== '00' || start.mi !== '00' || end.h !== '00' || end.mi !== '00')
    return `${instantText(p.start, p.timezone, 'full')} – ${instantText(p.end, p.timezone, 'full')}`
  const startDay = Date.UTC(Number(start.y), Number(start.m) - 1, Number(start.d))
  const endDay = Date.UTC(Number(end.y), Number(end.m) - 1, Number(end.d))
  const nextMonth = Date.UTC(Number(start.y), Number(start.m), 1)
  if (start.d === '01' && endDay === nextMonth) return `${start.y}-${start.m}`
  if (endDay - startDay === 86_400_000) return `${start.y}-${start.m}-${start.d}`
  return `${start.y}-${start.m}-${start.d} ~ ${dayText(endDay - 86_400_000)}`
}
function periodText(p: Period | null): string {
  if (!p) return '—'
  if (p.kind === 'calendar' && p.label !== null) return String(p.label)
  return p.kind === 'calendar'
    ? 'nominalStart' in p
      ? instantText(p.nominalStart, p.timezone, 'day')
      : '—'
    : intervalText(p)
}
/** What a comparison compares: period labels, differing fixed members, else the alias. */
export function endpointLabels(t: Translator, s: Snapshot, index: number) {
  const comparison = interpretationOf(s)?.comparisons[index]
  const fallback = {
    current: t(`${P}ui-frame-current`),
    baseline: comparison?.alias ?? t(`${P}ui-frame-baseline`),
  }
  if (!comparison) return fallback
  if (comparison.binding.kind !== 'ordinary') {
    const page = comparisonPeriodPage(s, index)
    if (page?.hasMore) return fallback
    const items = comparisonPeriods(s, index)
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return fallback
    const range = (a: string, b: string) => (a === b ? a : `${a} – ${b}`)
    return {
      current: range(periodText(first.current), periodText(last.current)),
      baseline: range(periodText(first.baseline), periodText(last.baseline)),
    }
  }
  const pairs = comparison.currentFixedAxes.flatMap((a) => {
    const b = comparison.baselineFixedAxes.find((x) => x.token === a.token)
    return b && JSON.stringify(a.key) !== JSON.stringify(b.key)
      ? [[fixedLabel(a), fixedLabel(b)]]
      : []
  })
  return pairs.length
    ? {
        current: pairs.map((p) => p[0]).join(' · '),
        baseline: pairs.map((p) => p[1]).join(' · '),
      }
    : fallback
}
export function comparisonPeriodPage(s: Snapshot, index: number) {
  return periodsOf(s)?.pages.find(
    (p) => p.target.kind === 'comparison' && p.target.comparison === index,
  )
}
export function comparisonPeriods(s: Snapshot, index: number) {
  return (comparisonPeriodPage(s, index)?.items ?? []).flatMap((item) =>
    item.kind === 'comparison' ? [item] : [],
  )
}
export function periodRange(p: Period | null): string {
  if (!p) return '—'
  if (p.kind === 'calendar' && 'selection' in p) return ''
  return `${instantText(p.start, p.timezone, 'full')} – ${instantText(p.end, p.timezone, 'full')}`
}
export function periodLabel(p: Period | null): string {
  return periodText(p)
}

/** Rows grouped by the partition axes of a broadcast statistic (`over`). */
export function partitions(s: Snapshot, name: string) {
  const context = interpretationOf(s)?.valueContexts[name]
  const tokens =
    context && context.kind !== 'observation'
      ? context.groups.flatMap((g) => (g.kind === 'axis' ? [g.axisToken] : []))
      : []
  const axes = s.frame.axes.filter((a) => tokens.includes(a.token))
  return groupRows(s, axes)
}
/** First non-null saved value of a column within rows; broadcast values are equal per partition. */
export function firstCell(s: Snapshot, rows: number[], name: string): { row: number; value: Cell } {
  for (const row of rows) {
    const value = cellOf(s, row, name)
    if (value !== null) return { row, value }
  }
  return { row: rows[0] ?? 0, value: null }
}
