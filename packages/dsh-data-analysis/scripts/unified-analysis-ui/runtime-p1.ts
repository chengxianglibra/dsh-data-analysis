/** P1: real installed Runtime, original worker capture and independent snapshot reads. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MarivoDatasourceBridge } from '../../src/datasource/bridge.ts'
import { registerMarivoPythonTool } from '../../src/datasource/python.ts'
import { MarivoCredentialService } from '../../src/datasource/service.ts'
import {
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
} from '../../src/environment/index.ts'
import { readDatasetSnapshot } from '../../src/presentation/dataset-snapshot.ts'
import { MarivoPresentationProjection } from '../../src/presentation/projection/index.ts'
import { Store } from '../../tests/datasource-credentials/fixtures.ts'
import { TestShellEnv } from '../../tests/test-shell-env.ts'

const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
assert(pythonExecutable, 'Set the exact installed P1 Runtime')
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-unified-ui-p1-')))
const home = path.join(root, 'host')
const workspace = path.join(root, 'workspace')
await mkdir(home)
await mkdir(workspace)
const priorHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const ctx = new Context()
const service = new MarivoCredentialService(new Store(), 'none')
try {
  const runtime = await ensureSharedMarivoRuntime({
    runtimeRoot: path.join(root, 'marker'),
    pythonExecutable,
  })
  const environment = await new MarivoWorkspaceEnvironmentManager(runtime).resolve(workspace)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(BashLocal, { maxTimeoutMs: 180_000, maxOutputBytes: 262_144 })
  const agent = await ctx.agentLoop.create(
    SessionId('unified-ui-p1'),
    { provider: 'unused', model: 'unused' },
    { cwd: workspace },
  )
  registerMarivoPythonTool(agent.ctx, new MarivoDatasourceBridge(environment), service, {}, () => ({
    workspaceId: 'p1-workspace',
    projectRoot: workspace,
  }))
  const generation = await readFile(new URL('runtime-generate.py', import.meta.url), 'utf8')
  const split = generation.indexOf('sql = md.raw_sql')
  const setup = await environment.runChecked({
    program: generation.slice(0, split),
    limits: { timeoutMs: 120_000 },
  })
  assert.equal(setup.exitCode, 0, setup.stderr.toString())
  const producer = `import importlib.metadata, json, os\nfrom decimal import Decimal\nfrom pathlib import Path\nimport marivo\nimport marivo.analysis as mv\nimport marivo.datasource as md\nimport marivo.semantic as ms\nroot = Path.cwd()\nmodel = root / "models/semantic/sales/metrics.py"\n${generation.slice(split)}`
  const code = producer.replace(
    'print(json.dumps(result))',
    String.raw`
import pandas as pd
from dsh_data_analysis_presentation import capture_dataset
data = pd.DataFrame({"account": pd.Series([9007199254740993, None], dtype=object),
                     "amount": pd.Series([Decimal("12345678901234.5678"), None], dtype=object)})
capture = capture_dataset(data)
preview = capture_dataset(data, row_limit=1)
result["captureId"] = capture.capture_id
result["previewId"] = preview.capture_id
print(json.dumps(result))
`,
  )
  const tool = await agent.ctx.tools.execute({
    agent,
    signal: new AbortController().signal,
    callId: ToolCallId('p1-capture'),
    name: 'marivo_python',
    arguments: { code, datasources: ['warehouse'], timeoutMs: 120_000 },
  })
  assert.equal(tool.isError, false, JSON.stringify(tool))
  const value = tool.value as {
    stdout: string
    exitCode: number
    snapshots?: { captureId: string; snapshotRef: string }[]
    snapshotCaptureError?: string
  }
  assert.equal(value.exitCode, 0, JSON.stringify(value))
  assert.equal(value.snapshotCaptureError, undefined)
  assert.equal(value.snapshots?.length, 2)
  const generated = JSON.parse(value.stdout)
  const restored = await readDatasetSnapshot(
    workspace,
    'p1-workspace',
    value.snapshots![0]!.snapshotRef,
  )
  const preview = await readDatasetSnapshot(
    workspace,
    'p1-workspace',
    value.snapshots![1]!.snapshotRef,
  )
  assert.deepEqual(restored.snapshot.data.rows, [
    ['9007199254740993', '12345678901234.5678'],
    [null, null],
  ])
  assert.equal(preview.snapshot.coverage.complete, false)
  const projection = new MarivoPresentationProjection(environment)
  const [frame, prefix] = await projection.readFrames([
    generated.frame,
    { ...generated.frame, rowLimit: 1, columns: ['revenue'] },
  ])
  assert.deepEqual(frame!.data.rows, [
    ['A', '12345678901234.5678', '9007199254740993'],
    ['B', null, null],
  ])
  assert.equal(prefix!.coverage.complete, false)
  assert.equal(frame!.frame.axes.length, 1)
  assert.deepEqual(Object.values(frame!.frame.coordinates)[0]!.values, ['A', 'B'])
  const wheel = process.env.DSH_DATA_ANALYSIS_MARIVO_WHEEL
  const evidence = {
    status: 'passed',
    runtime,
    generated,
    snapshots: value.snapshots,
    restored,
    preview,
    frame,
    prefix,
    marivoWheel: wheel
      ? {
          path: wheel,
          sha256: createHash('sha256')
            .update(await readFile(wheel))
            .digest('hex'),
        }
      : null,
    boundary:
      'Real Harness tool/Shell/worker and installed Runtime. Source database deleted before restored reads. No UI or model acceptance.',
  }
  const evidencePath = path.join(root, 'runtime-evidence.json')
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ status: 'passed', evidencePath, runtime }, null, 2))
} finally {
  await service.close()
  await ctx.fiber.dispose()
  if (priorHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = priorHome
}
