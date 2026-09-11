export const DEFAULT_PYTHON_TIMEOUT_MS = 120_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

export interface MarivoPythonOptions {
  pythonTimeoutMs?: number
}

export type MarivoPythonOptionsSource = MarivoPythonOptions | (() => MarivoPythonOptions)

/** Do not echo rejected inputs: tool arguments and configuration are not trusted diagnostics. */
export function pythonTimeout(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_TIMER_DELAY_MS
  )
    throw new Error(`${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  return value
}

export function resolvePythonOptions(options: MarivoPythonOptions): Required<MarivoPythonOptions> {
  const pythonTimeoutMs = pythonTimeout(
    options.pythonTimeoutMs === undefined ? DEFAULT_PYTHON_TIMEOUT_MS : options.pythonTimeoutMs,
    'pythonTimeoutMs',
  )
  return { pythonTimeoutMs }
}
