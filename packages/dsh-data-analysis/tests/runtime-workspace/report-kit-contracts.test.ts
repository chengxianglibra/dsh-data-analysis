import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateReportContract } from '../../src/report-check/contracts.ts'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python', 'report-kit')
const script = path.join(projectRoot, 'scripts', 'emit_contract_fixtures.py')

function payload(registration: string, registry: 'ReportData' | 'ReportTrace'): unknown {
  const prefix = `${registry}.register(`
  assert.ok(registration.startsWith(prefix))
  assert.ok(registration.endsWith(');\n'))
  const argumentsText = registration.slice(prefix.length, -3)
  const separator = argumentsText.indexOf(', ')
  assert.ok(separator > 0)
  return JSON.parse(argumentsText.slice(separator + 2))
}

test('Python emitters satisfy the checked-in Slice 1 structural and semantic contracts', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-report-kit-contracts-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))
  const result = spawnSync(
    'uv',
    ['run', '--project', projectRoot, '--frozen', 'python', script, outputRoot],
    { cwd: packageRoot, encoding: 'utf8', timeout: 120_000 },
  )
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, result.stderr)

  const dataset = payload(
    await readFile(path.join(outputRoot, 'computed.js'), 'utf8'),
    'ReportData',
  )
  const artifact = payload(
    await readFile(path.join(outputRoot, 'artifact.js'), 'utf8'),
    'ReportData',
  ) as Record<string, any>
  const trace = payload(await readFile(path.join(outputRoot, 'trace.js'), 'utf8'), 'ReportTrace')
  assert.deepEqual(validateReportContract('dataset', dataset), {
    valid: true,
    errors: [],
    schemaErrors: [],
    semanticErrors: [],
  })
  assert.deepEqual(validateReportContract('trace', trace), {
    valid: true,
    errors: [],
    schemaErrors: [],
    semanticErrors: [],
  })
  assert.deepEqual(validateReportContract('dataset', artifact), {
    valid: true,
    errors: [],
    schemaErrors: [],
    semanticErrors: [],
  })
  assert.deepEqual(validateReportContract('revalidation', artifact.source.revalidation), {
    valid: true,
    errors: [],
    schemaErrors: [],
    semanticErrors: [],
  })
})
