import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import {
  ensureSharedMarivoRuntime,
  MarivoEnvironmentError,
  SHARED_MARIVO_PACKAGE_SPEC,
} from '../../src/environment/index.ts'

const FIXTURE_MARIVO_VERSION = '9.8.7'

const FAKE_UV = String.raw`#!/usr/bin/env node
import { appendFileSync, chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
appendFileSync(process.env.UV_RECORD, JSON.stringify(args) + '\n')
if (args[0] === 'python' && args[1] === 'install') process.exit(0)
if (args[0] === 'python' && args[1] === 'find') {
  process.stdout.write(process.env.MANAGED_PYTHON + '\n')
  process.exit(0)
}
if (args[0] === 'venv') {
  const target = path.resolve(args.at(-1))
  const executable = path.join(target, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  mkdirSync(path.dirname(executable), { recursive: true })
  copyFileSync(process.env.FAKE_PYTHON_SOURCE, executable)
  chmodSync(executable, 0o755)
  process.exit(0)
}
if (args[0] === 'pip' && args[1] === 'install') {
  if (process.env.FAIL_PIP === '1') process.exit(17)
  process.exit(0)
}
process.stderr.write('unsupported uv invocation: ' + JSON.stringify(args))
process.exit(2)
`

function fakePython(packagePath: string): string {
  return `#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const script = args[1] ?? ''
if (args[0] !== '-c') process.exit(2)
if (script.includes('sys.version_info')) {
  process.stdout.write(JSON.stringify({
    python_executable: path.resolve(process.argv[1]),
    version: [3, 10, 14],
    prefix: path.dirname(path.resolve(process.argv[1])),
  }))
} else if (script.includes('from marivo.analysis import Finding')) {
  process.stdout.write(JSON.stringify({
    python_executable: path.resolve(process.argv[1]),
    marivo_version: process.env.MARIVO_VERSION ?? ${JSON.stringify(FIXTURE_MARIVO_VERSION)},
    package_path: ${JSON.stringify(packagePath)},
    capabilities: process.env.MARIVO_CAPABILITIES === 'missing' ? [] : ['finding-render-v1'],
  }))
} else {
  process.stderr.write('runtime probe must import Finding from the public marivo.analysis API')
  process.exit(19)
}
`
}

interface RuntimeFixture {
  root: string
  runtimeRoot: string
  failedRuntimeRoot: string
  uv: string
  environment: NodeJS.ProcessEnv
  recordPath: string
  cleanup(): Promise<void>
}

async function fixture(): Promise<RuntimeFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-shared-runtime-'))
  const runtimeRoot = path.join(root, 'runtime')
  const failedRuntimeRoot = path.join(root, 'failed-runtime')
  const uv = path.join(root, 'uv')
  const managedPython = path.join(root, 'managed-python')
  const fakePythonSource = path.join(root, 'fake-python')
  const recordPath = path.join(root, 'uv.jsonl')
  const packagePath = path.join(root, 'site-packages', 'marivo', '__init__.py')
  await mkdir(path.dirname(packagePath), { recursive: true })
  await writeFile(packagePath, `__version__ = "${FIXTURE_MARIVO_VERSION}"\n`)
  for (const skill of ['marivo-analysis', 'marivo-semantic']) {
    const directory = path.join(path.dirname(packagePath), 'skills', skill)
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: fixture\n---\n`,
    )
  }
  await writeFile(uv, FAKE_UV)
  await writeFile(managedPython, fakePython(packagePath))
  await writeFile(fakePythonSource, fakePython(packagePath))
  await chmod(uv, 0o755)
  await chmod(managedPython, 0o755)
  await chmod(fakePythonSource, 0o755)
  return {
    root,
    runtimeRoot,
    failedRuntimeRoot,
    uv,
    recordPath,
    environment: {
      PATH: process.env.PATH,
      UV_RECORD: recordPath,
      MANAGED_PYTHON: managedPython,
      FAKE_PYTHON_SOURCE: fakePythonSource,
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('concurrent first starts install one latest-resolved shared Runtime and later reuse its marker', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 }
  const [first, second] = await Promise.all([
    ensureSharedMarivoRuntime(config, { environment: item.environment, waitIntervalMs: 5 }),
    ensureSharedMarivoRuntime(config, { environment: item.environment, waitIntervalMs: 5 }),
  ])
  const third = await ensureSharedMarivoRuntime(config, { environment: item.environment })

  assert.equal(first.pythonExecutable, second.pythonExecutable)
  assert.equal(second.packagePath, third.packagePath)
  assert.equal(first.marivoVersion, FIXTURE_MARIVO_VERSION)
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 1)
  assert.equal(SHARED_MARIVO_PACKAGE_SPEC, 'marivo[duckdb,trino,clickhouse]')
  assert.ok(calls.some((args) => args.at(-1) === SHARED_MARIVO_PACKAGE_SPEC))
  const marker = JSON.parse(
    await readFile(path.join(item.runtimeRoot, 'installation.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.equal(marker.marivoVersion, FIXTURE_MARIVO_VERSION)
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v3')
  assert.deepEqual(marker.capabilities, ['finding-render-v1'])
  await stat(path.join(first.skillsRoot, 'marivo-analysis', 'SKILL.md'))
  await stat(path.join(first.skillsRoot, 'marivo-semantic', 'SKILL.md'))
})

test('a managed v2 marker is rebuilt once to publish the required capability marker', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 }
  const first = await ensureSharedMarivoRuntime(config, { environment: item.environment })
  const marker = JSON.parse(await readFile(first.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  marker.schema = 'dsh-data-analysis-runtime/v2'
  delete marker.capabilities
  await writeFile(first.installationPath, `${JSON.stringify(marker)}\n`)

  const rebuilt = await ensureSharedMarivoRuntime(config, { environment: item.environment })
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 2)
  const rebuiltMarker = JSON.parse(await readFile(rebuilt.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(rebuiltMarker.schema, 'dsh-data-analysis-runtime/v3')
  assert.deepEqual(rebuiltMarker.capabilities, ['finding-render-v1'])
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('runtime.invalid-')))
})

test('failed installation never publishes installation.json', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: item.failedRuntimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 },
      { environment: { ...item.environment, FAIL_PIP: '1' } },
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'shared-runtime-install-failed',
  )
  await assert.rejects(() => stat(path.join(item.failedRuntimeRoot, 'installation.json')), {
    code: 'ENOENT',
  })
  const recovered = await ensureSharedMarivoRuntime(
    { runtimeRoot: item.failedRuntimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 },
    { environment: item.environment },
  )
  await stat(recovered.installationPath)
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('failed-runtime.invalid-')))
})

test('administrator Python accepts its installed Marivo version and records that identity', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const python = item.environment.MANAGED_PYTHON as string
  const runtime = await ensureSharedMarivoRuntime(
    { runtimeRoot: path.join(item.root, 'admin-runtime'), pythonExecutable: python },
    { environment: { ...item.environment, MARIVO_VERSION: '3.2.1' } },
  )
  assert.equal(runtime.marivoVersion, '3.2.1')
  const marker = JSON.parse(await readFile(runtime.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(marker.marivoVersion, '3.2.1')
})

test('administrator Python without Finding.render fails with an actionable capability error', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      {
        runtimeRoot: path.join(item.root, 'missing-capability-runtime'),
        pythonExecutable: item.environment.MANAGED_PYTHON as string,
      },
      { environment: { ...item.environment, MARIVO_CAPABILITIES: 'missing' } },
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-capability-missing' &&
      /finding-render-v1/.test(error.message),
  )
})
