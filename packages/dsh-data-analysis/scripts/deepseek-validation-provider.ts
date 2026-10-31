/** Install the API-key provider exposed by the current Harness contract. */
import type { Context } from '@deepseek-ai/cordis'
import * as DeepSeekApiKey from '@deepseek-ai/dsh-llm-deepseek-api-key'

export async function installDeepSeekValidationProvider(
  ctx: Context,
  config: Record<string, unknown>,
) {
  await ctx.plugin(DeepSeekApiKey, config)
}
