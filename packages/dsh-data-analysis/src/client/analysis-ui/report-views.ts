import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import {
  type AnalysisDocument,
  analysisRecordId,
  parseAnalysisRecordId,
} from '../../presentation/contracts/analysis-document.ts'
import type { ResourceStreamResponse } from '../../presentation/contracts/resource-stream.ts'
import type { DraftDelivery, PresentationDelivery } from '../../presentation/receipt.ts'
import type { AnalysisCandidate } from './candidate.ts'

export interface ReportReadingState {
  openUIState?: { key: string; value: Record<string, unknown> }
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
  fallbackDocument?: { document: AnalysisDocument; key: string }
  resourceStream?: Pick<ResourceStreamResponse, 'callId' | 'revision' | 'status' | 'resources'>
  reading: ReportReadingState
  openError?: boolean
  settled?: boolean
}

/** Saved, admitted and explicitly referenced base reports belonging to a view. */
export function viewReportIds(view: ReportViewState): Set<string> {
  const ids = new Set<string>()
  if (view.saved) ids.add(view.saved.receipt.reportId)
  if (view.document) ids.add(view.document.reportId)
  for (const ref of [view.candidate?.basedOnRecordId, view.candidate?.rebaseOnRecordId]) {
    if (!ref) continue
    try {
      ids.add(parseAnalysisRecordId(ref).reportId)
    } catch {
      /* An incomplete candidate is not a report identity. */
    }
  }
  return ids
}

export const reportContentKey = (view: ReportViewState) => {
  if (view.saved && !view.candidate) return view.saved.receipt.buildId
  const pendingSavedBase = Boolean(
    view.candidate?.basedOnRecordId && ['preparing', 'start'].includes(view.candidate.phase),
  )
  const baseId =
    view.candidate?.rebaseOnRecordId ??
    (pendingSavedBase || !view.draft ? view.candidate?.basedOnRecordId : undefined)
  if (baseId && view.document?.recordId === baseId) return view.documentKey ?? baseId
  return baseId ?? view.draft?.draftRevision ?? view.saved?.receipt.buildId
}

export const reportViewId = (sessionId: string, turn: number, callId: string) =>
  JSON.stringify([sessionId, turn, callId])

/** Client-owned reading state. Host receipts remain authoritative for content and identity. */
export class ReportViews {
  #items = new Map<string, ReportViewState>()
  #calls = new Map<string, string>()
  #deliveries = new WeakMap<ReportReadingState, Set<string>>()
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
  #receive(reading: ReportReadingState, delivery: DraftDelivery | PresentationDelivery) {
    // Chat projections replay earlier receipts while a later call is editing
    // the same view. A receipt may advance that view only once per owner.
    const key =
      'receipt' in delivery
        ? analysisRecordId(delivery.receipt.reportId, delivery.receipt.buildId)
        : JSON.stringify([delivery.draftId, delivery.draftRevision])
    let received = this.#deliveries.get(reading)
    if (!received) {
      received = new Set()
      this.#deliveries.set(reading, received)
    }
    if (received.has(key)) return false
    received.add(key)
    return true
  }
  observeReady(candidate: AnalysisCandidate, workspacePath: string) {
    // Until the arguments identify a draft or a complete standalone request,
    // assigning a call to a view can accidentally merge different reports.
    if (!candidate.preview && !candidate.draft && !candidate.delivery) return undefined
    if (
      ['failed', 'cancelled'].includes(candidate.phase) &&
      !this.#calls.has(reportViewId(candidate.sessionId, candidate.turn, candidate.callId))
    )
      return undefined
    return this.observe(candidate, workspacePath)
  }
  openingFailed(id: string, failed: boolean) {
    const view = this.get(id)
    if (view && Boolean(view.openError) !== failed) this.#write({ ...view, openError: failed })
  }
  observe(candidate: AnalysisCandidate, workspacePath: string) {
    const call = reportViewId(candidate.sessionId, candidate.turn, candidate.callId)
    const owns = (view: ReportViewState) =>
      view.generation === candidate.generation &&
      view.workspaceId === candidate.workspaceId &&
      view.workspacePath === workspacePath
    const views = this.forTurn(candidate.sessionId, candidate.turn).filter(owns)
    const draftId = candidate.draftId ?? candidate.draft?.draftId
    const standalone =
      candidate.preview &&
      !candidate.draftId &&
      !candidate.basedOnRecordId &&
      !['failed', 'cancelled'].includes(candidate.phase)
    // A rejected new report has only a provisional call identity. A new
    // standalone attempt can reuse its entry and tab before any draft exists.
    const retry = standalone
      ? views.find(
          (view) =>
            !view.saved &&
            !view.draft &&
            !view.settled &&
            view.candidate &&
            !view.candidate.draftId &&
            !view.candidate.basedOnRecordId &&
            ['failed', 'cancelled'].includes(view.candidate.phase),
        )
      : undefined
    const old =
      this.#items.get(this.#calls.get(call) ?? call) ??
      views.find((view) =>
        draftId
          ? view.draft?.draftId === draftId || view.saved?.draftId === draftId
          : candidate.delivery
            ? view.saved?.receipt.buildId === candidate.delivery.receipt.buildId
            : candidate.basedOnRecordId && view.saved
              ? analysisRecordId(view.saved.receipt.reportId, view.saved.receipt.buildId) ===
                candidate.basedOnRecordId
              : !candidate.preview && !view.saved && Boolean(view.draft),
      ) ??
      retry
    const current = old && owns(old) ? old : undefined
    const retrying = Boolean(current && current === retry)
    if (retrying && retry?.candidate) {
      this.#calls.delete(reportViewId(candidate.sessionId, candidate.turn, retry.candidate.callId))
    }
    const startingRevision =
      current?.saved &&
      candidate.basedOnRecordId ===
        analysisRecordId(current.saved.receipt.reportId, current.saved.receipt.buildId) &&
      current.candidate?.callId !== candidate.callId
    if (
      current?.saved &&
      !candidate.delivery &&
      !startingRevision &&
      current.candidate?.callId !== candidate.callId &&
      (!draftId || draftId !== current.draft?.draftId)
    ) {
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
      ...(retrying ? { resourceStream: undefined } : {}),
      ...(startingRevision
        ? {
            resourceStream: undefined,
            fallbackDocument:
              current?.draft &&
              current.document &&
              current.documentKey === current.draft.draftRevision
                ? { document: current.document, key: current.documentKey }
                : undefined,
          }
        : {}),
      ...(['failed', 'cancelled'].includes(candidate.phase) && current?.fallbackDocument
        ? {
            document: current.fallbackDocument.document,
            documentKey: current.fallbackDocument.key,
            fallbackDocument: undefined,
          }
        : {}),
      candidate: candidate.delivery ? undefined : candidate,
      ...(candidate.draft ? { draft: candidate.draft, fallbackDocument: undefined } : {}),
      ...(candidate.delivery
        ? { saved: candidate.delivery, draft: undefined, fallbackDocument: undefined }
        : {}),
    }
    this.#calls.set(call, view.id)
    const delivery = candidate.delivery ?? candidate.draft
    if (delivery && !this.#receive(view.reading, delivery) && current) return current
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
        ? { saved: delivery, candidate: undefined, draft: undefined, fallbackDocument: undefined }
        : {
            draft: delivery,
            fallbackDocument: undefined,
            candidate: current?.candidate
              ? { ...current.candidate, phase: 'previewed' as const }
              : undefined,
          }),
    }
    this.#calls.set(call, view.id)
    if (!this.#receive(view.reading, delivery) && current) return current
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
  settle(sessionId: string) {
    for (const view of this.#items.values()) {
      if (view.sessionId === sessionId && (!view.saved || view.candidate) && !view.settled)
        this.#write({
          ...view,
          settled: true,
          ...(view.fallbackDocument
            ? {
                document: view.fallbackDocument.document,
                documentKey: view.fallbackDocument.key,
                fallbackDocument: undefined,
              }
            : {}),
          candidate:
            view.candidate && ['preparing', 'start'].includes(view.candidate.phase)
              ? { ...view.candidate, phase: 'cancelled' }
              : view.candidate,
          // Drafts expire with the Turn. A previously saved report remains
          // readable and its actions must target that saved Build again.
          ...(view.saved ? { candidate: undefined, draft: undefined } : {}),
        })
    }
  }
  /** Forget only readers bound to a deleted report, across all Sessions. */
  revokeReport(
    workspaceId: string,
    reportId: string,
    workspacePath?: string,
    generation?: ConnectionGeneration,
  ) {
    let changed = false
    for (const [id, view] of this.#items) {
      if (
        view.workspaceId === workspaceId &&
        (!workspacePath || view.workspacePath === workspacePath) &&
        (!generation || view.generation === generation) &&
        viewReportIds(view).has(reportId)
      ) {
        this.#items.delete(id)
        changed = true
      }
    }
    if (!changed) return
    for (const [call, id] of this.#calls) if (!this.#items.has(id)) this.#calls.delete(call)
    this.#revision++
    for (const listener of this.#listeners) listener()
  }
  revoke(sessionId?: string) {
    for (const [id, view] of this.#items)
      if (sessionId === undefined || view.sessionId === sessionId) this.#items.delete(id)
    for (const [call, id] of this.#calls) if (!this.#items.has(id)) this.#calls.delete(call)
    this.#revision++
    for (const listener of this.#listeners) listener()
  }
}
