import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type AnalysisDocument,
  AnalysisViewError,
  validateAnalysisResources,
} from '../../src/presentation/contracts/analysis-document.ts'
import * as f from '../unified-analysis-ui/frame-fixtures.ts'

/** A two-row Frame with two comparison groups: `comparison` cannot pick one target. */
function twoGroupFrame() {
  return f.frame({
    axes: [f.categoryAxis(2)],
    values: [...f.comparedValues('sales', 2), ...f.comparedValues('orders', 2)],
    comparisons: [
      f.comparisonOf({ kind: 'ordinary' }, [
        { name: 'sales', values: f.comparedRoles('sales') },
        { name: 'orders', values: f.comparedRoles('orders') },
      ]),
    ],
  })
}

const resources = (snapshot: ReturnType<typeof twoGroupFrame>): AnalysisDocument['resources'] => ({
  result: {
    kind: 'snapshot',
    declaration: { kind: 'frame-snapshot', snapshotRef: 'frame-ref' },
    snapshot,
    binding: {
      workspaceId: 'workspace',
      codeRef: {
        executionId: '00000000-0000-4000-8000-000000000000',
        sha256: 'a'.repeat(64),
      },
      sessionId: 'session',
      callId: 'call',
    },
  },
})

test('save-time target ambiguity identifies the value parameter and a repairable target', () => {
  const program = 'root = AnalysisFrameView("result", {chart:"comparison"});'
  assert.throws(
    () => validateAnalysisResources(program, resources(twoGroupFrame())),
    (error: Error) => {
      assert(error instanceof AnalysisViewError)
      assert.equal(error.code, 'analysis-view-target-ambiguous')
      assert.equal(error.path, 'root/view/encoding/value')
      assert.equal(error.details.expectedKind, 'value')
      assert(error.details.candidates?.includes('orders'))
      validateAnalysisResources(
        'root = AnalysisFrameView("result", {chart:"comparison",encoding:{value:"orders"}});',
        resources(twoGroupFrame()),
      )
      return true
    },
  )
})

test('save-time axis errors disclose a name that makes the chart valid', () => {
  const snapshot = f.observeCategory(2)
  const axis = snapshot.frame.axes[0]!
  const program = (name: string) =>
    `root = AnalysisFrameView("result", {chart:"bar",encoding:{axis:${JSON.stringify(name)}}});`
  assert.throws(
    () => validateAnalysisResources(program(axis.token), resources(snapshot)),
    (error: Error) => {
      assert(error instanceof AnalysisViewError)
      assert.deepEqual(error.details.candidates, [axis.name])
      return true
    },
  )
  validateAnalysisResources(program(axis.name), resources(snapshot))
})

test('Frame chart and table names are repairable without translating axis names into column IDs', () => {
  const snapshot = f.observeTimeCategory(2, 2)
  snapshot.frame.axes[0]!.name = 'calendar:hour'
  snapshot.frame.axes[1]!.name = 'trino_query.query_info.cluster'
  const cases = [
    [
      { chart: 'table', columns: ['trino_query.query_info.cluster', 'month', 'm0', 'm1'] },
      'columns/0',
      'region',
    ],
    [{ chart: 'line', encoding: { axis: 'month' } }, 'encoding/axis', 'calendar:hour'],
    [
      { chart: 'line', encoding: { axis: 'calendar:hour', series: 'region' } },
      'encoding/series',
      'trino_query.query_info.cluster',
    ],
    [
      { chart: 'heatmap', encoding: { x: 'calendar:hour', y: 'region', value: 'm1' } },
      'encoding/y',
      'trino_query.query_info.cluster',
    ],
    [
      { chart: 'bar', encoding: { axis: 'calendar:hour', values: ['month', 'm0'] } },
      'encoding/values/0',
      'm1',
    ],
  ] as const
  for (const [view, path, replacement] of cases) {
    const program = (json: string) => `root = AnalysisFrameView("result", ${json});`
    const json = JSON.stringify(view)
    assert.throws(
      () => validateAnalysisResources(program(json), resources(snapshot)),
      (error: Error) => {
        assert(error instanceof AnalysisViewError)
        assert.equal(error.path, `root/view/${path}`)
        assert.deepEqual(error.details.candidates, [replacement])
        const received = error.details.received
        assert.equal(typeof received, 'string')
        validateAnalysisResources(
          program(json.replace(JSON.stringify(received), JSON.stringify(replacement))),
          resources(snapshot),
        )
        return true
      },
    )
  }
})
