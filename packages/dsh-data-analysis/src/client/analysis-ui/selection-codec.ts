import type {
  ResolvedSnapshotFilter,
  SnapshotFilterValue,
} from '../../presentation/contracts/snapshot-filter.ts'

export const optionId = (value: SnapshotFilterValue) => `v:${JSON.stringify(value)}`

export function dateFromDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const result = new Date(0)
  result.setHours(12, 0, 0, 0)
  result.setFullYear(year!, month! - 1, date!)
  // Some local timezones have skipped an entire civil date. JS silently
  // normalizes such values into another day, which must never be filtered.
  if (dayFromDate(result) !== day) throw new RangeError('analysis-filter-date-unrepresentable')
  return result
}

function dayFromDate(value: unknown): string | undefined {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return undefined
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

/** Decode a date range without treating malformed state as an unfiltered selection. */
function dateRangeSelection(value: unknown): string[] | undefined {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return undefined
  if (typeof value !== 'object') return undefined
  const keys = Object.keys(value)
  if (!keys.length) return []
  if (keys.length !== 2 || !keys.includes('from') || !keys.includes('to')) return undefined
  if (!('from' in value) || !('to' in value)) return undefined
  const from = dayFromDate(value.from)
  const to = dayFromDate(value.to)
  return from && to && from <= to ? [from, to] : undefined
}

/** Check a draft before an OpenUI action copies it to an applied variable. */
export function validSelectionDraft(
  draft: unknown,
  items: readonly { id: string }[],
  mode: string,
  allowAll: boolean,
): boolean {
  if (mode === 'date-range') {
    const selected = dateRangeSelection(draft)
    return selected !== undefined && (allowAll || selected.length > 0)
  }
  if (mode === 'multiple') {
    if (
      !draft ||
      typeof draft !== 'object' ||
      Object.prototype.toString.call(draft) !== '[object Object]'
    )
      return false
    const available = new Set(items.map((item) => item.id))
    const entries = Object.entries(draft)
    return (
      entries.every(([id, value]) => available.has(id) && typeof value === 'boolean') &&
      (allowAll || entries.some(([, value]) => value === true))
    )
  }
  return (
    typeof draft === 'string' &&
    (draft === 'a' ? allowAll : items.some((item) => item.id === draft))
  )
}

export function decodeSelection(
  definition: ResolvedSnapshotFilter,
  raw: unknown,
): SnapshotFilterValue[] | undefined {
  const { mode } = definition.declaration
  if (mode === 'date-range') return dateRangeSelection(raw)
  if (mode === 'multiple') {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Object.prototype.toString.call(raw) !== '[object Object]'
    )
      return undefined
    const candidates = new Map(definition.options.map((value) => [optionId(value), value]))
    const entries = Object.entries(raw)
    if (entries.some(([id, value]) => !candidates.has(id) || typeof value !== 'boolean'))
      return undefined
    return entries.filter(([, selected]) => selected).map(([id]) => candidates.get(id)!)
  }
  const ids = raw === 'a' ? [] : typeof raw === 'string' ? [raw] : undefined
  if (!ids) return undefined
  const candidates = new Map(definition.options.map((value) => [optionId(value), value]))
  if (ids.some((id) => !candidates.has(id))) return undefined
  return ids.map((id) => candidates.get(id)!)
}
