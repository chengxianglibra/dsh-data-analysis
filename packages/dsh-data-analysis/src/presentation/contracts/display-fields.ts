import { z } from 'zod'

/** Presentation fields shared by Frame and Dataset, without analysis semantics. */
export const commonDisplayFields = {
  height: z.number().int().positive().max(1200).optional(),
  title: z.string().trim().min(1).max(512).optional(),
  subtitle: z.string().trim().min(1).max(1024).optional(),
  formats: z
    .array(
      z.strictObject({
        value: z.string().min(1).max(512),
        format: z.enum(['percent', 'number', 'currency']),
        decimals: z.number().int().min(0).max(6).optional(),
      }),
    )
    .max(64)
    .optional(),
}
