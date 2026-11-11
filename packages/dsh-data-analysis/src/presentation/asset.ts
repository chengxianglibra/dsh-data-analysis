import type { PresentationReceipt } from './contracts/index.ts'
import { parseSavedDocumentBytes } from './contracts/saved-document.ts'
import { presentationAssetPath, presentationSha256, readPresentationAsset } from './files.ts'

/** Read a fixed, receipt-verified snapshot; never access analysis or current. */
export async function readReceiptAsset(
  root: string,
  workspaceId: string,
  receipt: PresentationReceipt,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  if (receipt.workspaceId !== workspaceId) throw new Error('asset-owner-mismatch')
  for (const file of Object.values(receipt.files))
    if (file.path !== presentationAssetPath(root, receipt.reportId, receipt.buildId, file.asset))
      throw new Error('asset-path-mismatch')
  const bytes = await readPresentationAsset(
    root,
    receipt.reportId,
    receipt.buildId,
    'presentation.json',
    signal,
  )
  if (
    bytes.length !== receipt.files.document.bytes ||
    presentationSha256(bytes) !== receipt.files.document.sha256
  )
    throw new Error('asset-digest-mismatch')
  const document = parseSavedDocumentBytes(bytes)
  if (
    document.workspaceId !== workspaceId ||
    document.reportId !== receipt.reportId ||
    document.buildId !== receipt.buildId ||
    document.title !== receipt.title
  )
    throw new Error('asset-owner-mismatch')
  signal.throwIfAborted()
  return { bytes, sha256: receipt.files.document.sha256 }
}
