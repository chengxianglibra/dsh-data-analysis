import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { AnalysisDocument } from '../../presentation/contracts/analysis-document.ts'
import type { ResourceStreamResponse } from '../../presentation/contracts/resource-stream.ts'
import type { DraftDelivery, PresentationDelivery } from '../../presentation/receipt.ts'
import type { AnalysisCandidate } from './candidate.ts'
import type { SnapshotFilterStore } from './snapshot-filter-controls.tsx'

export interface ReportReadingState {
  filters?: { key: string; store: SnapshotFilterStore }
  tabs: Map<string, string>
  accordions: Map<string, string>
  tables: Map<
    string,
    {
      page: number
      sort?: { columnId: string; direction: 'ascending' | 'descending' }
      filterSelectionKey?: string
    }
  >
  scroll: Map<string, number>
}

export interface ReportViewState {
  id: string
  sessionId: string
  turn: number
  workspaceId: string
  workspacePath: string
  generation: ConnectionGeneration
  candidate?: AnalysisCandidate
  draft?: DraftDelivery
  saved?: PresentationDelivery
  document?: AnalysisDocument
  documentKey?: string
  resourceStream?: Pick<ResourceStreamResponse, 'callId' | 'revision' | 'status' | 'resources'>
  reading: ReportReadingState
  tabId?: string
  settled?: boolean
}

export const reportContentKey = (view: ReportViewState) =>
  view.saved?.receipt.buildId ??
  view.candidate?.rebaseOnRecordId ??
  (!view.draft ? view.candidate?.basedOnRecordId : undefined) ??
  view.draft?.draftRevision

export const reportViewId = (sessionId: string, turn: number, callId: string) =>
  JSON.stringify([sessionId, turn, callId])

/** Client-owned reading state. Host receipts remain authoritative for content and identity. */
export class ReportViews {
  #items = new Map<string, ReportViewState>()
  #calls = new Map<string, string>()
  #revision = 0
  #listeners = new Set<() => void>()
  getSnapshot = () => this.#revision
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  get = (id: string) => this.#items.get(id)
  forCall(sessionId: string, callId: string) {
    return [...this.#items.values()].find(
      (view) =>
        view.sessionId === sessionId &&
        this.#calls.get(reportViewId(sessionId, view.turn, callId)) === view.id,
    )
  }
  forTurn(sessionId: string, turn: number) {
    return [...this.#items.values()].filter(
      (view) => view.sessionId === sessionId && view.turn === turn,
    )
  }
  #write(view: ReportViewState) {
    this.#items.set(view.id, view)
    this.#revision++
    for (const listener of this.#listeners) listener()
    return view
  }
  observe(candidate: AnalysisCandidate, workspacePath: string) {
    const call = reportViewId(candidate.sessionId, candidate.turn, candidate.callId)
    const views = this.forTurn(candidate.sessionId, candidate.turn)
    const old =
      this.#items.get(this.#calls.get(call) ?? call) ??
      views.find((view) =>
        candidate.draftId
          ? view.draft?.draftId === candidate.draftId || view.saved?.draftId === candidate.draftId
          : candidate.delivery
            ? view.saved?.receipt.buildId === candidate.delivery.receipt.buildId
            : !view.saved && Boolean(view.draft),
      )
    const current =
      old?.generation === candidate.generation &&
      old.workspaceId === candidate.workspaceId &&
      old.workspacePath === workspacePath
        ? old
        : undefined
    if (current?.saved && !candidate.delivery) {
      this.#calls.set(call, current.id)
      return current
    }
    const view: ReportViewState = {
      id: current?.id ?? call,
      sessionId: candidate.sessionId,
      turn: candidate.turn,
      workspaceId: candidate.workspaceId,
      workspacePath,
      generation: candidate.generation,
      reading: current?.reading ?? {
        tabs: new Map(),
        accordions: new Map(),
        tables: new Map(),
        scroll: new Map(),
      },
      ...current,
      candidate: candidate.delivery ? undefined : candidate,
      ...(candidate.draft ? { draft: candidate.draft } : {}),
      ...(candidate.delivery ? { saved: candidate.delivery } : {}),
    }
    this.#calls.set(call, view.id)
    return this.#write(view)
  }
  accept(
    delivery: DraftDelivery | PresentationDelivery,
    callId: string,
    generation: ConnectionGeneration,
    workspacePath: string,
  ) {
    const workspaceId = 'receipt' in delivery ? delivery.receipt.workspaceId : delivery.workspaceId
    const call = reportViewId(delivery.dshSessionId, delivery.turn, callId)
    const old =
      this.#items.get(this.#calls.get(call) ?? call) ??
      this.forTurn(delivery.dshSessionId, delivery.turn).find(
        (view) =>
          delivery.draftId &&
          (view.draft?.draftId === delivery.draftId || view.saved?.draftId === delivery.draftId),
      )
    const current =
      old?.generation === generation &&
      old.workspaceId === workspaceId &&
      old.workspacePath === workspacePath
        ? old
        : undefined
    if (
      current &&
      ('receipt' in delivery
        ? current.saved?.receipt.buildId === delivery.receipt.buildId
        : current.draft?.draftRevision === delivery.draftRevision)
    )
      return current
    const view: ReportViewState = {
      id: current?.id ?? call,
      sessionId: delivery.dshSessionId,
      turn: delivery.turn,
      workspaceId,
      workspacePath,
      generation,
      reading: { tabs: new Map(), accordions: new Map(), tables: new Map(), scroll: new Map() },
      ...current,
      ...('receipt' in delivery
        ? { saved: delivery, candidate: undefined }
        : {
            draft: delivery,
            candidate: current?.candidate
              ? { ...current.candidate, phase: 'previewed' as const }
              : undefined,
          }),
    }
    this.#calls.set(call, view.id)
    return this.#write(view)
  }
  document(
    id: string,
    owner: Pick<ReportViewState, 'generation' | 'workspacePath'>,
    key: string,
    document: AnalysisDocument,
  ) {
    const current = this.get(id)
    if (
      !current ||
      current.generation !== owner.generation ||
      current.workspaceId !== document.workspaceId ||
      current.workspacePath !== owner.workspacePath ||
      reportContentKey(current) !== key
    )
      return
    this.#write({ ...current, document, documentKey: key })
  }
  resources(
    id: string,
    owner: Pick<ReportViewState, 'generation' | 'workspacePath'>,
    response: ResourceStreamResponse,
  ) {
    const current = this.get(id)
    if (
      !current ||
      current.generation !== owner.generation ||
      current.workspacePath !== owner.workspacePath ||
      current.workspaceId !== response.workspaceId ||
      current.sessionId !== response.sessionId ||
      current.turn !== response.turn ||
      current.candidate?.callId !== response.callId ||
      current.settled ||
      !['preparing', 'start'].includes(current.candidate.phase)
    )
      return
    const previous =
      current.resourceStream?.callId === response.callId ? current.resourceStream : undefined
    if (previous && previous.revision >= response.revision) return
    this.#write({
      ...current,
      resourceStream: {
        ...response,
        resources:
          response.status === 'failed' ? {} : { ...previous?.resources, ...response.resources },
      },
    })
  }
  attach(id: string, tabId: string) {
    const current = this.get(id)
    if (current && current.tabId !== tabId) this.#write({ ...current, tabId })
  }
  reconcile(
    tabs: readonly { sessionId: string; tabId: string; viewId?: string; workspaceId?: string }[],
  ) {
    for (const view of this.#items.values()) {
      const existing = tabs.find(
        (tab) => tab.sessionId === view.sessionId && tab.tabId === view.tabId,
      )
      const restored = tabs.find(
        (tab) =>
          tab.sessionId === view.sessionId &&
          tab.viewId === view.id &&
          tab.workspaceId === view.workspaceId,
      )
      const tabId = (existing ?? restored)?.tabId
      if (view.tabId !== tabId) this.#write({ ...view, tabId })
    }
  }
  settle(sessionId: string) {
    for (const view of this.#items.values()) {
      if (view.sessionId === sessionId && !view.saved && !view.settled)
        this.#write({
          ...view,
          settled: true,
          candidate:
            view.candidate && ['preparing', 'start'].includes(view.candidate.phase)
              ? { ...view.candidate, phase: 'cancelled' }
              : view.candidate,
        })
    }
  }
  revoke(sessionId?: string) {
    for (const [id, view] of this.#items)
      if (sessionId === undefined || view.sessionId === sessionId) this.#items.delete(id)
    for (const [call, id] of this.#calls) if (!this.#items.has(id)) this.#calls.delete(call)
    this.#revision++
    for (const listener of this.#listeners) listener()
  }
}
