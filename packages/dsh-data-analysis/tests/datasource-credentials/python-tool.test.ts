import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  MarivoPythonExecutionError,
  type MarivoPythonExecutionSummary,
  registerMarivoPythonTool,
} from '../../src/datasource/python.ts'
import type { MarivoPythonOptionsSource } from '../../src/datasource/python-options.ts'
import { fixture, operation, waiting } from './fixtures.ts'

function pythonTool(f: ReturnType<typeof fixture>, options: MarivoPythonOptionsSource = {}) {
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
  const hooks = { resolve: () => {}, run: async () => outcome, maxTimeoutMs: Infinity }
  const shell = {
    sandboxMode: undefined as string | undefined,
    resolve(request: ShellExecRequest): ShellExecSpec {
      requests.push(request)
      hooks.resolve()
      return {
        ...request,
        workdir: request.workdir!,
        timeoutMs: Math.min(request.timeoutMs!, hooks.maxTimeoutMs),
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
  registerMarivoPythonTool(ctx, f.bridge, f.service, options)
  return {
    requests,
    launches,
    outcome,
    hooks,
    shell,
    services,
    call: (datasources = ['warehouse'], code = 'print("complete")', timeoutMs?: number) =>
      definition.execute(
        { code, datasources, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
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
  const projectRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'python-tool-')))
  const hostRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'python-tool-host-')))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = hostRoot
  Object.assign(f.bridge.binding, { projectRoot })
  t.after(async () => {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    await rm(hostRoot, { recursive: true, force: true })
  })
  t.after(() => rm(f.bridge.binding.projectRoot, { recursive: true, force: true }))
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
  const { codeRef, execution, ...result } = (await p.call()) as Record<string, unknown>
  assert(codeRef)
  assertSummary(execution, 'capturing-code', 'succeeded')
  assert.equal(execution.requestedTimeoutMs, 120_000)
  assert.equal(execution.effectiveTimeoutMs, 120_000)
  assert.equal(execution.nextAction, null)
  assert.deepEqual(result, {
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
    const { execution, ...result } = (await p.call()) as Record<string, unknown>
    assertSummary(execution, 'preparing', 'not-started')
    assert.equal(execution.executionElapsedMs, null)
    assert.equal(execution.effectiveTimeoutMs, null)
    assert.deepEqual(result, {
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
  const rejected = assert.rejects(pending, (error: unknown) => {
    assert(error instanceof MarivoPythonExecutionError)
    assert.match(error.message, /call-ended/)
    assertSummary(error.execution, 'preparing', 'cancelled')
    assert.equal(error.execution.effectiveTimeoutMs, null)
    return true
  })
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
    await assert.rejects(p.call(), (error: unknown) => {
      assert(error instanceof MarivoPythonExecutionError)
      assertSummary(error.execution, 'preparing', reason === 'cancel' ? 'cancelled' : 'not-started')
      assert.equal(error.execution.effectiveTimeoutMs, 120_000)
      assert.match(error.message, /Python was not started/)
      return true
    })
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
    assert.match(error.message, /Inspect existing effects/)
    assert(error instanceof MarivoPythonExecutionError)
    assertSummary(error.execution, 'executing', 'unknown')
    return true
  })
  assert.equal(p.launches.length, 2)
})

function assertSummary(
  value: unknown,
  phase: MarivoPythonExecutionSummary['phase'],
  reason: MarivoPythonExecutionSummary['reason'],
): asserts value is MarivoPythonExecutionSummary {
  assert(value && typeof value === 'object')
  const execution = value as MarivoPythonExecutionSummary
  assert.equal(execution.phase, phase)
  assert.equal(execution.reason, reason)
  assert(Number.isFinite(execution.elapsedMs) && execution.elapsedMs >= 0)
  if (phase === 'preparing') assert.equal(execution.executionElapsedMs, null)
  else {
    assert(execution.executionElapsedMs !== null)
    assert(execution.executionElapsedMs >= 0 && execution.executionElapsedMs <= execution.elapsedMs)
  }
}

test('Python timeout defaults, per-call override and only the Harness cap preserve the requested budget', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f, { pythonTimeoutMs: 240_000 })
  p.outcome.exitCode = 7
  p.hooks.maxTimeoutMs = 420_000
  for (const [requested, resolved] of [
    [undefined, 240_000],
    [300_000, 300_000],
    [900_000, 420_000],
  ]) {
    const result = (await p.call([], 'pass', requested)) as {
      execution: MarivoPythonExecutionSummary
    }
    assertSummary(result.execution, 'executing', 'nonzero-exit')
    assert.equal(result.execution.requestedTimeoutMs, requested ?? 240_000)
    assert.equal(result.execution.effectiveTimeoutMs, resolved)
    assert.equal(p.requests.at(-1)!.timeoutMs, requested ?? 240_000)
  }
  assert.equal(p.launches.length, 3)
})

test('invalid Python timeout never resolves credentials or starts Shell', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  f.store.put('DB_PASSWORD')
  const p = pythonTool(f)
  for (const value of [0, -1, 0.5, 2147483648]) {
    await assert.rejects(p.call(['warehouse'], 'pass', value), (error: unknown) => {
      assert(error instanceof MarivoPythonExecutionError)
      assertSummary(error.execution, 'preparing', 'not-started')
      assert.equal(error.execution.requestedTimeoutMs, null)
      assert.doesNotMatch(error.message, /private-timeout/)
      return true
    })
  }
  // The Harness schema rejects non-JSON numbers and wrong types before the body runs.
  for (const value of [NaN, Infinity, null, 'invalid'])
    await assert.rejects(p.call(['warehouse'], 'pass', value as number))
  assert.equal(f.store.calls.resolve, 0)
  assert.equal(p.requests.length, 0)
})

test('saved defaults reach an existing tool while an admitted call retains its budget', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  let pythonTimeoutMs = 120_000
  const p = pythonTool(f, () => ({ pythonTimeoutMs }))
  p.outcome.exitCode = 7
  let finish!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  p.hooks.run = async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
      started()
    })
    return p.outcome
  }
  const pending = p.call([], 'pass')
  await entered
  pythonTimeoutMs = 900_000
  finish()
  const first = (await pending) as { execution: MarivoPythonExecutionSummary }
  assert.equal(first.execution.requestedTimeoutMs, 120_000)
  assert.equal(first.execution.effectiveTimeoutMs, 120_000)
  p.hooks.run = async () => p.outcome
  await p.call([], 'pass')
  assert.equal(p.requests.at(-1)!.timeoutMs, 900_000)
  await p.call([], 'pass', 1_200_000)
  assert.equal(p.requests.at(-1)!.timeoutMs, 1_200_000)
})

test('Shell outcomes are classified from flags, not stderr or an assumed exit code', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f)
  for (const [outcome, reason] of [
    [{ exitCode: 3, timedOut: false, aborted: false }, 'nonzero-exit'],
    [{ exitCode: 0, timedOut: true, aborted: false }, 'timed-out'],
    [{ exitCode: 0, timedOut: false, aborted: true }, 'cancelled'],
    [{ exitCode: null, timedOut: false, aborted: false }, 'unknown'],
  ] as const) {
    Object.assign(p.outcome, outcome)
    p.outcome.stderr.text = 'timeout cancelled success'
    const result = (await p.call([])) as {
      execution: MarivoPythonExecutionSummary
      codeRef?: unknown
    }
    assertSummary(result.execution, 'executing', reason)
    assert.match(result.execution.nextAction!, /do not automatically replay/)
    assert.equal(result.codeRef, undefined)
  }
  assert.equal(p.launches.length, 4)
})

test('preparation exceptions carry safe facts without starting Python', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f)
  f.bridge.describe = async () => {
    throw new Error('private-provider-failure')
  }
  await assert.rejects(p.call(), (error: unknown) => {
    assert(error instanceof MarivoPythonExecutionError)
    assertSummary(error.execution, 'preparing', 'not-started')
    assert.doesNotMatch(error.message, /private-provider-failure/)
    assert.equal(error.execution.effectiveTimeoutMs, null)
    return true
  })
  assert.equal(p.launches.length, 0)
})

test('credential admission failure retains datasource failure and reports not-started', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const p = pythonTool(f)
  f.service.prepareExecution = async () => ({
    name: 'warehouse',
    ok: false,
    latency_ms: 1,
    failure: {
      code: 'connection-failed',
      exception_type: 'ConnectionError',
      backend_code: null,
      backend_name: null,
      message: 'connection refused',
    },
    repair: null,
  })
  const result = (await p.call()) as { status: string; execution: MarivoPythonExecutionSummary }
  assert.equal(result.status, 'failed')
  assertSummary(result.execution, 'preparing', 'not-started')
  assert.equal(p.launches.length, 0)
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
