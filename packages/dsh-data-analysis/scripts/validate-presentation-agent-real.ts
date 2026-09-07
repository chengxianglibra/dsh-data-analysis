/** S5 autonomous real-model journey against an actual npm tarball in an isolated profile. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider, {
  CREDENTIALS_FILENAME,
  parseCredentialsDocument,
  renderFlatLayoutMigration,
} from '@deepseek-ai/dsh-credentials-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as FilesystemTools from '@deepseek-ai/dsh-tool-fs'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import { parsePresentationDocument } from '../src/presentation/contracts/index.ts'
import {
  installConnectionFixture,
  installStorage,
} from '../tests/semantic-reference-input/fixtures.ts'
import { actualDeliveries } from './presentation-s4/host.ts'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = path.resolve(packageRoot, '../..')
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON
assert.ok(pythonExecutable, 'Set DSH_DATA_ANALYSIS_PYTHON to a verified isolated Marivo Runtime')
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash'
const outputRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s5-agent-')))
const workspaceRoot = path.join(outputRoot, 'workspace')
const profileRoot = path.join(outputRoot, 'isolated-profile')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const ctx = new Context()
let modelSecret = ''
const redact = (text: string) => (modelSecret ? text.replaceAll(modelSecret, '[REDACTED]') : text)
const save = (name: string, value: unknown) =>
  writeFile(path.join(outputRoot, name), redact(JSON.stringify(value, null, 2)), { mode: 0o600 })
process.stdout.write(`S5 isolated real Agent validation: ${outputRoot}\n`)

/** Use Harness's parser without booting its writable/migrating provider on a user profile. */
async function discoverModelCredential(): Promise<{ value: string; source: string }> {
  const inherited = process.env.DEEPSEEK_API_KEY
  if (inherited) return { value: inherited, source: 'inherited-reference' }
  const filename = path.join(resolveDshHome(), CREDENTIALS_FILENAME)
  try {
    const raw = await readFile(filename, 'utf8')
    const value = parseCredentialsDocument(
      renderFlatLayoutMigration(raw) ?? raw,
      filename,
    ).refs.get('DEEPSEEK_API_KEY')
    if (value) return { value, source: 'read-only-harness-reference' }
  } catch {
    throw new Error('Cannot read the configured Harness model credential reference')
  }
  throw new Error('DEEPSEEK_API_KEY is not configured; real-model validation cannot run')
}

function command(executable: string, args: string[], cwd: string): string {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0)
    throw new Error(redact(`Validation subprocess failed: ${executable}\n${result.stderr}`))
  return result.stdout
}

async function installPackedPlugin() {
  // The caller builds once before validation. Packing must not clean or mutate lib.
  const packed = JSON.parse(
    command(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', outputRoot],
      packageRoot,
    ),
  ) as { filename: string; files: { path: string }[] }[]
  assert.equal(packed.length, 1)
  const item = packed[0]!
  const tarball = path.join(outputRoot, item.filename)
  const installedRoot = path.join(outputRoot, 'installed')
  await mkdir(installedRoot)
  command('tar', ['-xzf', tarball, '-C', installedRoot], outputRoot)
  await symlink(
    path.join(repositoryRoot, 'node_modules'),
    path.join(outputRoot, 'node_modules'),
    'dir',
  )
  const root = path.join(installedRoot, 'package')
  const modulePath = path.join(root, 'lib/index.js')
  const module = (await import(pathToFileURL(modulePath).href)) as typeof import('../src/index.ts')
  const removed = item.files
    .map((file) => file.path)
    .filter((file) =>
      /(?:report-kit|dsh-data-analysis-report|lib\/evidence\/|lib\/client\/evidence\/|classic)/.test(
        file,
      ),
    )
  assert.deepEqual(removed, [])
  assert.ok(
    item.files.some((file) => file.path === 'skills/dsh-data-analysis-presentation/SKILL.md'),
  )
  const modules = Object.fromEntries(
    await Promise.all(
      item.files
        .filter((file) => file.path.endsWith('.js'))
        .map(async (file) => [file.path, sha256(await readFile(path.join(root, file.path)))]),
    ),
  )
  return {
    module,
    root,
    evidence: {
      tarball,
      tarballSha256: sha256(await readFile(tarball)),
      modules,
      files: item.files.map((file) => file.path),
      removedFiles: removed,
    },
  }
}

/** Seed only business data and semantic declarations: no analysis, draft or receipt exists yet. */
async function prepareWorkspace() {
  const files = {
    'marivo.toml': '[project]\nname = "s5-autonomous-sales"\n',
    'models/datasources/warehouse.py':
      'import marivo.datasource as md\nmd.duckdb(name="warehouse", path="warehouse.duckdb")\n',
    'models/semantic/sales/__init__.py': '',
    'models/semantic/sales/_domain.py':
      'import marivo.semantic as ms\nms.domain(name="sales", owner="S5 validation")\n',
    'models/semantic/sales/objects.py': [
      'import marivo.datasource as md',
      'import marivo.semantic as ms',
      'orders = ms.entity(name="orders", datasource=ms.ref.datasource("warehouse"), source=md.table("orders"))',
      'region = ms.dimension_column(name="region", entity=orders, column="region")',
      '@ms.metric(entities=[orders], additivity="additive", name="revenue", unit="USD")',
      'def revenue(orders): return orders.amount.sum()',
      '',
    ].join('\n'),
  }
  for (const [relative, contents] of Object.entries(files)) {
    const filename = path.join(workspaceRoot, relative)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, contents)
  }
  const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
  const setup = await environment.runChecked({
    program: [
      'import duckdb',
      'connection = duckdb.connect("warehouse.duckdb")',
      'connection.execute("CREATE TABLE orders (region VARCHAR, amount DOUBLE)")',
      "connection.execute(\"INSERT INTO orders VALUES ('华东', 120.0), ('华东', 80.0), ('华南', 75.0), ('华南', 25.0), ('华北', 40.0), ('华北', 10.0)\")",
      'connection.close()',
    ].join('\n'),
  })
  assert.equal(setup.exitCode, 0, setup.stderr.toString('utf8'))
  return environment.binding
}

function summarizeCalls(events: readonly SessionEvent[]) {
  return events.flatMap((event) => {
    if (event.type !== 'tool/call') return []
    const result = events.find(
      (candidate) =>
        candidate.type === 'tool/result' &&
        candidate.data.message.content.some(
          (block) => block.type === 'tool-result' && block.toolCallId === event.data.callId,
        ),
    )
    const block =
      result?.type === 'tool/result'
        ? result.data.message.content.find((item) => item.type === 'tool-result')
        : undefined
    return [
      {
        sequence: event.seq,
        callId: String(event.data.callId),
        name: event.data.name,
        arguments: JSON.parse(event.data.arguments) as Record<string, unknown>,
        isError: block?.type === 'tool-result' ? Boolean(block.isError) : null,
      },
    ]
  })
}

try {
  const credential = await discoverModelCredential()
  modelSecret = credential.value
  const packed = await installPackedPlugin()
  const binding = await prepareWorkspace()
  await mkdir(profileRoot, { recursive: true, mode: 0o700 })
  ctx.provide(
    'launchEnvironment',
    createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DEEPSEEK_API_KEY: modelSecret } },
    ]),
  )
  installConnectionFixture(ctx)
  await installStorage(ctx, path.join(profileRoot, 'storage'))
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalCredentialProvider, { dshHome: profileRoot, watch: false })
  assert.equal((await ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY'))).configured, true)
  await ctx.plugin(DeepSeek, {
    thinking: 'disabled',
    reasoningEffort: 'off',
    maxTokens: 8192,
    streamIdleTimeoutMs: 120_000,
    models: [{ id: model, contextWindow: 128_000, maxTokens: 8192 }],
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, {
    root: path.join(profileRoot, 'sessions'),
    compression: 'none',
    packChunks: false,
  })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(SkillRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ShellEnv, { dshHome: profileRoot })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(BashLocal, { cwd: workspaceRoot, timeoutMs: 120_000, maxOutputBytes: 65_536 })
  await ctx.plugin(LocalFileSystem, { cwd: workspaceRoot })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  await ctx.plugin(SkillTool)
  await ctx.plugin(FilesystemTools)
  await ctx.plugin(packed.module, {
    pythonExecutable,
    runtimeRoot: path.join(profileRoot, 'runtime-marker'),
    credentialInteraction: 'none',
  })
  ctx.systemPrompt.section({
    name: 's5-validation-workspace',
    order: 10,
    text: `You are working in the isolated Workspace ${workspaceRoot}. Complete the user's task autonomously using available skills and tools. Read and write task data only in this Workspace; packaged skill resources may be read at their declared resource bases. Never inspect user profiles or credentials. The Workspace already contains a local warehouse datasource and sales semantic definitions. No user confirmation is needed for this isolated analysis.`,
  })
  const workspace = await ctx.workspaceRegistry.create(workspaceRoot, 'S5 autonomous sales')
  const sessionId = SessionId(`presentation-s5-${Date.now().toString(36)}`)
  const agent = ctx.agentLoop.create(
    sessionId,
    { provider: 'deepseek-official', model, maxTokens: 8192 },
    { cwd: workspace.path },
  )
  await workspace.attachSession(sessionId)
  const tools = ctx.tools.schemas(agent)
  const pluginTools = tools
    .filter((tool) => tool.name.startsWith('marivo_'))
    .map((tool) => tool.name)
    .sort()
  assert.deepEqual(pluginTools, [
    'marivo_datasource_test',
    'marivo_help',
    'marivo_present',
    'marivo_python',
  ])
  const skills = await ctx.skills.list({ cwd: workspaceRoot, scope: agent })
  assert.deepEqual(skills.map((skill) => skill.name).sort(), [
    'dsh-data-analysis-presentation',
    'marivo-analysis',
    'marivo-semantic',
  ])
  const presentationSkill = await ctx.skills.get('dsh-data-analysis-presentation', {
    cwd: workspaceRoot,
    scope: agent,
  })
  assert.equal(presentationSkill?.resourceBase?.kind, 'directory')
  assert.ok(
    presentationSkill?.resourceBase?.kind === 'directory' &&
      presentationSkill.resourceBase.path.startsWith(`${packed.root}${path.sep}`),
  )
  await save('registration-evidence.json', {
    packed: packed.evidence,
    binding,
    pluginTools,
    skills,
  })
  const prompt =
    '请分析当前 Workspace 中 sales 的区域销售额，比较各区域的表现并说明主要差异。请交付一份中文分析报告：有清楚的结论、可核对的区域销售额表格和柱状图，并展示真实分析来源；我需要在 Harness 中打开报告，并能下载完整 HTML 离线阅读。最后简短解释结果与报告位置。'
  const started = Date.now()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    agent.cancel({ kind: 'user' }, { keepInbox: true })
  }, 12 * 60_000)
  const progress = setInterval(() => {
    const calls = agent.session.events.filter((event) => event.type === 'tool/call')
    process.stdout.write(
      `S5 real model: ${Math.round((Date.now() - started) / 1000)}s, ${calls.length} tool calls\n`,
    )
  }, 25_000)
  try {
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }),
    )
    await agent.whenIdle()
  } finally {
    clearTimeout(deadline)
    clearInterval(progress)
  }
  await ctx.sessions.flush(agent.session)
  const stored = await ctx.sessionPersistence.load(sessionId)
  assert.deepEqual(stored.events, agent.session.events)
  const calls = summarizeCalls(stored.events)
  const deliveries = actualDeliveries(stored.events, String(sessionId))
  const last = stored.events.filter((event) => event.type === 'assistant/message').at(-1)
  const finalText =
    last?.type === 'assistant/message'
      ? last.data.message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
      : ''
  await save('agent-events.json', stored)
  await save('agent-trace.json', { prompt, calls, finalText, deliveries, timedOut })
  assert.equal(timedOut, false, 'Real-model journey exceeded its deadline')
  assert.ok(
    !JSON.stringify(stored).includes(modelSecret),
    'Model credential leaked into session evidence',
  )
  assert.ok(
    calls.some(
      (call) => call.name === 'skill' && call.arguments.name === 'dsh-data-analysis-presentation',
    ),
    'Real Agent did not select the presentation Skill',
  )
  assert.ok(
    calls.some((call) => call.name === 'skill' && call.arguments.name === 'marivo-analysis'),
    'Real Agent did not select the Runtime analysis Skill',
  )
  assert.ok(
    calls.some((call) => call.name === 'marivo_help' && !call.isError),
    'Real Agent did not consult live Help',
  )
  assert.ok(
    calls.some((call) => call.name === 'marivo_python' && !call.isError),
    'Real Agent did not execute Python',
  )
  const presentCalls = calls.filter((call) => call.name === 'marivo_present')
  assert.equal(presentCalls.length, 1, 'The report must be delivered by one present call')
  assert.equal(presentCalls[0]!.isError, false)
  assert.equal(deliveries.length, 1)
  assert.doesNotMatch(
    calls
      .map((call) => (call.name === 'skill' ? String(call.arguments.name) : call.name))
      .join('\n'),
    /marivo_datasource_access|marivo_evidence|dsh-data-analysis-report/,
  )
  assert.ok(finalText.length > 20, 'The real Agent did not explain its completed report')
  const receipt = deliveries[0]!.receipt
  assert.equal(receipt.workspaceId, String(workspace.id))
  for (const file of Object.values(receipt.files))
    assert.equal(sha256(await readFile(file.path)), file.sha256)
  const document = parsePresentationDocument(
    JSON.parse(await readFile(receipt.files.document.path, 'utf8')),
  )
  assert.ok(
    document.datasets.length > 0 &&
      document.sources.some((source) => source.status === 'available'),
  )
  const expectedSales = new Map([
    ['华东', 200],
    ['华南', 100],
    ['华北', 50],
  ])
  const verifiedBindings = document.datasets.flatMap((dataset) => {
    if (dataset.data.rows.length !== expectedSales.size) return []
    return dataset.data.columns.flatMap((regionColumn, regionIndex) =>
      dataset.data.columns.flatMap((revenueColumn, revenueIndex) => {
        if (
          regionIndex === revenueIndex ||
          !['float64', 'int64', 'decimal'].includes(revenueColumn.type)
        )
          return []
        const actual = new Map(
          dataset.data.rows.map((row) => [String(row[regionIndex]), Number(row[revenueIndex])]),
        )
        if (
          actual.size !== expectedSales.size ||
          [...expectedSales].some(([region, amount]) => actual.get(region) !== amount)
        )
          return []
        const chart = document.blocks.find(
          (block) =>
            block.kind === 'chart' &&
            block.chart === 'bar' &&
            block.datasetId === dataset.id &&
            block.x === regionColumn.id &&
            block.y.includes(revenueColumn.id),
        )
        const table = document.blocks.find(
          (block) =>
            block.kind === 'table' &&
            block.datasetId === dataset.id &&
            (!block.columns ||
              (block.columns.includes(regionColumn.id) &&
                block.columns.includes(revenueColumn.id))),
        )
        return chart && table
          ? [
              {
                datasetId: dataset.id,
                regionColumn: regionColumn.id,
                revenueColumn: revenueColumn.id,
                rows: Object.fromEntries(actual),
                chartBlock: chart.id,
                tableBlock: table.id,
              },
            ]
          : []
      }),
    )
  })
  assert.ok(
    verifiedBindings.length > 0,
    'The table and bar chart must bind the same verified region-to-revenue dataset',
  )
  const usage = stored.events.reduce(
    (total, event) => {
      if (event.type === 'assistant/message' && event.data.usage) {
        total.inputTokens += event.data.usage.inputTokens
        total.outputTokens += event.data.usage.outputTokens
      }
      return total
    },
    { inputTokens: 0, outputTokens: 0 },
  )
  assert.ok(usage.outputTokens > 0, 'The real model did not report generated output tokens')
  const draftPath = path.resolve(workspaceRoot, String(presentCalls[0]!.arguments.draft_path))
  assert.ok(draftPath.startsWith(`${workspaceRoot}${path.sep}`))
  const draftBytes = await readFile(draftPath)
  await save('agent-evidence.json', {
    status: 'passed',
    outputRoot,
    workspaceRoot,
    profileRoot,
    model: {
      provider: 'deepseek-official',
      id: model,
      thinking: 'disabled',
      credentialSource: credential.source,
    },
    binding,
    packed: packed.evidence,
    registration: { pluginTools, skills },
    sessionId,
    workspaceId: workspace.id,
    durablePath: ctx.sessionPersistence.locate(stored.meta)?.path,
    prompt,
    calls,
    finalText,
    receipt,
    draftPaths: [path.relative(workspaceRoot, draftPath)],
    draftSha256: sha256(draftBytes),
    verifiedBindings,
    usage,
    latencyMs: Date.now() - started,
    boundary:
      'actual packed production plugin, native Harness skill/fs/Shell services, official DeepSeek network adapter; no scripted LLM responses, Python, draft, or receipt',
    userProfileOrCredentialsModified: false,
    web: 'This script proves the real-model and file boundary; use retained draftPaths/workspaceRoot for actual Web download verification.',
  })
  process.stdout.write(
    JSON.stringify(
      {
        status: 'passed',
        outputRoot,
        evidencePath: path.join(outputRoot, 'agent-evidence.json'),
        toolCalls: calls.map((call) => call.name),
        receipt,
      },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  await save('failure.json', {
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
    outputRoot,
  })
  process.stderr.write(
    redact(
      `S5 real Agent validation failed: ${error instanceof Error ? error.message : String(error)}\nEvidence: ${outputRoot}\n`,
    ),
  )
  process.exitCode = 1
} finally {
  await ctx.fiber.dispose()
}
