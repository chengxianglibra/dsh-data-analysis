import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type AnalysisResourceDeclaration,
  analysisResourceDeclaration,
} from '../../presentation/contracts/analysis-document.ts'
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
  resources?: Record<string, AnalysisResourceDeclaration>
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
  const surface = args.complete('surface')
    ? args.text('surface')
    : args.closed() && !args.text('draftId')
      ? 'tool'
      : undefined
  const keys = args.keys()
  const earlySurface =
    keys.includes('surface') &&
    (!keys.includes('program') || keys.indexOf('surface') < keys.indexOf('program'))
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
  const declarations = args.complete('resources') ? args.value('resources') : undefined
  let resources: AnalysisCandidate['resources']
  if (declarations && typeof declarations === 'object' && !Array.isArray(declarations)) {
    const entries = Object.entries(declarations).map(
      ([name, value]) => [name, analysisResourceDeclaration.safeParse(value)] as const,
    )
    if (entries.every(([, value]) => value.success))
      resources = Object.fromEntries(
        entries.flatMap(([name, value]) => (value.success ? [[name, value.data]] : [])),
      )
  }
  const locale = args.complete('locale') ? args.text('locale') : undefined
  return {
    sessionId,
    workspaceId,
    generation,
    callId: block.callId,
    turn: 'turn' in block ? block.turn : (ownerTurn ?? delivery?.turn ?? previous?.turn ?? -1),
    phase: 'kind' in block ? (delivery ? 'saved' : draft ? 'previewed' : 'failed') : block.phase,
    surface: surface === 'tool' || surface === 'tab' ? surface : undefined,
    stage: args.text('stage') === 'preview' ? 'preview' : 'save',
    draftId: args.complete('draftId') ? args.text('draftId') : undefined,
    draftRevision: args.complete('draftRevision') ? args.text('draftRevision') : undefined,
    rebaseOnRecordId: args.complete('rebaseOnRecordId') ? args.text('rebaseOnRecordId') : undefined,
    ...(draft?.dshSessionId === sessionId && draft.workspaceId === workspaceId ? { draft } : {}),
    preview:
      (earlySurface || keys.includes('draftId')) &&
      (!keys.includes('draftId') || (args.complete('draftId') && args.complete('draftRevision'))) &&
      (!keys.includes('stage') || args.complete('stage')) &&
      (!keys.includes('rebaseOnRecordId') || args.complete('rebaseOnRecordId')) &&
      (!keys.includes('basedOnRecordId') || args.complete('basedOnRecordId')) &&
      !args.invalid &&
      !args.stringExceeds('program', PRESENTATION_BUDGETS.text),
    program,
    complete: args.complete('program'),
    basedOnRecordId: args.complete('basedOnRecordId') ? args.text('basedOnRecordId') : undefined,
    title: args.complete('title') ? args.text('title') : undefined,
    locale: locale === 'en-US' || locale === 'zh-CN' ? locale : undefined,
    resources,
    delivery,
  }
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
      if (block.name === 'marivo_present' && turn !== undefined) {
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
