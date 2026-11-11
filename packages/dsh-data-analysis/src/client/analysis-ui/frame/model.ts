import {
  comparisonLabelAlias,
  type FrameClassification,
  type FrameDisplay,
} from '../../../presentation/contracts/frame-view.ts'
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
import { columnLabel, compareDecimalText } from '../../presentation/model.ts'
import { columnOf, numberOf, rowsOf } from '../charts/model.ts'

export {
  cellOf,
  columnOf,
  exact,
  firstCell,
  isNumeric,
  numberOf,
  rowsOf,
  valueAt,
} from '../charts/model.ts'

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

/** Display metadata is scoped to this rendering and never written into the saved snapshot. */
export type Snapshot = FrameSnapshotV2 & { readonly frameDisplay?: FrameDisplay }
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

/** Δ in a neutral style: ▲/▼ plus the compact magnitude of the saved value. */
export function signed(locale: PresentationLocale, value: Cell, column?: DatasetColumn): string {
  const n = numberOf(value, column ?? { id: '', label: '', type: 'float64', nullable: true })
  if (value === null || n === null) return '—'
  const magnitude = typeof value === 'string' ? value.replace(/^-/, '') : Math.abs(n)
  const text = compact(locale, magnitude, column)
  return n > 0 ? `▲${text}` : n < 0 ? `▼${text}` : text
}
/** Saved fraction shown ×100 as a percent; `mark` adds ▲/▼ for relative change. */
export function percent(
  locale: PresentationLocale,
  value: number | null,
  mark: boolean,
  exact?: Cell,
  decimals = 2,
): string {
  // Multiplying a large fraction by 100 can overflow or lose integer precision.
  // Keep its saved spelling and make the percent conversion explicit instead.
  const raw =
    typeof exact === 'string' || typeof exact === 'number'
      ? String(exact)
      : value === null
        ? undefined
        : String(value)
  const numericText = raw && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
  const scaled = value === null ? null : Math.abs(value) * 100
  if (
    raw &&
    numericText &&
    ((value === null && !Number.isFinite(Number(raw))) ||
      (scaled !== null && (!Number.isFinite(scaled) || scaled > Number.MAX_SAFE_INTEGER)))
  ) {
    const negative = raw.startsWith('-')
    const text = mark ? raw.replace(/^[+-]/, '') : raw
    return `${mark ? (negative ? '▼' : '▲') : ''}${text} × 100%`
  }
  if (value === null) return '—'
  // Decimal strings can be nonzero even when their Number approximation underflows to zero.
  const sign =
    value === 0 && typeof exact === 'string' && /[1-9]/.test(exact.split(/[eE]/)[0] ?? '')
      ? exact.startsWith('-')
        ? -1
        : 1
      : Math.sign(value)
  const unit = 10 ** -decimals
  const magnitude = raw && numericText ? raw.replace(/^[+-]/, '') : String(Math.abs(value))
  if (sign !== 0 && compareDecimalText(magnitude, `5e-${decimals + 3}`) < 0) {
    const bound = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(unit)
    if (mark) return `${sign < 0 ? '▼' : '▲'}<${bound}%`
    return sign < 0 ? `>-${bound}%` : `<${bound}%`
  }
  const formatter = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  // NumberFormat consumes decimal strings with their original precision in supported runtimes.
  const formatted: unknown = Reflect.apply(formatter.format, undefined, [magnitude])
  const text = typeof formatted === 'string' ? formatted : `${magnitude} × 100%`
  if (!mark) return `${sign < 0 ? '-' : ''}${text}`
  return sign > 0 ? `▲${text}` : sign < 0 ? `▼${text}` : text
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
  const format = s.frameDisplay?.formats?.find((item) => item.value === column.id)
  if (format?.format === 'percent')
    return percent(locale, numberOf(value, column), false, value, format.decimals ?? 2)
  if (format) {
    if (numberOf(value, column) === null)
      return column.unit && column.unit !== '1' ? `${String(value)} ${column.unit}` : String(value)
    const decimals = format.decimals ?? 2
    const options = {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }
    let formatter: Intl.NumberFormat
    try {
      formatter = new Intl.NumberFormat(locale, {
        ...options,
        ...(format.format === 'currency' && column.unit
          ? {
              style: 'currency',
              currency: column.unit,
              ...(column.unit === 'USD' ? { currencyDisplay: 'narrowSymbol' } : {}),
            }
          : {}),
      })
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      // Intl cannot format compound units as currency; preserve the saved unit verbatim.
      formatter = new Intl.NumberFormat(locale, options)
    }
    const result: unknown = Reflect.apply(formatter.format, undefined, [value])
    if (typeof result !== 'string') return String(value)
    return formatter.resolvedOptions().style !== 'currency' && column.unit && column.unit !== '1'
      ? `${result} ${column.unit}`
      : result
  }
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
    return percent(locale, numberOf(value, column), !!relative, value)
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
      second: '2-digit',
      timeZoneName: 'longOffset',
      hourCycle: 'h23',
    }).formatToParts(date)
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    return {
      y: part('year'),
      m: part('month'),
      d: part('day'),
      h: part('hour'),
      mi: part('minute'),
      sec: part('second'),
      fraction: /\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/i.exec(iso)?.[1] ?? '',
      offset: part('timeZoneName'),
    }
  } catch {
    return undefined
  }
}
type Unit = Extract<FrameGrain, { kind: 'builtin' }>['unit']
const civilDateTime =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?:[T ](\d\d:\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|[+-]\d\d(?::?\d\d)?)?)?$/

function calendarClock(label: string, grain?: FrameGrain) {
  if (grain?.kind !== 'builtin' || !['hour', 'minute', 'second'].includes(grain.unit))
    return undefined
  // Calendar labels are saved civil times. Keep their offset for repeated
  // local hours and leave the original coordinate available to the data view.
  const [, date, minute, second, offset] = civilDateTime.exec(label) ?? []
  if (!date || !minute) return undefined
  const time = grain.unit === 'second' && second ? `${minute}:${second}` : minute
  return {
    label: `${date.slice(5)} ${time}`,
    title: `${date} ${time}${offset ? ` ${offset}` : ''}`,
  }
}

export function chartMemberLabel(s: Snapshot, axis: FrameAxis, row: number): string {
  const label = memberLabel(s, axis, row)
  const grain = axis.variant?.kind === 'calendar' ? axis.variant.grain : undefined
  return calendarClock(label, grain)?.title ?? label
}

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
    case 'second':
      return `${p.m}-${p.d} ${p.h}:${p.mi}:${p.sec}`
    default:
      return `${p.m}-${p.d} ${p.h}:${p.mi}`
  }
}

function calendarChartTick(label: string, grain?: FrameGrain) {
  const clock = calendarClock(label, grain)
  if (clock) return clock
  if (grain?.kind !== 'builtin' || ['hour', 'minute', 'second'].includes(grain.unit))
    return undefined
  const date = civilDateTime.exec(label)?.[1]
  if (!date) return undefined
  if (grain.unit === 'day') return { label: date.slice(5), title: date }
  let period: string
  switch (grain.unit) {
    case 'month':
      period = date.slice(0, 7)
      break
    case 'quarter':
      period = `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`
      break
    case 'year':
      period = date.slice(0, 4)
      break
    default:
      period = instantText(`${date}T00:00:00Z`, 'UTC', grain.unit)
  }
  return { label: period, title: period }
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
    const tick = calendarChartTick(label, grain)
    return {
      key: JSON.stringify(item.key),
      label: tick?.label ?? label,
      title: `${tick?.title ?? label} · ${periodDetail(t, item)}`,
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
  const tick = calendarChartTick(String(item.label ?? ''), grain)
  const nominal = tick || incomplete ? undefined : dateParts(item.nominalStart, item.timezone)
  const civil = nominal
    ? `${nominal.y}-${nominal.m}-${nominal.d}T${nominal.h}:${nominal.mi}:${nominal.sec}${nominal.offset.slice(3) || 'Z'}`
    : ''
  const nominalTick = tick ?? calendarChartTick(civil, grain)
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
      : (nominalTick?.title ?? range),
    incomplete,
  }
}
/**
 * Ticks for a time axis. A captured `read_periods` page keeps every period,
 * including those without a data row, so missing periods leave a gap.
 */
export function timeTicks(t: Translator, s: Snapshot, axis: FrameAxis) {
  const pages = periodsOf(s)?.pages.filter(
    (p) => p.target.kind === 'axis' && p.target.axisToken === axis.token,
  )
  const items = (pages ?? []).flatMap((page) =>
    page.items.filter((item) => item.kind === 'calendar' || item.kind === 'interval'),
  )
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = JSON.stringify(item.key)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ticks: Tick[] = []
  for (const item of items)
    if (counts.get(JSON.stringify(item.key)) === 1) ticks.push(periodTick(t, item, axis.variant))
  const index = new Map(ticks.map((tick, i) => [tick.key, i]))
  const variant = axis.variant
  const timezone = variant && 'timezone' in variant ? variant.timezone : 'UTC'
  const unit: Unit =
    variant?.kind === 'calendar' && variant.grain.kind === 'builtin' ? variant.grain.unit : 'day'
  for (const row of rowsOf(s)) {
    const key = axisKey(s, axis, row)
    if (index.has(key)) continue
    const first = s.frame.coordinates[axis.keys[0]!.slotId]?.values[row]
    const member = memberLabel(s, axis, row)
    const tick = calendarChartTick(member, variant?.kind === 'calendar' ? variant.grain : undefined)
    const label =
      tick?.label ??
      (variant?.kind === 'calendar' && variant.grain.kind === 'named'
        ? member
        : typeof first === 'string' && Number.isFinite(Date.parse(first))
          ? instantText(first, timezone, unit)
          : member)
    index.set(key, ticks.length)
    ticks.push({ key, label, title: tick?.title ?? member, incomplete: false })
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
/** Only saved statistic contexts carry aggregation facts. */
export function aggregationSymbol(context: FrameValueContext | null | undefined): string {
  if (context?.kind !== 'statistic' && context?.kind !== 'pair_statistic') return ''
  switch (context.statistic) {
    case 'sum':
      return 'Σ'
    case 'mean':
      return 'μ'
    case 'row_count':
      return '#'
    case 'pair_count':
      return 'n'
    default:
      return ''
  }
}

function fixedTimeLabel(time: { start: string; end: string; timezone: string }): string {
  const format = (instant: string) => {
    const parts = dateParts(instant, time.timezone)
    return parts ? preciseInstant(parts) : instant
  }
  return `${format(time.start)} – ${format(time.end)}`
}

/** A single saved time context for the card header. */
export function headerContext(
  t: Translator,
  s: Snapshot,
  values: string[],
  comparison?: number,
): string | undefined {
  if (comparison !== undefined) {
    const ends = endpointLabels(t, s, comparison)
    if (ends.specific) return `${ends.current} ⇄ ${ends.baseline}`
  }
  const interpretation = interpretationOf(s)
  for (const name of values) {
    const context = interpretation?.valueContexts[name]
    if (context?.kind === 'observation' && context.time?.kind === 'fixed') {
      return fixedTimeLabel(context.time)
    }
  }
  const axis = s.frame.axes.find((item) => item.variant?.kind === 'calendar')
  if (axis?.variant?.kind === 'calendar') {
    const count = new Set(s.data.rows.map((_, row) => axisKey(s, axis, row))).size
    return `${grainLabel(t, axis.variant.grain)} · ${count}`
  }
  return undefined
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
        label: fixedTimeLabel(context.time),
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
function preciseInstant(part: NonNullable<ReturnType<typeof dateParts>>): string {
  const fraction = /[1-9]/.test(part.fraction) ? `.${part.fraction}` : ''
  const seconds = part.sec !== '00' || fraction ? `:${part.sec}${fraction}` : ''
  return `${part.y}-${part.m}-${part.d} ${part.h}:${part.mi}${seconds} ${part.offset}`
}
function intervalText(p: Extract<Period, { kind: 'interval' }>): string {
  const start = dateParts(p.start, p.timezone)
  const end = dateParts(p.end, p.timezone)
  if (!start || !end) return periodRange(p)
  // The saved end is exclusive; only civil-midnight endpoints name a calendar span.
  const midnight = (part: typeof start) =>
    part.h === '00' && part.mi === '00' && part.sec === '00' && !/[1-9]/.test(part.fraction)
  if (!midnight(start) || !midnight(end)) return `${preciseInstant(start)} – ${preciseInstant(end)}`
  const startDay = Date.UTC(Number(start.y), Number(start.m) - 1, Number(start.d))
  const endDay = Date.UTC(Number(end.y), Number(end.m) - 1, Number(end.d))
  const nextMonth = Date.UTC(Number(start.y), Number(start.m), 1)
  const nextYear = Date.UTC(Number(start.y) + 1, 0, 1)
  if (start.m === '01' && start.d === '01' && endDay === nextYear) return start.y
  if (start.d === '01' && endDay === nextMonth) return `${start.y}-${start.m}`
  if (endDay - startDay === 86_400_000) return `${start.y}-${start.m}-${start.d}`
  return `${start.y}-${start.m}-${start.d} ~ ${dayText(endDay - 86_400_000)}`
}
function periodText(p: Period | null, grain?: FrameGrain): string {
  if (!p) return '—'
  if (p.kind === 'interval') return intervalText(p)
  if (p.label !== null) {
    const label = String(p.label)
    const clock = calendarClock(label, grain)
    if (clock) return clock.title
    // Only standard civil period starts with an exact captured grain admit abbreviation.
    if (grain?.kind === 'builtin' && grain.step === 1 && /^\d{4}-\d{2}-01$/.test(label)) {
      const date = new Date(`${label}T00:00:00Z`)
      if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === label) {
        if (grain.unit === 'month') return label.slice(0, 7)
        if (grain.unit === 'year' && label.endsWith('-01-01')) return label.slice(0, 4)
      }
    }
    return label
  }
  if (!('nominalStart' in p)) return '—'
  if (grain?.kind !== 'builtin') return p.nominalStart
  if (['hour', 'minute', 'second'].includes(grain.unit)) {
    const parts = dateParts(p.nominalStart, p.timezone)
    return parts ? preciseInstant(parts) : p.nominalStart
  }
  return instantText(p.nominalStart, p.timezone, grain.unit === 'day' ? 'date' : grain.unit)
}
/** What a comparison compares: captured pairs of period labels or differing fixed members. */
export function endpointLabels(t: Translator, s: Snapshot, index: number) {
  const comparison = interpretationOf(s)?.comparisons[index]
  const fallback = {
    current: t(`${P}ui-frame-current`),
    baseline: t(`${P}ui-frame-baseline`),
    specific: false,
  }
  if (!comparison) return fallback
  const explicit = s.frameDisplay?.comparisonLabels?.filter(
    (item) => comparisonLabelAlias(item) === comparison.alias,
  )
  if (
    explicit?.length === 1 &&
    interpretationOf(s)?.comparisons.filter((item) => item.alias === comparison.alias).length === 1
  )
    return { current: explicit[0]!.current, baseline: explicit[0]!.baseline, specific: true }
  if (comparison.binding.kind !== 'ordinary') {
    const page = comparisonPeriodPage(s, index)
    if (!page || page.hasMore || page.items.length !== page.totalCount) return fallback
    const items = comparisonPeriods(s, index)
    if (items.length !== page.items.length || items.some((item) => !item.baseline)) return fallback
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return fallback
    const grains = comparisonPeriodGrains(s, index)
    const current = [
      periodText(first.current, grains.current),
      periodText(last.current, grains.current),
    ]
    const baseline = [
      periodText(first.baseline, grains.baseline),
      periodText(last.baseline, grains.baseline),
    ]
    if ([...current, ...baseline].some((label) => !label || label === '—')) return fallback
    const range = (a: string, b: string) => (a === b ? a : `${a} – ${b}`)
    return {
      current: range(current[0]!, current[1]!),
      baseline: range(baseline[0]!, baseline[1]!),
      specific: true,
    }
  }
  const currentAxes = comparison.currentFixedAxes
  const baselineAxes = comparison.baselineFixedAxes
  if (
    currentAxes.length !== baselineAxes.length ||
    new Set(currentAxes.map((axis) => axis.token)).size !== currentAxes.length ||
    new Set(baselineAxes.map((axis) => axis.token)).size !== baselineAxes.length ||
    currentAxes.some((axis) => !baselineAxes.some((other) => other.token === axis.token)) ||
    [...currentAxes, ...baselineAxes].some((axis) => axis.key.some((value) => value === null))
  )
    return fallback
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
        specific: true,
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
/** Resolve only the captured comparison axis endpoint; missing or ambiguous axes supply no grain. */
export function comparisonPeriodGrains(s: Snapshot, index: number) {
  const binding = interpretationOf(s)?.comparisons[index]?.binding
  if (binding?.kind !== 'calendar') return {}
  const axes = s.frame.axes.filter((axis) => axis.token === binding.axisToken)
  const variant = axes.length === 1 ? axes[0]?.variant : undefined
  const endpoint =
    binding.endpoint === 'self'
      ? variant
      : variant?.kind === 'paired'
        ? variant[binding.endpoint]
        : undefined
  return {
    current: endpoint?.kind === 'calendar' ? endpoint.grain : undefined,
    baseline: binding.baseline.grain,
  }
}
export function periodLabel(p: Period | null, grain?: FrameGrain): string {
  return periodText(p, grain)
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
