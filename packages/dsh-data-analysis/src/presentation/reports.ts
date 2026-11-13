import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { commitPresentationForPublication } from './commit.ts'
import { type AnalysisDocument, parseSavedPresentation } from './contracts/analysis-document.ts'
import {
  type PublicationSource,
  parseReportHistory,
  REPORT_HISTORY_BYTES,
  REPORT_HISTORY_LIMIT,
  type ReportCatalog,
  type ReportHistory,
} from './contracts/catalog.ts'
import { type PresentationReceipt, parsePresentationReceipt } from './contracts/index.ts'
import { savedReportRef } from './contracts/report-ref.ts'
import { parseSavedDocumentBytes } from './contracts/saved-document.ts'
import {
  presentationAssetPath,
  presentationReportPath,
  presentationSha256,
  readPresentationAsset,
  readReportFile,
} from './files.ts'
import { PresentationRecoveryError } from './recovery.ts'

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
  const document = parseSavedDocumentBytes(bytes)
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
    current.schemaVersion !== 4 ||
    Object.keys(current).sort().join(',') !== 'receipt,reportId,schemaVersion,versions,workspaceId'
  )
    throw new Error('invalid-report-current')
  const history = parseReportHistory({
    workspaceId,
    reportId,
    currentBuildId: receipt.buildId,
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
  publication?: { sessionId: string; callId: string },
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
      const version = publication
        ? history.versions.find(
            ({ source }) =>
              source.sessionId === publication.sessionId && source.callId === publication.callId,
          )
        : history.versions[0]
      if (version) reports.push(version)
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
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.receipt.reportId.localeCompare(b.receipt.reportId),
  )
  return { workspaceId, reports, unavailable }
}

/** Locks live outside the report directory so deletion cannot move a held lock. */
async function reportLockPath(root: string, reportId: string, assertOwner: () => Promise<void>) {
  const report = presentationReportPath(root, reportId)
  const paths = [root]
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('presentation-workspace-mismatch')
  const identities = [rootStat]
  const check = async () => {
    await assertOwner()
    for (const [index, filename] of paths.entries()) {
      const current = await lstat(filename)
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== identities[index]!.dev ||
        current.ino !== identities[index]!.ino ||
        (await realpath(filename)) !== filename
      )
        throw new Error('presentation-directory-changed')
    }
  }
  let parent = root
  for (const name of ['.dsh-data-analysis', 'presentations']) {
    await check()
    const next = path.join(parent, name)
    try {
      await mkdir(next, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await lstat(next)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(next)) !== next)
      throw new Error('presentation-directory-mismatch')
    paths.push(next)
    identities.push(stat)
    await check()
    parent = next
  }
  return { path: path.join(parent, `.report-lock-${path.basename(report)}`), check }
}

/** The mutable pointer is the publication boundary; completed builds are never overwritten. */
export async function publishPresentation(
  root: string,
  document: AnalysisDocument,
  expectedBuildId: string | null,
  assertOwner: () => Promise<void>,
  signal: AbortSignal | undefined,
  source: PublicationSource,
  onPublished?: () => void,
): Promise<PresentationReceipt> {
  const lock = await reportLockPath(root, document.reportId, assertOwner)
  return withFileLock(
    lock.path,
    async () => {
      await lock.check()
      signal?.throwIfAborted()
      // An edit must not recreate a directory after deletion.
      if (expectedBuildId !== null) {
        try {
          await readReportHistory(root, document.workspaceId, document.reportId, signal)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new Error('report-not-found')
          throw error
        }
      }
      return publishPresentationLocked(
        root,
        document,
        expectedBuildId,
        lock.check,
        signal,
        source,
        onPublished,
      )
    },
    { waitMs: 5000, signal },
  )
}

async function publishPresentationLocked(
  root: string,
  document: AnalysisDocument,
  expectedBuildId: string | null,
  assertOwner: () => Promise<void>,
  signal: AbortSignal | undefined,
  source: PublicationSource,
  onPublished?: () => void,
): Promise<PresentationReceipt> {
  await assertOwner()
  signal?.throwIfAborted()
  const documentBytes = Buffer.from(JSON.stringify(document), 'utf8')
  const built = {
    document: parseSavedPresentation(JSON.parse(documentBytes.toString('utf8'))),
    documentBytes,
  }
  await assertOwner()
  const { receipt, discard } = await commitPresentationForPublication(
    root,
    built,
    assertOwner,
    signal,
  )
  let published = false
  try {
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
        if ((current?.buildId ?? null) !== expectedBuildId)
          throw new PresentationRecoveryError(
            'report-save-conflict',
            'Read currentRef with marivo_report_read and review your intended changes against it. For an active draft, read {draft:true}, then preview an explicit onto with cumulative program and resourcePatch changes relative to the reviewed current version. For a data refresh, omit program and metadata and replace only compatible same-name resources. The draft is retained only until this Turn ends; do not blindly retry or overwrite the current version.',
            current
              ? {
                  currentRef: savedReportRef({
                    workspaceId: current.workspaceId,
                    reportId: current.reportId,
                    buildId: current.buildId,
                  }),
                }
              : {},
          )
        const versions = [
          { receipt, publishedAt: new Date().toISOString(), source },
          ...(history?.versions ?? []),
        ]
        if (versions.length > REPORT_HISTORY_LIMIT) throw historyFull()
        parseReportHistory({
          workspaceId: document.workspaceId,
          reportId: document.reportId,
          currentBuildId: receipt.buildId,
          versions,
        })
        const pointer = JSON.stringify({
          schemaVersion: 4,
          workspaceId: document.workspaceId,
          reportId: document.reportId,
          receipt,
          versions,
        })
        if (Buffer.byteLength(pointer) > REPORT_HISTORY_BYTES) throw historyFull()
        const temporary = path.join(directory, `.current-${randomUUID()}.tmp`)
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
          onPublished?.()
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
  } catch (error) {
    if (!published) {
      try {
        await discard()
      } catch {
        // Do not remove an unverified directory or mask the publication error.
      }
    }
    throw error
  }
}

/** Permanently remove a whole report; repeat the same request to retry interrupted cleanup. */
export async function deletePresentation(
  root: string,
  workspaceId: string,
  reportId: string,
  expectedBuildId: string,
  assertOwner: () => Promise<void>,
  signal?: AbortSignal,
): Promise<{ cleanupPending: boolean; cleanupPath?: string }> {
  const lock = await reportLockPath(root, reportId, assertOwner)
  const directory = presentationReportPath(root, reportId)
  const parent = path.dirname(directory)
  const suffix = createHash('sha256').update(workspaceId).digest('hex').slice(0, 24)
  const cleanupPath = path.join(parent, `.deleted-${reportId}-${suffix}`)
  const markerPath = `${cleanupPath}.json`
  return withFileLock(
    lock.path,
    async () => {
      await lock.check()
      signal?.throwIfAborted()
      const parentIdentity = await lstat(parent)
      if (
        !parentIdentity.isDirectory() ||
        parentIdentity.isSymbolicLink() ||
        (await realpath(parent)) !== parent
      )
        throw new Error('presentation-directory-mismatch')
      const checkParent = async () => {
        await lock.check()
        const current = await lstat(parent)
        if (
          current.dev !== parentIdentity.dev ||
          current.ino !== parentIdentity.ino ||
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          (await realpath(parent)) !== parent
        )
          throw new Error('presentation-directory-changed')
      }
      let pending = false
      let pendingIdentity: Awaited<ReturnType<typeof lstat>> | undefined
      try {
        const stat = await lstat(cleanupPath)
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (await realpath(cleanupPath)) !== cleanupPath
        )
          throw new Error('presentation-directory-mismatch')
        pending = true
        pendingIdentity = stat
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      let marker: unknown
      try {
        marker = JSON.parse((await readReportFile(root, markerPath, 4096, signal)).toString('utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const expectedMarker = JSON.stringify({ workspaceId, reportId, buildId: expectedBuildId })
      if (
        marker !== undefined &&
        (!marker ||
          typeof marker !== 'object' ||
          Array.isArray(marker) ||
          Object.keys(marker).sort().join(',') !== 'buildId,reportId,workspaceId' ||
          Reflect.get(marker, 'workspaceId') !== workspaceId ||
          Reflect.get(marker, 'reportId') !== reportId ||
          typeof Reflect.get(marker, 'buildId') !== 'string')
      )
        throw new Error('report-delete-cleanup-invalid')
      if (pending && JSON.stringify(marker) !== expectedMarker)
        throw new Error('report-delete-conflict')
      if (pending && marker === undefined) throw new Error('report-delete-cleanup-invalid')
      if (pending) {
        try {
          await lstat(directory)
          throw new Error('report-delete-cleanup-invalid')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (!pending) {
        let history: ReportHistory
        try {
          history = await readReportHistory(root, workspaceId, reportId, signal)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            if (marker !== undefined) {
              if (JSON.stringify(marker) !== expectedMarker)
                throw new Error('report-delete-conflict')
              try {
                await lstat(directory)
                throw new Error('report-delete-cleanup-invalid')
              } catch (missing) {
                if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing
              }
              await checkParent()
              await rm(markerPath)
              return { cleanupPending: false }
            }
            throw new Error('report-not-found')
          }
          throw error
        }
        if (history.currentBuildId !== expectedBuildId) throw new Error('report-delete-conflict')
        if (marker !== undefined && JSON.stringify(marker) !== expectedMarker) {
          await checkParent()
          await rm(markerPath)
          marker = undefined
        }
        const identity = await lstat(directory)
        if (
          !identity.isDirectory() ||
          identity.isSymbolicLink() ||
          (await realpath(directory)) !== directory
        )
          throw new Error('presentation-directory-mismatch')
        await checkParent()
        signal?.throwIfAborted()
        if (marker === undefined) {
          const temporary = path.join(parent, `.pending-delete-marker-${randomUUID()}.tmp`)
          try {
            const file = await open(
              temporary,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
              0o600,
            )
            try {
              await file.writeFile(expectedMarker)
              await file.sync()
            } finally {
              await file.close()
            }
            await checkParent()
            signal?.throwIfAborted()
            await link(temporary, markerPath)
          } finally {
            await rm(temporary, { force: true })
          }
          const parentHandle = await open(
            parent,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          )
          try {
            await parentHandle.sync()
          } finally {
            await parentHandle.close()
          }
        }
        await checkParent()
        signal?.throwIfAborted()
        const current = await lstat(directory)
        if (current.dev !== identity.dev || current.ino !== identity.ino)
          throw new Error('presentation-directory-changed')
        await rename(directory, cleanupPath)
        pendingIdentity = identity
      }
      // Once renamed, cancellation cannot undo deletion. Report cleanup separately.
      try {
        await checkParent()
        const parentHandle = await open(
          parent,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
        try {
          await parentHandle.sync()
        } finally {
          await parentHandle.close()
        }
        const stat = await lstat(cleanupPath)
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (await realpath(cleanupPath)) !== cleanupPath
        )
          throw new Error('presentation-directory-mismatch')
        if (
          !pendingIdentity ||
          stat.dev !== pendingIdentity.dev ||
          stat.ino !== pendingIdentity.ino
        )
          throw new Error('presentation-directory-changed')
        await rm(cleanupPath, { recursive: true })
        const syncedParent = await open(
          parent,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
        try {
          await syncedParent.sync()
        } finally {
          await syncedParent.close()
        }
        // The report removal is durable before its retry marker is removed.
        await rm(markerPath)
        try {
          const markerParent = await open(
            parent,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          )
          try {
            await markerParent.sync()
          } finally {
            await markerParent.close()
          }
        } catch {
          // A crash may leave only a harmless retry marker; report data is already gone.
        }
        return { cleanupPending: false }
      } catch {
        return { cleanupPending: true, cleanupPath }
      }
    },
    { waitMs: 5000, signal },
  )
}

function historyFull() {
  return new PresentationRecoveryError(
    'report-history-full',
    'This report has reached its version history limit. Create a new report without a base ref to receive a new reportId, or rebuild it after confirming the old versions are no longer needed.',
  )
}

/** Exact published revision lookup; never scans a directory or resolves to newer content. */
export async function readAnalysisRecord(
  root: string,
  workspaceId: string,
  reportId: string,
  buildId: string,
  signal?: AbortSignal,
) {
  const history = await readReportHistory(root, workspaceId, reportId, signal)
  const version = history.versions.find((v) => v.receipt.buildId === buildId)
  if (!version) throw new Error('report-build-not-found')
  return readReceiptDocument(root, version.receipt, signal)
}
