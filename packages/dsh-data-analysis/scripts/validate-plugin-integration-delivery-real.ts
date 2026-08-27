import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
import ToolRuntime, { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import {
  bindMarivoEnvironment,
  FixedSubprocessPolicy,
  parseDoctorReport,
} from '../src/environment/index.ts'
import { apply, inject } from '../src/plugin.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const reportPath = path.join(workspaceRoot, 'artifacts', 'plugin-integration-delivery-real-model.json')
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash'
const missingDatasourceCredentials = [
  'DSH_VALIDATION_USER',
  'DSH_VALIDATION_PASSWORD',
] as const

interface UsageTotals extends TokenUsage {
  billedInputTokens: number
  totalTokens: number
}

interface ToolCallSummary {
  name: string
  arguments: unknown
  isError?: boolean
  delivery?: string[]
}

interface JourneyResult {
  id: string
  completed: boolean
  finalText: string
  toolCalls: ToolCallSummary[]
  steps: number
  latencyMs: number
  usage: UsageTotals
  errors: Array<{ name: string; code?: string; message: string }>
  rootHelpTargets: string[]
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

function textFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function summarizeCalls(events: readonly SessionEvent[]): ToolCallSummary[] {
  const results = new Map<string, { isError: boolean; delivery?: string[] }>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content.find(content => content.type === 'tool-result')
    if (block?.type !== 'tool-result') continue
    const meta = event.data.meta as { kind?: unknown; targets?: unknown } | undefined
    const delivery = meta?.kind === 'marivo-help-disclosure' && Array.isArray(meta.targets)
      ? meta.targets.flatMap((item): string[] => (
          typeof item === 'object' && item !== null && typeof (item as { delivery?: unknown }).delivery === 'string'
            ? [(item as { delivery: string }).delivery]
            : []
        ))
      : undefined
    results.set(String(block.toolCallId), {
      isError: Boolean(block.isError),
      ...(delivery === undefined ? {} : { delivery }),
    })
  }
  return events.flatMap(event => event.type === 'tool/call'
    ? [{
        name: event.data.name,
        arguments: parseArguments(event.data.arguments),
        ...(results.get(String(event.data.callId)) ?? {}),
      }]
    : [])
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

function finalAssistantText(events: readonly SessionEvent[]): string {
  const last = events.filter(event => event.type === 'assistant/message').at(-1)
  return last?.type === 'assistant/message' ? textFromBlocks(last.data.message.content) : ''
}

function markerFor(id: string): string {
  return `PLUGIN_INTEGRATION_DELIVERY_${id.toUpperCase().replaceAll('-', '_')}_OK`
}

function rootHelpTargets(events: readonly SessionEvent[]): string[] {
  return events.flatMap((event): string[] => {
    if (event.type !== 'user/message') return []
    const source = event.data.source as { kind?: unknown; target?: unknown }
    return source.kind === 'marivo-disclosure' && typeof source.target === 'string'
      ? [source.target]
      : []
  })
}

function toolCalls(result: JourneyResult, name: string): ToolCallSummary[] {
  return result.toolCalls.filter(call => call.name === name)
}

async function assertMissingCredentialDoctorFixture(
  pythonExecutable: string,
  projectRoot: string,
): Promise<void> {
  const policy = new FixedSubprocessPolicy(projectRoot)
  const result = await policy.run({
    executable: pythonExecutable,
    args: ['-m', 'marivo', 'doctor', '--project-root', projectRoot, '--format', 'json'],
  })
  const report = parseDoctorReport(result.stdout)
  assert.equal(report.status, 'fail')
  const checks = report.sections.flatMap(section => section.checks)
  for (const name of missingDatasourceCredentials) {
    assert.equal(process.env[name], undefined)
    assert.ok(checks.some(check => check.status === 'fail' && check.id.includes(name)))
  }
}

const validationRoot = await mkdtemp(path.join(tmpdir(), 'dsh-plugin-integration-delivery-'))
const credentialProjectRoot = path.join(validationRoot, 'credential-project')
await mkdir(path.join(credentialProjectRoot, 'models', 'datasources'), { recursive: true })
await writeFile(
  path.join(credentialProjectRoot, 'marivo.toml'),
  '[project]\nname = "dsh-credential-validation"\n',
)
await writeFile(
  path.join(credentialProjectRoot, 'models', 'datasources', 'credential_validation.py'),
  [
    'import marivo.datasource as md',
    'md.postgres(',
    '    name="credential_validation",',
    '    host="127.0.0.1",',
    '    database="validation",',
    '    user_env="DSH_VALIDATION_USER",',
    '    password_env="DSH_VALIDATION_PASSWORD",',
    ')',
    '',
  ].join('\n'),
)
const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot })
await assertMissingCredentialDoctorFixture(
  environment.binding.pythonExecutable,
  credentialProjectRoot,
)
const credentialFailureEnvironment = await bindMarivoEnvironment({
  projectRoot: credentialProjectRoot,
  pythonExecutable: environment.binding.pythonExecutable,
})
const pythonPolicy = new FixedSubprocessPolicy(environment.binding.projectRoot)
const ctx = new Context()
await ctx.plugin(LlmRuntime)
await ctx.plugin(LocalCredentialProvider, { watch: false })
await ctx.plugin(DeepSeek, {
  thinking: 'disabled',
  reasoningEffort: 'off',
  maxTokens: 1_024,
  streamIdleTimeoutMs: 120_000,
  models: [{ id: model, contextWindow: 128_000, maxTokens: 1_024 }],
})
await ctx.plugin(SessionStore)
await ctx.plugin(SkillRuntime)
await ctx.plugin(SystemPrompt)
await ctx.plugin(TestShellEnv)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

ctx.systemPrompt.section({
  name: 'plugin-integration-delivery:skill-catalog',
  order: 100,
  text: `Available skills:\n- marivo-analysis: trusted governed data analysis\n- marivo-semantic: datasource and reusable semantic authoring or repair\nLoad the matching skill before Marivo work. Ordinary computation needs neither skill.`,
})
ctx.tools.register(defineTool({
  name: 'skill',
  description: 'Load the full instructions for one exact available skill.',
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
    render: (_args, value) => [{
      type: 'text',
      text: `<skill_content name="${value.name}">${value.content}</skill_content>`,
    }],
  },
  async execute({ name }, exec) {
    const skill = await ctx.skills.get(name, {
      cwd: exec.agent?.session.header.cwd ?? workspaceRoot,
      scope: exec.agent,
      signal: exec.signal,
    })
    if (skill === undefined) throw new Error(`unknown skill ${name}`)
    return { name: skill.name, provider: skill.provider, content: skill.content }
  },
}))
ctx.tools.register(defineContentToolFixture({
  name: 'bound_python',
  description: 'Run a short read-only Python snippet with the verified binding interpreter.',
  parameters: {
    code: { type: 'string', required: true, description: 'Read-only Python source, at most 16000 characters.' },
  },
  async execute({ code }, exec) {
    if (code.length > 16_000) throw new Error('bound_python code exceeds 16000 characters')
    const result = await pythonPolicy.run({
      executable: environment.binding.pythonExecutable,
      args: ['-I', '-c', code],
      limits: { timeoutMs: 30_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
      signal: exec.signal,
    })
    return [{
      type: 'text',
      text: `exit_code=${String(result.exitCode)}\nstdout:\n${result.stdout.toString('utf8')}\nstderr:\n${result.stderr.toString('utf8')}`,
    }]
  },
}))

const plugin = await ctx.plugin({
  name: 'dsh-data-analysis-real-validation',
  inject,
  apply,
}, {
  runtimeRoot: path.join(validationRoot, 'runtime'),
  pythonExecutable: environment.binding.pythonExecutable,
})
const validationAgents: Agent[] = []

async function runJourney(
  id: string,
  prompt: string,
  projectRoot: string = workspaceRoot,
): Promise<JourneyResult> {
  const errors: unknown[] = []
  const agent: Agent = ctx.agentLoop.create(SessionId(`plugin-validation-${id}-${Date.now().toString(36)}`), {
    provider: 'deepseek-official',
    model,
    maxTokens: 1_024,
  }, { cwd: projectRoot })
  validationAgents.push(agent)
  const stopErrors = agent.ctx.on('agent/error', payload => errors.push(payload.error))
  const startedAt = performance.now()
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  const events = agent.session.events
  const finalText = finalAssistantText(events)
  const result: JourneyResult = {
    id,
    completed: finalText.includes(markerFor(id)),
    finalText,
    toolCalls: summarizeCalls(events),
    steps: events.filter(event => event.type === 'step/start').length,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    usage: usageTotals(events),
    errors: errors.map(errorSummary),
    rootHelpTargets: rootHelpTargets(events),
  }
  stopErrors()
  return result
}

const specs = [
  {
    id: 'analysis-activation',
    projectRoot: workspaceRoot,
    prompt: `Call skill exactly once with {"name":"marivo-analysis"}. After the skill result and automatically supplied root help, call bound_python exactly once to print marivo.__version__. Explain briefly what the analysis root help establishes and end with ${markerFor('analysis-activation')}.`,
  },
  {
    id: 'semantic-activation',
    projectRoot: workspaceRoot,
    prompt: `Call skill exactly once with {"name":"marivo-semantic"}. After the skill result and automatically supplied root help, explain briefly what authoring help owns. Do not call marivo_help or bound_python. End with ${markerFor('semantic-activation')}.`,
  },
  {
    id: 'ordinary-no-activation',
    projectRoot: workspaceRoot,
    prompt: `This is ordinary arithmetic. Call bound_python exactly once to print 7 * 6. Do not call skill or marivo_help. Report the result and end with ${markerFor('ordinary-no-activation')}.`,
  },
  {
    id: 'focused-help-dedup',
    projectRoot: workspaceRoot,
    prompt: `Call skill with {"name":"marivo-analysis"}. After the automatic analysis root help, call marivo_help twice in separate steps with exactly ["analysis.observe"] each time. Confirm that the second result is an already-visible receipt and end with ${markerFor('focused-help-dedup')}.`,
  },
  {
    id: 'missing-datasource-credential',
    projectRoot: credentialProjectRoot,
    prompt: `Call skill with {"name":"marivo-semantic"}. After automatic authoring help, call marivo_help with exactly ["datasource"]. Explain that live disclosure remains usable while datasource credentials are missing. End with ${markerFor('missing-datasource-credential')}.`,
  },
]

const journeys: JourneyResult[] = []
for (const spec of specs) {
  process.stdout.write(`plugin integration real-model: ${spec.id}\n`)
  journeys.push(await runJourney(spec.id, spec.prompt, spec.projectRoot))
}
const byId = new Map(journeys.map(result => [result.id, result]))

const analysis = byId.get('analysis-activation')
assert.ok(analysis?.completed)
assert.equal(toolCalls(analysis, 'skill').length, 1)
assert.equal(toolCalls(analysis, 'marivo_help').length, 0)
assert.equal(toolCalls(analysis, 'bound_python').length, 1)
assert.deepEqual(analysis.rootHelpTargets, ['analysis'])

const semantic = byId.get('semantic-activation')
assert.ok(semantic?.completed)
assert.equal(toolCalls(semantic, 'skill').length, 1)
assert.equal(toolCalls(semantic, 'marivo_help').length, 0)
assert.deepEqual(semantic.rootHelpTargets, ['authoring'])

const ordinary = byId.get('ordinary-no-activation')
assert.ok(ordinary?.completed)
assert.equal(toolCalls(ordinary, 'skill').length, 0)
assert.equal(toolCalls(ordinary, 'marivo_help').length, 0)
assert.equal(toolCalls(ordinary, 'bound_python').length, 1)
assert.equal(ordinary.rootHelpTargets.length, 0)

const focused = byId.get('focused-help-dedup')
assert.ok(focused?.completed)
assert.deepEqual(toolCalls(focused, 'marivo_help').flatMap(call => call.delivery ?? []), [
  'delivered',
  'already-visible',
])

const datasource = byId.get('missing-datasource-credential')
assert.ok(datasource?.completed)
assert.deepEqual(datasource.rootHelpTargets, ['authoring'])
assert.equal(toolCalls(datasource, 'marivo_help')[0]?.isError, false)

const report = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
  environment: {
    ...environment.binding,
    credentialValuesRecorded: false,
    credentialFailureJourney: {
      binding: credentialFailureEnvironment.binding,
      missingCredentialRefs: [...missingDatasourceCredentials],
      missingCredentialValuesPresent: false,
    },
  },
  journeys,
}

await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
await chmod(reportPath, 0o600)
await plugin.dispose()
for (const agent of validationAgents) {
  assert.equal(agent.ctx.tools.get('marivo_help', agent), undefined)
  assert.equal(agent.ctx.tools.get('marivo_test', agent), undefined)
}
await rm(validationRoot, { recursive: true, force: true })
process.stdout.write(`${JSON.stringify({ status: 'ok', reportPath, journeys: journeys.map(item => ({
  id: item.id,
  completed: item.completed,
  steps: item.steps,
  rootHelp: item.rootHelpTargets,
})) }, null, 2)}\n`)
