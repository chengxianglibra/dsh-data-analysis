import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ShellExecutor, {
  type ShellExecRequest,
  type ShellExecSpec,
  type ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { registerMarivoPythonTool } from '../../src/datasource/python.ts'
import { TestShellEnv } from '../test-shell-env.ts'
import { fixture, operation, waiting } from './fixtures.ts'

/** Count the Shell boundary; worker-thread dispatch and credential service are real. */
class CountingShell extends ShellExecutor {
  starts = 0
  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      workdir: '/workspace',
      timeoutMs: 120_000,
      stdoutMaxBytes: 65536,
      ...request,
      sandboxPolicy: request.sandboxPolicy,
    }
  }
  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    spec.signal?.throwIfAborted()
    this.starts++
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: 'PYTHON_ONCE', truncated: false },
      stderr: { text: '', truncated: false },
    }
  }
  start(): never {
    throw new Error('Foreground execution required')
  }
}

async function harness(maxWallMs: number) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(CountingShell)
  await ctx.plugin(WorkerThreadCodeRuntime, { maxWallMs })
  await ctx.plugin(ToolRuntime, { mode: 'ptc' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('session'), {
    provider: 'unused',
    model: 'unused',
  })
  return { ctx, agent }
}
test('real Code Mode resumes the same SDK dispatch within its outer budget', async (t) => {
  const h = await harness(10000),
    f = fixture('web')
  t.after(async () => {
    await f.service.close()
    await h.ctx.fiber.dispose()
  })
  registerMarivoPythonTool(h.agent.ctx, f.bridge, f.service)
  const pending = h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: ToolCallId('code-within'),
    name: 'run_code',
    arguments: {
      description: 'Validate credential waiting',
      code: 'const result = await tools.marivo_python({code:"print(1)",datasources:["warehouse"]}); console.log(result.stdout);',
    },
  })
  const request = await waiting(f)
  assert.equal((h.ctx.shell as CountingShell).starts, 0)
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { DB_PASSWORD: 'code-canary' },
  })
  const result = await pending
  assert(!result.isError, JSON.stringify(result))
  assert.match(JSON.stringify(result), /PYTHON_ONCE/)
  assert.equal((h.ctx.shell as CountingShell).starts, 1)
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
  registerMarivoPythonTool(h.agent.ctx, f.bridge, f.service)
  const pending = h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: ToolCallId('code-expired'),
    name: 'run_code',
    arguments: {
      description: 'Validate credential waiting',
      code: 'await tools.marivo_python({code:"print(1)",datasources:["warehouse"]});',
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
  assert.equal((h.ctx.shell as CountingShell).starts, 0)
})
