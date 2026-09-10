import assert from 'node:assert/strict'
import test from 'node:test'
import { creationFieldValues } from '../../src/client/credentials/defaults.ts'
import { CredentialClientModel } from '../../src/client/credentials/model.ts'
import { errorMessage as readError, translator } from '../../src/client/i18n/copy.ts'
import type { DatasourceAuthoring } from '../../src/datasource/authoring.ts'
import { type DatasourceDefaults, withDatasourceDefaults } from '../../src/datasource/defaults.ts'
import { registerCredentialRpc } from '../../src/datasource/rpc.ts'
import { Config } from '../../src/plugin.ts'
import { createConnectionFixture } from '../semantic-reference-input/fixtures.ts'
import { fixture } from './fixtures.ts'

const schema: DatasourceAuthoring = {
  fingerprint: 'runtime-fingerprint',
  backends: ['trino', 'duckdb'].map((name) => ({
    name,
    fields: [
      { name: 'host', type: 'string', default: 'runtime-host' },
      { name: 'port', type: 'number', default: 8080 },
      { name: 'secure', type: 'boolean' },
      { name: 'extra', type: 'json' },
      { name: 'password_env', type: 'string' },
    ].map((field) => ({
      required: false,
      description: '',
      ...field,
    })) as DatasourceAuthoring['backends'][number]['fields'],
  })),
}

test('Harness configuration carries optional defaults and defers value validation without echoing secrets', () => {
  assert.equal(Config({}).datasourceDefaults, undefined)
  const defaults = { trino: { port: 0 } }
  assert.deepEqual(Config({ datasourceDefaults: defaults }).datasourceDefaults, defaults)
  assert.equal(
    Config({
      datasourceDefaults: 'private-canary' as unknown as NonNullable<Config['datasourceDefaults']>,
    }).datasourceDefaults,
    'private-canary',
  )
})

test('creation defaults are separate from the untouched Runtime schema and preserve typed falsy values', () => {
  const before = structuredClone(schema)
  assert.equal(withDatasourceDefaults(schema, undefined), schema)
  assert.deepEqual(creationFieldValues(schema, 'trino'), {})
  const configured = { trino: { host: '', port: 0, secure: false, extra: { tags: [null, true] } } }
  const result = withDatasourceDefaults(schema, configured)
  assert.deepEqual(schema, before)
  assert.equal(result.fingerprint, before.fingerprint)
  assert.deepEqual(result.backends, before.backends)
  assert.deepEqual(result.creationDefaults, configured)
  assert.deepEqual(creationFieldValues(result, 'trino'), {
    host: '',
    port: '0',
    secure: 'false',
    extra: '{"tags":[null,true]}',
  })
  assert.deepEqual(creationFieldValues(result, 'duckdb'), {})
})

test('invalid defaults fail without echoing any configured value', () => {
  const cases: [unknown, string][] = [
    [null, 'invalid'],
    [{ trino: [] }, 'invalid'],
    [{ privateCanary: { host: 'private-canary' } }, 'backend-invalid'],
    [{ trino: { privateCanary: 'private-canary' } }, 'field-invalid'],
    [{ trino: { port: 'private-canary' } }, 'type-invalid'],
    [{ trino: { host: null } }, 'type-invalid'],
    [{ trino: { secure: 0 } }, 'type-invalid'],
    [{ trino: { extra: { bad: Number.POSITIVE_INFINITY } } }, 'invalid'],
    [{ trino: { password_env: 'private-canary' } }, 'credential-forbidden'],
    [{ trino: { password: 'private-canary' } }, 'field-invalid'],
  ]
  for (const [value, suffix] of cases) {
    assert.throws(
      () => withDatasourceDefaults(schema, value),
      (error: Error) => {
        assert.equal(error.message, `datasource-defaults-${suffix}`)
        assert.doesNotMatch(String(error), /private-canary|privateCanary/)
        return true
      },
    )
  }
})

test('authoring RPC and client carry defaults without modifying creation payload or Runtime identity', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.bridge.authoring = async () => ({ ...schema, fingerprint: f.bridge.binding.fingerprint })
  let submitted: unknown
  f.bridge.create = async (input) => {
    submitted = input
    return { name: 'warehouse' }
  }
  const { connection, channels } = createConnectionFixture()
  t.after(registerCredentialRpc(connection, f.service, f.resolve, { trino: { port: 0 } }))
  const handler = channels.get('/dsh-data-analysis-credentials')!
  const model = new CredentialClientModel({
    call: async (_channel, endpoint, payload, signal) =>
      handler(endpoint, payload, signal ?? f.controller.signal),
  })
  t.after(() => model.dispose())
  const result = await model.authoring('workspace', f.controller.signal)
  assert.equal(result.fingerprint, f.bridge.binding.fingerprint)
  assert.deepEqual(result.creationDefaults, { trino: { port: 0 } })
  await model.createDatasource('workspace', result, {
    backend: 'trino',
    fields: { name: 'warehouse', port: 99 },
  })
  assert.deepEqual(submitted, { backend: 'trino', fields: { name: 'warehouse', port: 99 } })
})

test('invalid defaults produce actionable safe RPC and client errors', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.bridge.authoring = async () => schema
  const { connection, channels } = createConnectionFixture()
  t.after(
    registerCredentialRpc(connection, f.service, f.resolve, { trino: { port: 'private-canary' } }),
  )
  const handler = channels.get('/dsh-data-analysis-credentials')!
  const response = await handler('authoring', { workspaceId: 'workspace' }, f.controller.signal)
  assert.deepEqual(response, {
    ok: false,
    error: { code: 'internal', message: 'datasource-defaults-type-invalid', details: {} },
  })
  const model = new CredentialClientModel({ call: async () => response })
  t.after(() => model.dispose())
  await assert.rejects(model.authoring('workspace', f.controller.signal), (error: unknown) => {
    assert.match(
      `${error instanceof Error ? `${error.name}: ` : ''}${translator('zh-CN')(readError(error))}`,
      /字段值类型与当前 Runtime 不匹配/,
    )
    return true
  })
})

test('edit authoring ignores invalid creation defaults while create still fails explicitly', async (t) => {
  const invalid: DatasourceDefaults[] = [
    { unknown: { host: 'private-canary' } },
    { trino: { unknown: 'private-canary' } },
    { trino: { port: 'private-canary' } },
    { trino: { password_env: 'private-canary' } },
  ]
  for (const defaults of invalid) {
    const f = fixture()
    t.after(() => f.service.close())
    f.bridge.authoring = async () => schema
    const existing = {
      name: 'warehouse',
      backend: 'duckdb',
      fields: { host: 'saved' },
      version: 'v1',
    }
    f.bridge.configuration = async () => existing
    const { connection, channels } = createConnectionFixture()
    t.after(registerCredentialRpc(connection, f.service, f.resolve, defaults))
    const handler = channels.get('/dsh-data-analysis-credentials')!
    const model = new CredentialClientModel({
      call: async (_channel, endpoint, payload, signal) =>
        handler(endpoint, payload, signal ?? f.controller.signal),
    })
    t.after(() => model.dispose())
    const [editing, configuration] = await Promise.all([
      model.authoring('workspace', f.controller.signal, 'edit'),
      model.configuration('workspace', 'warehouse', f.controller.signal),
    ])
    assert.deepEqual(editing, { generation: f.service.generation, ...schema })
    assert.deepEqual(configuration, existing)
    assert.doesNotMatch(JSON.stringify(editing), /private-canary|creationDefaults/)
    await assert.rejects(model.authoring('workspace', f.controller.signal), (error: unknown) => {
      assert.match(
        `${error instanceof Error ? `${error.name}: ` : ''}${translator('zh-CN')(readError(error))}`,
        /datasourceDefaults/,
      )
      return true
    })
    const legacy = await handler('authoring', { workspaceId: 'workspace' }, f.controller.signal)
    assert.equal((legacy as { ok: boolean }).ok, false)
  }
})
