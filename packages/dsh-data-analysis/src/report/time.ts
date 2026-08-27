import type { JsonValue } from '@deepseek-ai/dsh-session'

const EXPLICIT_ZONE = /(?:z|[+-]\d{2}:\d{2})$/i
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Parse a projected ISO date/time without depending on the Node host timezone. */
export function reportTimeEpoch(value: JsonValue): number | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = EXPLICIT_ZONE.test(value) || DATE_ONLY.test(value) ? value : `${value}Z`
  const epoch = Date.parse(candidate)
  return Number.isFinite(epoch) ? epoch : undefined
}
