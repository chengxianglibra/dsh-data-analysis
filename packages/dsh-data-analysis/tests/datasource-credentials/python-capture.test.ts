import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after, type TestContext } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  type MarivoPythonExecutionSummary,
  registerMarivoPythonTool,
} from '../../src/datasource/python.ts'
import { readDatasetSnapshot, readFrameSnapshot } from '../../src/presentation/dataset-snapshot.ts'
import {
  type PythonCodeRef,
  readPythonExecution,
  savePythonExecution,
} from '../../src/python-execution.ts'
import { frameSnapshotV2 } from '../presentation-integration/frame-v2-fixture.ts'
import { legacyFrameSnapshot } from '../unified-analysis-ui/fixtures.ts'
import { fixture } from './fixtures.ts'

const now = '2026-09-07T00:00:00.000Z'
const input = { text: '# 精确原文\r\nprint("<script>&\\n")\n', startedAt: now, finishedAt: now }
const originalHome = process.env.DSH_HOME
const hostRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'python-capture-host-')))
process.env.DSH_HOME = hostRoot
after(async () => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  await rm(hostRoot, { recursive: true, force: true })
})
async function workspace(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'python-capture-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
function recordPath(root: string, ref: PythonCodeRef) {
  return path.join(storageDirectory(root), `${ref.executionId}.json`)
}
function storageDirectory(root: string) {
  return path.join(
    hostRoot,
    'dsh-data-analysis',
    'python-executions',
    createHash('sha256').update(root).digest('hex'),
  )
}

test('execution snapshots preserve exact submitted code and digest complete record bytes', async (t) => {
  const root = await workspace(t)
  const first = await savePythonExecution(root, input)
  const second = await savePythonExecution(root, input)
  assert.notEqual(first.executionId, second.executionId)
  const bytes = await readFile(recordPath(root, first))
  assert.equal(first.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(JSON.parse(bytes.toString()), {
    schemaVersion: 1,
    executionId: first.executionId,
    projectRoot: root,
    language: 'python',
    ...input,
    exitCode: 0,
  })
  assert.deepEqual(await readPythonExecution(root, first), {
    language: 'python',
    text: input.text,
    provenance: 'execution',
    ...first,
  })
  assert.equal((await readdir(path.dirname(recordPath(root, first)))).length, 2)
})

test('snapshot save and read retain call-entry values across asynchronous file operations', async (t) => {
  const root = await workspace(t)
  const mutableInput = { ...input }
  const saving = savePythonExecution(root, mutableInput)
  mutableInput.text = 'changed after call'
  const ref = await saving
  const mutableRef = { ...ref }
  const reading = readPythonExecution(root, mutableRef)
  mutableRef.executionId = 'changed'
  mutableRef.sha256 = '0'.repeat(64)
  assert.deepEqual(await reading, {
    language: 'python',
    text: input.text,
    provenance: 'execution',
    ...ref,
  })
})

test('snapshot readers reject tampering, copied cross-Workspace records and forged paths', async (t) => {
  const root = await workspace(t)
  const other = await workspace(t)
  const ref = await savePythonExecution(root, input)
  await mkdir(path.dirname(recordPath(other, ref)), { recursive: true })
  await copyFile(recordPath(root, ref), recordPath(other, ref))
  await assert.rejects(readPythonExecution(other, ref), /unavailable or invalid/)
  for (const executionId of ['../outside', `${ref.executionId}/x`, ref.executionId.toUpperCase()])
    await assert.rejects(
      readPythonExecution(root, { ...ref, executionId }),
      /unavailable or invalid/,
    )
  await writeFile(
    recordPath(root, ref),
    JSON.stringify({
      ...JSON.parse(await readFile(recordPath(root, ref), 'utf8')),
      text: 'different',
    }),
  )
  await assert.rejects(readPythonExecution(root, ref), /unavailable or invalid/)
})

test('Workspace-authored records cannot claim execution provenance through a self-computed digest', async (t) => {
  const root = await workspace(t)
  const executionId = randomUUID()
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      executionId,
      projectRoot: root,
      language: 'python',
      ...input,
      exitCode: 0,
    }),
  )
  const ref = { executionId, sha256: createHash('sha256').update(bytes).digest('hex') }
  const directory = path.join(root, '.dsh-data-analysis', 'python-executions')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, `${executionId}.json`), bytes)
  await assert.rejects(readPythonExecution(root, ref), /unavailable or invalid/)
})

test('snapshot readers and writers refuse symbolic links and nonregular records', async (t) => {
  const root = await workspace(t)
  const other = await workspace(t)
  const ref = await savePythonExecution(root, input)
  const outside = path.join(other, 'source.json')
  await copyFile(recordPath(root, ref), outside)
  await rm(recordPath(root, ref))
  await symlink(outside, recordPath(root, ref))
  await assert.rejects(readPythonExecution(root, ref), /unavailable or invalid/)
  await rm(recordPath(root, ref))
  await mkdir(recordPath(root, ref))
  await assert.rejects(readPythonExecution(root, ref), /unavailable or invalid/)
  await rm(storageDirectory(root), { recursive: true })
  await symlink(other, storageDirectory(root))
  await assert.rejects(savePythonExecution(root, input), /unavailable or invalid/)
  assert.deepEqual(await readdir(other), ['source.json'])
})

test('source and file byte budgets are enforced before parsing, and cancellation is preserved', async (t) => {
  const root = await workspace(t)
  await assert.rejects(
    savePythonExecution(root, { ...input, text: 'x'.repeat(131073) }),
    /unavailable or invalid/,
  )
  await assert.rejects(
    savePythonExecution(root, { ...input, text: '\n'.repeat(131071) + 'x' }),
    /unavailable or invalid/,
  )
  for (const text of ['print("\0")', '#\uD800'])
    await assert.rejects(savePythonExecution(root, { ...input, text }), /unavailable or invalid/)
  const ref = await savePythonExecution(root, input)
  await writeFile(recordPath(root, ref), Buffer.alloc(262145, 'x'))
  await assert.rejects(readPythonExecution(root, ref), /unavailable or invalid/)
  const signal = AbortSignal.abort(new Error('cancelled'))
  await assert.rejects(readPythonExecution(root, ref, signal), /cancelled/)
  await assert.rejects(savePythonExecution(root, input, signal), /cancelled/)
})

async function tool(t: TestContext) {
  const f = fixture()
  Object.assign(f.bridge.binding, { projectRoot: await workspace(t) })
  t.after(() => f.service.close())
  let definition!: ToolDefinition
  const outcome: ShellRunResult = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 120000,
    stdout: { text: 'complete', truncated: false },
    stderr: { text: '', truncated: false },
  }
  const requests: ShellExecRequest[] = []
  const hooks = { run: async () => {}, captureFailed: false }
  let launches = 0
  const services = {
    shell: {
      resolve(request: ShellExecRequest): ShellExecSpec {
        requests.push(request)
        return {
          ...request,
          workdir: request.workdir!,
          timeoutMs: request.timeoutMs!,
          onExpiry: request.onExpiry ?? 'kill',
          stdoutMaxBytes: 65536,
          sandboxPolicy: request.sandboxPolicy,
        }
      },
      async execute() {
        launches++
        return {
          result: async () => {
            await hooks.run()
            return {
              ...outcome,
              stderr: {
                ...outcome.stderr,
                text:
                  JSON.stringify({ marivoCaptureStatus: 1, failed: hooks.captureFailed }) +
                  '\n' +
                  outcome.stderr.text,
              },
            }
          },
        }
      },
    },
    shellEnv: { collect: () => ({}) },
  }
  registerMarivoPythonTool(
    {
      tools: {
        register(value: ToolDefinition) {
          definition = value
          return () => {}
        },
      },
      get: (name: keyof typeof services) => services[name],
    } as unknown as Context,
    f.bridge,
    f.service,
  )
  return {
    f,
    outcome,
    requests,
    hooks,
    get definition() {
      return definition
    },
    get launches() {
      return launches
    },
    call: async (code = input.text, datasources: string[] = []) =>
      (await definition.execute(
        { code, datasources },
        { ...f.exec, deferContext: () => {}, concludeTurn: () => {} },
      )) as {
        exitCode: number
        timedOut: boolean
        aborted: boolean
        stdout: string
        codeRef?: PythonCodeRef
        codeCaptureError?: string
        snapshotCaptureError?: string
        snapshots?: { kind: 'dataset' | 'frame'; captureId: string; snapshotRef: string }[]
        execution: MarivoPythonExecutionSummary
      },
  }
}

test('registered Python tool captures original code only after one successful execution', async (t) => {
  const p = await tool(t)
  p.f.store.put('DB_PASSWORD')
  const result = await p.call(input.text, ['warehouse'])
  assert.equal(p.launches, 1)
  assert.equal(result.exitCode, 0)
  assert.equal(result.codeCaptureError, undefined)
  assert(result.codeRef)
  assert.equal(
    (await readPythonExecution(p.f.bridge.binding.projectRoot, result.codeRef)).text,
    input.text,
  )
  const record = await readFile(recordPath(p.f.bridge.binding.projectRoot, result.codeRef), 'utf8')
  assert.doesNotMatch(record, /canary-private-4826|PYTHON_WORKER|grants|DB_PASSWORD/)
  assert.equal(JSON.parse(p.requests[0]!.stdin!).code, input.text)
})

async function captured(
  p: Awaited<ReturnType<typeof tool>>,
  failed = false,
  kinds: ('dataset' | 'frame' | 'frame-v1')[] = ['dataset', 'dataset'],
) {
  Reflect.set(p.f.exec.agent!.session.header, 'workspaceId', 'workspace')
  const files: string[] = []
  p.hooks.run = async () => {
    const directory = JSON.parse(p.requests[0]!.stdin!).captureDirectory as string
    await mkdir(path.join(p.f.bridge.binding.projectRoot, directory), { recursive: true })
    const entries = []
    for (const kind of kinds) {
      const captureId = randomUUID()
      const relative = `${directory}/${captureId}.json`
      const data = {
        schemaVersion: 1,
        columns: [{ id: 'x', label: 'x', type: 'int64', nullable: true }],
        rows: [['9007199254740993']],
        rowCount: 2,
        limit: 1,
        truncated: true,
      }
      const bytes = Buffer.from(
        JSON.stringify(
          kind === 'frame'
            ? frameSnapshotV2()
            : kind === 'frame-v1'
              ? legacyFrameSnapshot()
              : {
                  schemaVersion: 1,
                  kind: 'dataset',
                  fetchedAt: now,
                  data,
                  coverage: {
                    start: 0,
                    totalRows: 2,
                    capturedRows: 1,
                    complete: false,
                    columns: ['x'],
                    business: 'unknown',
                  },
                  source: { kind: 'dataframe', details: 'not-captured' },
                },
        ),
      )
      const filename = path.join(p.f.bridge.binding.projectRoot, relative)
      files.push(filename)
      await writeFile(filename, bytes)
      entries.push({
        captureId,
        path: relative,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
    await writeFile(
      path.join(p.f.bridge.binding.projectRoot, directory, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, failed, entries }),
    )
  }
  return files
}

test('same-call captures bind exact Workspace, code and call without replay, then reject tampering', async (t) => {
  const p = await tool(t)
  const files = await captured(p)
  const result = await p.call()
  assert.equal(p.launches, 1)
  assert.equal(result.snapshotCaptureError, undefined)
  assert.equal(result.snapshots?.length, 2)
  assert.equal(result.snapshots![0]!.kind, 'dataset')
  const ref = result.snapshots![0]!.snapshotRef
  const root = p.f.bridge.binding.projectRoot
  const restored = await readDatasetSnapshot(root, 'workspace', ref)
  assert.deepEqual(restored.codeRef, result.codeRef)
  assert.equal(restored.owner.callId, 'call')
  assert.equal(restored.snapshot.coverage.complete, false)
  assert.deepEqual(restored.snapshot.data.rows, [['9007199254740993']])
  await assert.rejects(readDatasetSnapshot(root, 'other-workspace', ref), /workspace/)
  await assert.rejects(readDatasetSnapshot(await workspace(t), 'workspace', ref))
  await assert.rejects(readDatasetSnapshot(root, 'workspace', ref.replace(/.$/, 'z')))
  await writeFile(files[0]!, '{}')
  await assert.rejects(readDatasetSnapshot(root, 'workspace', ref), /digest/)
  assert.equal(p.launches, 1)
})

test('capture_frame v2 snapshots issue kind-prefixed refs that read back only as Frames', async (t) => {
  const p = await tool(t)
  await captured(p, false, ['dataset', 'frame'])
  const result = await p.call()
  assert.equal(result.snapshotCaptureError, undefined)
  assert.deepEqual(
    result.snapshots?.map((s) => s.kind),
    ['dataset', 'frame'],
  )
  const [data, frame] = result.snapshots!
  assert.match(data!.snapshotRef, /^marivo-dataset:/)
  assert.equal(
    frame!.snapshotRef,
    `marivo-frame:${result.codeRef!.executionId}:${result.codeRef!.sha256}:${frame!.captureId}`,
  )
  const root = p.f.bridge.binding.projectRoot
  const restored = await readFrameSnapshot(root, 'workspace', frame!.snapshotRef)
  assert.deepEqual(restored.codeRef, result.codeRef)
  assert.equal(restored.snapshot.schemaVersion, 2)
  assert.equal(restored.snapshot.source.artifactId, null)
  await assert.rejects(
    readDatasetSnapshot(root, 'workspace', frame!.snapshotRef),
    /reference-invalid/,
  )
  await assert.rejects(readFrameSnapshot(root, 'workspace', data!.snapshotRef), /reference-invalid/)
  await assert.rejects(
    readFrameSnapshot(
      root,
      'workspace',
      data!.snapshotRef.replace(/^marivo-dataset/, 'marivo-frame'),
    ),
    /frame-snapshot-kind-mismatch/,
  )
  assert.equal(p.launches, 1)
})

test('legacy v1 Frame captures are rejected without issuing snapshot references', async (t) => {
  const p = await tool(t)
  await captured(p, false, ['frame-v1'])
  const result = await p.call()
  assert.equal(result.snapshots, undefined)
  assert.match(result.snapshotCaptureError!, /No snapshotRef/)
  assert.ok(result.codeRef)
})

test('failed capture and failed executions never issue snapshot references or replay', async (t) => {
  for (const outcome of [{}, { exitCode: 1 }, { timedOut: true }, { aborted: true }]) {
    const p = await tool(t)
    await captured(p, true)
    Object.assign(p.outcome, outcome)
    const result = await p.call()
    assert.equal(result.snapshots, undefined)
    if (!Object.keys(outcome).length) {
      assert.equal(result.execution.reason, 'succeeded')
      assert.match(result.snapshotCaptureError!, /No snapshotRef/)
      assert.ok(result.codeRef)
    }
    assert.equal(p.launches, 1)
  }
})

test('Python tool uses one immutable code string for execution and its later snapshot', async (t) => {
  const p = await tool(t)
  const args = { code: input.text, datasources: [] }
  p.hooks.run = async () => {
    args.code = 'changed while executing'
  }
  const result = (await p.definition.execute(args, {
    ...p.f.exec,
    deferContext: () => {},
    concludeTurn: () => {},
  })) as { codeRef: PythonCodeRef }
  assert.equal(JSON.parse(p.requests[0]!.stdin!).code, input.text)
  assert.equal(
    (await readPythonExecution(p.f.bridge.binding.projectRoot, result.codeRef)).text,
    input.text,
  )
  assert.equal(p.launches, 1)
})

test('nonzero, timeout and aborted Python results never issue code references or replay', async (t) => {
  for (const outcome of [{ exitCode: 1 }, { timedOut: true }, { aborted: true }]) {
    const p = await tool(t)
    Object.assign(p.outcome, outcome)
    const result = await p.call()
    assert.equal(result.codeRef, undefined)
    assert.equal(result.codeCaptureError, undefined)
    assert.equal(result.exitCode, p.outcome.exitCode)
    assert.equal(result.timedOut, p.outcome.timedOut)
    assert.equal(result.aborted, p.outcome.aborted)
    assert.equal(p.launches, 1)
    assert.deepEqual(await readdir(p.f.bridge.binding.projectRoot), [])
  }
})

test('capture failure and post-execution cancellation preserve successful outcome without replay', async (t) => {
  for (const failure of ['storage', 'cancel', 'credential', 'serialized-budget']) {
    const p = await tool(t)
    let code = input.text
    if (failure === 'storage') {
      await mkdir(path.dirname(storageDirectory(p.f.bridge.binding.projectRoot)), {
        recursive: true,
      })
      await writeFile(storageDirectory(p.f.bridge.binding.projectRoot), 'occupied')
    }
    if (failure === 'cancel')
      p.hooks.run = async () => {
        p.f.controller.abort()
      }
    if (failure === 'credential') {
      p.f.store.put('DB_PASSWORD')
      code = 'print("canary-private-4826")'
    }
    if (failure === 'serialized-budget') code = `#${'\n'.repeat(131071)}`
    const result = await p.call(code, failure === 'credential' ? ['warehouse'] : [])
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, 'complete')
    assert.equal(result.codeRef, undefined)
    assert.match(result.codeCaptureError!, /completed successfully.*Do not rerun/)
    assert.equal(result.execution.phase, 'capturing-code')
    assert.equal(result.execution.reason, 'succeeded')
    assert.equal(result.execution.nextAction, result.codeCaptureError)
    assert.doesNotMatch(JSON.stringify(result), /canary-private-4826/)
    assert.equal(p.launches, 1)
  }
})

test('launcher-reported manifest write failure preserves success and codeRef without snapshots', async (t) => {
  const p = await tool(t)
  await captured(p)
  p.hooks.captureFailed = true
  const result = await p.call()
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'complete')
  assert.equal(result.execution.reason, 'succeeded')
  assert.ok(result.codeRef)
  assert.equal(result.snapshots, undefined)
  assert.match(result.snapshotCaptureError!, /No snapshotRef/)
  assert.equal(p.launches, 1)
})
