/** Postconditions for file reports, allowing on-demand project scaffolding. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  admitDoctorReport,
  FixedSubprocessPolicy,
  parseDoctorReport,
} from '../../src/environment/index.ts'
import type { AnalysisDocument } from '../../src/presentation/contracts/analysis-document.ts'
import type { PresentationReceipt } from '../../src/presentation/contracts/index.ts'

export async function captureFileReportProject(workspaceRoot: string) {
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
  const manifest = await readFile(path.join(workspaceRoot, 'marivo.toml')).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    },
  )
  const authoredFiles: Array<{ path: string; sha256: string }> = []
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      },
    )
    for (const entry of entries) {
      const filename = path.join(directory, entry.name)
      // Import caches are not authored definitions and may appear during doctor reads.
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__') await walk(filename)
      } else {
        const value = entry.isSymbolicLink() ? await readlink(filename) : await readFile(filename)
        authoredFiles.push({ path: path.relative(workspaceRoot, filename), sha256: digest(value) })
      }
    }
  }
  await walk(path.join(workspaceRoot, 'models'))
  authoredFiles.sort((left, right) => left.path.localeCompare(right.path))
  return { manifestSha256: manifest === undefined ? null : digest(manifest), authoredFiles }
}

export async function assertFileReportProject(options: {
  workspaceRoot: string
  workspaceId: string
  sessionCwd: string
  pythonExecutable: string
  before: Awaited<ReturnType<typeof captureFileReportProject>>
  receipt: Pick<PresentationReceipt, 'workspaceId'>
  document: Pick<AnalysisDocument, 'workspaceId' | 'resources'>
}) {
  const root = await realpath(options.workspaceRoot)
  assert.equal(await realpath(options.sessionCwd), root, 'Session must retain its bound Workspace')
  assert.equal(
    options.receipt.workspaceId,
    options.workspaceId,
    'Report receipt Workspace identity',
  )
  assert.equal(options.document.workspaceId, options.workspaceId, 'Saved report Workspace identity')
  for (const resource of Object.values(options.document.resources)) {
    if (resource.kind !== 'snapshot') continue
    assert.equal(resource.binding.workspaceId, options.workspaceId, 'Resource Workspace identity')
    assert.equal(
      resource.declaration.kind,
      'dataframe',
      'File report must use persisted DataFrames',
    )
    if (resource.declaration.kind === 'dataframe')
      assert.equal(
        await realpath(resource.declaration.ref.project_root),
        root,
        'File result must be persisted in the bound Workspace, not an ancestor or another project',
      )
  }
  const result = await new FixedSubprocessPolicy(root).run({
    executable: options.pythonExecutable,
    args: ['-I', '-m', 'marivo', 'doctor', '--project-root', root, '--format', 'json'],
    environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
    limits: { timeoutMs: 30_000, stdoutMaxBytes: 1_048_576, stderrMaxBytes: 65_536 },
  })
  const doctor = parseDoctorReport(result.stdout)
  admitDoctorReport(doctor, root, options.pythonExecutable)
  const manifest = doctor.sections
    .flatMap((section) => section.checks)
    .find((check) => check.id === 'project.marivo_toml')
  assert.equal(manifest?.status, 'ok', 'A completed file report requires a valid local manifest')
  assert.equal(
    manifest?.details?.path,
    path.join(root, 'marivo.toml'),
    'Manifest must belong to the Workspace root',
  )
  const after = await captureFileReportProject(root)
  assert.notEqual(
    after.manifestSha256,
    null,
    'File report must initialize its Workspace before persistence',
  )
  if (options.before.manifestSha256 !== null)
    assert.equal(
      after.manifestSha256,
      options.before.manifestSha256,
      'Existing manifest must not be overwritten',
    )
  assert.deepEqual(
    after.authoredFiles,
    options.before.authoredFiles,
    'File analysis must not author or replace semantic models',
  )
  return {
    projectRoot: root,
    workspaceId: options.workspaceId,
    initialization:
      options.before.manifestSha256 === null ? 'initialized-for-report' : 'already-initialized',
    manifestSha256: after.manifestSha256,
    authoredFiles: after.authoredFiles,
    pythonExecutable: doctor.python_executable,
    marivo: doctor.marivo,
  }
}
