import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type AnalysisDocument,
  type AnalysisPresentInput,
  analysisRecordId,
  analysisResourcePatch,
  sameAnalysisDeclaration,
} from '../../presentation/contracts/analysis-document.ts'
import { parseReportRef } from '../../presentation/contracts/report-ref.ts'
import { selectionSourcesSchema } from '../../presentation/contracts/snapshot-filter.ts'
import { PRESENTATION_BUDGETS } from '../../presentation/contracts/types.ts'
import type { DraftDelivery } from '../../presentation/receipt.ts'
import { type PresentationDelivery, parsePresentationDelivery } from '../../presentation/receipt.ts'
import {
  parseDraftDelivery,
  parseDraftDurableContent,
  parsePresentationDurableContent,
} from '../presentation/delivery.ts'

export function analysisToolDelivery(block: ToolCallBlock): PresentationDelivery | undefined {
  if (!('kind' in block) || block.isError) return undefined
  try {
    return parsePresentationDelivery(block.meta)
  } catch {
    return parsePresentationDurableContent(block.content) ?? undefined
  }
}
export interface AnalysisCandidate {
  sessionId: string
  workspaceId: string
  generation: ConnectionGeneration
  callId: string
  turn: number
  phase: 'preparing' | 'start' | 'previewed' | 'saved' | 'failed' | 'cancelled'
  surface?: 'tool' | 'tab'
  stage?: 'preview' | 'save'
  draftId?: string
  draftRevision?: string
  rebaseOnRecordId?: string
  draft?: DraftDelivery
  preview: boolean
  program: string
  complete: boolean
  basedOnRecordId?: string
  title?: string
  locale?: 'zh-CN' | 'en-US'
  resourcePatch?: AnalysisPresentInput['resourcePatch']
  resourcePatchInput: 'omitted' | 'incomplete' | 'complete'
  selectionSources?: AnalysisPresentInput['selectionSources']
  selectionSourcesInput: 'omitted' | 'incomplete' | 'complete'
  delivery?: PresentationDelivery
}
export const candidateKey = (sessionId: string, turn: number, callId: string) =>
  JSON.stringify([sessionId, turn, callId])

/** Read every publication: PartialArguments grows in place, without changing its identity. */
export function analysisCandidate(
  block: ToolCallBlock,
  sessionId: string,
  workspaceId: string,
  generation: ConnectionGeneration,
  previous?: AnalysisCandidate,
  ownerTurn?: number,
): AnalysisCandidate {
  const args = block.args
  const program = args.textPrefix('program', PRESENTATION_BUDGETS.text) ?? ''
  const result = analysisToolDelivery(block)
  const draft =
    'kind' in block && !block.isError
      ? (parseDraftDelivery(block.meta) ?? parseDraftDurableContent(block.content))
      : undefined
  const delivery =
    result?.dshSessionId === sessionId &&
    result.receipt.workspaceId === workspaceId &&
    (previous === undefined || result.turn === previous.turn)
      ? result
      : undefined
  const patch = args.complete('resourcePatch')
    ? analysisResourcePatch.safeParse(args.value('resourcePatch'))
    : undefined
  const sources = args.complete('selectionSources')
    ? selectionSourcesSchema.safeParse(args.value('selectionSources'))
    : undefined
  const locale = args.complete('locale') ? args.text('locale') : undefined
  const readRef = (field: 'ref' | 'onto') => {
    if (!args.complete(field)) return undefined
    try {
      const ref = parseReportRef(args.text(field))
      return ref.workspaceId === workspaceId &&
        (ref.kind === 'saved' || ref.sessionId === sessionId)
        ? ref
        : undefined
    } catch {
      return undefined
    }
  }
  const ref = readRef('ref'),
    onto = readRef('onto')
  // A key not seen in an open object may still arrive later. Only a closed
  // object proves omission; completed values establish their own identities.
  const refResolved = args.has('ref') ? Boolean(ref) : args.closed()
  const ontoResolved = args.has('onto')
    ? Boolean(
        onto && onto.kind === 'saved' && ref?.kind === 'draft' && args.text('stage') === 'preview',
      )
    : args.closed()
  const identityResolved = refResolved && ontoResolved

  return {
    sessionId,
    workspaceId,
    generation,
    callId: block.callId,
    turn: 'turn' in block ? block.turn : (ownerTurn ?? delivery?.turn ?? previous?.turn ?? -1),
    phase: 'kind' in block ? (delivery ? 'saved' : draft ? 'previewed' : 'failed') : block.phase,
    surface: 'tool',
    stage:
      args.complete('stage') && args.text('stage') === 'preview'
        ? 'preview'
        : args.complete('stage') && args.text('stage') === 'save'
          ? 'save'
          : undefined,
    draftId: ref?.kind === 'draft' ? ref.draftId : undefined,
    draftRevision: ref?.kind === 'draft' ? ref.revision : undefined,
    rebaseOnRecordId:
      identityResolved && onto?.kind === 'saved'
        ? analysisRecordId(onto.reportId, onto.buildId)
        : undefined,
    ...(draft?.dshSessionId === sessionId && draft.workspaceId === workspaceId ? { draft } : {}),
    preview:
      args.complete('stage') &&
      ['preview', 'save'].includes(args.text('stage') ?? '') &&
      identityResolved &&
      !args.invalid &&
      !args.stringExceeds('program', PRESENTATION_BUDGETS.text),
    program,
    complete: args.complete('program'),
    basedOnRecordId:
      identityResolved && ref?.kind === 'saved'
        ? analysisRecordId(ref.reportId, ref.buildId)
        : undefined,
    title: args.complete('title') ? args.text('title') : undefined,
    locale: locale === 'en-US' || locale === 'zh-CN' ? locale : undefined,
    resourcePatch: patch?.success ? patch.data : undefined,
    selectionSources: sources?.success ? sources.data : undefined,
    selectionSourcesInput: !args.has('selectionSources')
      ? args.closed()
        ? 'omitted'
        : 'incomplete'
      : args.complete('selectionSources')
        ? 'complete'
        : 'incomplete',
    resourcePatchInput: args.has('resources')
      ? 'incomplete'
      : !args.has('resourcePatch')
        ? args.closed()
          ? 'omitted'
          : 'incomplete'
        : args.complete('resourcePatch')
          ? 'complete'
          : 'incomplete',
    delivery,
  }
}

/** A source declaration is a complete replacement; never interpret a partial object. */
export function candidateSelectionSources(
  document: Pick<AnalysisDocument, 'selectionSources'> | undefined,
  candidate: Pick<
    AnalysisCandidate,
    'selectionSources' | 'selectionSourcesInput' | 'resourcePatchInput'
  >,
): AnalysisDocument['selectionSources'] {
  return candidate.resourcePatchInput !== 'incomplete' &&
    candidate.selectionSourcesInput === 'complete' &&
    candidate.selectionSources
    ? candidate.selectionSources
    : document?.selectionSources
}

/** A candidate can reuse admitted bytes only when its declaration is known unchanged. */
export function candidateResources(
  document: Pick<AnalysisDocument, 'resources'> | undefined,
  candidate: Pick<AnalysisCandidate, 'resourcePatch' | 'resourcePatchInput'>,
  admitted: AnalysisDocument['resources'] = {},
): AnalysisDocument['resources'] {
  // While scope is arriving the renderer keeps the base resource statements,
  // so those exact prior bytes remain readable. A completed patch changes only
  // its named resources; replacement bytes require independent Host admission.
  if (candidate.resourcePatchInput !== 'omitted') {
    if (candidate.resourcePatchInput === 'incomplete') return document?.resources ?? {}
    if (!candidate.resourcePatch) return {}
    const { put, remove = [] } = candidate.resourcePatch
    const removed = new Set(remove)
    const base = document?.resources ?? {}
    if (
      removed.size !== remove.length ||
      remove.some((name) => !Object.hasOwn(base, name) || (put && Object.hasOwn(put, name)))
    )
      return {}
    const retained = Object.fromEntries(
      Object.entries(base).filter(([name, resource]) => {
        if (removed.has(name)) return false
        if (!put || !Object.hasOwn(put, name)) return true
        const replacement = put[name]
        return (
          replacement !== undefined && sameAnalysisDeclaration(resource.declaration, replacement)
        )
      }),
    )
    for (const [name, resource] of Object.entries(admitted)) {
      const declaration = put?.[name]
      if (
        !removed.has(name) &&
        declaration &&
        sameAnalysisDeclaration(resource.declaration, declaration)
      )
        retained[name] = resource
    }
    return retained
  }
  return document?.resources ?? {}
}

/** Installation-local call projection shared only by the tool and candidate tab adapters. */
export class AnalysisCandidates {
  #items = new Map<string, AnalysisCandidate>()
  #listeners = new Set<() => void>()
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
  get = (sessionId: string, turn: number, callId: string) =>
    this.#items.get(candidateKey(sessionId, turn, callId))
  observe(
    blocks: readonly ToolCallBlock[],
    sessionId: string,
    workspaceId: string,
    generation: ConnectionGeneration,
    onChange: (candidate: AnalysisCandidate, first: boolean) => void,
    ownerTurn?: number,
  ) {
    const visit = (block: ToolCallBlock, inheritedTurn?: number) => {
      const turn =
        'turn' in block ? block.turn : (inheritedTurn ?? analysisToolDelivery(block)?.turn)
      if (block.name === 'marivo_report_write' && turn !== undefined) {
        const key = candidateKey(sessionId, turn, block.callId),
          old = this.#items.get(key)
        const next = analysisCandidate(block, sessionId, workspaceId, generation, old, turn)
        if (old?.phase === 'cancelled' && next.phase !== 'saved') return
        if (!old || old.generation !== generation || JSON.stringify(old) !== JSON.stringify(next)) {
          this.#items.set(key, next)
          onChange(next, !old)
          for (const fn of this.#listeners) fn()
        }
      }
      for (const child of block.subCalls) visit(child, turn)
    }
    for (const block of blocks) visit(block, ownerTurn)
  }
  settle(sessionId: string) {
    for (const [key, item] of this.#items)
      if (item.sessionId === sessionId && ['preparing', 'start'].includes(item.phase))
        this.#items.set(key, { ...item, phase: 'cancelled' })
    for (const fn of this.#listeners) fn()
  }
  revoke(sessionId: string) {
    for (const [key, item] of this.#items) if (item.sessionId === sessionId) this.#items.delete(key)
    for (const fn of this.#listeners) fn()
  }
}
