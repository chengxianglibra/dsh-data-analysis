import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const python = process.env.DSH_DATA_ANALYSIS_TEST_PYTHON
test('real datasource editing preserves source timezone and rejects an externally changed timezone', {
  skip: python ? false : 'Set DSH_DATA_ANALYSIS_TEST_PYTHON to the exact supported Runtime',
  timeout: 120_000,
}, async () => {
  const script = fileURLToPath(
    new URL('../../scripts/validate-datasource-configuration-real.ts', import.meta.url),
  )
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--experimental-strip-types', script],
    {
      env: { ...process.env, DSH_DATA_ANALYSIS_PYTHON: python },
      maxBuffer: 1024 * 1024,
    },
  )
  const result = JSON.parse(stdout)
  assert.equal(result.passed, true)
  assert.equal(result.runtime, '0.6.6')
  assert(result.checks.includes('timezone-roundtrip-external-change-conflict-and-clear'))
})
