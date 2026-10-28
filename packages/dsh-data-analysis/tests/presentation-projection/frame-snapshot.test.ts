import assert from 'node:assert/strict'
import test from 'node:test'
import type { MarivoCheckedRunRequest } from '../../src/environment/types.ts'
import { parseAnalysisSnapshot } from '../../src/presentation/contracts/snapshot.ts'
import { MarivoPresentationProjection } from '../../src/presentation/projection/index.ts'

function snapshot() {
  const key = {
    id: 'region',
    slotId: 'key',
    dtype: { type: 'string' },
    nullable: false,
    unit: null,
  }
  return {
    schemaVersion: 1,
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
      fields: [
        { id: 'region', role: 'coordinate', axisToken: 'axis' },
        { id: 'amount', role: 'value', slotId: 'value' },
      ],
      layout: [
        { kind: 'coordinate', name: 'region', axisToken: 'axis', endpoint: 'self', part: 'key' },
        { kind: 'field', name: 'amount', slotId: 'value' },
      ],
      axes: [{ token: 'axis', name: 'region', role: 'identity', keys: [key] }],
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
        evidence: 'not-captured',
        findings: 'not-captured',
        methods: 'not-captured',
        semantics: 'not-captured',
      },
    },
  }
}

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

test('initial Frame projections use one checked execution and reject identity replacement and cancellation', async () => {
  const calls: MarivoCheckedRunRequest[] = []
  let output = snapshot()
  const projection = new MarivoPresentationProjection({
    status: 'ready',
    binding: {
      projectRoot: '/workspace',
      pythonExecutable: '/runtime/python',
      marivoVersion: 'fixture',
      packagePath: '/runtime/marivo/__init__.py',
      fingerprint: 'f'.repeat(64),
      subprocessPolicyId: 'fixture',
      presentationKit: { version: '1.2.0', packagePath: '/runtime/kit/__init__.py' },
    },
    async runChecked(request) {
      calls.push(request)
      return {
        exitCode: 0,
        signal: null,
        stdout: Buffer.from(JSON.stringify({ ok: true, snapshots: [output, output] })),
        stderr: Buffer.alloc(0),
        durationMs: 1,
      }
    },
  })
  const ref = { sessionId: 'session', artifactId: 'artifact', columns: ['amount'], rowLimit: 1 }
  const result = await projection.readFrames([ref, ref])
  assert.equal(calls.length, 1)
  assert.equal(result.length, 2)
  assert.deepEqual(JSON.parse(calls[0]!.args![0]!), { frames: [ref, ref] })
  output = snapshot()
  output.source.artifactId = 'other'
  await assert.rejects(projection.readFrames([ref, ref]), /invalid projection/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(projection.readFrames([ref], controller.signal), /abort/i)
  assert.equal(calls.length, 2)
})
