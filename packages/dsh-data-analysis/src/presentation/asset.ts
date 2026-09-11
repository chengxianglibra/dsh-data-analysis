import { buildPresentation } from './build/index.ts'
import {
  type PresentationAsset,
  type PresentationReceipt,
  parsePresentationDocument,
} from './contracts/index.ts'
import { presentationAssetPath, presentationSha256, readPresentationAsset } from './files.ts'

/** Read a fixed, receipt-verified snapshot; never access analysis or current. */
export async function readReceiptAsset(
  root: string,
  workspaceId: string,
  receipt: PresentationReceipt,
  asset: PresentationAsset,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  if (receipt.workspaceId !== workspaceId) throw new Error('asset-owner-mismatch')
  for (const file of Object.values(receipt.files))
    if (file.path !== presentationAssetPath(root, receipt.reportId, receipt.buildId, file.asset))
      throw new Error('asset-path-mismatch')
  const documentBytes = await readPresentationAsset(
    root,
    receipt.reportId,
    receipt.buildId,
    'presentation.json',
    signal,
  )
  if (
    documentBytes.length !== receipt.files.document.bytes ||
    presentationSha256(documentBytes) !== receipt.files.document.sha256
  )
    throw new Error('asset-digest-mismatch')
  const document = parsePresentationDocument(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(documentBytes)),
  )
  if (
    document.workspaceId !== workspaceId ||
    document.reportId !== receipt.reportId ||
    document.buildId !== receipt.buildId ||
    document.title !== receipt.title
  )
    throw new Error('asset-owner-mismatch')
  const bytes =
    asset === 'presentation.json'
      ? documentBytes
      : receipt.files.html
        ? await readPresentationAsset(root, receipt.reportId, receipt.buildId, asset, signal)
        : (await buildPresentation(document)).htmlBytes!
  const file =
    asset === 'presentation.json'
      ? receipt.files.document
      : (receipt.files.html ?? { bytes: bytes.length, sha256: presentationSha256(bytes) })
  if (bytes.length !== file.bytes || presentationSha256(bytes) !== file.sha256)
    throw new Error('asset-digest-mismatch')
  signal.throwIfAborted()
  return { bytes, sha256: file.sha256 }
}
