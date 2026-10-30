import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  ensureSharedMarivoRuntime,
  MarivoEnvironmentError,
  MarivoWorkspaceEnvironmentManager,
} from '../src/environment/index.ts'
import { parseTypedDataset } from '../src/presentation/contracts/index.ts'

// By default install into a fresh, disposable Runtime. An explicit Python is only probed.
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
const keepValidation = process.env.DSH_DATA_ANALYSIS_KEEP_VALIDATION === '1'

const validationRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-runtime-workspace-')))
try {
  const runtimeRoot = path.join(validationRoot, 'runtime')
  const firstWorkspace = path.join(validationRoot, 'workspace-a')
  const secondWorkspace = path.join(validationRoot, 'workspace-b')
  await mkdir(firstWorkspace)
  await mkdir(secondWorkspace)
  const before = new Map([
    [firstWorkspace, await readdir(firstWorkspace)],
    [secondWorkspace, await readdir(secondWorkspace)],
  ])

  const config = { runtimeRoot, ...(pythonExecutable === undefined ? {} : { pythonExecutable }) }
  const runtime = await ensureSharedMarivoRuntime(config)
  const reused = await ensureSharedMarivoRuntime(config)
  assert.deepEqual(reused, runtime)
  const marker = JSON.parse(await readFile(runtime.installationPath, 'utf8'))
  assert.equal(marker.marivoVersion, runtime.marivoVersion)
  assert.equal(marker.presentationKitVersion, '1.5.0')
  assert.equal(marker.presentationKitPackagePath, runtime.presentationKitPackagePath)
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v3')
  const administrator = await ensureSharedMarivoRuntime({
    runtimeRoot: path.join(validationRoot, 'administrator-runtime'),
    pythonExecutable: runtime.pythonExecutable,
    bootstrapPythonExecutable: path.join(validationRoot, 'must-not-run-bootstrap-python'),
  })
  assert.equal(administrator.pythonExecutable, runtime.pythonExecutable)
  assert.equal(administrator.presentationKitPackagePath, runtime.presentationKitPackagePath)
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
    assert.deepEqual(await readdir(workspace), before.get(workspace))
  }
  assert.deepEqual(first.binding.presentationKit, {
    version: runtime.presentationKitVersion,
    packagePath: runtime.presentationKitPackagePath,
  })

  const computedPath = path.join(firstWorkspace, 'computed.json')
  const checkedWrite = await first.runChecked({
    program: String.raw`
from decimal import Decimal
from pathlib import Path
import sys
import pandas as pd
from dsh_data_analysis_presentation._dataset import encode_dataset, encoded_json
frame = pd.DataFrame({
    "count": pd.Series([9007199254740993, None], dtype="Int64"),
    "amount": [Decimal("12345678901234.5678"), Decimal("0.1000")],
})
Path(sys.argv[1]).write_bytes(encoded_json(encode_dataset(frame)))
`,
    args: [computedPath],
  })
  assert.equal(checkedWrite.exitCode, 0, checkedWrite.stderr.toString('utf8'))
  const computed = parseTypedDataset(JSON.parse(await readFile(computedPath, 'utf8')))
  assert.deepEqual(
    computed.columns.map(({ id }) => id),
    ['count', 'amount'],
  )
  assert.deepEqual(computed.rows, [
    ['9007199254740993', '12345678901234.5678'],
    [null, '0.1000'],
  ])

  const shadowRoot = path.join(firstWorkspace, 'dsh_data_analysis_presentation')
  await mkdir(shadowRoot)
  await writeFile(
    path.join(shadowRoot, '__init__.py'),
    '__version__ = "1.5.0"\ndef capture_dataset(*args, **kwargs): pass\ndef capture_frame(*args, **kwargs): pass\n',
  )
  await assert.rejects(
    first.runChecked({ program: 'raise RuntimeError("user program must never start")' }),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'binding-identity-mismatch',
  )
  assert.equal(first.status, 'failed')
  const shadowAdministratorRoot = path.join(validationRoot, 'administrator-shadow-runtime')
  await assert.rejects(
    ensureSharedMarivoRuntime(
      {
        runtimeRoot: shadowAdministratorRoot,
        pythonExecutable: runtime.pythonExecutable,
        bootstrapPythonExecutable: path.join(validationRoot, 'must-not-run-bootstrap-python'),
      },
      { environment: { ...process.env, PYTHONPATH: firstWorkspace } },
    ),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError && error.code === 'shared-runtime-identity-mismatch',
  )
  await assert.rejects(() => stat(path.join(shadowAdministratorRoot, 'installation.json')), {
    code: 'ENOENT',
  })
  const emptyPythonRoot = path.join(validationRoot, 'empty-administrator-python')
  const createEmptyPython = await second.runChecked({
    program: 'import sys, venv\nvenv.EnvBuilder(with_pip=False).create(sys.argv[1])',
    args: [emptyPythonRoot],
  })
  assert.equal(createEmptyPython.exitCode, 0, createEmptyPython.stderr.toString('utf8'))
  const missingAdministratorRoot = path.join(validationRoot, 'administrator-missing-runtime')
  await assert.rejects(
    ensureSharedMarivoRuntime({
      runtimeRoot: missingAdministratorRoot,
      pythonExecutable: path.join(
        emptyPythonRoot,
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
      bootstrapPythonExecutable: path.join(validationRoot, 'must-not-run-bootstrap-python'),
    }),
    (error: unknown) =>
      error instanceof MarivoEnvironmentError &&
      error.code === 'shared-runtime-package-unavailable',
  )
  await assert.rejects(() => stat(path.join(missingAdministratorRoot, 'installation.json')), {
    code: 'ENOENT',
  })
  manager.dispose()

  const evidence = `${JSON.stringify(
    {
      status: 'ok',
      validationRoot,
      installationMode: pythonExecutable === undefined ? 'managed' : 'administrator',
      runtime,
      administrator,
      workspaces: [first.binding, second.binding],
      runtimeReused: true,
      zeroWorkspaceWrites: true,
      checkedEncoding: { data: computed },
      workspaceShadowRejected: true,
      administratorShadowRejectedWithoutFallback: true,
      administratorMissingPackageRejectedWithoutFallback: true,
    },
    null,
    2,
  )}\n`
  await writeFile(path.join(validationRoot, 'evidence.json'), evidence)
  process.stdout.write(evidence)
} finally {
  if (!keepValidation) await rm(validationRoot, { recursive: true, force: true })
}
