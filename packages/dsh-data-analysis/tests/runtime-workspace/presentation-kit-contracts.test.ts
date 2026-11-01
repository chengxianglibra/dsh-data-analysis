import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createSharedMarivoRuntimeRunner,
  MarivoEnvironmentError,
} from '../../src/environment/index.ts'
import { parseTypedDataset } from '../../src/presentation/contracts/index.ts'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python', 'presentation-kit')

function run(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

function python(args: string[]): string {
  return run('uv', ['run', '--project', projectRoot, '--frozen', 'python', ...args])
}

test('Python presentation helper passes its numerical, temporal, missing-value and budget contracts', () => {
  python(['-m', 'pytest', path.join(projectRoot, 'tests'), '-q'])
})

test('Python presentation output satisfies the shared Node typed-data contract', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-kit-contracts-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))
  const output = JSON.parse(
    python([path.join(projectRoot, 'scripts', 'emit_contract_fixtures.py'), outputRoot]),
  ) as { computed: string; artifact: string }
  for (const kind of ['computed', 'artifact'] as const) {
    const actual = parseTypedDataset(JSON.parse(await readFile(output[kind], 'utf8')))
    const expected = JSON.parse(
      await readFile(path.join(projectRoot, 'tests', 'fixtures', `${kind}.dataset.json`), 'utf8'),
    )
    assert.deepEqual(actual, parseTypedDataset(expected))
  }
})

test('shared checked execution rejects a shadowed helper before user code starts', async (t) => {
  const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-checked-')))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))
  const virtualenv = path.join(outputRoot, '.venv')
  const executable = path.join(
    virtualenv,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  )
  const wheels = path.join(outputRoot, 'wheels')
  run('uv', ['build', '--project', projectRoot, '--wheel', '--out-dir', wheels])
  run('uv', [
    'venv',
    '--python',
    python(['-c', 'import sys; print(sys.executable)']).trim(),
    virtualenv,
  ])
  run('uv', [
    'pip',
    'install',
    '--python',
    executable,
    path.join(wheels, 'dsh_data_analysis_presentation_kit-1.5.1-py3-none-any.whl'),
  ])
  const identity = JSON.parse(
    run(executable, [
      '-c',
      String.raw`
import json, sys
import dsh_data_analysis_presentation as presentation
print(json.dumps({"python": sys.executable, "version": presentation.__version__, "packagePath": presentation.__file__}))
`,
    ]),
  ) as { python: string; version: string; packagePath: string }
  const marivoPath = path.join(outputRoot, 'marivo.py')
  await writeFile(marivoPath, '__version__ = "fixture"\n')
  const runner = createSharedMarivoRuntimeRunner({
    runtimeRoot: outputRoot,
    pythonExecutable: identity.python,
    marivoVersion: 'fixture',
    packagePath: marivoPath,
    presentationKitVersion: identity.version,
    presentationKitPackagePath: identity.packagePath,
  })
  const result = await runner.runChecked({ program: 'print("checked")' })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  assert.equal(result.stdout.toString('utf8').trim(), 'checked')

  await writeFile(
    path.join(outputRoot, 'dsh_data_analysis_presentation.py'),
    '__version__ = "1.5.1"\ndef capture_dataset(*args, **kwargs): pass\ndef capture_frame(*args, **kwargs): pass\n',
  )
  const userOutput = path.join(outputRoot, 'must-not-exist.txt')
  await assert.rejects(
    runner.runChecked({
      program: 'from pathlib import Path\nimport sys\nPath(sys.argv[1]).write_text("started")',
      args: [userOutput],
    }),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'binding-identity-mismatch',
  )
  await assert.rejects(() => stat(userOutput), { code: 'ENOENT' })
  assert.equal(runner.status, 'failed')
  await assert.rejects(
    runner.runChecked({ program: 'print("must not restart")' }),
    (error: unknown) => error instanceof MarivoEnvironmentError && error.code === 'binding-failed',
  )
})
