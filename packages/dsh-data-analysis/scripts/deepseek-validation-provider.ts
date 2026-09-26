/** Select the official API-key provider exposed by the installed DSH version. */
import type { Context } from '@deepseek-ai/cordis'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'

type ProviderPlugin = {
  name: string
  inject: string[]
  apply(ctx: Context, config: Record<string, unknown>): void
}

export async function installDeepSeekValidationProvider(
  ctx: Context,
  config: Record<string, unknown>,
) {
  const legacy = DeepSeek as unknown as Partial<ProviderPlugin>
  // rc.2 split protocol transport from API-key authentication. rc.1 exported
  // the provider from the protocol package itself.
  const apiKeyPackage: string = '@deepseek-ai/dsh-llm-deepseek-api-key'
  const provider = typeof legacy.apply === 'function' ? DeepSeek : await import(apiKeyPackage)
  await ctx.plugin(provider as ProviderPlugin, config)
}
