import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { CodeRuntime, type CodeRunRequest, type CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import LlmRuntime, {
  CallId,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import {
  installMarivoCheckpoint,
  MarivoCheckpointError,
} from '../../src/checkpoint/index.ts'
import { installMarivoPlugin } from '../../src/plugin.ts'
import {
  FixedSubprocessPolicy,
  MarivoEnvironment,
} from '../../src/environment/index.ts'

const FAKE_PYTHON = String.raw`#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const target = args[5]
if (target === undefined) {
  process.stdout.write(JSON.stringify({
    python_executable: path.resolve(args[2]),
    marivo_version: args[3],
    package_path: path.resolve(args[4]),
  }))
  process.exit(0)
}
appendFileSync(process.env.RECORD_PATH, target + '\n')
if (target === 'invalid.target') {
  process.stderr.write('MarivoHelpTargetError: not registered: ' + target)
  process.exit(1)
}
process.stdout.write(target === 'targets'
  ? 'analysis\nanalysis.observe\nanalysis.compare\n'
  : 'help-body:' + target + '\n')
`

interface EnvironmentFixture {
  environment: MarivoEnvironment
  recordPath: string
  cleanup: () => Promise<void>
}

async function environmentFixture(): Promise<EnvironmentFixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-checkpoint-')))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'targets.log')
  await writeFile(executable, FAKE_PYTHON, 'utf8')
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, { PATH: process.env.PATH, RECORD_PATH: recordPath })
  const environment = new MarivoEnvironment({
    projectRoot: root,
    pythonExecutable: executable,
    marivoVersion: '0.0.test',
    packagePath: path.join(root, 'fake-marivo', '__init__.py'),
    subprocessPolicyId: policy.id,
    doctorOverallStatus: 'warning',
    fingerprint: 'c'.repeat(64),
  }, [], policy)
  return { environment, recordPath, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly toolNamesAtCall: string[][] = []
  readonly #script: Array<StreamChunk[] | 'hang'>

  constructor(script: Array<StreamChunk[] | 'hang'>) {
    super()
    this.#script = [...script]
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.toolNamesAtCall.push(options.tools?.map(tool => tool.name).sort() ?? [])
    const chunks = this.#script.shift()
    if (chunks === undefined) throw new Error('MockAdapter script exhausted')
    if (chunks === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return
    }
    for (const chunk of chunks) yield chunk
  }
}

class CheckpointCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'fixture'
  ordinaryDenied = false

  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    const tools = request.bindings.find(binding => binding.global === 'tools')
    if (tools === undefined) return { logs: [], error: { kind: 'exception', message: 'tools missing' } }
    await tools.functions.marivo_help?.({ targets: [] })
    const analysisTool = tools.functions['preset-local'] ?? tools.functions.ordinary
    try {
      await analysisTool?.({})
    } catch (error: unknown) {
      this.ordinaryDenied = error instanceof Error
        && error.message.includes('Marivo checkpoint requires marivo_help before preset-local')
    }
    return { logs: [], value: { ordinaryDenied: this.ordinaryDenied } }
  }
}

async function harness(adapter: MockAdapter, codeRuntime = false): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  if (codeRuntime) await ctx.plugin(CheckpointCodeRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'ordinary',
    description: 'ordinary inherited tool',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'ordinary-result' }] },
  }))
  return ctx
}

function createAgent(ctx: Context, id: string): Agent {
  return ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

test('checkpoint exposes only marivo_help, restores ordinary tools, and refreshes each user turn', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('help-1', 'marivo_help', { targets: ['analysis.observe'] }),
    textResponse('done one'),
    toolCallResponse('help-2', 'marivo_help', { targets: [] }),
    textResponse('done two'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'checkpoint-success')
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment)

  send(agent, 'first analysis')
  await agent.whenIdle()
  send(agent, 'second analysis')
  await agent.whenIdle()

  assert.deepEqual(adapter.toolNamesAtCall, [
    ['marivo_help'],
    ['marivo_help', 'ordinary'],
    ['marivo_help'],
    ['marivo_help', 'ordinary'],
  ])
  assert.match(adapter.requests[0]?.system ?? '', /Before the next analysis action/)
  const firstMessages = JSON.stringify(adapter.requests[0]?.messages)
  assert.match(firstMessages, /Canonical target inventory/)
  assert.match(firstMessages, /analysis\.observe/)
  assert.equal(controller.state, 'analysis-step')
  assert.equal(controller.turn, 2)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'targets',
    'analysis.observe',
    'targets',
  ])
  const telemetry = controller.telemetry()
  assert.equal(telemetry.length, 2)
  assert.equal(telemetry[0]?.checkpointCompleted, true)
  assert.equal(telemetry[0]?.additionalModelSteps, 1)
  assert.ok((telemetry[0]?.inventoryBytes ?? 0) > 0)
  assert.ok((telemetry[0]?.helpCalls[0]?.helpTextBytes ?? 0) > 0)
  assert.equal(telemetry[1]?.helpCalls[0]?.emptyDeclaration, true)
})

test('Cordis plugin adapter installs live Agents and releases its scoped checkpoint', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('plugin-help', 'marivo_help', { targets: [] }),
    textResponse('checkpoint installed'),
    textResponse('checkpoint disposed'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'plugin-adapter')
  const dispose = installMarivoPlugin(ctx, fixture.environment)

  send(agent, 'use installed checkpoint')
  await agent.whenIdle()
  dispose()
  send(agent, 'run after plugin disposal')
  await agent.whenIdle()

  assert.deepEqual(adapter.toolNamesAtCall, [
    ['marivo_help'],
    ['marivo_help', 'ordinary'],
    ['ordinary'],
  ])
})

test('hallucinated ordinary tool stays hidden and cannot bypass the declaration', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('ordinary-hidden', 'ordinary', {}),
    toolCallResponse('help-after-denial', 'marivo_help', { targets: [] }),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'checkpoint-hidden')
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment)

  send(agent, 'try ordinary first')
  await agent.whenIdle()

  assert.deepEqual(adapter.toolNamesAtCall[0], ['marivo_help'])
  const denied = agent.session.events.find(event =>
    event.type === 'tool/result'
    && event.data.message.content.some(block => block.content.some(content =>
      content.type === 'text'
      && content.text.includes('Marivo checkpoint requires marivo_help before ordinary'))))
  assert.ok(denied)
  assert.equal(controller.state, 'analysis-step')
})

test('missing declaration steers exactly twice, then terminates with explicit Plugin error', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    textResponse('ignore one'),
    textResponse('ignore two'),
    textResponse('ignore three'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'checkpoint-missing')
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment)
  const errors: unknown[] = []
  ctx.on('agent/error', ({ agent: subject, error }) => { if (subject === agent) errors.push(error) })

  send(agent, 'ignore the checkpoint')
  await agent.whenIdle()

  assert.equal(adapter.requests.length, 3)
  assert.ok(adapter.toolNamesAtCall.every(names => names.join(',') === 'marivo_help'))
  assert.match(JSON.stringify(adapter.requests[1]?.messages), /Checkpoint required/)
  assert.match(JSON.stringify(adapter.requests[2]?.messages), /Checkpoint required/)
  assert.ok(errors.some(error =>
    error instanceof MarivoCheckpointError && error.code === 'missing-declaration-limit'))
  assert.equal(controller.telemetry()[0]?.steeringRepairs, 2)
  assert.equal(controller.telemetry()[0]?.failure, 'missing-declaration-limit')
})

test('invalid target keeps checkpoint active and a later legal result completes it', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('invalid', 'marivo_help', { targets: ['invalid.target'] }),
    toolCallResponse('repaired', 'marivo_help', { targets: ['analysis.compare'] }),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'checkpoint-invalid')
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment)

  send(agent, 'repair invalid target')
  await agent.whenIdle()

  assert.deepEqual(adapter.toolNamesAtCall, [
    ['marivo_help'],
    ['marivo_help'],
    ['marivo_help', 'ordinary'],
  ])
  assert.deepEqual(controller.telemetry()[0]?.helpCalls.map(call => call.outcome), ['failure', 'success'])
})

test('schema errors count toward the budget; the next excess attempt terminates the turn', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('invalid-schema-1', 'marivo_help', {}),
    toolCallResponse('invalid-2', 'marivo_help', { targets: ['invalid.target'] }),
    toolCallResponse('denied-3', 'marivo_help', { targets: ['invalid.target'] }),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'checkpoint-budget')
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment, {
    checkpointLimits: { maxHelpCallsPerTurn: 2 },
  })
  const errors: unknown[] = []
  ctx.on('agent/error', ({ agent: subject, error }) => { if (subject === agent) errors.push(error) })

  send(agent, 'exhaust help budget')
  await agent.whenIdle()

  assert.equal(adapter.requests.length, 3)
  assert.ok(errors.some(error =>
    error instanceof MarivoCheckpointError && error.code === 'help-call-budget-exceeded'))
  assert.equal(controller.helpCalls, 3)
  assert.equal(controller.telemetry()[0]?.failure, 'help-call-budget-exceeded')
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'targets',
    'invalid.target',
  ])
})

test('checkpoint accepts pre-existing scope-local tools and non-native declarations', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))

  const localAgent = createAgent(ctx, 'checkpoint-local-conflict')
  localAgent.ctx.tools.register(defineContentToolFixture({
    name: 'preset-local', description: 'preset local', parameters: {}, async execute() { return [] },
  }))
  const localController = installMarivoCheckpoint(ctx, localAgent, fixture.environment)
  assert.equal(localController.state, 'analysis-step')

  const codeAgent = createAgent(ctx, 'checkpoint-code-conflict')
  codeAgent.ctx.tools.presentAs('code')
  const codeController = installMarivoCheckpoint(ctx, codeAgent, fixture.environment)
  assert.equal(codeController.state, 'analysis-step')
})

test('code mode exposes run_code with a help-only SDK and blocks same-step nested analysis', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('code-declaration', 'run_code', {
      code: 'return await tools.marivo_help({ targets: [] })',
      description: 'Declare Marivo help targets',
    }),
    textResponse('analysis may continue'),
  ])
  const ctx = await harness(adapter, true)
  const agent = createAgent(ctx, 'checkpoint-code')
  agent.ctx.tools.presentAs('code')
  agent.ctx.tools.register(defineContentToolFixture({
    name: 'preset-local',
    description: 'scope-local analysis tool',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'must stay gated' }] },
  }))
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment)

  send(agent, 'use code mode')
  await agent.whenIdle()

  assert.deepEqual(adapter.toolNamesAtCall, [['run_code'], ['run_code']])
  assert.match(adapter.requests[0]?.system ?? '', /marivo_help/)
  assert.doesNotMatch(adapter.requests[0]?.system ?? '', /preset-local/)
  assert.match(adapter.requests[1]?.system ?? '', /ordinary/)
  assert.equal((ctx.codeRuntime as CheckpointCodeRuntime).ordinaryDenied, true)
  assert.equal(controller.state, 'analysis-step')
})

test('both mode presents only run_code and marivo_help until the declaration boundary', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallResponse('both-help', 'marivo_help', { targets: [] }),
    textResponse('continue'),
  ])
  const ctx = await harness(adapter, true)
  const agent = createAgent(ctx, 'checkpoint-both')
  agent.ctx.tools.presentAs('both')
  installMarivoCheckpoint(ctx, agent, fixture.environment)

  send(agent, 'use both mode')
  await agent.whenIdle()

  assert.deepEqual(adapter.toolNamesAtCall, [
    ['marivo_help', 'run_code'],
    ['marivo_help', 'ordinary', 'run_code'],
  ])
  assert.match(adapter.requests[0]?.system ?? '', /marivo_help/)
  assert.doesNotMatch(adapter.requests[0]?.system ?? '', /ordinary: \(/)
})

test('user cancellation aborts the turn without steering a repair step', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter(['hang'])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'checkpoint-cancel')
  const controller = installMarivoCheckpoint(ctx, agent, fixture.environment)

  send(agent, 'cancel while model is running')
  while (adapter.requests.length === 0) await new Promise(resolve => setImmediate(resolve))
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()

  assert.equal(adapter.requests.length, 1)
  assert.equal(controller.telemetry()[0]?.steeringRepairs, 0)
  assert.equal(agent.session.events.filter(event =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === '@deepseek-ai/dsh-data-analysis').length, 0)
})
