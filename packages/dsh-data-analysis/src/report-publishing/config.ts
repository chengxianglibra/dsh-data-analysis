import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'

const reference = z.string().refine(isCredentialRefName)
const url = z
  .string()
  .url()
  .refine((value) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return false
    }
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
  })
export const publishingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    storage: z
      .object({
        name: z.string().min(1).max(100),
        protocol: z.literal('s3').default('s3'),
        endpoint: url,
        region: z.string().min(1),
        bucket: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/),
        forcePathStyle: z.boolean().default(false),
        accessKeyIdRef: reference,
        secretAccessKeyRef: reference,
        sessionTokenRef: reference.optional(),
      })
      .strict(),
    pathPrefix: z
      .string()
      .default('reports')
      .refine(
        (value) =>
          value === '' ||
          value.split('/').every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part)),
      ),
    publicBaseUrl: url,
  })
  .strict()
  .superRefine((config, ctx) => {
    const refs = [
      config.storage.accessKeyIdRef,
      config.storage.secretAccessKeyRef,
      config.storage.sessionTokenRef,
    ].filter(Boolean)
    if (new Set(refs).size !== refs.length)
      ctx.addIssue({ code: 'custom', message: 'distinct-credential-references-required' })
  })
export type ReportPublishingConfig = z.input<typeof publishingConfigSchema> | { enabled?: false }
export type EnabledPublishingConfig = z.output<typeof publishingConfigSchema>
export function resolvePublishingConfig(
  value?: ReportPublishingConfig,
): EnabledPublishingConfig | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('report-publishing-config-invalid')
  if (value.enabled === false || value.enabled === undefined) return undefined
  const result = publishingConfigSchema.safeParse(value)
  if (!result.success) throw new Error('report-publishing-config-invalid')
  return result.data
}
