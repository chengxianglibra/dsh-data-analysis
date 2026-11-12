import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertFileReportProject,
  captureFileReportProject,
} from '../../scripts/file-analysis-real/report-project.ts'
import { MARIVO_VERSION } from '../../src/compatibility.ts'
import type { DoctorReport } from '../../src/environment/types.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'

type Options = Parameters<typeof assertFileReportProject>[0]
const manifest = '[project]\nname = "file-report-test"\n'
function document(root: string): Options['document'] {
  return {
    workspaceId: 'workspace',
    resources: {
      summary: {
        kind: 'snapshot',
        declaration: {
          kind: 'dataframe',
          ref: {
            schema: 'marivo.dataframe_ref/v2',
            project_root: root,
            result_id: `df_${'a'.repeat(32)}`,
          },
        },
        snapshot: datasetSnapshot(),
        binding: { workspaceId: 'workspace' },
      },
    },
  }
}
async function fixture(t: { after(fn: () => Promise<void>): void }, initialized = true) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'file-report-project-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const python = path.join(root, 'fixture-python')
  if (initialized) await writeFile(path.join(root, 'marivo.toml'), manifest)
  const report: DoctorReport = {
    status: 'ok',
    project_root: root,
    python_executable: python,
    marivo: { version: '0.6.4', package_path: '/runtime/marivo/__init__.py' },
    sections: [
      {
        id: 'installation',
        status: 'ok',
        checks: [
          { id: 'installation.python', status: 'ok', summary: 'selected Python' },
          { id: 'installation.marivo', status: 'ok', summary: 'selected Marivo' },
        ],
      },
      {
        id: 'project',
        status: 'ok',
        checks: [
          {
            id: 'project.marivo_toml',
            status: 'ok',
            summary: 'valid manifest',
            details: { path: path.join(root, 'marivo.toml') },
          },
        ],
      },
    ],
  }
  const saveDoctor = () => writeFile(path.join(root, 'doctor.json'), JSON.stringify(report))
  await saveDoctor()
  await writeFile(
    python,
    `#!/usr/bin/env node
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['-I', '-m', 'marivo', 'doctor', '--project-root', process.cwd(), '--format', 'json']);
process.stdout.write(require('node:fs').readFileSync('doctor.json'));
`,
  )
  await chmod(python, 0o755)
  const options: Options = {
    workspaceRoot: root,
    workspaceId: 'workspace',
    sessionCwd: root,
    pythonExecutable: python,
    before: await captureFileReportProject(root),
    receipt: { workspaceId: 'workspace' },
    document: document(root),
  }
  return { root, options, report, saveDoctor }
}

test('first file report accepts init scaffolding without authored models', async (t) => {
  const f = await fixture(t, false)
  await writeFile(path.join(f.root, 'marivo.toml'), manifest)
  await mkdir(path.join(f.root, 'models'))
  const result = await assertFileReportProject(f.options)
  assert.equal(result.initialization, 'initialized-for-report')
  assert.deepEqual(result.authoredFiles, [])
})

test('an already valid project needs neither another init nor a models directory', async (t) => {
  const f = await fixture(t)
  const result = await assertFileReportProject(f.options)
  assert.equal(result.initialization, 'already-initialized')
  assert.equal(await readFile(path.join(f.root, 'marivo.toml'), 'utf8'), manifest)
})

test('existing authored content is preserved while import caches may appear', async (t) => {
  const f = await fixture(t)
  await mkdir(path.join(f.root, 'models', 'semantic'), { recursive: true })
  await writeFile(path.join(f.root, 'models', 'semantic', 'existing.py'), '# user model\n')
  f.options.before = await captureFileReportProject(f.root)
  await mkdir(path.join(f.root, 'models', 'semantic', '__pycache__'))
  await writeFile(path.join(f.root, 'models', 'semantic', '__pycache__', 'existing.pyc'), 'cache')
  assert.equal((await assertFileReportProject(f.options)).authoredFiles.length, 1)
})

for (const mutation of ['added', 'changed', 'deleted'] as const)
  test(`ordinary file analysis rejects ${mutation} authored model files`, async (t) => {
    const f = await fixture(t)
    await mkdir(path.join(f.root, 'models'))
    const filename = path.join(f.root, 'models', 'existing.py')
    await writeFile(filename, '# original\n')
    f.options.before = await captureFileReportProject(f.root)
    if (mutation === 'added')
      await writeFile(path.join(f.root, 'models', 'new.py'), '# unauthorized model\n')
    if (mutation === 'changed') await writeFile(filename, '# replaced\n')
    if (mutation === 'deleted') await rm(filename)
    await assert.rejects(
      assertFileReportProject(f.options),
      /must not author or replace semantic models/,
    )
  })

for (const mutation of ['receipt', 'document', 'resource', 'reference', 'session'] as const)
  test(`report project guard rejects foreign ${mutation} identity`, async (t) => {
    const f = await fixture(t)
    const resource = f.options.document.resources.summary!
    assert.equal(resource.kind, 'snapshot')
    if (mutation === 'receipt') f.options.receipt.workspaceId = 'other'
    if (mutation === 'document') f.options.document.workspaceId = 'other'
    if (mutation === 'resource') resource.binding.workspaceId = 'other'
    if (mutation === 'reference') {
      assert.equal(resource.declaration.kind, 'dataframe')
      resource.declaration.ref.project_root = path.dirname(f.root)
    }
    if (mutation === 'session') f.options.sessionCwd = path.dirname(f.root)
    await assert.rejects(assertFileReportProject(f.options), /Workspace|workspace/)
  })

for (const mutation of ['missing', 'invalid', 'overwritten', 'ancestor', 'runtime'] as const)
  test(`report project guard rejects ${mutation} manifest or Runtime facts`, async (t) => {
    const f = await fixture(t)
    if (mutation === 'missing') {
      await rm(path.join(f.root, 'marivo.toml'))
      f.report.sections[1]!.checks[0]!.status = 'info'
    }
    if (mutation === 'invalid') f.report.sections[1]!.checks[0]!.status = 'fail'
    if (mutation === 'overwritten')
      await writeFile(path.join(f.root, 'marivo.toml'), '[project]\nname="replaced"\n')
    if (mutation === 'ancestor') f.report.project_root = path.dirname(f.root)
    if (mutation === 'runtime') f.report.python_executable = '/another/python'
    await f.saveDoctor()
    await assert.rejects(assertFileReportProject(f.options))
  })

const realPython = process.env.DSH_DATA_ANALYSIS_PYTHON
for (const initialized of [false, true])
  test(`selected real Runtime verifies file-report project postconditions (preinitialized=${initialized})`, {
    skip: !realPython && 'Set DSH_DATA_ANALYSIS_PYTHON to the exact supported Runtime',
  }, async (t) => {
    const f = await fixture(t, initialized)
    f.options.pythonExecutable = realPython!
    const env = { ...process.env, MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' }
    if (!initialized)
      execFileSync(realPython!, ['-I', '-m', 'marivo', 'init', '--project-root', f.root], {
        env,
        stdio: 'pipe',
      })
    const ref = JSON.parse(
      execFileSync(
        realPython!,
        [
          '-I',
          '-c',
          'import json,marivo.analysis as mv,pandas as pd; print(json.dumps(mv.persist_dataframe(pd.DataFrame({"rows":[3],"total":[71]})).to_dict()))',
        ],
        { cwd: f.root, env, encoding: 'utf8' },
      ),
    )
    const resource = f.options.document.resources.summary!
    assert.equal(resource.kind, 'snapshot')
    assert.equal(resource.declaration.kind, 'dataframe')
    resource.declaration.ref = ref
    const proof = await assertFileReportProject(f.options)
    assert.equal(proof.marivo.version, MARIVO_VERSION)
    assert.equal(proof.projectRoot, f.root)
    assert.equal(
      proof.initialization,
      initialized ? 'already-initialized' : 'initialized-for-report',
    )
    assert.deepEqual(proof.authoredFiles, [])
  })
