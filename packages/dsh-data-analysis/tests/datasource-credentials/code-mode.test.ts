import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { registerMarivoDatasourceAccessTool } from '../../src/datasource/access.ts'
import { fixture, operation, waiting } from './fixtures.ts'

async function harness(maxWallMs: number) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(WorkerThreadCodeRuntime, { maxWallMs })
  await ctx.plugin(ToolRuntime, { mode: 'code' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = ctx.agentLoop.create(SessionId('session'), { provider: 'unused', model: 'unused' })
  return { ctx, agent }
}
test('real Code Mode resumes the same SDK dispatch within its outer budget', async (t) => {
  const h = await harness(10000),
    f = fixture('web')
  t.after(async () => {
    await f.service.close()
    await h.ctx.fiber.dispose()
  })
  registerMarivoDatasourceAccessTool(h.agent.ctx, f.bridge, f.service)
  const pending = h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: CallId('code-within'),
    name: 'run_code',
    arguments: {
      description: 'Validate credential waiting',
      code: 'const result = await tools.marivo_datasource_access({name:"warehouse"}); console.log(result.status);',
    },
  })
  const request = await waiting(f)
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'code-canary' },
  })
  const result = await pending
  assert(!result.isError, JSON.stringify(result))
  assert.match(JSON.stringify(result), /ok/)
  assert.equal(f.service.watch('session').requests[0]?.status, 'succeeded')
  assert.doesNotMatch(JSON.stringify(result), /code-canary/)
})
test('real Code Mode wall deadline cancels a pending credential call and rejects old submission', async (t) => {
  const h = await harness(300),
    f = fixture('web')
  t.after(async () => {
    await f.service.close()
    await h.ctx.fiber.dispose()
  })
  registerMarivoDatasourceAccessTool(h.agent.ctx, f.bridge, f.service)
  const pending = h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: CallId('code-expired'),
    name: 'run_code',
    arguments: {
      description: 'Validate credential waiting',
      code: 'await tools.marivo_datasource_access({name:"warehouse"});',
    },
  })
  const request = await waiting(f)
  const result = await pending
  assert.equal(result.isError, true)
  assert.equal(f.service.watch('session').requests[0]?.status, 'call-ended')
  await assert.rejects(
    operation(f, request.context, 'submit', {
      requestId: request.id,
      changes: { DB_PASSWORD: 'late' },
    }),
    /call-ended/,
  )
  assert.equal(f.store.calls.set, 0)
})
