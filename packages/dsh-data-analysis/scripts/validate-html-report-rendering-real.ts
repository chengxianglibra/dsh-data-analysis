import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, {
  createUserMessage,
  type ContentBlock,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  bindMarivoEnvironment,
  FixedSubprocessPolicy,
} from '../src/environment/index.ts'
import { apply, inject } from '../src/plugin.ts'
import {
  MARIVO_REPORT_RENDER_TOOL_NAME,
  parseReportProjection,
  reportDocumentDigest,
  type ReportDocumentV1,
  type ReportRenderValueV1,
} from '../src/report/index.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash'
const defaultSharedPython = path.join(
  resolveDshHome(),
  'dsh-data-analysis',
  'runtimes',
  'marivo',
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
)
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON ?? defaultSharedPython
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
const runRoot = path.join(workspaceRoot, 'artifacts', 'html-report-rendering-real', runId)
const fixtureRoot = path.join(runRoot, 'workspace')
const validationHome = path.join(runRoot, 'dsh-home')
const runtimeRoot = path.join(runRoot, 'runtime')
const validationPath = path.join(runRoot, 'validation.json')

interface FixtureValue {
  sessionId: string
  timeSeries: {
    ref: string
    findingId: string
    columns: string[]
    rowCount: number
  }
  segmented: {
    ref: string
    findingId: string
    columns: string[]
    rowCount: number
  }
}

interface UsageTotals extends TokenUsage {
  billedInputTokens: number
  totalTokens: number
}

interface ReportCallSummary {
  callId: string
  arguments: unknown
  status: 'ready' | 'blocked' | 'error' | 'missing-result'
  stage?: string
  issueCodes?: string[]
  title?: string
  path?: string
  reportDigest?: string
  documentDigest?: string
}

interface TurnResult {
  id: string
  completed: boolean
  finalText: string
  reportCalls: ReportCallSummary[]
  steps: number
  latencyMs: number
  usage: UsageTotals
  errors: Array<{ name: string; code?: string; message: string }>
}

interface ObservedToolResult {
  isError: boolean
  value?: unknown
  errorText?: string
}

const observedResults = new Map<string, ObservedToolResult>()

async function writeEarlyFailure(stage: string, error: unknown): Promise<void> {
  await mkdir(path.dirname(validationPath), { recursive: true })
  await writeFile(validationPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'failed',
    runId,
    model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
    environment: {
      pythonExecutable,
      credentialValuesRecorded: false,
      validationHome,
      fixtureRoot,
    },
    stage,
    failure: errorSummary(error),
  }, null, 2)}\n`, { mode: 0o600 })
  await chmod(validationPath, 0o600)
  process.stderr.write(`${JSON.stringify({ status: 'failed', stage, runRoot, validationPath }, null, 2)}\n`)
}

function textFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function finalAssistantText(events: readonly SessionEvent[]): string {
  const last = events.filter(event => event.type === 'assistant/message').at(-1)
  return last?.type === 'assistant/message' ? textFromBlocks(last.data.message.content) : ''
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return { malformed: true }
  }
}

function errorSummary(error: unknown): { name: string; code?: string; message: string } {
  if (!(error instanceof Error)) return { name: 'UnknownError', message: String(error) }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return { name: error.name, ...code === undefined ? {} : { code }, message: error.message }
}

function usageTotals(events: readonly SessionEvent[]): UsageTotals {
  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    billedInputTokens: 0,
    totalTokens: 0,
  }
  for (const event of events) {
    if (event.type !== 'assistant/message' || event.data.usage === undefined) continue
    const usage = event.data.usage
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    totals.cacheReadTokens! += usage.cacheReadTokens ?? 0
    totals.cacheWriteTokens! += usage.cacheWriteTokens ?? 0
    totals.reasoningTokens! += usage.reasoningTokens ?? 0
  }
  totals.billedInputTokens = totals.inputTokens
    + (totals.cacheReadTokens ?? 0)
    + (totals.cacheWriteTokens ?? 0)
  totals.totalTokens = totals.billedInputTokens + totals.outputTokens
  return totals
}

function reportCalls(events: readonly SessionEvent[]): ReportCallSummary[] {
  return events.flatMap((event): ReportCallSummary[] => {
    if (event.type !== 'tool/call' || event.data.name !== MARIVO_REPORT_RENDER_TOOL_NAME) return []
    const callId = String(event.data.callId)
    const args = parseArguments(event.data.arguments)
    const observed = observedResults.get(callId)
    if (observed === undefined) return [{ callId, arguments: args, status: 'missing-result' }]
    if (observed.isError) return [{ callId, arguments: args, status: 'error' }]
    const value = observed.value as ReportRenderValueV1 | undefined
    if (value?.status === 'blocked') {
      return [{
        callId,
        arguments: args,
        status: 'blocked',
        stage: value.stage,
        issueCodes: value.issues.map(issue => issue.code),
      }]
    }
    if (value?.status === 'ready') {
      return [{
        callId,
        arguments: args,
        status: 'ready',
        title: value.title,
        path: value.path,
        reportDigest: value.report_digest,
        documentDigest: value.document_digest,
      }]
    }
    return [{ callId, arguments: args, status: 'missing-result' }]
  })
}

function markerFor(id: string): string {
  return `HTML_REPORT_${id.toUpperCase().replaceAll('-', '_')}_OK`
}

function exactDocument(call: ReportCallSummary): ReportDocumentV1 {
  assert.equal(typeof call.arguments, 'object')
  assert.notEqual(call.arguments, null)
  const document = (call.arguments as { document?: unknown }).document
  assert.equal(typeof document, 'object')
  assert.notEqual(document, null)
  return document as ReportDocumentV1
}

function blockKinds(document: ReportDocumentV1): string[] {
  return document.sections.flatMap(section => section.blocks.map(block => block.kind))
}

function readyCall(result: TurnResult): ReportCallSummary {
  const ready = result.reportCalls.filter(call => call.status === 'ready')
  assert.equal(ready.length, 1, JSON.stringify(result.reportCalls))
  return ready[0]!
}

async function assertReadyArtifact(call: ReportCallSummary): Promise<void> {
  assert.equal(call.status, 'ready')
  assert.ok(call.path)
  assert.ok(call.reportDigest)
  assert.ok(call.documentDigest)
  const info = await stat(call.path)
  assert.ok(info.isFile())
  if (process.platform !== 'win32') assert.equal(info.mode & 0o077, 0)
  const html = await readFile(call.path, 'utf8')
  assert.match(html, /<svg class="chart"/)
  assert.match(html, /bar-series/)
  assert.match(html, /<table/)
  assert.match(html, /class="block evidence-block"/)
  assert.match(html, /@media print/)
  assert.doesNotMatch(html, /<script\b|<iframe\b|https?:\/\//)
}

async function createFixture(): Promise<FixtureValue> {
  await mkdir(path.join(fixtureRoot, 'models', 'datasources'), { recursive: true })
  await mkdir(path.join(fixtureRoot, 'models', 'semantic', 'sales'), { recursive: true })
  await writeFile(
    path.join(fixtureRoot, 'marivo.toml'),
    '[project]\nname = "html-report-rendering-real"\n',
  )
  await writeFile(
    path.join(fixtureRoot, 'models', 'datasources', 'warehouse.py'),
    [
      'import marivo.datasource as md',
      "md.duckdb(name='warehouse', path=':memory:')",
      '',
    ].join('\n'),
  )
  await writeFile(path.join(fixtureRoot, 'models', 'semantic', 'sales', '__init__.py'), '')
  await writeFile(
    path.join(fixtureRoot, 'models', 'semantic', 'sales', '_domain.py'),
    [
      'import marivo.semantic as ms',
      "ms.domain(name='sales', owner='DSH validation')",
      '',
    ].join('\n'),
  )
  await writeFile(
    path.join(fixtureRoot, 'models', 'semantic', 'sales', 'datasets.py'),
    [
      'import marivo.datasource as md',
      'import marivo.semantic as ms',
      '',
      "orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))",
      '',
      "@ms.time_dimension(entity=orders, granularity='day', is_default=True)",
      'def order_date(orders):',
      "    return orders.created_at.cast('date')",
      '',
      '@ms.dimension(entity=orders)',
      'def platform(orders):',
      '    return orders.platform',
      '',
      "@ms.metric(entities=[orders], additivity='additive', name='revenue')",
      'def revenue(orders):',
      '    return orders.amount.sum()',
      '',
    ].join('\n'),
  )

  const fixtureScript = String.raw`
import json
import os
import sys

import ibis
import marivo.analysis as mv
import marivo.semantic as ms

workspace = os.path.abspath(sys.argv[1])
os.chdir(workspace)
connection = ibis.duckdb.connect(":memory:")
connection.raw_sql("CREATE TABLE orders (order_id INTEGER, created_at DATE, amount DOUBLE, platform VARCHAR)")
connection.raw_sql("""
INSERT INTO orders VALUES
  (1, DATE '2026-08-20', 90.0, 'android'),
  (2, DATE '2026-08-20', 30.0, 'ios'),
  (3, DATE '2026-08-20', 20.0, 'web'),
  (4, DATE '2026-08-21', 95.0, 'android'),
  (5, DATE '2026-08-21', 32.0, 'ios'),
  (6, DATE '2026-08-21', 21.0, 'web'),
  (7, DATE '2026-08-22', 88.0, 'android'),
  (8, DATE '2026-08-22', 35.0, 'ios'),
  (9, DATE '2026-08-22', 22.0, 'web'),
  (10, DATE '2026-08-23', 101.0, 'android'),
  (11, DATE '2026-08-23', 38.0, 'ios'),
  (12, DATE '2026-08-23', 25.0, 'web'),
  (13, DATE '2026-08-24', 108.0, 'android'),
  (14, DATE '2026-08-24', 40.0, 'ios'),
  (15, DATE '2026-08-24', 26.0, 'web'),
  (16, DATE '2026-08-25', 112.0, 'android'),
  (17, DATE '2026-08-25', 42.0, 'ios'),
  (18, DATE '2026-08-25', 28.0, 'web')
""")
session = mv.session.get_or_create(
    name="html-report-rendering-real",
    backends={"warehouse": lambda: connection},
    use_datasources=False,
)
metric = session.catalog.metrics.get("sales.revenue")
platform = session.catalog.dimensions.get("sales.orders.platform")
time_series = session.observe(
    metrics=metric,
    time_scope=mv.time_scope(start="2026-08-20", end="2026-08-26"),
    grain=mv.grain("day"),
)
segmented = session.observe(metrics=metric, dimensions=[platform])
time_finding = session.evidence.findings(artifact_ref=time_series.ref, limit=20).items[0]
segment_finding = session.evidence.findings(artifact_ref=segmented.ref, limit=20).items[0]
assert session.revalidate(time_series).status == "admissible"
assert session.revalidate(segmented).status == "admissible"
print(json.dumps({
    "sessionId": session.id,
    "timeSeries": {
        "ref": time_series.ref,
        "findingId": time_finding.finding_id,
        "columns": list(time_series.columns),
        "rowCount": time_series.shape[0],
    },
    "segmented": {
        "ref": segmented.ref,
        "findingId": segment_finding.finding_id,
        "columns": list(segmented.columns),
        "rowCount": segmented.shape[0],
    },
}, ensure_ascii=False, allow_nan=False))
`
  const policy = new FixedSubprocessPolicy(fixtureRoot)
  const result = await policy.run({
    executable: pythonExecutable,
    args: ['-I', '-c', fixtureScript, fixtureRoot],
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  return JSON.parse(result.stdout.toString('utf8')) as FixtureValue
}

const fixture = await createFixture().catch(async (error) => {
  await writeEarlyFailure('fixture', error)
  throw error
})
assert.equal(fixture.timeSeries.rowCount, 6)
assert.equal(fixture.segmented.rowCount, 3)
assert.equal(fixture.timeSeries.columns.length, 2)
assert.equal(fixture.segmented.columns.length, 2)

const environment = await bindMarivoEnvironment({ projectRoot: fixtureRoot, pythonExecutable })
const findingGroups = [
  [fixture.timeSeries.findingId],
  [fixture.timeSeries.findingId],
  [fixture.segmented.findingId],
  [fixture.segmented.findingId],
]
const projection = await (async () => {
  const projectionChild = await environment.runCheckedReportProjection(
    fixture.sessionId,
    [fixture.timeSeries.ref, fixture.segmented.ref],
    findingGroups,
    { timeoutMs: 120_000, stdoutMaxBytes: 16 * 1024 * 1024 + 65_536, stderrMaxBytes: 65_536 },
  )
  assert.equal(projectionChild.exitCode, 0, projectionChild.stderr.toString('utf8'))
  const parsed = parseReportProjection(projectionChild.stdout, {
    sessionId: fixture.sessionId,
    artifactRefs: [fixture.timeSeries.ref, fixture.segmented.ref],
    findingIds: [fixture.timeSeries.findingId, fixture.segmented.findingId],
    findingGroups,
  })
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  return parsed
})().catch(async (error) => {
  await writeEarlyFailure('projection', error)
  throw error
})

const originalDshHome = process.env.DSH_HOME
const ctx = new Context()
let plugin: Awaited<ReturnType<Context['plugin']>> | undefined
const validationAgents: Agent[] = []
const journeys: TurnResult[] = []
let finalStatus: 'ok' | 'failed' = 'failed'
let failure: ReturnType<typeof errorSummary> | undefined

try {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalCredentialProvider, { watch: false })
  await ctx.plugin(DeepSeek, {
    thinking: 'disabled',
    reasoningEffort: 'off',
    maxTokens: 8_192,
    streamIdleTimeoutMs: 180_000,
    models: [{ id: model, contextWindow: 128_000, maxTokens: 8_192 }],
  })
  process.env.DSH_HOME = validationHome
  await ctx.plugin(SessionStore)
  await ctx.plugin(SkillRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

  ctx.systemPrompt.section({
    name: 'html-report-rendering-real:skill-catalog',
    order: 100,
    text: 'Available skill: marivo-analysis. Load it before governed Marivo analysis or report work.',
  })
  ctx.tools.register(defineTool({
    name: 'skill',
    description: 'Load the full instructions for one exact available skill.',
    parameters: { name: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<skill_content name="${value.name}">${value.content}</skill_content>`,
      }],
    },
    async execute({ name }, exec) {
      const skill = await ctx.skills.get(name, {
        cwd: exec.agent?.session.header.cwd ?? fixtureRoot,
        scope: exec.agent,
        signal: exec.signal,
      })
      if (skill === undefined) throw new Error(`unknown skill ${name}`)
      return { name: skill.name, provider: skill.provider, content: skill.content }
    },
  }))
  const stopResults = ctx.on('tools/result', (exec, result) => {
    if (exec.name !== MARIVO_REPORT_RENDER_TOOL_NAME) return
    observedResults.set(String(exec.callId), result.isError
      ? {
          isError: true,
          errorText: result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
        }
      : { isError: false, value: structuredClone(result.value) })
  })

  plugin = await ctx.plugin({
    name: 'dsh-data-analysis-html-report-real-validation',
    inject,
    apply,
  }, {
    runtimeRoot,
    pythonExecutable,
  })

  async function runTurn(agent: Agent, id: string, prompt: string): Promise<TurnResult> {
    const errors: unknown[] = []
    const startIndex = agent.session.events.length
    const stopErrors = agent.ctx.on('agent/error', payload => errors.push(payload.error))
    const startedAt = performance.now()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    const events = agent.session.events.slice(startIndex)
    const finalText = finalAssistantText(events)
    const result: TurnResult = {
      id,
      completed: finalText.includes(markerFor(id)),
      finalText,
      reportCalls: reportCalls(events),
      steps: events.filter(event => event.type === 'step/start').length,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      usage: usageTotals(events),
      errors: errors.map(errorSummary),
    }
    stopErrors()
    journeys.push(result)
    return result
  }

  const reportAgent = ctx.agentLoop.create(SessionId(`html-report-real-main-${runId}`), {
    provider: 'deepseek-official',
    model,
    maxTokens: 8_192,
  }, { cwd: fixtureRoot })
  validationAgents.push(reportAgent)
  const timeX = fixture.timeSeries.columns[0]!
  const timeY = fixture.timeSeries.columns[1]!
  const segmentX = fixture.segmented.columns[0]!
  const segmentY = fixture.segmented.columns[1]!
  const initial = await runTurn(reportAgent, 'initial-generation', [
    'I explicitly request a durable Chinese HTML analysis report.',
    'Call skill exactly once with {"name":"marivo-analysis"}, then call marivo_report_render.',
    `Use exact Marivo session_id ${JSON.stringify(fixture.sessionId)}.`,
    `Use time-series Artifact ${JSON.stringify(fixture.timeSeries.ref)} with columns ${JSON.stringify(fixture.timeSeries.columns)} and Finding ${JSON.stringify(fixture.timeSeries.findingId)}.`,
    `Use segmented Artifact ${JSON.stringify(fixture.segmented.ref)} with columns ${JSON.stringify(fixture.segmented.columns)} and Finding ${JSON.stringify(fixture.segmented.findingId)}.`,
    'Submit one complete dsh-data-analysis-report/v1 document titled “支付收入分析报告”.',
    `It must include text plus: an explicit line chart x=${JSON.stringify(timeX)} y=${JSON.stringify(timeY)}, an explicit bar chart x=${JSON.stringify(segmentX)} y=${JSON.stringify(segmentY)}, a table with max_rows=5, and an evidence block.`,
    `Every data/source block must use its exact Artifact/Finding above. End the final response with ${markerFor('initial-generation')}.`,
  ].join('\n'))
  assert.ok(initial.completed, initial.finalText)
  assert.equal(initial.errors.length, 0, JSON.stringify(initial.errors))
  assert.ok(initial.reportCalls.length >= 1, JSON.stringify(initial.reportCalls))
  assert.equal(initial.reportCalls.at(-1)?.status, 'ready', JSON.stringify(initial.reportCalls))
  const initialReady = readyCall(initial)
  const initialDocument = exactDocument(initialReady)
  assert.deepEqual(new Set(blockKinds(initialDocument)), new Set(['text', 'chart', 'table', 'evidence']))
  assert.equal(initialReady.documentDigest, reportDocumentDigest(initialDocument))
  await assertReadyArtifact(initialReady)

  const revision = await runTurn(reportAgent, 'complete-revision', [
    'Revise the durable report already created in this conversation.',
    'Submit another complete ReportDocument, never a patch and never read the old document from disk.',
    'Change the title to “支付收入分析报告（修订版）”, put the platform breakdown section before the trend section, and add a subtitle explaining that this is the revised layout.',
    'Retain text, explicit line, explicit bar, table, and evidence blocks with the same exact session, Artifacts, columns, and Findings from the previous turn.',
    `End the final response with ${markerFor('complete-revision')}.`,
  ].join('\n'))
  assert.ok(revision.completed, revision.finalText)
  assert.equal(revision.errors.length, 0, JSON.stringify(revision.errors))
  assert.ok(revision.reportCalls.length >= 1, JSON.stringify(revision.reportCalls))
  assert.equal(revision.reportCalls.at(-1)?.status, 'ready', JSON.stringify(revision.reportCalls))
  const revisionReady = readyCall(revision)
  const revisionDocument = exactDocument(revisionReady)
  assert.deepEqual(new Set(blockKinds(revisionDocument)), new Set(['text', 'chart', 'table', 'evidence']))
  assert.equal(revisionReady.documentDigest, reportDocumentDigest(revisionDocument))
  assert.notEqual(revisionReady.reportDigest, initialReady.reportDigest)
  assert.notEqual(revisionReady.documentDigest, initialReady.documentDigest)
  assert.notEqual(revisionReady.path, initialReady.path)
  await assertReadyArtifact(initialReady)
  await assertReadyArtifact(revisionReady)

  const repairAgent = ctx.agentLoop.create(SessionId(`html-report-real-repair-${runId}`), {
    provider: 'deepseek-official',
    model,
    maxTokens: 8_192,
  }, { cwd: fixtureRoot })
  validationAgents.push(repairAgent)
  const repaired = await runTurn(repairAgent, 'blocked-repair', [
    'I explicitly request a durable Chinese HTML report and a repair demonstration.',
    'Call skill exactly once with {"name":"marivo-analysis"}.',
    `Use exact session ${JSON.stringify(fixture.sessionId)}, time Artifact ${JSON.stringify(fixture.timeSeries.ref)} and Finding ${JSON.stringify(fixture.timeSeries.findingId)}, segmented Artifact ${JSON.stringify(fixture.segmented.ref)} and Finding ${JSON.stringify(fixture.segmented.findingId)}.`,
    `The complete document must contain text, line (${JSON.stringify(timeX)}, ${JSON.stringify(timeY)}), bar (${JSON.stringify(segmentX)}, ${JSON.stringify(segmentY)}), table, and evidence blocks.`,
    'For the first marivo_report_render call deliberately set the table max_rows to 0. After the Tool returns blocked, follow its issue and submit another complete document with max_rows=5. Do not stop after the blocked result.',
    `End the final response with ${markerFor('blocked-repair')}.`,
  ].join('\n'))
  assert.ok(repaired.completed, repaired.finalText)
  assert.equal(repaired.errors.length, 0, JSON.stringify(repaired.errors))
  assert.ok(repaired.reportCalls.length >= 2, JSON.stringify(repaired.reportCalls))
  assert.equal(repaired.reportCalls.at(-1)?.status, 'ready', JSON.stringify(repaired.reportCalls))
  const documentBlocked = repaired.reportCalls.find(call => (
    call.status === 'blocked' && call.stage === 'document'
  ))
  assert.ok(documentBlocked, JSON.stringify(repaired.reportCalls))
  assert.ok((documentBlocked.issueCodes?.length ?? 0) > 0)
  const repairedReady = readyCall(repaired)
  const repairedDocument = exactDocument(repairedReady)
  assert.deepEqual(new Set(blockKinds(repairedDocument)), new Set(['text', 'chart', 'table', 'evidence']))
  await assertReadyArtifact(repairedReady)

  for (const call of [initialReady, revisionReady, repairedReady]) {
    const reportDirectory = path.dirname(call.path!)
    assert.deepEqual((await Promise.all([
      stat(path.join(reportDirectory, 'index.html')),
      stat(path.join(reportDirectory, 'manifest.json')),
      stat(path.join(reportDirectory, 'report-document.json')),
    ])).map(item => item.isFile()), [true, true, true])
  }
  const reportsRoot = path.join(validationHome, 'dsh-data-analysis', 'reports')
  const reportTree = JSON.stringify(await readFile(path.join(path.dirname(initialReady.path!), 'manifest.json'), 'utf8'))
  assert.doesNotMatch(reportTree, /credential|api[_-]?key/i)
  await assert.rejects(() => stat(path.join(reportsRoot, 'latest')), { code: 'ENOENT' })
  await assert.rejects(() => stat(path.join(reportsRoot, 'registry.json')), { code: 'ENOENT' })
  await assert.rejects(() => stat(path.join(reportsRoot, 'state.json')), { code: 'ENOENT' })

  stopResults()
  finalStatus = 'ok'
} catch (error) {
  failure = errorSummary(error)
  throw error
} finally {
  const validation = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: finalStatus,
    runId,
    model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
    environment: {
      binding: environment.binding,
      credentialValuesRecorded: false,
      validationHome,
      fixtureRoot,
    },
    fixture,
    projection: {
      status: projection.ok ? 'ready' : 'blocked',
      artifactCount: projection.ok ? projection.value.artifacts.length : 0,
      findingCount: projection.ok ? projection.value.findings.length : 0,
      compatibilityCount: projection.ok ? projection.value.compatibilities.length : 0,
    },
    journeys,
    ...(failure === undefined ? {} : { failure }),
  }
  await mkdir(path.dirname(validationPath), { recursive: true })
  await writeFile(validationPath, `${JSON.stringify(validation, null, 2)}\n`, { mode: 0o600 })
  await chmod(validationPath, 0o600)
  await plugin?.dispose()
  for (const agent of validationAgents) {
    assert.equal(agent.ctx.tools.get(MARIVO_REPORT_RENDER_TOOL_NAME, agent), undefined)
  }
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  process.stdout.write(`${JSON.stringify({
    status: finalStatus,
    runRoot,
    validationPath,
    journeyCount: journeys.length,
  }, null, 2)}\n`)
}
