import assert from 'node:assert/strict'
import test from 'node:test'
import {
  credentialReference,
  prepareCredentials,
} from '../../src/client/credentials/credential-draft.ts'
import { errorMessage as readError, translator } from '../../src/client/i18n/copy.ts'
import { marivoCredentialStorageRef } from '../../src/datasource/shell-env.ts'

test('inline credentials produce valid distinct references without including values in configuration', () => {
  const drafts = [
    { id: crypto.randomUUID(), field: 'user_env', value: 'user-canary' },
    { id: crypto.randomUUID(), field: 'password_env', value: 'password-canary' },
    { id: crypto.randomUUID(), field: 'http_headers_env', key: 'X-Auth', value: 'header-canary' },
  ]
  const { fields, changes } = prepareCredentials('中文/my-db', drafts)
  assert.equal(Object.keys(changes).length, 3)
  for (const row of drafts) {
    const ref = credentialReference('中文/my-db', row)
    assert.ok(marivoCredentialStorageRef(ref))
    assert.equal(changes[ref], row.value)
  }
  assert.doesNotMatch(JSON.stringify(fields), /canary/)
})

test('blank edits preserve references; replacements use new references unless explicitly changed', () => {
  const row = {
    id: crypto.randomUUID(),
    field: 'password_env',
    existing: 'SHARED_PASSWORD',
    value: '',
  }
  assert.equal(prepareCredentials('db', [row]).fields.password_env, 'SHARED_PASSWORD')
  assert.deepEqual(Object.keys(prepareCredentials('db', [row]).changes), [])
  const replacement = { ...row, value: 'new-canary' }
  assert.notEqual(credentialReference('db', replacement), 'SHARED_PASSWORD')
  assert.equal(credentialReference('db', { ...replacement, reference: 'CHOSEN_REF' }), 'CHOSEN_REF')
  assert.throws(
    () => prepareCredentials('db', [{ ...replacement, reference: 'bad-ref' }]),
    (error: unknown) => {
      assert.match(
        `${error instanceof Error ? `${error.name}: ` : ''}${translator('zh-CN')(readError(error))}`,
        /凭证引用名/,
      )
      return true
    },
  )
  assert.throws(
    () => prepareCredentials('db', [{ ...replacement, reference: 'DSH_HOME' }]),
    (error: unknown) => {
      assert.match(
        `${error instanceof Error ? `${error.name}: ` : ''}${translator('zh-CN')(readError(error))}`,
        /凭证引用名/,
      )
      return true
    },
  )
})

test('duplicate header keys and conflicting values for one reference fail before saving', () => {
  const row = { id: crypto.randomUUID(), field: 'http_headers_env', key: 'X-Auth', value: 'one' }
  assert.throws(
    () => prepareCredentials('db', [row, { ...row, id: crypto.randomUUID() }]),
    (error: unknown) => {
      assert.match(
        `${error instanceof Error ? `${error.name}: ` : ''}${translator('zh-CN')(readError(error))}`,
        /Header 名称不能重复/,
      )
      return true
    },
  )
  assert.throws(
    () =>
      prepareCredentials('db', [
        { id: '1', field: 'user_env', reference: 'SHARED', value: 'one' },
        { id: '2', field: 'password_env', reference: 'SHARED', value: 'two' },
      ]),
    (error: unknown) => {
      assert.match(
        `${error instanceof Error ? `${error.name}: ` : ''}${translator('zh-CN')(readError(error))}`,
        /同一凭证引用/,
      )
      return true
    },
  )
})
