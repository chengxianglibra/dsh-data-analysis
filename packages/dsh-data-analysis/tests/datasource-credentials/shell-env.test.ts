import assert from 'node:assert/strict'
import process from 'node:process'
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
import { MarivoShellCredentialBridge } from '../../src/datasource/shell-env.ts'
import {
  MARIVO_PERSIST_CREDENTIALS_ENV,
  type MarivoEnvironment,
} from '../../src/environment/index.ts'
import { TestShellEnv } from '../test-shell-env.ts'

class RotatingCredentials {
  readonly values = new Map<string, string>()
  readonly resolved: string[] = []

  async resolve(ref: CredentialRef) {
    this.resolved.push(ref)
    const value = this.values.get(ref)
    return value === undefined ? undefined : { value, source: 'memory' }
  }
}

function execution(id: string): ToolExecution {
  const callId = CallId(id)
  return {
    callId,
    rootCallId: callId,
    name: 'bash',
    arguments: { command: 'python analysis.py' },
    signal: new AbortController().signal,
    token: Symbol(id) as ToolExecutionToken,
  }
}

function environment(
  datasources: Array<{ name: string; refs: string[] }>,
  calls: { count: number },
): MarivoEnvironment {
  return {
    async runCheckedDatasourceInventory() {
      calls.count += 1
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ datasources })),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
}

async function fixture() {
  const ctx = new Context()
  await ctx.plugin(TestShellEnv)
  const credentials = new RotatingCredentials()
  const bridge = new MarivoShellCredentialBridge(ctx, credentials)
  return { ctx, credentials, bridge }
}

function shellEnv(ctx: Context): TestShellEnv {
  return (ctx as unknown as { shellEnv: TestShellEnv }).shellEnv
}

async function executeTool(ctx: Context, agent: Agent, name: string) {
  return ctx.tools.execute({
    callId: CallId(`tool-${name}`),
    name,
    arguments: {},
    agent,
    signal: new AbortController().signal,
  })
}

test('the first Shell call inventories once while every call resolves a fresh credential snapshot', async (t) => {
  const previous = process.env[MARIVO_PERSIST_CREDENTIALS_ENV]
  t.after(() => {
    if (previous === undefined) delete process.env[MARIVO_PERSIST_CREDENTIALS_ENV]
    else process.env[MARIVO_PERSIST_CREDENTIALS_ENV] = previous
  })
  const { ctx, credentials, bridge } = await fixture()
  t.after(() => bridge.dispose())
  const inventory = { count: 0 }
  const workspace = environment(
    [
      { name: 'warehouse', refs: ['DSH_DB_USER', 'DSH_DB_PASSWORD', 'DSH_DB_PASSWORD'] },
      { name: 'replica', refs: ['DSH_DB_USER'] },
    ],
    inventory,
  )
  credentials.values.set('DSH_DB_USER', 'alice')
  credentials.values.set('DSH_DB_PASSWORD', 'first-secret')

  const first = execution('shell-first')
  await bridge.prepareExecution(workspace, first)
  assert.deepEqual(shellEnv(ctx).collect(first), {
    DSH_DB_PASSWORD: 'first-secret',
    DSH_DB_USER: 'alice',
  })

  credentials.values.set('DSH_DB_PASSWORD', 'second-secret')
  const second = execution('shell-second')
  await bridge.prepareExecution(workspace, second)
  assert.deepEqual(shellEnv(ctx).collect(second), {
    DSH_DB_PASSWORD: 'second-secret',
    DSH_DB_USER: 'alice',
  })
  assert.equal(inventory.count, 1)
  assert.deepEqual(credentials.resolved, [
    'DSH_DB_USER',
    'DSH_DB_PASSWORD',
    'DSH_DB_USER',
    'DSH_DB_PASSWORD',
  ])
  assert.equal(process.env[MARIVO_PERSIST_CREDENTIALS_ENV], '0')
})

test('missing credentials and non-DSH inventory references are omitted without blocking Shell', async (t) => {
  const { ctx, credentials, bridge } = await fixture()
  t.after(() => bridge.dispose())
  const inventory = { count: 0 }
  const workspace = environment(
    [{ name: 'warehouse', refs: ['DSH_DB_USER', 'DB_PASSWORD'] }],
    inventory,
  )
  credentials.values.set('DSH_DB_USER', 'alice')

  const call = execution('shell-partial')
  await bridge.prepareExecution(workspace, call)

  assert.deepEqual(shellEnv(ctx).collect(call), { DSH_DB_USER: 'alice' })
  assert.deepEqual(credentials.resolved, ['DSH_DB_USER'])
  assert.equal(inventory.count, 1)
})

test('workspace and concurrent execution snapshots stay isolated', async (t) => {
  const { ctx, credentials, bridge } = await fixture()
  t.after(() => bridge.dispose())
  const leftInventory = { count: 0 }
  const rightInventory = { count: 0 }
  const leftWorkspace = environment([{ name: 'left', refs: ['DSH_LEFT_TOKEN'] }], leftInventory)
  const rightWorkspace = environment([{ name: 'right', refs: ['DSH_RIGHT_TOKEN'] }], rightInventory)
  credentials.values.set('DSH_LEFT_TOKEN', 'left-secret')
  credentials.values.set('DSH_RIGHT_TOKEN', 'right-secret')
  const left = execution('shell-left')
  const right = execution('shell-right')

  await Promise.all([
    bridge.prepareExecution(leftWorkspace, left),
    bridge.prepareExecution(rightWorkspace, right),
  ])

  assert.deepEqual(shellEnv(ctx).collect(left), { DSH_LEFT_TOKEN: 'left-secret' })
  assert.deepEqual(shellEnv(ctx).collect(right), { DSH_RIGHT_TOKEN: 'right-secret' })
  assert.equal(leftInventory.count, 1)
  assert.equal(rightInventory.count, 1)
})

test('marivo_test describe updates replace the cached datasource references', async (t) => {
  const { ctx, credentials, bridge } = await fixture()
  t.after(() => bridge.dispose())
  const inventory = { count: 0 }
  const workspace = environment([{ name: 'warehouse', refs: ['DSH_OLD_TOKEN'] }], inventory)
  credentials.values.set('DSH_OLD_TOKEN', 'old-secret')
  credentials.values.set('DSH_NEW_TOKEN', 'new-secret')

  const initial = execution('shell-before-update')
  await bridge.prepareExecution(workspace, initial)
  bridge.recordDatasource(workspace, 'warehouse', ['DSH_NEW_TOKEN'])
  const updated = execution('shell-after-update')
  await bridge.prepareExecution(workspace, updated)

  assert.deepEqual(shellEnv(ctx).collect(initial), { DSH_OLD_TOKEN: 'old-secret' })
  assert.deepEqual(shellEnv(ctx).collect(updated), { DSH_NEW_TOKEN: 'new-secret' })
  assert.equal(inventory.count, 1)
})

test('inventory failure is attempted once and leaves a repair Shell environment empty', async (t) => {
  const { ctx, credentials, bridge } = await fixture()
  t.after(() => bridge.dispose())
  let calls = 0
  const workspace = {
    async runCheckedDatasourceInventory() {
      calls += 1
      throw new Error('broken datasource file')
    },
  } as unknown as MarivoEnvironment
  const first = execution('shell-inventory-failure')

  await assert.rejects(() => bridge.prepareExecution(workspace, first), /broken datasource file/)
  const second = execution('shell-repair')
  await bridge.prepareExecution(workspace, second)

  assert.deepEqual(shellEnv(ctx).collect(second), {})
  assert.deepEqual(credentials.resolved, [])
  assert.equal(calls, 1)
})

test('the pre-execute bridge covers bash and pwsh, skips other tools, and fails open', async (t) => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  const credentials = new RotatingCredentials()
  const bridge = new MarivoShellCredentialBridge(ctx, credentials)
  t.after(() => bridge.dispose())
  for (const name of ['bash', 'pwsh', 'ordinary']) {
    ctx.tools.register(
      defineTool({
        name,
        description: `${name} fixture`,
        parameters: {},
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute: (_args, exec) => Promise.resolve(shellEnv(ctx).collect(exec)),
      }),
    )
  }
  let inventoryCalls = 0
  const brokenWorkspace = {
    async runCheckedDatasourceInventory() {
      inventoryCalls += 1
      throw new Error('invalid datasource config')
    },
  } as unknown as MarivoEnvironment
  const agent = {
    ctx,
    session: { header: { id: 'shell-agent' } },
  } as unknown as Agent
  const disposeAgent = bridge.installAgent(agent, brokenWorkspace)
  t.after(disposeAgent)

  const ordinary = await executeTool(ctx, agent, 'ordinary')
  assert.equal(ordinary.isError, false)
  assert.equal(inventoryCalls, 0)
  const bash = await executeTool(ctx, agent, 'bash')
  const pwsh = await executeTool(ctx, agent, 'pwsh')

  assert.equal(bash.isError, false)
  assert.equal(pwsh.isError, false)
  assert.equal(inventoryCalls, 1)
  if (!bash.isError) assert.deepEqual(bash.value, {})
  if (!pwsh.isError) assert.deepEqual(pwsh.value, {})
})

test('persistent bash and pwsh fail explicitly instead of running without resolved credentials', async (t) => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  const credentials = new RotatingCredentials()
  credentials.values.set('DSH_DB_PASSWORD', 'never-render-this-secret')
  const bridge = new MarivoShellCredentialBridge(ctx, credentials)
  t.after(() => bridge.dispose())
  let executions = 0
  for (const name of ['bash', 'pwsh']) {
    ctx.tools.register(
      defineTool({
        name,
        description: `Run commands in a persistent ${name} shell.`,
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: () => {
          executions += 1
          return Promise.resolve('must not run')
        },
      }),
    )
  }
  const workspace = environment([{ name: 'warehouse', refs: ['DSH_DB_PASSWORD'] }], { count: 0 })
  const agent = {
    ctx,
    session: { header: { id: 'persistent-shell-agent' } },
  } as unknown as Agent
  const disposeAgent = bridge.installAgent(agent, workspace)
  t.after(disposeAgent)

  const bash = await executeTool(ctx, agent, 'bash')
  const pwsh = await executeTool(ctx, agent, 'pwsh')

  assert.equal(bash.isError, true)
  assert.equal(pwsh.isError, true)
  assert.match(
    JSON.stringify(bash),
    /persistent bash tool cannot receive per-execution DSH datasource credentials/,
  )
  assert.match(
    JSON.stringify(pwsh),
    /persistent pwsh tool cannot receive per-execution DSH datasource credentials/,
  )
  assert.doesNotMatch(JSON.stringify([bash, pwsh]), /never-render-this-secret/)
  assert.equal(executions, 0)
})

test('dispose during first inventory cannot register a late Shell contributor', async () => {
  const { ctx, bridge } = await fixture()
  let releaseInventory: (() => void) | undefined
  const inventory = new Promise<void>((resolve) => {
    releaseInventory = resolve
  })
  const workspace = {
    async runCheckedDatasourceInventory() {
      await inventory
      return {
        exitCode: 0,
        stdout: Buffer.from(
          JSON.stringify({
            datasources: [{ name: 'warehouse', refs: ['DSH_DB_PASSWORD'] }],
          }),
        ),
        stderr: Buffer.alloc(0),
      }
    },
  } as unknown as MarivoEnvironment
  const pending = bridge.prepareExecution(workspace, execution('dispose-race'))
  await new Promise((resolve) => setImmediate(resolve))

  bridge.dispose()
  releaseInventory?.()
  await pending

  assert.deepEqual(shellEnv(ctx).list(), [])
})
