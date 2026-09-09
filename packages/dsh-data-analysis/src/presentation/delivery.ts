import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  type PresentationDelivery,
  parsePresentationDelivery,
} from './receipt.ts'

/** Persist the same envelope on nested Code dispatch even when code discards the return value. */
export function installMarivoPresentationCodeDelivery(ctx: Context): () => Promise<void> {
  const tasks = new PendingTasks()
  let active = true
  const pending = new Map<string, { rootCallId: string; delivery: PresentationDelivery }>()
  const stopResult = ctx.on('tools/result', (exec, result) => {
    if (!active) return
    if (exec.name !== MARIVO_PRESENT_TOOL_NAME || exec.parent === undefined || result.isError)
      return
    try {
      const value = result.value as { deliveryJson: string }
      const delivery = parsePresentationDelivery(JSON.parse(value.deliveryJson))
      if (delivery.dshSessionId !== String(exec.agent?.session.id)) return
      pending.set(String(exec.callId), { rootCallId: String(exec.rootCallId), delivery })
      // Bounded transient dispatch rendezvous; receipts remain in Host events, never this map.
      if (pending.size > 256) pending.delete(pending.keys().next().value!)
    } catch {
      /* Invalid output cannot create a success card. */
    }
  })
  let stopLog: (() => void) | undefined
  try {
    stopLog = ctx.on(
      'tools/ptc-dispatch-log',
      (dispatch, next) =>
        tasks.track(
          (async () => {
            const content = await next()
            if (!active) return content
            if (dispatch.name !== MARIVO_PRESENT_TOOL_NAME) return content
            const key = String(dispatch.subCallId)
            const item = pending.get(key)
            pending.delete(key)
            if (
              dispatch.isError ||
              !item ||
              item.delivery.dshSessionId !== String(dispatch.agent?.session.id) ||
              item.rootCallId !== String(dispatch.exec.rootCallId)
            )
              return content
            const root = [...(dispatch.agent?.session.snapshotEvents() ?? [])]
              .reverse()
              .find(
                (event) =>
                  event.type === 'tool/call' && String(event.data.callId) === item.rootCallId,
              )
            if (root?.type !== 'tool/call' || root.data.turn !== item.delivery.turn) return content
            return [
              ...content,
              {
                type: MARIVO_PRESENTATION_DELIVERY_KIND,
                delivery: item.delivery,
              } as unknown as ContentBlock,
            ]
          })(),
        ),
      { prepend: true },
    )
  } catch (error) {
    active = false
    void finishCleanup([stopResult, () => tasks.drain()])
    throw error
  }
  let closing: Promise<void> | undefined
  return () => {
    if (closing) return closing
    active = false
    closing = finishCleanup([stopLog!, stopResult, () => tasks.drain()])
    pending.clear()
    return closing
  }
}
