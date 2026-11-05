import { z } from 'zod'
import { PRESENTATION_BUDGETS } from './types.ts'

const text = z.string().min(1).max(512)
// Saved program content is bounded by UTF-16 characters. Its JSON encoding can
// be larger due to UTF-8 and escaping, so the wire limit must be byte based.
export const COMPONENT_REFERENCE_MAX_BYTES = 256 * 1024
const component = z.strictObject({
  kind: z.enum(['frame', 'dataset']),
  statementId: z.string().min(1).max(PRESENTATION_BUDGETS.text).optional(),
  view: z.unknown().optional(),
  display: z.unknown().optional(),
})
const request = z.strictObject({
  sessionId: text,
  workspaceId: text,
  recordId: text,
  resourceName: text,
  component,
})
const envelope = request.extend({
  schema: z.literal('dsh-data-analysis-component/v1'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})
export type ComponentRequest = z.infer<typeof request>
export type ComponentEnvelope = z.infer<typeof envelope>
function withinBudget(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value)
    return (
      encoded !== undefined &&
      new TextEncoder().encode(encoded).byteLength <= COMPONENT_REFERENCE_MAX_BYTES
    )
  } catch {
    return false
  }
}
export function parseComponentRequest(value: unknown): ComponentRequest {
  const result = request.safeParse(value)
  if (!result.success || !withinBudget(result.data)) throw new Error('invalid-request')
  return result.data
}
export function parseComponentEnvelope(value: unknown): ComponentEnvelope {
  const result = envelope.safeParse(value)
  if (!result.success || !withinBudget(result.data)) throw new Error('invalid-request')
  return result.data
}
