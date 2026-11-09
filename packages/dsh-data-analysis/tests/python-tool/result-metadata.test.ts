import assert from 'node:assert/strict'
import test from 'node:test'
import { PYTHON_RESULT_HEADER, readPythonResultOutput } from '../../src/python-result-references.ts'

const ref = {
  schema: 'marivo.frame_ref/v2',
  store_id: 'store',
  session_id: 'session',
  artifact_id: 'artifact',
}
const frame = (metadata: unknown) =>
  `${PYTHON_RESULT_HEADER}${Buffer.from(JSON.stringify({ status: 'ok', references: { result: ref }, metadata })).toString('base64')}\nuser stderr`

test('configuration metadata is exported without rows and does not claim unknown coverage', () => {
  const metadata = {
    result: {
      status: 'captured',
      kind: 'frame',
      columns: ['region', 'amount'],
      values: ['amount'],
      axes: [{ token: 'axis', name: 'region', role: 'ordinary' }],
      coverage: { totalRows: null, business: 'unknown' },
    },
  }
  const result = readPythonResultOutput(frame(metadata), { result: 'result_ref' })
  assert.deepEqual(result.resultRefs, { result: ref })
  assert.deepEqual(result.resultMetadata, metadata)
  assert.equal(result.stderr, 'user stderr')
})

test('invalid or over-budget metadata cannot discard an otherwise valid immutable result export', () => {
  for (const metadata of [
    { result: { status: 'captured', rows: [['secret']] } },
    { other: { status: 'unavailable', reason: 'budget' } },
    {
      result: {
        status: 'captured',
        kind: 'frame',
        columns: Array(65).fill('column'),
        values: [],
        axes: [],
        coverage: { totalRows: 1, business: 'unknown' },
      },
    },
  ]) {
    const result = readPythonResultOutput(frame(metadata), { result: 'result_ref' })
    assert.deepEqual(result.resultRefs, { result: ref })
    assert.equal(result.resultCaptureError, undefined)
    assert.deepEqual(result.resultMetadata, {
      result: { status: 'unavailable', reason: 'read-failed' },
    })
  }
})
