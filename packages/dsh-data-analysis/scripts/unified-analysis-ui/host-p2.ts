/** P2 uses production Tools and Client with a scripted model boundary, in an isolated Host. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerPluginRpc } from '../../src/rpc.ts'

export async function installProbe(ctx: Context, workspaceRoot: string, outputRoot: string) {
  const python = process.env.DSH_DATA_ANALYSIS_PYTHON
  assert(python)
  const workspace =
    ctx.workspaceRegistry.list().find((w) => w.path === workspaceRoot) ??
    (await ctx.workspaceRegistry.create(workspaceRoot, '统一分析 UI P2'))
  let request: Record<string, unknown> | undefined
  class ProbeAdapter extends LlmAdapter {
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model })
    }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.purpose === 'session-title' || !request) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const args = JSON.stringify(request)
      request = undefined
      const id = ToolCallId(`p2-present-${Date.now()}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'marivo_present', argumentsDelta: args }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'marivo_present', arguments: args },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.llm.registerAdapter(['p2-scripted'], new ProbeAdapter())
  const sessionId = SessionId('unified-analysis-ui-p2')
  const agentOptions = { provider: 'p2-scripted', model: 'static-contract' }
  const agent = existsSync(path.join(outputRoot, 'p2-evidence.json'))
    ? (await ctx.agentLoop.resume(ctx, { resumeSessionId: sessionId, agentOptions })).agent
    : await ctx.agentLoop.create(sessionId, agentOptions, { cwd: workspaceRoot })
  agent.ctx.tools.presentAs('native')
  await workspace.attachSession(sessionId)
  const prepare = async () => {
    const generation = await readFile(new URL('runtime-generate.py', import.meta.url), 'utf8')
    const split = generation.indexOf('sql = md.raw_sql')
    execFileSync(python, ['-c', generation.slice(0, split)], { cwd: workspaceRoot })
    const producer =
      `import importlib.metadata, json, os\nfrom decimal import Decimal\nfrom pathlib import Path\nimport marivo\nimport marivo.analysis as mv\nimport marivo.datasource as md\nimport marivo.semantic as ms\nroot=Path.cwd()\nmodel=root/'models/semantic/sales/metrics.py'\n${generation.slice(split)}`.replace(
        'print(json.dumps(result))',
        `
import pandas as pd
from dsh_data_analysis_presentation import capture_dataset
capture_dataset(pd.DataFrame({"account":pd.Series([9007199254740993]+list(range(1,44))+[None],dtype=object),"amount":pd.Series([Decimal("12345678901234.5678")]+[Decimal("2.3400")]*43+[None],dtype=object)}))
capture_dataset(pd.DataFrame({"amount":[Decimal("123.4500")]}))
print(json.dumps(result))
`,
      )
    const produced = await agent.ctx.tools.execute({
      agent,
      signal: new AbortController().signal,
      callId: ToolCallId('p2-producer'),
      name: 'marivo_python',
      arguments: { code: producer, datasources: ['warehouse'], timeoutMs: 120_000 },
    })
    assert.equal(produced.isError, false, JSON.stringify(produced))
    const value = produced.value as { stdout: string; snapshots: { snapshotRef: string }[] }
    const frame = JSON.parse(value.stdout).frame
    assert(value.snapshots?.length === 2, JSON.stringify(produced))
    const resources = {
      frame: { kind: 'marivo-frame', ...frame },
      data: { kind: 'dataset-snapshot', snapshotRef: value.snapshots[0]!.snapshotRef },
      metric: { kind: 'dataset-snapshot', snapshotRef: value.snapshots[1]!.snapshotRef },
      image: { kind: 'image-file', path: 'sample.png' },
    }
    await writeFile(
      path.join(workspaceRoot, 'sample.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    const inputs = {
      dataset: { title: 'P2 精确数据快照', resources: { data: resources.data } },
      frame: { title: 'P2 Frame 快照', resources: { frame: resources.frame } },
      composition: {
        title: 'P2 统一分析报告',
        surface: 'tab',
        resources,
        program:
          'root = Stack([TextContent("## 已保存的精确结果\\n同一静态快照，切换位置无需重新分析。"), Card([AnalysisFrameView("frame", {chart:"table"})]), Tabs([TabItem("data","数据",[DatasetView("data")]),TabItem("details","指标与图片",[DatasetView("metric",{chart:"metric",encoding:{value:"amount"}}),Image("已保存图片","image")])])]);',
      },
    }
    return { value, inputs }
  }
  // Reuse the original successful producer on cold Host restart; never rerun it to recover a view.
  const previous = await readFile(path.join(outputRoot, 'p2-evidence.json'), 'utf8')
    .then((text) => {
      const saved = JSON.parse(text) as {
        produced: Awaited<ReturnType<typeof prepare>>['value']
        inputs: Awaited<ReturnType<typeof prepare>>['inputs']
      }
      return { value: saved.produced, inputs: saved.inputs }
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
  const { value, inputs } = previous ?? (await prepare())
  const save = async () => {
    const events = agent.session.snapshotEvents()
    const deliveries = events.flatMap((e) =>
      e.type === 'tool/result' && e.data.meta ? [e.data.meta] : [],
    )
    await writeFile(path.join(outputRoot, 'host-events.json'), JSON.stringify(events, null, 2))
    await writeFile(
      path.join(outputRoot, 'p2-evidence.json'),
      JSON.stringify(
        { inputs, produced: value, deliveries, workspaceId: workspace.id, sessionId },
        null,
        2,
      ),
    )
    return { deliveries, sessionId, workspaceId: workspace.id }
  }
  const stop = registerPluginRpc(
    ctx.connection,
    '/unified-ui-p2',
    ['dataset', 'frame', 'composition', 'status'],
    async (endpoint) => {
      if (endpoint !== 'status') {
        if (!(endpoint in inputs)) throw new Error('unknown-p2-case')
        request = inputs[endpoint as keyof typeof inputs]
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: `Show P2 ${endpoint}` }],
            source: { kind: 'user' },
          }),
        )
        await agent.whenIdle()
      }
      return { ok: true, value: await save() }
    },
  )
  ctx.effect(() => stop)
  return { sessionId, workspaceId: workspace.id }
}
