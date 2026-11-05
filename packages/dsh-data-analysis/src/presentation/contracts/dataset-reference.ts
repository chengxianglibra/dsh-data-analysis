import { z } from 'zod'

const text = z.string().min(1).max(512)
const legacyRequest = z.strictObject({
  sessionId: text,
  workspaceId: text,
  recordId: text,
  resourceName: text,
})
const pointRequest = legacyRequest.extend({
  row: z.number().int().nonnegative().max(4999),
  field: text,
})
const legacyEnvelope = legacyRequest.extend({
  schema: z.literal('dsh-data-analysis-dataset/v1'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})
const pointEnvelope = pointRequest.extend({
  schema: z.literal('dsh-data-analysis-dataset-point/v1'),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})
const request = z.union([pointRequest, legacyRequest])
const envelope = z.discriminatedUnion('schema', [legacyEnvelope, pointEnvelope])
export type DatasetRequest = z.infer<typeof pointRequest>
export type AnyDatasetRequest = z.infer<typeof request>
export type DatasetEnvelope = z.infer<typeof envelope>
export function parseDatasetRequest(value: unknown): AnyDatasetRequest {
  const result = request.safeParse(value)
  if (!result.success) throw new Error('invalid-request')
  return result.data
}
export function parseDatasetEnvelope(value: unknown): DatasetEnvelope {
  const result = envelope.safeParse(value)
  if (!result.success) throw new Error('invalid-request')
  return result.data
}
