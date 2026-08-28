import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { Session, type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { bindMarivoEnvironment, FixedSubprocessPolicy } from '../src/environment/index.ts'
import {
  type MarivoEvidenceSourcesValue,
  registerMarivoEvidenceSourcesTool,
} from '../src/evidence/index.ts'
import { installMarivoPlugin } from '../src/plugin.ts'
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
const runRoot = path.join(workspaceRoot, 'artifacts', 'evidence-sources-real', runId)
const fixtureRoot = path.join(runRoot, 'workspace')
const validationPath = path.join(runRoot, 'validation.json')

await mkdir(path.join(fixtureRoot, 'models', 'datasources'), { recursive: true })
await mkdir(path.join(fixtureRoot, 'models', 'semantic', 'sales'), { recursive: true })
await writeFile(
  path.join(fixtureRoot, 'marivo.toml'),
  '[project]\nname = "evidence-sources-real"\n',
)
await writeFile(
  path.join(fixtureRoot, 'models', 'datasources', 'warehouse.py'),
  "import marivo.datasource as md\nmd.duckdb(name='warehouse', path=':memory:')\n",
)
await writeFile(path.join(fixtureRoot, 'models', 'semantic', 'sales', '__init__.py'), '')
await writeFile(
  path.join(fixtureRoot, 'models', 'semantic', 'sales', '_domain.py'),
  "import marivo.semantic as ms\nms.domain(name='sales', owner='DSH validation')\n",
)
await writeFile(
  path.join(fixtureRoot, 'models', 'semantic', 'sales', 'datasets.py'),
  [
    'import marivo.datasource as md',
    'import marivo.semantic as ms',
    "orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))",
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

workspace = os.path.abspath(sys.argv[1])
os.chdir(workspace)
connection = ibis.duckdb.connect(":memory:")
connection.raw_sql("CREATE TABLE orders (order_id INTEGER, amount DOUBLE)")
connection.raw_sql("INSERT INTO orders VALUES (1, 12.0), (2, 8.0)")
session = mv.session.get_or_create(
    name="evidence-sources-real",
    backends={"warehouse": lambda: connection},
    use_datasources=False,
)
metric = session.catalog.metrics.get("sales.revenue")
frame = session.observe(metrics=metric)
finding = session.evidence.findings(artifact_ref=frame.ref, limit=20).items[0]
print(json.dumps({
    "sessionId": session.id,
    "findingId": finding.finding_id,
    "artifactId": finding.artifact_id,
    "rendered": {
        "en": finding.render(language="en"),
        "zh": finding.render(language="zh"),
    },
}, ensure_ascii=False, allow_nan=False))
`

const policy = new FixedSubprocessPolicy(fixtureRoot)
const fixtureResult = await policy.run({
  executable: pythonExecutable,
  args: ['-I', '-c', fixtureScript, fixtureRoot],
  limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
})
assert.equal(fixtureResult.exitCode, 0, fixtureResult.stderr.toString('utf8'))
const fixture = JSON.parse(fixtureResult.stdout.toString('utf8')) as {
  sessionId: string
  findingId: string
  artifactId: string
  rendered: { en: string; zh: string }
}

const environment = await bindMarivoEnvironment({ projectRoot: fixtureRoot, pythonExecutable })
const toolContext = new Context()
await toolContext.plugin(SystemPrompt)
await toolContext.plugin(ToolRuntime)
const session = Session.create(SessionId(`evidence-sources-real-${runId}`))
registerMarivoEvidenceSourcesTool(toolContext, environment, session)
const result = await toolContext.tools.execute({
  signal: new AbortController().signal,
  callId: CallId('sources'),
  name: 'marivo_evidence_sources',
  arguments: { session_id: fixture.sessionId, finding_ids: [fixture.findingId] },
})
assert.equal(result.isError, false, JSON.stringify(result))
if (result.isError) throw new Error('unreachable')
const value = result.value as unknown as MarivoEvidenceSourcesValue
assert.equal(value.sources.length, 1)
assert.equal(value.sources[0]?.findingId, fixture.findingId)
assert.equal(value.sources[0]?.artifactId, fixture.artifactId)
assert.deepEqual(value.sources[0]?.rendered, fixture.rendered)
assert.equal(Object.hasOwn(value.sources[0] ?? {}, 'marker'), false)
assert.equal(Object.hasOwn(value.sources[0] ?? {}, 'definition'), false)

function finalAssistantText(events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    return event.data.message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
  }
  return ''
}

function toolCalls(events: readonly SessionEvent[], name: string): SessionEvent[] {
  return events.filter((event) => event.type === 'tool/call' && event.data.name === name)
}

function successfulSourceResults(events: readonly SessionEvent[]): number {
  return events.filter(
    (event) =>
      event.type === 'tool/result' &&
      (event.data.meta as { kind?: unknown } | undefined)?.kind === 'marivo-evidence-sources' &&
      event.data.message.content.some(
        (block) => block.type === 'tool-result' && block.isError === false,
      ),
  ).length
}

async function runJourney(
  agent: Agent,
  prompt: string,
): Promise<{
  finalText: string
  skillCallCount: number
  sourceCallCount: number
  successfulSourceResultCount: number
}> {
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    }),
  )
  await agent.whenIdle()
  return {
    finalText: finalAssistantText(agent.session.events),
    skillCallCount: toolCalls(agent.session.events, 'skill').length,
    sourceCallCount: toolCalls(agent.session.events, 'marivo_evidence_sources').length,
    successfulSourceResultCount: successfulSourceResults(agent.session.events),
  }
}

const modelContext = new Context()
await modelContext.plugin(LlmRuntime)
await modelContext.plugin(LocalCredentialProvider, { watch: false })
await modelContext.plugin(DeepSeek, {
  thinking: 'disabled',
  reasoningEffort: 'off',
  maxTokens: 2_048,
  streamIdleTimeoutMs: 180_000,
  models: [{ id: model, contextWindow: 128_000, maxTokens: 2_048 }],
})
await modelContext.plugin(SessionStore)
await modelContext.plugin(SystemPrompt)
await modelContext.plugin(TestShellEnv)
await modelContext.plugin(ToolRuntime)
await modelContext.plugin(AgentRegistry)
await modelContext.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
modelContext.systemPrompt.section({
  name: 'evidence-sources-real:skill-catalog',
  order: 100,
  text: 'Available skill: marivo-analysis. Load it before governed Marivo analysis work.',
})
modelContext.tools.register(
  defineTool({
    name: 'skill',
    description: 'Load one exact available skill.',
    parameters: { name: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, skill) => [
        {
          type: 'text',
          text: `<skill_content name="${skill.name}">${skill.content}</skill_content>`,
        },
      ],
    },
    async execute({ name }) {
      if (name !== 'marivo-analysis') throw new Error(`unknown skill ${String(name)}`)
      return {
        name,
        provider: 'evidence-sources-real',
        content: [
          'Use exact persisted Marivo Findings and follow the active plugin source policy.',
          'The observed revenue is 20.',
          `The exact persisted Evidence identity is Marivo Session ${fixture.sessionId} and Finding ${fixture.findingId}.`,
        ].join(' '),
      }
    },
  }),
)
const disposePlugin = installMarivoPlugin(modelContext, environment)
const ordinaryAgent = modelContext.agentLoop.create(
  SessionId(`evidence-sources-ordinary-${runId}`),
  { provider: 'deepseek-official', model, maxTokens: 2_048 },
  { cwd: fixtureRoot },
)
const ordinary = await runJourney(
  ordinaryAgent,
  [
    '请先加载 marivo-analysis skill，然后用一句简短中文告诉我观测收入是多少。',
    '这是普通对话回答，不需要生成文件。',
    'End with ORDINARY_SOURCE_POLICY_OK.',
  ].join('\n'),
)
assert.match(ordinary.finalText, /ORDINARY_SOURCE_POLICY_OK/)
assert.equal(ordinary.skillCallCount, 1)
assert.equal(ordinary.sourceCallCount, 0)
assert.equal(ordinary.successfulSourceResultCount, 0)
assert.doesNotMatch(ordinary.finalText, /\[\^mv-|## Footnotes|Finding\s|artifact-/i)

const explicitAgent = modelContext.agentLoop.create(
  SessionId(`evidence-sources-explicit-${runId}`),
  { provider: 'deepseek-official', model, maxTokens: 2_048 },
  { cwd: fixtureRoot },
)
const explicit = await runJourney(
  explicitAgent,
  [
    '请先加载 marivo-analysis skill。',
    '请给我观测收入事实的准确来源和审计信息；正文只需简短确认来源已经附上。',
    'End with EXPLICIT_SOURCE_POLICY_OK.',
  ].join('\n'),
)
assert.match(explicit.finalText, /EXPLICIT_SOURCE_POLICY_OK/)
assert.equal(explicit.skillCallCount, 1)
assert.equal(explicit.sourceCallCount, 1)
assert.equal(explicit.successfulSourceResultCount, 1)
assert.doesNotMatch(explicit.finalText, /\[\^mv-|## Footnotes|Finding\s|artifact-/i)
assert.doesNotMatch(explicit.finalText, /(?:^|\D)20(?:\D|$)/)
assert.doesNotMatch(explicit.finalText, new RegExp(fixture.findingId))
assert.doesNotMatch(
  explicit.finalText,
  /Finding|Evidence|来源面板|Web panel|marivo_evidence_sources/i,
)
disposePlugin()

await writeFile(
  validationPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'ok',
      environment: {
        pythonExecutable,
        marivoVersion: environment.binding.marivoVersion,
        packagePath: environment.binding.packagePath,
        credentialValuesRecorded: false,
      },
      result: {
        sessionId: fixture.sessionId,
        findingId: fixture.findingId,
        artifactId: fixture.artifactId,
        languages: ['zh', 'en'],
        sourceNoisePresent: false,
      },
      modelJourneys: {
        model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
        ordinary,
        explicit,
      },
    },
    undefined,
    2,
  )}\n`,
)

process.stdout.write(`${validationPath}\n`)
