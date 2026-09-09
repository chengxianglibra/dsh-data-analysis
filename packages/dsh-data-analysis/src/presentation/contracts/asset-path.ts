/** Fixed Build locator shared by the browser and Workspace storage. */
import { parsePresentationBuildId } from './index.ts'
import type { PresentationAsset } from './types.ts'

export function presentationAssetRelativePath(
  reportId: string,
  buildId: string,
  asset: PresentationAsset,
): string {
  parsePresentationBuildId(reportId, '/reportId')
  parsePresentationBuildId(buildId)
  if (asset !== 'presentation.json' && asset !== 'index.html') throw new Error('invalid-asset')
  return `.dsh-data-analysis/presentations/${reportId}/builds/${buildId}/${asset}`
}
