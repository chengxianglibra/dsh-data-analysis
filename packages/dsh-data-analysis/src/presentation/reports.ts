import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { buildPresentation } from './build/index.ts'
import { commitPresentation } from './commit.ts'
import {
  type PresentationDocument,
  type PresentationReceipt,
  parsePresentationDocument,
  parsePresentationReceipt,
} from './contracts/index.ts'
import {
  presentationAssetPath,
  presentationReportPath,
  presentationSha256,
  readPresentationAsset,
  readReportFile,
} from './files.ts'

export async function readReceiptDocument(
  root: string,
  receipt: PresentationReceipt,
  signal?: AbortSignal,
) {
  for (const asset of Object.values(receipt.files)) {
    if (asset.path !== presentationAssetPath(root, receipt.reportId, receipt.buildId, asset.asset))
      throw new Error('asset-path-mismatch')
  }
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
  const document = parsePresentationDocument(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  )
  if (
    document.workspaceId !== receipt.workspaceId ||
    document.reportId !== receipt.reportId ||
    document.buildId !== receipt.buildId ||
    document.title !== receipt.title
  )
    throw new Error('asset-owner-mismatch')
  return document
}

export async function resolvePresentation(
  root: string,
  workspaceId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<PresentationReceipt> {
  const bytes = await readReportFile(
    root,
    path.join(presentationReportPath(root, reportId), 'current.json'),
    20 * 1024,
    signal,
  )
  const current = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (
    !current ||
    Object.keys(current).sort().join(',') !== 'receipt,reportId,schemaVersion,workspaceId' ||
    current.schemaVersion !== 2 ||
    current.workspaceId !== workspaceId ||
    current.reportId !== reportId
  )
    throw new Error('invalid-report-current')
  const receipt = parsePresentationReceipt(current.receipt)
  if (receipt.workspaceId !== workspaceId || receipt.reportId !== reportId)
    throw new Error('asset-owner-mismatch')
  await readReceiptDocument(root, receipt, signal)
  return receipt
}

/** The mutable pointer is the publication boundary; completed builds are never overwritten. */
export async function publishPresentation(
  root: string,
  document: PresentationDocument,
  expectedBuildId: string | null,
  assertOwner: () => Promise<void>,
  signal?: AbortSignal,
): Promise<PresentationReceipt> {
  await assertOwner()
  signal?.throwIfAborted()
  const built = await buildPresentation(document)
  await assertOwner()
  const receipt = await commitPresentation(root, built, assertOwner, signal)
  const directory = presentationReportPath(root, document.reportId)
  const currentPath = path.join(directory, 'current.json')
  const parents = [root]
  for (const segment of path.relative(root, directory).split(path.sep))
    parents.push(path.join(parents.at(-1)!, segment))
  const identities = await Promise.all(parents.map((parent) => lstat(parent)))
  const check = async () => {
    signal?.throwIfAborted()
    await assertOwner()
    const actual = await Promise.all(parents.map((parent) => lstat(parent)))
    if (
      (await realpath(directory)) !== directory ||
      actual.some(
        (entry, index) =>
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          entry.dev !== identities[index]!.dev ||
          entry.ino !== identities[index]!.ino,
      )
    )
      throw new Error('presentation-directory-changed')
  }
  await check()
  await withFileLock(
    currentPath,
    async () => {
      await check()
      let current: PresentationReceipt | undefined
      try {
        current = await resolvePresentation(root, document.workspaceId, document.reportId, signal)
      } catch (error) {
        if (expectedBuildId !== null || (error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
        // ENOENT is allowed only for an absent pointer, never a dangling current build.
        try {
          await lstat(currentPath)
          throw new Error('invalid-report-current')
        } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing
        }
      }
      if ((current?.buildId ?? null) !== expectedBuildId) throw new Error('report-save-conflict')
      const temporary = path.join(directory, `.current-${randomUUID()}.tmp`)
      let published = false
      try {
        const file = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        try {
          await file.writeFile(
            JSON.stringify({
              schemaVersion: 2,
              workspaceId: document.workspaceId,
              reportId: document.reportId,
              receipt,
            }),
            { signal },
          )
          await file.sync()
        } finally {
          await file.close()
        }
        await check()
        await rename(temporary, currentPath)
        published = true
        const parent = await open(
          directory,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
        try {
          await parent.sync()
        } finally {
          await parent.close()
        }
        // Cancellation after the rename cannot undo a published save.
      } finally {
        if (!published) await rm(temporary, { force: true })
      }
    },
    { waitMs: 5000 },
  )
  return receipt
}
