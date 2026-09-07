import type {
  ChatConversationViewNode,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  MARIVO_PRESENT_TOOL_NAME,
  MARIVO_PRESENTATION_DELIVERY_KIND,
  type PresentationDelivery,
  parsePresentationDelivery,
} from '../../presentation/receipt.ts'

export const PRESENTATION_TURN_DATA_KEY = 'marivo-presentation-delivery'

export interface PresentationTurnDelivery {
  readonly seq: number
  readonly delivery: PresentationDelivery
}
export interface PresentationTurnData {
  readonly deliveries: readonly PresentationTurnDelivery[]
}
interface PresentationTurnState extends PresentationTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string>
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    'marivo-presentation-delivery': PresentationTurnData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'marivo-presentation-delivery': PresentationTurnData
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
    Object.freeze(result.receipt.files.html)
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
  if (!Array.isArray(value)) return null
  const blocks = value.filter((item) => record(item)?.type === MARIVO_PRESENTATION_DELIVERY_KIND)
  if (blocks.length !== 1) return null
  const block = record(blocks[0])!
  if (Object.keys(block).sort().join(',') !== 'delivery,type') return null
  return parsedDelivery(block.delivery)
}

/** Calls are collected only from this Harness-owned Turn, including the Code root call. */
export function presentationDeliveryFromEvent(
  value: unknown,
  calls: ReadonlyMap<string, string>,
  turn: number,
): PresentationTurnDelivery | null {
  const event = record(value)
  if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0) return null
  const data = record(event.data)
  if (!data) return null
  let delivery: PresentationDelivery | null
  if (event.type === 'tool/result') {
    if (event.surfaceOp !== 'append' || data.turn !== turn) return null
    const message = record(data.message)
    if (!message || !Array.isArray(message.content)) return null
    const blocks = message.content.filter((item: unknown) => record(item)?.type === 'tool-result')
    if (blocks.length !== 1) return null
    const block = record(blocks[0])!
    const callId = record(message.source)?.callId
    if (
      typeof callId !== 'string' ||
      calls.get(callId) !== MARIVO_PRESENT_TOOL_NAME ||
      block.toolCallId !== callId ||
      block.isError === true
    )
      return null
    delivery = parsedDelivery(data.meta)
  } else if (event.type === 'tool/code-dispatch') {
    if (
      data.name !== MARIVO_PRESENT_TOOL_NAME ||
      data.isError !== false ||
      typeof data.rootCallId !== 'string' ||
      !calls.has(data.rootCallId) ||
      typeof data.subCallId !== 'string' ||
      !data.subCallId
    )
      return null
    delivery = parsePresentationDurableContent(data.content)
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
    if (['turn/start', 'tool/call', 'tool/result'].includes(event.type)) {
      if (!Number.isSafeInteger(data.turn) || data.turn < 0) return null
      if (event.type === 'tool/result' && event.surfaceOp !== 'append') return null
      return { id: String(data.turn), role: event.type === 'turn/start' ? 'start' : 'update' }
    }
    if (event.type !== 'tool/code-dispatch' || data.name !== MARIVO_PRESENT_TOOL_NAME) return null
    const delivery = parsePresentationDurableContent(data.content)
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
    return {
      key: context.key,
      id: context.id,
      kind: PRESENTATION_TURN_DATA_KEY,
      target: 'chat',
      anchorSeq: first.seq,
      location,
      visibility: 'visible',
      data: Object.freeze({ deliveries: state.deliveries }),
    } satisfies ChatConversationViewNode
  },
} satisfies ConversationNodeDefinition<PresentationTurnState>

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
