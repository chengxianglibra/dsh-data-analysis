import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MarivoWorkspaceEnvironmentManager,
  type SharedMarivoRuntime,
} from '../../src/environment/index.ts'

// Emulate the Python subprocess boundary, including its reserved identity and config exits.
function workspacePython(packagePath: string): string {
  return `#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const [mode, , python, version, actualPackage, projectRoot] = process.argv.slice(2)
if (mode !== '-c' || projectRoot !== process.cwd()) process.exit(2)
if (python !== process.argv[1] || version !== '9.8.7' ||
    actualPackage !== ${JSON.stringify(packagePath)}) process.exit(78)
if (existsSync(path.join(projectRoot, 'premature-exit'))) process.exit(0)
const manifestPath = path.join(projectRoot, 'marivo.toml')
const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined
if (manifest !== undefined && !manifest.includes('[project]')) process.exit(79)
process.stdout.write('workspace-config-valid')
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
  await writeFile(python, workspacePython(packagePath))
  await chmod(python, 0o755)
  const runtime: SharedMarivoRuntime = {
    runtimeRoot: path.join(root, 'runtime'),
    pythonExecutable: python,
    marivoVersion: '9.8.7',
    packagePath,
    skillsRoot: path.join(root, 'runtime', 'skills'),
    installationPath: path.join(root, 'runtime', 'installation.json'),
  }
  const initialized: string[] = []
  const manager = new MarivoWorkspaceEnvironmentManager(runtime, async (environment) => {
    initialized.push(environment.binding.projectRoot)
  })
  const sameA = manager.resolve(firstRoot)
  const sameB = manager.resolve(firstRoot)
  const [first, duplicate, second] = await Promise.all([sameA, sameB, manager.resolve(secondRoot)])

  assert.equal(first, duplicate)
  assert.equal(first.binding.pythonExecutable, second.binding.pythonExecutable)
  assert.equal(first.binding.packagePath, second.binding.packagePath)
  assert.notEqual(first.binding.projectRoot, second.binding.projectRoot)
  assert.notEqual(first.binding.fingerprint, second.binding.fingerprint)
  assert.deepEqual(
    initialized.sort(),
    [await realpath(firstRoot), await realpath(secondRoot)].sort(),
  )
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
  await writeFile(python, workspacePython(packagePath))
  await chmod(python, 0o755)
  const runtime: SharedMarivoRuntime = {
    runtimeRoot: path.join(root, 'runtime'),
    pythonExecutable: python,
    marivoVersion: '9.8.7',
    packagePath,
    skillsRoot: path.join(root, 'runtime', 'skills'),
    installationPath: path.join(root, 'runtime', 'installation.json'),
  }
  const manager = new MarivoWorkspaceEnvironmentManager(runtime)

  await assert.rejects(manager.resolve(broken), { code: 'project-manifest-invalid' })
  const environment = await manager.resolve(healthy)
  assert.equal(environment.binding.projectRoot, await realpath(healthy))
  assert.deepEqual(await readdir(broken), ['marivo.toml'])
  assert.deepEqual(await readdir(healthy), [])
  await writeFile(path.join(broken, 'marivo.toml'), '[project]\nname = "fixed"\n')
  assert.equal((await manager.resolve(broken)).binding.projectRoot, await realpath(broken))
  const staleRuntime = new MarivoWorkspaceEnvironmentManager({ ...runtime, marivoVersion: '9.8.6' })
  await assert.rejects(staleRuntime.resolve(healthy), { code: 'binding-identity-mismatch' })
  await writeFile(path.join(healthy, 'premature-exit'), '')
  const fresh = new MarivoWorkspaceEnvironmentManager(runtime)
  await assert.rejects(fresh.resolve(healthy), { code: 'subprocess-failed' })
})
