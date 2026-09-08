/** Actual Harness and Marivo report updates with a deterministic model boundary. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { validatePresentationHost } from './presentation-s4/host.ts'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'

const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    resolveDshHome(),
    'dsh-data-analysis/runtimes/marivo',
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )
const outputRoot = await realpath(
  await mkdtemp(path.join(tmpdir(), 'dsh-presentation-report-update-')),
)
const workspaceRoot = path.join(outputRoot, 'workspace')
await mkdir(workspaceRoot)
process.stdout.write(`Isolated report update validation: ${outputRoot}\n`)
const inputs = await preparePresentationInputs(workspaceRoot, pythonExecutable)
await writeFile(
  path.join(outputRoot, 'runtime-inputs.json'),
  JSON.stringify({ ...inputs, workspaceRoot }, null, 2),
  { mode: 0o600 },
)
const host = await validatePresentationHost(
  workspaceRoot,
  outputRoot,
  pythonExecutable,
  inputs.draftPaths,
  { updateExistingReport: true },
)
assert.equal(host.status, 'passed')
assert.deepEqual(
  host.modes.map((mode) => mode.mode),
  ['native', 'both', 'code'],
)
assert.ok(host.modes.every((mode) => mode.reportUpdate))
const evidencePath = path.join(outputRoot, 'report-update-evidence.json')
await writeFile(evidencePath, JSON.stringify(host, null, 2), { mode: 0o600 })
process.stdout.write(
  `Passed Native/both/Code same-Report updates, durable receipts, current pointers and immutable history. Evidence: ${evidencePath}\n`,
)
