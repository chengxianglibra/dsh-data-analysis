import type { MarivoPythonExecutionSummary } from '../../datasource/python.ts'

const phases = new Set(['preparing', 'executing', 'capturing-code'])
const reasons = new Set([
  'not-started',
  'succeeded',
  'nonzero-exit',
  'timed-out',
  'cancelled',
  'unknown',
])
const duration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Decode the plugin's error suffix after Harness has reduced Error to its message. */
export function executionErrorSummary(text: string): MarivoPythonExecutionSummary | undefined {
  const marker = '; execution='
  const index = text.indexOf(marker)
  if (index <= 0) return undefined
  try {
    const value: unknown = JSON.parse(text.slice(index + marker.length))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const summary = value as Record<string, unknown>
    if (
      typeof summary.phase !== 'string' ||
      !phases.has(summary.phase) ||
      typeof summary.reason !== 'string' ||
      !reasons.has(summary.reason) ||
      !duration(summary.elapsedMs) ||
      !['requestedTimeoutMs', 'effectiveTimeoutMs', 'executionElapsedMs'].every(
        (key) => summary[key] === null || duration(summary[key]),
      ) ||
      !(summary.nextAction === null || typeof summary.nextAction === 'string')
    )
      return undefined
    return summary as unknown as MarivoPythonExecutionSummary
  } catch {
    return undefined
  }
}
