import type { AnalysisDocument } from './contracts/analysis-document.ts'
import type { ResourceStreamRequest, ResourceStreamResponse } from './contracts/resource-stream.ts'
import { PRESENTATION_BUDGETS } from './contracts/types.ts'
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
  readonly #resources = new Map<
    string,
    {
      owner: Omit<ResourceStreamRequest, 'after'>
      workspacePath: string
      revision: number
      status: 'reading' | 'complete' | 'failed'
      updates: { revision: number; name: string; resource: AnalysisDocument['resources'][string] }[]
    }
  >()
  readonly #resourceListeners = new Set<() => void>()

  #changed() {
    for (const listener of this.#resourceListeners) listener()
  }

  beginResources(owner: Omit<ResourceStreamRequest, 'after'>, workspacePath: string) {
    const operation = {
      owner,
      workspacePath,
      revision: 1,
      status: 'reading' as const,
      updates: [] as {
        revision: number
        name: string
        resource: AnalysisDocument['resources'][string]
      }[],
    }
    this.#resources.set(owner.sessionId, operation)
    this.#changed()
    return {
      check: () => {
        if (this.#resources.get(owner.sessionId) !== operation) throw unavailableDraft()
      },
      put: (name: string, resource: AnalysisDocument['resources'][string]) => {
        if (this.#resources.get(owner.sessionId) !== operation) throw unavailableDraft()
        if (
          operation.updates.length >= PRESENTATION_BUDGETS.datasets ||
          new TextEncoder().encode(
            JSON.stringify([...operation.updates.map((update) => update.resource), resource]),
          ).length > PRESENTATION_BUDGETS.documentBytes
        )
          throw new Error('analysis-resource-stream-budget')
        operation.updates.push({
          revision: ++operation.revision,
          name,
          resource: structuredClone(resource),
        })
        this.#changed()
      },
      finish: (success: boolean) => {
        const current = this.#resources.get(owner.sessionId)
        if (current !== operation) return
        this.#resources.set(owner.sessionId, {
          ...current,
          revision: current.revision + 1,
          status: success ? 'complete' : 'failed',
          updates: success ? current.updates : [],
        })
        this.#changed()
      },
    }
  }

  async readResources(
    request: ResourceStreamRequest,
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<ResourceStreamResponse> {
    const read = (): ResourceStreamResponse => {
      const item = this.#resources.get(request.sessionId)
      if (
        !item ||
        item.owner.callId !== request.callId ||
        item.owner.turn !== request.turn ||
        item.owner.workspaceId !== request.workspaceId ||
        item.workspacePath !== workspacePath
      )
        return {
          sessionId: request.sessionId,
          workspaceId: request.workspaceId,
          turn: request.turn,
          callId: request.callId,
          revision: 0,
          status: 'waiting',
          resources: {},
        }
      return {
        ...item.owner,
        revision: item.revision,
        status: item.status,
        resources: Object.fromEntries(
          item.updates
            .filter((update) => update.revision > request.after)
            .map(({ name, resource }) => [name, resource]),
        ),
      }
    }
    const initial = read()
    if (initial.revision > request.after || ['complete', 'failed'].includes(initial.status))
      return initial
    if (this.#resourceListeners.size >= 64) throw new Error('analysis-resource-stream-busy')
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        this.#resourceListeners.delete(changed)
        signal.removeEventListener('abort', abort)
        resolve()
      }
      const changed = () => {
        const next = read()
        if (next.revision !== initial.revision || next.status !== initial.status) finish()
      }
      const abort = () => {
        finish()
        reject(signal.reason)
      }
      const timer = setTimeout(finish, 10_000)
      this.#resourceListeners.add(changed)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
    return read()
  }

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
    if (turn === undefined || this.#resources.get(sessionId)?.owner.turn === turn) {
      this.#resources.delete(sessionId)
      this.#changed()
    }
  }
}
