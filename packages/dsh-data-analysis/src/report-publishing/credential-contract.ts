import { z } from 'zod'

export const REPORT_PUBLISHING_CHANNEL = '/dsh-report-publishing'
export const publishingFields = ['accessKeyId', 'secretAccessKey', 'sessionToken'] as const
export const publishingFieldSchema = z.enum(publishingFields)
export type PublishingField = z.infer<typeof publishingFieldSchema>

const publishingCredentialViewSchema = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(false), fields: z.tuple([]) }),
  z.strictObject({
    enabled: z.literal(true),
    configId: z.string().uuid(),
    name: z.string(),
    bucket: z.string(),
    fields: z.array(
      z.strictObject({
        field: publishingFieldSchema,
        reference: z.string(),
        required: z.boolean(),
        configured: z.boolean(),
        writable: z.boolean(),
        source: z.string().optional(),
      }),
    ),
  }),
])
export type PublishingCredentialView = z.infer<typeof publishingCredentialViewSchema>
export const publishingCredentialResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: publishingCredentialViewSchema }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
])
