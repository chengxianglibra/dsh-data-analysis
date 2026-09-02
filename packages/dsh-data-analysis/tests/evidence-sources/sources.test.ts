import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'
import {
  installMarivoEvidenceSourcesCodeDelivery,
  MARIVO_EVIDENCE_SOURCES_META_KIND,
  MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
  MarivoEvidenceBridge,
  type MarivoEvidenceSourcesValue,
  registerMarivoEvidenceSourcesTool,
} from '../../src/evidence/index.ts'

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
const script = args[1] ?? ''
if (!script.includes('artifact = session.artifact')) process.exit(2)
const sessionId = args[5]
const selections = JSON.parse(args[6] ?? 'null')
appendFileSync(process.env.RECORD_PATH, JSON.stringify({ sessionId, selections, args: args.slice(5) }) + '\n')
if (process.env.EVIDENCE_MODE === 'identity') process.exit(78)
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
const sources = selections.map((selection, index) => ({
  status: process.env.EVIDENCE_MODE === 'missing'
    ? 'missing'
    : process.env.EVIDENCE_MODE === 'unsupported' ? 'unsupported' : 'available',
  title: 'metric_value Finding: item-' + selection.findingId,
  locator: 'marivo://session/' + sessionId + '/artifact/' + selection.artifactRef + '/finding/' + selection.findingId,
  excerpt: process.env.EVIDENCE_MODE === 'missing' || process.env.EVIDENCE_MODE === 'unsupported'
    ? null
    : process.env.EVIDENCE_MODE === 'bounded-render'
      ? 'x'.repeat(4096)
      : process.env.EVIDENCE_MODE === 'oversize-render'
        ? 'x'.repeat(4097)
        : process.env.EVIDENCE_MODE === 'truncated'
          ? 'Finding\noutput truncated at 4096 bytes; omitted: source_refs'
          : 'Metric ' + selection.findingId + ': observed 12.',
  truncated: process.env.EVIDENCE_MODE === 'truncated',
  finding_id: selection.findingId,
  finding_type: process.env.EVIDENCE_MODE === 'missing' ? null : process.env.EVIDENCE_MODE === 'extended-vocabulary'
    ? 'future_finding_type'
    : (index % 2 === 0 ? 'metric_value' : 'delta'),
  epistemic_kind: process.env.EVIDENCE_MODE === 'missing' ? null : process.env.EVIDENCE_MODE === 'extended-vocabulary'
    ? 'future_epistemic_kind'
    : (index % 2 === 0 ? 'observed' : 'algebraic'),
  artifact_ref: selection.artifactRef,
  session_id: process.env.WRONG_SESSION === '1' ? 'other-session' : sessionId,
  canonical_item_key: process.env.EVIDENCE_MODE === 'missing' ? null : 'item-' + selection.findingId,
  committed_at: process.env.EVIDENCE_MODE === 'missing' ? null : '2026-08-26T00:00:00+00:00',
  source_refs: process.env.EVIDENCE_MODE === 'missing' ? [] : ['frame-source#row=' + index],
  revalidation: {
    status: 'admissible',
    semantic_status: 'current',
    evidence_status: 'complete',
    dependency_status: 'admissible',
  },
}))
process.stdout.write(JSON.stringify({ session_id: sessionId, sources }))
`

async function fixture(options: { mode?: string; wrongSession?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-marivo-sources-')))
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
  const environment = new MarivoEnvironment(
    {
      projectRoot: root,
      pythonExecutable: executable,
      marivoVersion: '0.4.test',
      packagePath: path.join(root, 'fake-marivo', '__init__.py'),
      subprocessPolicyId: policy.id,
      fingerprint: 'f'.repeat(64),
    },
    policy,
  )
  const bridge = new MarivoEvidenceBridge(environment)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const session = Session.create(SessionId(`dsh-${path.basename(root)}`))
  const disposeTool = registerMarivoEvidenceSourcesTool(ctx, bridge, session)
  return {
    root,
    recordPath,
    ctx,
    session,
    environment,
    bridge,
    disposeTool,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

let callSequence = 0
async function sources(ctx: Context, sessionId: string, findingIds: string[]) {
  callSequence++
  const requested = findingIds.map((findingId, index) => ({
    artifact_ref: index < 2 ? 'artifact-shared' : `artifact-${findingId}`,
    finding_id: findingId,
  }))
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`sources-${callSequence}`),
    name: MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
    arguments: { session_id: sessionId, sources: requested },
  })
}

function sourceValue(result: Awaited<ReturnType<typeof sources>>): MarivoEvidenceSourcesValue {
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) throw new Error('unreachable')
  return result.value as unknown as MarivoEvidenceSourcesValue
}

test('exact Finding reads return only this call sources without presentation noise', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  const tool = f.ctx.tools.get(MARIVO_EVIDENCE_SOURCES_TOOL_NAME)
  assert.ok(tool)
  assert.deepEqual(Object.keys((tool.parameters as any).properties), ['session_id', 'sources'])
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(tool.output.schema.additionalProperties, false)
  assert.deepEqual(Object.keys(tool.output.schema.properties ?? {}), [
    'status',
    'environment',
    'dshSessionId',
    'sessionId',
    'sources',
  ])

  const result = await sources(f.ctx, 'mv-session', ['finding-a', 'finding-b'])
  const value = sourceValue(result)
  assert.equal(value.status, 'ok')
  assert.equal(value.sources.length, 2)
  assert.deepEqual(
    value.sources.map((item) => item.findingId),
    ['finding-a', 'finding-b'],
  )
  assert.deepEqual(
    value.sources.map((item) => item.artifactRef),
    ['artifact-shared', 'artifact-shared'],
  )
  assert.equal(Object.hasOwn(value.sources[0] ?? {}, 'artifactId'), false)
  assert.equal(value.sources[0]?.excerpt, 'Metric finding-a: observed 12.')
  assert.equal(value.sources[0]?.status, 'available')
  assert.equal(value.sources[0]?.revalidation?.status, 'admissible')
  assert.equal(Object.hasOwn(value, 'registry'), false)
  assert.equal(Object.hasOwn(value.sources[0] ?? {}, 'handle'), false)
  assert.equal(Object.hasOwn(value.sources[0] ?? {}, 'marker'), false)
  assert.equal(Object.hasOwn(value.sources[0] ?? {}, 'definition'), false)
  const meta = (result as { meta?: Record<string, unknown> }).meta
  assert.equal(meta?.kind, MARIVO_EVIDENCE_SOURCES_META_KIND)
  assert.equal(meta?.version, 2)
  assert.equal(meta?.dshSessionId, String(f.session.id))
  assert.deepEqual(meta?.sources, value.sources)
  assert.doesNotMatch(JSON.stringify(result.content), /\[\^mv-|footnote definition/i)

  const second = sourceValue(await sources(f.ctx, 'mv-session', ['finding-b']))
  assert.deepEqual(
    second.sources.map((item) => item.findingId),
    ['finding-b'],
  )
  assert.equal((await readFile(f.recordPath, 'utf8')).trim().split('\n').length, 2)
})

test('closed output schema rejects malformed policy replacements before projection', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  f.ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name !== MARIVO_EVIDENCE_SOURCES_TOOL_NAME || result.isError) return next()
    return {
      kind: 'accept',
      value: {
        ...(result.value as Record<string, unknown>),
        unexpectedRegistry: [],
      },
    } as never
  })

  const result = await sources(f.ctx, 'mv-closed-output', ['finding-a'])
  assert.equal(result.isError, true)
  assert.deepEqual(result.error?.info, {
    name: 'ToolOutputError',
    code: 'INVALID_TOOL_OUTPUT',
  })
  assert.match(
    JSON.stringify(result.content),
    /value\.unexpectedRegistry.*additionalProperties: false/,
  )
  assert.equal('value' in result, false)
  assert.equal((result as { meta?: unknown }).meta, undefined)
})

test('input bounds and duplicate Artifact/Finding pairs fail before the Evidence subprocess', async (t) => {
  const f = await fixture()
  t.after(f.cleanup)
  for (const findingIds of [
    [],
    Array.from({ length: 21 }, (_, index) => `f-${index}`),
    ['x', 'x'],
  ]) {
    const result = await sources(f.ctx, 'mv-bounds', findingIds)
    assert.equal(result.isError, true)
  }
  const legacy = await f.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('legacy-finding-ids'),
    name: MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
    arguments: { session_id: 'mv-bounds', finding_ids: ['finding-a'] },
  })
  assert.equal(legacy.isError, true)
  await assert.rejects(() => readFile(f.recordPath), /ENOENT/)
})

test('render bounds, Marivo vocabulary, and identity stay fail closed', async (t) => {
  const bounded = await fixture({ mode: 'bounded-render' })
  t.after(bounded.cleanup)
  assert.equal(
    sourceValue(await sources(bounded.ctx, 'mv-bounded', ['finding-a'])).sources.length,
    1,
  )

  const extended = await fixture({ mode: 'extended-vocabulary' })
  t.after(extended.cleanup)
  const future = sourceValue(await sources(extended.ctx, 'mv-future', ['finding-a'])).sources[0]
  assert.equal(future?.findingType, 'future_finding_type')
  assert.equal(future?.epistemicKind, 'future_epistemic_kind')

  for (const mode of ['oversize-render', 'read-failed', 'invalid-json', 'identity']) {
    const f = await fixture({ mode })
    t.after(f.cleanup)
    assert.equal((await sources(f.ctx, 'mv-error', ['finding-a'])).isError, true)
  }
  const wrong = await fixture({ wrongSession: true })
  t.after(wrong.cleanup)
  assert.equal((await sources(wrong.ctx, 'mv-error', ['finding-a'])).isError, true)
})

test('headless transcript exposes bounded source, missing, unsupported, truncation, and revalidation states', async (t) => {
  for (const mode of [undefined, 'missing', 'unsupported', 'truncated'] as const) {
    const f = await fixture({ mode })
    t.after(f.cleanup)
    const result = await sources(f.ctx, 'mv-portable', ['finding-a'])
    assert.equal(result.isError, false)
    const text = result.content.map((item) => ('text' in item ? item.text : '')).join('\n')
    assert.match(text, /locator: marivo:\/\/session\/mv-portable/)
    assert.match(text, /revalidation: admissible/)
    assert.match(text, /source identity and availability do not prove/i)
    if (mode === 'missing') assert.match(text, /status: missing.*excerpt: unavailable/s)
    if (mode === 'unsupported') assert.match(text, /status: unsupported.*excerpt: unavailable/s)
    if (mode === 'truncated') assert.match(text, /excerpt_state: truncated/)
  }
})

test('Evidence bridge timeout remains bounded by the shared subprocess policy', async (t) => {
  const f = await fixture({ mode: 'slow' })
  t.after(f.cleanup)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('test cancellation')), 30)
  await assert.rejects(() =>
    f.bridge.findings(
      'mv-timeout',
      [{ artifactRef: 'artifact-a', findingId: 'finding-a' }],
      controller.signal,
    ),
  )
  clearTimeout(timer)
})

test('Code Mode logs one durable source block without changing nested Tool text', async () => {
  const ctx = new Context()
  const dispose = installMarivoEvidenceSourcesCodeDelivery(ctx)
  const value: MarivoEvidenceSourcesValue = {
    status: 'ok',
    environment: { version: '0.4.test', fingerprint: 'f'.repeat(64) },
    dshSessionId: 'dsh-session',
    sessionId: 'mv-session',
    sources: [
      {
        status: 'available',
        title: 'metric_value Finding: item-a',
        locator: 'marivo://session/mv-session/artifact/artifact-a/finding/finding-a',
        excerpt: 'Observed 12.',
        truncated: false,
        environmentFingerprint: 'f'.repeat(64),
        sessionId: 'mv-session',
        findingId: 'finding-a',
        findingType: 'metric_value',
        epistemicKind: 'observed',
        artifactRef: 'artifact-a',
        canonicalItemKey: 'item-a',
        committedAt: '2026-08-26T00:00:00+00:00',
        sourceRefs: ['frame-source#row=0'],
        revalidation: {
          status: 'admissible',
          semanticStatus: 'current',
          evidenceStatus: 'complete',
          dependencyStatus: 'admissible',
        },
      },
    ],
  }
  const agent = {
    session: {
      events: [{ type: 'tool/call', data: { turn: 7, callId: 'outer', name: 'run_code' } }],
    },
  }
  const exec = {
    callId: 'outer:code:1',
    name: MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
    rootCallId: 'outer',
    parent: Symbol('outer'),
    agent,
  }
  ctx.emit('tools/result', exec as never, { isError: false, value, content: [] } as never)
  const original = [{ type: 'text', text: 'source result' }] as const
  const logged = await ctx.waterfall(
    'tools/code-dispatch-log',
    {
      exec: { rootCallId: 'outer' } as never,
      agent: agent as never,
      subCallId: 'outer:code:1',
      name: MARIVO_EVIDENCE_SOURCES_TOOL_NAME,
      isError: false,
      content: [...original],
    } as never,
    () => Promise.resolve([...original]),
  )
  assert.deepEqual(logged, [
    ...original,
    {
      type: 'marivo-evidence-sources-card',
      turn: 7,
      meta: {
        kind: 'marivo-evidence-sources',
        version: 2,
        dshSessionId: 'dsh-session',
        sources: value.sources,
      },
    },
  ])
  dispose()
})
