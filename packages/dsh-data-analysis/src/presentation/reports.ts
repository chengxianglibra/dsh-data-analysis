import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { buildPresentation } from './build/index.ts'
import { commitPresentation } from './commit.ts'
import {
  type PublicationSource,
  parseReportHistory,
  REPORT_HISTORY_BYTES,
  REPORT_HISTORY_LIMIT,
  type ReportCatalog,
  type ReportHistory,
} from './contracts/catalog.ts'
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

/** Current and its publication history become visible through one atomic rename. */
export async function readReportHistory(
  root: string,
  workspaceId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<ReportHistory> {
  const bytes = await readReportFile(
    root,
    path.join(presentationReportPath(root, reportId), 'current.json'),
    REPORT_HISTORY_BYTES,
    signal,
  )
  const current = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!current || current.workspaceId !== workspaceId || current.reportId !== reportId)
    throw new Error('invalid-report-current')
  const receipt = parsePresentationReceipt(current.receipt)
  if (receipt.workspaceId !== workspaceId || receipt.reportId !== reportId)
    throw new Error('asset-owner-mismatch')
  if (
    current.schemaVersion === 2 &&
    Object.keys(current).sort().join(',') === 'receipt,reportId,schemaVersion,workspaceId'
  ) {
    return {
      workspaceId,
      reportId,
      currentBuildId: receipt.buildId,
      legacyHistoryUnavailable: true,
      versions: [{ receipt, publishedAt: null, source: null }],
    }
  }
  if (
    current.schemaVersion !== 3 ||
    Object.keys(current).sort().join(',') !==
      'legacyHistoryUnavailable,receipt,reportId,schemaVersion,versions,workspaceId'
  )
    throw new Error('invalid-report-current')
  const history = parseReportHistory({
    workspaceId,
    reportId,
    currentBuildId: receipt.buildId,
    legacyHistoryUnavailable: current.legacyHistoryUnavailable,
    versions: current.versions,
  })
  if (JSON.stringify(history.versions[0]!.receipt) !== JSON.stringify(receipt))
    throw new Error('invalid-report-history')
  return history
}

export async function resolvePresentation(
  root: string,
  workspaceId: string,
  reportId: string,
  signal?: AbortSignal,
): Promise<PresentationReceipt> {
  const history = await readReportHistory(root, workspaceId, reportId, signal)
  const receipt = history.versions[0]!.receipt
  await readReceiptDocument(root, receipt, signal)
  return receipt
}

/** Enumerate only publication pointers, never completed-but-unpublished build directories. */
export async function listReports(
  root: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<ReportCatalog> {
  const directory = path.dirname(presentationReportPath(root, 'catalog'))
  const parents = [root, path.dirname(directory), directory]
  const identities = []
  try {
    for (const name of parents) {
      const stat = await lstat(name)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(name)) !== name)
        throw new Error('asset-path-mismatch')
      identities.push(stat)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { workspaceId, reports: [], unavailable: 0 }
    throw error
  }
  const reports: ReportCatalog['reports'] = []
  let unavailable = 0,
    count = 0
  for await (const entry of await opendir(directory)) {
    signal?.throwIfAborted()
    if (++count > 4096) throw new Error('report-catalog-too-large')
    if (entry.name.startsWith('.')) continue
    try {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('asset-not-file')
      const history = await readReportHistory(root, workspaceId, entry.name, signal)
      reports.push(history.versions[0]!)
    } catch (error) {
      signal?.throwIfAborted()
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unavailable++
    }
  }
  for (const [index, name] of parents.entries()) {
    const stat = await lstat(name)
    if (
      stat.dev !== identities[index]!.dev ||
      stat.ino !== identities[index]!.ino ||
      stat.isSymbolicLink() ||
      (await realpath(name)) !== name
    )
      throw new Error('asset-path-mismatch')
  }
  reports.sort(
    (a, b) =>
      (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') ||
      a.receipt.reportId.localeCompare(b.receipt.reportId),
  )
  return { workspaceId, reports, unavailable }
}

/** The mutable pointer is the publication boundary; completed builds are never overwritten. */
export async function publishPresentation(
  root: string,
  document: PresentationDocument,
  expectedBuildId: string | null,
  assertOwner: () => Promise<void>,
  signal?: AbortSignal,
  source: PublicationSource | null = null,
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
      let history: ReportHistory | undefined
      let current: PresentationReceipt | undefined
      try {
        history = await readReportHistory(root, document.workspaceId, document.reportId, signal)
        current = history.versions[0]!.receipt
        await readReceiptDocument(root, current, signal)
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
      const versions = [
        { receipt, publishedAt: new Date().toISOString(), source },
        ...(history?.versions ?? []),
      ]
      if (versions.length > REPORT_HISTORY_LIMIT) throw new Error('report-history-full')
      parseReportHistory({
        workspaceId: document.workspaceId,
        reportId: document.reportId,
        currentBuildId: receipt.buildId,
        legacyHistoryUnavailable: history?.legacyHistoryUnavailable ?? false,
        versions,
      })
      const pointer = JSON.stringify({
        schemaVersion: 3,
        workspaceId: document.workspaceId,
        reportId: document.reportId,
        receipt,
        versions,
        legacyHistoryUnavailable: history?.legacyHistoryUnavailable ?? false,
      })
      if (Buffer.byteLength(pointer) > REPORT_HISTORY_BYTES) throw new Error('report-history-full')
      const temporary = path.join(directory, `.current-${randomUUID()}.tmp`)
      let published = false
      try {
        const file = await open(
          temporary,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        )
        try {
          await file.writeFile(pointer, { signal })
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
