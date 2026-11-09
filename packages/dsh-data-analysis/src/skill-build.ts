import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packagedSkillBuild } from './skill-build.generated.ts'

export interface PackagedSkillBuild {
  readonly schema: 'dsh-data-analysis-skills/v1'
  readonly digest: string
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
}

export class PackagedSkillBuildError extends Error {
  readonly code = 'packaged-skill-build-mismatch'
}

function mismatch(build: PackagedSkillBuild, root: string, detail: string): never {
  throw new PackagedSkillBuildError(
    `Packaged Skill build ${build.digest} at ${root}: ${detail}. Rebuild the plugin ` +
      '(npm run prepare:source for source development, or reinstall the matching package), ' +
      'then restart the Host to load the matching tools and Skills. If a retained snapshot is ' +
      'damaged, close every Host using it before removing that exact digest directory.',
  )
}

function digest(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Read only regular files, retaining the exact validated bytes for snapshot creation. */
async function readBundle(
  root: string,
  build: PackagedSkillBuild,
  readonly = false,
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  async function visit(relative: string): Promise<void> {
    const filename = path.join(root, relative)
    const info = await lstat(filename)
    if (readonly && process.platform !== 'win32' && (info.mode & 0o222) !== 0)
      mismatch(build, root, `snapshot resource ${relative || '.'} is writable`)
    if (info.isDirectory()) {
      for (const child of (await readdir(filename)).sort())
        await visit(relative ? `${relative}/${child}` : child)
    } else if (info.isFile()) files.set(relative, await readFile(filename))
    else mismatch(build, root, `resource ${relative || '.'} is not a regular file or directory`)
  }
  try {
    await visit('')
  } catch (error) {
    if (error instanceof PackagedSkillBuildError) throw error
    mismatch(
      build,
      root,
      `cannot read resources (${error instanceof Error ? error.message : 'I/O failure'})`,
    )
  }
  return files
}

function validateBundle(
  files: ReadonlyMap<string, Buffer>,
  root: string,
  build: PackagedSkillBuild,
): void {
  const actual = [...files].map(([filename, bytes]) => ({ path: filename, sha256: digest(bytes) }))
  if (digest(JSON.stringify(actual)) === build.digest) return
  const expected = new Map(build.files.map((file) => [file.path, file.sha256]))
  for (const file of actual) {
    if (expected.get(file.path) !== file.sha256)
      mismatch(
        build,
        root,
        `resource ${file.path} expected ${expected.get(file.path) ?? 'absent'}, found ${file.sha256}`,
      )
    expected.delete(file.path)
  }
  mismatch(
    build,
    root,
    `missing resources: ${[...expected.keys()].join(', ') || 'manifest digest differs'}`,
  )
}

/**
 * Mountable content-addressed resources for this tool build. Snapshots outlive plugin
 * disposal because already activated Skills may still retain their resourceBase.
 */
export async function preparePackagedSkillSnapshot(
  snapshotsRoot: string,
  options: { readonly skillsRoot?: string; readonly build?: PackagedSkillBuild } = {},
): Promise<string> {
  const build = options.build ?? packagedSkillBuild
  const skillsRoot = options.skillsRoot ?? fileURLToPath(new URL('../skills/', import.meta.url))
  if (
    build.schema !== 'dsh-data-analysis-skills/v1' ||
    !/^[a-f0-9]{64}$/.test(build.digest) ||
    build.files.length === 0 ||
    build.files.some(
      (file) =>
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        file.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part)),
    ) ||
    digest(JSON.stringify(build.files)) !== build.digest
  )
    mismatch(build, skillsRoot, 'invalid embedded resource manifest')

  // Always validate the mutable distribution, even if this build already has a snapshot.
  const bytes = await readBundle(skillsRoot, build)
  validateBundle(bytes, skillsRoot, build)
  const snapshot = path.join(snapshotsRoot, build.digest)
  async function existingSnapshot(): Promise<boolean> {
    try {
      await lstat(snapshot)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
    validateBundle(await readBundle(snapshot, build, true), snapshot, build)
    return true
  }
  if (await existingSnapshot()) return realpath(snapshot)
  await mkdir(snapshotsRoot, { recursive: true })
  const staging = await mkdtemp(path.join(snapshotsRoot, '.skill-build-'))
  const directories = new Set([staging])
  try {
    for (const [relative, content] of bytes) {
      const filename = path.join(staging, relative)
      let directory = path.dirname(filename)
      while (directory !== staging) {
        directories.add(directory)
        directory = path.dirname(directory)
      }
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, content, { mode: 0o444, flag: 'wx' })
    }
    for (const directory of directories) await chmod(directory, 0o555)
    try {
      await rename(staging, snapshot)
    } catch (error) {
      // Another Host may have published this exact build concurrently.
      if (!(await existingSnapshot())) throw error
    }
    validateBundle(await readBundle(snapshot, build, true), snapshot, build)
    return realpath(snapshot)
  } finally {
    // Only our unpublished staging tree is eligible for removal, never a snapshot.
    for (const directory of directories) await chmod(directory, 0o755).catch(() => {})
    await rm(staging, { recursive: true, force: true })
  }
}
