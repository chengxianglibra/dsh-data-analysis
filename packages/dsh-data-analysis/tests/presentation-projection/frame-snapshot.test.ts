import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'

import { legacyFrameSnapshot, frameSnapshot as snapshot } from '../unified-analysis-ui/fixtures.ts'

test('Frame snapshots retain actual layout, precise cells, complete keys and bounded coverage', () => {
  const result = parseAnalysisSnapshot(snapshot())
  assert.equal(result.coverage.complete, false)
  assert.deepEqual(result.data.rows, [['A', '12345678901234.5678']])
  for (const mutate of [
    (v: ReturnType<typeof snapshot>) => {
      v.coverage.complete = true
    },
    (v: ReturnType<typeof snapshot>) => {
      v.frame.coordinates.key.values = []
    },
    (v: ReturnType<typeof snapshot>) => {
      v.frame.layout[1]!.slotId = 'other'
    },
  ]) {
    const value = snapshot()
    mutate(value)
    assert.throws(() => parseAnalysisSnapshot(value), /Snapshot/)
  }
})

test('Frame v1 snapshots and pre-interpretation metadata are rejected', () => {
  const historical = legacyFrameSnapshot()
  assert.throws(() => parseAnalysisSnapshot(historical), /Snapshot/)
  assert.throws(() => parseAnalysisSnapshot({ ...historical, schemaVersion: 2 }), /Snapshot/)
})
