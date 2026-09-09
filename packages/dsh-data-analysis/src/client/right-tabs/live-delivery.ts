import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PresentationDelivery } from '../../presentation/receipt.ts'
import {
  presentationDeliveryFromEvent,
  presentationDeliveryIdentity,
} from '../presentation/delivery.ts'

/** Read-only Session window consumer. Initial history and replacement never navigate. */
export class LiveDeliveryObserver {
  #revision = -1
  #calls = new Map<number, Map<string, string>>()
  #seen = new Set<string>()
  readonly #onDelivery: (delivery: PresentationDelivery) => void
  readonly #sessionId: string
  constructor(sessionId: string, onDelivery: (delivery: PresentationDelivery) => void) {
    this.#sessionId = sessionId
    this.#onDelivery = onDelivery
  }
  consume(window: SessionEventWindow, baseline = false): void {
    if (window.revision === this.#revision && !baseline) return
    const initial = this.#revision < 0 || baseline
    this.#revision = window.revision
    const live = !initial && window.change.kind === 'append'
    const entries =
      initial || window.change.kind === 'replace' || window.change.kind === 'prepend'
        ? window.entries
        : window.change.kind === 'append'
          ? window.change.entries
          : []
    if (initial || window.change.kind === 'replace' || window.change.kind === 'prepend')
      this.#calls.clear()
    for (const entry of entries) {
      if (entry.type !== 'event') continue
      const event = entry.event as any
      const turn = event.data?.turn
      if (
        event.type === 'tool/call' &&
        Number.isSafeInteger(turn) &&
        typeof event.data.callId === 'string' &&
        typeof event.data.name === 'string'
      ) {
        let calls = this.#calls.get(turn)
        if (!calls) {
          calls = new Map()
          this.#calls.set(turn, calls)
        }
        calls.set(event.data.callId, event.data.name)
      }
      // Code dispatch has the canonical Turn in its durable envelope, not necessarily data.turn.
      for (const [ownerTurn, calls] of this.#calls) {
        const item = presentationDeliveryFromEvent(event, calls, ownerTurn)
        if (!item || item.delivery.dshSessionId !== this.#sessionId) continue
        const key = presentationDeliveryIdentity(item.delivery)
        if (this.#seen.has(key)) continue
        this.#seen.add(key)
        if (live) this.#onDelivery(item.delivery)
      }
      if (event.type === 'turn/end' && Number.isSafeInteger(turn)) this.#calls.delete(turn)
    }
  }
}
