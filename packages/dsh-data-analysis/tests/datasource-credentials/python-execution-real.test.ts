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
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { z } from 'zod'
import { MarivoDatasourceBridge } from '../../src/datasource/bridge.ts'
import {
  type MarivoPythonExecutionSummary,
  registerMarivoPythonTool,
} from '../../src/datasource/python.ts'
import { MarivoCredentialService } from '../../src/datasource/service.ts'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'
import { parseAnalysisDocument } from '../../src/presentation/contracts/analysis-document.ts'
import { resultReference } from '../../src/presentation/contracts/result-reference.ts'
import { readAnalysisRecord } from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
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
  if (maxWallMs !== undefined) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(LocalSandbox, {})
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root })
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(WorkingDirectory, { defaultDirectory: root })
    await ctx.plugin(SubprocessLocal)
    await ctx.plugin(NodePtcRuntime, { timeoutMs: maxWallMs })
  }
  await ctx.plugin(ToolRuntime, { mode: maxWallMs === undefined ? 'native' : 'ptc' })
  await ctx.plugin(AgentRegistry)
  if (maxWallMs === undefined) await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (maxWallMs === undefined) await ctx.plugin(SubprocessLocal)
  await ctx.plugin(BashLocal, { maxTimeoutMs: 180_000, maxOutputBytes: 65536 })
  const agent = await ctx.agentLoop.create(
    SessionId('python-budget-real'),
    { provider: 'unused', model: 'unused' },
    { cwd: root },
  )
  registerMarivoPythonTool(agent.ctx, bridge, service)
  const shell = agent.ctx.get('shell')!
  const execute = shell.execute.bind(shell)
  const outcomes: ShellRunResult[] = []
  let starts = 0
  shell.execute = async (spec) => {
    starts++
    const execution = await execute(spec)
    const result = execution.result.bind(execution)
    execution.result = async () => {
      const outcome = await result()
      outcomes.push(outcome)
      return outcome
    }
    return execution
  }
  const call = (code: string, timeoutMs: number, signal = new AbortController().signal) =>
    agent.ctx.tools.execute({
      agent,
      signal,
      callId: ToolCallId('python-budget-call'),
      name: 'marivo_python',
      arguments: { code, datasources: [], timeoutMs },
    })
  return {
    root,
    home,
    ctx,
    agent,
    environment,
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

test('real Harness refreshes Frame and DataFrame report data with traceable scripts and unchanged body', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const workspace = () => ({ id: 'workspace', path: h.root })
  h.agent.ctx.tools.register(
    createMarivoPresentTool(
      workspace,
      h.agent.session,
      undefined,
      undefined,
      async () => h.environment,
    ),
  )
  h.agent.ctx.tools.register(createMarivoUiReadTool(workspace))
  const service = new MarivoPresentationFileService(workspace, (id) =>
    id === 'workspace' ? workspace() : undefined,
  )
  t.after(() => service.close())
  let sequence = 0
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const callId = ToolCallId(`report-refresh-${++sequence}`)
    h.agent.session.append('tool/call', {
      turn: 0,
      step: sequence,
      callId,
      name,
      arguments: JSON.stringify(args),
    })
    const result = await h.agent.ctx.tools.execute({
      agent: h.agent,
      signal: new AbortController().signal,
      callId,
      name,
      arguments: args,
    })
    assert(!result.isError, JSON.stringify(result))
    return result.value as Record<string, unknown>
  }
  const code = String.raw`
import sys
from pathlib import Path
from uuid import uuid4
import pandas as pd
import marivo.analysis as mv
amount = int(Path("amount.txt").read_text())
session = mv.session.get_or_create("refresh-" + uuid4().hex)
frame = session.values(columns={"amount": "CNY"}, rows=(((), {"amount": amount}),)).persist(description="Refresh amount")
dataframe = mv.persist_dataframe(pd.DataFrame({"amount": [amount]}))
frame_ref = frame.ref.to_dict()
data_ref = dataframe.to_dict()
print("Arbitrary report log; reference discovery must not parse this text")
print("__DSH_MARIVO_RESULTS_V1__:user text", file=sys.stderr)
`
  await writeFile(path.join(h.root, 'amount.txt'), '100')
  const resultVariables = { frame: 'frame_ref', data: 'data_ref' }
  const producer = await invoke('marivo_python', { code, datasources: [], resultVariables })
  assert(producer.codeRef)
  const refs = z.record(z.string(), resultReference).parse(producer.resultRefs)
  assert.match(String(producer.stdout), /Arbitrary report log/)
  assert.equal(producer.stderr, '__DSH_MARIVO_RESULTS_V1__:user text\n')
  const resources = {
    frame: { kind: 'analysis-frame', ref: refs.frame, codeRef: producer.codeRef },
    data: { kind: 'dataframe', ref: refs.data, codeRef: producer.codeRef },
  }
  const saved = await invoke('marivo_present', {
    surface: 'tab',
    resources,
    title: 'Stable report',
    labels: { data: { amount: 'Revenue' } },
    program:
      'root = Stack([TextContent("Keep this exact body: 100"), AnalysisFrameView("frame"), DatasetView("data")]);',
  })
  const definition = JSON.parse(
    String(
      (await invoke('marivo_ui_read', { recordId: saved.recordId, includeCode: true }))
        .definitionJson,
    ),
  )
  assert.equal(definition.sources.length, 1)
  assert.equal(definition.sources[0].code.text, code)
  assert.deepEqual(definition.sources[0].code.datasources, [])
  assert.deepEqual(definition.sources[0].code.resultVariables, resultVariables)
  const baseId = String(saved.recordId).split(':')
  const base = await readAnalysisRecord(h.root, 'workspace', baseId[1]!, baseId[2]!)
  const receipt = JSON.parse(String(saved.deliveryJson)).receipt
  assert.equal(
    (await service.code({ workspaceId: 'workspace', receipt, codeRef: producer.codeRef })).text,
    code,
  )
  await writeFile(path.join(h.root, 'amount.txt'), '250')
  const refreshed = await invoke('marivo_python', {
    code: definition.sources[0].code.text,
    datasources: [],
    resultVariables: definition.sources[0].code.resultVariables,
  })
  assert(refreshed.codeRef)
  const newRefs = z.record(z.string(), resultReference).parse(refreshed.resultRefs)
  assert.notDeepEqual(newRefs.data, refs.data)
  assert.notDeepEqual(newRefs.frame, refs.frame)
  const update = await invoke('marivo_present', {
    surface: 'tab',
    basedOnRecordId: definition.recordId,
    resources: {
      frame: { kind: 'analysis-frame', ref: newRefs.frame, codeRef: refreshed.codeRef },
      data: { kind: 'dataframe', ref: newRefs.data, codeRef: refreshed.codeRef },
    },
  })
  const nextId = String(update.recordId).split(':')
  const next = parseAnalysisDocument(
    await readAnalysisRecord(h.root, 'workspace', nextId[1]!, nextId[2]!),
  )
  assert.equal(next.reportId, base.reportId)
  assert.equal(next.program, base.program)
  assert.equal(next.title, base.title)
  for (const name of ['frame', 'data']) {
    const resource = next.resources[name]
    assert(resource?.kind === 'snapshot')
    assert.deepEqual(resource.snapshot.data.rows, [['250']])
    assert.deepEqual(resource.binding.codeRef, refreshed.codeRef)
  }
  assert.equal(
    next.resources.data?.kind === 'snapshot' && next.resources.data.snapshot.data.columns[0]?.label,
    'Revenue',
  )
  assert.equal(h.starts, 2)
})

test('real Python result export failure preserves successful execution and does not infer printed refs', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const code =
    'print(\'{"schema":"marivo.frame_ref/v2","store_id":"store","session_id":"session","artifact_id":"artifact"}\')'
  const result = await h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: ToolCallId('missing-export'),
    name: 'marivo_python',
    arguments: { code, datasources: [], resultVariables: { result: 'missing_ref' } },
  })
  assert(!result.isError, JSON.stringify(result))
  const value = result.value as Record<string, unknown>
  assert.equal(value.exitCode, 0)
  assert(value.codeRef)
  assert(value.resultCaptureError)
  assert.equal(value.resultRefs, undefined)
  assert.match(String(value.stdout), /marivo.frame_ref/)
  assert.equal(value.stderr, '')
  assert.equal(h.starts, 1)
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
    callId: ToolCallId('code-budget'),
    name: 'run_code',
    arguments: {
      description: 'Validate outer cancellation',
      code: `await tools.marivo_python(${JSON.stringify({ code: sleepingTree, datasources: [], timeoutMs: 30_000 })});`,
    },
  })
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /execution deadline reached \(3000ms\)/)
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
