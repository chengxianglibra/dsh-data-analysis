/** Pure Host delivery envelope shared by the server and browser. */
import { analysisRecordId } from './contracts/analysis-document.ts'
import { type PresentationReceipt, parsePresentationReceipt } from './contracts/index.ts'

export const MARIVO_PRESENT_TOOL_NAME = 'marivo_present'
export const MARIVO_PRESENTATION_DELIVERY_KIND = 'marivo.presentation.delivery'
export const MARIVO_PRESENTATION_RPC_CHANNEL = '/marivo-presentation'

export interface PresentationDelivery {
  kind: typeof MARIVO_PRESENTATION_DELIVERY_KIND
  schemaVersion: 2
  dshSessionId: string
  turn: number
  receipt: PresentationReceipt
  surface: 'tool' | 'tab'
}

export function parsePresentationDelivery(value: unknown): PresentationDelivery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-presentation-delivery')
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).sort().join(',') !==
      'dshSessionId,kind,receipt,schemaVersion,surface,turn' ||
    (input.surface !== 'tool' && input.surface !== 'tab') ||
    input.kind !== MARIVO_PRESENTATION_DELIVERY_KIND ||
    input.schemaVersion !== 2 ||
    typeof input.dshSessionId !== 'string' ||
    !input.dshSessionId.trim() ||
    input.dshSessionId.length > 512 ||
    !Number.isSafeInteger(input.turn) ||
    (input.turn as number) < 0
  )
    throw new Error('invalid-presentation-delivery')
  parsePresentationReceipt(input.receipt)
  return input as unknown as PresentationDelivery
}

/** Model-facing receipt text: identity and delivery surface, without Workspace paths or digests. */
export function presentationReceiptText(
  receipt: PresentationReceipt,
  surface: 'tool' | 'tab',
): string {
  return [
    receipt.title,
    receipt.summary,
    `Record: ${analysisRecordId(receipt.reportId, receipt.buildId)}`,
    `Build: ${receipt.buildId}`,
    `Surface: ${surface === 'tab' ? 'tab' : 'tool view'}`,
  ].join('\n')
}
