import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  assertSupportedJsonSchema,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import {
  comparisonDefinitions,
  datasourceActionInput,
  datasourceActionSchema,
} from '../../scripts/harness-public-surface/datasource-comparison.ts'
import { TestShellEnv } from '../test-shell-env.ts'
import { fixture } from './fixtures.ts'

const valid = [
  { action: 'configure', mode: 'create', reason: 'Create the fixture source' },
  { action: 'configure', mode: 'edit', name: 'warehouse', reason: 'Repair the fixture source' },
  { action: 'test', name: 'warehouse' },
]

test('candidate action schema rejects cross-action fields and secret-bearing settings', () => {
  assertSupportedJsonSchema(datasourceActionSchema)
  for (const input of valid) {
    assert.equal(validateJsonSchemaValue(datasourceActionSchema, input).length, 0)
    assert.equal(datasourceActionInput.safeParse(input).success, true)
  }
  for (const input of [
    { action: 'test', name: 'warehouse', mode: 'edit' },
    { action: 'test', name: 'warehouse', reason: 'repair' },
    { action: 'configure', mode: 'create', name: 'warehouse', reason: 'create' },
    { action: 'configure', mode: 'edit', reason: 'missing name' },
    { action: 'configure', name: 'warehouse', reason: 'missing mode' },
    { action: 'configure', mode: 'create', reason: 'create', password: 'fixture-only' },
    { action: 'test', name: 'warehouse', configuration: {} },
  ]) {
    assert.ok(validateJsonSchemaValue(datasourceActionSchema, input).length)
    assert.equal(datasourceActionInput.safeParse(input).success, false)
  }
})

test('isolated adapter delegates configure and test to existing definitions and service', async (t) => {
  const ctx = new Context()
  for (const plugin of [
    LlmRuntime,
    SessionStore,
    SystemPrompt,
    TestShellEnv,
    ToolRuntime,
    AgentRegistry,
    SessionProjectionRegistry,
  ])
    await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId(randomUUID()), {
    provider: 'fixture',
    model: 'fixture',
  })
  const f = fixture('none')
  t.after(async () => {
    await f.service.close()
    await ctx.fiber.dispose()
  })
  f.store.put('DB_PASSWORD')
  const definitions = comparisonDefinitions(f.bridge, f.service, 'action')
  assert.equal(definitions.length, 1)
  const stop = agent.ctx.tools.register(definitions[0]!)
  t.after(stop)
  assert.deepEqual(
    ctx.tools.schemas(agent).map((schema) => schema.name),
    ['marivo_datasource'],
  )
  const execute = (args: unknown) =>
    ctx.tools.execute({
      agent,
      callId: ToolCallId(randomUUID()),
      name: 'marivo_datasource',
      arguments: args,
      signal: AbortSignal.timeout(5000),
    })
  for (const input of valid.slice(0, 2)) {
    const result = await execute(input)
    assert.equal(result.isError, false)
    if (!result.isError)
      assert.equal(
        z.object({ status: z.string() }).parse(result.value).status,
        'needs-configuration',
      )
  }
  const tested = await execute(valid[2])
  assert.equal(tested.isError, false)
  if (!tested.isError)
    assert.deepEqual(tested.value, { status: 'ok', name: 'warehouse', latency_ms: 1 })
  assert.equal(f.tests, 1)
  const crossed = await execute({ action: 'test', name: 'warehouse', mode: 'edit' })
  assert.equal(crossed.isError, true)
  assert.equal(f.tests, 1, 'invalid cross-action input never enters the service')
})

test('the candidate preserves the real delegated Session handoff without opening a form', async (t) => {
  const ctx = new Context()
  for (const plugin of [
    LlmRuntime,
    SessionStore,
    SystemPrompt,
    TestShellEnv,
    ToolRuntime,
    AgentRegistry,
    SessionProjectionRegistry,
  ])
    await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const handle = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: { origin: 'subagent', delegationDepth: 1 },
    agentOptions: { provider: 'fixture', model: 'fixture' },
  })
  const f = fixture('web')
  t.after(async () => {
    await f.service.close()
    await handle.dispose()
    await ctx.fiber.dispose()
  })
  const stop = handle.agent.ctx.tools.register(
    comparisonDefinitions(f.bridge, f.service, 'action')[0]!,
  )
  t.after(stop)
  const result = await ctx.tools.execute({
    agent: handle.agent,
    callId: ToolCallId(randomUUID()),
    name: 'marivo_datasource',
    arguments: valid[1],
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(result.isError, false)
  if (!result.isError)
    assert.equal(
      z.object({ handoff: z.object({ reason: z.string() }) }).parse(result.value).handoff.reason,
      'parent-agent-required',
    )
  assert.equal(f.tests, 0)
  assert.equal(f.service.watch(String(handle.agent.session.id)).configurationRequests.length, 0)
})
