import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type AnalysisDocument,
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

test('save-time target ambiguity lists candidates in the error text', () => {
  const program = 'root = AnalysisFrameView("result", {chart:"comparison"});'
  assert.throws(
    () => validateAnalysisResources(program, resources(twoGroupFrame())),
    (error: Error) => {
      assert.match(error.message, /analysis-view-target-ambiguous/)
      assert.match(error.message, /; candidates: /)
      assert.match(error.message, /orders/)
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
      assert(error.message.includes(`candidates: ${axis.name}`))
      return true
    },
  )
  validateAnalysisResources(program(axis.name), resources(snapshot))
})
