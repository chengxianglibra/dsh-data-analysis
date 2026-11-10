import type { AnalysisDocument } from './contracts/analysis-document.ts'
import type { ComponentRequest } from './contracts/component-reference.ts'
import { isFrameSnapshotV2 } from './contracts/snapshot.ts'

/** Bind the complete saved Frame to its fixed Build, including empty snapshots. */
export function frameFromDocument(document: AnalysisDocument, request: ComponentRequest) {
  const resource = document.resources[request.resourceName]
  if (
    document.workspaceId !== request.workspaceId ||
    document.recordId !== request.recordId ||
    resource?.kind !== 'snapshot' ||
    !isFrameSnapshotV2(resource.snapshot)
  )
    throw new Error('frame-unavailable')
  const snapshot = resource.snapshot
  return { snapshot }
}
