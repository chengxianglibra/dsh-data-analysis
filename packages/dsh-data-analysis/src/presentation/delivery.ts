import type { Context } from '@deepseek-ai/cordis'
import { type ContentBlock, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { finishCleanup, PendingTasks } from '../lifecycle.ts'
import { parseReportRef, savedReportRef } from './contracts/report-ref.ts'
import {
  type DraftDelivery,
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  type PresentationDelivery,
  parsePresentationToolDelivery,
} from './receipt.ts'
import {
  reportSaveOutcomeUnknown,
  savedReportRecovery,
  savedReportRecoveryPrefix,
} from './recovery.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'marivo-save-recovery': { kind: 'marivo-save-recovery'; calls: string[] }
  }
}

/** The outer PTC result can discard both a successful save and a nested error. */
export function restorePtcSaves(
  session: Session,
  messages: readonly UserMessage[],
  workspaceId: () => string,
) {
  const visible = new Set(session.surface.nodes)
  const events = session.snapshotEvents()
  const seen = new Set<string>()
  const remember = (source: unknown) => {
    const parsed = z
      .object({ kind: z.literal('marivo-save-recovery'), calls: z.array(z.string()) })
      .safeParse(source)
    if (parsed.success) for (const id of parsed.data.calls) seen.add(id)
  }
  for (const message of messages) remember(message.source)
  const newestFirst = [...events].reverse()
  const latestTurn = newestFirst.find((event) => event.type === 'turn/start')?.data.turn
  if (latestTurn === undefined) return undefined
  const rootCalls = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.turn >= latestTurn - 1)
      rootCalls.set(String(event.data.callId), event.data.turn)
    if (event.type === 'user/message' && visible.has(event.seq)) remember(event.data.source)
  }
  const recovered = new Map<string, string>()
  let workspace: string | undefined
  for (const event of newestFirst) {
    if (recovered.size >= 4) break
    if (
      event.type !== 'tool/ptc-dispatch' ||
      event.data.name !== MARIVO_PRESENT_TOOL_NAME ||
      !rootCalls.has(String(event.data.rootCallId)) ||
      !z.object({ stage: z.literal('save') }).safeParse(event.data.arguments).success
    )
      continue
    const id = String(event.data.subCallId)
    if (seen.has(id)) continue
    if (workspace === undefined) {
      try {
        workspace = workspaceId()
      } catch {
        return undefined
      }
    }
    if (event.data.isError) {
      const text = event.data.content.find(
        (item) =>
          item.type === 'text' &&
          (item.text.startsWith(savedReportRecoveryPrefix) ||
            item.text.startsWith(`Error: ${savedReportRecoveryPrefix}`)),
      )
      let recovery: string | undefined
      if (text?.type === 'text') {
        const ref = text.text
          .slice(text.text.indexOf(savedReportRecoveryPrefix) + savedReportRecoveryPrefix.length)
          .split('\n', 1)[0]
        try {
          if (ref) {
            const parsed = parseReportRef(ref)
            if (parsed.kind === 'saved' && parsed.workspaceId === workspace)
              recovery = savedReportRecovery(ref)
          }
        } catch {}
      }
      if (
        !recovery &&
        (event.data.error?.code === 'ABORTED' || event.data.error?.code === 'TOOL_TIMEOUT')
      )
        recovery = reportSaveOutcomeUnknown(id)
      if (recovery) recovered.set(id, recovery)
    } else {
      try {
        const delivery = parsePresentationToolDelivery(event.data.meta)
        if (
          delivery.kind !== MARIVO_PRESENTATION_DELIVERY_KIND ||
          delivery.dshSessionId !== String(session.id) ||
          delivery.turn !== rootCalls.get(String(event.data.rootCallId)) ||
          delivery.receipt.workspaceId !== workspace
        )
          continue
        const { workspaceId, reportId, buildId } = delivery.receipt
        const ref = savedReportRef({ workspaceId, reportId, buildId })
        const alreadyVisible = events.some(
          (entry) =>
            visible.has(entry.seq) &&
            entry.type === 'tool/result' &&
            String(entry.data.message.toolCallId) === String(event.data.rootCallId) &&
            entry.data.message.content.some(
              (item) => item.type === 'text' && item.text.includes(ref),
            ),
        )
        if (!alreadyVisible) recovered.set(id, savedReportRecovery(ref))
      } catch {
        // Only validated committed receipts are suitable for recovery.
      }
    }
  }
  if (!recovered.size) return undefined
  return createUserMessage({
    source: { kind: 'marivo-save-recovery', calls: [...recovered.keys()] },
    content: [{ type: 'text', text: [...recovered.values()].join('\n') }],
  })
}

/** Persist the same envelope on nested Code dispatch even when code discards the return value. */
export function installMarivoPresentationCodeDelivery(ctx: Context): () => Promise<void> {
  const tasks = new PendingTasks()
  let active = true
  const pending = new Map<
    string,
    { rootCallId: string; delivery: PresentationDelivery | DraftDelivery }
  >()
  const stopResult = ctx.on('tools/result', (exec, result) => {
    if (!active) return
    if (exec.name !== MARIVO_PRESENT_TOOL_NAME || exec.parent === undefined || result.isError)
      return
    try {
      const value = result.value as { deliveryJson: string }
      const delivery = parsePresentationToolDelivery(JSON.parse(value.deliveryJson))
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
                type: item.delivery.kind,
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
