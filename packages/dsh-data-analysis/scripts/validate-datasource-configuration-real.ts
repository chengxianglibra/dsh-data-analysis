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
md.register(md.trino(name="warehouse",host="localhost",port=8080,catalog="old_catalog",schema="old_schema",user=md.env("CONFIG_USER"),auth=md.env("CONFIG_AUTH"),http_scheme="http",client_tags=("one","two"),extra={"client_info":"kept"},ai_context=ms.ai_context(business_definition="Keep this context",guardrails=["Read only"],aliases=["warehouse alias"])))
`,
    limits: { timeoutMs: 30000, stdoutMaxBytes: 65536, stderrMaxBytes: 65536 },
  })
  assert.equal(seed.exitCode, 0, seed.stderr.toString())
  const schema = await bridge.authoring()
  assert.ok(schema.backends.some((item) => item.name === 'trino'))
  const original = await bridge.configuration('warehouse')
  assert.equal(original.fields.user, 'CONFIG_USER')
  assert.deepEqual(original.fields.client_tags, ['one', 'two'])
  assert.deepEqual(original.fields.extra, { client_info: 'kept' })
  const fields = {
    ...original.fields,
    host: '127.0.0.1',
    port: 9999,
    schema: null,
    client_tags: [],
    auth: 'CONFIG_NEW_AUTH',
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
  assert.equal(updated.fields.auth, 'CONFIG_NEW_AUTH')
  assert.deepEqual(updated.fields.extra, { client_info: 'kept' })
  assert.notEqual(updated.version, original.version)
  assert.deepEqual(await bridge.update({ ...original, fields }), {
    error: 'datasource-config-changed',
  })
  const context = await runner.runChecked({
    program: `import json
import marivo.semantic as ms
context=ms.load().get("datasource:warehouse").definition.context
print(json.dumps({"business_definition":context.business_definition,"guardrails":list(context.guardrails),"aliases":list(context.aliases)}))
`,
    limits: { timeoutMs: 30000, stdoutMaxBytes: 65536, stderrMaxBytes: 65536 },
  })
  assert.equal(context.exitCode, 0, context.stderr.toString())
  assert.deepEqual(JSON.parse(context.stdout.toString()), {
    business_definition: 'Keep this context',
    guardrails: ['Read only'],
    aliases: ['warehouse alias'],
  })
  assert.deepEqual(
    await bridge.create({
      backend: 'duckdb',
      fields: { name: 'local', path: ':memory:', read_only: false },
    }),
    { name: 'local' },
  )
  const scoped = [
    {
      type: 's3',
      scope: 's3://example/',
      region: 'us-east-1',
      key_id: 'S3_KEY',
      secret: 'S3_SECRET',
      session_token: 'S3_TOKEN',
      endpoint: 's3.example.com',
      url_style: 'path',
      use_ssl: true,
    },
    { type: 'http_bearer', scope: 'https://api.example/', token: 'API_TOKEN' },
    {
      type: 'http_headers',
      scope: 'https://headers.example/',
      headers: { 'X-Api-Key': 'HEADER_KEY' },
    },
  ]
  assert.deepEqual(
    await bridge.create({ backend: 'duckdb', fields: { name: 'scoped', secrets: scoped } }),
    { name: 'scoped' },
  )
  const storedScoped = await bridge.configuration('scoped')
  assert.deepEqual(storedScoped.fields.secrets, [scoped[1], scoped[2], scoped[0]])
  const changedScoped = [{ ...scoped[1], token: 'NEW_API_TOKEN' }, scoped[2], scoped[0]]
  assert.deepEqual(
    await bridge.update({
      ...storedScoped,
      fields: { ...storedScoped.fields, secrets: changedScoped },
    }),
    { name: 'scoped' },
  )
  assert.deepEqual((await bridge.configuration('scoped')).fields.secrets, changedScoped)
  assert.deepEqual(
    await bridge.create({
      backend: 'duckdb',
      fields: { name: 'invalid', secrets: [{ ...scoped[1], token: 'MARIVO_SECRET' }] },
    }),
    { error: 'datasource-credential-ref-invalid' },
  )
  const local = await bridge.configuration('local')
  assert.equal(local.fields.read_only, false)
  const tested = await bridge.test(await bridge.describe('local'), {})
  assert.equal(tested.ok, true)
  const staleDescription = await bridge.describe('warehouse')
  await bridge.update({ ...updated, fields: { ...updated.fields, port: 9998 } })
  assert.deepEqual(await bridge.remove(staleDescription), { error: 'context-changed' })
  assert.deepEqual(await bridge.remove(await bridge.describe('local')), { name: 'local' })
  assert(!(await bridge.inventory()).some((item) => item.name === 'local'))
  assert((await bridge.inventory()).some((item) => item.name === 'warehouse'))
  assert.equal(
    (await bridge.remove(await bridge.describe('default'))).error,
    'datasource-remove-failed',
  )
  process.stdout.write(
    JSON.stringify({
      passed: true,
      runtime: runner.binding.marivoVersion,
      checks: [
        'create',
        'remove-local-definition',
        'reject-stale-removal',
        'preserve-default',
        'edit-roundtrip',
        'identity-fixed',
        'stale-edit',
        'ai-context',
        'extra',
        'credential-refs',
        'scoped-secret-roundtrip-and-ref-validation',
        'optional-clear',
        'number-boolean-json',
        'real-connection-test',
      ],
    }) + '\n',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
