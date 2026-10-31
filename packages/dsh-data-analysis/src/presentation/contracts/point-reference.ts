import { z } from 'zod'

const text = z.string().min(1).max(512)
const cell = z.union([z.string().max(32768), z.number().finite(), z.boolean(), z.null()])
const dtype = z.strictObject({
  type: z.enum(['string', 'boolean', 'float64', 'int64', 'decimal', 'date', 'datetime']),
  precision: z.number().int().nonnegative().optional(),
  scale: z.number().int().nonnegative().optional(),
  timeUnit: z.enum(['s', 'ms', 'us', 'ns']).optional(),
  timezone: text.optional(),
})
const column = z.strictObject({
  id: text,
  label: text,
  type: dtype.shape.type,
  nullable: z.boolean(),
  unit: text.optional(),
})
const pointRequest = z.strictObject({
  sessionId: text,
  workspaceId: text,
  recordId: text,
  resourceName: text,
  row: z.number().int().nonnegative().max(4999),
  field: text,
})
const point = z.strictObject({
  column,
  value: cell,
  role: text,
  description: z.string().max(2000).nullable(),
  axes: z
    .array(
      z.strictObject({
        token: text,
        name: text,
        role: text,
        variant: z.string().max(32768),
        keys: z.array(z.strictObject({ id: text, slotId: text, dtype, value: cell })).max(64),
      }),
    )
    .max(64),
  coordinates: z
    .array(
      z.strictObject({
        name: text,
        axisToken: text,
        endpoint: z.enum(['self', 'left', 'right']),
        part: z.enum(['key', 'label', 'start', 'end', 'nominal_start', 'nominal_end']),
        value: cell,
      }),
    )
    .max(64),
  presence: z.array(z.strictObject({ name: text, value: cell })).max(64),
  related: z.array(z.strictObject({ column, value: cell, role: z.literal('pair_count') })).max(1),
  coverageComplete: z.boolean(),
  interpretation: z.string().max(131072).nullable(),
  periods: z.string().max(131072),
})
const envelope = pointRequest.extend({
  schema: z.literal('dsh-data-analysis-frame-point/v1'),
  point,
})
export type PointRequest = z.infer<typeof pointRequest>
export type PointEnvelope = z.infer<typeof envelope>
export function parsePointRequest(value: unknown): PointRequest {
  const result = pointRequest.safeParse(value)
  if (!result.success) throw new Error('invalid-request')
  return result.data
}
export function parsePointEnvelope(value: unknown): PointEnvelope {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 131072)
      throw new Error('invalid-request')
  } catch {
    throw new Error('invalid-request')
  }
  const result = envelope.safeParse(value)
  if (!result.success) throw new Error('invalid-request')
  return result.data
}
