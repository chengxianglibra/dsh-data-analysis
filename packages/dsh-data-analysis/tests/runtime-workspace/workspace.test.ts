import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MarivoEnvironmentError,
  MarivoWorkspaceEnvironmentManager,
  type SharedMarivoRuntime,
} from '../../src/environment/index.ts'

function doctorPython(packagePath: string): string {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
if (args[0] !== '-m' || args[1] !== 'marivo' || args[2] !== 'doctor') process.exit(2)
const projectRoot = path.resolve(args[args.indexOf('--project-root') + 1])
const manifestPath = path.join(projectRoot, 'marivo.toml')
const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined
const manifestStatus = manifest === undefined ? 'info' : manifest.includes('[project]') ? 'ok' : 'fail'
process.stdout.write(JSON.stringify({
  status: manifestStatus === 'fail' ? 'fail' : 'ok',
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

test('zero-init Workspace bindings share Runtime identity without creating files', async (t) => {
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
    reportKitVersion: '3.0.0',
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
  assert.deepEqual(await readdir(firstRoot), [])
  assert.deepEqual(await readdir(secondRoot), [])
})

test('one invalid Workspace fails closed without poisoning another Workspace', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-workspace-isolation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const broken = path.join(root, 'broken')
  const healthy = path.join(root, 'healthy')
  await mkdir(broken)
  await mkdir(healthy)
  await writeFile(path.join(broken, 'marivo.toml'), 'invalid [[ toml')
  const packagePath = path.join(root, 'site-packages', 'marivo', '__init__.py')
  const python = path.join(root, 'shared-python')
  await mkdir(path.dirname(packagePath), { recursive: true })
  await writeFile(packagePath, '__version__ = "9.8.7"\n')
  await writeFile(python, doctorPython(packagePath))
  await chmod(python, 0o755)
  const manager = new MarivoWorkspaceEnvironmentManager({
    runtimeRoot: path.join(root, 'runtime'),
    pythonExecutable: python,
    marivoVersion: '9.8.7',
    packagePath,
    reportKitVersion: '3.0.0',
    reportKitPackagePath: path.join(root, 'report-kit.py'),
    skillsRoot: path.join(root, 'runtime', 'skills'),
    installationPath: path.join(root, 'runtime', 'installation.json'),
  })

  await assert.rejects(
    manager.resolve(broken),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'doctor-admission-failed' &&
      error.details.check === 'project.marivo_toml',
  )
  const environment = await manager.resolve(healthy)
  assert.equal(environment.binding.projectRoot, await realpath(healthy))
  assert.deepEqual(await readdir(broken), ['marivo.toml'])
  assert.deepEqual(await readdir(healthy), [])
})
