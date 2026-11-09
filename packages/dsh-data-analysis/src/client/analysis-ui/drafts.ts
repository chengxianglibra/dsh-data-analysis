import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { DraftDelivery, PresentationDelivery } from '../../presentation/receipt.ts'
import type { AnalysisCandidate } from './candidate.ts'

export interface AnalysisDraftView {
  sessionId: string
  turn: number
  workspaceId: string
  generation: ConnectionGeneration
  workspacePath?: string
  candidate?: AnalysisCandidate
  delivery?: DraftDelivery
  saved?: PresentationDelivery
}

const key = (sessionId: string, turn: number) => JSON.stringify([sessionId, turn])

/** One live working view per Session/Turn, shared by chat and right-pane adapters. */
export class AnalysisDraftViews {
  #items = new Map<string, AnalysisDraftView>()
  #listeners = new Set<() => void>()
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  get = (sessionId: string, turn: number) => this.#items.get(key(sessionId, turn))
  #write(view: AnalysisDraftView) {
    this.#items.set(key(view.sessionId, view.turn), view)
    for (const listener of this.#listeners) listener()
  }
  observe(candidate: AnalysisCandidate, workspacePath: string) {
    if (candidate.stage !== 'preview' && !candidate.draftId) return
    const old = this.get(candidate.sessionId, candidate.turn)
    let current =
      old?.generation === candidate.generation && old.workspaceId === candidate.workspaceId
        ? old
        : undefined
    if (current?.saved) {
      if (candidate.draftId) return
      current = undefined
    }
    if (candidate.draftId && current?.delivery?.draftId !== candidate.draftId) return
    const next = {
      sessionId: candidate.sessionId,
      turn: candidate.turn,
      workspaceId: candidate.workspaceId,
      generation: candidate.generation,
      ...current,
      workspacePath,
      candidate: {
        ...candidate,
        surface: candidate.surface ?? current?.delivery?.surface,
      },
    }
    this.#write(next)
  }
  preview(delivery: DraftDelivery, generation: ConnectionGeneration, workspacePath: string) {
    const old = this.get(delivery.dshSessionId, delivery.turn)
    let current =
      old?.generation === generation && old.workspaceId === delivery.workspaceId ? old : undefined
    if (current?.saved) {
      if (current.saved.draftId === delivery.draftId) return
      current = undefined
    }
    if (current?.delivery?.draftRevision === delivery.draftRevision) return
    this.#write({
      sessionId: delivery.dshSessionId,
      turn: delivery.turn,
      workspaceId: delivery.workspaceId,
      generation,
      ...current,
      workspacePath,
      delivery,
      ...(current?.candidate && current.candidate.draftRevision !== delivery.draftRevision
        ? { candidate: { ...current.candidate, phase: 'previewed' as const } }
        : {}),
    })
  }
  save(delivery: PresentationDelivery, generation: ConnectionGeneration) {
    if (!delivery.draftId) return
    const current = this.get(delivery.dshSessionId, delivery.turn)
    if (
      !current ||
      current.generation !== generation ||
      current.workspaceId !== delivery.receipt.workspaceId ||
      current.delivery?.draftId !== delivery.draftId
    )
      return
    this.#write({ ...current, candidate: undefined, saved: delivery })
  }
  settle(sessionId: string) {
    for (const view of this.#items.values()) {
      if (view.sessionId !== sessionId || !view.candidate) continue
      if (['preparing', 'start'].includes(view.candidate.phase))
        this.#write({ ...view, candidate: { ...view.candidate, phase: 'cancelled' } })
    }
  }
  revoke(sessionId: string) {
    for (const [id, view] of this.#items) if (view.sessionId === sessionId) this.#items.delete(id)
    for (const listener of this.#listeners) listener()
  }
}
