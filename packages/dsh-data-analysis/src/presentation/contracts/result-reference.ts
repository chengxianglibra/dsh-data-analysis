import { z } from 'zod'
import { frameResultReference } from './frame-result-reference.ts'

export const dataframeResultReference = z.strictObject({
  schema: z.literal('marivo.dataframe_ref/v2'),
  project_root: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes('\0')),
  result_id: z.string().regex(/^df_[a-f0-9]{32}$/),
})
export const resultReference = z.union([frameResultReference, dataframeResultReference])
export type ResultReference = z.infer<typeof resultReference>

export function resultReferenceKey(value: ResultReference): string {
  return JSON.stringify(resultReference.parse(value))
}
