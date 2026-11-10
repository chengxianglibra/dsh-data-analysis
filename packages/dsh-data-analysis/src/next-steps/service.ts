import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { NEXT_STEPS_SERVICE, type NextStepsNotice } from './contracts.ts'

/** A live-only mailbox per subscriber. No baseline, history, or disconnected queue. */
export class NextStepsService extends TypertRemoteService {
  private readonly listeners = new Map<string, Set<(notice: NextStepsNotice) => void>>()
  private readonly lifetime = new AbortController()
  constructor(ctx: Context) {
    super(ctx, NEXT_STEPS_SERVICE)
  }
  publish(notice: NextStepsNotice): void {
    if (this.lifetime.signal.aborted) return
    for (const listener of this.listeners.get(notice.sessionId) ?? []) listener(notice)
  }
  async *watch(sessionId: string, caller: AbortSignal): AsyncIterable<NextStepsNotice> {
    const signal = AbortSignal.any([caller, this.lifetime.signal])
    signal.throwIfAborted()
    let latest: NextStepsNotice | undefined
    let wake: (() => void) | undefined
    const listener = (notice: NextStepsNotice) => {
      latest = notice
      wake?.()
    }
    let listeners = this.listeners.get(sessionId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(sessionId, listeners)
    }
    listeners.add(listener)
    const abort = () => wake?.()
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (!latest)
          await new Promise<void>((resolve) => {
            wake = resolve
            if (signal.aborted) resolve()
          })
        wake = undefined
        if (signal.aborted) break
        const value = latest
        latest = undefined
        if (value) yield value
      }
    } finally {
      signal.removeEventListener('abort', abort)
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(sessionId)
    }
  }
  close(): void {
    this.lifetime.abort()
    this.listeners.clear()
  }
}
