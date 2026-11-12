import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { MARIVO_VERSION } from '../../src/compatibility.ts'
import {
  ensureSharedMarivoRuntime,
  MarivoEnvironmentError,
  SHARED_MARIVO_PACKAGE_SPEC,
} from '../../src/environment/index.ts'

const FIXTURE_MARIVO_VERSION = MARIVO_VERSION

function fakePython(packagePath: string): string {
  return `#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { appendFileSync, chmodSync, copyFileSync, mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
if (args[0] === '-m') {
  appendFileSync(process.env.PYTHON_RECORD, JSON.stringify(args.slice(1)) + '\\n')
  if (args[1] === 'venv') {
    if (process.env.FAIL_VENV === '1') process.exit(18)
    const executable = path.join(args[2], process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    mkdirSync(path.dirname(executable), { recursive: true })
    copyFileSync(process.env.FAKE_PYTHON_SOURCE, executable)
    chmodSync(executable, 0o755)
    process.exit(0)
  }
  if (args[1] === 'pip' && args[2] === 'install') process.exit(process.env.FAIL_PIP === '1' ? 17 : 0)
  process.exit(2)
}
const script = args[1] ?? ''
if (args[0] !== '-c') process.exit(2)
if (script.includes('sys.version_info')) {
  process.stdout.write(JSON.stringify({
    python_executable: process.env.REPORTED_PYTHON ?? path.resolve(process.argv[1]),
    version: JSON.parse(process.env.PYTHON_VERSION ?? '[3, 10, 14]'),
    prefix: path.dirname(path.resolve(process.argv[1])),
  }))
} else if (script.includes('import marivo')) {
  if (!script.includes('read_dataframe')) process.exit(29)
  if (script.includes('import ibis.backends.duckdb') && process.env.DUCKDB_MISSING === '1') {
    process.stderr.write('No module named duckdb')
    process.exit(24)
  }
  if (process.env.PROBE_FAIL === '1') {
    process.stderr.write('fixture import failed')
    process.exit(23)
  }
  process.stdout.write(JSON.stringify({
    marivo_index_install: process.env.DIRECT_INSTALL !== '1',
    marivo_distribution_version: process.env.MARIVO_VERSION ?? "0.6.6",
    marivo_import_identity: true,
    python_executable: process.env.REPORTED_PYTHON ?? path.resolve(process.argv[1]),
    marivo_version: process.env.MARIVO_VERSION ?? ${JSON.stringify(FIXTURE_MARIVO_VERSION)},
    package_path: ${JSON.stringify(packagePath)},
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
  bootstrapPython: string
  environment: NodeJS.ProcessEnv
  recordPath: string
  cleanup(): Promise<void>
}

async function fixture(): Promise<RuntimeFixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-shared-runtime-')))
  const runtimeRoot = path.join(root, 'runtime')
  const failedRuntimeRoot = path.join(root, 'failed-runtime')
  const managedPython = path.join(root, 'managed-python')
  const fakePythonSource = path.join(root, 'fake-python')
  const recordPath = path.join(root, 'python.jsonl')
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
  await writeFile(managedPython, fakePython(packagePath))
  await writeFile(fakePythonSource, fakePython(packagePath))
  await chmod(managedPython, 0o755)
  await chmod(fakePythonSource, 0o755)
  return {
    root,
    packagePath,
    runtimeRoot,
    failedRuntimeRoot,
    bootstrapPython: managedPython,
    recordPath,
    environment: {
      PATH: process.env.PATH,
      PYTHON_RECORD: recordPath,
      MANAGED_PYTHON: managedPython,
      FAKE_PYTHON_SOURCE: fakePythonSource,
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
      {
        runtimeRoot: item.runtimeRoot,
        bootstrapPythonExecutable: item.bootstrapPython,
        installTimeoutMs: 10_000,
      },
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
  const config = {
    runtimeRoot: item.runtimeRoot,
    bootstrapPythonExecutable: item.bootstrapPython,
    installTimeoutMs: 10_000,
  }
  const [first, second] = await Promise.all([
    ensureSharedMarivoRuntime(config, runtimeOptions(item, item.environment, 5)),
    ensureSharedMarivoRuntime(config, runtimeOptions(item, item.environment, 5)),
  ])
  const third = await ensureSharedMarivoRuntime(config, runtimeOptions(item))

  assert.equal(first.pythonExecutable, second.pythonExecutable)
  assert.equal(second.packagePath, third.packagePath)
  assert.equal(first.marivoVersion, FIXTURE_MARIVO_VERSION)
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 1)
  assert.equal(SHARED_MARIVO_PACKAGE_SPEC, 'marivo[duckdb,trino,clickhouse]==0.6.6')
  assert.deepEqual(
    calls.find((args) => args[0] === 'pip'),
    ['pip', 'install', '--force-reinstall', 'marivo[duckdb,trino,clickhouse]==0.6.6'],
  )
  const marker = JSON.parse(
    await readFile(path.join(item.runtimeRoot, 'installation.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.equal(marker.marivoVersion, FIXTURE_MARIVO_VERSION)
  assert.equal('reportAdapterKind' in marker, false)
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v5')
  assert.equal('capabilities' in marker, false)
  await stat(path.join(first.skillsRoot, 'marivo-analysis', 'SKILL.md'))
  await stat(path.join(first.skillsRoot, 'marivo-semantic', 'SKILL.md'))
  await assert.rejects(stat(path.join(first.skillsRoot, 'marivo-service', 'SKILL.md')), {
    code: 'ENOENT',
  })
})

test('shared Runtime copies and verifies the service Skill when the package provides it', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const source = path.join(path.dirname(item.packagePath), 'skills', 'marivo-service')
  await mkdir(source, { recursive: true })
  const body = '---\nname: marivo-service\ndescription: fixture\n---\nservice workflow\n'
  await writeFile(path.join(source, 'SKILL.md'), body)
  const installed = await ensureSharedMarivoRuntime(
    {
      runtimeRoot: item.runtimeRoot,
      bootstrapPythonExecutable: item.bootstrapPython,
      installTimeoutMs: 10_000,
    },
    runtimeOptions(item),
  )
  assert.equal(
    await readFile(path.join(installed.skillsRoot, 'marivo-service', 'SKILL.md'), 'utf8'),
    body,
  )
})

test('shared Runtime rejects a malformed service Skill when the package provides it', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const source = path.join(path.dirname(item.packagePath), 'skills', 'marivo-service')
  await mkdir(source, { recursive: true })
  await writeFile(path.join(source, 'SKILL.md'), '---\nname: wrong\ndescription: fixture\n---\n')
  await assert.rejects(
    ensureSharedMarivoRuntime(
      {
        runtimeRoot: item.runtimeRoot,
        bootstrapPythonExecutable: item.bootstrapPython,
        installTimeoutMs: 10_000,
      },
      runtimeOptions(item),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-skills-invalid' &&
      error.details.skill === 'marivo-service',
  )
})

test('existing-only mode verifies without creating a missing Runtime', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = {
    runtimeRoot: item.runtimeRoot,
    bootstrapPythonExecutable: item.bootstrapPython,
    installTimeoutMs: 10_000,
  }
  await assert.rejects(
    ensureSharedMarivoRuntime(config, { ...runtimeOptions(item), existingOnly: true }),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-installation-required',
  )
  await assert.rejects(stat(item.runtimeRoot), { code: 'ENOENT' })
  const installed = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const verified = await ensureSharedMarivoRuntime(config, {
    ...runtimeOptions(item),
    existingOnly: true,
  })
  assert.deepEqual(verified, installed)
})

test('a managed Runtime on another Marivo version is rebuilt to the pinned version', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = {
    runtimeRoot: item.runtimeRoot,
    bootstrapPythonExecutable: item.bootstrapPython,
    installTimeoutMs: 10_000,
  }
  const initial = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const marker = JSON.parse(await readFile(initial.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  marker.marivoVersion = '0.6.3.dev0'
  await writeFile(initial.installationPath, `${JSON.stringify(marker)}\n`)

  const current = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  assert.equal(current.marivoVersion, '0.6.6')
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  const installCalls = calls.filter((args) => args[0] === 'pip' && args[1] === 'install')
  assert.equal(installCalls.length, 2)
  assert.equal(installCalls.filter((args) => args.at(-1) === SHARED_MARIVO_PACKAGE_SPEC).length, 2)
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('runtime.invalid-')))
})
test('an unsupported marker is discarded instead of migrated or reused', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = {
    runtimeRoot: item.runtimeRoot,
    bootstrapPythonExecutable: item.bootstrapPython,
    installTimeoutMs: 10_000,
  }
  const first = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const marker = JSON.parse(await readFile(first.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  marker.schema = 'dsh-data-analysis-runtime/v4'
  marker.marivoArchiveSha256 = 'previous-wheel-hash'
  await writeFile(first.installationPath, `${JSON.stringify(marker)}\n`)

  const rebuilt = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 2)
  const rebuiltMarker = JSON.parse(await readFile(rebuilt.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(rebuiltMarker.schema, 'dsh-data-analysis-runtime/v5')
  assert.equal('capabilities' in rebuiltMarker, false)
  const siblings = await import('node:fs/promises').then((fs) => fs.readdir(item.root))
  assert.ok(siblings.some((name) => name.startsWith('runtime.invalid-')))
})

test('a corrupt marker is rebuilt instead of partially trusted', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const config = {
    runtimeRoot: item.runtimeRoot,
    bootstrapPythonExecutable: item.bootstrapPython,
    installTimeoutMs: 10_000,
  }
  const first = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  await writeFile(first.installationPath, '{not-json\n')

  const rebuilt = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const marker = JSON.parse(await readFile(rebuilt.installationPath, 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v5')
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.equal(calls.filter((args) => args[0] === 'pip' && args[1] === 'install').length, 2)
})

test('failed installation never publishes installation.json', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      {
        runtimeRoot: item.failedRuntimeRoot,
        bootstrapPythonExecutable: item.bootstrapPython,
        installTimeoutMs: 10_000,
      },
      runtimeOptions(item, { ...item.environment, FAIL_PIP: '1' }),
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'shared-runtime-install-failed',
  )
  await assert.rejects(() => stat(path.join(item.failedRuntimeRoot, 'installation.json')), {
    code: 'ENOENT',
  })
  const recovered = await ensureSharedMarivoRuntime(
    {
      runtimeRoot: item.failedRuntimeRoot,
      bootstrapPythonExecutable: item.bootstrapPython,
      installTimeoutMs: 10_000,
    },
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

test('administrator Python missing a package receives the Marivo package repair without mutation', async (t) => {
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
      error.message.includes(SHARED_MARIVO_PACKAGE_SPEC) &&
      Array.isArray(error.details.repairCommands) &&
      error.details.repairCommands.length === 1,
  )
  await assert.rejects(() => stat(item.recordPath), { code: 'ENOENT' })
})

for (const version of [[3, 9, 20], [2, 7, 18], [], [3, '10', 0]]) {
  test(`bootstrap Python ${JSON.stringify(version)} is rejected before venv or pip`, async (t) => {
    const item = await fixture()
    t.after(item.cleanup)
    await assert.rejects(
      ensureSharedMarivoRuntime(
        { runtimeRoot: item.runtimeRoot, bootstrapPythonExecutable: item.bootstrapPython },
        runtimeOptions(item, { ...item.environment, PYTHON_VERSION: JSON.stringify(version) }),
      ),
      /Local Python does not satisfy Marivo >=3.10/,
    )
    await assert.rejects(() => stat(item.recordPath), { code: 'ENOENT' })
    await assert.rejects(() => stat(path.join(item.runtimeRoot, 'installation.json')), {
      code: 'ENOENT',
    })
  })
}

test('missing bootstrap Python gives actionable guidance without fallback', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      {
        runtimeRoot: item.runtimeRoot,
        bootstrapPythonExecutable: path.join(item.root, 'missing-python'),
      },
      runtimeOptions(item),
    ),
    /Install Python 3.10\+ with venv\/ensurepip/,
  )
  await assert.rejects(() => stat(item.recordPath), { code: 'ENOENT' })
})

test('missing venv stops before pip and never publishes a marker', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: item.runtimeRoot, bootstrapPythonExecutable: item.bootstrapPython },
      runtimeOptions(item, { ...item.environment, FAIL_VENV: '1' }),
    ),
    /requires Python venv\/ensurepip/,
  )
  const calls = (await readFile(item.recordPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[])
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['venv'],
  )
  await assert.rejects(() => stat(path.join(item.runtimeRoot, 'installation.json')), {
    code: 'ENOENT',
  })
})

for (const administrator of [false, true]) {
  test(`missing DuckDB backend rejects ${administrator ? 'administrator' : 'managed'} Runtime`, async (t) => {
    const item = await fixture()
    t.after(item.cleanup)
    await assert.rejects(
      ensureSharedMarivoRuntime(
        {
          runtimeRoot: item.runtimeRoot,
          ...(administrator
            ? { pythonExecutable: item.bootstrapPython }
            : { bootstrapPythonExecutable: item.bootstrapPython }),
        },
        runtimeOptions(item, { ...item.environment, DUCKDB_MISSING: '1' }),
      ),
      (error: unknown) =>
        error instanceof MarivoEnvironmentError &&
        error.code ===
          (administrator ? 'shared-runtime-package-unavailable' : 'shared-runtime-install-failed'),
    )
    await assert.rejects(() => stat(path.join(item.runtimeRoot, 'installation.json')), {
      code: 'ENOENT',
    })
    if (administrator) await assert.rejects(() => stat(item.recordPath), { code: 'ENOENT' })
  })
}

for (const administrator of [false, true]) {
  test(`direct URL installation is rejected for ${administrator ? 'administrator' : 'managed'} Runtime`, async (t) => {
    const item = await fixture()
    t.after(item.cleanup)
    await assert.rejects(
      ensureSharedMarivoRuntime(
        {
          runtimeRoot: item.runtimeRoot,
          ...(administrator
            ? { pythonExecutable: item.bootstrapPython }
            : { bootstrapPythonExecutable: item.bootstrapPython }),
        },
        runtimeOptions(item, { ...item.environment, DIRECT_INSTALL: '1' }),
      ),
      (error: unknown) =>
        error instanceof MarivoEnvironmentError &&
        error.code === 'shared-runtime-identity-mismatch' &&
        error.message.includes('pip package index'),
    )
    await assert.rejects(stat(path.join(item.runtimeRoot, 'installation.json')), { code: 'ENOENT' })
  })
}

test('DSH_HOME directory aliases install and reuse one Runtime, including an existing alias marker', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const alias = path.join(item.root, 'home-link')
  await symlink(item.root, alias, 'dir')
  const previous = process.env.DSH_HOME
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  process.env.DSH_HOME = alias
  const config = { bootstrapPythonExecutable: item.bootstrapPython, installTimeoutMs: 10_000 }
  const runtime = await ensureSharedMarivoRuntime(config, runtimeOptions(item))
  const physicalRuntime = path.join(item.root, 'dsh-data-analysis', 'runtimes', 'marivo')
  const pythonSuffix = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  assert.equal(runtime.pythonExecutable, path.join(physicalRuntime, '.venv', pythonSuffix))
  assert.equal(runtime.packagePath, item.packagePath)
  const marker = JSON.parse(await readFile(runtime.installationPath, 'utf8'))
  assert.equal(marker.pythonExecutable, runtime.pythonExecutable)
  assert.equal(marker.packagePath, runtime.packagePath)
  const reused = await ensureSharedMarivoRuntime(config, {
    ...runtimeOptions(item),
    existingOnly: true,
  })
  assert.deepEqual(reused, runtime)

  // Records written before canonicalization remain usable through either directory spelling.
  marker.pythonExecutable = path.join(runtime.runtimeRoot, '.venv', pythonSuffix)
  marker.packagePath = path.join(alias, 'site-packages', 'marivo', '__init__.py')
  await writeFile(runtime.installationPath, JSON.stringify(marker))
  process.env.DSH_HOME = item.root
  const legacy = await ensureSharedMarivoRuntime(config, {
    ...runtimeOptions(item),
    existingOnly: true,
  })
  assert.equal(legacy.pythonExecutable, runtime.pythonExecutable)
  assert.equal(legacy.packagePath, runtime.packagePath)
  assert.equal(legacy.runtimeRoot, physicalRuntime)
})

test('Runtime admission rejects another venv even when both Python links share a base executable', async (t) => {
  const item = await fixture()
  t.after(item.cleanup)
  const selected = path.join(item.root, 'first-venv', 'bin', 'python')
  const reported = path.join(item.root, 'second-venv', 'bin', 'python')
  for (const executable of [selected, reported]) {
    await mkdir(path.dirname(executable), { recursive: true })
    await symlink(item.bootstrapPython, executable)
  }
  await assert.rejects(
    ensureSharedMarivoRuntime(
      { runtimeRoot: item.runtimeRoot, pythonExecutable: selected },
      runtimeOptions(item, { ...item.environment, REPORTED_PYTHON: reported }),
    ),
    { code: 'shared-runtime-identity-mismatch' },
  )
})
