/** Actual Harness read, then bounded JSON field extraction when its line cap is reached. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as BashTool from '@deepseek-ai/dsh-tool-bash'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import { selectMetric } from '../../src/client/presentation/model.ts'

export async function verifyReferenceRead(ctx: Context, workspace: any, reference: string) {
  const filePath = reference
    .split('\n')
    .find((line) => line.startsWith('Report file (relative to this Workspace): '))
    ?.split(': ')[1]
  const cellLine = reference.split('\n').find((line) => line.startsWith('Cell: '))
  const cellId: string | undefined = cellLine && JSON.parse(cellLine.slice(6))
  const buildId = reference
    .split('\n')
    .find((line) => line.startsWith('Build ID: '))
    ?.slice(10)
  assert.ok(filePath && cellId && buildId)
  const filtersLine = reference.split('\n').find((line) => line.startsWith('Filters: '))
  const selection = filtersLine
    ? Object.fromEntries(
        JSON.parse(filtersLine.slice(9)).map((filter: any) => [filter.filterId, filter.optionId]),
      )
    : undefined
  let verified: Record<string, unknown> | undefined
  let failure: unknown
  let readLineTruncated = false
  const program = `const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(${JSON.stringify(filePath)}, 'utf8'));
const cell = d.blocks.find(b => b.id === ${JSON.stringify(cellId)});
if (!cell) throw new Error('Missing cell');
const selection = ${JSON.stringify(selection ?? null)};
const slice = selection && d.interaction.slices.find(s => Object.entries(selection).every(([key,value]) => s.selection[key] === value));
const rows = slice?.datasets.find(x => x.datasetId === cell.datasetId)?.rowIndices;
const dataset = d.datasets.find(x => x.id === cell.datasetId);
console.log(JSON.stringify({workspaceId:d.workspaceId,reportId:d.reportId,buildId:d.buildId,cell,dataset,rows}));`
  // JSON stringification is not shell quoting. A quoted heredoc passes the program literally.
  const command = `node <<'DSH_REFERENCE_READ_JS'\n${program}\nDSH_REFERENCE_READ_JS`
  class ReferenceAdapter extends LlmAdapter {
    step = 0
    override async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model }
    }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.purpose === 'session-title') {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const texts: string[] = []
      const visit = (value: unknown) => {
        if (typeof value === 'string') texts.push(value)
        else if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(options.messages)
      const step = this.step++
      if (step < 2) {
        if (step === 0) assert.ok(texts.includes(reference))
        else {
          assert.ok(
            texts.some((text) => text.includes('<content>')),
            'Public read result must reach next request',
          )
          readLineTruncated = texts.some((text) => text.includes('line truncated'))
        }
        const id = ToolCallId(`reference-read-${step}`),
          name = step === 0 ? 'read' : 'bash'
        const args = JSON.stringify(
          step === 0
            ? { file_path: filePath }
            : {
                command,
                description:
                  'Read the referenced saved report cell and its existing dataset; no writes or analysis',
              },
        )
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'tool-call', id, name, arguments: args },
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      try {
        const line = texts
          .flatMap((text) => text.split('\n'))
          .find((line) => line.startsWith('{"workspaceId":'))
        assert.ok(line, 'Public bash JSON read must reach the next actual model request')
        const data = JSON.parse(line)
        assert.equal(data.buildId, buildId)
        assert.equal(data.cell.id, cellId)
        assert.ok(reference.includes(`Workspace: ${JSON.stringify(data.workspaceId)}\n`))
        assert.ok(reference.includes(`Report ID: ${data.reportId}\n`))
        verified = {
          filePath,
          buildId,
          cellId,
          kind: data.cell.kind,
          readLineTruncated,
          tools: ['read', 'bash'],
          ...(data.rows ? { rows: data.rows } : {}),
        }
        if (data.cell.kind === 'metric')
          verified.exactValue = selectMetric('zh-CN', data.dataset.data, data.cell, data.rows).value
      } catch (error) {
        failure = error
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const provider = `reference-read-${Date.now()}`
  ctx.llm.registerAdapter([provider], new ReferenceAdapter())
  const id = SessionId(provider)
  const agent = await ctx.agentLoop.create(
    id,
    { provider, model: 'scripted-file-read' },
    { cwd: workspace.path },
  )
  await agent.ctx.plugin(FilesystemTools)
  await agent.ctx.plugin(BashTool)
  await workspace.attachSession(id)
  agent.followup(
    createUserMessage({ content: [{ type: 'text', text: reference }], source: { kind: 'user' } }),
  )
  await agent.whenIdle()
  assert.ifError(failure)
  assert.ok(verified, 'Public file Tool result must reach the model request')
  return verified
}
