import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  PythonCaptureRecord,
  PythonCodeRef,
  PythonCodeSnippet,
  PythonExecutionDatasource,
} from './python-execution-contracts.ts'

export type {
  PythonCodeRef,
  PythonCodeSnippet,
  PythonExecutionDatasource,
} from './python-execution-contracts.ts'

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

function validCapture(value: PythonCaptureRecord): boolean {
  return (
    !!value &&
    Object.keys(value).sort().join(',') === 'callId,entries,rootCallId,sessionId,workspaceId' &&
    [value.workspaceId, value.sessionId, value.callId, value.rootCallId].every(
      (s) => typeof s === 'string' && s.length > 0 && s.length <= 512,
    ) &&
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.length <= 16 &&
    new Set(value.entries.map((e) => e.captureId)).size === value.entries.length &&
    value.entries.every(
      (e) =>
        Object.keys(e).sort().join(',') === 'captureId,path,sha256' &&
        EXECUTION_ID.test(e.captureId) &&
        DIGEST.test(e.sha256) &&
        /^\.dsh-data-analysis\/captures\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.json$/.test(e.path) &&
        e.path.endsWith(`/${e.captureId}.json`),
    )
  )
}

function validDatasources(value: PythonExecutionDatasource[]): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 16 &&
    new Set(value.map((item) => item.name)).size === value.length &&
    value.every(
      (item) =>
        !!item &&
        Object.keys(item).sort().join(',') === 'backend,name' &&
        typeof item.name === 'string' &&
        item.name.length > 0 &&
        item.name.length <= 256 &&
        (item.backend === null ||
          (typeof item.backend === 'string' &&
            item.backend.length > 0 &&
            item.backend.length <= 256)),
    )
  )
}

/** Publish a complete record once. Its final name never exposes a partial write or overwrites. */
export async function savePythonExecution(
  workspaceRoot: string,
  input: {
    text: string
    startedAt: string
    finishedAt: string
    captures?: PythonCaptureRecord
    datasources?: PythonExecutionDatasource[]
  },
  signal?: AbortSignal,
): Promise<PythonCodeRef> {
  try {
    signal?.throwIfAborted()
    const { text, startedAt, finishedAt } = input
    const captures = input.captures === undefined ? undefined : structuredClone(input.captures)
    const datasources =
      input.datasources === undefined ? undefined : structuredClone(input.datasources)
    if (
      !sourceText(text) ||
      !timestamp(startedAt) ||
      !timestamp(finishedAt) ||
      finishedAt < startedAt ||
      (captures !== undefined && !validCapture(captures)) ||
      (datasources !== undefined && !validDatasources(datasources))
    )
      invalid()
    const workspace = await directories(workspaceRoot, true, signal)
    const executionId = randomUUID()
    const schemaVersion = datasources === undefined ? (captures === undefined ? 1 : 2) : 3
    const bytes = Buffer.from(
      JSON.stringify({
        schemaVersion,
        executionId,
        projectRoot: workspace.root,
        language: 'python',
        text,
        startedAt,
        finishedAt,
        exitCode: 0,
        ...(captures ? { captures } : {}),
        ...(datasources ? { datasources } : {}),
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
async function readExecutionRecord(
  workspaceRoot: string,
  ref: PythonCodeRef,
  signal?: AbortSignal,
): Promise<PythonCodeSnippet & { captures?: PythonCaptureRecord }> {
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
      if (!record || typeof record !== 'object' || Array.isArray(record)) invalid()
      const version = record.schemaVersion
      if (version !== 1 && version !== 2 && version !== 3) invalid()
      const baseKeys = [
        'executionId',
        'exitCode',
        'finishedAt',
        'language',
        'projectRoot',
        'schemaVersion',
        'startedAt',
        'text',
      ]
      const allowed = new Set([
        ...baseKeys,
        ...(version >= 2 ? ['captures'] : []),
        ...(version >= 3 ? ['datasources'] : []),
      ])
      const keys = Object.keys(record)
      if (
        keys.some((key) => !allowed.has(key)) ||
        baseKeys.some((key) => !keys.includes(key)) ||
        (version === 2 && !('captures' in record)) ||
        (version === 3 && !('captures' in record) && !('datasources' in record)) ||
        ('captures' in record && !validCapture(record.captures)) ||
        ('datasources' in record && !validDatasources(record.datasources)) ||
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
        ...(record.captures ? { captures: record.captures } : {}),
        ...(record.datasources ? { datasources: record.datasources } : {}),
      }
    } finally {
      await file.close()
    }
  } catch {
    signal?.throwIfAborted()
    invalid()
  }
}

export async function readPythonExecution(
  workspaceRoot: string,
  ref: PythonCodeRef,
  signal?: AbortSignal,
): Promise<PythonCodeSnippet> {
  const { captures: _captures, ...snippet } = await readExecutionRecord(workspaceRoot, ref, signal)
  return snippet
}

export async function readPythonCaptures(
  workspaceRoot: string,
  ref: PythonCodeRef,
  signal?: AbortSignal,
): Promise<PythonCaptureRecord> {
  const record = await readExecutionRecord(workspaceRoot, ref, signal)
  if (!record.captures) invalid()
  return record.captures
}
