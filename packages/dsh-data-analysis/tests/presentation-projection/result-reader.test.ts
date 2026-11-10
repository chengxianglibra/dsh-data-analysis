import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { createAnalysisDocument } from '../../src/presentation/analysis.ts'
import {
  parseAnalysisDocument,
  sameAnalysisDeclaration,
} from '../../src/presentation/contracts/analysis-document.ts'
import {
  isFrameSnapshotV2,
  parseAnalysisSnapshot,
} from '../../src/presentation/contracts/snapshot.ts'
import { readMarivoResult } from '../../src/presentation/result-reader.ts'
import { frameSnapshotV2 } from '../presentation-integration/frame-v2-fixture.ts'

const ref = {
  schema: 'marivo.frame_ref/v2',
  store_id: 'store',
  session_id: 'session',
  artifact_id: 'artifact',
} as const
const signal = new AbortController().signal
function fixture() {
  const snapshot = parseAnalysisSnapshot(frameSnapshotV2())
  if (!isFrameSnapshotV2(snapshot)) throw new Error('expected frame')
  snapshot.source.sessionId = ref.session_id
  snapshot.source.artifactId = ref.artifact_id
  const requests: Parameters<MarivoCheckedRunner['runChecked']>[0][] = []
  const runner: MarivoCheckedRunner = {
    status: 'ready',
    binding: {
      projectRoot: '/workspace',
      pythonExecutable: '/python',
      packagePath: '/marivo/__init__.py',
      marivoVersion: '0.6.4',
      fingerprint: 'identity',
      subprocessPolicyId: 'policy',
    },
    async runChecked(request) {
      requests.push(request)
      return {
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: Buffer.from(JSON.stringify(snapshot)),
        stderr: Buffer.alloc(0),
      }
    },
  }
  return { runner, snapshot, requests }
}

test('fixed Frame references reopen through checked public Python APIs without HTTP or producer replay', async () => {
  const f = fixture()
  assert.deepEqual(await readMarivoResult(f.runner, ref, signal), f.snapshot)
  const request = f.requests[0]!
  assert.deepEqual(JSON.parse(request.stdin!), ref)
  assert.match(request.program, /os.environ\["MARIVO_PROJECT_ROOT"\] = os.getcwd\(\)/)
  const program = await readFile(
    new URL('../../python/presentation/read_result.py', import.meta.url),
    'utf8',
  )
  assert.match(program, /mv.session.resume/)
  assert.match(program, /\.persisted_frame\(/)
  assert.match(program, /frame.ref.to_dict\(\) != reference/)
  assert.doesNotMatch(request.program, /urllib|uvicorn|marivo\.server|\.compute\(|\.persist\(/)
})

test('Frame reads reject invalid references, mismatched results and failed execution', async () => {
  const f = fixture()
  await assert.rejects(
    readMarivoResult(f.runner, { ...ref, schema: 'invalid' } as unknown as typeof ref, signal),
  )
  assert.equal(f.requests.length, 0)
  f.snapshot.source.artifactId = 'another-artifact'
  await assert.rejects(readMarivoResult(f.runner, ref, signal), /identity-mismatch/)
  f.runner.runChecked = async () => ({
    exitCode: 1,
    signal: null,
    durationMs: 1,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from('private upstream error'),
  })
  await assert.rejects(
    readMarivoResult(f.runner, ref, signal),
    (error) =>
      error instanceof Error &&
      error.message.includes('result-read-failed') &&
      !error.message.includes('private'),
  )
})

test('Frame resources embed bounded snapshots without claiming producer code provenance and reuse saved bytes', async () => {
  const f = fixture()
  const input = {
    surface: 'tab' as const,
    resourcePatch: { put: { revenue: { kind: 'analysis-frame' as const, ref } } },
  }
  const identity = { workspaceId: 'workspace', reportId: 'report', buildId: 'build' }
  const document = await createAnalysisDocument(
    input,
    { projectRoot: '/workspace', runner: async () => f.runner },
    identity,
    signal,
  )
  assert.equal(document.resources.revenue?.kind, 'snapshot')
  const saved = document.resources.revenue!
  if (saved.kind !== 'snapshot') throw new Error('expected snapshot')
  assert.deepEqual(saved.binding, { workspaceId: 'workspace' })
  assert.deepEqual(saved.snapshot, f.snapshot)
  assert.match(document.program, /AnalysisFrameView/)
  await createAnalysisDocument(
    { surface: 'tab', title: 'Updated' },
    { projectRoot: '/workspace' },
    identity,
    signal,
    document,
  )
  assert.equal(f.requests.length, 1)
  saved.snapshot.source = { kind: 'frame', sessionId: 'other-session', artifactId: 'artifact' }
  assert.throws(() => parseAnalysisDocument(document), /result-identity-invalid/)
})

test('Frame resource admission rejects a different Workspace and cancellation', async () => {
  const f = fixture()
  await assert.rejects(
    createAnalysisDocument(
      { surface: 'tool', resourcePatch: { put: { result: { kind: 'analysis-frame', ref } } } },
      { projectRoot: '/other', runner: async () => f.runner },
      { workspaceId: 'workspace', reportId: 'report', buildId: 'build' },
      signal,
    ),
    /workspace-mismatch/,
  )
  assert.equal(f.requests.length, 0)
  const controller = new AbortController()
  f.runner.runChecked = async () => {
    controller.abort()
    return {
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdout: Buffer.from(JSON.stringify(f.snapshot)),
      stderr: Buffer.alloc(0),
    }
  }
  await assert.rejects(readMarivoResult(f.runner, ref, controller.signal), /abort/i)
  assert.equal(
    sameAnalysisDeclaration(
      { kind: 'analysis-frame', ref },
      { kind: 'analysis-frame', ref: { ...ref, store_id: 'different-store' } },
    ),
    false,
  )
})

test('DataFrame fixed references admit only this Workspace and retain Dataset view resources', async () => {
  const f = fixture()
  const ref = {
    schema: 'marivo.dataframe_ref/v2' as const,
    project_root: '/workspace',
    result_id: `df_${'a'.repeat(32)}`,
  }
  const snapshot = parseAnalysisSnapshot({
    schemaVersion: 1,
    kind: 'dataset',
    fetchedAt: '2026-11-09T00:00:00Z',
    source: { kind: 'dataframe', details: 'not-captured' },
    data: {
      schemaVersion: 1,
      columns: [{ id: 'amount', label: 'amount', type: 'decimal', nullable: false }],
      rows: [['9007199254740993.1000']],
      rowCount: 1,
      limit: 5000,
      truncated: false,
    },
    coverage: {
      start: 0,
      totalRows: 1,
      capturedRows: 1,
      complete: true,
      columns: ['amount'],
      business: 'unknown',
    },
  })
  f.runner.runChecked = async (request) => {
    f.requests.push(request)
    return {
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdout: Buffer.from(JSON.stringify(snapshot)),
      stderr: Buffer.alloc(0),
    }
  }
  await assert.rejects(
    readMarivoResult(f.runner, { ...ref, project_root: '/foreign' }, signal),
    /workspace-mismatch/,
  )
  assert.equal(f.requests.length, 0)
  const document = await createAnalysisDocument(
    { surface: 'tool', resourcePatch: { put: { data: { kind: 'dataframe', ref } } } },
    { projectRoot: '/workspace', runner: async () => f.runner },
    { workspaceId: 'workspace', reportId: 'report', buildId: 'build' },
    signal,
  )
  const resource = document.resources.data
  assert(resource?.kind === 'snapshot')
  assert.deepEqual(resource.snapshot, snapshot)
  assert.deepEqual(resource.binding, { workspaceId: 'workspace' })
  assert.match(document.program, /DatasetView/)
  await createAnalysisDocument(
    { surface: 'tool', title: 'Updated' },
    { projectRoot: '/workspace' },
    { workspaceId: 'workspace', reportId: 'report', buildId: 'next' },
    signal,
    document,
  )
  assert.equal(f.requests.length, 1)
  assert.equal(
    sameAnalysisDeclaration(
      { kind: 'dataframe', ref },
      { kind: 'dataframe', ref: { ...ref, project_root: '/other' } },
    ),
    false,
  )
  f.runner.runChecked = fixture().runner.runChecked
  await assert.rejects(readMarivoResult(f.runner, ref, signal), /identity-mismatch/)
})

test('checked result errors disclose only recognized repair codes', async () => {
  const f = fixture()
  for (const [payload, expected] of [
    [{ error: { code: 'result-session-busy' } }, /result-session-busy: Wait/],
    [{ error: { code: 'result-identity-mismatch' } }, /result-identity-mismatch/],
    [{ error: { code: 'private-secret' } }, /result-read-failed/],
    [{ error: { code: 'result-session-busy', detail: 'private-secret' } }, /result-read-failed/],
  ] as const) {
    f.runner.runChecked = async () => ({
      exitCode: 1,
      signal: null,
      durationMs: 1,
      stdout: Buffer.from(JSON.stringify(payload)),
      stderr: Buffer.from('private-secret'),
    })
    await assert.rejects(readMarivoResult(f.runner, ref, signal), (error) => {
      assert(error instanceof Error)
      assert.match(error.message, expected)
      assert.doesNotMatch(error.message, /private-secret/)
      return true
    })
  }
})
