import assert from 'node:assert/strict'
import test from 'node:test'
import { parseComputation } from '../../src/semantic-browser/definition.ts'

const ref = { schema: 'marivo.semantic_ref/v1' as const, kind: 'metric', path: 'growth.spend' }
const payload = {
  schema: 'marivo.semantic_definition/v1',
  ref,
  catalog_definition_fingerprint: 'catalog',
  source_location: { file: '/project/model.py', line: 1 },
  node: {
    kind: 'cumulative',
    base: ref,
    over: { selection: 'default', resolution: 'context_required' },
    anchor: { kind: 'all_history' },
  },
  temporal: {
    declared: { status: 'not_declared' },
    override: { status: 'not_declared' },
    effective: { status: 'component_defined' },
  },
}
test('definition transport preserves default and availability states and validates snapshot identity', () => {
  assert.deepEqual(parseComputation(payload, ref, 'catalog'), payload)
  assert.throws(() => parseComputation(payload, ref, 'other'), /identity/)
  assert.throws(
    () => parseComputation(payload, { ...ref, path: 'growth.other' }, 'catalog'),
    /identity/,
  )
  assert.throws(
    () => parseComputation({ ...payload, schema: 'unknown' }, ref, 'catalog'),
    /identity/,
  )
})
test('definition transport rejects undeclared fields, executable values and oversized nesting', () => {
  for (const node of [
    { ...payload.node, password: 'secret' },
    { kind: 'expression', expression: () => 1 },
    { kind: 'aggregate', operation: { kind: 'percentile', q: Infinity } },
  ])
    assert.throws(() => parseComputation({ ...payload, node }, ref, 'catalog'))
  let node: unknown = { kind: 'column', entity: { ...ref, kind: 'entity' }, name: 'spend' }
  for (let i = 0; i < 70; i++) node = { kind: 'cast', data_type: 'float64', operand: node }
  assert.throws(() => parseComputation({ ...payload, node }, ref, 'catalog'), /large/)
  assert.equal(parseComputation(null, ref, 'catalog'), null)
})
