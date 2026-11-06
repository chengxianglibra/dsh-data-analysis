import type { AnalysisDocument } from './contracts/analysis-document.ts'
import type { DraftDelivery } from './receipt.ts'
import { PresentationRecoveryError, unavailableDraft } from './recovery.ts'

export interface AnalysisDraft {
  readonly delivery: DraftDelivery
  readonly workspacePath: string
  readonly baseBuildId: string | null
  readonly document: AnalysisDocument
}

export interface AnalysisDraftLease {
  check: () => void
  write: (draft: AnalysisDraft) => void
}

/** At most one working report per active Session Turn. Drafts never reach disk. */
export class AnalysisDrafts {
  readonly #drafts = new Map<string, AnalysisDraft>()
  readonly #operations = new Map<string, { turn: number }>()

  get(sessionId: string): AnalysisDraft | undefined {
    return this.#drafts.get(sessionId)
  }

  async run<T>(
    sessionId: string,
    turn: number,
    perform: (lease: AnalysisDraftLease) => Promise<T>,
  ): Promise<T> {
    if (this.#operations.has(sessionId))
      throw new PresentationRecoveryError(
        'analysis-draft-busy',
        'Wait for the in-flight presentation call to settle, then use marivo_ui_read({draft:true}) to review the latest revision before applying an edit. Do not run draft mutations in parallel.',
      )
    const operation = { turn }
    this.#operations.set(sessionId, operation)
    const check = () => {
      if (this.#operations.get(sessionId) !== operation) throw unavailableDraft()
    }
    try {
      return await perform({
        check,
        write: (draft) => {
          check()
          this.#drafts.set(sessionId, draft)
        },
      })
    } finally {
      if (this.#operations.get(sessionId) === operation) this.#operations.delete(sessionId)
    }
  }

  clear(sessionId: string, turn?: number): void {
    if (turn === undefined || this.#drafts.get(sessionId)?.delivery.turn === turn)
      this.#drafts.delete(sessionId)
    if (turn === undefined || this.#operations.get(sessionId)?.turn === turn)
      this.#operations.delete(sessionId)
  }
}
