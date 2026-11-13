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
      columns: ['region', 'hour', 'amount'],
      values: ['amount'],
      axes: [
        { token: 'region-axis', name: 'query.info.region', role: 'field' },
        { token: 'hour-axis', name: 'calendar:hour', role: 'calendar' },
      ],
      valueTypes: { amount: 'decimal' },
      coordinateColumns: [
        { name: 'region', axisToken: 'region-axis', endpoint: 'self', part: 'key' },
        { name: 'hour', axisToken: 'hour-axis', endpoint: 'self', part: 'key' },
      ],
      coverage: { totalRows: null, business: 'unknown' },
    },
  }
  const result = readPythonResultOutput(frame(metadata), { result: 'result_ref' })
  assert.deepEqual(result.resultRefs, { result: ref })
  const { valueTypes: _valueTypes, ...facts } = metadata.result
  const resultMetadata = result.resultMetadata?.result
  assert(resultMetadata?.status === 'captured')
  const { viewCandidateUsage, ...disclosed } = resultMetadata
  assert.deepEqual(viewCandidateUsage.columns, {
    nameKind: 'column-id',
    parameters: ['table.columns', 'metric.encoding.value', 'labels'],
  })
  assert.equal(viewCandidateUsage.axis.nameKind, 'public-axis-name')
  assert(viewCandidateUsage.axis.parameters.includes('bar.encoding.axis'))
  assert.deepEqual(viewCandidateUsage.timeAxis.parameters, [
    'line.encoding.axis',
    'area.encoding.axis',
  ])
  assert.equal(viewCandidateUsage.numericValues.nameKind, 'public-value-name')
  assert.deepEqual(disclosed, {
    ...facts,
    coordinateColumns: [
      {
        name: 'region',
        axisToken: 'region-axis',
        endpoint: 'self',
        part: 'key',
        axisName: 'query.info.region',
      },
      {
        name: 'hour',
        axisToken: 'hour-axis',
        endpoint: 'self',
        part: 'key',
        axisName: 'calendar:hour',
      },
    ],
    viewCandidates: {
      columns: ['region', 'hour', 'amount'],
      axis: ['query.info.region', 'calendar:hour'],
      timeAxis: ['calendar:hour'],
      values: ['amount'],
      numericValues: ['amount'],
    },
  })
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

test('candidate usage does not discard a wide result that previously fit the metadata budget', () => {
  const names = Array.from({ length: 64 }, (_, i) => `metric_${String(i).padStart(2, '0')}`)
  const result = readPythonResultOutput(
    frame({
      result: {
        status: 'captured',
        kind: 'frame',
        columns: names,
        values: names,
        axes: [],
        valueTypes: Object.fromEntries(names.map((name) => [name, 'decimal'])),
        coordinateColumns: [],
        coverage: { totalRows: null, business: 'unknown' },
      },
    }),
    { result: 'result_ref' },
  )
  assert.equal(result.resultMetadata?.result?.status, 'captured')
  if (result.resultMetadata?.result?.status === 'captured')
    assert.deepEqual(result.resultMetadata.result.viewCandidates.columns, names)
})

test('repeated axis names yield to the bounded token mapping without dropping candidates', () => {
  const axisName = 'a'.repeat(400)
  const columns = Array.from({ length: 12 }, (_, i) => `coordinate_${i}`)
  const result = readPythonResultOutput(
    frame({
      result: {
        status: 'captured',
        kind: 'frame',
        columns,
        values: [],
        axes: [{ token: 'axis', name: axisName, role: 'field' }],
        valueTypes: {},
        coordinateColumns: columns.map((name) => ({
          name,
          axisToken: 'axis',
          endpoint: 'self',
          part: 'key',
        })),
        coverage: { totalRows: null, business: 'unknown' },
      },
    }),
    { result: 'result_ref' },
  )
  const metadata = result.resultMetadata?.result
  assert(metadata?.status === 'captured')
  assert.deepEqual(metadata.viewCandidates.axis, [axisName])
  assert.equal(metadata.coordinateColumns.length, 12)
  assert(
    metadata.coordinateColumns.every(
      (column) => column.axisToken === 'axis' && column.axisName === undefined,
    ),
  )
})

test('candidate expansion over the receipt budget preserves the fixed result reference', () => {
  const names = Array.from({ length: 8 }, (_, i) => `${i}_${'x'.repeat(110)}`)
  const metadata = {
    result: {
      status: 'captured',
      kind: 'frame',
      columns: names,
      values: names,
      axes: [],
      valueTypes: Object.fromEntries(names.map((name) => [name, 'decimal'])),
      coordinateColumns: [],
      coverage: { totalRows: null, business: 'unknown' },
    },
  }
  assert(Buffer.byteLength(JSON.stringify(metadata.result)) < 4096)
  const result = readPythonResultOutput(frame(metadata), { result: 'result_ref' })
  assert.deepEqual(result.resultRefs, { result: ref })
  assert.equal(result.resultCaptureError, undefined)
  assert.deepEqual(result.resultMetadata, { result: { status: 'unavailable', reason: 'budget' } })
})
