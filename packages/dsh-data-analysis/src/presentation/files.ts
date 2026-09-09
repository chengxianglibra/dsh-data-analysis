import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  PRESENTATION_BUDGETS,
  type PresentationAsset,
  parsePresentationBuildId,
} from './contracts/index.ts'

export function presentationReportPath(root: string, reportId: string) {
  parsePresentationBuildId(reportId, '/reportId')
  return path.join(root, '.dsh-data-analysis', 'presentations', reportId)
}
export function presentationAssetPath(
  root: string,
  reportId: string,
  buildId: string,
  asset: PresentationAsset,
) {
  parsePresentationBuildId(buildId)
  if (asset !== 'presentation.json' && asset !== 'index.html') throw new Error('invalid-asset')
  return path.join(presentationReportPath(root, reportId), 'builds', buildId, asset)
}
export function presentationSha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Bounded raw-byte reader with no symbolic links and stable directory/file identity. */
export async function readPresentationAsset(
  workspaceRoot: string,
  reportId: string,
  buildId: string,
  asset: PresentationAsset,
  signal?: AbortSignal,
): Promise<Buffer> {
  const filename = presentationAssetPath(workspaceRoot, reportId, buildId, asset)
  return readReportFile(
    workspaceRoot,
    filename,
    asset === 'presentation.json'
      ? PRESENTATION_BUDGETS.documentBytes
      : PRESENTATION_BUDGETS.htmlBytes,
    signal,
  )
}

export async function readReportFile(
  workspaceRoot: string,
  filename: string,
  maximum: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted()
  const root = await realpath(workspaceRoot)
  if (root !== path.resolve(workspaceRoot) || !filename.startsWith(`${root}${path.sep}`))
    throw new Error('asset-path-mismatch')
  const parents = [root]
  for (const segment of path.relative(root, path.dirname(filename)).split(path.sep)) {
    if (!segment || segment === '..' || segment === '.') throw new Error('asset-path-mismatch')
    parents.push(path.join(parents.at(-1)!, segment))
  }
  const beforeParents = await Promise.all(parents.map((parent) => lstat(parent)))
  if (beforeParents.some((stat) => !stat.isDirectory() || stat.isSymbolicLink()))
    throw new Error('asset-path-mismatch')
  if ((await realpath(filename)) !== filename) throw new Error('asset-path-mismatch')
  const file = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error('asset-not-file')
    if (before.size > maximum) throw new Error('asset-too-large')
    // Allocate for the observed file, retaining one extra byte to detect growth.
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      signal?.throwIfAborted()
      const read = await file.read(bytes, length, bytes.length - length, null)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    if (length > maximum) throw new Error('asset-too-large')
    const after = await file.stat()
    const current = await lstat(filename)
    const afterParents = await Promise.all(parents.map((parent) => lstat(parent)))
    if (
      afterParents.some(
        (stat, index) =>
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          stat.dev !== beforeParents[index]!.dev ||
          stat.ino !== beforeParents[index]!.ino,
      ) ||
      (await realpath(workspaceRoot)) !== root ||
      (await realpath(filename)) !== filename
    )
      throw new Error('asset-path-mismatch')
    if (
      current.dev !== after.dev ||
      current.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      length !== after.size
    )
      throw new Error('asset-changed')
    signal?.throwIfAborted()
    return bytes.subarray(0, length)
  } finally {
    await file.close()
  }
}
