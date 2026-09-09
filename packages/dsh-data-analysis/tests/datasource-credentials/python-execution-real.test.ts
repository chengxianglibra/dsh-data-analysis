/** Opt-in acceptance: real Harness + bound Python, isolated files, no model or database calls. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MarivoDatasourceBridge } from '../../src/datasource/bridge.ts'
import {
  type MarivoPythonExecutionSummary,
  registerMarivoPythonTool,
} from '../../src/datasource/python.ts'
import { MarivoCredentialService } from '../../src/datasource/service.ts'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import { type PythonCodeRef, readPythonExecution } from '../../src/python-execution.ts'
import { TestShellEnv } from '../test-shell-env.ts'
import { Store } from './fixtures.ts'

const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
const skip = pythonExecutable
  ? false
  : 'Set DSH_DATA_ANALYSIS_PYTHON to the exact supported Runtime'

async function harness(t: TestContext, maxWallMs?: number) {
  assert(pythonExecutable)
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'python-budget-real-')))
  const home = path.join(root, 'host')
  await mkdir(home)
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const ctx = new Context()
  const service = new MarivoCredentialService(new Store(), 'none')
  t.after(async () => {
    await service.close()
    await ctx.fiber.dispose()
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(path.join(root, 'marivo.toml'), '[project]\nname = "python-budget-validation"\n')
  const environment = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable })
  const bridge = new MarivoDatasourceBridge(environment)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  if (maxWallMs !== undefined) await ctx.plugin(WorkerThreadCodeRuntime, { maxWallMs })
  await ctx.plugin(ToolRuntime, { mode: maxWallMs === undefined ? 'native' : 'code' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(BashLocal, { maxTimeoutMs: 180_000, maxOutputBytes: 65536 })
  const agent = ctx.agentLoop.create(
    SessionId('python-budget-real'),
    { provider: 'unused', model: 'unused' },
    { cwd: root },
  )
  registerMarivoPythonTool(agent.ctx, bridge, service)
  const shell = agent.ctx.get('shell')!
  const run = shell.run.bind(shell)
  const outcomes: ShellRunResult[] = []
  let starts = 0
  shell.run = async (spec) => {
    starts++
    const result = await run(spec)
    outcomes.push(result)
    return result
  }
  const call = (code: string, timeoutMs: number, signal = new AbortController().signal) =>
    agent.ctx.tools.execute({
      agent,
      signal,
      callId: CallId('python-budget-call'),
      name: 'marivo_python',
      arguments: { code, datasources: [], timeoutMs },
    })
  return {
    root,
    home,
    ctx,
    agent,
    call,
    outcomes,
    get starts() {
      return starts
    },
  }
}

type ExecutionValue = {
  execution: MarivoPythonExecutionSummary
  codeRef?: PythonCodeRef
  stdout: string
  timedOut: boolean
}

const sleepingTree = String.raw`
import json, os, subprocess, sys, time
from pathlib import Path
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
Path("pids.json").write_text(json.dumps([os.getpid(), child.pid]))
time.sleep(300)
`

async function waitForPids(root: string): Promise<number[]> {
  const end = performance.now() + 10_000
  while (performance.now() < end) {
    try {
      return JSON.parse(await readFile(path.join(root, 'pids.json'), 'utf8')) as number[]
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      await delay(25)
    }
  }
  assert.fail('Python did not start within 10 seconds')
}

async function assertStopped(root: string) {
  const pids = await waitForPids(root)
  for (const pid of pids) {
    let stopped = false
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        process.kill(pid, 0)
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH')
        stopped = true
        break
      }
      await delay(25)
    }
    assert(stopped, `Python process ${pid} survived cancellation`)
  }
}

test('real native Tool reports Shell timeout and stops the Python process tree', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const result = await h.call(sleepingTree, 3_000)
  assert.equal(result.isError, false)
  const value = result.value as unknown as ExecutionValue
  assert.equal(value.execution.reason, 'timed-out')
  assert.equal(value.execution.phase, 'executing')
  assert.equal(value.execution.effectiveTimeoutMs, 3_000)
  assert(value.execution.executionElapsedMs! >= 3_000)
  assert.equal(value.codeRef, undefined)
  assert.equal(h.starts, 1)
  await assertStopped(h.root)
})

test('real native caller cancellation remains a Harness error and stops Python', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const controller = new AbortController()
  const pending = h.call(sleepingTree, 30_000, controller.signal)
  await waitForPids(h.root)
  controller.abort()
  const result = await pending
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /aborted/)
  assert.equal(h.outcomes[0]!.aborted, true)
  assert.equal(h.outcomes[0]!.timedOut, false)
  assert.equal(h.starts, 1)
  await assertStopped(h.root)
})

test('real Code Mode deadline dominates the longer Python budget', { skip }, async (t) => {
  const h = await harness(t, 3_000)
  const result = await h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: CallId('code-budget'),
    name: 'run_code',
    arguments: {
      description: 'Validate outer cancellation',
      code: `await tools.marivo_python(${JSON.stringify({ code: sleepingTree, datasources: [], timeoutMs: 30_000 })});`,
    },
  })
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /wall.clock|wall-clock|WALL/)
  assert.equal(h.starts, 1)
  assert.equal(h.outcomes[0]!.aborted, true)
  assert.equal(h.outcomes[0]!.timedOut, false)
  await assertStopped(h.root)
})

test('real Python runs beyond 120 seconds and captures code exactly once', {
  skip:
    skip ||
    (process.env.DSH_DATA_ANALYSIS_VALIDATE_LONG_PYTHON !== '1' &&
      'Opt in to the 121-second acceptance run'),
}, async (t) => {
  const h = await harness(t)
  const code = 'import time\ntime.sleep(121)\nprint("long-execution-complete")'
  const result = await h.call(code, 240_000)
  assert(!result.isError, JSON.stringify(result))
  const value = result.value as unknown as ExecutionValue
  assert.equal(value.execution.reason, 'succeeded')
  assert.equal(value.execution.phase, 'capturing-code')
  assert.equal(value.execution.requestedTimeoutMs, 240_000)
  assert.equal(value.execution.effectiveTimeoutMs, 180_000)
  assert(value.execution.executionElapsedMs! > 120_000)
  assert.equal(value.execution.nextAction, null)
  assert.match(value.stdout, /long-execution-complete/)
  assert(value.codeRef)
  assert.equal((await readPythonExecution(h.root, value.codeRef)).text, code)
  assert.equal(h.starts, 1)
  t.diagnostic(JSON.stringify(value.execution))
})
