/** Actual Harness AgentLoop -> export -> native present, followed by offline browser acceptance. No external model, Python or database. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativePresent from '@deepseek-ai/dsh-tool-present'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { chromium } from 'playwright'
import { registerMarivoExportHtmlTool } from '../src/presentation/export-html.ts'
import { presentationSha256 } from '../src/presentation/files.ts'
import { publishPresentation } from '../src/presentation/reports.ts'
import { resolvePresentationWorkspace } from '../src/workspace-identity.ts'
import { interactionFixture } from '../tests/presentation-reader/interaction-fixture.ts'
import { installStorage } from '../tests/semantic-reference-input/fixtures.ts'

const output = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-html-export-real-')))
const root = path.join(output, 'workspace')
await mkdir(root)
let exportedPath: string | undefined
class ScriptedAdapter extends LlmAdapter {
  step = 0
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.step++
    if (step > 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'HTML delivered' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'HTML delivered' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (step === 1) assert(exportedPath, 'present must use successful export result path')
    const name = step === 0 ? 'marivo_export_html' : 'present'
    const args =
      step === 0
        ? { report_id: 'report', output_path: 'reports/analysis.html' }
        : { files: [{ path: exportedPath!, description: '离线 HTML 报告' }] }
    const id = ToolCallId(`export-acceptance-${step}`)
    const argumentsJson = JSON.stringify(args)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: argumentsJson },
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
const ctx = new Context()
const browser = await chromium.launch({ headless: true })
try {
  await installStorage(ctx, path.join(output, 'storage'))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, {
    root: path.join(output, 'sessions'),
    compression: 'none',
  })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['scripted'], new ScriptedAdapter())
  const workspace = await ctx.workspaceRegistry.create(root, 'HTML export acceptance')
  const agent = await ctx.agentLoop.create(
    SessionId('html-export'),
    { provider: 'scripted', model: 'deterministic' },
    { cwd: root },
  )
  await workspace.attachSession(agent.session.id)
  const { document } = await interactionFixture()
  document.workspaceId = String(workspace.id)
  await publishPresentation(root, document, null, async () => {})
  const stop = registerMarivoExportHtmlTool(
    agent.ctx,
    () => resolvePresentationWorkspace(ctx, String(agent.session.id)),
    agent.session,
  )
  await agent.ctx.plugin(NativePresent)
  agent.ctx.on('tools/result', (exec, result) => {
    if (exec.name === 'marivo_export_html' && !result.isError) {
      const block = result.content.find((block) => block.type === 'text')
      assert(block?.type === 'text')
      exportedPath = JSON.parse(block.text).path
    }
  })
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'Export and present the saved HTML report.' }],
      source: { kind: 'user' },
    }),
  )
  await agent.whenIdle()
  await writeFile(
    path.join(output, 'events.json'),
    JSON.stringify([...agent.session.snapshotEvents()], null, 2),
  )
  assert(exportedPath, `Export failed; events: ${output}/events.json`)
  const events = [...agent.session.snapshotEvents()]
  const declarations = events.filter((event) => event.type === 'deliverables/presented')
  assert.equal(declarations.length, 1, JSON.stringify(events))
  assert.equal(declarations[0]!.data.files[0]!.path, exportedPath)
  await stop()
  assert(!agent.ctx.tools.schemas(agent).some((tool) => tool.name === 'marivo_export_html'))
  const html = await readFile(exportedPath)
  const errors: string[] = []
  const online = await browser.newContext({
    offline: true,
    viewport: { width: 1440, height: 1000 },
  })
  const page = await online.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(exportedPath).href)
  await page.waitForFunction(
    () => window.document.documentElement.dataset.presentationReady === 'true',
  )
  await page.getByRole('button', { name: /^日期/ }).click()
  await page.getByRole('menuitemradio', { name: '周一', exact: true }).click()
  await page.getByRole('button', { name: /^集群/ }).click()
  await page.getByRole('menuitemradio', { name: '甲集群', exact: true }).click()
  assert((await page.locator('#reader svg').count()) > 0)
  await page.screenshot({ path: path.join(output, 'offline-interactive.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const staticContext = await browser.newContext({ offline: true, javaScriptEnabled: false })
  const staticPage = await staticContext.newPage()
  await staticPage.goto(pathToFileURL(exportedPath).href)
  assert(await staticPage.locator('#presentation-fallback').isVisible())
  assert((await staticPage.locator('#presentation-fallback table').count()) > 0)
  await staticPage.screenshot({ path: path.join(output, 'offline-noscript.png'), fullPage: true })
  await writeFile(
    path.join(output, 'evidence.json'),
    JSON.stringify(
      {
        status: 'passed',
        exportedPath,
        sha256: presentationSha256(html),
        bytes: html.length,
        nativePresent: declarations,
        offlineInteractive: true,
        offlineNoScript: true,
        model: 'deterministic adapter; no external model',
      },
      null,
      2,
    ),
  )
  process.stdout.write(`HTML export acceptance passed: ${output}\n`)
} finally {
  await browser.close()
  await ctx.fiber.dispose()
}
