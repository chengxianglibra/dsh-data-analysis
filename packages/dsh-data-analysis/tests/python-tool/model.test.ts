import assert from 'node:assert/strict'
import test from 'node:test'
import { pythonToolModel } from '../../src/client/python-tool/model.ts'
import { executionFailure, settled, source, successful } from './fixtures.ts'

test('actual plugin error messages preserve execution state, timing and next action after Harness normalization', () => {
  for (const reason of [
    'not-started',
    'unknown',
    'cancelled',
    'timed-out',
    'nonzero-exit',
  ] as const) {
    const block = executionFailure(reason)
    const model = pythonToolModel(block)
    assert.equal(model.state, reason === 'nonzero-exit' ? 'failed' : reason)
    assert.ok(model.facts.some((fact) => fact.name === 'elapsedMs' && fact.value === '30 ms'))
    assert.equal(
      model.facts.some((fact) => fact.name === 'effectiveTimeoutMs'),
      reason !== 'not-started',
    )
    assert.deepEqual(model.notices, [
      'Inspect existing effects and the intended Session before retrying; do not automatically replay.',
    ])
    assert.equal(model.output, block.content[0]!.type === 'text' ? block.content[0]!.text : '')
    assert.equal(model.fallback, model.output)
  }
})

test('invalid or unrelated suffixes do not change error state, and success cannot override an error', () => {
  const block = executionFailure('unknown')
  const raw = block.content[0]!.type === 'text' ? block.content[0]!.text : ''
  for (const text of [
    raw.slice(0, -1),
    raw + '\nextra result',
    raw.replace('"elapsedMs":30', '"elapsedMs":-1'),
    raw.replace('"elapsedMs":30', '"elapsedMs":1e999'),
    raw.replace('"phase":"executing"', '"phase":"other"'),
    raw.replace('"reason":"unknown"', '"reason":"other"'),
    raw.replace('"executionElapsedMs":null,', ''),
    'Other failure; execution={"reason":"unknown"}',
  ]) {
    const model = pythonToolModel({ ...settled(text), isError: true })
    assert.equal(model.state, 'failed')
    assert.deepEqual(model.facts, [])
    assert.deepEqual(model.notices, [])
    assert.equal(model.fallback, text)
  }
  assert.equal(pythonToolModel(executionFailure('succeeded')).state, 'failed')
  assert.equal(pythonToolModel({ ...block, isError: false }).state, 'unknown')
  assert.deepEqual(pythonToolModel({ ...block, isError: false }).notices, [])
  assert.equal(
    pythonToolModel({ ...block, error: { name: 'Error', code: 'interrupted' } }).state,
    'cancelled',
  )
  assert.equal(
    pythonToolModel({ ...block, content: [...block.content, { type: 'text', text: raw }] }).state,
    'failed',
  )
})

test('extracts source and output without rewriting escaping, indentation or original envelopes', () => {
  const block = settled()
  const snapshot = structuredClone(block)
  const model = pythonToolModel(block)
  assert.equal(model.code, source)
  assert.equal(model.summary, 'import marivo')
  assert.equal(model.stdout, successful.stdout)
  assert.equal(model.input, block.call?.argsRaw)
  assert.equal(model.output, JSON.stringify(successful))
  assert.deepEqual(model.datasources, ['trino_bili'])
  assert.equal(model.timeoutMs, 1000)
  assert.equal(model.state, 'succeeded')
  assert.deepEqual(block, snapshot)
})

test('execution status does not confuse settlement, credential readiness or code capture with success', () => {
  for (const [value, state] of [
    [{ ...successful, exitCode: 2 }, 'failed'],
    [{ ...successful, timedOut: true }, 'timed-out'],
    [{ ...successful, aborted: true }, 'cancelled'],
    [{ ...successful, codeCaptureError: 'Do not rerun' }, 'warning'],
    [{ ...successful, truncated: true }, 'warning'],
    [{ status: 'needs-credentials' }, 'not-started'],
    [{ status: 'ok', execution: { phase: 'preparing', reason: 'not-started' } }, 'not-started'],
    [{ status: 'failed' }, 'failed'],
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'ok' }, 'unknown'],
    [{ ...successful, execution: { reason: 'unknown' } }, 'unknown'],
    [{ exitCode: 0 }, 'unknown'],
    ['not JSON', 'unknown'],
  ] as const)
    assert.equal(pythonToolModel(settled(value)).state, state, JSON.stringify(value))
  assert.equal(pythonToolModel({ ...settled(), isError: true }).state, 'failed')
  assert.equal(
    pythonToolModel({ ...settled(), isError: true, error: { name: 'Error', code: 'interrupted' } })
      .state,
    'cancelled',
  )
})

test('running partial input, missing call, malformed and non-text results preserve fallback data', () => {
  const partial = '{"code":"import'
  const running = pythonToolModel({
    name: 'marivo_python',
    callId: 'c',
    argsRaw: partial,
    time: 0,
    turn: 0,
    step: 0,
    subCalls: [],
  })
  assert.equal(running.state, 'running')
  assert.equal(running.code, undefined)
  assert.equal(running.input, partial)
  assert.equal(running.output, undefined)
  assert.equal(running.timeoutMs, undefined)
  const unknown = pythonToolModel({ ...settled('not JSON'), call: null })
  assert.equal(unknown.code, undefined)
  assert.equal(unknown.fallback, 'not JSON')
  const failed = pythonToolModel({
    ...settled(),
    content: [],
    isError: true,
    error: { name: 'Error', code: 'failed' },
  })
  assert.equal(failed.fallback, 'Error: failed')
  const mixed = pythonToolModel({
    ...settled(),
    content: [...settled().content, { type: 'text', text: 'extra output' }],
  })
  assert.match(mixed.fallback ?? '', /extra output$/)
})

test('shows only supplied budget and timing, and preserves capture warning plus next action', () => {
  const result = pythonToolModel(
    settled({
      ...successful,
      codeCaptureError: 'Do not rerun',
      execution: {
        reason: 'succeeded',
        elapsedMs: 125,
        effectiveTimeoutMs: 900,
        executionElapsedMs: null,
        nextAction: 'Do not rerun',
      },
    }),
  )
  assert.deepEqual(result.notices, ['Do not rerun'])
  assert.ok(result.facts.some((fact) => fact.name === 'elapsedMs' && fact.value === '125 ms'))
  assert.ok(!result.facts.some((fact) => fact.name === 'executionElapsedMs'))
})
