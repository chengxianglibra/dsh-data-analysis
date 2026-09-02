import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineTool,
  type ToolExecution,
  type ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
import type { MarivoDatasourceBridgePort } from '../../src/datasource/index.ts'
import {
  MARIVO_CREDENTIAL_GRANT_PREFIX,
  MarivoShellCredentialGrants,
  registerMarivoRuntimeShellEnvironment,
} from '../../src/datasource/shell-env.ts'
import { TestShellEnv } from '../test-shell-env.ts'

class RotatingCredentials {
  readonly values = new Map<string, string>()
  readonly resolved: string[] = []
  readonly failures = new Set<string>()

  async resolve(ref: CredentialRef) {
    this.resolved.push(ref)
    if (this.failures.has(ref)) throw new Error(`provider leaked ${this.values.get(ref)}`)
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'memory' }
  }
}

function binding(fingerprint: string) {
  return {
    projectRoot: `/workspace/${fingerprint}`,
    pythonExecutable: '/runtime/python',
    marivoVersion: '0.5.3',
    packagePath: '/runtime/marivo/__init__.py',
    subprocessPolicyId: 'fixture',
    fingerprint,
  }
}

function datasource(fingerprint: string): MarivoDatasourceBridgePort {
  return {
    binding: binding(fingerprint),
    describe: async (name) => ({ name, refs: [] }),
    inventory: async () => [],
    test: async (name) => ({
      name,
      ok: true,
      latency_ms: 1,
      failure: null,
      repair: null,
    }),
  }
}

async function fixture(options: { ttlMs?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  const credentials = new RotatingCredentials()
  const grants = new MarivoShellCredentialGrants(ctx, credentials, options)
  const agent = {
    ctx,
    session: { header: { id: 'agent-a', cwd: '/workspace/a' } },
  } as unknown as Agent
  return { ctx, credentials, grants, agent }
}

function shellEnv(ctx: Context): TestShellEnv {
  return (ctx as unknown as { shellEnv: TestShellEnv }).shellEnv
}

function command(token: string, body = 'python analysis.py'): string {
  return `${MARIVO_CREDENTIAL_GRANT_PREFIX}${token}\n${body}`
}

function execution(
  id: string,
  agent: Agent,
  commandText: string,
  extra: Record<string, unknown> = {},
): ToolExecution {
  const callId = CallId(id)
  return {
    callId,
    rootCallId: callId,
    name: 'bash',
    arguments: { command: commandText, ...extra },
    agent,
    signal: new AbortController().signal,
    token: Symbol(id) as ToolExecutionToken,
  }
}

test('ordinary Shell calls never inventory or receive ambient datasource credentials', async (t) => {
  const { ctx, credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  credentials.values.set('DSH_DB_PASSWORD', 'ambient-secret')
  const call = execution('ordinary', agent, 'python analysis.py')

  assert.equal(await grants.prepareExecution(agent, datasource('workspace-a'), call), false)
  assert.deepEqual(shellEnv(ctx).collect(call), {})
  assert.deepEqual(credentials.resolved, [])
})

test('a successful datasource grant is fresh-resolved once for only its bound refs', async (t) => {
  const { ctx, credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set('DSH_DB_USER', 'alice')
  credentials.values.set('DSH_DB_PASSWORD', 'first-secret')
  credentials.values.set('DSH_OTHER_SECRET', 'must-stay-hidden')
  const receipt = grants.issueGrant(agent, workspace, 'warehouse', [
    'DSH_DB_USER',
    'DSH_DB_PASSWORD',
    'DSH_DB_PASSWORD',
  ])
  credentials.values.set('DSH_DB_PASSWORD', 'fresh-secret')
  const call = execution('granted', agent, command(receipt.token))

  assert.equal(await grants.prepareExecution(agent, workspace, call), true)
  assert.deepEqual(shellEnv(ctx).collect(call), {
    DSH_DB_PASSWORD: 'fresh-secret',
    DSH_DB_USER: 'alice',
  })
  assert.deepEqual(credentials.resolved, ['DSH_DB_USER', 'DSH_DB_PASSWORD'])
  assert.equal(receipt.token.length, 43)
  await assert.rejects(
    () =>
      grants.prepareExecution(agent, workspace, execution('reuse', agent, command(receipt.token))),
    /unknown or has already been used/,
  )
})

test('wrong Agent and Workspace grants fail closed without leaking or stealing the valid claim', async (t) => {
  const { ctx, credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  const otherAgent = {
    ctx,
    session: { header: { id: 'agent-b', cwd: '/workspace/a' } },
  } as unknown as Agent
  credentials.values.set('DSH_SCOPE_SECRET', 'scope-secret')
  const receipt = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_SCOPE_SECRET'])

  await assert.rejects(
    () =>
      grants.prepareExecution(
        otherAgent,
        workspace,
        execution('wrong-agent', otherAgent, command(receipt.token)),
      ),
    /belongs to another Agent/,
  )
  await assert.rejects(
    () =>
      grants.prepareExecution(
        agent,
        datasource('workspace-b'),
        execution('wrong-workspace', agent, command(receipt.token)),
      ),
    /belongs to another Workspace binding/,
  )
  const valid = execution('valid-scope', agent, command(receipt.token))
  await grants.prepareExecution(agent, workspace, valid)
  assert.deepEqual(shellEnv(ctx).collect(valid), { DSH_SCOPE_SECRET: 'scope-secret' })
})

test('expired and malformed markers fail before credential resolution', async (t) => {
  const { credentials, grants, agent } = await fixture({ ttlMs: 1 })
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set('DSH_EXPIRING_SECRET', 'expiring-secret')
  const receipt = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_EXPIRING_SECRET'])
  await new Promise((resolve) => setTimeout(resolve, 5))

  await assert.rejects(
    () =>
      grants.prepareExecution(
        agent,
        workspace,
        execution('expired', agent, command(receipt.token)),
      ),
    /has expired/,
  )
  await assert.rejects(
    () =>
      grants.prepareExecution(
        agent,
        workspace,
        execution('malformed', agent, '# dsh-marivo-credential-grant:not valid\ntrue'),
      ),
    /marker is malformed/,
  )
  assert.deepEqual(credentials.resolved, [])
})

test('a credential resolution failure consumes the grant and redacts provider errors', async (t) => {
  const { credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set('DSH_FAIL_SECRET', 'never-render-this-secret')
  credentials.failures.add('DSH_FAIL_SECRET')
  const receipt = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_FAIL_SECRET'])
  const first = execution('resolve-failure', agent, command(receipt.token))

  await assert.rejects(
    () => grants.prepareExecution(agent, workspace, first),
    (error: unknown) => {
      assert.doesNotMatch(String(error), /never-render-this-secret/)
      assert.doesNotMatch(JSON.stringify(error), new RegExp(receipt.token))
      return /could not be resolved/.test(String(error))
    },
  )
  await assert.rejects(
    () =>
      grants.prepareExecution(
        agent,
        workspace,
        execution('resolve-reuse', agent, command(receipt.token)),
      ),
    /unknown or has already been used/,
  )
})

test('background and persistent Shell grants are consumed and rejected before spawn', async (t) => {
  const { ctx, credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set('DSH_DB_PASSWORD', 'never-render-this-secret')
  let executions = 0
  ctx.tools.register(
    defineTool({
      name: 'bash',
      description: 'persistent fixture',
      parameters: {
        command: { type: 'string', required: true },
        run_in_background: { type: 'boolean' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => {
        executions++
        return Promise.resolve('must not run')
      },
    }),
  )
  const disposeAgent = grants.installAgent(agent, workspace)
  t.after(disposeAgent)
  const background = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_DB_PASSWORD'])
  const persistent = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_DB_PASSWORD'])

  const backgroundResult = await ctx.tools.execute({
    callId: CallId('background'),
    name: 'bash',
    arguments: { command: command(background.token), run_in_background: true },
    agent,
    signal: new AbortController().signal,
  })
  const persistentResult = await ctx.tools.execute({
    callId: CallId('persistent'),
    name: 'bash',
    arguments: { command: command(persistent.token) },
    agent,
    signal: new AbortController().signal,
  })

  assert.equal(backgroundResult.isError, true)
  assert.equal(persistentResult.isError, true)
  assert.match(JSON.stringify(backgroundResult), /cannot be used by background Shell/)
  assert.match(JSON.stringify(persistentResult), /cannot be used by persistent bash/)
  assert.doesNotMatch(
    JSON.stringify([backgroundResult, persistentResult]),
    /never-render-this-secret/,
  )
  assert.equal(executions, 0)
  assert.deepEqual(credentials.resolved, [])
})

test('Code Mode nested Shell dispatch uses the same grant rule and settles its snapshot', async (t) => {
  const { ctx, credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set('DSH_NESTED_SECRET', 'nested-secret')
  let capturedExecution: ToolExecution | undefined
  ctx.tools.register(
    defineTool({
      name: 'bash',
      description: 'foreground fixture',
      parameters: { command: { type: 'string', required: true } },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (_args, exec) => {
        capturedExecution = exec
        return Promise.resolve(shellEnv(ctx).collect(exec))
      },
    }),
  )
  const disposeAgent = grants.installAgent(agent, workspace)
  t.after(disposeAgent)
  const receipt = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_NESTED_SECRET'])
  const parent = Symbol('run-code') as ToolExecutionToken

  const result = await ctx.tools.execute({
    callId: CallId('nested'),
    rootCallId: CallId('outer'),
    name: 'bash',
    arguments: { command: command(receipt.token) },
    agent,
    parent,
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, false)
  if (!result.isError) assert.deepEqual(result.value, { DSH_NESTED_SECRET: 'nested-secret' })
  assert.ok(capturedExecution)
  assert.deepEqual(shellEnv(ctx).collect(capturedExecution), {})
})

test('disposing an Agent invalidates its outstanding grants', async (t) => {
  const { credentials, grants, agent } = await fixture()
  t.after(() => grants.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set('DSH_DISPOSE_SECRET', 'dispose-secret')
  const receipt = grants.issueGrant(agent, workspace, 'warehouse', ['DSH_DISPOSE_SECRET'])
  const disposeAgent = grants.installAgent(agent, workspace)
  disposeAgent()

  await assert.rejects(
    () =>
      grants.prepareExecution(
        agent,
        workspace,
        execution('after-dispose', agent, command(receipt.token)),
      ),
    /unknown or has already been used/,
  )
  assert.deepEqual(credentials.resolved, [])
})

test('the shared interpreter is a standing non-secret Shell fact', async () => {
  const { ctx, agent } = await fixture()
  const dispose = registerMarivoRuntimeShellEnvironment(ctx, '/runtime/exact-python')
  const call = execution('runtime-fact', agent, 'true')
  assert.deepEqual(shellEnv(ctx).collect(call), {
    DSH_DATA_ANALYSIS_PYTHON: '/runtime/exact-python',
  })
  dispose()
  assert.deepEqual(shellEnv(ctx).collect(call), {})
})
