import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { BuiltPresentation } from './build/index.ts'
import {
  PRESENTATION_BUDGETS,
  type PresentationReceipt,
  parsePresentationDocument,
  parsePresentationReceipt,
} from './contracts/index.ts'
import { presentationAssetPath, presentationSha256, readPresentationAsset } from './files.ts'

interface DirectoryIdentity {
  dev: number
  ino: number
}
async function directory(filename: string): Promise<DirectoryIdentity> {
  const stat = await lstat(filename)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(filename)) !== filename)
    throw new Error('presentation-directory-mismatch')
  return stat
}
async function syncDirectory(filename: string) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
async function sameDirectory(filename: string, expected: DirectoryIdentity) {
  const actual = await directory(filename)
  if (actual.dev !== expected.dev || actual.ino !== expected.ino)
    throw new Error('presentation-directory-changed')
}

/** Owns only one newly-created build. A single directory rename publishes both complete files. */
export async function commitPresentation(
  workspaceRoot: string,
  input: BuiltPresentation,
  assertOwner: () => Promise<void>,
  signal?: AbortSignal,
): Promise<PresentationReceipt> {
  signal?.throwIfAborted()
  const document = parsePresentationDocument(structuredClone(input.document))
  const built = {
    document,
    documentBytes: Buffer.from(input.documentBytes),
    htmlBytes: Buffer.from(input.htmlBytes),
  }
  if (
    built.documentBytes.length > PRESENTATION_BUDGETS.documentBytes ||
    built.htmlBytes.length === 0 ||
    built.htmlBytes.length > PRESENTATION_BUDGETS.htmlBytes
  )
    throw new Error('presentation-build-budget')
  if (!built.documentBytes.equals(Buffer.from(JSON.stringify(document))))
    throw new Error('presentation-build-document-mismatch')
  const root = await realpath(workspaceRoot)
  if (root !== path.resolve(workspaceRoot)) throw new Error('presentation-workspace-mismatch')
  const paths = [
    root,
    path.join(root, '.dsh-data-analysis'),
    path.join(root, '.dsh-data-analysis', 'presentations'),
    path.join(root, '.dsh-data-analysis', 'presentations', document.reportId),
    path.join(root, '.dsh-data-analysis', 'presentations', document.reportId, 'builds'),
  ]
  const identities: DirectoryIdentity[] = []
  for (const [index, filename] of paths.entries()) {
    if (index > 0) {
      await sameDirectory(paths[index - 1]!, identities[index - 1]!)
      try {
        await mkdir(filename, { mode: 0o700 })
        await syncDirectory(paths[index - 1]!)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    identities.push(await directory(filename))
  }
  const check = async () => {
    signal?.throwIfAborted()
    await assertOwner()
    for (const [index, filename] of paths.entries())
      await sameDirectory(filename, identities[index]!)
    signal?.throwIfAborted()
  }
  await check()
  const parent = paths.at(-1)!
  const temporary = await mkdtemp(path.join(parent, '.pending-'))
  const ownedIdentity = await directory(temporary)
  const final = path.dirname(
    presentationAssetPath(
      root,
      built.document.reportId,
      built.document.buildId,
      'presentation.json',
    ),
  )
  let owned = temporary
  try {
    await check()
    for (const [asset, bytes] of [
      ['presentation.json', built.documentBytes],
      ['index.html', built.htmlBytes],
    ] as const) {
      await sameDirectory(temporary, ownedIdentity)
      signal?.throwIfAborted()
      const file = await open(
        path.join(temporary, asset),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      try {
        await file.writeFile(bytes, { signal })
        await file.sync()
      } finally {
        await file.close()
      }
    }
    await check()
    await sameDirectory(temporary, ownedIdentity)
    await syncDirectory(temporary)
    // Never overwrite a completed build (the caller creates an unpredictable build UUID).
    try {
      await lstat(final)
      throw new Error('presentation-build-exists')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(temporary, final)
    owned = final
    for (const filename of [...paths].reverse()) await syncDirectory(filename)
    await check()
    await sameDirectory(final, ownedIdentity)
    const document = await readPresentationAsset(
      root,
      built.document.reportId,
      built.document.buildId,
      'presentation.json',
      signal,
    )
    const html = await readPresentationAsset(
      root,
      built.document.reportId,
      built.document.buildId,
      'index.html',
      signal,
    )
    if (!document.equals(built.documentBytes) || !html.equals(built.htmlBytes))
      throw new Error('presentation-build-changed')
    await check()
    return parsePresentationReceipt({
      schemaVersion: 2,
      reportId: built.document.reportId,
      kind: 'marivo.presentation',
      workspaceId: built.document.workspaceId,
      buildId: built.document.buildId,
      title: built.document.title,
      summary: `${built.document.blocks.length} 个区块 · ${built.document.datasets.length} 份数据集 · ${built.document.sources.length} 个声明来源 · ${built.document.diagnostics.length} 条诊断`,
      files: {
        document: {
          asset: 'presentation.json',
          path: path.join(final, 'presentation.json'),
          sha256: presentationSha256(document),
          bytes: document.length,
        },
        html: {
          asset: 'index.html',
          path: path.join(final, 'index.html'),
          sha256: presentationSha256(html),
          bytes: html.length,
        },
      },
    })
  } catch (error) {
    // Cleanup only this invocation's unchanged directory; never follow a replaced parent.
    try {
      for (const [index, filename] of paths.entries())
        await sameDirectory(filename, identities[index]!)
      await sameDirectory(owned, ownedIdentity)
      await rm(owned, { recursive: true, force: true })
    } catch {
      /* Failure cleanup must not hide the original cancellation/write error. */
    }
    throw error
  }
}
