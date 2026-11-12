/** Opt-in acceptance: real Harness + bound Python, isolated files, no model or database calls. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  createToolResultMessage,
  createUserMessage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
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
import {
  analysisResourceDeclaration,
  parseAnalysisDocument,
} from '../../src/presentation/contracts/analysis-document.ts'
import { parseReportRef } from '../../src/presentation/contracts/report-ref.ts'
import { readAnalysisRecord } from '../../src/presentation/reports.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { pythonException } from '../../src/python-exception.ts'
import type { PythonCodeRef } from '../../src/python-execution.ts'
import { restorePythonResults } from '../../src/python-results-context.ts'
import { TestShellEnv } from '../test-shell-env.ts'
import { Store } from './fixtures.ts'

const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
const skip = pythonExecutable
  ? false
  : 'Set DSH_DATA_ANALYSIS_PYTHON to the exact supported Runtime'

async function harness(t: TestContext, maxWallMs?: number, emptyProject = false) {
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
  if (!emptyProject)
    await writeFile(
      path.join(root, 'marivo.toml'),
      '[project]\nname = "python-budget-validation"\n',
    )
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

test('real preflight preserves the missing datasource repair before any user code starts', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const result = await h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: ToolCallId('unregistered-datasource'),
    name: 'marivo_python',
    arguments: {
      code: 'raise AssertionError("user-code-started")',
      datasources: ['missing_fixture'],
      project: 'required',
    },
  })
  assert.equal(result.isError, true)
  const text = JSON.stringify(result)
  assert.match(text, /DatasourceMissingError/)
  assert.match(text, /missing_fixture/)
  assert.match(text, /datasource/)
  assert.match(text, /register/)
  assert.match(text, /not-started/)
  assert.doesNotMatch(text, /user-code-started/)
  assert.equal(h.starts, 0)
})

test('real Python forwards datasource, semantic, analysis and ordinary exceptions through one contract', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const cases = [
    [
      'DatasourceMissingError',
      'import marivo.datasource as md\nmd.load().describe("missing_fixture")',
      'register',
    ],
    [
      'SemanticError',
      'from marivo.semantic.errors import SemanticError, repair\nraise SemanticError(kind="fixture", message="semantic fixture", repair=repair(kind="reload", canonical_id="load", action="Reload fixture"))',
      'reload',
    ],
    [
      'AnalysisError',
      'from marivo.analysis.errors import AnalysisError, AnalysisRepair\nraise AnalysisError(message="analysis fixture", repair=AnalysisRepair(kind="inspect", action="Inspect fixture", help_target={"surface":"analysis"}))',
      'inspect',
    ],
    ['ValueError', 'raise ValueError("ordinary fixture")', null],
  ] as const
  for (const [type, code, kind] of cases) {
    const result = await h.call(code, 30_000)
    assert.equal(result.isError, false, JSON.stringify(result))
    const value = z
      .object({
        exitCode: z.literal(1),
        exception: pythonException,
        execution: z.object({
          reason: z.literal('nonzero-exit'),
          nextAction: z.string().nullable(),
        }),
      })
      .parse(result.value)
    assert.equal(value.exception.type, type)
    if (type === 'SemanticError') assert.equal(value.exception.kind, 'fixture')
    assert.equal(value.exception.repair?.kind ?? null, kind)
    if (value.exception.repair)
      assert.equal(value.execution.nextAction, value.exception.repair.action)
    else assert.equal(value.exception.message, 'ordinary fixture')
  }
})

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
  const result = await h.call(sleepingTree, 10_000)
  assert.equal(result.isError, false)
  const value = result.value as unknown as ExecutionValue
  assert.equal(value.execution.reason, 'timed-out')
  assert.equal(value.execution.phase, 'executing')
  assert.equal(value.execution.effectiveTimeoutMs, 10_000)
  assert(value.execution.executionElapsedMs! >= 10_000)
  assert.equal(value.codeRef, undefined)
  assert.equal(h.starts, 1)
  await assertStopped(h.root)
})

test('real Harness refreshes Frame and DataFrame report data with traceable scripts and unchanged body', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const workspace = () => ({ id: 'workspace', path: h.root })
  const writer = createMarivoPresentTool(
    workspace,
    h.agent.session,
    undefined,
    undefined,
    async () => h.environment,
  )
  const reader = createMarivoUiReadTool(workspace)
  h.agent.ctx.tools.register(writer)
  h.agent.ctx.tools.register(reader)
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
    if (name === 'marivo_python' && sequence === 1) {
      const event = h.agent.session.append(
        'tool/result',
        {
          turn: 0,
          step: sequence,
          message: createToolResultMessage({ callId, content: result.content, isError: false }),
          meta: result.meta,
        },
        { surfaceOp: 'append' },
      )
      const signal = new AbortController().signal
      assert.equal(await restorePythonResults(h.agent.session, [], () => h.root, signal), undefined)
      h.agent.session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text: 'Compacted' }],
          source: { kind: 'user' },
        }),
        {
          surfaceOp: { op: 'replace', startSeq: event.seq, endSeq: event.seq },
          sourceEventSeqs: [event.seq],
        },
      )
      const restored = await restorePythonResults(h.agent.session, [], () => h.root, signal)
      assert(restored?.source?.kind === 'marivo-python-results')
      assert(restored.source.events.includes(event.seq))
      const content = restored.content[0]
      assert(content?.type === 'text')
      const handoff = z.object({
        results: z.record(z.string(), z.object({ resource: analysisResourceDeclaration })),
      })
      const groups = handoff.array().parse(JSON.parse(content.text.split('\n')[1]!))
      assert.deepEqual(groups[0], handoff.parse(result.value))
      assert.equal(
        await restorePythonResults(h.agent.session, [restored], () => h.root, signal),
        undefined,
      )
      assert.equal(await restorePythonResults(h.agent.session, [], () => h.home, signal), undefined)
    }
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
frame = session.values(columns={"amount": "CNY"}, rows=(((), {"amount": amount}),)).compute()
dataframe = pd.DataFrame({"amount": [amount]})
print("Arbitrary report log; reference discovery must not parse this text")
print("__DSH_MARIVO_RESULTS_V1__:user text", file=sys.stderr)
`
  await writeFile(path.join(h.root, 'amount.txt'), '100')
  const resultVariables = { frame: 'frame', data: 'dataframe' }
  const producer = await invoke('marivo_python', {
    code,
    datasources: [],
    project: 'required',
    resultVariables,
  })
  const outputs = z
    .record(z.string(), z.object({ resource: analysisResourceDeclaration, metadata: z.unknown() }))
    .parse(producer.results)
  const codeRef =
    outputs.frame?.resource.kind === 'analysis-frame' && outputs.frame.resource.codeRef
  assert(codeRef)
  assert.deepEqual(
    Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, output.metadata])),
    {
      frame: {
        status: 'captured',
        kind: 'frame',
        columns: ['amount'],
        values: ['amount'],
        axes: [],
        coverage: { totalRows: null, business: 'unknown' },
      },
      data: {
        status: 'captured',
        kind: 'dataset',
        columns: ['amount'],
        values: [],
        axes: [],
        coverage: { totalRows: 1, business: 'unknown' },
      },
    },
  )
  const resources = Object.fromEntries(
    Object.entries(outputs).map(([name, output]) => [name, output.resource]),
  )
  assert.match(String(producer.stdout), /Arbitrary report log/)
  assert.equal(producer.stderr, '__DSH_MARIVO_RESULTS_V1__:user text\n')
  await unlink(path.join(h.root, 'amount.txt'))
  const saved = await invoke(writer.name, {
    stage: 'save',
    resourcePatch: { put: resources },
    title: 'Stable report',
    labels: { data: { amount: 'Revenue' } },
    program:
      'root = Stack([TextContent("Keep this exact body: 100"), AnalysisFrameView("frame"), DatasetView("data", {chart:"table"}), DatasetView("data", {chart:"metric",encoding:{value:"amount"}})]);',
  })
  const definition = z
    .object({
      ref: z.string(),
      sources: z.array(
        z.object({
          code: z.object({
            text: z.string(),
            datasources: z.array(z.unknown()),
            resultVariables: z.record(z.string(), z.string()),
          }),
        }),
      ),
    })
    .parse((await invoke(reader.name, { ref: saved.ref, includeCode: true })).definition)
  assert.equal(definition.sources.length, 1)
  assert.equal(definition.sources[0]!.code.text, code)
  assert.deepEqual(definition.sources[0]!.code.datasources, [])
  assert.deepEqual(definition.sources[0]!.code.resultVariables, resultVariables)
  const baseId = parseReportRef(saved.ref)
  assert(baseId.kind === 'saved')
  const base = await readAnalysisRecord(h.root, 'workspace', baseId.reportId, baseId.buildId)
  const receipt = JSON.parse(String(saved.deliveryJson)).receipt
  assert.equal((await service.code({ workspaceId: 'workspace', receipt, codeRef })).text, code)
  await writeFile(path.join(h.root, 'amount.txt'), '250')
  const refreshed = await invoke('marivo_python', {
    code: definition.sources[0]!.code.text,
    datasources: [],
    project: 'required',
    resultVariables: definition.sources[0]!.code.resultVariables,
  })
  const refreshedOutputs = z
    .record(z.string(), z.object({ resource: analysisResourceDeclaration }))
    .parse(refreshed.results)
  const refreshedResources = Object.fromEntries(
    Object.entries(refreshedOutputs).map(([name, output]) => [name, output.resource]),
  )
  assert.notDeepEqual(refreshedResources.data, resources.data)
  assert.notDeepEqual(refreshedResources.frame, resources.frame)
  const update = await invoke(writer.name, {
    stage: 'save',
    ref: definition.ref,
    mode: 'refresh-data',
    resourcePatch: { put: refreshedResources },
  })
  const nextId = parseReportRef(update.ref)
  assert(nextId.kind === 'saved')
  const next = parseAnalysisDocument(
    await readAnalysisRecord(h.root, 'workspace', nextId.reportId, nextId.buildId),
  )
  assert.equal(next.reportId, base.reportId)
  assert.equal(next.program, base.program)
  assert.equal(next.title, base.title)
  for (const name of ['frame', 'data']) {
    const resource = next.resources[name]
    assert(resource?.kind === 'snapshot')
    assert.deepEqual(resource.snapshot.data.rows, [['250']])
    const refreshedResource = refreshedResources[name]!
    assert.deepEqual(
      resource.binding.codeRef,
      'codeRef' in refreshedResource ? refreshedResource.codeRef : undefined,
    )
  }
  assert.equal(
    next.resources.data?.kind === 'snapshot' && next.resources.data.snapshot.data.columns[0]?.label,
    'Revenue',
  )
  assert.equal(h.starts, 2)
})

test('real Python exports completed outputs after an exception and leaves pending Frames unevaluated', {
  skip,
}, async (t) => {
  const h = await harness(t)
  const result = await h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: ToolCallId('partial-outputs'),
    name: 'marivo_python',
    arguments: {
      project: 'required',
      datasources: [],
      resultVariables: { pending: 'pending', ready: 'ready', missing: 'missing' },
      code: `
import marivo.analysis as mv
session = mv.session.get_or_create("partial-outputs")
pending = session.values(columns={"amount": "CNY"}, rows=(((), {"amount": 42}),))
ready = pending.compute()
raise ValueError("after computing ready")
`,
    },
  })
  assert(!result.isError, JSON.stringify(result))
  const value = z
    .object({
      execution: z.object({ reason: z.string() }),
      resultCaptureError: z.string(),
      results: z.record(
        z.string(),
        z.object({
          resource: analysisResourceDeclaration,
          sourceStatus: z.string(),
        }),
      ),
    })
    .parse(result.value)
  assert.equal(value.execution.reason, 'nonzero-exit')
  assert.deepEqual(Object.keys(value.results), ['ready'])
  assert.equal(value.results.ready?.sourceStatus, 'unavailable')
  assert.match(value.resultCaptureError, /"pending"/)
  assert.match(value.resultCaptureError, /"missing"/)
  assert(result.meta)
})

test('real empty Workspace keeps file work zero-init and prepares persisted exports exactly once', {
  skip,
}, async (t) => {
  const h = await harness(t, undefined, true)
  const before = await readdir(h.root)
  const fileResult = await h.call('from pathlib import Path\nprint(Path.cwd().name)', 30_000)
  assert(!fileResult.isError, JSON.stringify(fileResult))
  assert.deepEqual(await readdir(h.root), before)
  const result = await h.agent.ctx.tools.execute({
    agent: h.agent,
    signal: new AbortController().signal,
    callId: ToolCallId('empty-workspace-export'),
    name: 'marivo_python',
    arguments: {
      code: 'import pandas as pd\nimport marivo.analysis as mv\ndata_ref = mv.persist_dataframe(pd.DataFrame({"amount": [42]})).to_dict()',
      datasources: [],
      project: 'required',
      resultVariables: { data: 'data_ref' },
    },
  })
  assert(!result.isError, JSON.stringify(result))
  const value = z
    .object({
      execution: z.object({
        requestedTimeoutMs: z.literal(600_000),
        effectiveTimeoutMs: z.literal(180_000),
      }),
      project: z.object({ status: z.literal('created'), projectRoot: z.literal(h.root) }),
      results: z.object({
        data: z.object({
          resource: analysisResourceDeclaration,
          sourceStatus: z.literal('recorded'),
        }),
      }),
    })
    .parse(result.value)
  assert.equal(value.results.data.resource.kind, 'dataframe')
  assert((await readFile(path.join(h.root, 'marivo.toml'), 'utf8')).includes('[project]'))
  assert.equal(h.starts, 3)
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
    arguments: {
      code,
      datasources: [],
      project: 'required',
      resultVariables: { result: 'missing_ref' },
    },
  })
  assert(!result.isError, JSON.stringify(result))
  const value = result.value as Record<string, unknown>
  assert.equal(value.exitCode, 0)
  assert.equal(value.codeRef, undefined)
  assert(value.resultCaptureError)
  assert.equal(value.results, undefined)
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
  assert.equal(value.codeRef, undefined)
  const sourceRoot = path.join(
    h.home,
    'dsh-data-analysis',
    'python-executions',
    createHash('sha256').update(h.root).digest('hex'),
  )
  const files = await readdir(sourceRoot)
  assert.equal(files.length, 1)
  assert.equal(JSON.parse(await readFile(path.join(sourceRoot, files[0]!), 'utf8')).text, code)
  assert.equal(h.starts, 1)
  t.diagnostic(JSON.stringify(value.execution))
})
