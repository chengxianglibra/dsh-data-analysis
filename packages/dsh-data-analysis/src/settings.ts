import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { type MarivoPythonOptions, resolvePythonOptions } from './datasource/python-options.ts'

export const PYTHON_SETTINGS_NAMESPACE = 'dsh-data-analysis'
export const PythonSettings = z.object({
  pythonTimeoutMs: z.number().min(1).max(2_147_483_647).step(1).required(),
})

/** Follow the Host settings provider; headless compositions retain their entry configuration. */
export function installPythonSettings(ctx: Context, options: MarivoPythonOptions) {
  const entry = resolvePythonOptions(options)
  let source = () => entry
  const dispose = ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, PYTHON_SETTINGS_NAMESPACE, PythonSettings, entry, {
      validate: resolvePythonOptions,
      setSource: (current) => {
        source = current
      },
      onChange: () => {},
    })
  })
  return { get: () => source(), dispose: () => dispose.dispose() }
}
