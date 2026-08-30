import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { bindMarivoEnvironment, MarivoEnvironmentError } from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    resolveDshHome(),
    'dsh-data-analysis',
    'runtimes',
    'marivo',
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )

const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
const identity = await environment.assertImportIdentity()
assert.deepEqual(identity, {
  pythonExecutable: environment.binding.pythonExecutable,
  marivoVersion: environment.binding.marivoVersion,
  packagePath: environment.binding.packagePath,
})
assert.equal(environment.status, 'ready')

const shadowRoot = await mkdtemp(path.join(tmpdir(), 'dsh-environment-shadow-'))
let shadowStatus: string
try {
  await writeFile(path.join(shadowRoot, 'marivo.toml'), '[project]\nname = "shadow-test"\n', 'utf8')
  const shadowEnvironment = await bindMarivoEnvironment({
    projectRoot: shadowRoot,
    pythonExecutable: environment.binding.pythonExecutable,
  })
  await mkdir(path.join(shadowRoot, 'marivo'))
  await writeFile(
    path.join(shadowRoot, 'marivo', '__init__.py'),
    '__version__ = "9.9.shadow"\n',
    'utf8',
  )
  await assert.rejects(
    () => shadowEnvironment.assertImportIdentity(),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'binding-identity-mismatch',
  )
  await assert.rejects(
    () => shadowEnvironment.assertImportIdentity(),
    (error: unknown) => error instanceof MarivoEnvironmentError && error.code === 'binding-failed',
  )
  shadowStatus = shadowEnvironment.status
} finally {
  await rm(shadowRoot, { recursive: true, force: true })
}
assert.equal(shadowStatus!, 'failed')

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ok',
      binding: environment.binding,
      identity,
      failClosedShadowBinding: shadowStatus!,
    },
    null,
    2,
  )}\n`,
)
