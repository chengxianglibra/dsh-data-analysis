import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseTypedDataset } from '../../src/presentation/contracts/index.ts'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python', 'presentation')

function run(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.error !== undefined) throw result.error
  assert.equal(
    result.status,
    0,
    `${executable} exited with status ${result.status} (signal: ${result.signal ?? 'none'})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  return result.stdout
}

function python(args: string[]): string {
  return run('uv', ['run', '--project', projectRoot, '--frozen', 'python', ...args])
}

test('Private Python projection passes its numerical, temporal, missing-value and budget contracts', () => {
  python(['-m', 'pytest', path.join(projectRoot, 'tests'), '-q'])
})

test('Python projection output satisfies the shared Node typed-data contract', async (t) => {
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
