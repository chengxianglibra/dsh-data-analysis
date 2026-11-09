import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type DraftDelivery,
  draftDeliverySchema,
  MARIVO_DRAFT_DELIVERY_KIND,
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../presentation/receipt.ts'

export const PRESENTATION_TURN_DATA_KEY = 'marivo-presentation-delivery'
export const ANALYSIS_SURFACE_NODE_KEY = 'marivo-analysis-surface'

export interface PresentationTurnDelivery {
  readonly seq: number
  readonly delivery: PresentationDelivery
}
export interface PresentationTurnData {
  readonly deliveries: readonly PresentationTurnDelivery[]
  readonly drafts?: readonly { readonly seq: number; readonly delivery: DraftDelivery }[]
}
export interface AnalysisSurfaceData extends PresentationTurnData {
  readonly turn: number
  readonly boundary: number | null
}
interface PresentationTurnState extends PresentationTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string>
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    'marivo-presentation-delivery': PresentationTurnData
  }
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'marivo-presentation-delivery': PresentationTurnData
    'marivo-analysis-surface': AnalysisSurfaceData
  }
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}
function parsedDelivery(value: unknown): PresentationDelivery | null {
  try {
    // Events belong to Harness. Detach and freeze our publication rather than retaining aliases.
    const parsed = parsePresentationDelivery(value)
    const result = JSON.parse(JSON.stringify(parsed)) as PresentationDelivery
    Object.freeze(result.receipt.files.document)
    Object.freeze(result.receipt.files)
    Object.freeze(result.receipt)
    return Object.freeze(result)
  } catch {
    return null
  }
}

export function presentationDeliveryIdentity(delivery: PresentationDelivery): string {
  return JSON.stringify([
    delivery.dshSessionId,
    delivery.turn,
    delivery.receipt.workspaceId,
    delivery.receipt.buildId,
  ])
}

/** Code Mode carries the same envelope as Native metadata, inside one durable block. */
export function parsePresentationDurableContent(value: unknown): PresentationDelivery | null {
  return parsedDelivery(durableDelivery(value, MARIVO_PRESENTATION_DELIVERY_KIND))
}

function durableDelivery(value: unknown, kind: string): unknown {
  if (!Array.isArray(value)) return null
  const blocks = value.filter((item) => record(item)?.type === kind)
  if (blocks.length !== 1) return null
  const block = record(blocks[0])!
  if (Object.keys(block).sort().join(',') !== 'delivery,type') return null
  return block.delivery
}

export function parseDraftDelivery(value: unknown): DraftDelivery | null {
  const parsed = draftDeliverySchema.safeParse(value)
  return parsed.success ? Object.freeze(parsed.data) : null
}

export function parseDraftDurableContent(value: unknown): DraftDelivery | null {
  return parseDraftDelivery(durableDelivery(value, MARIVO_DRAFT_DELIVERY_KIND))
}

export function presentationDeliveryFromEvent(
  value: unknown,
  calls: ReadonlyMap<string, string>,
  turn: number,
): PresentationTurnDelivery | null {
  return toolDeliveryFromEvent(value, calls, turn, parsedDelivery, parsePresentationDurableContent)
}

export function draftDeliveryFromEvent(
  value: unknown,
  calls: ReadonlyMap<string, string>,
  turn: number,
) {
  return toolDeliveryFromEvent(value, calls, turn, parseDraftDelivery, parseDraftDurableContent)
}

/** Calls are collected only from this Harness-owned Turn, including the Code root call. */
function toolDeliveryFromEvent<T extends { turn: number }>(
  value: unknown,
  calls: ReadonlyMap<string, string>,
  turn: number,
  parseMeta: (meta: unknown) => T | null,
  parseContent: (content: unknown) => T | null,
): { readonly seq: number; readonly delivery: T } | null {
  const event = record(value)
  if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0) return null
  const data = record(event.data)
  if (!data) return null
  let delivery: T | null
  if (event.type === 'tool/result') {
    if (event.surfaceOp !== 'append' || data.turn !== turn) return null
    const message = record(data.message)
    if (!message || !Array.isArray(message.content)) return null
    const callId = record(message.source)?.callId
    if (
      typeof callId !== 'string' ||
      calls.get(callId) !== MARIVO_PRESENT_TOOL_NAME ||
      message.isError === true ||
      message.role !== 'tool' ||
      record(message.source)?.kind !== 'tool' ||
      message.toolCallId !== callId ||
      message.content.some((item: unknown) => record(item)?.type === 'tool-result')
    )
      return null
    delivery = parseMeta(data.meta)
  } else if (event.type === 'tool/ptc-dispatch') {
    if (
      data.name !== MARIVO_PRESENT_TOOL_NAME ||
      data.isError !== false ||
      typeof data.rootCallId !== 'string' ||
      !calls.has(data.rootCallId) ||
      typeof data.subCallId !== 'string' ||
      !data.subCallId
    )
      return null
    delivery = parseContent(data.content)
  } else return null
  if (!delivery || delivery.turn !== turn) return null
  return Object.freeze({ seq: event.seq, delivery })
}

export const marivoPresentationDeliveryDefinition = {
  kind: PRESENTATION_TURN_DATA_KEY,
  target: 'chat',
  match(value: unknown) {
    const event = record(value),
      data = record(event?.data)
    if (!event || !data) return null
    if (['turn/start', 'turn/end', 'tool/call', 'tool/result'].includes(event.type)) {
      if (!Number.isSafeInteger(data.turn) || data.turn < 0) return null
      if (event.type === 'tool/result' && event.surfaceOp !== 'append') return null
      return { id: String(data.turn), role: event.type === 'turn/start' ? 'start' : 'update' }
    }
    if (event.type !== 'tool/ptc-dispatch' || data.name !== MARIVO_PRESENT_TOOL_NAME) return null
    const delivery =
      parsePresentationDurableContent(data.content) ?? parseDraftDurableContent(data.content)
    return delivery ? { id: String(delivery.turn), role: 'update' } : null
  },
  start(_context: unknown, match: { event: any }): PresentationTurnState {
    if (match.event.type !== 'turn/start') throw new Error('presentation-turn-start-required')
    return { turn: match.event.data.turn, calls: new Map(), deliveries: [] }
  },
  update(context: { state: PresentationTurnState }, match: { event: any }): PresentationTurnState {
    const { state } = context,
      { event } = match
    if (event.type === 'tool/call') {
      if (
        event.data?.turn !== state.turn ||
        typeof event.data.callId !== 'string' ||
        typeof event.data.name !== 'string'
      )
        return state
      const calls = new Map(state.calls)
      calls.set(event.data.callId, event.data.name)
      return { ...state, calls }
    }
    const item = presentationDeliveryFromEvent(event, state.calls, state.turn)
    const draft = draftDeliveryFromEvent(event, state.calls, state.turn)
    if (draft) {
      if (
        state.drafts?.some((item) => item.delivery.draftRevision === draft.delivery.draftRevision)
      )
        return state
      return {
        ...state,
        drafts: Object.freeze([
          ...(state.drafts ?? []).filter(
            (item) => item.delivery.draftId !== draft.delivery.draftId,
          ),
          draft,
        ]),
      }
    }
    if (
      !item ||
      state.deliveries.some(
        ({ delivery }) =>
          presentationDeliveryIdentity(delivery) === presentationDeliveryIdentity(item.delivery),
      )
    )
      return state
    return { ...state, deliveries: Object.freeze([...state.deliveries, item]) }
  },
  buildLocationData(context: { state?: PresentationTurnState }, scope: string) {
    if (scope !== 'turn' || !context.state) return null
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: PRESENTATION_TURN_DATA_KEY,
      value: Object.freeze({ deliveries: context.state.deliveries }),
    }
  },
  buildViewNode(context: ConversationNodeContext<PresentationTurnState>) {
    const { state, start } = context
    const first = state?.deliveries[0]
    const location = start?.location
    if (
      !state ||
      !first ||
      !location ||
      (location.kind !== 'turn' && location.kind !== 'step') ||
      location.turn.turn !== state.turn
    )
      return null
    const end = location.turn.end
    // Keep the same node, but place a completed Turn's reports after its final
    // response. Do not compete with the Host's exclusive ProducedFiles tail.
    const completed =
      end?.type === 'turn/end' &&
      end.data.turn === state.turn &&
      end.data.reason?.kind === 'completed' &&
      Number.isSafeInteger(end.seq) &&
      end.seq >= first.seq
    return {
      key: context.key,
      id: context.id,
      kind: PRESENTATION_TURN_DATA_KEY,
      target: 'chat',
      anchorSeq: completed ? end.seq : first.seq,
      location,
      visibility: 'visible',
      data: Object.freeze({ deliveries: state.deliveries }),
    } satisfies ChatConversationViewNode
  },
} satisfies ConversationNodeDefinition<PresentationTurnState>

function isCurrentAnalysisSurface(value: unknown): value is ChatConversationViewNode {
  const node = record(value)
  return (
    node?.kind === ANALYSIS_SURFACE_NODE_KEY &&
    node.target === 'chat' &&
    Number.isSafeInteger(node.anchorSeq) &&
    node.anchorSeq >= 0 &&
    record(node.location)?.kind === 'session' &&
    (node.visibility === 'visible' || node.visibility === 'hidden')
  )
}

/** Saved tool surfaces live outside the Host's foldable Turn process group. */
export const marivoAnalysisSurfaceDefinition = {
  kind: ANALYSIS_SURFACE_NODE_KEY,
  target: 'chat',
  // A loaded window can start midway through a Turn. The first recognized
  // event establishes its Turn only; a receipt still requires its own call.
  match(value: unknown) {
    const match = marivoPresentationDeliveryDefinition.match(value)
    return match ? { ...match, role: 'start' as const } : null
  },
  start(_context: unknown, match: { event: unknown }): PresentationTurnState {
    const event = record(match.event)
    const data = record(event?.data)
    const turn =
      event?.type === 'tool/ptc-dispatch'
        ? (
            parsePresentationDurableContent(data?.content) ??
            parseDraftDurableContent(data?.content)
          )?.turn
        : data?.turn
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0)
      throw new Error('presentation-surface-turn-required')
    const calls = new Map<string, string>()
    if (
      event?.type === 'tool/call' &&
      typeof data?.callId === 'string' &&
      typeof data?.name === 'string'
    )
      calls.set(data.callId, data.name)
    return { turn, calls, deliveries: [] }
  },
  update: marivoPresentationDeliveryDefinition.update,
  buildViewNode(context: ConversationNodeContext<PresentationTurnState>) {
    const { state, start } = context
    const existing = context.current.get('chat')
    const current =
      isCurrentAnalysisSurface(existing) &&
      existing.key === context.key &&
      existing.id === context.id
        ? existing
        : null
    const location = start?.location
    if (
      !state ||
      !location ||
      (location.kind !== 'turn' && location.kind !== 'step') ||
      location.turn.turn !== state.turn
    )
      return current
    const end = location.turn.end
    if (
      end !== undefined &&
      (end.type !== 'turn/end' ||
        end.data?.turn !== state.turn ||
        !Number.isSafeInteger(end.seq) ||
        end.seq < 0)
    )
      return current ? { ...current, visibility: 'hidden' as const } : null
    const boundary = end?.seq ?? null
    const deliveries = state.deliveries.filter(
      (item) => item.delivery.surface === 'tool' && (boundary === null || item.seq <= boundary),
    )
    const drafts = end
      ? []
      : (state.drafts ?? []).filter(
          (item) =>
            item.delivery.surface === 'tool' &&
            !state.deliveries.some((saved) => saved.delivery.draftId === item.delivery.draftId),
        )
    if (!deliveries.length && !drafts.length) {
      return (end || state.drafts?.length) && current
        ? { ...current, visibility: 'hidden' as const }
        : current
    }
    const latest = [...deliveries, ...drafts].reduce((seq, item) => Math.max(seq, item.seq), 0)
    return {
      key: context.key,
      id: context.id,
      kind: ANALYSIS_SURFACE_NODE_KEY,
      target: 'chat',
      anchorSeq: end && end.seq >= latest ? end.seq : latest,
      location: { kind: 'session' },
      visibility: 'visible',
      data: Object.freeze({
        turn: state.turn,
        boundary,
        deliveries: Object.freeze(deliveries),
        ...(drafts.length ? { drafts: Object.freeze(drafts) } : {}),
      }),
    } satisfies ChatConversationViewNode
  },
} satisfies ConversationNodeDefinition<PresentationTurnState>

/** Ephemeral revisions never render from completed history or another Session. */
export function analysisDraftForNode(node: unknown, sessionId: string): DraftDelivery | undefined {
  if (!isCurrentAnalysisSurface(node)) return undefined
  const data = record(record(node)?.data)
  if (!data || data.boundary !== null || !Array.isArray(data.drafts)) return undefined
  const item = data.drafts.at(-1)
  const delivery = parseDraftDelivery(record(item)?.delivery)
  return delivery?.dshSessionId === sessionId &&
    delivery.turn === data.turn &&
    delivery.surface === 'tool'
    ? delivery
    : undefined
}

/** Resolve only deliveries owned by the session providing this keyed Chat slot. */
export function analysisSurfacesForNode(
  node: ChatConversationViewNode,
  sessionId: string,
): PresentationDelivery[] {
  if (
    node.kind !== ANALYSIS_SURFACE_NODE_KEY ||
    node.target !== 'chat' ||
    node.location.kind !== 'session'
  )
    return []
  const data = record(node.data)
  if (
    !data ||
    !Number.isSafeInteger(data.turn) ||
    data.turn < 0 ||
    node.id !== String(data.turn) ||
    !Array.isArray(data.deliveries) ||
    (data.boundary !== null && (!Number.isSafeInteger(data.boundary) || data.boundary < 0))
  )
    return []
  const seen = new Set<string>()
  const items: PresentationTurnDelivery[] = []
  for (const value of data.deliveries) {
    const item = record(value)
    if (
      !item ||
      typeof item.seq !== 'number' ||
      !Number.isSafeInteger(item.seq) ||
      item.seq < 0 ||
      (data.boundary !== null && item.seq > data.boundary)
    )
      continue
    const delivery = parsedDelivery(item.delivery)
    if (delivery) items.push({ seq: item.seq, delivery })
  }
  items.sort((left, right) => left.seq - right.seq)
  return items.flatMap((item) => {
    const { delivery } = item
    if (
      delivery.surface !== 'tool' ||
      delivery.turn !== data.turn ||
      delivery.dshSessionId !== sessionId
    )
      return []
    const identity = presentationDeliveryIdentity(delivery)
    if (seen.has(identity)) return []
    seen.add(identity)
    return [delivery]
  })
}

/** Session identity comes from the Host's keyed Chat slot, never from an event field. */
export function presentationsForNode(
  node: ChatConversationViewNode,
  sessionId: string,
): PresentationDelivery[] {
  if (node.kind !== PRESENTATION_TURN_DATA_KEY || node.target !== 'chat') return []
  const { location } = node
  if (location.kind !== 'turn' && location.kind !== 'step') return []
  const { turn } = location
  const data = record(node.data)
  if (!Array.isArray(data?.deliveries)) return []
  const end = turn.end
  if (
    end !== undefined &&
    (end.type !== 'turn/end' ||
      end.data?.turn !== turn.turn ||
      !Number.isSafeInteger(end.seq) ||
      end.seq < 0)
  )
    return []
  // The Host Turn boundary limits receipts; neither final text nor Turn completion
  // is required for this independent node to publish successful deliveries.
  const boundary = end?.seq ?? Number.POSITIVE_INFINITY
  const seen = new Set<string>()
  const items: PresentationTurnDelivery[] = data.deliveries
    .filter((item: any) => Number.isSafeInteger(item?.seq) && item.seq >= 0 && item.seq <= boundary)
    .sort((left: PresentationTurnDelivery, right: PresentationTurnDelivery) => left.seq - right.seq)
  return items.flatMap((item) => {
    const delivery = parsedDelivery(item.delivery)
    if (!delivery || delivery.turn !== turn.turn || delivery.dshSessionId !== sessionId) return []
    const id = presentationDeliveryIdentity(delivery)
    if (seen.has(id)) return []
    seen.add(id)
    return [delivery]
  })
}
