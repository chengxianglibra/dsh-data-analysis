import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  REPORT_CHECK_RULES,
  reportContractRoot,
  validateReportContract,
} from '../../src/report-check/contracts.ts'

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`fixtures/${name}`, reportContractRoot()), 'utf8'))
}

test('checked-in JSON Schema fixtures cover both dataset sources and every Run lifecycle', async () => {
  const cases = [
    ['dataset', 'computed-dataset.json'],
    ['dataset', 'artifact-dataset.json'],
    ['revalidation', 'checked-revalidation.json'],
    ['trace', 'trace-succeeded.json'],
    ['trace', 'trace-incomplete.json'],
    ['trace', 'trace-failed.json'],
  ] as const
  for (const [kind, name] of cases) {
    const result = validateReportContract(kind, await fixture(name))
    assert.equal(result.valid, true)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.schemaErrors, [])
    assert.deepEqual(result.semanticErrors, [])
  }
})

test('dataset semantic invariants remain closed beyond structural JSON Schema validation', async () => {
  const dataset = (await fixture('computed-dataset.json')) as Record<string, any>
  dataset.table.written_rows = 1
  dataset.table.semantic_shape = 'invented'
  dataset.table.rows[0].push('extra')
  const result = validateReportContract('dataset', dataset)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /written_rows must equal rows.length/)
  assert.match(result.errors.join('\n'), /semantic_shape is not allowed/)
  assert.match(result.errors.join('\n'), /must contain exactly 2 cells/)
})

test('trace semantic validation rejects dangling identities and lifecycle set drift', async () => {
  const trace = (await fixture('trace-succeeded.json')) as Record<string, any>
  trace.edges[0].run_id = 'missing-run'
  trace.failed_run_ids = ['run-1']
  const result = validateReportContract('trace', trace)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /dangling run_id/)
  assert.match(result.errors.join('\n'), /lifecycle succeeded|exactly match failed/)
})

test('trace query disclosures stay attached to local Run and Artifact identities', async () => {
  const dangling = (await fixture('trace-succeeded.json')) as Record<string, any>
  dangling.queries[0].run_id = 'missing-run'
  dangling.queries[0].output_artifact_ref = 'missing-artifact'
  const result = validateReportContract('trace', dangling)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /queries contains a dangling run_id/)
  assert.match(result.errors.join('\n'), /queries contains a dangling output_artifact_ref/)

  const duplicate = (await fixture('trace-succeeded.json')) as Record<string, any>
  duplicate.queries.push({ ...duplicate.queries[0] })
  const duplicateResult = validateReportContract('trace', duplicate)
  assert.equal(duplicateResult.valid, false)
  assert.match(duplicateResult.errors.join('\n'), /query_id values must be unique/)
})

test('trace semantic validation closes root, head, and acyclic topology', async () => {
  const drift = (await fixture('trace-succeeded.json')) as Record<string, any>
  drift.root_run_ids = []
  drift.head_artifact_refs = []
  const driftResult = validateReportContract('trace', drift)
  assert.equal(driftResult.valid, false)
  assert.match(driftResult.errors.join('\n'), /root_run_ids must exactly match/)
  assert.match(driftResult.errors.join('\n'), /head_artifact_refs must exactly match/)

  const cycle = (await fixture('trace-succeeded.json')) as Record<string, any>
  cycle.runs[0].input_artifact_refs = ['artifact-1']
  cycle.edges.unshift({ kind: 'consumes', run_id: 'run-1', artifact_ref: 'artifact-1' })
  cycle.root_run_ids = []
  cycle.head_artifact_refs = []
  const cycleResult = validateReportContract('trace', cycle)
  assert.equal(cycleResult.valid, false)
  assert.match(cycleResult.errors.join('\n'), /acyclic Run and Artifact graph/)
})

test('trace semantic validation preserves local truncation boundaries and requires closed local edges', async () => {
  const bounded = (await fixture('trace-succeeded.json')) as Record<string, any>
  bounded.truncated = true
  bounded.boundary_artifact_refs = ['artifact-1']
  const boundedResult = validateReportContract('trace', bounded)
  assert.equal(boundedResult.valid, true)

  bounded.boundary_artifact_refs = ['outside-artifact']
  const outsideResult = validateReportContract('trace', bounded)
  assert.equal(outsideResult.valid, false)
  assert.match(outsideResult.errors.join('\n'), /must identify local Artifact nodes/)

  const missingEdge = (await fixture('trace-succeeded.json')) as Record<string, any>
  missingEdge.edges = []
  const missingEdgeResult = validateReportContract('trace', missingEdge)
  assert.equal(missingEdgeResult.valid, false)
  assert.match(missingEdgeResult.errors.join('\n'), /missing an output edge/)
})

test('rule registry is unique, closed, and fixes severity for every V1 namespace', () => {
  assert.equal(REPORT_CHECK_RULES.length, 59)
  assert.equal(new Set(REPORT_CHECK_RULES.map((rule) => rule.code)).size, 59)
  assert.deepEqual(
    new Set(REPORT_CHECK_RULES.map((rule) => rule.group)),
    new Set([
      'html',
      'resource',
      'css',
      'javascript',
      'json',
      'svg',
      'dataset',
      'trace',
      'a11y',
      'security',
      'starter',
      'budget',
    ]),
  )
  const byCode = new Map(REPORT_CHECK_RULES.map((rule) => [rule.code, rule.severity]))
  assert.equal(byCode.get('resource.external-dependency-unchecked'), 'warning')
  assert.equal(byCode.get('resource.external-navigation-unchecked'), 'info')
  assert.equal(byCode.get('trace.missing-for-artifact-report'), 'warning')
  assert.equal(byCode.get('a11y.table-header-missing'), 'error')
  assert.equal(byCode.get('budget.issue-count-truncated'), 'info')
})
