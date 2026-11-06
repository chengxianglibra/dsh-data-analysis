import assert from 'node:assert/strict'
import test from 'node:test'
import { datasourceDescription } from '../../src/client/credentials/descriptions.ts'
import {
  groupDatasourceFields,
  hasUnsupportedAutocommit,
  isRestrictedAutocommit,
} from '../../src/client/credentials/field-presentation.ts'
import { translator } from '../../src/client/i18n/copy.ts'

const field = (
  name: string,
  type: 'string' | 'boolean' | 'credential' | 'secrets' | 'json' = 'string',
  required = false,
) => ({ name, type, required, description: '' })

test('live datasource fields are presented by importance without dropping unknown fields', () => {
  const fields = [
    field('name', 'string', true),
    field('extra', 'json'),
    field('wall_clock_timezone'),
    field('host', 'string', true),
    field('future_required', 'string', true),
    field('future_optional'),
    field('port'),
    field('user', 'credential', true),
    field('secrets', 'secrets'),
  ]
  const result = groupDatasourceFields(fields, 'duckdb')
  assert.deepEqual(
    result.basic.map(({ name }) => name),
    ['name', 'host', 'future_required', 'port', 'wall_clock_timezone'],
  )
  assert.deepEqual(
    result.advanced.map(({ name }) => name),
    ['extra', 'future_optional'],
  )
  assert.deepEqual(
    result.credential.map(({ name }) => name),
    ['user'],
  )
  assert.deepEqual(
    result.secrets.map(({ name }) => name),
    ['secrets'],
  )
  assert.equal(fields[1]!.name, 'extra', 'Runtime field order is not mutated')
})

test('DuckDB read_only is hidden without hiding other backends or unknown fields', () => {
  const fields = [field('read_only', 'boolean'), field('future_optional')]
  assert.deepEqual(
    groupDatasourceFields(fields, 'duckdb').advanced.map(({ name }) => name),
    ['future_optional'],
  )
  assert.deepEqual(
    groupDatasourceFields(fields, 'other').advanced.map(({ name }) => name),
    ['read_only', 'future_optional'],
  )
})

test('only MySQL and Postgres boolean autocommit reject a previously selected false', () => {
  const auto = field('autocommit', 'boolean')
  for (const backend of ['mysql', 'postgres']) {
    assert.equal(isRestrictedAutocommit(backend, auto), true)
    assert.equal(hasUnsupportedAutocommit(backend, [auto], { autocommit: 'false' }), true)
    for (const value of ['', 'true', undefined])
      assert.equal(hasUnsupportedAutocommit(backend, [auto], { autocommit: value }), false)
  }
  assert.equal(hasUnsupportedAutocommit('duckdb', [auto], { autocommit: 'false' }), false)
  assert.equal(
    hasUnsupportedAutocommit('mysql', [field('autocommit')], { autocommit: 'false' }),
    false,
  )
  assert.equal(hasUnsupportedAutocommit('mysql', [], { autocommit: 'false' }), false)
})

test('0.6.2 datasource descriptions translate by exact match and unknown descriptions remain intact', () => {
  assert.equal(
    datasourceDescription('Global datasource name; must match [a-z][a-z0-9_]*.'),
    'marivo.credentials.datasource-name-rule',
  )
  assert.equal(
    datasourceDescription('DuckDB database path or :memory:.'),
    'marivo.credentials.duckdb-path-current',
  )
  assert.equal(
    datasourceDescription('Use True or omit this option to use autocommit.'),
    'marivo.credentials.autocommit-current',
  )
  assert.equal(datasourceDescription('New Runtime description.'), 'New Runtime description.')
  const nameDescription = datasourceDescription(
    'Global datasource name; must match [a-z][a-z0-9_]*.',
  )
  assert.match(translator('zh-CN')(nameDescription), /小写字母/)
  assert.match(translator('en-US')(nameDescription), /lowercase/)
})
