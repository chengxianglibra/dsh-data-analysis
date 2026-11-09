import { z } from 'zod'

/** The inert identity returned by a persisted Marivo AnalysisFrame.ref.to_dict(). */
export const frameResultReference = z.strictObject({
  schema: z.literal('marivo.frame_ref/v2'),
  store_id: z.string().min(1).max(512),
  session_id: z.string().min(1).max(512),
  artifact_id: z.string().min(1).max(512),
})
export type FrameResultReference = z.infer<typeof frameResultReference>
