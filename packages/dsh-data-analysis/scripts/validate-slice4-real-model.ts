import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { createUserMessage, type ContentBlock, type TokenUsage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { installMarivoCheckpoint, type DisclosureTurnTelemetry } from '../src/checkpoint/index.ts'
import {
  bindMarivoEnvironment,
  FixedSubprocessPolicy,
  type MarivoEnvironment,
} from '../src/environment/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const marivoRoot = path.resolve(workspaceRoot, '../marivo')
const reportPath = path.join(workspaceRoot, 'artifacts', 'slice-4-real-model.json')
const model = process.env.DSH_SLICE4_MODEL ?? 'deepseek-v4-flash'
const missingDatasourceCredentials = [
  'MARIVO_CDN_REPLICA_USER',
  'MARIVO_CDN_REPLICA_PASSWORD',
] as const

interface UsageTotals extends TokenUsage {
  billedInputTokens: number
  totalTokens: number
}

interface ToolCallSummary {
  name: string
  arguments: unknown
  isError?: boolean
}

interface JourneyResult {
  id: string
  mode: 'protocol' | 'baseline'
  expectation: 'success' | 'bounded-failure'
  completed: boolean
  finalText: string
  toolCalls: ToolCallSummary[]
  steps: number
  latencyMs: number
  usage: UsageTotals
  errors: Array<{ name: string; code?: string; message: string }>
  checkpoint?: DisclosureTurnTelemetry
  helpTextTokens?: {
    value: number
    estimated: true
    method: 'ceil-codepoints-divided-by-four'
  }
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
  const results = new Map<string, boolean>()
  for (const event of events) {
    if (event.type === 'tool/result') {
      const block = event.data.message.content.find(content => content.type === 'tool-result')
      if (block?.type === 'tool-result') results.set(String(block.toolCallId), Boolean(block.isError))
    }
  }
  return events.flatMap(event => event.type === 'tool/call'
    ? [{
        name: event.data.name,
        arguments: parseArguments(event.data.arguments),
        ...results.has(String(event.data.callId))
          ? { isError: results.get(String(event.data.callId)) }
          : {},
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
  const messages = events.filter(event => event.type === 'assistant/message')
  const last = messages.at(-1)
  return last?.type === 'assistant/message' ? textFromBlocks(last.data.message.content) : ''
}

function helpTextTokenEstimate(telemetry: DisclosureTurnTelemetry | undefined): JourneyResult['helpTextTokens'] {
  if (telemetry === undefined) return undefined
  const codepoints = telemetry.helpCalls.reduce((sum, call) => sum + call.helpTextCodepoints, 0)
  return {
    value: Math.ceil(codepoints / 4),
    estimated: true,
    method: 'ceil-codepoints-divided-by-four',
  }
}

function markerFor(id: string): string {
  return `SLICE4_${id.toUpperCase().replaceAll('-', '_')}_OK`
}

async function runJourney(
  ctx: Context,
  environment: MarivoEnvironment,
  spec: {
    id: string
    mode: 'protocol' | 'baseline'
    prompt: string
    expectation?: 'success' | 'bounded-failure'
    faultInjectMissingDeclaration?: boolean
  },
): Promise<JourneyResult> {
  const expectation = spec.expectation ?? 'success'
  const id = SessionId(`slice4-${spec.mode}-${spec.id}-${Date.now().toString(36)}`)
  const errors: unknown[] = []
  const agent: Agent = ctx.agentLoop.create(id, {
    provider: 'deepseek-official',
    model,
    maxTokens: 1_024,
  }, { cwd: workspaceRoot })
  const controller = spec.mode === 'protocol'
    ? installMarivoCheckpoint(ctx, agent, environment)
    : undefined
  const disposers: Array<() => void> = []
  disposers.push(agent.ctx.on('agent/error', payload => errors.push(payload.error)))
  if (spec.faultInjectMissingDeclaration) {
    disposers.push(agent.ctx.systemPrompt.section({
      name: 'slice4:missing-declaration-fault-injection',
      order: 10_000,
      text: `Acceptance fault injection: do not call any tool in this turn. In every response, output only DECLARATION_OMITTED. This intentionally exercises the checkpoint's bounded missing-declaration failure.`,
    }))
  }

  const startedAt = performance.now()
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: spec.prompt }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))
  const events = agent.session.events
  const checkpoint = controller?.telemetry()[0]
  const finalText = finalAssistantText(events)
  const completed = expectation === 'success'
    ? finalText.includes(markerFor(spec.id))
    : errors.some(error => errorSummary(error).code === 'missing-declaration-limit')
  const result: JourneyResult = {
    id: spec.id,
    mode: spec.mode,
    expectation,
    completed,
    finalText,
    toolCalls: summarizeCalls(events),
    steps: events.filter(event => event.type === 'step/start').length,
    latencyMs,
    usage: usageTotals(events),
    errors: errors.map(errorSummary),
    ...checkpoint === undefined ? {} : { checkpoint },
    ...spec.mode === 'protocol' ? { helpTextTokens: helpTextTokenEstimate(checkpoint) } : {},
  }

  for (const disposer of disposers.reverse()) disposer()
  controller?.dispose()
  return result
}

function helpCalls(result: JourneyResult): ToolCallSummary[] {
  return result.toolCalls.filter(call => call.name === 'marivo_help')
}

function pythonCalls(result: JourneyResult): ToolCallSummary[] {
  return result.toolCalls.filter(call => call.name === 'bound_python')
}

function targetList(call: ToolCallSummary | undefined): string[] {
  if (typeof call?.arguments !== 'object' || call.arguments === null) return []
  const targets = (call.arguments as { targets?: unknown }).targets
  return Array.isArray(targets) ? targets.filter((value): value is string => typeof value === 'string') : []
}

function assertProtocolJourneys(
  results: Map<string, JourneyResult>,
  credentialFailureEnvironment: MarivoEnvironment,
): void {
  const known = results.get('known-analysis')
  assert.ok(known?.completed)
  assert.deepEqual(targetList(helpCalls(known)[0]), ['analysis.observe'])
  assert.equal(helpCalls(known)[0]?.isError, false)
  assert.equal(pythonCalls(known).length, 1)
  assert.match(known.finalText, /observe/i)
  assert.match(known.finalText, /time_scope/)

  const multiple = results.get('multiple-help')
  assert.ok(multiple?.completed)
  assert.ok(helpCalls(multiple).length >= 2)
  assert.deepEqual(targetList(helpCalls(multiple)[0]), ['analysis.observe'])
  assert.deepEqual(targetList(helpCalls(multiple)[1]), ['analysis.compare'])
  assert.ok(helpCalls(multiple).slice(0, 2).every(call => call.isError === false))
  assert.match(multiple.finalText, /observe/i)
  assert.match(multiple.finalText, /compare/i)

  const empty = results.get('empty-declaration')
  assert.ok(empty?.completed)
  assert.deepEqual(targetList(helpCalls(empty)[0]), [])
  assert.equal(empty.checkpoint?.helpCalls[0]?.emptyDeclaration, true)

  const invalid = results.get('invalid-target-repair')
  assert.ok(invalid?.completed)
  assert.deepEqual(targetList(helpCalls(invalid)[0]), ['analysis.not_a_real_target'])
  assert.equal(helpCalls(invalid)[0]?.isError, true)
  assert.deepEqual(targetList(helpCalls(invalid)[1]), ['analysis.observe'])
  assert.equal(helpCalls(invalid)[1]?.isError, false)

  const missing = results.get('missing-declaration-limit')
  assert.ok(missing?.completed)
  assert.equal(missing.checkpoint?.steeringRepairs, 2)
  assert.equal(missing.checkpoint?.failure, 'missing-declaration-limit')
  assert.equal(helpCalls(missing).length, 0)

  const datasource = results.get('missing-datasource-credential')
  assert.ok(datasource?.completed)
  assert.equal(credentialFailureEnvironment.binding.doctorOverallStatus, 'fail')
  for (const name of missingDatasourceCredentials) {
    assert.equal(process.env[name], undefined)
    assert.ok(credentialFailureEnvironment.diagnostics.some(diagnostic => (
      diagnostic.status === 'fail' && diagnostic.id.includes(name)
    )))
  }
  assert.equal(helpCalls(datasource)[0]?.isError, false)
  assert.ok(targetList(helpCalls(datasource)[0]).includes('datasource'))
}

function counterfactual(protocol: JourneyResult[], baseline: JourneyResult[]): object {
  const contractSummaryAccepted = (item: JourneyResult): boolean => item.id === 'known-analysis'
    ? /observe/i.test(item.finalText) && /time_scope/.test(item.finalText)
    : /observe/i.test(item.finalText) && /compare/i.test(item.finalText)
  const aggregate = (items: JourneyResult[]) => ({
    journeys: items.length,
    completed: items.filter(item => item.completed).length,
    currentHelpObserved: items.filter(item => item.mode === 'protocol'
      ? helpCalls(item).some(call => call.isError === false)
      : pythonCalls(item).some(call => JSON.stringify(call.arguments).includes('marivo.help'))).length,
    invalidHelpCalls: items.reduce((sum, item) => sum + helpCalls(item).filter(call => call.isError).length, 0),
    staleOrUnsupportedSignatureSummaries: items.filter(item => !contractSummaryAccepted(item)).length,
    retriesOrRepairs: items.reduce((sum, item) => (
      sum + (item.checkpoint?.steeringRepairs ?? 0) + helpCalls(item).filter(call => call.isError).length
    ), 0),
    steps: items.reduce((sum, item) => sum + item.steps, 0),
    latencyMs: items.reduce((sum, item) => sum + item.latencyMs, 0),
    billedInputTokens: items.reduce((sum, item) => sum + item.usage.billedInputTokens, 0),
    outputTokens: items.reduce((sum, item) => sum + item.usage.outputTokens, 0),
    totalTokens: items.reduce((sum, item) => sum + item.usage.totalTokens, 0),
  })
  return {
    scope: ['known-analysis', 'multiple-help'],
    protocol: aggregate(protocol),
    baseline: aggregate(baseline),
    interpretationRule: 'Reliability is not inferred from protocol presence; completion and observed current-help use are reported separately from token, step, and latency cost.',
  }
}

const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot })
const credentialFailureEnvironment = await bindMarivoEnvironment({
  projectRoot: marivoRoot,
  pythonExecutable: environment.binding.pythonExecutable,
})
const skill = await readFile(path.join(marivoRoot, 'marivo', 'skills', 'marivo-analysis', 'SKILL.md'), 'utf8')
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
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(AgentRegistry)
await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

ctx.systemPrompt.section({
  name: 'slice4:marivo-analysis-skill',
  order: 100,
  text: `${skill}\n\nValidation runtime: bound_python always runs the binding interpreter ${environment.binding.pythonExecutable} in ${environment.binding.projectRoot}. Keep code read-only and bounded.`,
})
ctx.tools.register(defineContentToolFixture({
  name: 'bound_python',
  description: 'Run a short read-only Python snippet with the verified Marivo binding interpreter. Use this only after the required help declaration.',
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
    const stdout = result.stdout.toString('utf8')
    const stderr = result.stderr.toString('utf8')
    return [{
      type: 'text',
      text: `exit_code=${String(result.exitCode)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    }]
  },
}))

const protocolSpecs = [
  {
    id: 'known-analysis',
    prompt: `Known Marivo analysis planning task: prepare the current minimal call for observing a governed revenue metric by country over a bounded quarter. First request exactly analysis.observe through marivo_help. After that result, call bound_python exactly once to print marivo.__version__. Give a concise call skeleton containing the current time_scope parameter and one live-help constraint; do not fabricate business data. End with ${markerFor('known-analysis')}.`,
  },
  {
    id: 'multiple-help',
    prompt: `Multi-help contract task. Call marivo_help first with exactly ["analysis.observe"]. After its result, call marivo_help a second time with exactly ["analysis.compare"]. Do not combine them into one call. Summarize how their purposes differ, then end with ${markerFor('multiple-help')}.`,
  },
  {
    id: 'empty-declaration',
    prompt: `This is arithmetic and needs no Marivo API detail: compute 7 * 6. Declare exactly targets=[] through marivo_help, then answer and end with ${markerFor('empty-declaration')}.`,
  },
  {
    id: 'invalid-target-repair',
    prompt: `Repair journey. First call marivo_help with exactly ["analysis.not_a_real_target"]. After Marivo rejects it, repair without fuzzy substitution by choosing the canonical target analysis.observe from the inventory and call again. Summarize the successful target, then end with ${markerFor('invalid-target-repair')}.`,
  },
  {
    id: 'missing-declaration-limit',
    prompt: 'This journey intentionally omits the required declaration so the Plugin must stop it after its fixed repair limit.',
    expectation: 'bounded-failure' as const,
    faultInjectMissingDeclaration: true,
  },
  {
    id: 'missing-datasource-credential',
    prompt: `The bound project's doctor reports that MARIVO_CDN_REPLICA_USER and MARIVO_CDN_REPLICA_PASSWORD are missing. Request exactly ["datasource"] through marivo_help and explain briefly that live API disclosure remains usable even though datasource execution credentials are unavailable. End with ${markerFor('missing-datasource-credential')}.`,
  },
]

const protocolResults: JourneyResult[] = []
for (const spec of protocolSpecs) {
  process.stdout.write(`slice4 real-model: ${spec.id}\n`)
  const journeyEnvironment = spec.id === 'missing-datasource-credential'
    ? credentialFailureEnvironment
    : environment
  protocolResults.push(await runJourney(ctx, journeyEnvironment, { ...spec, mode: 'protocol' }))
}
const byId = new Map(protocolResults.map(result => [result.id, result]))
assertProtocolJourneys(byId, credentialFailureEnvironment)

const baselineSpecs = [
  {
    id: 'known-analysis',
    prompt: `Known Marivo analysis planning task: prepare the current minimal call for observing a governed revenue metric by country over a bounded quarter. Use bound_python to inspect current live help for analysis.observe and print marivo.__version__. Give a concise call skeleton containing the current time_scope parameter and one live-help constraint; do not fabricate business data. End with ${markerFor('known-analysis')}.`,
  },
  {
    id: 'multiple-help',
    prompt: `Multi-contract task. Use bound_python to inspect current live help for analysis.observe and analysis.compare, summarize how their purposes differ, then end with ${markerFor('multiple-help')}.`,
  },
]
const baselineResults: JourneyResult[] = []
for (const spec of baselineSpecs) {
  process.stdout.write(`slice4 baseline: ${spec.id}\n`)
  baselineResults.push(await runJourney(ctx, environment, { ...spec, mode: 'baseline' }))
}
assert.ok(baselineResults.every(result => result.completed))
assert.match(baselineResults[0]?.finalText ?? '', /observe/i)
assert.match(baselineResults[0]?.finalText ?? '', /time_scope/)
assert.match(baselineResults[1]?.finalText ?? '', /observe/i)
assert.match(baselineResults[1]?.finalText ?? '', /compare/i)

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
  environment: {
    ...environment.binding,
    credentialValuesRecorded: false,
    credentialFailureJourney: {
      binding: credentialFailureEnvironment.binding,
      diagnostics: credentialFailureEnvironment.diagnostics,
      missingCredentialRefs: [...missingDatasourceCredentials],
      missingCredentialValuesPresent: false,
    },
  },
  protocolJourneys: protocolResults,
  baselineJourneys: baselineResults,
  counterfactual: counterfactual(
    protocolResults.filter(result => result.id === 'known-analysis' || result.id === 'multiple-help'),
    baselineResults,
  ),
}

await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`${JSON.stringify({ status: 'ok', reportPath, counterfactual: report.counterfactual }, null, 2)}\n`)
