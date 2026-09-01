import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  initializeMarivoWorkspace,
  MarivoEnvironmentError,
  MarivoWorkspaceEnvironmentManager,
  type SharedMarivoRuntime,
} from '../../src/environment/index.ts'

function doctorPython(packagePath: string): string {
  return `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
if (args[0] !== '-m' || args[1] !== 'marivo' || args[2] !== 'doctor') process.exit(2)
const projectRoot = path.resolve(args[args.indexOf('--project-root') + 1])
const manifest = readFileSync(path.join(projectRoot, 'marivo.toml'), 'utf8')
const manifestStatus = manifest.includes('[project]') ? 'ok' : 'fail'
process.stdout.write(JSON.stringify({
  status: manifestStatus,
  project_root: projectRoot,
  python_executable: path.resolve(process.argv[1]),
  marivo: { version: '9.8.7', package_path: ${JSON.stringify(packagePath)} },
  sections: [
    { id: 'installation', status: 'ok', checks: [
      { id: 'installation.python', status: 'ok', summary: 'shared Python' },
      { id: 'installation.marivo', status: 'ok', summary: 'shared Marivo' },
    ] },
    { id: 'project', status: manifestStatus, checks: [
      { id: 'project.marivo_toml', status: manifestStatus, summary: 'manifest' },
    ] },
  ],
}))
`
}

async function absent(target: string): Promise<void> {
  await assert.rejects(() => stat(target), { code: 'ENOENT' })
}

test('Workspace initialization is minimal, atomic, and idempotent', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-init-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await initializeMarivoWorkspace(root)
  const second = await initializeMarivoWorkspace(root)

  assert.deepEqual(new Set(first.created), new Set(['models', '.marivo', 'marivo.toml']))
  assert.deepEqual(second.created, [])
  assert.equal(
    await readFile(path.join(root, 'marivo.toml'), 'utf8'),
    `[project]\nname = ${JSON.stringify(path.basename(root))}\n`,
  )
  await absent(path.join(root, '.venv'))
  await absent(path.join(root, '.agents'))
  await absent(path.join(root, '.claude'))
  await absent(path.join(root, '.codex'))
})

test('Workspace bindings share Python and package identity but retain project state and Promise identity', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-bindings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const firstRoot = path.join(root, 'alpha')
  const secondRoot = path.join(root, 'beta')
  await mkdir(firstRoot)
  await mkdir(secondRoot)
  const packagePath = path.join(root, 'site-packages', 'marivo', '__init__.py')
  const python = path.join(root, 'shared-python')
  await mkdir(path.dirname(packagePath), { recursive: true })
  await writeFile(packagePath, '__version__ = "9.8.7"\n')
  await writeFile(python, doctorPython(packagePath))
  await chmod(python, 0o755)
  const runtime: SharedMarivoRuntime = {
    runtimeRoot: path.join(root, 'runtime'),
    pythonExecutable: python,
    marivoVersion: '9.8.7',
    packagePath,
    reportKitVersion: '2.0.0',
    reportKitPackagePath: path.join(
      root,
      'site-packages',
      'dsh_data_analysis_report',
      '__init__.py',
    ),
    skillsRoot: path.join(root, 'runtime', 'skills'),
    installationPath: path.join(root, 'runtime', 'installation.json'),
  }
  const manager = new MarivoWorkspaceEnvironmentManager(runtime)
  const sameA = manager.resolve(firstRoot)
  const sameB = manager.resolve(firstRoot)
  const [first, duplicate, second] = await Promise.all([sameA, sameB, manager.resolve(secondRoot)])

  assert.equal(first, duplicate)
  assert.equal(first.binding.pythonExecutable, second.binding.pythonExecutable)
  assert.equal(first.binding.packagePath, second.binding.packagePath)
  assert.notEqual(first.binding.projectRoot, second.binding.projectRoot)
  assert.notEqual(first.binding.fingerprint, second.binding.fingerprint)
  await absent(path.join(firstRoot, '.venv'))
  await absent(path.join(secondRoot, '.venv'))
})

test('one invalid Workspace fails closed without poisoning another Workspace', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const broken = path.join(root, 'broken')
  const healthy = path.join(root, 'healthy')
  await mkdir(broken)
  await mkdir(healthy)
  await writeFile(path.join(broken, 'models'), 'conflict')

  await assert.rejects(
    initializeMarivoWorkspace(broken),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'workspace-initialization-failed',
  )
  const layout = await initializeMarivoWorkspace(healthy)
  assert.equal(layout.projectRoot, await realpath(healthy))
})
