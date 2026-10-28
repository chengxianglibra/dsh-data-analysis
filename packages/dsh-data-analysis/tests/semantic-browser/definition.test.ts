import assert from 'node:assert/strict'
import test from 'node:test'
import { parseComputation } from '../../src/semantic-browser/definition.ts'

const ref = { schema: 'marivo.semantic_ref/v1' as const, kind: 'metric', path: 'sales.revenue' }
const payload = {
  schema: 'dsh-data-analysis-computation/v1',
  ref,
  catalog_definition_fingerprint: 'catalog',
  expression: 'amount.sum(time=ordered_at)',
  facts: [{ name: 'null_rules', value: 'Captured NULL behavior' }],
}
test('captured definition projection preserves text and enforces identity', () => {
  assert.deepEqual(parseComputation(payload, ref, 'catalog'), payload)
  assert.equal(parseComputation(null, ref, 'catalog'), null)
  assert.throws(() => parseComputation(payload, ref, 'other'), /identity/)
  assert.throws(
    () => parseComputation(payload, { ...ref, path: 'sales.other' }, 'catalog'),
    /identity/,
  )
  assert.throws(
    () => parseComputation({ ...payload, schema: 'unknown' }, ref, 'catalog'),
    /identity/,
  )
})
test('projection rejects executable values, undeclared facts and unbounded content', () => {
  for (const invalid of [
    { ...payload, expression: () => 1 },
    { ...payload, expression: 'x'.repeat(1024 * 1024 + 1) },
    { ...payload, facts: [{ name: 'password', value: 'secret' }] },
    { ...payload, facts: [...payload.facts, ...payload.facts] },
    { ...payload, facts: [{ name: 'null_rules', value: { code: 'x' } }] },
    { ...payload, extra: 'hidden' },
  ])
    assert.throws(() => parseComputation(invalid, ref, 'catalog'))
})
