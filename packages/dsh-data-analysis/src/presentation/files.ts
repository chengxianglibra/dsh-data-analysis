import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  PRESENTATION_BUDGETS,
  type PresentationAsset,
  parsePresentationBuildId,
} from './contracts/index.ts'

export function presentationAssetPath(root: string, buildId: string, asset: PresentationAsset) {
  parsePresentationBuildId(buildId)
  if (asset !== 'presentation.json' && asset !== 'index.html') throw new Error('invalid-asset')
  return path.join(root, '.dsh-data-analysis', 'presentations', buildId, asset)
}
export function presentationSha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Bounded raw-byte reader with no symbolic links and stable directory/file identity. */
export async function readPresentationAsset(
  workspaceRoot: string,
  buildId: string,
  asset: PresentationAsset,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted()
  const root = await realpath(workspaceRoot)
  if (root !== path.resolve(workspaceRoot)) throw new Error('asset-path-mismatch')
  const filename = presentationAssetPath(root, buildId, asset)
  const parents = [
    root,
    path.join(root, '.dsh-data-analysis'),
    path.dirname(path.dirname(filename)),
    path.dirname(filename),
  ]
  const beforeParents = await Promise.all(parents.map((parent) => lstat(parent)))
  if (beforeParents.some((stat) => !stat.isDirectory() || stat.isSymbolicLink()))
    throw new Error('asset-path-mismatch')
  if ((await realpath(filename)) !== filename) throw new Error('asset-path-mismatch')
  const maximum =
    asset === 'presentation.json'
      ? PRESENTATION_BUDGETS.documentBytes
      : PRESENTATION_BUDGETS.htmlBytes
  const file = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error('asset-not-file')
    if (before.size > maximum) throw new Error('asset-too-large')
    const bytes = Buffer.alloc(maximum + 1)
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
