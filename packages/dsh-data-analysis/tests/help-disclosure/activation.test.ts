import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  createToolResultMessage,
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeParentOf } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, defineTool } from '@deepseek-ai/dsh-tools'
import {
  installMarivoDisclosure,
  MarivoDisclosureError,
  MarivoHelpBridge,
  marivoHelpBodyDigest,
} from '../../src/disclosure/index.ts'
import { FixedSubprocessPolicy, MarivoEnvironment } from '../../src/environment/index.ts'
import { installMarivoPlugin } from '../../src/plugin.ts'
import { TestShellEnv } from '../test-shell-env.ts'

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
  bridge: MarivoHelpBridge
  recordPath: string
  cleanup: () => Promise<void>
}

async function environmentFixture(
  options: {
    fingerprint?: string
    bodyPrefix?: string
    failTarget?: string
    slowTarget?: string
  } = {},
): Promise<EnvironmentFixture> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-disclosure-')))
  const executable = path.join(root, 'fixture-python')
  const recordPath = path.join(root, 'targets.log')
  for (const name of ['marivo-analysis', 'marivo-semantic', 'marivo-service']) {
    const dir = path.join(root, 'fake-marivo', 'skills', name)
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\n---\ninstructions:${name}\n`,
    )
  }
  await writeFile(executable, FAKE_PYTHON, 'utf8')
  await chmod(executable, 0o755)
  const policy = new FixedSubprocessPolicy(root, {
    PATH: process.env.PATH,
    RECORD_PATH: recordPath,
    ...(options.bodyPrefix === undefined ? {} : { BODY_PREFIX: options.bodyPrefix }),
    ...(options.failTarget === undefined ? {} : { FAIL_TARGET: options.failTarget }),
    ...(options.slowTarget === undefined ? {} : { SLOW_TARGET: options.slowTarget }),
  })
  const environment = new MarivoEnvironment(
    {
      projectRoot: root,
      pythonExecutable: executable,
      marivoVersion: '0.0.test',
      packagePath: path.join(root, 'fake-marivo', '__init__.py'),
      subprocessPolicyId: policy.id,
      fingerprint: options.fingerprint ?? 'c'.repeat(64),
    },
    policy,
  )
  return {
    environment,
    bridge: new MarivoHelpBridge(environment),
    recordPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
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
    const id = ToolCallId(call.id)
    const argumentsJson = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: argumentsJson },
      {
        type: 'block-end',
        index,
        block: { type: 'tool-call', id, name: call.name, arguments: argumentsJson },
      },
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

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
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
          resourceBase: {
            type: 'object',
            additionalProperties: false,
            properties: { kind: { type: 'string' }, path: { type: 'string' } },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: renderSkillContent(value as Parameters<typeof renderSkillContent>[0]),
        },
      ],
    },
    async execute({ name }) {
      return {
        name,
        provider: 'fixture',
        content: `instructions:${name}`,
        resourceBase: { kind: 'directory', path: '/fixture' },
      }
    },
  })
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  for (const name of [
    'marivo-analysis',
    'marivo-semantic',
    'marivo-service',
    'dsh-data-analysis-files',
  ]) {
    ctx.skills.register({
      name,
      description: 'fixture skill',
      source: 'runtime',
      provider: 'fixture',
      resourceBase: { kind: 'directory', path: '/fixture' },
      content: `instructions:${name}`,
    })
  }
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(
    defineContentToolFixture({
      name: 'ordinary',
      description: 'ordinary inherited tool',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'ordinary-result' }]
      },
    }),
  )
  ctx.tools.register(fixtureSkillTool())
  return ctx
}

async function createAgent(ctx: Context, id: string): Promise<Agent> {
  return await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
}

function send(agent: Agent, text: string): void {
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
  )
}

function requestToolNames(request: GenerateOptions | undefined): string[] {
  return request?.tools?.map((tool) => tool.name).sort() ?? []
}

function requestMessages(request: GenerateOptions | undefined): string {
  return JSON.stringify(request?.messages ?? [])
}

function explicitInvocation(
  name: 'marivo-analysis' | 'marivo-semantic' | 'marivo-service' | 'dsh-data-analysis-files',
) {
  return createUserMessage({
    content: [
      {
        type: 'text',
        text: renderSkillContent({
          name,
          provider: 'fixture',
          resourceBase: { kind: 'directory', path: '/fixture' },
          content: `instructions:${name}`,
        }),
      },
    ],
    source: { kind: 'skill-invocation', name, form: 'instructions' },
  })
}

function installProduction(ctx: Context, environment: MarivoEnvironment) {
  return installMarivoPlugin(ctx, environment, {
    credentials: {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {},
      unset: async () => {},
    },
  })
}

function guidanceMessages(request: GenerateOptions | undefined) {
  return (
    request?.messages.filter(
      (message) =>
        message.role === 'user' && JSON.stringify(message).includes('<marivo_execution_guidance>'),
    ) ?? []
  )
}

for (const path of ['inbox', 'waterfall'] as const) {
  for (const skill of ['marivo-analysis', 'marivo-semantic'] as const) {
    test(`${path} ${skill} keeps the public Help-only installer free of execution rules`, async (t) => {
      const fixture = await environmentFixture()
      t.after(fixture.cleanup)
      const adapter = new MockAdapter([textResponse('ready'), textResponse('continued')])
      const ctx = await harness(adapter)
      if (path === 'waterfall') {
        ctx.on('agent/pre-step', async (_payload, next) => {
          const decision = await next()
          return decision.kind === 'enter'
            ? { ...decision, messages: [...decision.messages, explicitInvocation(skill)] }
            : decision
        })
      }
      const agent = await createAgent(ctx, `${path}-${skill}-help-only`)
      const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
      t.after(() => controller.dispose())
      if (path === 'inbox') agent.followup(explicitInvocation(skill))
      else send(agent, '/activate')
      await agent.whenIdle()
      send(agent, 'continue')
      await agent.whenIdle()

      assert.equal(adapter.requests.length, 2)
      assert.deepEqual(controller.activeSkills, [skill])
      for (const request of adapter.requests) {
        assert.deepEqual(requestToolNames(request), ['marivo_help', 'ordinary', 'skill'])
        assert.match(
          requestMessages(request),
          skill === 'marivo-analysis' ? /help-body:analysis/ : /help-body:authoring/,
        )
        assert.equal(guidanceMessages(request).length, 0)
        assert.doesNotMatch(
          requestMessages(request),
          /DSH Credentials owns|Before completing any analysis|marivo_python|marivo_datasource_test/,
        )
      }
    })

    test(`${path} ${skill} delivers root Help with the same production routing on first activation and continuation`, async (t) => {
      const fixture = await environmentFixture()
      t.after(fixture.cleanup)
      const adapter = new MockAdapter([textResponse('ready'), textResponse('continued')])
      const ctx = await harness(adapter)
      if (path === 'waterfall') {
        ctx.on('agent/pre-step', async ({ messages }, next) => {
          const decision = await next()
          return decision.kind === 'enter' &&
            messages.some((message) =>
              message.content.some((part) => part.type === 'text' && part.text === '/activate'),
            )
            ? { ...decision, messages: [...decision.messages, explicitInvocation(skill)] }
            : decision
        })
      }
      const agent = await createAgent(ctx, `${path}-${skill}-production`)
      t.after(installProduction(ctx, fixture.environment))
      if (path === 'inbox') agent.followup(explicitInvocation(skill))
      else send(agent, '/activate')
      await agent.whenIdle()

      assert.equal(adapter.requests.length, 1)
      const first = requestMessages(adapter.requests[0])
      assert.match(
        first,
        skill === 'marivo-analysis' ? /help-body:analysis/ : /help-body:authoring/,
      )
      send(agent, 'continue')
      await agent.whenIdle()
      assert.equal(adapter.requests.length, 2)
      for (const request of adapter.requests) {
        const system = JSON.stringify(request.messages.filter((m) => m.role === 'system'))
        assert.match(system, /Harness credential forms/)
        assert.equal(guidanceMessages(request).length, 0)
      }
      assert.deepEqual(requestToolNames(adapter.requests[1]), requestToolNames(adapter.requests[0]))
    })
  }
}

test('visible focused root Help preserves request-series metadata on activation', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'focused-root', name: 'marivo_help', args: { targets: ['analysis'] } },
    ]),
    textResponse('read'),
    textResponse('activated'),
  ])
  const ctx = await harness(adapter)
  ctx.on('agent/pre-step', async ({ messages }, next) => {
    const decision = await next()
    return decision.kind === 'enter' &&
      messages.some((message) => message.source.kind === 'skill-invocation')
      ? { ...decision, startsRequestSeries: true }
      : decision
  })
  const agent = await createAgent(ctx, 'focused-root-then-activate')
  t.after(installProduction(ctx, fixture.environment))
  send(agent, 'read root without activating')
  await agent.whenIdle()
  assert.doesNotMatch(
    requestMessages(adapter.requests[1]),
    /DSH Credentials owns|Before completing any analysis/,
  )
  agent.followup(explicitInvocation('marivo-analysis'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 3)
  assert.doesNotMatch(requestMessages(adapter.requests[2]), /<marivo_help_context/)
  assert.equal(requestMessages(adapter.requests[2]).match(/help-body:analysis/g)?.length, 1)
  assert.equal(guidanceMessages(adapter.requests[2]).length, 0)
  assert.ok(
    agent.session
      .snapshotEvents()
      .some((event) => event.type === 'request/header' && event.data.reason === 'series'),
  )
})

test('rejected invocation leaves ordinary requests unactivated and retry receives root Help', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([textResponse('ordinary'), textResponse('ready')])
  const ctx = await harness(adapter)
  let reject = true
  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    return reject ? { kind: 'reject' } : decision
  })
  const agent = await createAgent(ctx, 'rejected-explicit')
  t.after(installProduction(ctx, fixture.environment))
  agent.followup(explicitInvocation('marivo-analysis'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 0)
  await assert.rejects(() => stat(fixture.recordPath), { code: 'ENOENT' })
  reject = false
  send(agent, 'ordinary after rejection')
  await agent.whenIdle()
  assert.doesNotMatch(
    requestMessages(adapter.requests[0]),
    /DSH Credentials owns|marivo_help_context/,
  )
  agent.followup(explicitInvocation('marivo-analysis'))
  await agent.whenIdle()
  assert.match(requestMessages(adapter.requests[1]), /help-body:analysis/)
})

for (const interruption of ['failure', 'cancel', 'dispose'] as const) {
  test(`explicit activation ${interruption} admits no partial root Help and can recover`, async (t) => {
    const fixture = await environmentFixture(
      interruption === 'failure'
        ? { failTarget: 'authoring', slowTarget: 'analysis' }
        : { slowTarget: 'analysis' },
    )
    t.after(fixture.cleanup)
    const adapter = new MockAdapter([textResponse('recovered')])
    const ctx = await harness(adapter)
    const agent = await createAgent(ctx, `interrupted-explicit-${interruption}`)
    let dispose = installProduction(ctx, fixture.environment)
    t.after(() => dispose())
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      return decision.kind === 'enter'
        ? {
            ...decision,
            messages: [
              ...decision.messages,
              explicitInvocation('marivo-analysis'),
              explicitInvocation('marivo-semantic'),
            ],
          }
        : decision
    })
    send(agent, 'activate both')
    if (interruption !== 'failure') {
      const deadline = Date.now() + 5000
      while (!(await readFile(fixture.recordPath, 'utf8').catch(() => '')).includes('analysis')) {
        assert.ok(Date.now() < deadline, 'root Help read started')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      if (interruption === 'cancel') agent.cancel({ kind: 'user' })
      else dispose()
    }
    await agent.whenIdle()
    assert.equal(adapter.requests.length, 0)
    assert.doesNotMatch(
      JSON.stringify(agent.session.snapshotEvents()),
      /<marivo_execution_guidance>|<marivo_help_context/,
    )
    await writeFile(
      fixture.environment.binding.pythonExecutable,
      FAKE_PYTHON.replace('process.env.FAIL_TARGET === target', 'false').replace(
        'process.env.SLOW_TARGET === target',
        'false',
      ),
    )
    if (interruption === 'dispose') dispose = installProduction(ctx, fixture.environment)
    send(agent, 'retry explicitly')
    await agent.whenIdle()
    assert.equal(adapter.requests.length, 1)
    assert.equal(guidanceMessages(adapter.requests[0]).length, 0)
    assert.match(requestMessages(adapter.requests[0]), /help-body:analysis/)
    assert.match(requestMessages(adapter.requests[0]), /help-body:authoring/)
  })
}

test('compaction and controller restoration recover Help without duplicating routing', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    textResponse('ready'),
    textResponse('compacted'),
    textResponse('restored'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'production-guidance-recovery')
  let dispose = installProduction(ctx, fixture.environment)
  t.after(() => dispose())
  agent.followup(explicitInvocation('marivo-analysis'))
  await agent.whenIdle()
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'user/message') continue
    agent.session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'compacted summary' }],
        source: { kind: 'user' },
      }),
      {
        surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq },
        sourceEventSeqs: [event.seq],
      },
    )
  }
  send(agent, 'continue after compaction')
  await agent.whenIdle()
  dispose()
  dispose = installProduction(ctx, fixture.environment)
  send(agent, 'continue after restoration')
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 3)
  for (const request of adapter.requests.slice(1)) {
    assert.equal(guidanceMessages(request).length, 0)
    assert.match(requestMessages(request), /help-body:analysis/)
    const system = JSON.stringify(request.messages.filter((message) => message.role === 'system'))
    assert.equal(system.match(/Harness credential forms/g)?.length, 1)
  }
})

test('production ordinary requests and a scope-local skill shadow do not activate root Help', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    textResponse('ordinary'),
    toolCallsResponse([
      { id: 'shadow-activate', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('shadow finished'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'production-shadow')
  t.after(installProduction(ctx, fixture.environment))
  agent.ctx.tools.register(fixtureSkillTool())
  send(agent, 'ordinary question')
  await agent.whenIdle()
  send(agent, 'call the local shadow')
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 3)
  for (const request of adapter.requests) {
    assert.doesNotMatch(
      requestMessages(request),
      /DSH Credentials owns|Before completing any analysis|marivo_help_context/,
    )
    assert.equal(guidanceMessages(request).length, 0)
    assert.deepEqual(requestToolNames(request), requestToolNames(adapter.requests[0]))
  }
  await assert.rejects(() => stat(fixture.recordPath), { code: 'ENOENT' })
})

for (const invocation of ['tool', 'explicit'] as const) {
  test(`file Skill ${invocation} invocation does not activate Marivo root Help or semantic rules`, async (t) => {
    const fixture = await environmentFixture()
    t.after(fixture.cleanup)
    const adapter = new MockAdapter([
      ...(invocation === 'tool'
        ? [
            toolCallsResponse([
              { id: 'file-skill', name: 'skill', args: { name: 'dsh-data-analysis-files' } },
            ]),
          ]
        : []),
      textResponse('file ready'),
      textResponse('continued'),
    ])
    const ctx = await harness(adapter)
    const agent = await createAgent(ctx, `file-skill-${invocation}`)
    t.after(installProduction(ctx, fixture.environment))
    if (invocation === 'explicit') agent.followup(explicitInvocation('dsh-data-analysis-files'))
    else send(agent, 'analyze the attached file')
    await agent.whenIdle()
    send(agent, 'continue with the same file')
    await agent.whenIdle()

    assert.equal(adapter.requests.length, invocation === 'tool' ? 3 : 2)
    assert.match(requestMessages(adapter.requests.at(-1)), /dsh-data-analysis-files/)
    for (const request of adapter.requests) {
      assert.equal(guidanceMessages(request).length, 0)
      assert.doesNotMatch(requestMessages(request), /marivo_help_context|DSH Credentials owns/)
      assert.ok(requestToolNames(request).includes('marivo_python'))
      assert.deepEqual(requestToolNames(request), requestToolNames(adapter.requests[0]))
    }
    await assert.rejects(() => stat(fixture.recordPath), { code: 'ENOENT' })
  })
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
  ctx.tools.register(
    defineContentToolFixture({
      name: 'bash',
      description: 'fixture shell tool',
      parameters: {},
      async execute() {
        return [{ type: 'text', text: 'bash-result' }]
      },
    }),
  )
  const agent = await createAgent(ctx, 'ordinary-turns')
  installMarivoDisclosure(ctx, agent, fixture.bridge)

  send(agent, 'ordinary one')
  await agent.whenIdle()
  send(agent, 'ordinary two')
  await agent.whenIdle()

  assert.ok(
    adapter.requests.every(
      (request) => requestToolNames(request).join(',') === 'bash,marivo_help,ordinary,skill',
    ),
  )
  assert.ok(
    adapter.requests.every((request) => !requestMessages(request).includes('marivo_help_context')),
  )
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
  const agent = await createAgent(ctx, 'semantic-activation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)

  send(agent, 'build semantics')
  await agent.whenIdle()

  assert.doesNotMatch(requestMessages(adapter.requests[0]), /marivo_help_context/)
  assert.match(requestMessages(adapter.requests[1]), /marivo_help_context.*marivo-semantic/)
  assert.match(requestMessages(adapter.requests[1]), /help-body:authoring/)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), ['authoring'])
  assert.deepEqual(controller.activeSkills, ['marivo-semantic'])
  assert.equal(controller.telemetry().rootHelp[0]?.target, 'authoring')
})

test('report tasks receive plugin routes in the system prompt', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([textResponse('ready')])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'presentation-single-entry')
  const dispose = installMarivoPlugin(ctx, fixture.environment, {
    credentials: {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {},
      unset: async () => {},
    },
  })
  t.after(dispose)

  send(agent, 'create a Marivo analysis report')
  await agent.whenIdle()
  const prompt = JSON.stringify(
    adapter.requests[0]?.messages.filter((entry) => entry.role === 'system') ?? [],
  )
  for (const route of [
    'dsh-data-analysis-files',
    'marivo-analysis',
    'marivo-semantic',
    'marivo_python',
    'native present',
    'marivo_report_write',
    'dsh-data-analysis-presentation',
  ])
    assert.ok(prompt.includes(route))
})

test('an Agent-plane inherited skill Tool activates root help without a legacy route', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'analysis-agent-plane', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
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
  const agent = await createAgent(ctx, 'source-prompt-agent-plane')
  bindScopeParent(agent, parentScope)
  assert.equal(scopeParentOf(agent), parentScope)
  assert.equal(agent.ctx.tools.get('skill', agent), agent.ctx.tools.get('skill', parentScope))
  const dispose = installMarivoPlugin(ctx, fixture.environment, {
    credentials: {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {},
      unset: async () => {},
    },
  })
  t.after(dispose)

  send(agent, 'analyze with an Agent-plane skill Tool')
  await agent.whenIdle()

  assert.doesNotMatch(
    JSON.stringify(
      adapter.requests[1]?.messages.filter((message) => message.role === 'system') ?? [],
    ),
    /marivo_evidence_sources/,
  )
  assert.match(requestMessages(adapter.requests[1]), /marivo_help_context/)
  assert.match(requestMessages(adapter.requests[1]), /help-body:analysis/)
})

test('an explicit user skill invocation activates the matching root help without a skill Tool call', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'explicit-invocation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const invocation = createUserMessage({
    content: [
      {
        type: 'text',
        text: renderSkillContent({
          name: 'marivo-analysis',
          provider: 'fixture',
          resourceBase: { kind: 'directory', path: '/fixture' },
          content: 'instructions:marivo-analysis',
        }),
      },
    ],
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
    if (decision.kind === 'reject' || !messages.some((message) => message.source.kind === 'user'))
      return decision
    const invocation = createUserMessage({
      content: [
        {
          type: 'text',
          text: renderSkillContent({
            name: 'marivo-analysis',
            provider: 'fixture',
            resourceBase: { kind: 'directory', path: '/fixture' },
            content: 'instructions:marivo-analysis',
          }),
        },
      ],
      source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
    })
    return { kind: 'enter' as const, messages: [...decision.messages, invocation] }
  })
  const agent = await createAgent(ctx, 'outer-skill-invocation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)

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
  const agent = await createAgent(ctx, 'skill-shadow')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  agent.ctx.tools.register(
    defineTool({
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
      async execute({ name }) {
        return { name }
      },
    }),
  )

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
  const agent = await createAgent(ctx, 'both-activation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)

  send(agent, 'author then analyze')
  await agent.whenIdle()

  const messages = requestMessages(adapter.requests[1])
  const analysis = messages.indexOf('help-body:analysis')
  const authoring = messages.indexOf('help-body:authoring')
  assert.ok(analysis >= 0 && authoring > analysis)
  assert.deepEqual(controller.activeSkills, ['marivo-analysis', 'marivo-semantic'])
  assert.deepEqual(
    controller.telemetry().rootHelp.map((item) => item.target),
    ['analysis', 'authoring'],
  )
})

test('analysis and service activation share one visible root while retaining both identities', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'service', name: 'skill', args: { name: 'marivo-service' } },
      { id: 'analysis', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('ready'),
    textResponse('continued'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'service-and-analysis')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  t.after(() => controller.dispose())

  send(agent, 'serve an analysis')
  await agent.whenIdle()
  assert.equal(requestMessages(adapter.requests[1]).split('help-body:analysis').length - 1, 1)
  assert.deepEqual(controller.activeSkills, ['marivo-analysis', 'marivo-service'])
  assert.deepEqual(
    controller.telemetry().rootHelp.map((item) => [item.skill, item.target, item.delivery]),
    [
      ['marivo-analysis', 'analysis', 'delivered'],
      ['marivo-service', 'analysis', 'already-visible'],
    ],
  )
  send(agent, 'continue')
  await agent.whenIdle()
  assert.equal(requestMessages(adapter.requests[2]).split('help-body:analysis').length - 1, 1)
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
  const agent = await createAgent(ctx, 'repeat-activation')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)

  send(agent, 'load twice')
  await agent.whenIdle()

  const last = requestMessages(adapter.requests[2])
  assert.equal(last.match(/<marivo_help_context/g)?.length, 1)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'authoring',
    'authoring',
  ])
  assert.deepEqual(
    controller.telemetry().rootHelp.map((item) => item.delivery),
    ['delivered', 'already-visible'],
  )
})

test('repeated focused help stays live and renders a receipt instead of duplicate unchanged body', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'help-1', name: 'marivo_help', args: { targets: ['analysis.session.observe'] } },
    ]),
    toolCallsResponse([
      { id: 'help-2', name: 'marivo_help', args: { targets: ['analysis.session.observe'] } },
    ]),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'focused-repeat')
  installMarivoDisclosure(ctx, agent, fixture.bridge)

  send(agent, 'read focused help twice')
  await agent.whenIdle()

  const results = agent.session.snapshotEvents().filter((event) => event.type === 'tool/result')
  const first = JSON.stringify(results[0])
  const second = JSON.stringify(results[1])
  assert.match(first, /help-body:analysis\.session\.observe/)
  assert.doesNotMatch(second, /help-body:analysis\.session\.observe/)
  assert.match(second, /already visible in this prompt/)
  assert.deepEqual((await readFile(fixture.recordPath, 'utf8')).trim().split('\n'), [
    'analysis.session.observe',
    'analysis.session.observe',
  ])
})

test('an environment change replaces active root help without a new skill load', async (t) => {
  const first = await environmentFixture({ fingerprint: '1'.repeat(64), bodyPrefix: 'old:' })
  const second = await environmentFixture({ fingerprint: '2'.repeat(64), bodyPrefix: 'new:' })
  t.after(first.cleanup)
  t.after(second.cleanup)
  let current = first.bridge
  const adapter = new MockAdapter([
    toolCallsResponse([{ id: 'analysis', name: 'skill', args: { name: 'marivo-analysis' } }]),
    textResponse('first done'),
    textResponse('second done'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'environment-replacement')
  const controller = installMarivoDisclosure(ctx, agent, () => Promise.resolve(current))

  send(agent, 'activate')
  await agent.whenIdle()
  current = second.bridge
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
  let current = first.bridge
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'body-replacement')
  const controller = installMarivoDisclosure(ctx, agent, () => Promise.resolve(current))
  const invocation = createUserMessage({
    content: [
      {
        type: 'text',
        text: renderSkillContent({
          name: 'marivo-analysis',
          provider: 'fixture',
          resourceBase: { kind: 'directory', path: '/fixture' },
          content: 'instructions:marivo-analysis',
        }),
      },
    ],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  const signal = new AbortController().signal

  const initial = await controller.prepareStep([invocation], signal)
  current = second.bridge
  const replacement = await controller.prepareStep([...initial, invocation], signal)

  assert.equal(replacement.length, 1)
  assert.match(JSON.stringify(replacement), /new:analysis/)
  assert.match(JSON.stringify(replacement), /replaces the earlier disclosure/)
  assert.deepEqual(
    controller.telemetry().rootHelp.map((item) => item.delivery),
    ['delivered', 'replacement'],
  )
})

test('hidden root disclosure is read live and restored after prompt compaction', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'compaction-recovery')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const invocation = createUserMessage({
    content: [
      {
        type: 'text',
        text: renderSkillContent({
          name: 'marivo-analysis',
          provider: 'fixture',
          resourceBase: { kind: 'directory', path: '/fixture' },
          content: 'instructions:marivo-analysis',
        }),
      },
    ],
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
  assert.deepEqual(
    controller.telemetry().rootHelp.map((item) => item.reason),
    ['activation', 'recovery'],
  )
})

test('an already-visible receipt cannot suppress recovery after compaction hides the full body', async (t) => {
  const fixture = await environmentFixture({ fingerprint: '4'.repeat(64) })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'receipt-compaction-recovery')
  const bodyDigest = marivoHelpBodyDigest('help-body:analysis\n')
  const root = agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'full analysis root body' }],
      source: {
        kind: 'marivo-disclosure',
        form: 'root-help',
        skill: 'marivo-analysis',
        target: 'analysis',
        environmentFingerprint: fixture.environment.binding.fingerprint,
        bodyDigest,
        skillBodyDigest: createHash('sha256').update('instructions:marivo-analysis').digest('hex'),
      },
    }),
    { surfaceOp: 'append' },
  )
  const callId = ToolCallId('root-receipt')
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'marivo_help',
    arguments: JSON.stringify({ targets: ['analysis'] }),
  })
  agent.session.append(
    'tool/result',
    {
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
    },
    { surfaceOp: 'append' },
  )
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'compaction summary without the Help body' }],
      source: { kind: 'user' },
    }),
    {
      surfaceOp: { op: 'replace', startSeq: root.seq, endSeq: root.seq },
      sourceEventSeqs: [root.seq],
    },
  )
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)

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
  const agent = await createAgent(ctx, 'root-help-failure')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const errors: unknown[] = []
  ctx.on('agent/error', ({ agent: subject, error }) => {
    if (subject === agent) errors.push(error)
  })

  send(agent, 'activate broken root')
  await agent.whenIdle()

  assert.equal(adapter.requests.length, 1)
  assert.deepEqual(requestToolNames(adapter.requests[0]), ['marivo_help', 'ordinary', 'skill'])
  assert.ok(errors.some((error) => error instanceof MarivoDisclosureError))
  assert.equal(controller.telemetry().failures.length, 1)
})

test('two-skill root help disclosure cancels its sibling and stays atomic when one read fails', async (t) => {
  const fixture = await environmentFixture({ failTarget: 'authoring', slowTarget: 'analysis' })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'atomic-root-help-failure')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const invocations = [
    createUserMessage({
      content: [
        {
          type: 'text',
          text: renderSkillContent({
            name: 'marivo-analysis',
            provider: 'fixture',
            resourceBase: { kind: 'directory', path: '/fixture' },
            content: 'instructions:marivo-analysis',
          }),
        },
      ],
      source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
    }),
    createUserMessage({
      content: [
        {
          type: 'text',
          text: renderSkillContent({
            name: 'marivo-semantic',
            provider: 'fixture',
            resourceBase: { kind: 'directory', path: '/fixture' },
            content: 'instructions:marivo-semantic',
          }),
        },
      ],
      source: { kind: 'skill-invocation', name: 'marivo-semantic', form: 'instructions' },
    }),
  ]

  const startedAt = performance.now()
  await assert.rejects(
    controller.prepareStep(invocations, new AbortController().signal),
    (error: unknown) =>
      error instanceof MarivoDisclosureError &&
      error.skills.join(',') === 'marivo-analysis,marivo-semantic',
  )
  assert.deepEqual(controller.telemetry().rootHelp, [])
  assert.equal(controller.telemetry().failures.length, 1)
  assert.ok(performance.now() - startedAt < 5_000)
})

test('cancelling a root help read leaves disclosure pending and records no delivery', async (t) => {
  const fixture = await environmentFixture({ slowTarget: 'analysis' })
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'root-help-cancel')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const invocation = createUserMessage({
    content: [
      {
        type: 'text',
        text: renderSkillContent({
          name: 'marivo-analysis',
          provider: 'fixture',
          resourceBase: { kind: 'directory', path: '/fixture' },
          content: 'instructions:marivo-analysis',
        }),
      },
    ],
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
  const agent = await createAgent(ctx, 'root-help-dispose')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const invocation = createUserMessage({
    content: [
      {
        type: 'text',
        text: renderSkillContent({
          name: 'marivo-analysis',
          provider: 'fixture',
          resourceBase: { kind: 'directory', path: '/fixture' },
          content: 'instructions:marivo-analysis',
        }),
      },
    ],
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
  const adapter = new MockAdapter([textResponse('installed'), textResponse('disposed')])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'plugin-adapter')
  const dispose = installMarivoPlugin(ctx, fixture.environment, {
    pythonTimeoutMs: 234_000,
    credentials: {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {},
      unset: async () => {},
    },
  })

  send(agent, 'before disposal')
  await agent.whenIdle()
  dispose()
  send(agent, 'after disposal')
  await agent.whenIdle()

  assert.deepEqual(requestToolNames(adapter.requests[0]), [
    'marivo_datasource_test',
    'marivo_help',
    'marivo_next_steps',
    'marivo_python',
    'marivo_report_delete',
    'marivo_report_read',
    'marivo_report_write',
    'ordinary',
    'skill',
  ])
  assert.deepEqual(requestToolNames(adapter.requests[1]), ['ordinary', 'skill'])
  const python = adapter.requests[0]?.tools?.find((tool) => tool.name === 'marivo_python')
  assert.match(JSON.stringify(python), /current plugin pythonTimeoutMs setting/)
})

test('plugin lifecycle never mutates the Host persistence environment', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  await createAgent(ctx, 'persistence-policy')
  const previous = process.env.MARIVO_PERSIST_CREDENTIALS
  process.env.MARIVO_PERSIST_CREDENTIALS = 'previous-value'
  t.after(() => {
    if (previous === undefined) delete process.env.MARIVO_PERSIST_CREDENTIALS
    else process.env.MARIVO_PERSIST_CREDENTIALS = previous
  })
  const environmentBeforeInstall = { ...process.env }

  const dispose = installMarivoPlugin(ctx, fixture.environment, {
    credentials: {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {},
      unset: async () => {},
    },
  })
  assert.deepEqual({ ...process.env }, environmentBeforeInstall)

  dispose()
  assert.deepEqual({ ...process.env }, environmentBeforeInstall)
})

test('a loaded foreign Skill is compared to the bound Runtime body; conflict and missing identity block until a verified reload', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'skill-identity-conflict')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const signal = new AbortController().signal
  const call = { name: 'skill', agent } as unknown as import('@deepseek-ai/dsh-tools').ToolExecution
  const result = (value: unknown) => {
    const item = value as { name?: unknown; provider?: unknown; content?: unknown }
    const content =
      typeof item.name === 'string' &&
      typeof item.provider === 'string' &&
      typeof item.content === 'string'
        ? [
            {
              type: 'text' as const,
              text: renderSkillContent(value as Parameters<typeof renderSkillContent>[0]),
            },
          ]
        : []
    return {
      isError: false,
      value,
      content,
    } as import('@deepseek-ai/dsh-tools').ToolExecutionResult
  }
  controller.observeToolResult(
    call,
    result({
      name: 'marivo-analysis',
      provider: 'project',
      content: 'stale',
      resourceBase: { kind: 'directory', path: '/project/skill' },
    }),
  )
  await assert.rejects(controller.prepareStep([], signal), (error: unknown) => {
    assert(error instanceof MarivoDisclosureError)
    assert.match(error.message, /instructions/)
    assert.match(
      error.message,
      /Selected source: registry source [a-f0-9]{16}, resource kind directory/,
    )
    assert.match(error.message, /Expected Runtime Skill:.*skills\/marivo-analysis\/SKILL\.md/)
    assert.equal(error.message.includes('stale'), false)
    return true
  })
  await assert.rejects(stat(fixture.recordPath), { code: 'ENOENT' })
  controller.observeToolResult(
    call,
    result({
      name: 'marivo-analysis',
      content: 'instructions:marivo-analysis',
    }),
  )
  await assert.rejects(
    controller.prepareStep([], signal),
    /Cannot verify the loaded marivo-analysis/,
  )
  controller.observeToolResult(
    call,
    result({
      name: 'marivo-analysis',
      provider: 'different-provider',
      content: 'instructions:marivo-analysis',
      resourceBase: { kind: 'directory', path: '/project/skill' },
    }),
  )
  const messages = await controller.prepareStep([], signal)
  assert.equal(messages.length, 1)
  assert.match(JSON.stringify(messages), /help-body:analysis/)
})

test('explicit invocation requires the exact publicly rendered selected Skill and accepts CRLF frontmatter', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'explicit-skill-identity')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const signal = new AbortController().signal
  const file = path.join(
    path.dirname(fixture.environment.binding.packagePath),
    'skills',
    'marivo-analysis',
    'SKILL.md',
  )
  await writeFile(
    file,
    '---\r\nname: marivo-analysis\r\ndescription: fixture\r\n---\r\ninstructions:marivo-analysis\r\n',
  )
  const forged = createUserMessage({
    content: [{ type: 'text', text: 'instructions from an unknown source' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  await assert.rejects(
    controller.prepareStep([forged], signal),
    /Cannot verify the loaded marivo-analysis/,
  )
  const valid = explicitInvocation('marivo-analysis')
  const extra = createUserMessage({
    content: [...valid.content, { type: 'text', text: 'additional instructions' }],
    source: { kind: 'skill-invocation', name: 'marivo-analysis', form: 'instructions' },
  })
  await assert.rejects(
    controller.prepareStep([extra], signal),
    /Cannot verify the loaded marivo-analysis/,
  )
  const messages = await controller.prepareStep([explicitInvocation('marivo-analysis')], signal)
  assert.equal(messages.length, 1)
  assert.match(JSON.stringify(messages), /help-body:analysis/)
})

test('restored Skill identity is rechecked against the current Runtime; unknown history requires reload', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'restored-skill-identity')
  const signal = new AbortController().signal
  const first = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const [disclosure] = await first.prepareStep([explicitInvocation('marivo-analysis')], signal)
  assert.ok(disclosure)
  agent.session.append('user/message', disclosure, { surfaceOp: 'append' })
  await first.close()
  const restored = installMarivoDisclosure(ctx, agent, fixture.bridge)
  await restored.prepareStep([], signal)
  const file = path.join(
    path.dirname(fixture.environment.binding.packagePath),
    'skills',
    'marivo-analysis',
    'SKILL.md',
  )
  await writeFile(
    file,
    '---\nname: marivo-analysis\ndescription: changed\n---\nnew runtime instructions\n',
  )
  await assert.rejects(restored.prepareStep([], signal), /Cannot verify the loaded marivo-analysis/)
  await writeFile(
    file,
    '---\nname: marivo-analysis\ndescription: fixture\n---\ninstructions:marivo-analysis\n',
  )
  await restored.prepareStep([], signal)
  await restored.close()
  const legacyAgent = await createAgent(ctx, 'legacy-skill-identity')
  legacyAgent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'old root' }],
      source: {
        kind: 'marivo-disclosure',
        form: 'root-help',
        skill: 'marivo-analysis',
        target: 'analysis',
        environmentFingerprint: fixture.environment.binding.fingerprint,
        bodyDigest: 'a'.repeat(64),
      },
    }),
    { surfaceOp: 'append' },
  )
  const legacy = installMarivoDisclosure(ctx, legacyAgent, fixture.bridge)
  await assert.rejects(legacy.prepareStep([], signal), /Reload this Skill before continuing/)
  await legacy.prepareStep([explicitInvocation('marivo-analysis')], signal)
})

test('Skill identity failures expose bounded repair guidance without provider text or host paths', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'skill-identity-redaction')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const call = { name: 'skill', agent } as unknown as import('@deepseek-ai/dsh-tools').ToolExecution
  const value = {
    name: 'marivo-analysis',
    provider: 'PROVIDER_SECRET_CANARY',
    content: 'stale',
    resourceBase: { kind: 'directory' as const, path: '/PRIVATE_SKILL_PATH' },
  }
  controller.observeToolResult(call, {
    isError: false,
    content: [{ type: 'text', text: renderSkillContent(value) }],
    value,
  } as import('@deepseek-ai/dsh-tools').ToolExecutionResult)
  const signal = new AbortController().signal
  await assert.rejects(controller.prepareStep([], signal), (error: unknown) => {
    assert(error instanceof MarivoDisclosureError)
    assert.match(error.message, /Align the selected Skill/i)
    assert.doesNotMatch(error.message, /PROVIDER_SECRET_CANARY|PRIVATE_SKILL_PATH/)
    return true
  })
  const file = path.join(
    path.dirname(fixture.environment.binding.packagePath),
    'skills',
    'marivo-analysis',
    'SKILL.md',
  )
  await rm(file)
  await assert.rejects(controller.prepareStep([], signal), (error: unknown) => {
    assert(error instanceof MarivoDisclosureError)
    assert.match(error.message, /Cannot read/)
    assert.doesNotMatch(
      error.message,
      /ENOENT|fake-marivo|PROVIDER_SECRET_CANARY|PRIVATE_SKILL_PATH/,
    )
    return true
  })
  assert.doesNotMatch(
    JSON.stringify(controller.telemetry()),
    /ENOENT|fake-marivo|PROVIDER_SECRET_CANARY|PRIVATE_SKILL_PATH/,
  )
})

test('explicit Skill registry errors are bounded and do not leak provider details', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  ctx.skills.registerProvider(() => ({
    name: 'broken-provider',
    list: async () => [
      {
        name: 'marivo-analysis',
        description: 'fixture',
        source: 'project-agents',
        provider: 'broken-provider',
        rank: 0,
        locator: null,
        invocation: { userInvocable: true, modelInvocable: true },
      },
    ],
    get: async () => {
      throw new Error('PROVIDER_ERROR_SECRET_CANARY /private/path')
    },
  }))
  const agent = await createAgent(ctx, 'skill-registry-error')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  await assert.rejects(
    controller.prepareStep([explicitInvocation('marivo-analysis')], new AbortController().signal),
    (error: unknown) => {
      assert(error instanceof MarivoDisclosureError)
      assert.match(error.message, /marivo-analysis/)
      assert.doesNotMatch(error.message, /PROVIDER_ERROR_SECRET_CANARY|\/private\/path/)
      return true
    },
  )
  assert.doesNotMatch(
    JSON.stringify(controller.telemetry()),
    /PROVIDER_ERROR_SECRET_CANARY|\/private\/path/,
  )
})

test('disposing the disclosure controller aborts an in-flight explicit Skill lookup', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  ctx.skills.registerProvider(() => ({
    name: 'slow-provider',
    list: async () => [
      {
        name: 'marivo-analysis',
        description: 'fixture',
        source: 'project-agents',
        provider: 'slow-provider',
        rank: 0,
        locator: null,
        invocation: { userInvocable: true, modelInvocable: true },
      },
    ],
    get: async () => await new Promise<never>(() => {}),
  }))
  const agent = await createAgent(ctx, 'skill-registry-cancel')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const pending = controller.prepareStep(
    [explicitInvocation('marivo-analysis')],
    new AbortController().signal,
  )
  setTimeout(() => controller.dispose(), 30)
  await assert.rejects(pending, /Marivo disclosure controller disposed/)
  await controller.close()
  assert.deepEqual(controller.telemetry().failures, [])
})

test('a later historical Skill tool load invalidates older attestation on recovery', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'later-skill-history')
  const signal = new AbortController().signal
  const first = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const [disclosure] = await first.prepareStep([explicitInvocation('marivo-analysis')], signal)
  assert.ok(disclosure)
  agent.session.append('user/message', disclosure, { surfaceOp: 'append' })
  await first.close()
  const callId = ToolCallId('later-skill-load')
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'skill',
    arguments: JSON.stringify({ name: 'marivo-analysis' }),
  })
  agent.session.append(
    'tool/result',
    {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'unknown provider instructions' }],
        isError: false,
      }),
    },
    { surfaceOp: 'append' },
  )
  const restored = installMarivoDisclosure(ctx, agent, fixture.bridge)
  await assert.rejects(restored.prepareStep([], signal), /Reload this Skill before continuing/)
  await restored.prepareStep([explicitInvocation('marivo-analysis')], signal)
})

test('recovery does not infer activation from a successful scope-local Skill shadow', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'shadow-before-recovery', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('shadow complete'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'shadow-before-recovery')
  const before = installMarivoDisclosure(ctx, agent, fixture.bridge)
  agent.ctx.tools.register(fixtureSkillTool())
  send(agent, 'use the scope-local tool')
  await agent.whenIdle()
  assert.deepEqual(before.activeSkills, [])
  await before.close()
  const restored = installMarivoDisclosure(ctx, agent, fixture.bridge)
  assert.deepEqual(restored.activeSkills, [])
  assert.deepEqual(await restored.prepareStep([], new AbortController().signal), [])
  await assert.rejects(stat(fixture.recordPath), { code: 'ENOENT' })
})

test('unattested historical Skill results cannot establish activation when provider identity was not persisted', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'unattested-skill-history')
  const callId = ToolCallId('unattested-first-skill')
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'skill',
    arguments: JSON.stringify({ name: 'marivo-analysis' }),
  })
  agent.session.append(
    'tool/result',
    {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'rendered Skill result with no attested Tool identity' }],
        isError: false,
      }),
    },
    { surfaceOp: 'append' },
  )
  const restored = installMarivoDisclosure(ctx, agent, fixture.bridge)
  // The persisted event cannot distinguish a real inherited tool from a scoped
  // shadow when interrupted before this plugin's first attestation is recorded.
  assert.deepEqual(restored.activeSkills, [])
  assert.deepEqual(await restored.prepareStep([], new AbortController().signal), [])
  await assert.rejects(stat(fixture.recordPath), { code: 'ENOENT' })
})

test('a shadow call after verified activation conservatively requires reload only on recovery', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'shadow-after-attestation', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('shadow complete'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'shadow-after-attestation')
  const before = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const [disclosure] = await before.prepareStep(
    [explicitInvocation('marivo-analysis')],
    new AbortController().signal,
  )
  assert.ok(disclosure)
  agent.session.append('user/message', disclosure, { surfaceOp: 'append' })
  agent.ctx.tools.register(fixtureSkillTool())
  send(agent, 'use the scope-local tool')
  await agent.whenIdle()
  assert.deepEqual(before.activeSkills, ['marivo-analysis'])
  await before.close()
  const restored = installMarivoDisclosure(ctx, agent, fixture.bridge)
  assert.deepEqual(restored.activeSkills, ['marivo-analysis'])
  await assert.rejects(
    restored.prepareStep([], new AbortController().signal),
    /Reload this Skill before continuing/,
  )
})

test('a verified reload cannot hide an earlier conflicting Skill result still on the session surface', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'visible-conflicting-skill')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const signal = new AbortController().signal
  const [priorAttestation] = await controller.prepareStep(
    [explicitInvocation('marivo-analysis')],
    signal,
  )
  assert.ok(priorAttestation)
  agent.session.append('user/message', priorAttestation, { surfaceOp: 'append' })
  function load(id: string, body: string) {
    const callId = ToolCallId(id)
    const value = {
      name: 'marivo-analysis',
      provider: 'fixture',
      content: body,
      resourceBase: { kind: 'directory' as const, path: '/fixture' },
    }
    const content = [{ type: 'text' as const, text: renderSkillContent(value) }]
    controller.observeToolResult(
      { name: 'skill', agent, callId } as unknown as import('@deepseek-ai/dsh-tools').ToolExecution,
      { isError: false, value, content },
    )
    agent.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'skill',
      arguments: JSON.stringify({ name: 'marivo-analysis' }),
    })
    return agent.session.append(
      'tool/result',
      { turn: 1, step: 1, message: createToolResultMessage({ callId, content, isError: false }) },
      { surfaceOp: 'append' },
    )
  }
  const conflict = load('stale-skill', 'stale instructions')
  await assert.rejects(controller.prepareStep([], signal), (error: unknown) => {
    assert(error instanceof MarivoDisclosureError)
    assert.match(error.message, /conflicting|different instructions/i)
    assert.match(error.message, /Visible source/)
    assert.match(error.message, /resource kind directory/)
    assert.match(error.message, /Expected Runtime Skill:.*skills\/marivo-analysis\/SKILL\.md/)
    assert.equal(error.message.includes('stale instructions'), false)
    return true
  })
  load('correct-skill', 'instructions:marivo-analysis')
  await assert.rejects(controller.prepareStep([], signal), /conflict.*visible|visible.*conflict/i)
  assert.ok(agent.session.surface.nodes.includes(conflict.seq))
  await controller.close()
  const restored = installMarivoDisclosure(ctx, agent, fixture.bridge)
  await assert.rejects(restored.prepareStep([], signal), /conflict.*visible|visible.*conflict/i)
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [
        {
          type: 'text',
          text: 'Host compaction removed the earlier instructions from the current context.',
        },
      ],
      source: { kind: 'user' },
    }),
    {
      surfaceOp: { op: 'replace', startSeq: conflict.seq, endSeq: conflict.seq },
      sourceEventSeqs: [conflict.seq],
    },
  )
  assert.ok(!agent.session.surface.nodes.includes(conflict.seq))
  const safe = await restored.prepareStep([explicitInvocation('marivo-analysis')], signal)
  assert.ok(safe.length > 0)
  assert.ok(agent.session.snapshotEvents().some((event) => event.seq === conflict.seq))
})

test('a live scoped Skill shadow with different canonical instructions does not block the next model request', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'canonical-shadow', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('done'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'canonical-skill-shadow')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  agent.ctx.tools.register(
    defineTool({
      name: 'skill',
      description: 'scope-local shadow',
      parameters: { name: { type: 'string', required: true } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', required: true } },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderSkillContent({
              name: value.name,
              provider: 'shadow',
              content: 'unrelated shadow instructions',
            }),
          },
        ],
      },
      async execute({ name }) {
        return { name }
      },
    }),
  )
  send(agent, 'use the shadow')
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 2)
  assert.deepEqual(controller.activeSkills, [])
  assert.doesNotMatch(requestMessages(adapter.requests[1]), /marivo_help_context/)
})

test('equivalent Skill bodies are accepted for every public resource-base variant', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const ctx = await harness(new MockAdapter([textResponse('unused')]))
  const agent = await createAgent(ctx, 'skill-resource-variants')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  const signal = new AbortController().signal
  const call = { name: 'skill', agent } as unknown as import('@deepseek-ai/dsh-tools').ToolExecution
  for (const resourceBase of [
    undefined,
    { kind: 'url' as const, url: 'https://example.test/' },
    { kind: 'opaque' as const, description: 'virtual' },
    { kind: 'directory' as const, path: '/other' },
  ]) {
    const value = {
      name: 'marivo-analysis',
      provider: 'different-provider',
      content: 'instructions:marivo-analysis',
      ...(resourceBase ? { resourceBase } : {}),
    }
    controller.observeToolResult(call, {
      isError: false,
      value: JSON.parse(JSON.stringify(value)),
      content: [{ type: 'text', text: renderSkillContent(value) }],
    })
    const messages = await controller.prepareStep([], signal)
    assert.match(JSON.stringify(messages), /help-body:analysis/)
  }
})

test('a post-execute policy cannot swap Skill presentation while keeping a valid value', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'tampered-skill-content', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('must not run'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'tampered-skill-content')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next()
    return exec.agent === agent && exec.name === 'skill' && decision.kind === 'accept'
      ? { kind: 'accept', content: [{ type: 'text', text: 'untrusted replacement' }] }
      : decision
  })
  send(agent, 'load analysis')
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 1)
  assert.ok(
    controller
      .telemetry()
      .failures.some((item) => /conflict.*visible|visible.*conflict/i.test(item.message)),
  )
})

test('extra text blocks in a finalized Skill result block the next model request', async (t) => {
  const fixture = await environmentFixture()
  t.after(fixture.cleanup)
  const adapter = new MockAdapter([
    toolCallsResponse([
      { id: 'extra-skill-block', name: 'skill', args: { name: 'marivo-analysis' } },
    ]),
    textResponse('must not run'),
  ])
  const ctx = await harness(adapter)
  const agent = await createAgent(ctx, 'extra-skill-block')
  const controller = installMarivoDisclosure(ctx, agent, fixture.bridge)
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    return exec.agent === agent && exec.name === 'skill' && decision.kind === 'accept'
      ? {
          kind: 'accept',
          content: [...result.content, { type: 'text', text: 'additional instructions' }],
        }
      : decision
  })
  send(agent, 'load analysis')
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 1)
  assert.ok(
    controller
      .telemetry()
      .failures.some((item) => /conflict.*visible|visible.*conflict/i.test(item.message)),
  )
})
