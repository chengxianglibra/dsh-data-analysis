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
  ReasoningEffortId,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { parsePresentationDurableContent } from '../../src/client/presentation/delivery.ts'
import { parsePresentationDelivery } from '../../src/presentation/receipt.ts'
import { registerPluginRpc } from '../../src/rpc.ts'
import { installDeepSeekValidationProvider } from '../deepseek-validation-provider.ts'

export async function installProbe(ctx: Context, workspaceRoot: string, outputRoot: string) {
  const python = process.env.DSH_DATA_ANALYSIS_PYTHON
  assert(python)
  const workspace =
    ctx.workspaceRegistry.list().find((w) => w.path === workspaceRoot) ??
    (await ctx.workspaceRegistry.create(workspaceRoot, '统一分析 UI P2'))
  const p3 = process.env.DSH_UNIFIED_UI_P3 === '1'
  let request: Record<string, unknown> | undefined
  let toolName = 'marivo_present'
  let release: (() => void) | undefined
  let waiting = false

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
      const name = toolName
      request = undefined
      const id = ToolCallId(`p2-present-${Date.now()}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      const end =
        p3 && name === 'marivo_present' && args.includes('P3 streamed')
          ? args.indexOf('P3 streamed') + 32
          : args.length
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args.slice(0, end) }
      if (end < args.length) {
        waiting = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
        waiting = false
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args.slice(end) }
      }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name, arguments: args },
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
  let restoreMode = agent.ctx.tools.presentAs('native')
  await workspace.attachSession(sessionId)
  const prepare = async () => {
    const generation = await readFile(new URL('runtime-generate.py', import.meta.url), 'utf8')
    const split = generation.indexOf('sql = md.raw_sql')
    execFileSync(python, ['-c', generation.slice(0, split)], { cwd: workspaceRoot })
    const producer =
      `import importlib.metadata, json, os\nfrom decimal import Decimal\nfrom pathlib import Path\nimport marivo\nimport marivo.analysis as mv\nimport marivo.datasource as md\nimport marivo.semantic as ms\nroot=Path.cwd()\nmodel=root/'models/semantic/sales/metrics.py'\n${generation.slice(split)}`.replace(
        '# CAPTURE_BEFORE_SOURCE_REMOVAL',
        `
import pandas as pd
from dsh_data_analysis_presentation import capture_dataset, capture_frame
capture_frame(frame)
capture_dataset(pd.DataFrame({"account":pd.Series([9007199254740993]+list(range(1,44))+[None],dtype=object),"amount":pd.Series([Decimal("12345678901234.5678")]+[Decimal("2.3400")]*43+[None],dtype=object)}))
capture_dataset(pd.DataFrame({"amount":[Decimal("123.4500")]}))

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
    assert(value.snapshots?.length === 3, JSON.stringify(produced))
    const resources = {
      frame: { kind: 'frame-snapshot', snapshotRef: value.snapshots[0]!.snapshotRef },
      data: { kind: 'dataset-snapshot', snapshotRef: value.snapshots[1]!.snapshotRef },
      metric: { kind: 'dataset-snapshot', snapshotRef: value.snapshots[2]!.snapshotRef },
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
    const deliveries = events.flatMap((event) => {
      try {
        if (event.type === 'tool/result' && event.data.meta && !event.data.message.isError)
          return [parsePresentationDelivery(event.data.meta)]
        if (event.type === 'tool/ptc-dispatch' && !event.data.isError) {
          const delivery = parsePresentationDurableContent(event.data.content)
          return delivery ? [delivery] : []
        }
      } catch {
        /* Unrelated tool metadata is not a delivery. */
      }
      return []
    })
    await writeFile(path.join(outputRoot, 'host-events.json'), JSON.stringify(events, null, 2))
    await writeFile(
      path.join(outputRoot, 'p2-evidence.json'),
      JSON.stringify(
        { p3, waiting, inputs, produced: value, deliveries, workspaceId: workspace.id, sessionId },
        null,
        2,
      ),
    )
    return { waiting, deliveries, sessionId, workspaceId: workspace.id }
  }
  let modelAgent: typeof agent | undefined
  const modelCase = async (endpoint: string) => {
    if (!modelAgent) {
      const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-pro'
      if (!ctx.llm.listProviders().some((provider) => provider.id === 'deepseek-official'))
        await installDeepSeekValidationProvider(ctx, {
          thinking: 'disabled',
          maxTokens: 4096,
          streamIdleTimeoutMs: 180_000,
          models: [{ id: model, contextWindow: 256_000, maxTokens: 4096 }],
        })
      modelAgent = await ctx.agentLoop.create(
        SessionId(`unified-analysis-ui-p3-model-${Date.now()}`),
        {
          provider: 'deepseek-official',
          model,
          maxTokens: 4096,
          reasoningEffort: ReasoningEffortId('low'),
        },
        { cwd: workspaceRoot },
      )
      modelAgent.ctx.tools.presentAs('native')
      await workspace.attachSession(modelAgent.session.id)
    }
    if (endpoint !== 'model-status') {
      const events = modelAgent.session.snapshotEvents()
      const last = [...events]
        .reverse()
        .find((e) => e.type === 'tool/result' && e.data.meta && !e.data.message.isError)
      let prompt = '2 + 2 等于多少？一句话回答。'
      if (endpoint === 'model-reference')
        prompt = `请用可以选择列、排序和翻页的表格展示这个已有结果，方便我检查大整数、金额和缺失值。不是报告。已有成功引用：${JSON.stringify(inputs.dataset.resources)}。不需要重新分析。`
      if (endpoint === 'model-update') {
        if (last?.type !== 'tool/result') throw new Error('model-base-missing')
        const meta = last.data.meta as {
          receipt: { reportId: string; buildId: string; files: { document: { path: string } } }
        }
        const saved = JSON.parse(await readFile(meta.receipt.files.document.path, 'utf8'))
        prompt = `请在刚才页面表格上方增加一句说明“本页仅检查已保存快照”，沿用原数据。准确基版本 ${saved.recordId}，已知 program：${saved.program}。组件签名 root 可为 Stack(children: components[])，TextContent(text: string)，DatasetView(ref: string)。`
      }
      modelAgent.followup(
        createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }),
      )
    }
    const events = modelAgent.session.snapshotEvents()
    await writeFile(
      path.join(outputRoot, 'p3-model-events.json'),
      JSON.stringify(events, null, 2),
      { mode: 0o600 },
    )
    return {
      sessionId: String(modelAgent.session.id),
      running: modelAgent.status === 'running',
      events: events.length,
    }
  }
  const stop = registerPluginRpc(
    ctx.connection,
    '/unified-ui-p2',
    [
      'dataset',
      'frame',
      'composition',
      'status',
      'stream-tool',
      'stream-tab',
      'release',
      'patch',
      'failure',
      'ptc',
      'model-simple',
      'model-reference',
      'model-update',
      'model-status',
    ],
    async (endpoint) => {
      if (endpoint.startsWith('model-')) return { ok: true, value: await modelCase(endpoint) }
      if (endpoint === 'release') {
        release?.()
        await agent.whenIdle()
        return { ok: true, value: await save() }
      }
      if (endpoint !== 'status') {
        toolName = 'marivo_present'
        restoreMode()
        restoreMode = agent.ctx.tools.presentAs(endpoint === 'ptc' ? 'ptc' : 'native')
        if (endpoint === 'stream-tool' || endpoint === 'stream-tab')
          request = {
            surface: endpoint === 'stream-tab' ? 'tab' : 'tool',
            resources: inputs.composition.resources,
            title: 'P3 streaming ' + endpoint,
            program:
              'root = Stack([intro, AnalysisFrameView("frame"), DatasetView("data")]);\nintro = TextContent("P3 streamed Native prefix before complete arguments");',
          }
        else if (endpoint === 'patch' || endpoint === 'failure') {
          const events = agent.session.snapshotEvents()
          const latest = [...events]
            .reverse()
            .find((e) => e.type === 'tool/result' && e.data.meta && !e.data.message.isError)
          if (latest?.type !== 'tool/result') throw new Error('missing-base')
          const meta = latest.data.meta as { receipt: { reportId: string; buildId: string } }
          request = {
            surface: 'tab',
            basedOnRecordId: `marivo-ui:${meta.receipt.reportId}:${meta.receipt.buildId}`,
            program:
              endpoint === 'patch'
                ? 'intro = TextContent("P3 updated one statement; saved rows reused");'
                : 'intro = null;',
          }
        } else if (endpoint === 'ptc') {
          toolName = 'run_code'
          request = {
            description: 'P3 actual PTC delivery',
            code: `await tools.marivo_present(${JSON.stringify({ surface: 'tab', resources: inputs.dataset.resources, title: 'P3 PTC' })});`,
          }
        } else if (endpoint in inputs) request = inputs[endpoint as keyof typeof inputs]
        else throw new Error('unknown-p2-case')
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: `Show P2 ${endpoint}` }],
            source: { kind: 'user' },
          }),
        )
        if (!endpoint.startsWith('stream-')) await agent.whenIdle()
      }
      return { ok: true, value: await save() }
    },
  )
  ctx.effect(() => stop)
  return { sessionId, workspaceId: workspace.id }
}
