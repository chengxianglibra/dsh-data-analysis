import { frameSnapshot } from '../unified-analysis-ui/fixtures.ts'

/** A capture_frame schemaVersion 2 snapshot of a memory Frame with one ordinary comparison. */
export function frameSnapshotV2() {
  const value = frameSnapshot()
  return {
    ...value,
    schemaVersion: 2,
    source: { kind: 'frame', sessionId: 'session', artifactId: null },
    frame: {
      ...value.frame,
      description: 'Revenue by region',
      axes: value.frame.axes.map((axis) => ({ ...axis, variant: { kind: 'ordinary' } })),
      sections: {
        semantics: 'not-captured',
        interpretation: {
          status: 'captured',
          fixedAxes: [],
          valueContexts: {},
          comparisons: [
            {
              alias: 'prior',
              groups: [
                {
                  name: 'amount',
                  values: [{ role: 'current', name: 'amount' }],
                  currentContext: null,
                  baselineContext: null,
                },
              ],
              binding: { kind: 'ordinary' },
              presence: null,
              currentFixedAxes: [],
              baselineFixedAxes: [],
            },
          ],
          decompositions: [],
          alignments: [],
        },
        periods: 'not-captured',
      },
    },
  }
}
