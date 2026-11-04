import type { Cell, DatasetColumn, PresentationLocale } from '../../presentation/contracts/types.ts'

// Readable display text for Frame views; the saved cells and copied data are unchanged.
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

/** Locale display text for saved Frame values. */
export function displayCell(
  locale: PresentationLocale,
  value: Cell,
  column: DatasetColumn,
  timezone = 'UTC',
): string {
  if (value === null) return MISSING_DISPLAY
  switch (column.type) {
    case 'float64':
    case 'decimal': {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return String(value)
      const formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...(column.unit === 'USD' ? { style: 'currency', currency: 'USD' } : {}),
      })
      // Intl accepts decimal strings without first losing precision to a JS number.
      const formatted: unknown = Reflect.apply(formatter.format, undefined, [value])
      return typeof formatted === 'string' ? formatted : String(value)
    }
    case 'int64':
      try {
        return new Intl.NumberFormat(
          locale,
          column.unit === 'USD'
            ? { style: 'currency', currency: 'USD' }
            : { maximumFractionDigits: 0 },
        ).format(BigInt(String(value)))
      } catch {
        return String(value)
      }
    case 'datetime':
      return datetimeText(String(value), timezone)
    default:
      return String(value)
  }
}
