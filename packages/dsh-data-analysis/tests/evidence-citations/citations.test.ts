import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  MARIVO_CITATION_MAX_HANDLES,
  MARIVO_CITATION_META_KIND,
  MARIVO_EVIDENCE_CITE_TOOL_NAME,
  MarivoCitationRegistry,
  registerMarivoEvidenceCiteTool,
  type MarivoEvidenceCiteValue,
} from '../../src/evidence/index.ts'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
const script = args[1] ?? ''
if (!script.includes('session.evidence.finding')) process.exit(2)
const sessionId = args[5]
const findingIds = JSON.parse(args[6] ?? 'null')
appendFileSync(process.env.RECORD_PATH, JSON.stringify({ sessionId, findingIds, args: args.slice(5) }) + '\n')
if (process.env.EVIDENCE_MODE === 'identity') process.exit(78)
if (process.env.EVIDENCE_MODE === 'render-unavailable') {
  process.stderr.write(JSON.stringify({ kind: 'finding-render-unavailable', required_capability: 'finding-render-v1' }))
  process.exit(69)
}
if (process.env.EVIDENCE_MODE === 'read-failed') {
  process.stderr.write(JSON.stringify({ kind: 'evidence-read-failed', exception_type: 'FindingNotFoundError' }))
  process.exit(70)
}
if (process.env.EVIDENCE_MODE === 'invalid-json') {
  process.stdout.write('{invalid')
  process.exit(0)
}
if (process.env.EVIDENCE_MODE === 'slow') {
  await new Promise(resolve => setTimeout(resolve, 10_000))
  process.stdout.write('{}')
  process.exit(0)
}
const findings = findingIds.map((findingId, index) => ({
  finding_id: findingId,
  finding_type: process.env.EVIDENCE_MODE === 'extended-vocabulary'
    ? 'future_finding_type'
    : (index % 2 === 0 ? 'metric_value' : 'delta'),
  epistemic_kind: process.env.EVIDENCE_MODE === 'extended-vocabulary'
    ? 'future_epistemic_kind'
    : (index % 2 === 0 ? 'observed' : 'algebraic'),
  artifact_id: 'artifact-' + findingId,
  session_id: process.env.WRONG_SESSION === '1' ? 'other-session' : sessionId,
  canonical_item_key: 'item-' + findingId,
  quality_status: process.env.EVIDENCE_MODE === 'extended-vocabulary'
    ? 'future_quality_status'
    : (index % 3 === 0 ? 'ready' : null),
  committed_at: '2026-08-26T00:00:00+00:00',
  extractor_version: 'v4',
  artifact_schema_version: 'v4',
  rendered: process.env.EVIDENCE_MODE === 'special-render'
    ? { en: 'Metric_[unsafe] <tag> \\ exact', zh: '指标_[不安全] <标签> \\ 精确' }
    : process.env.EVIDENCE_MODE === 'bounded-render'
      ? { en: 'x'.repeat(8192), zh: '值'.repeat(2730) }
      : process.env.EVIDENCE_MODE === 'oversize-render'
        ? { en: 'x'.repeat(8193), zh: '值'.repeat(2731) }
        : { en: 'Metric ' + findingId + ': observed 12.', zh: '指标 ' + findingId + '：观测值为 12。' },
}))
process.stdout.write(JSON.stringify({ session_id: sessionId, findings }))
`

async function fixture(options: { mode?: string; fingerprint?: string; wrongSession?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-marivo-citations-')))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'calls.jsonl')
  await writeFile(executable, FAKE_PYTHON)
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    RECORD_PATH: recordPath,
    ...(options.mode === undefined ? {} : { EVIDENCE_MODE: options.mode }),
    ...(options.wrongSession ? { WRONG_SESSION: '1' } : {}),
  })
  const environment = new MarivoEnvironment({
    projectRoot: root,
    pythonExecutable: executable,
    marivoVersion: '0.4.test',
    packagePath: path.join(root, 'fake-marivo', '__init__.py'),
    subprocessPolicyId: policy.id,
    fingerprint: options.fingerprint ?? 'f'.repeat(64),
  }, policy)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const session = Session.create(SessionId(`dsh-${path.basename(root)}`))
  const disposeTool = registerMarivoEvidenceCiteTool(ctx, environment, session)
  return {
    root, recordPath, ctx, session, environment, disposeTool,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

let callSequence = 0
async function cite(ctx: Context, sessionId: string, findingIds: string[], language: 'en' | 'zh' | string = 'zh') {
  callSequence++
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`cite-${callSequence}`),
    name: MARIVO_EVIDENCE_CITE_TOOL_NAME,
    arguments: { session_id: sessionId, finding_ids: findingIds, language },
  })
}

function valueOf(result: Awaited<ReturnType<typeof cite>>): MarivoEvidenceCiteValue {
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) throw new Error('unreachable')
  return result.value as unknown as MarivoEvidenceCiteValue
}

test('exact Finding reads allocate ordered handles and reuse identities without partial registries', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)

  const firstResult = await cite(f.ctx, 'mv-session-a', ['finding-a', 'finding-b'])
  const first = valueOf(firstResult)
  assert.deepEqual(first.requested.map(item => item.handle), ['F1', 'F2'])
  assert.deepEqual(first.requested.map(item => item.marker), ['[^mv-f1]', '[^mv-f2]'])
  assert.equal(first.language, 'zh')
  assert.equal(first.requested[0]?.definition, '[^mv-f1]: 指标 finding-a：观测值为 12。')
  assert.deepEqual(first.registry[0]?.rendered, {
    en: 'Metric finding-a: observed 12.', zh: '指标 finding-a：观测值为 12。',
  })
  assert.deepEqual(first.registry.map(item => item.findingId), ['finding-a', 'finding-b'])
  assert.equal((firstResult as { meta?: { kind?: string } }).meta?.kind, MARIVO_CITATION_META_KIND)
  assert.equal(
    (firstResult as { meta?: { dshSessionId?: string } }).meta?.dshSessionId,
    String(f.session.id),
  )
  assert.equal((firstResult as { meta?: { version?: number } }).meta?.version, 2)

  const repeated = valueOf(await cite(f.ctx, 'mv-session-a', ['finding-b', 'finding-a']))
  assert.deepEqual(repeated.requested.map(item => item.handle), ['F2', 'F1'])
  assert.deepEqual(repeated.registry.map(item => item.handle), ['F1', 'F2'])

  const next = valueOf(await cite(f.ctx, 'mv-session-b', ['finding-a']))
  assert.deepEqual(next.requested.map(item => item.handle), ['F3'])
  assert.equal(next.requested[0]?.sessionId, 'mv-session-b')
  const calls = (await readFile(f.recordPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(calls[0].args, ['mv-session-a', '["finding-a","finding-b"]'])
})

test('one and twenty Findings are accepted while duplicate, empty, and twenty-one inputs fail', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  assert.deepEqual(valueOf(await cite(f.ctx, 'mv-size', ['only'])).requested.map(x => x.handle), ['F1'])
  const twenty = Array.from({ length: 20 }, (_, index) => `item-${index}`)
  assert.equal(valueOf(await cite(f.ctx, 'mv-size', twenty)).requested.length, 20)

  for (const ids of [[], ['same', 'same'], Array.from({ length: 21 }, (_, index) => `x-${index}`)]) {
    const result = await cite(f.ctx, 'mv-size', ids)
    assert.equal(result.isError, true)
  }
  assert.equal((await cite(f.ctx, 'mv-size', ['only'], 'fr')).isError, true)
})

test('selected language controls human-readable definitions and Markdown syntax is escaped', async (t) => {
  const f = await fixture({ mode: 'special-render' })
  t.after(f.cleanup)
  const english = valueOf(await cite(f.ctx, 'mv-language', ['finding-a'], 'en'))
  assert.equal(english.requested[0]?.definition, '[^mv-f1]: Metric\\_\\[unsafe\\] \\<tag\\> \\\\ exact')
  const chinese = valueOf(await cite(f.ctx, 'mv-language', ['finding-a'], 'zh'))
  assert.equal(chinese.requested[0]?.handle, 'F1')
  assert.equal(chinese.requested[0]?.definition, '[^mv-f1]: 指标\\_\\[不安全\\] \\<标签\\> \\\\ 精确')
  assert.equal(chinese.registry[0]?.rendered.en, 'Metric_[unsafe] <tag> \\ exact')
})

test('rendered statements accept the 8 KiB boundary and reject oversized bridge output', async (t) => {
  const bounded = await fixture({ mode: 'bounded-render' })
  t.after(bounded.cleanup)
  const accepted = valueOf(await cite(bounded.ctx, 'mv-bounded', ['finding-a'], 'en'))
  assert.equal(accepted.registry[0]?.rendered.en.length, 8_192)

  const oversized = await fixture({ mode: 'oversize-render' })
  t.after(oversized.cleanup)
  assert.equal((await cite(oversized.ctx, 'mv-oversized', ['finding-a'], 'zh')).isError, true)
})

test('the 100-handle cap fails atomically and leaves the complete prior registry reusable', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  for (let batch = 0; batch < 5; batch++) {
    const ids = Array.from({ length: 20 }, (_, index) => `finding-${batch * 20 + index}`)
    const value = valueOf(await cite(f.ctx, 'mv-cap', ids))
    assert.equal(value.registry.length, (batch + 1) * 20)
  }
  const overflow = await cite(f.ctx, 'mv-cap', ['finding-overflow'])
  assert.equal(overflow.isError, true)
  assert.match(JSON.stringify(overflow), new RegExp(String(MARIVO_CITATION_MAX_HANDLES)))
  const reused = valueOf(await cite(f.ctx, 'mv-cap', ['finding-99']))
  assert.deepEqual(reused.requested.map(item => item.handle), ['F100'])
  assert.equal(reused.registry.length, 100)
})

test('different DSH Sessions allocate independently even against one environment and Finding', async (t) => {
  const first = await fixture({ fingerprint: 'a'.repeat(64) })
  const second = await fixture({ fingerprint: 'a'.repeat(64) })
  t.after(first.cleanup)
  t.after(second.cleanup)
  assert.equal(valueOf(await cite(first.ctx, 'mv-shared', ['finding-shared'])).requested[0]?.handle, 'F1')
  assert.equal(valueOf(await cite(second.ctx, 'mv-shared', ['finding-shared'])).requested[0]?.handle, 'F1')
})

test('a new tool instance restores the latest complete registry from standard tool/result meta', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const issuedResult = await cite(f.ctx, 'mv-replay', ['finding-a'])
  const issued = valueOf(issuedResult)
  const meta = (issuedResult as { meta?: unknown }).meta
  assert.ok(meta)
  const callId = CallId('persisted-citation')
  f.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: issued.requested[0]?.definition ?? '' }],
      isError: false,
    }),
    meta: meta as never,
  }, { surfaceOp: 'append' })
  f.disposeTool()
  registerMarivoEvidenceCiteTool(f.ctx, f.environment, f.session)

  const replayed = valueOf(await cite(f.ctx, 'mv-replay', ['finding-a', 'finding-b']))
  assert.deepEqual(replayed.requested.map(item => item.handle), ['F1', 'F2'])
})

test('a forked DSH Session does not restore its parent Session registry', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const issuedResult = await cite(f.ctx, 'mv-parent', ['finding-parent'])
  const meta = (issuedResult as { meta?: unknown }).meta
  assert.ok(meta)
  f.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId('persisted-parent-citation'),
      content: [{ type: 'text', text: 'parent citation' }],
      isError: false,
    }),
    meta: meta as never,
  }, { surfaceOp: 'append' })

  const childId = SessionId(`child-${path.basename(f.root)}`)
  const child = Session.create(childId, f.session.events, {
    version: 0,
    id: childId,
    createdAt: Date.now(),
    parentSession: f.session.id,
    seedLength: f.session.events.length,
  })
  assert.deepEqual(new MarivoCitationRegistry(child).snapshot(), [])
  f.disposeTool()
  const disposeChildTool = registerMarivoEvidenceCiteTool(f.ctx, f.environment, child)
  t.after(disposeChildTool)
  const childValue = valueOf(await cite(f.ctx, 'mv-child', ['finding-child']))
  assert.equal(childValue.requested[0]?.handle, 'F1')
  assert.equal(childValue.dshSessionId, String(child.id))
})

test('Finding vocabulary stays owned by the bound Marivo runtime', async (t) => {
  const f = await fixture({ mode: 'extended-vocabulary' })
  t.after(f.cleanup)
  const value = valueOf(await cite(f.ctx, 'mv-vocabulary', ['finding-future']))
  assert.equal(value.requested[0]?.findingType, 'future_finding_type')
  assert.equal(value.requested[0]?.epistemicKind, 'future_epistemic_kind')
  assert.equal(value.requested[0]?.qualityStatus, 'future_quality_status')
})

test('read failures, invalid JSON, missing render capability, and identity mismatches fail without successful values', async (t) => {
  for (const mode of ['read-failed', 'invalid-json', 'render-unavailable', 'identity']) {
    await t.test(mode, async (t) => {
      const f = await fixture({ mode })
      t.after(f.cleanup)
      const result = await cite(f.ctx, 'mv-errors', ['finding-a'])
      assert.equal(result.isError, true)
      if (mode === 'identity') assert.equal(f.environment.status, 'failed')
    })
  }
  const wrong = await fixture({ wrongSession: true })
  t.after(wrong.cleanup)
  assert.equal((await cite(wrong.ctx, 'mv-errors', ['finding-a'])).isError, true)
})

test('Evidence bridge timeout is bounded by the shared subprocess policy', async (t) => {
  const f = await fixture({ mode: 'slow' })
  t.after(f.cleanup)
  await assert.rejects(
    () => f.environment.runCheckedEvidenceFindings(
      'mv-timeout',
      ['finding-a'],
      { timeoutMs: 30, stdoutMaxBytes: 1_024, stderrMaxBytes: 1_024 },
    ),
    (error: unknown) => error instanceof Error && error.message.includes('exceeded 30 ms'),
  )
})
