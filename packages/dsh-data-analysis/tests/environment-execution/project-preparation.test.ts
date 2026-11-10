import assert from 'node:assert/strict'
import {
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
import test, { type TestContext } from 'node:test'
import { bindMarivoEnvironment } from '../../src/environment/binding.ts'
import { ensureMarivoProject } from '../../src/environment/project-preparation.ts'
import type { MarivoCheckedRunner, SubprocessResult } from '../../src/environment/types.ts'

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'project-preparation-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  let initializes = 0
  let manifestStatus = 'ok'
  const requests: Parameters<MarivoCheckedRunner['runChecked']>[0][] = []
  const runner: MarivoCheckedRunner = {
    binding: {
      projectRoot: root,
      pythonExecutable: '/runtime/python',
      marivoVersion: 'test',
      packagePath: '/runtime/marivo/__init__.py',
      subprocessPolicyId: 'fixed',
      fingerprint: 'identity',
    },
    status: 'ready',
    async runChecked(request) {
      requests.push(request)
      request.signal?.throwIfAborted()
      if (request.args?.[0] === 'init') {
        initializes++
        await writeFile(path.join(root, 'marivo.toml'), '[project]\nname = "prepared"\n', {
          flag: 'wx',
        })
      }
      return {
        exitCode: 0,
        signal: null,
        durationMs: 0,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(
          JSON.stringify({
            status: 'ok',
            project_root: runner.binding.projectRoot,
            python_executable: runner.binding.pythonExecutable,
            marivo: { version: 'test', package_path: runner.binding.packagePath },
            sections: [
              {
                id: 'project',
                status: 'ok',
                checks: [
                  { id: 'installation.python', status: 'ok', summary: 'Python' },
                  { id: 'installation.marivo', status: 'ok', summary: 'Marivo' },
                  { id: 'project.marivo_toml', status: manifestStatus, summary: 'Manifest' },
                ],
              },
            ],
          }),
        ),
      } satisfies SubprocessResult
    },
  }
  return {
    root,
    runner,
    requests,
    get initializes() {
      return initializes
    },
    setManifestStatus: (value: string) => {
      manifestStatus = value
    },
  }
}

test('project preparation uses the exact root and coordinates concurrent first initialization', async (t) => {
  const f = await fixture(t)
  const results = await Promise.all(Array.from({ length: 5 }, () => ensureMarivoProject(f.runner)))
  assert.equal(f.initializes, 1)
  assert.equal(results.filter((value) => value.status === 'created').length, 1)
  assert.equal(results.filter((value) => value.status === 'already-ready').length, 4)
  assert.deepEqual(f.requests[0]!.args, ['init', '--project-root', f.root])
  assert(f.requests.every((request) => request.args?.includes(f.root)))
  assert(f.requests.every((request) => !request.args?.includes('--force')))
})

test('project preparation does not inherit a parent manifest', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'marivo.toml'), 'parent project')
  const child = path.join(f.root, 'child')
  await mkdir(child)
  const runner = f.runner
  Object.assign(runner.binding, { projectRoot: child })
  let initialized = false
  const result = await ensureMarivoProject(runner, {
    initialize: async () => {
      initialized = true
      await writeFile(path.join(child, 'marivo.toml'), 'child project')
    },
  })
  assert.equal(result.projectRoot, child)
  assert(initialized)
  assert.equal(await readFile(path.join(f.root, 'marivo.toml'), 'utf8'), 'parent project')
})

test('project preparation rejects symlinks and nonregular manifests before initialization', async (t) => {
  for (const kind of ['symlink', 'directory']) {
    const f = await fixture(t)
    const manifest = path.join(f.root, 'marivo.toml')
    if (kind === 'directory') await mkdir(manifest)
    else {
      await writeFile(path.join(f.root, 'outside.toml'), 'project')
      await symlink(path.join(f.root, 'outside.toml'), manifest)
    }
    await assert.rejects(ensureMarivoProject(f.runner), /regular file/)
    assert.equal(f.requests.length, 0)
  }
})

test('existing invalid manifests fail public validation and are never overwritten', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'marivo.toml'), 'invalid')
  f.setManifestStatus('fail')
  await assert.rejects(ensureMarivoProject(f.runner), /project.marivo_toml/)
  assert.equal(f.initializes, 0)
  assert.equal(await readFile(path.join(f.root, 'marivo.toml'), 'utf8'), 'invalid')
})

test('cancelled initialization inspects effects without deleting or repeating init', async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  let starts = 0
  await assert.rejects(
    ensureMarivoProject(f.runner, {
      signal: controller.signal,
      initialize: async (signal) => {
        starts++
        assert.equal(signal, controller.signal)
        await writeFile(path.join(f.root, 'partial'), 'keep')
        controller.abort(new Error('cancelled'))
        throw new Error('cancelled')
      },
    }),
    (error: unknown) => {
      assert(error instanceof Error && 'code' in error && 'details' in error)
      assert.equal(error.code, 'project-preparation-uncertain')
      assert.deepEqual(error.details, { projectRoot: f.root, manifest: 'missing' })
      return true
    },
  )
  assert.equal(starts, 1)
  assert.deepEqual(await readdir(f.root), ['partial'])
})

test('a queued request rechecks Host context before invoking init', async (t) => {
  const f = await fixture(t)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const first = ensureMarivoProject(f.runner, {
    initialize: async () => {
      entered()
      await gate
      await writeFile(path.join(f.root, 'marivo.toml'), 'project')
    },
  })
  await started
  const second = ensureMarivoProject(f.runner, {
    assertCurrent: async () => {
      throw new Error('context-changed')
    },
  })
  release()
  await first
  await assert.rejects(second, /context-changed/)
  assert.equal(f.initializes, 0)
})

test('a cancelled queued preparation releases no lock ahead of the active initializer', {
  timeout: 3000,
}, async (t) => {
  const f = await fixture(t)
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const first = ensureMarivoProject(f.runner, {
    initialize: async () => {
      entered()
      await gate
      await writeFile(path.join(f.root, 'marivo.toml'), 'project')
    },
  })
  await started
  const controller = new AbortController()
  const second = ensureMarivoProject(f.runner, { signal: controller.signal })
  controller.abort(new Error('queued-cancel'))
  await assert.rejects(second, /queued-cancel/)
  const third = ensureMarivoProject(f.runner)
  release()
  assert.equal((await first).status, 'created')
  assert.equal((await third).status, 'already-ready')
  assert.equal(f.initializes, 0)
})

const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
test('real bound Runtime prepares an empty Workspace using its public init and doctor', {
  skip: !pythonExecutable,
}, async (t) => {
  const f = await fixture(t)
  const environment = await bindMarivoEnvironment({ projectRoot: f.root, pythonExecutable })
  assert.deepEqual(await readdir(f.root), [])
  const results = await Promise.all(
    Array.from({ length: 3 }, () => ensureMarivoProject(environment)),
  )
  assert.equal(results.filter((result) => result.status === 'created').length, 1)
  assert.equal(results.filter((result) => result.status === 'already-ready').length, 2)
  assert.equal((await ensureMarivoProject(environment)).status, 'already-ready')
  assert((await readFile(path.join(f.root, 'marivo.toml'), 'utf8')).includes('[project]'))
})

test('real project preparation creates a child Workspace project without inheriting its parent', {
  skip: !pythonExecutable,
}, async (t) => {
  const f = await fixture(t)
  const parent = '[project]\nname = "parent-project"\n'
  await writeFile(path.join(f.root, 'marivo.toml'), parent)
  const child = path.join(f.root, 'child')
  await mkdir(child)
  const environment = await bindMarivoEnvironment({ projectRoot: child, pythonExecutable })
  assert.equal(environment.binding.projectRoot, child)
  assert.equal((await ensureMarivoProject(environment)).status, 'created')
  assert.equal(await readFile(path.join(f.root, 'marivo.toml'), 'utf8'), parent)
  assert((await readFile(path.join(child, 'marivo.toml'), 'utf8')).includes('[project]'))
})
