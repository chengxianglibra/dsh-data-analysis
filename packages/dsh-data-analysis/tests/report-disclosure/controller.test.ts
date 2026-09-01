import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME } from '../../src/report-check/index.ts'
import {
  REPORT_SKILL_NAME,
  ReportCheckDisclosureController,
} from '../../src/report-disclosure/index.ts'

function skillTool(fail = false): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'skill',
    description: 'load one fixture skill',
    parameters: { name: { type: 'string', required: true } },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute({ name }) {
      if (fail) throw new Error('fixture skill load failed')
      return { name, provider: 'fixture', content: `instructions:${String(name)}` }
    },
  })
}

async function harness(options: { failSkill?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.tools.register(skillTool(options.failSkill))
  return ctx
}

function createAgent(ctx: Context, id: string): Agent {
  return ctx.agentLoop.create(SessionId(id), { provider: 'fixture', model: 'fixture' })
}

function invocationMessage() {
  return createUserMessage({
    content: [
      { type: 'text', text: `<skill_content name="${REPORT_SKILL_NAME}">body</skill_content>` },
    ],
    source: { kind: 'skill-invocation', name: REPORT_SKILL_NAME, form: 'instructions' },
  })
}

function checkerVisible(agent: Agent): boolean {
  return (
    agent.ctx.tools.get(DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME, agent)?.name ===
    DSH_DATA_ANALYSIS_REPORT_CHECK_TOOL_NAME
  )
}

test('successful model Skill result activates only the calling Agent and matching turn', async (t) => {
  const ctx = await harness()
  t.after(() => ctx.fiber.dispose())
  const first = createAgent(ctx, 'report-model-first')
  const second = createAgent(ctx, 'report-model-second')
  const controller = new ReportCheckDisclosureController(first)
  first.ctx.on('tools/result', (exec, result) => {
    controller.observeToolResult(exec, result)
  })
  const signal = new AbortController().signal
  first.session.append('turn/start', { turn: 1 })

  const result = await first.ctx.tools.execute({
    callId: CallId('load-report-skill'),
    name: 'skill',
    arguments: { name: REPORT_SKILL_NAME },
    agent: first,
    signal,
  })

  assert.equal(result.isError, false)
  assert.equal(controller.activeTurn, 1)
  assert.equal(checkerVisible(first), true)
  assert.equal(checkerVisible(second), false)
  const end = first.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  controller.observeSessionEvent(first.session, end)
  assert.equal(checkerVisible(first), false)
  controller.dispose()
})

test('failed, mismatched, and shadowed Skill results never activate the Checker', async (t) => {
  const failedCtx = await harness({ failSkill: true })
  t.after(() => failedCtx.fiber.dispose())
  const failedAgent = createAgent(failedCtx, 'report-model-failed')
  const failedController = new ReportCheckDisclosureController(failedAgent)
  failedAgent.ctx.on('tools/result', (exec, result) => {
    failedController.observeToolResult(exec, result)
  })
  failedAgent.session.append('turn/start', { turn: 1 })
  await failedAgent.ctx.tools.execute({
    callId: CallId('failed-report-skill'),
    name: 'skill',
    arguments: { name: REPORT_SKILL_NAME },
    agent: failedAgent,
    signal: new AbortController().signal,
  })
  assert.equal(checkerVisible(failedAgent), false)

  const ctx = await harness()
  t.after(() => ctx.fiber.dispose())
  const agent = createAgent(ctx, 'report-model-shadow')
  const controller = new ReportCheckDisclosureController(agent)
  agent.ctx.on('tools/result', (exec, result) => {
    controller.observeToolResult(exec, result)
  })
  agent.session.append('turn/start', { turn: 1 })
  await agent.ctx.tools.execute({
    callId: CallId('wrong-skill'),
    name: 'skill',
    arguments: { name: 'marivo-analysis' },
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(checkerVisible(agent), false)

  agent.ctx.tools.register(skillTool())
  await agent.ctx.tools.execute({
    callId: CallId('shadowed-report-skill'),
    name: 'skill',
    arguments: { name: REPORT_SKILL_NAME },
    agent,
    signal: new AbortController().signal,
  })
  assert.equal(checkerVisible(agent), false)
})

test('explicit invocation activates while plain text does not, and abort/dispose revoke immediately', async (t) => {
  const ctx = await harness()
  t.after(() => ctx.fiber.dispose())
  const agent = createAgent(ctx, 'report-user-invocation')
  const controller = new ReportCheckDisclosureController(agent)
  const turnSignal = new AbortController()

  controller.observeStep(
    [
      createUserMessage({
        content: [{ type: 'text', text: `mention ${REPORT_SKILL_NAME} only` }],
        source: { kind: 'user' },
      }),
    ],
    1,
    turnSignal.signal,
  )
  assert.equal(checkerVisible(agent), false)

  controller.observeStep([invocationMessage()], 1, turnSignal.signal)
  assert.equal(checkerVisible(agent), true)
  turnSignal.abort(new Error('cancelled'))
  assert.equal(checkerVisible(agent), false)

  const nextSignal = new AbortController()
  controller.observeStep([invocationMessage()], 2, nextSignal.signal)
  assert.equal(checkerVisible(agent), true)
  controller.dispose()
  assert.equal(checkerVisible(agent), false)
})

test('every durable turn end reason revokes the lease and turn-stopping alone does not', async (t) => {
  const ctx = await harness()
  t.after(() => ctx.fiber.dispose())
  const agent = createAgent(ctx, 'report-turn-end-reasons')
  const controller = new ReportCheckDisclosureController(agent)
  const reasons: TurnEndReason[] = [
    { kind: 'completed' },
    { kind: 'blocked' },
    { kind: 'max-tokens' },
    { kind: 'interrupted' },
    { kind: 'aborted', reason: { kind: 'user' } },
    { kind: 'error', error: { message: 'fixture', code: 'FIXTURE' } },
  ]

  for (const [index, reason] of reasons.entries()) {
    const turn = index + 1
    const signal = new AbortController().signal
    controller.observeStep([invocationMessage()], turn, signal)
    assert.equal(checkerVisible(agent), true)
    await agent.ctx.serial('agent/turn-stopping', { agent, turn, signal })
    assert.equal(checkerVisible(agent), true)
    controller.observeSessionEvent(agent.session, {
      type: 'turn/end',
      seq: turn,
      time: turn,
      data: { turn, reason },
    })
    assert.equal(checkerVisible(agent), false)
  }
})

test('a new turn clears a stale lease before it can cross the boundary', async (t) => {
  const ctx = await harness()
  t.after(() => ctx.fiber.dispose())
  const agent = createAgent(ctx, 'report-new-turn')
  const controller = new ReportCheckDisclosureController(agent)
  controller.observeStep([invocationMessage()], 1, new AbortController().signal)
  assert.equal(checkerVisible(agent), true)
  controller.observeSessionEvent(agent.session, {
    type: 'turn/start',
    seq: 2,
    time: 2,
    data: { turn: 2 },
  })
  assert.equal(checkerVisible(agent), false)
})
