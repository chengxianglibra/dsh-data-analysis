import assert from 'node:assert/strict'
import test from 'node:test'
import type { DatasourceAuthoring } from '../../src/datasource/authoring.ts'
import { withDatasourceDefaults } from '../../src/datasource/defaults.ts'

const schema: DatasourceAuthoring = {
  fingerprint: 'runtime-fingerprint',
  backends: ['trino', 'duckdb'].map((name) => ({
    name,
    fields: [
      { name: 'host', type: 'string', default: 'runtime-host' },
      { name: 'port', type: 'number', default: 8080 },
      { name: 'secure', type: 'boolean' },
      { name: 'extra', type: 'json' },
      { name: 'password', type: 'credential' },
    ].map((field) => ({
      required: false,
      description: '',
      ...field,
    })) as DatasourceAuthoring['backends'][number]['fields'],
  })),
}

test('creation defaults are separate from the untouched Runtime schema and preserve typed falsy values', () => {
  const before = structuredClone(schema)
  assert.equal(withDatasourceDefaults(schema, undefined), schema)
  const configured = { trino: { host: '', port: 0, secure: false, extra: { tags: [null, true] } } }
  const result = withDatasourceDefaults(schema, configured)
  assert.deepEqual(schema, before)
  assert.equal(result.fingerprint, before.fingerprint)
  assert.deepEqual(result.backends, before.backends)
  assert.deepEqual(result.creationDefaults, configured)
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
    [{ trino: { password: 'private-canary' } }, 'credential-forbidden'],
    [{ trino: { password_env: 'private-canary' } }, 'field-invalid'],
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

test('managed reference defaults use live fields and cannot enter ordinary config', () => {
  const view = withDatasourceDefaults(
    schema,
    { trino: { host: 'host' } },
    {
      trino: { password: 'WAREHOUSE_PASSWORD' },
    },
  )
  assert.deepEqual(view.creationDefaults?.trino, {
    host: 'host',
    password: 'WAREHOUSE_PASSWORD',
  })
  assert.throws(() => withDatasourceDefaults(schema, {}, { trino: { password: 'DSH_HOME' } }))
  assert.throws(() =>
    withDatasourceDefaults(schema, {}, { trino: { missing_env: 'WAREHOUSE_PASSWORD' } }),
  )
  assert.throws(() => withDatasourceDefaults(schema, { trino: { password: 'WAREHOUSE_PASSWORD' } }))
})
