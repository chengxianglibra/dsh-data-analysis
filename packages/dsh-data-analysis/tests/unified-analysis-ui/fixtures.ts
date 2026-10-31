export function frameSnapshot() {
  const key = {
    id: 'region',
    slotId: 'key',
    dtype: { type: 'string' },
    nullable: false,
    unit: null,
  }
  return {
    schemaVersion: 2,
    kind: 'frame',
    fetchedAt: '2026-10-28T00:00:00Z',
    data: {
      schemaVersion: 1,
      columns: [
        { id: 'region', label: 'region', type: 'string', nullable: false },
        { id: 'amount', label: 'amount', type: 'decimal', nullable: true, unit: 'USD' },
      ],
      rows: [['A', '12345678901234.5678']],
      rowCount: 2,
      limit: 1,
      truncated: true,
    },
    coverage: {
      start: 0,
      totalRows: 2,
      capturedRows: 1,
      complete: false,
      columns: ['region', 'amount'],
      business: 'unknown',
    },
    source: { kind: 'frame', sessionId: 'session', artifactId: 'artifact' },
    frame: {
      inputId: 'input',
      description: null,
      fields: [
        { id: 'region', role: 'coordinate', axisToken: 'axis' },
        { id: 'amount', role: 'value', slotId: 'value' },
      ],
      layout: [
        { kind: 'coordinate', name: 'region', axisToken: 'axis', endpoint: 'self', part: 'key' },
        { kind: 'field', name: 'amount', slotId: 'value' },
      ],
      axes: [
        {
          token: 'axis',
          name: 'region',
          role: 'identity',
          keys: [key],
          variant: { kind: 'ordinary' },
        },
      ],
      slots: [
        key,
        {
          id: 'amount',
          slotId: 'value',
          dtype: { type: 'decimal', precision: 20, scale: 4 },
          nullable: true,
          unit: 'USD',
        },
      ],
      coordinates: {
        key: {
          column: { id: 'region', label: 'region', type: 'string', nullable: false },
          values: ['A'],
        },
      },
      readStats: { dataRowsRead: 1, coordinateRowsRead: 1, receiptBytesHashed: 100 },
      sections: {
        semantics: { status: 'captured', columns: [] },
        interpretation: {
          status: 'captured',
          fixedAxes: [],
          valueContexts: {},
          comparisons: [],
          decompositions: [],
          alignments: [],
        },
        periods: { status: 'captured', pages: [] },
      },
    },
  }
}

/** Historical input retained only to verify rejection at current trust boundaries. */
export function legacyFrameSnapshot() {
  const snapshot = frameSnapshot()
  return {
    ...snapshot,
    schemaVersion: 1,
    frame: {
      ...snapshot.frame,
      sections: {
        evidence: 'not-captured',
        findings: 'not-captured',
        methods: 'not-captured',
        semantics: 'not-captured',
      },
    },
  }
}
