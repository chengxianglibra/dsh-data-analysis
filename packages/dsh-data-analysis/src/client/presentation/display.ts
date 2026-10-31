import type { Cell, DatasetColumn, PresentationLocale } from '../../presentation/contracts/types.ts'

// Readable display text for Frame tables. Copy and tooltips keep `formatCell`'s
// exact saved spelling, so grouping and rounding here never change the data.
export const MISSING_DISPLAY = '—'

function datetimeText(text: string, timezone: string): string {
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return text
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
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
  } catch {
    return text
  }
}

/** Locale display text; exact int64/decimal strings are never rounded or reformatted away. */
export function displayCell(
  locale: PresentationLocale,
  value: Cell,
  column: DatasetColumn,
  timezone = 'UTC',
): string {
  if (value === null) return MISSING_DISPLAY
  switch (column.type) {
    case 'float64': {
      const number = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(number)
        ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(number)
        : String(value)
    }
    case 'int64':
      try {
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
          BigInt(String(value)),
        )
      } catch {
        return String(value)
      }
    case 'decimal':
      return String(value)
    case 'datetime':
      return datetimeText(String(value), timezone)
    default:
      return String(value)
  }
}
