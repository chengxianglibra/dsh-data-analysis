import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { PresentationContractError } from '../contracts/index.ts'

function boundary(location: string): never {
  throw new PresentationContractError(
    'file_boundary',
    location,
    'Expected an unchanged regular file inside the bound Workspace without symbolic links.',
  )
}

/** Read raw bytes under a strict budget before JSON parsing, including concurrent growth. */
export async function readWorkspaceJson(
  workspaceRoot: string,
  relativePath: string,
  maximum: number,
  location: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted()
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.split('/').some((part) => !part || part === '.' || part === '..')
  )
    boundary(location)
  try {
    const root = await realpath(workspaceRoot)
    if (root !== path.resolve(workspaceRoot)) boundary(location)
    const segments = relativePath.split('/')
    const filename = path.join(root, ...segments)
    const parents = [
      root,
      ...segments.slice(0, -1).map((_, index) => path.join(root, ...segments.slice(0, index + 1))),
    ]
    const beforeParents = await Promise.all(parents.map((parent) => lstat(parent)))
    if (beforeParents.some((stat) => !stat.isDirectory() || stat.isSymbolicLink()))
      boundary(location)
    if ((await realpath(filename)) !== filename) boundary(location)
    if (!(await lstat(filename)).isFile()) boundary(location)
    const file = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const before = await file.stat()
      if (!before.isFile()) boundary(location)
      if (before.size > maximum)
        throw new PresentationContractError(
          'budget',
          location,
          'Input file exceeds the presentation byte budget.',
        )
      const bytes = Buffer.alloc(maximum + 1)
      let length = 0
      while (length < bytes.length) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > maximum)
        throw new PresentationContractError(
          'budget',
          location,
          'Input file exceeds the presentation byte budget.',
        )
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
        (await realpath(filename)) !== filename ||
        current.dev !== after.dev ||
        current.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        length !== after.size
      )
        boundary(location)
      signal?.throwIfAborted()
      try {
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
        )
      } catch {
        throw new PresentationContractError('invalid_json', location, 'Expected valid UTF-8 JSON.')
      }
    } finally {
      await file.close()
    }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof PresentationContractError) throw error
    boundary(location)
  }
}
