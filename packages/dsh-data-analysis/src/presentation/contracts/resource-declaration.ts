import { z } from 'zod'
import { frameResultReference } from './frame-result-reference.ts'
import { dataframeResultReference } from './result-reference.ts'

export const pythonCodeRef = z.strictObject({
  executionId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})
export const analysisResourceDeclaration = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('analysis-frame'),
    ref: frameResultReference,
    codeRef: pythonCodeRef.optional(),
  }),
  z.strictObject({
    kind: z.literal('dataframe'),
    ref: dataframeResultReference,
    codeRef: pythonCodeRef.optional(),
  }),
  z.strictObject({ kind: z.literal('dataset-snapshot'), snapshotRef: z.string().max(512) }),
  z.strictObject({ kind: z.literal('frame-snapshot'), snapshotRef: z.string().max(512) }),
  z.strictObject({ kind: z.literal('image-file'), path: z.string().min(1).max(4096) }),
])
export type AnalysisResourceDeclaration = z.infer<typeof analysisResourceDeclaration>

/** Producer metadata does not turn the same immutable result into newly computed data. */
export function sameAnalysisResult(
  a: AnalysisResourceDeclaration,
  b: AnalysisResourceDeclaration,
): boolean {
  if (a.kind === 'dataframe' && b.kind === 'dataframe')
    return a.ref.project_root === b.ref.project_root && a.ref.result_id === b.ref.result_id
  if (a.kind === 'analysis-frame' && b.kind === 'analysis-frame')
    return (
      a.ref.store_id === b.ref.store_id &&
      a.ref.session_id === b.ref.session_id &&
      a.ref.artifact_id === b.ref.artifact_id
    )
  if (
    (a.kind === 'dataset-snapshot' && b.kind === 'dataset-snapshot') ||
    (a.kind === 'frame-snapshot' && b.kind === 'frame-snapshot')
  )
    return a.snapshotRef === b.snapshotRef
  return a.kind === 'image-file' && b.kind === 'image-file' && a.path === b.path
}
