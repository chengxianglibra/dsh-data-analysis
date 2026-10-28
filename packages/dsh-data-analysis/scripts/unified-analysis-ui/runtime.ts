/** P0 probe: use the selected installed package, with no source-path fallback. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'

const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
assert.ok(pythonExecutable, 'Set DSH_DATA_ANALYSIS_PYTHON to the selected installed Runtime')
const root = await mkdtemp(path.join(tmpdir(), 'dsh-unified-ui-p0-'))
const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable })
async function run(name: string, args: string[] = []) {
  const result = await runner.runChecked({
    program: await readFile(new URL(name, import.meta.url), 'utf8'),
    args,
    environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString())
  return JSON.parse(result.stdout.toString())
}
const generated = await run('runtime-generate.py')
const restored = await run('runtime-read.py', [JSON.stringify(generated.frame)])
assert.notEqual(restored.pid, generated.pid)
assert.deepEqual(restored.rows, [
  ['A', '12345678901234.5678', '9007199254740993'],
  ['B', null, null],
])
assert.deepEqual(
  restored.pages.map((p: { count: number }) => p.count),
  [1, 1],
)
assert.equal(restored.pages[0].hasMore, true)
assert.equal(restored.pages[1].hasMore, false)
assert.equal(restored.pages[0].total, 2)
assert.equal(restored.axes[0].keys.length, 1)
assert.deepEqual(generated.sql.rows, [
  { region: 'A', amount: '12345678901234.5678', account: '9007199254740993' },
  { region: 'B', amount: null, account: null },
])
assert.equal(generated.sql.returned_row_count, 2)
assert.ok(generated.sql.datasource.includes('datasource:warehouse'))
const wheel = process.env.DSH_DATA_ANALYSIS_MARIVO_WHEEL
const evidence = {
  status: 'passed',
  binding: runner.binding,
  wheel: wheel
    ? {
        path: path.resolve(wheel),
        sha256: createHash('sha256')
          .update(await readFile(wheel))
          .digest('hex'),
      }
    : null,
  generated,
  restored,
  boundary:
    'Real installed Runtime; separate processes; source database removed before schema/page reads. No Dataset capture or UI delivery implemented by this probe.',
}
const evidencePath = path.join(root, 'runtime-evidence.json')
await writeFile(evidencePath, JSON.stringify(evidence, null, 2))
console.log(
  JSON.stringify({ status: evidence.status, evidencePath, package: generated.package }, null, 2),
)
