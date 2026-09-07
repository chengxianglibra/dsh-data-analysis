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

test('Datasource bridge owns definition projection and host-only pipe credentials', async () => {
  const description = {
    name: 'warehouse',
    refs: ['DSH_USER'],
    fields: { user: 'DSH_USER' },
    definition: 'd'.repeat(64),
  }
  const runner = new FakeCheckedRunner(
    result(description),
    result({ datasources: [description] }),
    result({ name: 'warehouse', ok: true, latency_ms: 12, failure: null, repair: null }),
  )
  const bridge = new MarivoDatasourceBridge(runner)
  assert.deepEqual(await bridge.describe('warehouse'), description)
  assert.deepEqual(await bridge.inventory(), [description])
  assert.equal((await bridge.test(description, { DSH_USER: 'secret' })).ok, true)
  assert.equal(runner.requests[2]?.environmentOverlay, undefined)
  assert.deepEqual(runner.requests[2]?.secretValues, ['secret'])
  assert.equal(JSON.parse(runner.requests[2]!.stdin!).values.DSH_USER, 'secret')
  assert.doesNotMatch(JSON.stringify(runner.requests[2]?.args), /secret/)
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
    ).test({ name: 'warehouse', refs: [], fields: {}, definition: 'd'.repeat(64) }, {}),
    /unexpected payload shape/,
  )
})
