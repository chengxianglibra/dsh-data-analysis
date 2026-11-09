/** Pure Host delivery envelope shared by the server and browser. */
import { z } from 'zod'
import { analysisRecordId } from './contracts/analysis-document.ts'
import { type PresentationReceipt, parsePresentationReceipt } from './contracts/index.ts'

export const MARIVO_PRESENT_TOOL_NAME = 'marivo_present'
export const MARIVO_PRESENTATION_DELIVERY_KIND = 'marivo.presentation.delivery'
export const MARIVO_DRAFT_DELIVERY_KIND = 'marivo.presentation.draft'
export const MARIVO_PRESENTATION_RPC_CHANNEL = '/marivo-presentation'

export interface PresentationDelivery {
  kind: typeof MARIVO_PRESENTATION_DELIVERY_KIND
  schemaVersion: 2
  dshSessionId: string
  turn: number
  receipt: PresentationReceipt
  surface: 'tool' | 'tab'
  draftId?: string
}

const draftIdSchema = z.string().uuid()
export const draftDeliverySchema = z.strictObject({
  kind: z.literal(MARIVO_DRAFT_DELIVERY_KIND),
  dshSessionId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(512),
  turn: z.number().int().nonnegative(),
  surface: z.enum(['tool', 'tab']),
  draftId: draftIdSchema,
  draftRevision: draftIdSchema,
})
export type DraftDelivery = z.infer<typeof draftDeliverySchema>

export function parsePresentationToolDelivery(
  value: unknown,
): PresentationDelivery | DraftDelivery {
  const draft = draftDeliverySchema.safeParse(value)
  return draft.success ? draft.data : parsePresentationDelivery(value)
}

export function parsePresentationDelivery(value: unknown): PresentationDelivery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-presentation-delivery')
  const input = value as Record<string, unknown>
  if (
    Object.keys(input)
      .filter((key) => key !== 'draftId')
      .sort()
      .join(',') !== 'dshSessionId,kind,receipt,schemaVersion,surface,turn' ||
    ('draftId' in input && !draftIdSchema.safeParse(input.draftId).success) ||
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
    `Surface: ${surface === 'tab' ? 'tab' : 'chat'}`,
  ].join('\n')
}
