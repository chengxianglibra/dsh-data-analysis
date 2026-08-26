import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import {
  bindMarivoEnvironment,
  FixedSubprocessPolicy,
  MarivoEnvironmentError,
} from '../../src/environment/index.ts'
import { environmentPayload } from '../../src/environment/summary.ts'

const FIXTURE_EXECUTABLE = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const executable = path.resolve(process.argv[1])

if (args[0] === '--record') {
  appendFileSync(args[1], JSON.stringify({
    cwd: process.cwd(), marker: process.env.FIXTURE_MARKER,
    credential: process.env.TEST_CREDENTIAL,
    persistSecrets: process.env.MARIVO_PERSIST_SECRETS,
    persistCredentials: process.env.MARIVO_PERSIST_CREDENTIALS,
  }) + '\n')
  process.stdout.write('recorded')
  process.exit(0)
} else if (args[0] === '--spawn-child') {
  spawn(process.execPath, ['-e',
    'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 200)', args[1]], {
    stdio: 'ignore',
  })
  setTimeout(() => process.stdout.write('late'), 10_000)
} else if (args[0] === '--sleep') {
  setTimeout(() => process.stdout.write('late'), 10_000)
} else if (args[0] === '--output') {
  process.stdout.write('x'.repeat(Number(args[1])))
} else if (args[0] === '-m' && args[1] === 'marivo' && args[2] === 'doctor') {
  const rootIndex = args.indexOf('--project-root')
  const projectRoot = path.resolve(args[rootIndex + 1])
  if (process.env.DOCTOR_INVALID_JSON === '1') {
    process.stdout.write('{invalid')
    process.exit(1)
  }
  const installationStatus = process.env.INSTALLATION_STATUS ?? 'ok'
  const manifestStatus = process.env.MANIFEST_STATUS ?? 'ok'
  const nonGatingStatus = process.env.NON_GATING_STATUS ?? 'fail'
  const overallStatus = process.env.DOCTOR_OVERALL_STATUS ?? 'fail'
  const report = {
    status: overallStatus,
    project_root: process.env.REPORTED_PROJECT_ROOT ?? projectRoot,
    python_executable: process.env.REPORTED_PYTHON ?? executable,
    marivo: {
      version: process.env.MARIVO_VERSION ?? '0.0.test',
      package_path: process.env.PACKAGE_PATH ?? path.join(projectRoot, 'fake-marivo', '__init__.py'),
    },
    sections: [
      {
        id: 'installation',
        status: installationStatus,
        checks: [
          { id: 'installation.python', status: installationStatus, summary: 'fixture Python' },
          { id: 'installation.marivo', status: installationStatus, summary: 'fixture Marivo' },
        ],
      },
      {
        id: 'project',
        status: manifestStatus,
        checks: [
          { id: 'project.marivo_toml', status: manifestStatus, summary: 'fixture manifest' },
        ],
      },
      {
        id: 'datasources',
        status: nonGatingStatus,
        checks: [
          {
            id: 'datasource.credentials',
            status: nonGatingStatus,
            summary: 'missing test secret ' + 's'.repeat(400),
            details: { secret: 'must-not-leak' },
          },
        ],
      },
    ],
  }
  process.stdout.write(JSON.stringify(report))
  process.exit(Number(process.env.DOCTOR_EXIT ?? '1'))
} else if (args[0] === '-c') {
  const expectedPython = path.resolve(args[2])
  const expectedVersion = args[3]
  const expectedPackage = path.resolve(args[4])
  if (process.env.IDENTITY_MODE === 'mismatch') {
    process.stderr.write(JSON.stringify({ kind: 'identity-mismatch' }))
    process.exit(78)
  }
  process.stdout.write(JSON.stringify({
    python_executable: expectedPython,
    marivo_version: expectedVersion,
    package_path: expectedPackage,
  }))
} else {
  process.stderr.write('unsupported fixture invocation: ' + JSON.stringify(args))
  process.exit(2)
}
`

interface FixtureProject {
  root: string
  executable: string
  cleanup: () => Promise<void>
}

async function fixtureProject(withDefaultVenv = true): Promise<FixtureProject> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-data-analysis-slice1-')))
  const executable = withDefaultVenv
    ? path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    : path.join(root, 'fixture-python')
  await mkdir(path.dirname(executable), { recursive: true })
  await writeFile(executable, FIXTURE_EXECUTABLE, 'utf8')
  await chmod(executable, 0o755)
  return { root, executable, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function assertEnvironmentError(
  action: () => Promise<unknown>,
  code: MarivoEnvironmentError['code'],
): Promise<MarivoEnvironmentError> {
  try {
    await action()
    assert.fail(`expected ${code}`)
  } catch (error) {
    assert.ok(error instanceof MarivoEnvironmentError)
    assert.equal(error.code, code)
    return error
  }
}

test('default .venv binding admits non-gating doctor failures and parses non-zero exit JSON', async (t) => {
  const fixture = await fixtureProject()
  t.after(fixture.cleanup)

  const environment = await bindMarivoEnvironment({ projectRoot: fixture.root }, {
    environment: {
      PATH: process.env.PATH,
      DOCTOR_EXIT: '7',
      DOCTOR_OVERALL_STATUS: 'fail',
      NON_GATING_STATUS: 'fail',
    },
  })

  assert.equal(environment.status, 'ready')
  assert.equal(environment.binding.projectRoot, fixture.root)
  assert.equal(environment.binding.pythonExecutable, fixture.executable)
  assert.equal(environment.binding.marivoVersion, '0.0.test')
  assert.match(environment.binding.fingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(environment.binding).sort(), [
    'fingerprint',
    'marivoVersion',
    'packagePath',
    'projectRoot',
    'pythonExecutable',
    'subprocessPolicyId',
  ])
  assert.equal('diagnostics' in environment, false)

  const identity = await environment.assertImportIdentity()
  assert.equal(identity.pythonExecutable, fixture.executable)
})

test('environment CLI payload exposes stable admission identity without a doctor snapshot', async (t) => {
  const fixture = await fixtureProject()
  t.after(fixture.cleanup)
  const environment = await bindMarivoEnvironment({ projectRoot: fixture.root }, {
    environment: {
      PATH: process.env.PATH,
      DOCTOR_EXIT: '7',
      DOCTOR_OVERALL_STATUS: 'fail',
      NON_GATING_STATUS: 'fail',
    },
  })
  const payload = environmentPayload({
    runtimeRoot: path.join(fixture.root, 'runtime'),
    pythonExecutable: environment.binding.pythonExecutable,
    marivoVersion: environment.binding.marivoVersion,
    packagePath: environment.binding.packagePath,
    skillsRoot: path.join(fixture.root, 'runtime', 'skills'),
    installationPath: path.join(fixture.root, 'runtime', 'installation.json'),
  }, environment)

  assert.equal(payload.status, 'ready')
  assert.equal(payload.projectRoot, fixture.root)
  assert.equal('doctorOverallStatus' in payload, false)
  assert.equal('diagnostics' in payload, false)
})

test('explicit interpreter must be absolute', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  await assertEnvironmentError(
    () => bindMarivoEnvironment({ projectRoot: fixture.root, pythonExecutable: 'bin/python' }),
    'python-path-relative',
  )
})

test('missing project .venv does not fall back to PATH or system Python', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  await assertEnvironmentError(
    () => bindMarivoEnvironment({ projectRoot: fixture.root }, { environment: process.env }),
    'python-unavailable',
  )
})

test('missing project root is rejected with its absolute path', async () => {
  const root = path.join(tmpdir(), `dsh-missing-${process.pid}-${Date.now()}`)
  const error = await assertEnvironmentError(
    () => bindMarivoEnvironment({ projectRoot: root }),
    'project-root-invalid',
  )
  assert.equal(error.details.projectRoot, path.resolve(root))
})

for (const [name, environment, expectedCheck] of [
  ['Marivo installation', { INSTALLATION_STATUS: 'fail' }, 'installation.python'],
  ['project manifest', { MANIFEST_STATUS: 'fail' }, 'project.marivo_toml'],
  ['Python identity', { REPORTED_PYTHON: '/different/python' }, 'python_executable'],
] as const) {
  test(`${name} admission failure is fail-closed and check-specific`, async (t) => {
    const fixture = await fixtureProject(false)
    t.after(fixture.cleanup)
    const error = await assertEnvironmentError(
      () => bindMarivoEnvironment(
        { projectRoot: fixture.root, pythonExecutable: fixture.executable },
        { environment: { PATH: process.env.PATH, ...environment } },
      ),
      'doctor-admission-failed',
    )
    assert.equal(error.details.check, expectedCheck)
  })
}

test('invalid doctor JSON is rejected even when stderr and exit code are bounded', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  const error = await assertEnvironmentError(
    () => bindMarivoEnvironment(
      { projectRoot: fixture.root, pythonExecutable: fixture.executable },
      { environment: { PATH: process.env.PATH, DOCTOR_INVALID_JSON: '1' } },
    ),
    'doctor-json-invalid',
  )
  assert.equal(error.details.exitCode, 1)
  assert.equal(typeof error.details.stderr, 'string')
})

test('fingerprint is stable across non-admission doctor status changes', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  const config = { projectRoot: fixture.root, pythonExecutable: fixture.executable }
  const first = await bindMarivoEnvironment(config, {
    environment: { PATH: process.env.PATH, DOCTOR_OVERALL_STATUS: 'ok', NON_GATING_STATUS: 'ok' },
  })
  const second = await bindMarivoEnvironment(config, {
    environment: { PATH: process.env.PATH, DOCTOR_OVERALL_STATUS: 'fail', NON_GATING_STATUS: 'fail' },
  })
  assert.equal(first.binding.fingerprint, second.binding.fingerprint)
})

test('subprocess policy freezes cwd and environment projection at binding time', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  const projected = { PATH: process.env.PATH, FIXTURE_MARKER: 'first' }
  const environment = await bindMarivoEnvironment(
    { projectRoot: fixture.root, pythonExecutable: fixture.executable },
    { environment: projected },
  )
  projected.FIXTURE_MARKER = 'changed-after-bind'
  const recordPath = path.join(fixture.root, 'record.jsonl')
  const result = await environment.subprocessPolicy.run({
    executable: fixture.executable,
    args: ['--record', recordPath],
  })
  assert.equal(result.exitCode, 0)
  const records = await import('node:fs/promises').then(fs => fs.readFile(recordPath, 'utf8'))
  assert.deepEqual(JSON.parse(records.trim()), {
    cwd: fixture.root, marker: 'first', persistSecrets: '0', persistCredentials: '0',
  })

  const overlayPath = path.join(fixture.root, 'overlay.jsonl')
  await environment.subprocessPolicy.run({
    executable: fixture.executable,
    args: ['--record', overlayPath],
    environmentOverlay: {
      FIXTURE_MARKER: 'per-operation',
      TEST_CREDENTIAL: 'overlay-secret',
      MARIVO_PERSIST_SECRETS: '1',
      MARIVO_PERSIST_CREDENTIALS: '1',
    },
  })
  assert.deepEqual(JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(overlayPath, 'utf8'))), {
    cwd: fixture.root,
    marker: 'per-operation',
    credential: 'overlay-secret',
    persistSecrets: '0',
    persistCredentials: '0',
  })
})

test('identity mismatch permanently fails the binding until explicit rebind', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  const environment = await bindMarivoEnvironment(
    { projectRoot: fixture.root, pythonExecutable: fixture.executable },
    { environment: { PATH: process.env.PATH, IDENTITY_MODE: 'mismatch' } },
  )
  await assertEnvironmentError(() => environment.assertImportIdentity(), 'binding-identity-mismatch')
  assert.equal(environment.status, 'failed')
  await assertEnvironmentError(() => environment.assertImportIdentity(), 'binding-failed')
})

test('subprocess timeout, cancellation, and output limits are explicit', async (t) => {
  const fixture = await fixtureProject(false)
  t.after(fixture.cleanup)
  const policy = new FixedSubprocessPolicy(fixture.root, { PATH: process.env.PATH })

  await assertEnvironmentError(
    () => policy.run({
      executable: fixture.executable,
      args: ['--sleep'],
      limits: { timeoutMs: 20, terminateGraceMs: 20 },
    }),
    'subprocess-timeout',
  )

  if (process.platform !== 'win32') {
    const descendantMarker = path.join(fixture.root, 'descendant-survived')
    await assertEnvironmentError(
      () => policy.run({
        executable: fixture.executable,
        args: ['--spawn-child', descendantMarker],
        limits: { timeoutMs: 50, terminateGraceMs: 20 },
      }),
      'subprocess-timeout',
    )
    await new Promise(resolve => setTimeout(resolve, 300))
    await assert.rejects(() => stat(descendantMarker), { code: 'ENOENT' })
  }

  const controller = new AbortController()
  const pending = policy.run({ executable: fixture.executable, args: ['--sleep'], signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await assertEnvironmentError(() => pending, 'subprocess-cancelled')

  await assertEnvironmentError(
    () => policy.run({
      executable: fixture.executable,
      args: ['--output', '1000'],
      limits: { stdoutMaxBytes: 100 },
    }),
    'subprocess-output-limit',
  )
})
