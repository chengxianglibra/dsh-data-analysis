import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { type MarivoPythonOptions, resolvePythonOptions } from './datasource/python-options.ts'

export const PYTHON_SETTINGS_NAMESPACE = 'dsh-data-analysis'
export interface PythonTimeoutConfig {
  pythonTimeoutMs?: number | { get(): number }
}

export function currentPythonOptions(options: PythonTimeoutConfig): Required<MarivoPythonOptions> {
  const value = options.pythonTimeoutMs
  return resolvePythonOptions({
    pythonTimeoutMs:
      value !== null && typeof value === 'object' && typeof value.get === 'function'
        ? value.get()
        : (value as number | undefined),
  })
}

/** Config is projected by the Host settings service; a headless composition reads its live entry. */
export function installPythonSettings(ctx: Context, options: PythonTimeoutConfig) {
  const dispose = ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
  return { get: () => currentPythonOptions(options), dispose: () => dispose.dispose() }
}
