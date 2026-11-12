import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'

const reference = z.string().refine(isCredentialRefName)
const url = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const parsed = URL.parse(value)
    return (
      parsed !== null &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    )
  })
const enabledPublishing = z
  .strictObject({
    enabled: z.literal(true),
    storage: z.strictObject({
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
    }),
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
  .refine(({ storage }) => {
    const refs = [storage.accessKeyIdRef, storage.secretAccessKeyRef, storage.sessionTokenRef]
    return new Set(refs).size === refs.length
  })

export type ReportPublishingConfig = z.input<typeof enabledPublishing> | { enabled?: false }
export type EnabledPublishingConfig = z.output<typeof enabledPublishing>

export function resolvePublishingConfig(value: unknown): EnabledPublishingConfig | undefined {
  if (value === undefined) return undefined
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (!('enabled' in value) || value.enabled === undefined || value.enabled === false)
  )
    return undefined
  const result = enabledPublishing.safeParse(value)
  if (!result.success) throw new Error('report-publishing-config-invalid')
  return result.data
}
