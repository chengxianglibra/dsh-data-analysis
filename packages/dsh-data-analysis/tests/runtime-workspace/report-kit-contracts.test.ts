import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python', 'report-kit')
const script = path.join(projectRoot, 'scripts', 'emit_contract_fixtures.py')
const contractRoot = path.join(packageRoot, 'report-contracts')

async function contract(name: string): Promise<AnySchema> {
  return JSON.parse(await readFile(path.join(contractRoot, name), 'utf8')) as AnySchema
}

function payload(registration: string, registry: 'ReportData' | 'ReportTrace'): unknown {
  const prefix = `${registry}.register(`
  assert.ok(registration.startsWith(prefix))
  assert.ok(registration.endsWith(');\n'))
  const argumentsText = registration.slice(prefix.length, -3)
  const separator = argumentsText.indexOf(', ')
  assert.ok(separator > 0)
  return JSON.parse(argumentsText.slice(separator + 2))
}

function isRfc3339(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

test('Python Marivo emitters satisfy the checked-in projection schemas', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-report-kit-contracts-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))
  const result = spawnSync(
    'uv',
    ['run', '--project', projectRoot, '--frozen', 'python', script, outputRoot],
    { cwd: packageRoot, encoding: 'utf8', timeout: 120_000 },
  )
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, result.stderr)

  const artifact = payload(
    await readFile(path.join(outputRoot, 'artifact.js'), 'utf8'),
    'ReportData',
  ) as Record<string, any>
  const trace = payload(await readFile(path.join(outputRoot, 'trace.js'), 'utf8'), 'ReportTrace')
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
  ajv.addFormat('date-time', { type: 'string', validate: isRfc3339 })
  ajv.addSchema(await contract('common-v1.schema.json'))
  ajv.addSchema(await contract('revalidation-v1.schema.json'))
  const validateArtifact = ajv.compile(await contract('dataset-v1.schema.json'))
  const validateTrace = ajv.compile(await contract('session-trace-v1.schema.json'))
  assert.equal(validateArtifact(artifact), true, JSON.stringify(validateArtifact.errors))
  assert.equal(validateTrace(trace), true, JSON.stringify(validateTrace.errors))
})
