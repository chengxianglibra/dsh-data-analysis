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
  MARIVO_CREDENTIAL_LEASE_PREFIX,
  MarivoShellCredentialLeases,
  marivoCredentialStorageRef,
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

async function fixture(options: { ttlMs?: number; maxUses?: number } = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  const credentials = new RotatingCredentials()
  const leases = new MarivoShellCredentialLeases(ctx, credentials, options)
  const agent = {
    ctx,
    session: { header: { id: 'agent-a', cwd: '/workspace/a' } },
  } as unknown as Agent
  return { ctx, credentials, leases, agent }
}

function shellEnv(ctx: Context): TestShellEnv {
  return (ctx as unknown as { shellEnv: TestShellEnv }).shellEnv
}

function command(token: string, body = 'python analysis.py'): string {
  return `${MARIVO_CREDENTIAL_LEASE_PREFIX}${token}\n${body}`
}

function execution(
  id: string,
  agent: Agent,
  commandText: string,
  extra: Record<string, unknown> = {},
  name = 'bash',
): ToolExecution {
  const callId = CallId(id)
  return {
    callId,
    rootCallId: callId,
    name,
    arguments: { command: commandText, ...extra },
    agent,
    signal: new AbortController().signal,
    token: Symbol(id) as ToolExecutionToken,
  }
}

test('ordinary Shell calls never inventory or receive ambient datasource credentials', async (t) => {
  const { ctx, credentials, leases, agent } = await fixture()
  t.after(() => leases.dispose())
  credentials.values.set('DB_PASSWORD', 'ambient-secret')
  const call = execution('ordinary', agent, 'python analysis.py')

  assert.equal(await leases.prepareExecution(agent, datasource('workspace-a'), call), false)
  assert.deepEqual(shellEnv(ctx).collect(call), {})
  assert.deepEqual(credentials.resolved, [])
})

test('credential storage mapping is deterministic, case-sensitive, and rejects reserved names', () => {
  assert.equal(
    marivoCredentialStorageRef('CDN_CH_USER'),
    'DSH_DATA_ANALYSIS_CREDENTIAL_43444E5F43485F55534552',
  )
  assert.equal(
    marivoCredentialStorageRef('DSH_CDN_CH_USER'),
    'DSH_DATA_ANALYSIS_CREDENTIAL_4453485F43444E5F43485F55534552',
  )
  assert.equal(
    marivoCredentialStorageRef('Api_Token'),
    'DSH_DATA_ANALYSIS_CREDENTIAL_4170695F546F6B656E',
  )
  assert.notEqual(marivoCredentialStorageRef('Api_Token'), marivoCredentialStorageRef('API_TOKEN'))
  assert.throws(() => marivoCredentialStorageRef('NOT-POSIX'), /POSIX environment name/)
  assert.throws(() => marivoCredentialStorageRef('MARIVO_PERSIST_CREDENTIALS'), /reserved/)
  assert.throws(() => marivoCredentialStorageRef('dsh_data_analysis_python'), /reserved/)
  for (const ref of ['DSH_HOME', 'DSH_SHELL', 'DSH_SESSION_ID', 'DSH_SESSION_JSONL']) {
    assert.throws(() => marivoCredentialStorageRef(ref), /reserved/)
    assert.throws(() => marivoCredentialStorageRef(ref.toLowerCase()), /reserved/)
  }
})

test('one lease fresh-resolves rotated credentials across foreground executions', async (t) => {
  const { ctx, credentials, leases, agent } = await fixture({ maxUses: 2 })
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const userStorageRef = marivoCredentialStorageRef('CDN_CH_USER')
  const passwordStorageRef = marivoCredentialStorageRef('CDN_CH_PASSWORD')
  credentials.values.set(userStorageRef, 'alice')
  credentials.values.set(passwordStorageRef, 'first-secret')
  credentials.values.set(marivoCredentialStorageRef('OTHER_SECRET'), 'must-stay-hidden')
  const receipt = leases.issueLease(agent, workspace, 'warehouse', [
    'CDN_CH_USER',
    'CDN_CH_PASSWORD',
    'CDN_CH_PASSWORD',
  ])

  const first = execution('lease-first', agent, `${receipt.bash_prelude}\npython analysis.py`)
  assert.equal(await leases.prepareExecution(agent, workspace, first), true)
  assert.deepEqual(shellEnv(ctx).collect(first), {
    [passwordStorageRef]: 'first-secret',
    [userStorageRef]: 'alice',
  })

  credentials.values.set(passwordStorageRef, 'rotated-secret')
  const second = execution('lease-second', agent, `${receipt.bash_prelude}\npython analysis.py`)
  assert.equal(await leases.prepareExecution(agent, workspace, second), true)
  assert.deepEqual(shellEnv(ctx).collect(second), {
    [passwordStorageRef]: 'rotated-secret',
    [userStorageRef]: 'alice',
  })
  assert.deepEqual(credentials.resolved, [
    userStorageRef,
    passwordStorageRef,
    userStorageRef,
    passwordStorageRef,
  ])
  assert.equal(receipt.token.length, 43)
  assert.equal(receipt.max_uses, 2)
  assert.equal(receipt.usage, 'bounded-foreground-shell-lease')
  assert.equal(
    receipt.bash_prelude.split('\n')[0],
    `${MARIVO_CREDENTIAL_LEASE_PREFIX}${receipt.token}`,
  )
  assert.deepEqual(receipt.bash_prelude.split('\n').slice(1), [
    `export CDN_CH_USER="\${${userStorageRef}}"`,
    `unset ${userStorageRef}`,
    `export CDN_CH_PASSWORD="\${${passwordStorageRef}}"`,
    `unset ${passwordStorageRef}`,
    'export MARIVO_PERSIST_CREDENTIALS=0',
  ])
  assert.deepEqual(receipt.pwsh_prelude.split('\n').slice(1), [
    `$env:CDN_CH_USER = $env:${userStorageRef}`,
    `Remove-Item Env:${userStorageRef}`,
    `$env:CDN_CH_PASSWORD = $env:${passwordStorageRef}`,
    `Remove-Item Env:${passwordStorageRef}`,
    "$env:MARIVO_PERSIST_CREDENTIALS = '0'",
  ])
  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('lease-65', agent, command(receipt.token)),
      ),
    /is exhausted/,
  )
})

test('lease usage is decremented atomically under concurrent claims', async (t) => {
  const { credentials, leases, agent } = await fixture({ maxUses: 1 })
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('ATOMIC_SECRET')
  credentials.values.set(storageRef, 'secret')
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['ATOMIC_SECRET'])

  const claims = await Promise.allSettled([
    leases.prepareExecution(agent, workspace, execution('atomic-a', agent, command(receipt.token))),
    leases.prepareExecution(agent, workspace, execution('atomic-b', agent, command(receipt.token))),
  ])

  assert.equal(claims.filter((claim) => claim.status === 'fulfilled').length, 1)
  assert.equal(claims.filter((claim) => claim.status === 'rejected').length, 1)
  const rejected = claims.find((claim) => claim.status === 'rejected') as PromiseRejectedResult
  assert.match(String(rejected.reason), /is exhausted/)
  assert.deepEqual(credentials.resolved, [storageRef])
})

test('the default lease admits exactly 64 foreground executions', async (t) => {
  const { credentials, leases, agent } = await fixture()
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('BOUNDED_SECRET')
  credentials.values.set(storageRef, 'secret')
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['BOUNDED_SECRET'])

  for (let index = 1; index <= 64; index++) {
    assert.equal(
      await leases.prepareExecution(
        agent,
        workspace,
        execution(`bounded-${index}`, agent, command(receipt.token)),
      ),
      true,
    )
  }
  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('bounded-65', agent, command(receipt.token)),
      ),
    /is exhausted/,
  )
  assert.equal(credentials.resolved.length, 64)
})

test('renewal revokes the previous token in the same Agent Workspace datasource scope', async (t) => {
  const { credentials, leases, agent } = await fixture()
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('RENEW_SECRET')
  credentials.values.set(storageRef, 'secret')
  const previous = leases.issueLease(agent, workspace, 'warehouse', ['RENEW_SECRET'])
  const current = leases.issueLease(agent, workspace, 'warehouse', ['RENEW_SECRET'])

  await assert.rejects(
    () =>
      leases.prepareExecution(agent, workspace, execution('old', agent, command(previous.token))),
    /is unknown/,
  )
  assert.equal(
    await leases.prepareExecution(
      agent,
      workspace,
      execution('new', agent, command(current.token)),
    ),
    true,
  )
})

test('an explicit datasource revocation invalidates only its active lease', async (t) => {
  const { credentials, leases, agent } = await fixture()
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('REVOKE_SECRET')
  credentials.values.set(storageRef, 'secret')
  const revoked = leases.issueLease(agent, workspace, 'warehouse', ['REVOKE_SECRET'])
  const retained = leases.issueLease(agent, workspace, 'lake', ['REVOKE_SECRET'])

  leases.revokeLease(agent, workspace, 'warehouse')

  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('revoked', agent, command(revoked.token)),
      ),
    /is unknown/,
  )
  assert.equal(
    await leases.prepareExecution(
      agent,
      workspace,
      execution('retained', agent, command(retained.token)),
    ),
    true,
  )
})

test('wrong Agent and Workspace fail closed without consuming the valid use', async (t) => {
  const { ctx, credentials, leases, agent } = await fixture({ maxUses: 1 })
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const otherAgent = {
    ctx,
    session: { header: { id: 'agent-b', cwd: '/workspace/a' } },
  } as unknown as Agent
  const storageRef = marivoCredentialStorageRef('SCOPE_SECRET')
  credentials.values.set(storageRef, 'scope-secret')
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['SCOPE_SECRET'])

  await assert.rejects(
    () =>
      leases.prepareExecution(
        otherAgent,
        workspace,
        execution('wrong-agent', otherAgent, command(receipt.token)),
      ),
    /belongs to another Agent/,
  )
  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        datasource('workspace-b'),
        execution('wrong-workspace', agent, command(receipt.token)),
      ),
    /belongs to another Workspace binding/,
  )
  const valid = execution('valid-scope', agent, command(receipt.token))
  await leases.prepareExecution(agent, workspace, valid)
  assert.deepEqual(shellEnv(ctx).collect(valid), { [storageRef]: 'scope-secret' })
  assert.deepEqual(credentials.resolved, [storageRef])
})

test('expired and malformed markers fail before credential resolution', async (t) => {
  const { credentials, leases, agent } = await fixture({ ttlMs: 1 })
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set(marivoCredentialStorageRef('EXPIRING_SECRET'), 'expiring-secret')
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['EXPIRING_SECRET'])
  await new Promise((resolve) => setTimeout(resolve, 5))

  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('expired', agent, command(receipt.token)),
      ),
    /has expired/,
  )
  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('malformed-marker', agent, '# dsh-marivo-credential-lease:unsupported\ntrue'),
      ),
    /marker is malformed or unsupported/,
  )
  assert.deepEqual(credentials.resolved, [])
})

test('credential resolution failure consumes one use and redacts provider errors', async (t) => {
  const { credentials, leases, agent } = await fixture({ maxUses: 2 })
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('FAIL_SECRET')
  credentials.values.set(storageRef, 'never-render-this-secret')
  credentials.failures.add(storageRef)
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['FAIL_SECRET'])

  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('resolve-failure', agent, command(receipt.token)),
      ),
    (error: unknown) => {
      assert.doesNotMatch(String(error), /never-render-this-secret/)
      assert.doesNotMatch(JSON.stringify(error), new RegExp(receipt.token))
      return /could not be resolved/.test(String(error))
    },
  )
  credentials.failures.delete(storageRef)
  assert.equal(
    await leases.prepareExecution(
      agent,
      workspace,
      execution('resolve-retry', agent, command(receipt.token)),
    ),
    true,
  )
  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('resolve-exhausted', agent, command(receipt.token)),
      ),
    /is exhausted/,
  )
})

test('background and persistent Shell rejection does not resolve or consume the lease', async (t) => {
  const { ctx, credentials, leases, agent } = await fixture({ maxUses: 1 })
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('DB_PASSWORD')
  credentials.values.set(storageRef, 'never-render-this-secret')
  const background = leases.issueLease(agent, workspace, 'warehouse', ['DB_PASSWORD'])

  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('background', agent, command(background.token), { run_in_background: true }),
      ),
    /cannot be used by background Shell/,
  )
  assert.deepEqual(credentials.resolved, [])
  assert.equal(
    await leases.prepareExecution(
      agent,
      workspace,
      execution('after-background', agent, command(background.token)),
    ),
    true,
  )

  ctx.tools.register(
    defineTool({
      name: 'pwsh',
      description: 'persistent fixture',
      parameters: { command: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: () => Promise.resolve('must not run'),
    }),
  )
  credentials.resolved.length = 0
  const persistent = leases.issueLease(agent, workspace, 'persistent', ['DB_PASSWORD'])
  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('persistent', agent, command(persistent.token), {}, 'pwsh'),
      ),
    /cannot be used by persistent pwsh/,
  )
  assert.deepEqual(credentials.resolved, [])
})

test('Code Mode nested Shell dispatch uses the same lease and settles its snapshot', async (t) => {
  const { ctx, credentials, leases, agent } = await fixture()
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  const storageRef = marivoCredentialStorageRef('NESTED_SECRET')
  credentials.values.set(storageRef, 'nested-secret')
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
  const disposeAgent = leases.installAgent(agent, workspace)
  t.after(disposeAgent)
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['NESTED_SECRET'])
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
  if (!result.isError) assert.deepEqual(result.value, { [storageRef]: 'nested-secret' })
  assert.ok(capturedExecution)
  assert.deepEqual(shellEnv(ctx).collect(capturedExecution), {})
})

test('disposing an Agent invalidates its outstanding leases', async (t) => {
  const { credentials, leases, agent } = await fixture()
  t.after(() => leases.dispose())
  const workspace = datasource('workspace-a')
  credentials.values.set(marivoCredentialStorageRef('DISPOSE_SECRET'), 'dispose-secret')
  const receipt = leases.issueLease(agent, workspace, 'warehouse', ['DISPOSE_SECRET'])
  const disposeAgent = leases.installAgent(agent, workspace)
  disposeAgent()

  await assert.rejects(
    () =>
      leases.prepareExecution(
        agent,
        workspace,
        execution('after-dispose', agent, command(receipt.token)),
      ),
    /is unknown/,
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
