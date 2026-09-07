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
import { registerMarivoPythonTool } from '../../src/datasource/python.ts'
import {
  type PythonCodeRef,
  readPythonExecution,
  savePythonExecution,
} from '../../src/python-execution.ts'
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
  const hooks = { run: async () => {} }
  let launches = 0
  const services = {
    shell: {
      resolve(request: ShellExecRequest): ShellExecSpec {
        requests.push(request)
        return {
          ...request,
          workdir: request.workdir!,
          timeoutMs: request.timeoutMs!,
          stdoutMaxBytes: 65536,
          sandboxPolicy: request.sandboxPolicy,
        }
      },
      async run() {
        launches++
        await hooks.run()
        return outcome
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
    assert.doesNotMatch(JSON.stringify(result), /canary-private-4826/)
    assert.equal(p.launches, 1)
  }
})
