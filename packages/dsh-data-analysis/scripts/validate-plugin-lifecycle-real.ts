/** Isolated actual Cordis/Connection/Runtime lifecycle, no remote model or business database. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  type LlmResolvedModelInfo,
  type StreamChunk,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { DSH_PEER_RANGE } from '../src/compatibility.ts'
import { apply, inject } from '../src/plugin.ts'
import { installStorage } from '../tests/semantic-reference-input/fixtures.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

class Adapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'lifecycle-ready' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'lifecycle-ready' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(resolveDshHome(), 'dsh-data-analysis/runtimes/marivo/.venv/bin/python')
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-plugin-lifecycle-')))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
const ctx = new Context()
try {
  const workspaceRoot = path.join(root, 'workspace')
  await mkdir(workspaceRoot)
  await writeFile(
    path.join(workspaceRoot, 'marivo.toml'),
    '[project]\nname = "lifecycle-validation"\n',
  )
  await ctx.plugin(LocalCredentialProvider, { dshHome: process.env.DSH_HOME, watch: false })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(Connection)
  await installStorage(ctx, path.join(root, 'storage'))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, {
    root: path.join(root, 'sessions'),
    compression: 'none',
  })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(SkillRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(BashLocal, { maxTimeoutMs: 180_000, maxOutputBytes: 65536 })
  ctx.llm.registerAdapter(['lifecycle-scripted'], new Adapter())
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'Lifecycle validation')
  const agent = await ctx.agentLoop.create(
    SessionId('lifecycle'),
    { provider: 'lifecycle-scripted', model: 'fixture' },
    { cwd: workspace.path },
  )
  const config = {
    pythonExecutable,
    runtimeRoot: path.join(root, 'runtime'),
    credentialInteraction: 'none' as const,
  }
  const definition = { name: 'stage-four-lifecycle', inject, apply }
  const toolNames = () =>
    agent.ctx.tools
      .schemas(agent)
      .filter((tool) => tool.name.startsWith('marivo_'))
      .map((tool) => tool.name)
      .sort()
  const expectedTools = [
    'marivo_datasource_configure',
    'marivo_datasource_test',
    'marivo_help',
    'marivo_present',
    'marivo_python',
  ]
  const section = ctx.systemPrompt.section
  ctx.systemPrompt.section = function (input) {
    if (input.name === 'marivo:presentation') throw new Error('injected-real-prompt-registration')
    return section.call(this, input)
  }
  for (const service of inject)
    assert.ok(ctx.get(service), `Missing lifecycle prerequisite: ${service}`)
  const failed = ctx.plugin(definition, config)
  await assert.rejects(async () => await failed, /injected-real-prompt-registration/)
  await failed.dispose()
  ctx.systemPrompt.section = section
  assert.deepEqual(toolNames(), [])
  let plugin = await ctx.plugin(definition, config)
  assert.deepEqual(toolNames(), expectedTools)
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text: 'Ordinary lifecycle check' }],
      source: { kind: 'user' },
    }),
  )
  await agent.whenIdle()
  const help = await agent.ctx.tools.execute({
    agent,
    signal: new AbortController().signal,
    callId: ToolCallId('lifecycle-help'),
    name: 'marivo_help',
    arguments: { targets: ['analysis.observe'] },
  })
  assert.equal(help.isError, false)
  const connection = ctx.connection as Connection.HostConnectionService
  const handler = connection.createSharedFetchHandler('/api')
  const request = () =>
    new Request('http://localhost/api/marivo-presentation/reports/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'lifecycle',
        method: 'marivo-presentation/reports/list',
        payload: { workspaceId: String(workspace.id) },
      }),
    })
  const before = await handler.fetch(request())
  assert.equal(before.status, 200)
  assert.equal((await before.json()).result.ok, true)
  const marker = path.join(workspaceRoot, 'running.pid')
  const call = agent.ctx.tools.execute({
    agent,
    signal: new AbortController().signal,
    callId: ToolCallId('lifecycle-python'),
    name: 'marivo_python',
    arguments: {
      datasources: [],
      code: 'import os, pathlib, time\npathlib.Path("running.pid").write_text(str(os.getpid()))\ntime.sleep(60)',
      timeoutMs: 90_000,
    },
  })
  const deadline = Date.now() + 30_000
  let pid: number | undefined
  while (Date.now() < deadline) {
    try {
      pid = Number(await readFile(marker, 'utf8'))
      break
    } catch {
      await delay(25)
    }
  }
  assert.ok(pid, 'actual Python must start before the unload probe')
  await plugin.dispose()
  const outcome = await call
  assert.ok(outcome.isError || (outcome.value as { aborted?: boolean }).aborted)
  let processState = 'absent'
  try {
    process.kill(pid!, 0)
    processState = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], {
      encoding: 'utf8',
    }).trim()
    console.log('Python state at unload:', processState)
    assert.match(processState, /^Z/, 'Python must have exited; only an unreaped zombie may remain')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
  assert.deepEqual(toolNames(), [])
  assert.equal((await handler.fetch(request())).status, 404)
  plugin = await ctx.plugin(definition, config)
  assert.deepEqual(toolNames(), expectedTools)
  const after = await handler.fetch(request())
  assert.equal(after.status, 200)
  assert.equal((await after.json()).result.ok, true)
  await plugin.dispose()
  assert.deepEqual(toolNames(), [])
  const evidence = {
    status: 'passed',
    pythonStateAtUnload: processState,
    node: process.version,
    baseline: createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version,
    compatibleRange: DSH_PEER_RANGE,
    checks: [
      'real Cordis failed installation rollback',
      'same Agent reinstall',
      'scripted Agent request',
      'actual Marivo focused Help',
      'actual Connection Fetch 200/404/200',
      'real Python started once and exited before unload resolved',
      'second unload',
    ],
    boundary:
      'isolated home/workspace/runtime marker; installed Harness services and actual Marivo Python; in-memory Fetch transport, no HTTP authentication claim or remote model',
  }
  await mkdir('artifacts', { recursive: true })
  await writeFile(
    'artifacts/dsh-stage-four-lifecycle-real.json',
    JSON.stringify(evidence, null, 2) + '\n',
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await ctx.fiber.dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true })
}
