import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { PythonCodeRef, PythonCodeSnippet } from './python-execution-contracts.ts'

export type { PythonCodeRef, PythonCodeSnippet } from './python-execution-contracts.ts'

const CODE_BYTES = 131072
const RECORD_BYTES = 262144
const EXECUTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DIGEST = /^[0-9a-f]{64}$/

function invalid(): never {
  throw new Error('Python execution source is unavailable or invalid')
}
function same(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}
async function directory(filename: string): Promise<Stats> {
  const stat = await lstat(filename)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(filename)) !== filename)
    invalid()
  return stat
}
async function directories(workspaceRoot: string, create: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const root = await realpath(workspaceRoot)
  if (root !== path.resolve(workspaceRoot)) invalid()
  const workspaceIdentity = await directory(root)
  const hostRoot = path.resolve(resolveDshHome())
  const paths = [
    hostRoot,
    path.join(hostRoot, 'dsh-data-analysis'),
    path.join(hostRoot, 'dsh-data-analysis', 'python-executions'),
    path.join(hostRoot, 'dsh-data-analysis', 'python-executions', sha256(Buffer.from(root))),
  ]
  const identities: Stats[] = []
  const check = async (checkSignal = true) => {
    if (checkSignal) signal?.throwIfAborted()
    if (
      !same(await directory(root), workspaceIdentity) ||
      path.resolve(resolveDshHome()) !== hostRoot
    )
      invalid()
    for (const [index, expected] of identities.entries())
      if (!same(await directory(paths[index]!), expected)) invalid()
    if (checkSignal) signal?.throwIfAborted()
  }
  for (const [index, filename] of paths.entries()) {
    await check()
    if (create && index > 0) {
      try {
        await mkdir(filename, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    identities.push(await directory(filename))
  }
  await check()
  return { root, parent: paths[3]!, check }
}
function sourceText(text: unknown): text is string {
  return (
    typeof text === 'string' &&
    !!text.trim() &&
    !text.includes('\0') &&
    !/[\uD800-\uDFFF]/u.test(text) &&
    Buffer.byteLength(text) <= CODE_BYTES
  )
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  )
}
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Publish a complete record once. Its final name never exposes a partial write or overwrites. */
export async function savePythonExecution(
  workspaceRoot: string,
  input: { text: string; startedAt: string; finishedAt: string },
  signal?: AbortSignal,
): Promise<PythonCodeRef> {
  try {
    signal?.throwIfAborted()
    const { text, startedAt, finishedAt } = input
    if (
      !sourceText(text) ||
      !timestamp(startedAt) ||
      !timestamp(finishedAt) ||
      finishedAt < startedAt
    )
      invalid()
    const workspace = await directories(workspaceRoot, true, signal)
    const executionId = randomUUID()
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        executionId,
        projectRoot: workspace.root,
        language: 'python',
        text,
        startedAt,
        finishedAt,
        exitCode: 0,
      }),
    )
    if (bytes.length > RECORD_BYTES) invalid()
    const ref = { executionId, sha256: sha256(bytes) }
    const temporary = path.join(workspace.parent, `.${executionId}.pending`)
    const final = path.join(workspace.parent, `${executionId}.json`)
    await workspace.check()
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    const identity = await file.stat()
    let published = false
    try {
      await file.writeFile(bytes, { signal })
      await file.sync()
      await workspace.check()
      if (!same(await lstat(temporary), identity)) invalid()
      // Hard-link publication is atomic and fails if a final path already exists.
      await link(temporary, final)
      published = true
      await workspace.check()
      if (!same(await lstat(final), identity)) invalid()
      const verified = await readPythonExecution(workspace.root, ref, signal)
      if (verified.text !== text) invalid()
      await workspace.check()
      return ref
    } catch (error) {
      if (published) {
        try {
          await workspace.check(false)
          if (same(await lstat(final), identity)) await unlink(final)
        } catch {
          /* Do not remove a replaced path or hide the original error. */
        }
      }
      throw error
    } finally {
      await file.close()
      try {
        await workspace.check(false)
        if (same(await lstat(temporary), identity)) await unlink(temporary)
      } catch {
        /* Cleanup cannot override successful execution or follow a replaced parent. */
      }
    }
  } catch {
    signal?.throwIfAborted()
    invalid()
  }
}

/** Resolve Host-stored execution identities for the bound Workspace. Never executes code. */
export async function readPythonExecution(
  workspaceRoot: string,
  ref: PythonCodeRef,
  signal?: AbortSignal,
): Promise<PythonCodeSnippet> {
  try {
    signal?.throwIfAborted()
    if (!ref || !EXECUTION_ID.test(ref.executionId) || !DIGEST.test(ref.sha256)) invalid()
    const { executionId, sha256: expectedDigest } = ref
    const workspace = await directories(workspaceRoot, false, signal)
    const filename = path.join(workspace.parent, `${executionId}.json`)
    const expected = await lstat(filename)
    if (!expected.isFile() || expected.isSymbolicLink() || (await realpath(filename)) !== filename)
      invalid()
    const file = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const before = await file.stat()
      if (!before.isFile() || !same(before, expected) || before.size > RECORD_BYTES) invalid()
      const bytes = Buffer.alloc(RECORD_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        signal?.throwIfAborted()
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      const after = await file.stat()
      const current = await lstat(filename)
      await workspace.check()
      if (
        length > RECORD_BYTES ||
        length !== after.size ||
        !same(current, after) ||
        !current.isFile() ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        (await realpath(filename)) !== filename
      )
        invalid()
      const raw = bytes.subarray(0, length)
      if (sha256(raw) !== expectedDigest) invalid()
      const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
      if (
        !record ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        Object.keys(record).sort().join(',') !==
          'executionId,exitCode,finishedAt,language,projectRoot,schemaVersion,startedAt,text' ||
        record.schemaVersion !== 1 ||
        record.executionId !== executionId ||
        record.projectRoot !== workspace.root ||
        record.language !== 'python' ||
        record.exitCode !== 0 ||
        !sourceText(record.text) ||
        !timestamp(record.startedAt) ||
        !timestamp(record.finishedAt) ||
        record.finishedAt < record.startedAt
      )
        invalid()
      signal?.throwIfAborted()
      return {
        language: 'python',
        text: record.text,
        provenance: 'execution',
        executionId,
        sha256: expectedDigest,
      }
    } finally {
      await file.close()
    }
  } catch {
    signal?.throwIfAborted()
    invalid()
  }
}
