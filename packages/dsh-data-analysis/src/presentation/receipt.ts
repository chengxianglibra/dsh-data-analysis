/** Pure Host delivery envelope shared by the server and browser. */
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
}

export function parsePresentationDelivery(value: unknown): PresentationDelivery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-presentation-delivery')
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).sort().join(',') !== 'dshSessionId,kind,receipt,schemaVersion,turn' ||
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

export function presentationReceiptText(receipt: PresentationReceipt): string {
  return [
    receipt.title,
    receipt.summary,
    `Workspace: ${receipt.workspaceId}`,
    `Report: ${receipt.reportId}`,
    `Build: ${receipt.buildId}`,
    ...Object.values(receipt.files).flatMap((file) => [
      `${file.asset}: ${file.path}`,
      `sha256: ${file.sha256}; bytes: ${file.bytes}`,
    ]),
  ].join('\n')
}
