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

const FIXTURE_MARIVO_VERSION = '0.5.3'

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
} else if (script.includes('import marivo')) {
  if (process.env.PROBE_FAIL === '1') {
    process.stderr.write('fixture import failed')
    process.exit(23)
  }
  process.stdout.write(JSON.stringify({
    python_executable: path.resolve(process.argv[1]),
    marivo_version: process.env.MARIVO_VERSION ?? ${JSON.stringify(FIXTURE_MARIVO_VERSION)},
    package_path: ${JSON.stringify(packagePath)},
    pandas_version: process.env.PANDAS_VERSION ?? '2.3.3',
    pandas_supported: process.env.PANDAS_SUPPORTED !== '0',
    report_kit_version: process.env.REPORT_KIT_VERSION ?? '3.0.0',
    report_kit_package_path: process.env.REPORT_KIT_PACKAGE_PATH,
    report_kit_public_imports: process.env.REPORT_KIT_IMPORTS !== '0',
  }))
} else {
  process.stderr.write('runtime probe must import marivo')
  process.exit(19)
}
`
}

interface RuntimeFixture {
  root: string
  packagePath: string
  runtimeRoot: string
  failedRuntimeRoot: string
  uv: string
  environment: NodeJS.ProcessEnv
  recordPath: string
  wheel: string
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
  const reportKitPackagePath = path.join(
    root,
    'site-packages',
    'dsh_data_analysis_report',
    '__init__.py',
  )
  const wheel = path.join(root, 'dsh_data_analysis_report_kit-3.0.0-py3-none-any.whl')
  await mkdir(path.dirname(packagePath), { recursive: true })
  await mkdir(path.dirname(reportKitPackagePath), { recursive: true })
  await writeFile(packagePath, `__version__ = "${FIXTURE_MARIVO_VERSION}"\n`)
  await writeFile(reportKitPackagePath, '__version__ = "3.0.0"\n')
  await writeFile(wheel, 'fixture wheel')
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
    packagePath,
    runtimeRoot,
    failedRuntimeRoot,
    uv,
    recordPath,
    wheel,
    environment: {
      PATH: process.env.PATH,
      UV_RECORD: recordPath,
      MANAGED_PYTHON: managedPython,
      FAKE_PYTHON_SOURCE: fakePythonSource,
      REPORT_KIT_PACKAGE_PATH: reportKitPackagePath,
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

function runtimeOptions(
  item: RuntimeFixture,
  environment: NodeJS.ProcessEnv = item.environment,
  waitIntervalMs?: number,
) {
  return {
    environment,
    reportKitWheelPath: item.wheel,
    ...(waitIntervalMs === undefined ? {} : { waitIntervalMs }),
  }
}

test('shared Runtime rejects a Marivo Skill whose frontmatter name does not match', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await writeFile(
    path.join(path.dirname(item.packagePath), 'skills', 'marivo-analysis', 'SKILL.md'),
    '---\nname: wrong-skill\ndescription: fixture\n---\n',
  )

  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 },
      runtimeOptions(item),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-skills-invalid' &&
      error.details.skill === 'marivo-analysis',
  )
})

test('concurrent first starts install one pinned shared Runtime and later reuse its marker', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 }
  const [first, second] = await Promise.all([
    ensureSharedMarivoRuntime(config, runtimeOptions(item, item.environment, 5)),
    ensureSharedMarivoRuntime(config, runtimeOptions(item, item.environment, 5)),
  ])
  const third = await ensureSharedMarivoRuntime(config, runtimeOptions(item))

  assert.equal(first.pythonExecutable, second.pythonExecutable)
  assert.equal(second.packagePath, third.packagePath)
  assert.equal(first.marivoVersion, FIXTURE_MARIVO_VERSION)
  assert.equal(first.reportKitVersion, '3.0.0')
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 2)
  assert.equal(SHARED_MARIVO_PACKAGE_SPEC, 'marivo[duckdb,trino,clickhouse]==0.5.3')
  assert.ok(calls.some((args) => args.at(-1) === SHARED_MARIVO_PACKAGE_SPEC))
  assert.ok(
    calls.some(
      (args) => args[0] === 'pip' && args.includes('--no-deps') && args.at(-1) === item.wheel,
    ),
  )
  const marker = JSON.parse(
    await readFile(path.join(item.runtimeRoot, 'installation.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.equal(marker.marivoVersion, FIXTURE_MARIVO_VERSION)
  assert.equal(marker.reportKitVersion, '3.0.0')
  assert.equal(marker.reportKitPackagePath, first.reportKitPackagePath)
  assert.equal(marker.reportAdapterKind, 'dsh-data-analysis-report-transport-adapter')
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v2')
  assert.equal('capabilities' in marker, false)
  await stat(path.join(first.skillsRoot, 'marivo-analysis', 'SKILL.md'))
  await stat(path.join(first.skillsRoot, 'marivo-semantic', 'SKILL.md'))
})

test('a managed Runtime on another Marivo version is rebuilt to the pinned version', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 }
  const initial = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const marker = JSON.parse(await readFile(initial.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  marker.marivoVersion = '0.4.16'
  await writeFile(initial.installationPath, `${JSON.stringify(marker)}\n`)

  const current = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  assert.equal(current.marivoVersion, '0.5.3')
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  const installCalls = calls.filter((args) => args[0] === 'pip' && args[1] === 'install')
  assert.equal(installCalls.length, 4)
  assert.equal(installCalls.filter((args) => args.at(-1) === SHARED_MARIVO_PACKAGE_SPEC).length, 2)
  assert.equal(installCalls.filter((args) => args.at(-1) === item.wheel).length, 2)
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('runtime.invalid-')))
})

test('an unsupported marker is discarded instead of migrated or reused', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 }
  const first = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const marker = JSON.parse(await readFile(first.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  marker.schema = 'dsh-data-analysis-runtime/v1'
  await writeFile(first.installationPath, `${JSON.stringify(marker)}\n`)

  const rebuilt = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 4)
  const rebuiltMarker = JSON.parse(await readFile(rebuilt.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(rebuiltMarker.schema, 'dsh-data-analysis-runtime/v2')
  assert.equal('capabilities' in rebuiltMarker, false)
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('runtime.invalid-')))
})

test('a corrupt v2 marker is rebuilt instead of partially trusted', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 }
  const first = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  await writeFile(first.installationPath, '{not-json\n')

  const rebuilt = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const marker = JSON.parse(await readFile(rebuilt.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v2')
  assert.equal(marker.reportKitVersion, '3.0.0')
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 4)
})

test('failed installation never publishes installation.json', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: item.failedRuntimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 },
      runtimeOptions(item, { ...item.environment, FAIL_PIP: '1' }),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'shared-runtime-install-failed',
  )
  await assert.rejects(() => stat(path.join(item.failedRuntimeRoot, 'installation.json')), {
    code: 'ENOENT',
  })
  const recovered = await ensureSharedMarivoRuntime(
    { runtimeRoot: item.failedRuntimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 },
    runtimeOptions(item),
  )
  await stat(recovered.installationPath)
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('failed-runtime.invalid-')))
})

test('administrator Python must use the exact supported Marivo version', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const python = item.environment.MANAGED_PYTHON as string
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: path.join(item.root, 'admin-runtime'), pythonExecutable: python },
      runtimeOptions(item, { ...item.environment, MARIVO_VERSION: '3.2.1' }),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-version-unsupported' &&
      error.details.supportedMarivoVersion === FIXTURE_MARIVO_VERSION,
  )
})

test('administrator Python must provide the exact report kit and pandas range without mutation', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const python = item.environment.MANAGED_PYTHON as string
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: path.join(item.root, 'admin-report-kit'), pythonExecutable: python },
      runtimeOptions(item, { ...item.environment, REPORT_KIT_VERSION: '1.9.0' }),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-report-kit-unsupported' &&
      error.details.supportedReportKitVersion === '3.0.0',
  )
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: path.join(item.root, 'admin-pandas'), pythonExecutable: python },
      runtimeOptions(item, { ...item.environment, PANDAS_SUPPORTED: '0' }),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-pandas-unsupported' &&
      error.details.supportedPandasRange === '>=2.2.0,<3.0.0',
  )
  await assert.rejects(() => stat(item.recordPath), { code: 'ENOENT' })
})

test('administrator Python missing a package receives the bundled wheel repair without mutation', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const python = item.environment.MANAGED_PYTHON as string
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: path.join(item.root, 'admin-missing'), pythonExecutable: python },
      runtimeOptions(item, { ...item.environment, PROBE_FAIL: '1' }),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-package-unavailable' &&
      error.message.includes(item.wheel) &&
      error.message.includes('--no-deps') &&
      error.message.includes(SHARED_MARIVO_PACKAGE_SPEC) &&
      error.message.includes('pandas>=2.2.0,<3.0.0') &&
      Array.isArray(error.details.repairCommands) &&
      error.details.repairCommands.length === 2,
  )
  await assert.rejects(() => stat(item.recordPath), { code: 'ENOENT' })
})

test('managed Runtime rejects a missing bundled wheel before publishing a marker', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const missing = path.join(item.root, 'dsh_data_analysis_report_kit-3.0.0-py3-none-any.whl')
  await rm(missing)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: item.runtimeRoot, uvExecutable: item.uv, installTimeoutMs: 10_000 },
      { ...runtimeOptions(item), reportKitWheelPath: missing },
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-report-kit-wheel-unavailable',
  )
  await assert.rejects(() => stat(path.join(item.runtimeRoot, 'installation.json')), {
    code: 'ENOENT',
  })
})
