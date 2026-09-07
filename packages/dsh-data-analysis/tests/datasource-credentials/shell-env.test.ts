import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertMarivoCredentialReferences,
  marivoCredentialStorageRef,
} from '../../src/datasource/shell-env.ts'

test('reference mapping is byte-exact, case-sensitive, and excludes Host control names', () => {
  assert.equal(marivoCredentialStorageRef('A_b1'), 'DSH_DATA_ANALYSIS_CREDENTIAL_415F6231')
  assert.notEqual(
    marivoCredentialStorageRef('DB_PASSWORD'),
    marivoCredentialStorageRef('db_password'),
  )
  for (const ref of [
    'A-B',
    'MARIVO_PROJECT_ROOT',
    'dsh_data_analysis_password',
    'DSH_HOME',
    'DSH_SHELL',
    'DSH_SESSION_ID',
    'DSH_SESSION_JSONL',
  ])
    assert.throws(() => assertMarivoCredentialReferences([ref]), /reference/)
})
