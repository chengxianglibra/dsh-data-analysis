/** Real Runtime capture, report save and independent Build reads. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MarivoDatasourceBridge } from '../../src/datasource/bridge.ts'
import { registerMarivoPythonTool } from '../../src/datasource/python.ts'
import { MarivoCredentialService } from '../../src/datasource/service.ts'
import {
  ensureSharedMarivoRuntime,
  MarivoWorkspaceEnvironmentManager,
} from '../../src/environment/index.ts'
import { parseAnalysisDocument } from '../../src/presentation/contracts/analysis-document.ts'
import { resultReference } from '../../src/presentation/contracts/result-reference.ts'
import { isFrameSnapshotV2 } from '../../src/presentation/contracts/snapshot.ts'
import { parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import { readMarivoResult } from '../../src/presentation/result-reader.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool, createMarivoUiReadTool } from '../../src/presentation/tool.ts'
import { Store } from '../../tests/datasource-credentials/fixtures.ts'
import { TestShellEnv } from '../../tests/test-shell-env.ts'

const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
assert(pythonExecutable, 'Set DSH_DATA_ANALYSIS_PYTHON to the installed Runtime')
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-analysis-ui-runtime-')))
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
    SessionId('analysis-ui-runtime'),
    { provider: 'unused', model: 'unused' },
    { cwd: workspace },
  )
  registerMarivoPythonTool(agent.ctx, new MarivoDatasourceBridge(environment), service)
  const generation = await readFile(new URL('runtime-generate.py', import.meta.url), 'utf8')
  const split = generation.indexOf('sql = md.raw_sql')
  const setup = await environment.runChecked({
    program: generation.slice(0, split),
    limits: { timeoutMs: 120_000 },
  })
  assert.equal(setup.exitCode, 0, setup.stderr.toString())
  const producer = `import importlib.metadata, json, os\nfrom decimal import Decimal\nfrom pathlib import Path\nimport marivo\nimport marivo.analysis as mv\nimport marivo.datasource as md\nimport marivo.semantic as ms\nroot = Path.cwd()\nmodel = root / "models/semantic/sales/metrics.py"\n${generation.slice(split)}`
  const code = producer.replace(
    '# CAPTURE_BEFORE_SOURCE_REMOVAL',
    String.raw`
import pandas as pd
data = pd.DataFrame({"account": pd.Series([9007199254740993, None], dtype=object),
                     "amount": pd.Series([Decimal("12345678901234.5678"), None], dtype=object)})
result["frameRef"] = frame.ref.to_dict()
result["dataRef"] = mv.persist_dataframe(data).to_dict()

`,
  )
  const tool = await agent.ctx.tools.execute({
    agent,
    signal: new AbortController().signal,
    callId: ToolCallId('analysis-ui-capture'),
    name: 'marivo_python',
    arguments: { code, datasources: ['warehouse'], timeoutMs: 120_000 },
  })
  assert.equal(tool.isError, false, JSON.stringify(tool))
  const value = tool.value as { stdout: string; exitCode: number }
  assert.equal(value.exitCode, 0, JSON.stringify(value))
  const generated = JSON.parse(value.stdout)
  const signal = new AbortController().signal
  const frame = await readMarivoResult(
    environment,
    resultReference.parse(generated.frameRef),
    signal,
  )
  const restored = await readMarivoResult(
    environment,
    resultReference.parse(generated.dataRef),
    signal,
  )
  assert(isFrameSnapshotV2(frame))
  assert.deepEqual(restored.data.rows, [
    ['9007199254740993', '12345678901234.5678'],
    [null, null],
  ])
  assert.deepEqual(frame.data.rows, [
    ['A', '12345678901234.5678', '9007199254740993'],
    ['B', null, null],
  ])
  assert.equal(frame.frame.axes.length, 1)
  assert.deepEqual(Object.values(frame.frame.coordinates)[0]!.values, ['A', 'B'])
  const deliveries = []
  const present = createMarivoPresentTool(
    () => ({ id: 'analysis-ui-workspace', path: workspace }),
    agent.session,
    undefined,
    undefined,
    async () => environment,
  )
  for (const [index, resource] of [
    { kind: 'analysis-frame', ref: generated.frameRef },
    { kind: 'dataframe', ref: generated.dataRef },
  ].entries()) {
    const callId = ToolCallId(`analysis-ui-present-${index}`)
    const args = {
      resourcePatch: { put: { result: resource } },
      title: `Real ${index ? 'DataFrame' : 'Frame'}`,
    }
    agent.session.append('tool/call', {
      turn: 0,
      step: index,
      callId,
      name: 'marivo_present',
      arguments: JSON.stringify(args),
    })
    const result = (await present.execute(args, {
      agent,
      callId,
      signal: new AbortController().signal,
    } as ToolRunContext)) as { stage: string; recordId: string; deliveryJson: string }
    assert.equal(result.stage, 'save')
    assert.match(result.recordId, /^marivo-ui:/)
    deliveries.push(parsePresentationDelivery(JSON.parse(result.deliveryJson)))
  }
  await rm(path.join(workspace, '.marivo'), { recursive: true })
  // A fresh OS process reads the immutable Build via the production RPC service.
  const { execFileSync } = await import('node:child_process')
  const rpcModule = new URL('../../src/presentation/rpc.ts', import.meta.url).href
  execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
      import assert from 'node:assert/strict';
      import {MarivoPresentationFileService} from ${JSON.stringify(rpcModule)};
      const service = new MarivoPresentationFileService(() => ({id:'analysis-ui-workspace',path:${JSON.stringify(workspace)}}));
      try { for (const delivery of ${JSON.stringify(deliveries)}) {
        const result = await service.read({sessionId:'analysis-ui-runtime',receipt:delivery.receipt,asset:'presentation.json'});
        const document=JSON.parse(Buffer.from(result.bodyBase64,'base64').toString());
        assert.equal(document.schemaVersion,'dsh.analysis-ui/v1');
        assert(JSON.stringify(document).includes('12345678901234.5678'));
        assert(JSON.stringify(document).includes('9007199254740993'));
      } } finally { await service.close() }
  `,
    ],
    { cwd: workspace, encoding: 'utf8' },
  )
  const files = new MarivoPresentationFileService(() => ({
    id: 'analysis-ui-workspace',
    path: workspace,
  }))
  try {
    for (const delivery of deliveries) {
      const data = await files.read({
        sessionId: String(agent.session.id),
        receipt: delivery.receipt,
        asset: 'presentation.json',
      })
      parseAnalysisDocument(JSON.parse(Buffer.from(data.bodyBase64, 'base64').toString()))
    }
    const read = createMarivoUiReadTool(() => ({ id: 'analysis-ui-workspace', path: workspace }))
    const recordId = `marivo-ui:${deliveries[0]!.receipt.reportId}:${deliveries[0]!.receipt.buildId}`
    const result = (await read.execute({ recordId }, {
      agent,
      callId: ToolCallId('analysis-ui-read'),
      signal: new AbortController().signal,
    } as ToolRunContext)) as { definitionJson: string }
    assert.equal(JSON.parse(result.definitionJson).recordId, recordId)
  } finally {
    await files.close()
  }
  const evidence = {
    status: 'passed',
    deliveries,
    runtime,
    generated,
    restored,
    frame,
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
