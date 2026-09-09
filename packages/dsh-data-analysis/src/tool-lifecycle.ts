import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { finishCleanup, PendingTasks } from './lifecycle.ts'

/** A plugin tool owns its execution promises; withdrawing its schema is not a drain. */
export function registerMarivoTool(ctx: Context, tool: ToolDefinition): () => Promise<void> {
  const lifetime = new AbortController()
  const pending = new PendingTasks()
  const unregister = ctx.tools.register({
    ...tool,
    execute(args, exec) {
      if (lifetime.signal.aborted) return Promise.reject(new Error('Marivo tool disposed'))
      return pending.track(
        tool.execute(args, { ...exec, signal: AbortSignal.any([exec.signal, lifetime.signal]) }),
      )
    },
  })
  let closing: Promise<void> | undefined
  return () => {
    if (closing) return closing
    lifetime.abort()
    closing = finishCleanup([unregister, () => pending.drain()])
    return closing
  }
}
