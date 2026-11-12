import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { MARIVO_VERSION } from '../src/compatibility.ts'
import {
  ensureSharedMarivoRuntime,
  MarivoEnvironmentError,
  MarivoWorkspaceEnvironmentManager,
} from '../src/environment/index.ts'
import { resultReference } from '../src/presentation/contracts/result-reference.ts'
import { readMarivoResult } from '../src/presentation/result-reader.ts'

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
  assert.equal(marker.schema, 'dsh-data-analysis-runtime/v5')
  assert.equal(runtime.marivoVersion, MARIVO_VERSION)
  const administrator = await ensureSharedMarivoRuntime({
    runtimeRoot: path.join(validationRoot, 'administrator-runtime'),
    pythonExecutable: runtime.pythonExecutable,
    bootstrapPythonExecutable: path.join(validationRoot, 'must-not-run-bootstrap-python'),
  })
  assert.equal(administrator.pythonExecutable, runtime.pythonExecutable)
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
  const checkedWrite = await first.runChecked({
    program: String.raw`
from decimal import Decimal
from pathlib import Path
import sys
import pandas as pd
import json
import marivo.analysis as mv
frame = pd.DataFrame({
    "count": pd.Series([9007199254740993, None], dtype="Int64"),
    "amount": [Decimal("12345678901234.5678"), Decimal("0.1000")],
})
print(json.dumps(mv.persist_dataframe(frame).to_dict()))
`,
  })
  assert.equal(checkedWrite.exitCode, 0, checkedWrite.stderr.toString('utf8'))
  const computed = (
    await readMarivoResult(
      first,
      resultReference.parse(JSON.parse(checkedWrite.stdout.toString())),
      new AbortController().signal,
    )
  ).data
  assert.deepEqual(
    computed.columns.map(({ id }) => id),
    ['count', 'amount'],
  )
  assert.deepEqual(computed.rows, [
    ['9007199254740993', '12345678901234.5678'],
    [null, '0.1000'],
  ])

  const shadowRoot = path.join(firstWorkspace, 'marivo')
  await mkdir(shadowRoot)
  await writeFile(path.join(shadowRoot, '__init__.py'), '__version__ = "0.6.6"\n')
  const freshManager = new MarivoWorkspaceEnvironmentManager(runtime)
  try {
    await assert.rejects(freshManager.resolve(firstWorkspace), {
      code: 'binding-identity-mismatch',
    })
    await writeFile(path.join(secondWorkspace, 'marivo.toml'), '[project\n')
    await assert.rejects(freshManager.resolve(secondWorkspace), {
      code: 'project-manifest-invalid',
    })
    await writeFile(path.join(secondWorkspace, 'marivo.toml'), '[project]\nname = "repaired"\n')
    const repaired = await freshManager.resolve(secondWorkspace)
    assert.equal(repaired.binding.fingerprint, second.binding.fingerprint)
  } finally {
    await freshManager.close()
  }
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
      error instanceof MarivoEnvironmentError &&
      ['shared-runtime-identity-mismatch', 'shared-runtime-package-unavailable'].includes(
        error.code,
      ),
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
      initialBindingShadowRejected: true,
      invalidWorkspaceManifestRejectedAndRetried: true,
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
