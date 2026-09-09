import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { MarivoCredentialService } from '../../src/datasource/service.ts'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { finishCleanup } from '../../src/lifecycle.ts'
import { installMarivoPlugin } from '../../src/plugin.ts'
import { createMarivoAgentInstallation } from '../../src/plugin-agents.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { SemanticReferenceBridge } from '../../src/semantic-reference/bridge.ts'
import { registerMarivoTool } from '../../src/tool-lifecycle.ts'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function fixture(count = 1) {
  const rootHooks = new Map<string, (...args: any[]) => void>()
  let fault = '',
    failAgent = 0,
    cleanupFailure = false,
    closes = 0
  const states = Array.from({ length: count + 1 }, (_, index) => {
    const resources = new Map<string, unknown>([['ordinary', {}]])
    const register = (key: string, value: unknown) => {
      if (index === failAgent && key === fault) throw new Error(`injected:${key}`)
      resources.set(key, value)
      return () => {
        resources.delete(key)
        if (cleanupFailure && key === 'prompt:marivo:presentation')
          throw new Error('cleanup-failure')
      }
    }
    let hook = 0
    const agent = {
      session: { id: String(index), snapshotEvents: () => [] },
      ctx: {
        tools: { register: (tool: ToolDefinition) => register(`tool:${tool.name}`, tool) },
        systemPrompt: {
          section: (section: { name: string }) => register(`prompt:${section.name}`, section),
        },
        on: (name: string, callback: unknown) => register(`hook:${name}:${++hook}`, callback),
      },
    } as unknown as Agent
    return { agent, resources }
  })
  const service = {
    close: () => {
      closes++
      return Promise.resolve()
    },
    disposeAgent() {},
    invalidateStorageRef() {},
  } as unknown as MarivoCredentialService
  const ctx = {
    agents: { list: () => states.slice(0, count).map((state) => state.agent) },
    credentials: {},
    on: (name: string, callback: (...args: any[]) => void) => {
      rootHooks.set(name, callback)
      return () => {
        rootHooks.delete(name)
      }
    },
  } as unknown as Context
  return {
    ctx,
    states,
    rootHooks,
    service,
    fault: (key: string, agent = 0) => {
      fault = key
      failAgent = agent
    },
    cleanupFailure: () => {
      cleanupFailure = true
    },
    closes: () => closes,
    options: { credentialService: service },
  }
}
const noRuntime = async (): Promise<never> => {
  throw new Error('installation must not bind Runtime')
}

for (const fault of [
  'tool:marivo_help',
  'tool:marivo_datasource_test',
  'tool:marivo_python',
  'tool:marivo_present',
  'hook:tools/result:1',
  'hook:agent/pre-step:2',
  'hook:agent/pre-step:3',
  'hook:tools/result:4',
  'hook:tools/ptc-dispatch-log:5',
  'prompt:marivo:presentation',
  'prompt:marivo:datasource-credentials',
  'prompt:marivo:analysis-closeout',
]) {
  for (const index of [0, 1])
    test(`existing Agent ${index} rolls back ${fault}`, async () => {
      const f = fixture(2)
      f.fault(fault, index)
      const owner = createMarivoAgentInstallation(f.ctx, noRuntime, f.options)
      assert.throws(() => owner.install(), /injected:/)
      await owner.close()
      for (const state of f.states) assert.deepEqual([...state.resources.keys()], ['ordinary'])
      assert.equal(f.rootHooks.size, 0)
      assert.equal(f.closes(), 0, 'injected shared credential service belongs to its owner')
    })
  test(`new Agent rolls back only itself at ${fault}`, async () => {
    const f = fixture()
    f.fault(fault, 1)
    const close = installMarivoPlugin(f.ctx, noRuntime, f.options)
    const created = f.rootHooks.get('agent/created')!
    assert.throws(() => created({ agent: f.states[1]!.agent }), /injected:/)
    assert.deepEqual([...f.states[1]!.resources.keys()], ['ordinary'])
    assert.ok(f.states[0]!.resources.has('tool:marivo_python'))
    const closing = close()
    assert.equal(close(), closing)
    assert.equal(f.rootHooks.size, 0)
    created({ agent: f.states[1]!.agent })
    await closing
    for (const state of f.states) assert.deepEqual([...state.resources.keys()], ['ordinary'])
  })
}

test('Agent cleanup errors do not skip remaining registrations or completion', async () => {
  const f = fixture(2)
  const close = installMarivoPlugin(f.ctx, noRuntime, f.options)
  f.cleanupFailure()
  await assert.rejects(close(), /cleanup failed/)
  for (const state of f.states) assert.deepEqual([...state.resources.keys()], ['ordinary'])
  assert.equal(f.rootHooks.size, 0)
})

test('tool withdrawal aborts immediately but awaits actual execution cleanup', async () => {
  const entered = deferred(),
    aborted = deferred(),
    release = deferred()
  let captured!: ToolDefinition,
    registrations = 0
  const ctx = {
    tools: {
      register: (tool: ToolDefinition) => {
        captured = tool
        registrations++
        return () => {
          registrations--
        }
      },
    },
  } as unknown as Context
  const close = registerMarivoTool(ctx, {
    name: 'pending',
    description: 'lifecycle barrier fixture',
    parameters: {},
    output: { schema: {}, render: () => [] },
    async execute(_args, exec) {
      exec.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      entered.resolve()
      await release.promise
      exec.signal.throwIfAborted()
      return null
    },
  })
  const call = captured.execute({}, { signal: new AbortController().signal } as any)
  const rejected = assert.rejects(call)
  await entered.promise
  let finished = false
  const closing = close()
  assert.equal(close(), closing)
  void closing.then(() => {
    finished = true
  })
  await aborted.promise
  assert.equal(registrations, 0)
  await assert.rejects(
    captured.execute({}, { signal: new AbortController().signal } as any),
    /disposed/,
  )
  await tick()
  assert.equal(finished, false)
  release.resolve()
  await rejected
  await closing
})

test('Catalog close awaits the subprocess even after its last waiter was cancelled', async () => {
  const release = deferred(),
    entered = deferred()
  let signal!: AbortSignal
  const bridge = new SemanticReferenceBridge()
  const runner = {
    status: 'ready',
    binding: { fingerprint: 'fixture', projectRoot: '/fixture' },
    async runChecked(input: { signal: AbortSignal }) {
      signal = input.signal
      entered.resolve()
      await release.promise
      signal.throwIfAborted()
      throw new Error('unreachable')
    },
  } as unknown as MarivoCheckedRunner
  const caller = new AbortController()
  const request = bridge.candidates(runner, caller.signal)
  const rejected = assert.rejects(request, /cancelled/)
  await entered.promise
  caller.abort()
  await rejected
  assert.equal(signal.aborted, true)
  let finished = false
  const closing = bridge.close()
  assert.equal(bridge.close(), closing)
  void closing.then(() => {
    finished = true
  })
  await tick()
  assert.equal(finished, false)
  release.resolve()
  await closing
})

test('presentation service waits for admitted identity resolution and rejects new work', async () => {
  const entered = deferred(),
    release = deferred()
  let resolves = 0
  const service = new MarivoPresentationFileService(async () => {
    resolves++
    entered.resolve()
    await release.promise
    return undefined
  })
  const request = service.catalog('reports/list', { sessionId: 'fixture' })
  const rejected = assert.rejects(request)
  await entered.promise
  let finished = false
  const closing = service.close()
  assert.equal(service.close(), closing)
  void closing.then(() => {
    finished = true
  })
  await assert.rejects(service.catalog('reports/list', { sessionId: 'fixture' }))
  await tick()
  assert.equal(finished, false)
  assert.equal(resolves, 1)
  release.resolve()
  await rejected
  await closing
})

test('cleanup invokes every stop before waiting and preserves rejection after all settle', async () => {
  const release = deferred()
  const stopped: number[] = []
  const closing = finishCleanup([
    () => {
      stopped.push(1)
      throw new Error('cleanup-failure')
    },
    () => {
      stopped.push(2)
      return release.promise
    },
    () => {
      stopped.push(3)
    },
  ])
  assert.deepEqual(stopped, [1, 2, 3])
  let done = false
  const rejected = assert.rejects(closing, /cleanup failed/).then(() => {
    done = true
  })
  await tick()
  assert.equal(done, false)
  release.resolve()
  await rejected
})

test('credential RPC withdrawal leaves its borrowed service open for other owners', async () => {
  const { registerCredentialRpc } = await import('../../src/datasource/rpc.ts')
  const { createConnectionFixture } = await import('../semantic-reference-input/fixtures.ts')
  const { connection, routes } = createConnectionFixture()
  const f = fixture()
  const close = registerCredentialRpc(connection, f.service, noRuntime)
  assert.ok(routes.size > 0)
  const closing = close()
  assert.equal(close(), closing)
  await closing
  assert.equal(routes.size, 0)
  assert.equal(f.closes(), 0)
  await f.service.close()
  assert.equal(f.closes(), 1)
})
