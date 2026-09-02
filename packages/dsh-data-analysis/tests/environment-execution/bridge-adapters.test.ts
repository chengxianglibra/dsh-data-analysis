import assert from 'node:assert/strict'
import test from 'node:test'
import { MarivoDatasourceBridge } from '../../src/datasource/index.ts'
import { MarivoHelpBridge } from '../../src/disclosure/index.ts'
import type {
  MarivoCheckedRunner,
  MarivoCheckedRunRequest,
  MarivoEnvironmentBinding,
  SubprocessResult,
} from '../../src/environment/index.ts'
import { MarivoEvidenceBridge } from '../../src/evidence/index.ts'

const binding: MarivoEnvironmentBinding = {
  projectRoot: '/fixture/project',
  pythonExecutable: '/fixture/python',
  marivoVersion: '0.5.test',
  packagePath: '/fixture/marivo/__init__.py',
  subprocessPolicyId: 'fixture-policy',
  fingerprint: 'b'.repeat(64),
}

function result(stdout: unknown, stderr = '', exitCode = 0): SubprocessResult {
  return {
    exitCode,
    signal: null,
    stdout: Buffer.from(typeof stdout === 'string' ? stdout : JSON.stringify(stdout)),
    stderr: Buffer.from(stderr),
    durationMs: 1,
  }
}

class FakeCheckedRunner implements MarivoCheckedRunner {
  readonly binding = binding
  readonly status = 'ready' as const
  readonly requests: MarivoCheckedRunRequest[] = []
  readonly #results: SubprocessResult[]

  constructor(...results: SubprocessResult[]) {
    this.#results = results
  }

  runChecked(request: MarivoCheckedRunRequest): Promise<SubprocessResult> {
    this.requests.push(request)
    const next = this.#results.shift()
    if (next === undefined) throw new Error('fake checked runner exhausted')
    return Promise.resolve(next)
  }
}

test('Help bridge owns its Python program, limits, argv, and raw body contract', async () => {
  const runner = new FakeCheckedRunner(result('live help\n'), result('live inventory\n'))
  const bridge = new MarivoHelpBridge(runner)
  const body = await bridge.runTarget('analysis.observe', {
    timeoutMs: 10,
    stdoutMaxBytes: 20,
    stderrMaxBytes: 30,
  })
  assert.equal(body.toString('utf8'), 'live help\n')
  assert.deepEqual(runner.requests[0]?.args, ['analysis.observe'])
  assert.deepEqual(runner.requests[0]?.limits, {
    timeoutMs: 10,
    stdoutMaxBytes: 20,
    stderrMaxBytes: 30,
  })
  assert.match(runner.requests[0]?.program ?? '', /marivo\.help\(sys\.argv\[1\]\)/)
  assert.equal(
    (await bridge.inventory({ timeoutMs: 11, stdoutMaxBytes: 21, stderrMaxBytes: 31 })).toString(
      'utf8',
    ),
    'live inventory\n',
  )
  assert.deepEqual(runner.requests[1]?.args, [])
  assert.match(runner.requests[1]?.program ?? '', /marivo\.help\(\)/)
})

test('Help bridge maps non-zero and empty output without exposing subprocess payloads', async () => {
  const limits = { timeoutMs: 10, stdoutMaxBytes: 20, stderrMaxBytes: 30 }
  await assert.rejects(
    new MarivoHelpBridge(new FakeCheckedRunner(result('', 'target failed', 70))).runTarget(
      'analysis',
      limits,
    ),
    /target .* failed with exit code 70/,
  )
  await assert.rejects(
    new MarivoHelpBridge(new FakeCheckedRunner(result(''))).runTarget('analysis', limits),
    /returned empty stdout/,
  )
})

test('Datasource bridge owns describe, inventory, test parsing and credential overlay', async () => {
  const runner = new FakeCheckedRunner(
    result({ name: 'warehouse', refs: ['DSH_USER', 'DSH_USER'] }),
    result({ datasources: [{ name: 'warehouse', refs: ['DSH_USER'] }] }),
    result({ name: 'warehouse', ok: true, latency_ms: 12, failure: null, repair: null }),
  )
  const bridge = new MarivoDatasourceBridge(runner)
  assert.deepEqual(await bridge.describe('warehouse'), {
    name: 'warehouse',
    refs: ['DSH_USER'],
  })
  assert.deepEqual(await bridge.inventory(), [{ name: 'warehouse', refs: ['DSH_USER'] }])
  assert.deepEqual(await bridge.test('warehouse', { DSH_USER: 'secret' }), {
    name: 'warehouse',
    ok: true,
    latency_ms: 12,
    failure: null,
    repair: null,
  })
  assert.deepEqual(
    runner.requests.map((request) => request.args),
    [['warehouse'], undefined, ['warehouse']],
  )
  assert.deepEqual(runner.requests[2]?.environmentOverlay, { DSH_USER: 'secret' })
})

test('Datasource bridge rejects missing and additional private projection fields', async () => {
  await assert.rejects(
    new MarivoDatasourceBridge(
      new FakeCheckedRunner(result({ name: 'warehouse', refs: [], extra: true })),
    ).describe('warehouse'),
    /unexpected payload shape/,
  )
  await assert.rejects(
    new MarivoDatasourceBridge(
      new FakeCheckedRunner(result({ name: 'warehouse', ok: true, latency_ms: 1, failure: null })),
    ).test('warehouse', {}),
    /unexpected payload shape/,
  )
})

test('Evidence bridge owns exact Finding identity and order parsing', async () => {
  const finding = {
    status: 'available',
    title: 'metric_observation Finding: metric|a',
    locator: 'marivo://session/session-a/artifact/artifact-a/finding/finding-a',
    excerpt: 'Observed value.',
    truncated: false,
    finding_id: 'finding-a',
    finding_type: 'metric_observation',
    epistemic_kind: 'observed',
    artifact_ref: 'artifact-a',
    session_id: 'session-a',
    canonical_item_key: 'metric|a',
    committed_at: '2026-08-30T00:00:00+00:00',
    source_refs: ['frame-a#row=0'],
    revalidation: {
      status: 'admissible',
      semantic_status: 'current',
      evidence_status: 'complete',
      dependency_status: 'admissible',
    },
  }
  const runner = new FakeCheckedRunner(result({ session_id: 'session-a', sources: [finding] }))
  const bridge = new MarivoEvidenceBridge(runner)
  const projected = await bridge.findings('session-a', [
    { artifactRef: 'artifact-a', findingId: 'finding-a' },
  ])
  assert.equal(projected[0]?.findingId, 'finding-a')
  assert.equal(projected[0]?.artifactRef, 'artifact-a')
  assert.deepEqual(runner.requests[0]?.args, [
    'session-a',
    '[{"artifactRef":"artifact-a","findingId":"finding-a"}]',
  ])
  assert.match(runner.requests[0]?.program ?? '', /session\.artifact/)
  assert.match(runner.requests[0]?.program ?? '', /artifact\.finding/)
  assert.doesNotMatch(runner.requests[0]?.program ?? '', /session\.evidence/)
})

test('Evidence bridge rejects additional Finding fields and exact-order drift', async () => {
  const finding = {
    status: 'available',
    title: 'metric_observation Finding: metric|a',
    locator: 'marivo://session/session-a/artifact/artifact-a/finding/finding-b',
    excerpt: 'Observed value.',
    truncated: false,
    finding_id: 'finding-b',
    finding_type: 'metric_observation',
    epistemic_kind: 'observed',
    artifact_ref: 'artifact-a',
    session_id: 'session-a',
    canonical_item_key: 'metric|a',
    committed_at: '2026-08-30T00:00:00+00:00',
    source_refs: ['frame-a#row=0'],
    revalidation: {
      status: 'admissible',
      semantic_status: 'current',
      evidence_status: 'complete',
      dependency_status: 'admissible',
    },
  }
  await assert.rejects(
    new MarivoEvidenceBridge(
      new FakeCheckedRunner(
        result({ session_id: 'session-a', sources: [{ ...finding, extra: true }] }),
      ),
    ).findings('session-a', [{ artifactRef: 'artifact-a', findingId: 'finding-b' }]),
    /invalid Finding payload/,
  )
  await assert.rejects(
    new MarivoEvidenceBridge(
      new FakeCheckedRunner(result({ session_id: 'session-a', sources: [finding] })),
    ).findings('session-a', [{ artifactRef: 'artifact-a', findingId: 'finding-a' }]),
    /invalid Finding payload/,
  )
})
