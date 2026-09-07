import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerMarivoPythonTool } from '../../src/datasource/python.ts'
import { fixture, operation, waiting } from './fixtures.ts'

function pythonTool(f: ReturnType<typeof fixture>) {
  let definition!: ToolDefinition
  const requests: ShellExecRequest[] = []
  const launches: ShellExecSpec[] = []
  const outcome: ShellRunResult = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 120_000,
    stdout: { text: 'complete', truncated: false },
    stderr: { text: '', truncated: false },
  }
  const hooks = { resolve: () => {}, run: async () => outcome }
  const shell = {
    sandboxMode: undefined as string | undefined,
    resolve(request: ShellExecRequest): ShellExecSpec {
      requests.push(request)
      hooks.resolve()
      return {
        ...request,
        workdir: request.workdir!,
        timeoutMs: request.timeoutMs!,
        stdoutMaxBytes: 65536,
        sandboxPolicy: request.sandboxPolicy,
      }
    },
    async run(spec: ShellExecSpec) {
      launches.push(spec)
      return hooks.run()
    },
  }
  const services = new Map<string, unknown>([
    ['shell', shell],
    ['shellEnv', { collect: () => ({ DSH_SESSION_ID: 'session' }) }],
  ])
  const ctx = {
    tools: {
      register(value: ToolDefinition) {
        definition = value
        return () => {}
      },
    },
    get: (name: string) => services.get(name),
  } as unknown as Context
  registerMarivoPythonTool(ctx, f.bridge, f.service)
  return {
    requests,
    launches,
    outcome,
    hooks,
    shell,
    services,
    call: (datasources = ['warehouse'], code = 'print("complete")') =>
      definition.execute(
        { code, datasources },
        {
          ...f.exec,
          deferContext: () => {},
          concludeTurn: () => {},
        },
      ),
  }
}

test('Python admits configured credentials once, uses stdin, and clears its fresh snapshot', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f)
  f.store.put('DB_PASSWORD')
  let values: Record<string, string> | undefined
  const prepare = f.service.prepareExecution.bind(f.service)
  f.service.prepareExecution = async (...args) => {
    const result = await prepare(...args)
    if ('status' in result && result.status === 'ready') values = result.values
    return result
  }
  assert.deepEqual(await p.call(), {
    exitCode: 0,
    timedOut: false,
    aborted: false,
    stdout: 'complete',
    stderr: '',
    truncated: false,
    sandbox: null,
  })
  assert.equal(p.launches.length, 1)
  assert.equal(f.tests, 0)
  assert.equal(f.store.calls.resolve, 1)
  const request = p.requests[0]!
  const payload = JSON.parse(request.stdin!)
  assert.deepEqual(Object.keys(payload.grants), ['warehouse'])
  assert.deepEqual(payload.values, { DB_PASSWORD: 'canary-private-4826' })
  assert.deepEqual(request.env, { MARIVO_PERSIST_CREDENTIALS: '0' })
  assert.deepEqual(request.dshEnv, { DSH_SESSION_ID: 'session' })
  assert.equal(request.workdir, f.bridge.binding.projectRoot)
  assert.doesNotMatch(request.command, /canary-private|print\("complete"\)/)
  assert(values)
  assert.deepEqual(Object.keys(values), [])
})

test('Python without datasources installs an empty resolver and never reads a credential', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f)
  await p.call([])
  const payload = JSON.parse(p.requests[0]!.stdin!)
  assert.deepEqual(payload.grants, {})
  assert.deepEqual(payload.values, {})
  assert.equal(f.store.calls.resolve, 0)
  assert.equal(p.launches.length, 1)
})

test('one missing datasource holds the original Python call at zero launches until all are ready', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const p = pythonTool(f)
  f.store.put('DB_PASSWORD')
  const describe = f.bridge.describe.bind(f.bridge)
  f.bridge.describe = async (name, signal) =>
    name === 'secondary'
      ? {
          name,
          refs: ['SECOND_PASSWORD'],
          fields: { password: 'SECOND_PASSWORD' },
          definition: 'e'.repeat(64),
        }
      : describe(name, signal)
  let formTests = 0
  f.bridge.test = async (description) => {
    formTests++
    return { name: description.name, ok: true, latency_ms: 1, failure: null, repair: null }
  }
  p.outcome.exitCode = 9
  const pending = p.call(['warehouse', 'secondary'])
  const request = await waiting(f)
  assert.equal(request.context.name, 'secondary')
  assert.equal(p.launches.length, 0)
  assert.equal(f.store.calls.resolve, 0)
  await operation(f, request.context, 'submit', {
    requestId: request.id,
    changes: { SECOND_PASSWORD: 'second-canary' },
  })
  assert.equal(((await pending) as { exitCode: number }).exitCode, 9)
  assert.equal(p.launches.length, 1)
  assert.equal(formTests, 1)
  const payload = JSON.parse(p.requests[0]!.stdin!)
  assert.deepEqual(Object.keys(payload.grants), ['warehouse', 'secondary'])
  assert.deepEqual(payload.values, {
    DB_PASSWORD: 'canary-private-4826',
    SECOND_PASSWORD: 'second-canary',
  })
})

test('headless and subagent missing credentials return bounded needs without a launch or wait', async (t) => {
  for (const interaction of ['none', 'web'] as const) {
    const f = fixture(interaction)
    t.after(() => f.service.close())
    if (interaction === 'web') Object.assign(f.agent.session.header, { origin: 'subagent' })
    const p = pythonTool(f)
    assert.deepEqual(await p.call(), {
      status: 'needs-credentials',
      name: 'warehouse',
      refs: ['DB_PASSWORD'],
    })
    assert.equal(p.launches.length, 0)
    assert.equal(f.service.watch('session').requests.length, 0)
  }
})

test('cancelling a credential wait prevents Python and refuses a late submission', async (t) => {
  const f = fixture('web')
  t.after(() => f.service.close())
  const p = pythonTool(f)
  const pending = p.call()
  const rejected = assert.rejects(pending, /call-ended/)
  const request = await waiting(f)
  f.controller.abort()
  await rejected
  await assert.rejects(
    operation(f, request.context, 'submit', {
      requestId: request.id,
      changes: { DB_PASSWORD: 'late-canary' },
    }),
    /call-ended/,
  )
  assert.equal(p.launches.length, 0)
  assert.equal(f.store.calls.set, 0)
})

test('cancellation or credential rotation in a Shell hook fails before the sole launch', async (t) => {
  for (const reason of ['cancel', 'rotate']) {
    const f = fixture()
    t.after(() => f.service.close())
    const p = pythonTool(f)
    f.store.put('DB_PASSWORD')
    p.hooks.resolve = () => {
      if (reason === 'cancel') f.controller.abort()
      else f.service.invalidate(['DB_PASSWORD'])
    }
    await assert.rejects(p.call(), /failed or was cancelled/)
    assert.equal(p.launches.length, 0)
  }
})

test('Shell output, thrown errors, and nonzero exits do not leak secrets or replay Python', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f)
  f.store.put('DB_PASSWORD')
  p.outcome.exitCode = 1
  p.outcome.stdout.text = 'canary-private-4826'
  p.outcome.stderr.text = 'Traceback: canary-private-4826'
  const result = await p.call()
  assert.doesNotMatch(JSON.stringify(result), /canary-private/)
  assert.match(JSON.stringify(result), /REDACTED/)
  assert.equal(p.launches.length, 1)
  p.hooks.run = async () => {
    throw new Error('canary-private-4826')
  }
  await assert.rejects(p.call(), (error: Error) => {
    assert.doesNotMatch(error.message, /canary-private/)
    assert.match(error.message, /checking effects/)
    return true
  })
  assert.equal(p.launches.length, 2)
})

test('missing Host Shell, environment, or sandbox policy fails before reading credentials', async (t) => {
  for (const missing of ['shell', 'shellEnv', 'sandboxPolicy']) {
    const f = fixture()
    t.after(() => f.service.close())
    const p = pythonTool(f)
    f.store.put('DB_PASSWORD')
    p.services.delete(missing)
    if (missing === 'sandboxPolicy') p.shell.sandboxMode = 'required'
    await assert.rejects(p.call(), /required/)
    assert.equal(p.launches.length, 0)
    assert.equal(f.store.calls.resolve, 0)
  }
})
