import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
} from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    workspaceRoot,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )

const validationRoot = await mkdtemp(path.join(tmpdir(), 'dsh-runtime-workspace-'))
try {
  const runtimeRoot = path.join(validationRoot, 'runtime')
  const firstWorkspace = path.join(validationRoot, 'workspace-a')
  const secondWorkspace = path.join(validationRoot, 'workspace-b')
  await mkdir(firstWorkspace)
  await mkdir(secondWorkspace)

  const runtime = await ensureSharedMarivoRuntime({ runtimeRoot, pythonExecutable })
  const reused = await ensureSharedMarivoRuntime({ runtimeRoot, pythonExecutable })
  assert.deepEqual(reused, runtime)
  assert.equal(
    JSON.parse(await readFile(runtime.installationPath, 'utf8')).marivoVersion,
    runtime.marivoVersion,
  )
  for (const skill of ['marivo-analysis', 'marivo-semantic']) {
    assert.ok((await stat(path.join(runtime.skillsRoot, skill, 'SKILL.md'))).isFile())
  }

  const manager = new MarivoWorkspaceEnvironmentManager(runtime)
  const firstPromise = manager.resolve(firstWorkspace)
  const repeatedPromise = manager.resolve(firstWorkspace)
  const [first, repeated, second] = await Promise.all([
    firstPromise,
    repeatedPromise,
    manager.resolve(secondWorkspace),
  ])
  assert.equal(first, repeated)
  assert.notEqual(first, second)
  assert.equal(first.binding.pythonExecutable, second.binding.pythonExecutable)
  assert.equal(first.binding.packagePath, second.binding.packagePath)
  assert.notEqual(first.binding.projectRoot, second.binding.projectRoot)
  assert.notEqual(first.binding.fingerprint, second.binding.fingerprint)
  for (const workspace of [firstWorkspace, secondWorkspace]) {
    assert.ok((await stat(path.join(workspace, 'marivo.toml'))).isFile())
    assert.ok((await stat(path.join(workspace, 'models'))).isDirectory())
    assert.ok((await stat(path.join(workspace, '.marivo'))).isDirectory())
  }
  manager.dispose()

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'ok',
        runtime,
        workspaces: [first.binding, second.binding],
        runtimeReused: true,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await rm(validationRoot, { recursive: true, force: true })
}
