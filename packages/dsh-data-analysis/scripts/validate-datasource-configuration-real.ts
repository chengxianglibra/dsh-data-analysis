/** Public Marivo configuration round-trip in an isolated Workspace. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MarivoDatasourceBridge } from '../src/datasource/bridge.ts'
import { bindMarivoEnvironment } from '../src/environment/index.ts'

const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('DSH_DATA_ANALYSIS_PYTHON required')
const root = await mkdtemp(path.join(tmpdir(), 'dsh-datasource-configuration-'))
try {
  const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python })
  const bridge = new MarivoDatasourceBridge(runner)
  const seed = await runner.runChecked({
    program: `import marivo.datasource as md
import marivo.semantic as ms
md.register(md.trino(name="warehouse",host="localhost",port=8080,catalog="old_catalog",schema="old_schema",user_env="CONFIG_USER",auth_env="CONFIG_AUTH",http_scheme="http",client_tags=("one","two"),extra={"client_info":"kept"},ai_context=ms.ai_context(business_definition="Keep this context",guardrails=["Read only"])))
`,
    limits: { timeoutMs: 30000, stdoutMaxBytes: 65536, stderrMaxBytes: 65536 },
  })
  assert.equal(seed.exitCode, 0, seed.stderr.toString())
  const schema = await bridge.authoring()
  assert.ok(schema.backends.some((item) => item.name === 'trino'))
  const original = await bridge.configuration('warehouse')
  assert.equal(original.fields.user_env, 'CONFIG_USER')
  assert.deepEqual(original.fields.client_tags, ['one', 'two'])
  assert.deepEqual(original.fields.extra, { client_info: 'kept' })
  const fields = {
    ...original.fields,
    host: '127.0.0.1',
    port: 9999,
    schema: null,
    client_tags: [],
    auth_env: 'CONFIG_NEW_AUTH',
  }
  assert.deepEqual(await bridge.update({ ...original, backend: 'duckdb', fields }), {
    error: 'datasource-identity-fixed',
  })
  assert.deepEqual(await bridge.update({ ...original, fields: { ...fields, name: 'renamed' } }), {
    error: 'datasource-identity-fixed',
  })
  assert.deepEqual(await bridge.update({ ...original, fields }), { name: 'warehouse' })
  const updated = await bridge.configuration('warehouse')
  assert.equal(updated.fields.host, '127.0.0.1')
  assert.equal(updated.fields.port, 9999)
  assert.equal(updated.fields.schema, undefined)
  assert.deepEqual(updated.fields.client_tags, [])
  assert.equal(updated.fields.auth_env, 'CONFIG_NEW_AUTH')
  assert.deepEqual(updated.fields.extra, { client_info: 'kept' })
  assert.notEqual(updated.version, original.version)
  assert.deepEqual(await bridge.update({ ...original, fields }), {
    error: 'datasource-config-changed',
  })
  const context = await runner.runChecked({
    program: `import json
import marivo.semantic as ms
context=ms.load().datasources.get("warehouse").details().context
print(json.dumps({"business_definition":context.business_definition,"guardrails":list(context.guardrails)}))
`,
    limits: { timeoutMs: 30000, stdoutMaxBytes: 65536, stderrMaxBytes: 65536 },
  })
  assert.equal(context.exitCode, 0, context.stderr.toString())
  assert.deepEqual(JSON.parse(context.stdout.toString()), {
    business_definition: 'Keep this context',
    guardrails: ['Read only'],
  })
  assert.deepEqual(
    await bridge.create({
      backend: 'duckdb',
      fields: { name: 'local', path: ':memory:', read_only: false },
    }),
    { name: 'local' },
  )
  const local = await bridge.configuration('local')
  assert.equal(local.fields.read_only, false)
  const tested = await bridge.test(await bridge.describe('local'), {})
  assert.equal(tested.ok, true)
  process.stdout.write(
    JSON.stringify({
      passed: true,
      runtime: runner.binding.marivoVersion,
      checks: [
        'create',
        'edit-roundtrip',
        'identity-fixed',
        'stale-edit',
        'ai-context',
        'extra',
        'credential-refs',
        'optional-clear',
        'number-boolean-json',
        'real-connection-test',
      ],
    }) + '\n',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
