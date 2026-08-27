import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  CallId,
  createToolResultMessage,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeParentOf } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import {
  installMarivoDisclosure,
  marivoHelpBodyDigest,
  MarivoDisclosureError,
} from '../../src/disclosure/index.ts'
import { installMarivoPlugin, MARIVO_EVIDENCE_CITATION_PROMPT } from '../../src/plugin.ts'
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
if (target === 'invalid.target' || process.env.FAIL_TARGET === target) {
  process.stderr.write('MarivoHelpTargetError: not registered: ' + target)
  process.exit(1)
}
const respond = () => process.stdout.write((process.env.BODY_PREFIX || 'help-body:') + target + '\n')
if (process.env.SLOW_TARGET === target) setTimeout(respond, 10_000)
else respond()
`

interface EnvironmentFixture {
  environment: MarivoEnvironment
  recordPath: string
  cleanup: () => Promise<void>
}

async function environmentFixture(options: {
  fingerprint?: string
  bodyPrefix?: string
  failTarget?: string
  slowTarget?: string
} = {}): Promise<EnvironmentFixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-disclosure-')))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'targets.log')
  await writeFile(executable, FAKE_PYTHON, 'utf8')
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    RECORD_PATH: recordPath,
    ...(options.bodyPrefix === undefined ? {} : { BODY_PREFIX: options.bodyPrefix }),
    ...(options.failTarget === undefined ? {} : { FAIL_TARGET: options.failTarget }),
    ...(options.slowTarget === undefined ? {} : { SLOW_TARGET: options.slowTarget }),
  })
  const environment = new MarivoEnvironment({
    projectRoot: root,
    pythonExecutable: executable,
    marivoVersion: '0.0.test',
    packagePath: path.join(root, 'fake-marivo', '__init__.py'),
    subprocessPolicyId: policy.id,
    fingerprint: options.fingerprint ?? 'c'.repeat(64),
  }, policy)
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

function toolCallsResponse(
  calls: Array<{ id: string; name: string; args: object }>,
): StreamChunk[] {
  const chunks: StreamChunk[] = []
  for (const [index, call] of calls.entries()) {
    const id = CallId(call.id)
    const argumentsJson = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: argumentsJson },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: argumentsJson } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly #script: StreamChunk[][]

  constructor(script: StreamChunk[][]) {
    super()
    this.#script = [...script]
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.#script.shift()
    if (chunks === undefined) throw new Error('MockAdapter script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function fixtureSkillTool(): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'skill',
    description: 'load one available skill',
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
    async execute({ name }) {
      return { name, provider: 'fixture', content: `instructions:${name}` }
    },
  })
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
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
  ctx.tools.register(fixtureSkillTool())
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

function requestToolNames(request: GenerateOptions | undefined): string[] {
  return request?.tools?.map(tool => tool.name).sort() ?? []
}

function requestMessages(request: GenerateOptions | undefined): string {
  return JSON.stringify(request?.messages ?? [])
}

test('bash and ordinary tools stay visible across user turns without starting Help', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'bash-1', name: 'bash', args: {} }]),
    textResponse('done one'),
    toolCallsResponse([{ id: 'ordinary-2', name: 'ordinary', args: {} }]),
    textResponse('done two'),
  ])
  const ctx = await harness(adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'bash',
    description: 'fixture shell tool',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'bash-result' }] },
  }))
  const agent = createAgent(ctx, 'ordinary-turns')
  installMarivoDisclosure(ctx, agent, fixture.environment)

  send(agent, 'ordinary one')
  await agent.whenIdle()
  send(agent, 'ordinary two')
  await agent.whenIdle()

  assert.ok(adapter.requests.every(request => (
    requestToolNames(request).join(',') === 'bash,marivo_help,ordinary,skill'
  )))
  assert.ok(adapter.requests.every(request => !requestMessages(request).includes('marivo_help_context')))
  await assert.rejects(() => stat(fixture.recordPath), { code: 'ENOENT' })
})

test('loading marivo-semantic injects live authoring help before the next model request', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'semantic', name: 'skill', args: { name: 'marivo-semantic' } }]),
    textResponse('semantic ready'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'semantic-activation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)

  send(agent, 'build semantics')
  await agent.whenIdle()

  assert.doesNotMatch(requestMessages(adapter.requests[0]), /marivo_help_context/)
  assert.match(requestMessages(adapter.requests[1]), /marivo_help_context.*marivo-semantic/)
  assert.match(requestMessages(adapter.requests[1]), /help-body:authoring/)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), ['authoring'])
  assert.deepEqual(controller.activeSkills, ['marivo-semantic'])
  assert.equal(controller.telemetry().rootHelp[0]?.target, 'authoring')
})

test('Evidence citation guidance appears only after marivo-analysis activation', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'analysis-citations', name: 'skill', args: { name: 'marivo-analysis' } }]),
    textResponse('analysis ready'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'citation-prompt-analysis')
  installMarivoPlugin(ctx, fixture.environment, {
    credentials: { resolve: () => Promise.resolve(undefined) },
  })

  send(agent, 'analyze with exact evidence')
  await agent.whenIdle()

  assert.doesNotMatch(JSON.stringify(adapter.requests[0]?.system ?? ''), /marivo_evidence_cite/)
  const activatedPrompt = JSON.stringify(adapter.requests[1]?.system ?? '')
  assert.match(activatedPrompt, /marivo_evidence_cite/)
  assert.match(activatedPrompt, /Copy the returned marker/)
  assert.match(activatedPrompt, /does not prove/)
  assert.match(MARIVO_EVIDENCE_CITATION_PROMPT, /Never invent, rename, or edit/)
})

test('an Agent-plane inherited skill Tool activates Evidence guidance and root help', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'analysis-agent-plane', name: 'skill', args: { name: 'marivo-analysis' } }]),
    textResponse('analysis ready'),
  ])
  const ctx = await harness(adapter)
  const parentScope = {}
  let agentPlaneCtx: Context | undefined
  await ctx.plugin({
    name: 'agent-plane-harness',
    inject: ['tools'],
    apply(pluginCtx) {
      agentPlaneCtx = createScope(pluginCtx, parentScope).ctx
    },
  })
  const resolvedAgentPlaneCtx = agentPlaneCtx
  assert.ok(resolvedAgentPlaneCtx)
  resolvedAgentPlaneCtx.tools.register(fixtureSkillTool())
  const agent = createAgent(ctx, 'citation-prompt-agent-plane')
  bindScopeParent(agent, parentScope)
  assert.equal(scopeParentOf(agent), parentScope)
  assert.equal(
    agent.ctx.tools.get('skill', agent),
    agent.ctx.tools.get('skill', parentScope),
  )
  installMarivoPlugin(ctx, fixture.environment, {
    credentials: { resolve: () => Promise.resolve(undefined) },
  })

  send(agent, 'analyze with an Agent-plane skill Tool')
  await agent.whenIdle()

  assert.match(JSON.stringify(adapter.requests[1]?.system ?? ''), /marivo_evidence_cite/)
  assert.match(requestMessages(adapter.requests[1]), /marivo_help_context/)
  assert.match(requestMessages(adapter.requests[1]), /help-body:analysis/)
})

test('marivo-semantic activation alone does not add Evidence citation guidance', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'semantic-no-citations', name: 'skill', args: { name: 'marivo-semantic' } }]),
    textResponse('semantic ready'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'citation-prompt-semantic')
  installMarivoPlugin(ctx, fixture.environment, {
    credentials: { resolve: () => Promise.resolve(undefined) },
  })

  send(agent, 'author semantics')
  await agent.whenIdle()

  assert.doesNotMatch(JSON.stringify(adapter.requests[1]?.system ?? ''), /marivo_evidence_cite/)
})

test('an explicit user skill invocation activates the matching root help without a skill Tool call', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'explicit-invocation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  const invocation = createUserMessage({
    content: [{ type: 'text', text: '<skill_content name="marivo-analysis">instructions</skill_content>' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })

  const injections = await controller.prepareStep([invocation], new AbortController().signal)

  assert.equal(injections.length, 1)
  assert.match(JSON.stringify(injections), /help-body:analysis/)
  assert.deepEqual(controller.activeSkills, ['marivo-analysis'])
})

test('the disclosure listener sees a DSH skill invocation appended by an outer waterfall producer', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([textResponse('ready')])
  const ctx = await harness(adapter)
  ctx.on('agent/pre-step', async ({ messages }, next) => {
    const decision = await next()
    if (
      decision.kind === 'reject'
      || !messages.some(message => message.source.kind === 'user')
    ) return decision
    const invocation = createUserMessage({
      content: [{ type: 'text', text: '<skill_content name="marivo-analysis">instructions</skill_content>' }],
      source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
    })
    return { kind: 'enter' as const, messages: [...decision.messages, invocation] }
  })
  const agent = createAgent(ctx, 'outer-skill-invocation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)

  send(agent, '/marivo-analysis')
  await agent.whenIdle()

  assert.equal(adapter.requests.length, 1)
  assert.match(requestMessages(adapter.requests[0]), /skill-invocation/)
  assert.match(requestMessages(adapter.requests[0]), /help-body:analysis/)
  assert.deepEqual(controller.activeSkills, ['marivo-analysis'])
})

test('a scope-local Tool shadow named skill cannot activate Marivo disclosure', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'shadow', name: 'skill', args: { name: 'marivo-semantic' } }]),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'skill-shadow')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  agent.ctx.tools.register(defineTool({
    name: 'skill',
    description: 'scope-local shadow',
    parameters: { name: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.name }],
    },
    async execute({ name }) { return { name } },
  }))

  send(agent, 'call the shadow')
  await agent.whenIdle()

  assert.deepEqual(controller.activeSkills, [])
  assert.doesNotMatch(requestMessages(adapter.requests[1]), /marivo_help_context/)
  await assert.rejects(() => stat(fixture.recordPath), { code: 'ENOENT' })
})

test('loading both Marivo skills injects analysis then authoring help atomically', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'semantic', name: 'skill', args: { name: 'marivo-semantic' } },
      { id: 'analysis', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('both ready'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'both-activation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)

  send(agent, 'author then analyze')
  await agent.whenIdle()

  const messages = requestMessages(adapter.requests[1])
  const analysis = messages.indexOf('help-body:analysis')
  const authoring = messages.indexOf('help-body:authoring')
  assert.ok(analysis >= 0 && authoring > analysis)
  assert.deepEqual(controller.activeSkills, ['marivo-analysis', 'marivo-semantic'])
  assert.deepEqual(controller.telemetry().rootHelp.map(item => item.target), ['analysis', 'authoring'])
})

test('reloading the same skill refreshes live help without duplicating unchanged prompt content', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'semantic-1', name: 'skill', args: { name: 'marivo-semantic' } }]),
    toolCallsResponse([{ id: 'semantic-2', name: 'skill', args: { name: 'marivo-semantic' } }]),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'repeat-activation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)

  send(agent, 'load twice')
  await agent.whenIdle()

  const last = requestMessages(adapter.requests[2])
  assert.equal(last.match(/<marivo_help_context/g)?.length, 1)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), ['authoring', 'authoring'])
  assert.deepEqual(controller.telemetry().rootHelp.map(item => item.delivery), [
    'delivered',
    'already-visible',
  ])
})

test('repeated focused help stays live and renders a receipt instead of duplicate unchanged body', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'help-1', name: 'marivo_help', args: { targets: ['analysis.observe'] } }]),
    toolCallsResponse([{ id: 'help-2', name: 'marivo_help', args: { targets: ['analysis.observe'] } }]),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'focused-repeat')
  installMarivoDisclosure(ctx, agent, fixture.environment)

  send(agent, 'read focused help twice')
  await agent.whenIdle()

  const results = agent.session.events.filter(event => event.type === 'tool/result')
  const first = JSON.stringify(results[0])
  const second = JSON.stringify(results[1])
  assert.match(first, /help-body:analysis\.observe/)
  assert.doesNotMatch(second, /help-body:analysis\.observe/)
  assert.match(second, /already visible in this prompt/)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'analysis.observe',
    'analysis.observe',
  ])
})

test('an environment change replaces active root help without a new skill load', async (t) => {
  const first = await environmentFixture({ fingerprint: '1'.repeat(64), bodyPrefix: 'old:' })
  const second = await environmentFixture({ fingerprint: '2'.repeat(64), bodyPrefix: 'new:' })
  t.after(first.cleanup)
  t.after(second.cleanup)
  let current = first.environment
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'analysis', name: 'skill', args: { name: 'marivo-analysis' } }]),
    textResponse('first done'),
    textResponse('second done'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'environment-replacement')
  const controller = installMarivoDisclosure(ctx, agent, () => Promise.resolve(current))

  send(agent, 'activate')
  await agent.whenIdle()
  current = second.environment
  send(agent, 'continue after rebind')
  await agent.whenIdle()

  assert.match(requestMessages(adapter.requests[2]), /new:analysis/)
  assert.match(requestMessages(adapter.requests[2]), /replaces the earlier disclosure/)
  assert.equal(controller.telemetry().rootHelp.at(-1)?.delivery, 'replacement')
})

test('a changed root body with the same environment identity replaces visible help on reactivation', async (t) => {
  const fingerprint = '3'.repeat(64)
  const first = await environmentFixture({ fingerprint, bodyPrefix: 'old:' })
  const second = await environmentFixture({ fingerprint, bodyPrefix: 'new:' })
  t.after(first.cleanup)
  t.after(second.cleanup)
  let current = first.environment
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'body-replacement')
  const controller = installMarivoDisclosure(ctx, agent, () => Promise.resolve(current))
  const invocation = createUserMessage({
    content: [{ type: 'text', text: 'analysis skill' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  const signal = new AbortController().signal

  const initial = await controller.prepareStep([invocation], signal)
  current = second.environment
  const replacement = await controller.prepareStep([...initial, invocation], signal)

  assert.equal(replacement.length, 1)
  assert.match(JSON.stringify(replacement), /new:analysis/)
  assert.match(JSON.stringify(replacement), /replaces the earlier disclosure/)
  assert.deepEqual(controller.telemetry().rootHelp.map(item => item.delivery), [
    'delivered',
    'replacement',
  ])
})

test('hidden root disclosure is read live and restored after prompt compaction', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'compaction-recovery')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  const invocation = createUserMessage({
    content: [{ type: 'text', text: '<skill_content name="marivo-analysis">instructions</skill_content>' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  const signal = new AbortController().signal

  const initial = await controller.prepareStep([invocation], signal)
  const recovered = await controller.prepareStep([], signal)

  assert.equal(initial.length, 1)
  assert.equal(recovered.length, 1)
  assert.match(JSON.stringify(recovered), /help-body:analysis/)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'analysis',
    'analysis',
  ])
  assert.deepEqual(controller.telemetry().rootHelp.map(item => item.reason), [
    'activation',
    'recovery',
  ])
})

test('an already-visible receipt cannot suppress recovery after compaction hides the full body', async (t) => {
  const fixture = await environmentFixture({ fingerprint: '4'.repeat(64) })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'receipt-compaction-recovery')
  const bodyDigest = marivoHelpBodyDigest('help-body:analysis\n')
  const root = agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'full analysis root body' }],
    source: {
      kind: 'marivo-disclosure',
      form: 'root-help',
      skill: 'marivo-analysis',
      target: 'analysis',
      environmentFingerprint: fixture.environment.binding.fingerprint,
      bodyDigest,
    },
  }), { surfaceOp: 'append' })
  const callId = CallId('root-receipt')
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'marivo_help',
    arguments: JSON.stringify({ targets: ['analysis'] }),
  })
  agent.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'Current help is already visible in this prompt.' }],
      isError: false,
    }),
    meta: {
      kind: 'marivo-help-disclosure',
      environmentFingerprint: fixture.environment.binding.fingerprint,
      targets: [{ target: 'analysis', bodyDigest, delivery: 'already-visible' }],
    },
  }, { surfaceOp: 'append' })
  agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'compaction summary without the Help body' }],
    source: { kind: 'plugin', plugin: 'compaction-fixture' },
  }), {
    surfaceOp: { op: 'replace', start: root.seq, end: root.seq },
    sourceEventSeqs: [root.seq],
  })
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)

  const recovered = await controller.prepareStep([], new AbortController().signal)

  assert.equal(recovered.length, 1)
  assert.match(JSON.stringify(recovered), /help-body:analysis/)
  assert.equal(controller.telemetry().rootHelp[0]?.reason, 'recovery')
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), ['analysis'])
})

test('root help failure stops the next step once without hiding ordinary tools or retry loops', async (t) => {
  const fixture = await environmentFixture({ failTarget: 'authoring' })
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'semantic', name: 'skill', args: { name: 'marivo-semantic' } }]),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'root-help-failure')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  const errors: unknown[] = []
  ctx.on('agent/error', ({ agent: subject, error }) => {
    if (subject === agent) errors.push(error)
  })

  send(agent, 'activate broken root')
  await agent.whenIdle()

  assert.equal(adapter.requests.length, 1)
  assert.deepEqual(requestToolNames(adapter.requests[0]), ['marivo_help', 'ordinary', 'skill'])
  assert.ok(errors.some(error => error instanceof MarivoDisclosureError))
  assert.equal(controller.telemetry().failures.length, 1)
})

test('two-skill root help disclosure cancels its sibling and stays atomic when one read fails', async (t) => {
  const fixture = await environmentFixture({ failTarget: 'authoring', slowTarget: 'analysis' })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'atomic-root-help-failure')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  const invocations = [
    createUserMessage({
      content: [{ type: 'text', text: 'analysis skill' }],
      source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
    }),
    createUserMessage({
      content: [{ type: 'text', text: 'semantic skill' }],
      source: { kind: 'skill-invocation', name: 'marivo-semantic', form: 'instructions' },
    }),
  ]

  const startedAt = performance.now()
  await assert.rejects(
    controller.prepareStep(invocations, new AbortController().signal),
    (error: unknown) => (
      error instanceof MarivoDisclosureError
      && error.skills.join(',') === 'marivo-analysis,marivo-semantic'
    ),
  )
  assert.deepEqual(controller.telemetry().rootHelp, [])
  assert.equal(controller.telemetry().failures.length, 1)
  assert.ok(performance.now() - startedAt < 5_000)
})

test('cancelling a root help read leaves disclosure pending and records no delivery', async (t) => {
  const fixture = await environmentFixture({ slowTarget: 'analysis' })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'root-help-cancel')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  const invocation = createUserMessage({
    content: [{ type: 'text', text: 'analysis skill' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  const abort = new AbortController()
  const pending = controller.prepareStep([invocation], abort.signal)
  setTimeout(() => abort.abort(), 30)

  await assert.rejects(pending, MarivoDisclosureError)
  assert.deepEqual(controller.telemetry().rootHelp, [])
  assert.equal(controller.telemetry().failures.length, 1)
  assert.deepEqual(controller.activeSkills, ['marivo-analysis'])
})

test('disposing during a root Help read cancels it without late injection or telemetry', async (t) => {
  const fixture = await environmentFixture({ slowTarget: 'analysis' })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = createAgent(ctx, 'root-help-dispose')
  const controller = installMarivoDisclosure(ctx, agent, fixture.environment)
  const invocation = createUserMessage({
    content: [{ type: 'text', text: 'analysis skill' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  const startedAt = performance.now()
  const pending = controller.prepareStep([invocation], new AbortController().signal)
  setTimeout(() => controller.dispose(), 30)

  await assert.rejects(pending, /Marivo disclosure controller disposed/)
  assert.ok(performance.now() - startedAt < 5_000)
  assert.deepEqual(controller.activeSkills, [])
  assert.deepEqual(controller.telemetry().rootHelp, [])
  assert.deepEqual(controller.telemetry().failures, [])
})

test('Cordis plugin installs disclosure for live Agents and disposal removes only its scoped tools', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    textResponse('installed'),
    textResponse('disposed'),
  ])
  const ctx = await harness(adapter)
  const agent = createAgent(ctx, 'plugin-adapter')
  const dispose = installMarivoPlugin(ctx, fixture.environment, {
    credentials: { resolve: async () => undefined },
  })

  send(agent, 'before disposal')
  await agent.whenIdle()
  dispose()
  send(agent, 'after disposal')
  await agent.whenIdle()

  assert.deepEqual(requestToolNames(adapter.requests[0]), [
    'marivo_evidence_cite',
    'marivo_help',
    'marivo_test',
    'ordinary',
    'skill',
  ])
  assert.deepEqual(requestToolNames(adapter.requests[1]), ['ordinary', 'skill'])
})
