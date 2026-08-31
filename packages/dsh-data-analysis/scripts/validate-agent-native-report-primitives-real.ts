import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRuntime from '@deepseek-ai/dsh-skill'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolFileSystem from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import {
  bindMarivoEnvironment,
  ensureSharedMarivoRuntime,
  FixedSubprocessPolicy,
} from '../src/environment/index.ts'
import { apply, inject } from '../src/plugin.ts'
import { TestShellEnv } from '../tests/test-shell-env.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const model = process.env.DSH_DATA_ANALYSIS_VALIDATION_MODEL ?? 'deepseek-v4-flash'
const requestedPython = process.env.DSH_DATA_ANALYSIS_PYTHON
const defaultPythonExecutable = path.join(
  resolveDshHome(),
  'dsh-data-analysis',
  'runtimes',
  'marivo',
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
)
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
const runRoot = path.join(workspaceRoot, 'artifacts', 'agent-native-report-primitives-real', runId)
const projectRoot = path.join(runRoot, 'workspace')
const validationPath = path.join(runRoot, 'validation.json')

interface Fixture {
  sessionId: string
  timeSeriesRef: string
  segmentedRef: string
}
interface ObservedMutation {
  sessionId: string
  path: string
  nested: boolean
}
interface BashCall {
  sessionId: string
  command: string
  nested: boolean
}
interface SkillCall {
  sessionId: string
  name: string
}

const mutations: ObservedMutation[] = []
const bashCalls: BashCall[] = []
const skillCalls: SkillCall[] = []

function errorRecord(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) }
}

async function writeValidation(value: unknown): Promise<void> {
  await mkdir(runRoot, { recursive: true })
  await writeFile(validationPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(validationPath, 0o600)
}

async function createFixture(pythonExecutable: string): Promise<Fixture> {
  await mkdir(path.join(projectRoot, 'models', 'datasources'), { recursive: true })
  await mkdir(path.join(projectRoot, 'models', 'semantic', 'sales'), { recursive: true })
  await mkdir(path.join(projectRoot, 'vendor'), { recursive: true })
  await writeFile(
    path.join(projectRoot, 'marivo.toml'),
    '[project]\nname = "agent-native-report-real"\n',
  )
  await writeFile(
    path.join(projectRoot, 'models', 'datasources', 'warehouse.py'),
    "import marivo.datasource as md\nmd.duckdb(name='warehouse', path=':memory:')\n",
  )
  await writeFile(path.join(projectRoot, 'models', 'semantic', 'sales', '__init__.py'), '')
  await writeFile(
    path.join(projectRoot, 'models', 'semantic', 'sales', '_domain.py'),
    "import marivo.semantic as ms\nms.domain(name='sales', owner='DSH validation')\n",
  )
  await writeFile(
    path.join(projectRoot, 'models', 'semantic', 'sales', 'datasets.py'),
    [
      'import marivo.datasource as md',
      'import marivo.semantic as ms',
      "orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))",
      "@ms.time_dimension(entity=orders, granularity='day', is_default=True)",
      'def order_date(orders):',
      "    return orders.created_at.cast('date')",
      '@ms.dimension(entity=orders)',
      'def platform(orders):',
      '    return orders.platform',
      "@ms.metric(entities=[orders], additivity='additive', name='revenue')",
      'def revenue(orders):',
      '    return orders.amount.sum()',
      '',
    ].join('\n'),
  )
  await writeFile(
    path.join(projectRoot, 'vendor', 'mini-charts.js'),
    'export function bars(root, rows){const max=Math.max(...rows.map(r=>r.value));root.innerHTML=rows.map(r=>"<button class=\'bar\' data-value=\'"+r.value+"\' style=\'--p:"+(r.value/max)+"\'>"+r.label+": "+r.value+"</button>").join(\'\')}\n',
  )
  const program = String.raw`
import json, os, sys, ibis
import marivo.analysis as mv
root = os.path.abspath(sys.argv[1])
os.chdir(root)
connection = ibis.duckdb.connect(":memory:")
connection.raw_sql("CREATE TABLE orders (order_id INTEGER, created_at DATE, amount DOUBLE, platform VARCHAR)")
connection.raw_sql("INSERT INTO orders VALUES (1, DATE '2026-08-20', 90.0, 'android'), (2, DATE '2026-08-20', 30.0, 'ios'), (3, DATE '2026-08-21', 110.0, 'android'), (4, DATE '2026-08-21', 35.0, 'ios'), (5, DATE '2026-08-22', 120.0, 'android'), (6, DATE '2026-08-22', 40.0, 'ios')")
session = mv.session.get_or_create(name="agent-native-report-real", backends={"warehouse": lambda: connection}, use_datasources=False)
metric = session.catalog.metrics.get("sales.revenue")
platform = session.catalog.dimensions.get("sales.orders.platform")
series = session.observe(metrics=metric, time_scope=mv.time_scope(start="2026-08-20", end="2026-08-23"), grain=mv.grain("day"), analysis_purpose="report time series")
segmented = session.observe(metrics=metric, dimensions=[platform], analysis_purpose="report segments")
assert session.revalidate(series.ref).status == "admissible"
assert session.revalidate(segmented.ref).status == "admissible"
assert session.graph(max_nodes=100).truncated is False
print(json.dumps({"sessionId": session.id, "timeSeriesRef": series.ref, "segmentedRef": segmented.ref}, ensure_ascii=False))
`.trim()
  const result = await new FixedSubprocessPolicy(projectRoot).run({
    executable: pythonExecutable,
    args: ['-I', '-c', program, projectRoot],
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, 0, result.stderr.toString('utf8'))
  return JSON.parse(result.stdout.toString('utf8')) as Fixture
}

function publicReadProgram(fixture: Fixture, artifactRef: string): string {
  return [
    'import json, marivo.analysis as mv',
    `session = mv.session.resume(${JSON.stringify(fixture.sessionId)}, use_datasources=False)`,
    `artifact = session.artifact(${JSON.stringify(artifactRef)})`,
    `revalidation = session.revalidate(${JSON.stringify(artifactRef)})`,
    `graph = session.graph(artifact_ref=${JSON.stringify(artifactRef)}, direction="ancestors", max_nodes=100)`,
    'runs = session.runs(limit=20)',
    'run = session.get_run(runs.items[0].run_id)',
    'summary = artifact.show()',
    'contract = artifact.contract()',
    'findings = artifact.findings(limit=20)',
    'rows = artifact.to_pandas().to_dict(orient="records")',
    'print(json.dumps({"ref": artifact.ref, "kind": artifact.kind, "summary": str(summary), "rows": rows, "quality": str(artifact.quality_summary), "lineage": str(artifact.lineage), "issues": len(contract.issues), "finding_count": len(findings.items), "revalidation": revalidation.status, "graph_truncated": graph.truncated, "graph_runs": len(graph.runs), "run_count": len(runs.items), "run_id": run.run_id}, default=str, ensure_ascii=False))',
  ].join('\n')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function finalText(agent: Agent): string {
  const event = agent.session.events.filter((item) => item.type === 'assistant/message').at(-1)
  if (event?.type !== 'assistant/message') return ''
  return event.data.message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
}

async function validateBundle(
  entryPath: string,
  shape: 'static' | 'dashboard' | 'audit' | 'large',
) {
  const html = await readFile(entryPath, 'utf8')
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /<html[^>]+lang=/i)
  assert.match(html, /<title>[^<]+<\/title>/i)
  assert.match(html, /<main[\s>]/i)
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i)
  assert.doesNotMatch(html, /DSH_[A-Z0-9_]+|password|api[_-]?key/i)
  const root = path.dirname(entryPath)
  const refs = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/gi)].map((match) => match[1]!)
  for (const ref of refs) {
    assert.equal(path.isAbsolute(ref), false)
    assert.equal(ref.startsWith('data:'), false)
    const resourcePath = path.resolve(root, ref)
    assert.ok((await stat(resourcePath)).isFile(), `missing report resource ${ref}`)
  }
  const textResources = await readBundleTextResources(root)
  const auditableText = [html, ...textResources].join('\n')
  assert.match(auditableText, /@media\s+print/i)
  assert.doesNotMatch(auditableText, /(?:@import|url\(|fetch\(|import\s*)[^\n;]*https?:\/\//i)
  assert.doesNotMatch(auditableText, /DSH_[A-Z0-9_]+|password|api[_-]?key/i)
  if (shape === 'static') assert.match(auditableText, /<svg[\s>]/i)
  if (shape === 'static') {
    const visibleText = html.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ')
    assert.match(visibleText, /2026-08-20.{0,80}120(?:\.0)?/)
    assert.match(visibleText, /2026-08-21.{0,80}145(?:\.0)?/)
    assert.match(visibleText, /2026-08-22.{0,80}160(?:\.0)?/)
    assert.doesNotMatch(visibleText, /2026-08-20[\s（(·,:：–—-]{0,12}(?:周|星期)[一二三五六日天]/)
    assert.doesNotMatch(visibleText, /2026-08-21[\s（(·,:：–—-]{0,12}(?:周|星期)[一二三四六日天]/)
    assert.doesNotMatch(visibleText, /2026-08-22[\s（(·,:：–—-]{0,12}(?:周|星期)[一二三四五日天]/)
  }
  if (shape === 'dashboard') {
    assert.match(html, /<script[^>]+type=["']module["']/i)
    assert.match(auditableText, /<button[\s>]/i)
    assert.match(auditableText, /mini-charts\.js/)
  }
  if (shape === 'audit') {
    assert.match(html, /<table[\s>]/i)
    assert.match(html, /timeline/i)
  }
  return { entryPath, bytes: Buffer.byteLength(html), refs }
}

async function readBundleTextResources(root: string): Promise<string[]> {
  const resources: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      resources.push(...(await readBundleTextResources(entryPath)))
      continue
    }
    if (entry.isFile() && /\.(?:css|js|svg)$/i.test(entry.name)) {
      resources.push(await readFile(entryPath, 'utf8'))
    }
  }
  return resources
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function toolErrorCode(result: {
  isError: boolean
  error?: { info?: { code?: unknown } }
}): string | undefined {
  if (!result.isError) return undefined
  const code = result.error?.info?.code
  return typeof code === 'string' ? code : undefined
}

async function expectBundleFailure(
  entryPath: string,
  shape: 'static' | 'dashboard' | 'audit' | 'large',
): Promise<{ name: string; message: string }> {
  try {
    await validateBundle(entryPath, shape)
  } catch (error) {
    return errorRecord(error)
  }
  assert.fail(`expected invalid bundle ${entryPath} to be rejected`)
}

async function runFailureMatrix(
  ctx: Context,
  agent: Agent,
  pythonExecutable: string,
): Promise<Record<string, Record<string, unknown>>> {
  const failureRoot = path.join(projectRoot, 'failure-matrix')
  await mkdir(failureRoot, { recursive: true })
  let toolSequence = 0
  const executeFileTool = (
    name: 'read' | 'write',
    arguments_: Record<string, unknown>,
    signal = new AbortController().signal,
  ) =>
    ctx.tools.execute({
      signal,
      callId: CallId(`agent-native-failure-${runId}-${++toolSequence}`),
      name,
      arguments: arguments_,
      agent,
    })

  const largeRoot = path.join(failureRoot, 'large-data')
  const largeDataPath = path.join(largeRoot, 'data', 'rows.csv')
  const largeEntryPath = path.join(largeRoot, 'index.html')
  await mkdir(path.dirname(largeDataPath), { recursive: true })
  const largeRows = 100_000
  const largeDataProgram = [
    'import os, sys',
    'target = sys.argv[1]',
    `rows = ${largeRows}`,
    "with open(target, 'w', encoding='utf-8', newline='') as output:",
    "    output.write('row,value\\n')",
    '    for row in range(rows):',
    "        output.write(f'{row},{row % 97}\\n')",
    'print(os.path.getsize(target))',
  ].join('\n')
  const largeDataResult = await new FixedSubprocessPolicy(projectRoot).run({
    executable: pythonExecutable,
    args: ['-I', '-c', largeDataProgram, largeDataPath],
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 65_536, stderrMaxBytes: 65_536 },
  })
  assert.equal(largeDataResult.exitCode, 0, largeDataResult.stderr.toString('utf8'))
  await writeFile(
    largeEntryPath,
    [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head><meta charset="utf-8"><title>大数据摘要</title><style>@media print { @page { size: A4; margin: 12mm; } }</style></head>',
      '<body><main><h1>100,000 行本地数据摘要</h1><p>页面只呈现有界摘要，完整数据作为本地资源交付。</p><a href="data/rows.csv">下载数据</a></main></body>',
      '</html>',
    ].join('\n'),
  )
  const largeBundle = await validateBundle(largeEntryPath, 'large')
  const largePreview = await executeFileTool('read', { file_path: largeDataPath })
  assert.equal(largePreview.isError, false, JSON.stringify(largePreview.content))
  if (largePreview.isError) throw new Error('unreachable large preview failure')
  const largeReadValue = largePreview.value as { lines: unknown[]; totalLines: number }
  assert.equal(largeReadValue.totalLines, largeRows + 1)
  assert.ok(largeReadValue.lines.length < largeReadValue.totalLines)
  assert.ok(Buffer.byteLength(JSON.stringify(largePreview.content)) < 64_000)
  const largeDataBytes = (await stat(largeDataPath)).size
  assert.ok(largeDataBytes > 500_000)

  const cancellationPath = path.join(failureRoot, 'cancelled', 'index.html')
  await mkdir(path.dirname(cancellationPath), { recursive: true })
  const cancellation = new AbortController()
  cancellation.abort(new Error('acceptance cancellation before write'))
  const cancelledWrite = await executeFileTool(
    'write',
    {
      file_path: cancellationPath,
      content:
        '<!doctype html><html lang="zh-CN"><title>cancelled</title><main>cancelled</main></html>',
    },
    cancellation.signal,
  )
  assert.equal(cancelledWrite.isError, true)
  assert.equal(toolErrorCode(cancelledWrite), 'ABORTED_BEFORE_DISPATCH')
  assert.equal(await pathExists(cancellationPath), false)

  const concurrentRoot = path.join(failureRoot, 'concurrent')
  const parallelPath = path.join(concurrentRoot, 'parallel.txt')
  await mkdir(concurrentRoot, { recursive: true })
  const parallelWrites = await Promise.all([
    executeFileTool('write', { file_path: parallelPath, content: 'parallel writer A\n' }),
    executeFileTool('write', { file_path: parallelPath, content: 'parallel writer B\n' }),
  ])
  assert.ok(parallelWrites.some((result) => !result.isError))
  const parallelContent = await readFile(parallelPath, 'utf8')
  assert.ok(['parallel writer A\n', 'parallel writer B\n'].includes(parallelContent))
  const stalePath = path.join(concurrentRoot, 'stale.txt')
  const initialWrite = await executeFileTool('write', {
    file_path: stalePath,
    content: 'initial observed version\n',
  })
  assert.equal(initialWrite.isError, false, JSON.stringify(initialWrite.content))
  const observedRead = await executeFileTool('read', { file_path: stalePath })
  assert.equal(observedRead.isError, false, JSON.stringify(observedRead.content))
  await writeFile(stalePath, 'external concurrent mutation\n')
  const staleWrite = await executeFileTool('write', {
    file_path: stalePath,
    content: 'must not clobber external mutation\n',
  })
  assert.equal(staleWrite.isError, true)
  assert.equal(toolErrorCode(staleWrite), 'FS_STALE_VERSION')
  const refreshedRead = await executeFileTool('read', { file_path: stalePath })
  assert.equal(refreshedRead.isError, false, JSON.stringify(refreshedRead.content))
  const recoveredWrite = await executeFileTool('write', {
    file_path: stalePath,
    content: 'recovered after re-read\n',
  })
  assert.equal(recoveredWrite.isError, false, JSON.stringify(recoveredWrite.content))
  assert.equal(await readFile(stalePath, 'utf8'), 'recovered after re-read\n')

  const partialEntryPath = path.join(failureRoot, 'partial-directory', 'index.html')
  await mkdir(path.join(path.dirname(partialEntryPath), 'assets'), { recursive: true })
  await writeFile(
    path.join(path.dirname(partialEntryPath), 'assets', 'style.css'),
    '@media print {}\n',
  )
  const partialFailure = await expectBundleFailure(partialEntryPath, 'large')
  assert.equal(await pathExists(partialEntryPath), false)

  const damagedEntryPath = path.join(failureRoot, 'damaged-resource', 'index.html')
  await mkdir(path.dirname(damagedEntryPath), { recursive: true })
  await writeFile(
    damagedEntryPath,
    [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head><title>损坏资源</title><link rel="stylesheet" href="assets/missing.css"></head>',
      '<body><main>资源不存在</main></body>',
      '</html>',
    ].join('\n'),
  )
  const damagedFailure = await expectBundleFailure(damagedEntryPath, 'large')
  assert.match(damagedFailure.message, /assets\/missing\.css/)

  const diskRoot = path.join(failureRoot, 'disk-full')
  const diskPayloadPath = path.join(diskRoot, 'oversized.bin')
  const diskEntryPath = path.join(diskRoot, 'index.html')
  await mkdir(diskRoot, { recursive: true })
  const diskFullProgram = [
    'import json, os, resource, sys',
    'target = sys.argv[1]',
    'resource.setrlimit(resource.RLIMIT_FSIZE, (1024, 1024))',
    'try:',
    "    with open(target, 'wb') as output:",
    "        output.write(b'x' * 8192)",
    '        output.flush()',
    '        os.fsync(output.fileno())',
    'except OSError as error:',
    "    print(json.dumps({'errno': error.errno, 'message': str(error)}))",
    '    raise SystemExit(73)',
    "raise AssertionError('filesystem quota did not reject oversized write')",
  ].join('\n')
  const diskFull = await new FixedSubprocessPolicy(projectRoot).run({
    executable: pythonExecutable,
    args: ['-I', '-c', diskFullProgram, diskPayloadPath],
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 65_536, stderrMaxBytes: 65_536 },
  })
  assert.notEqual(diskFull.exitCode, 0, 'isolated filesystem quota unexpectedly accepted the write')
  const diskFailure = await expectBundleFailure(diskEntryPath, 'large')
  assert.equal(await pathExists(diskEntryPath), false)

  return {
    largeData: {
      rows: largeRows,
      bytes: largeDataBytes,
      previewLines: largeReadValue.lines.length,
      totalLines: largeReadValue.totalLines,
      bundle: largeBundle,
    },
    cancellation: {
      code: toolErrorCode(cancelledWrite),
      entryExists: await pathExists(cancellationPath),
    },
    concurrentFileMutation: {
      parallelOutcomes: parallelWrites.map((result) => ({
        isError: result.isError,
        code: toolErrorCode(result),
      })),
      staleWriteCode: toolErrorCode(staleWrite),
      recoveredContent: await readFile(stalePath, 'utf8'),
    },
    partialDirectory: {
      entryExists: await pathExists(partialEntryPath),
      failure: partialFailure,
    },
    damagedResource: {
      failure: damagedFailure,
    },
    diskFull: {
      exitCode: diskFull.exitCode,
      entryExists: await pathExists(diskEntryPath),
      failure: diskFailure,
    },
  }
}

async function main(): Promise<void> {
  const sharedRuntime =
    requestedPython === undefined ? await ensureSharedMarivoRuntime() : undefined
  const pythonExecutable = requestedPython ?? sharedRuntime!.pythonExecutable
  const probe = await bindMarivoEnvironment({
    projectRoot: workspaceRoot,
    pythonExecutable,
  })
  if (probe.binding.marivoVersion !== '0.5.1') {
    throw new Error(
      `real acceptance requires the formal Marivo 0.5.1 package; ${pythonExecutable} reports ${probe.binding.marivoVersion}`,
    )
  }
  const fixture = await createFixture(probe.binding.pythonExecutable)
  const environment = await bindMarivoEnvironment({
    projectRoot,
    pythonExecutable: probe.binding.pythonExecutable,
  })

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalCredentialProvider, { watch: false })
  await ctx.plugin(DeepSeek, {
    thinking: 'disabled',
    reasoningEffort: 'off',
    maxTokens: 8_192,
    streamIdleTimeoutMs: 180_000,
    models: [{ id: model, contextWindow: 128_000, maxTokens: 8_192 }],
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SkillRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(TestShellEnv)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalBashExecutor, {
    cwd: projectRoot,
    timeoutMs: 120_000,
    maxTimeoutMs: 180_000,
  })
  await ctx.plugin(ToolBash, { enableRunInBackground: false })
  await ctx.plugin(WorkerThreadCodeRuntime, { computeMs: 30_000, maxWallMs: 180_000 })
  await ctx.plugin(LocalFileSystem, { cwd: projectRoot })
  await ctx.plugin(FsObservationPolicy)
  await ctx.plugin(ToolFileSystem, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })

  ctx.tools.register(
    defineTool({
      name: 'skill',
      description: 'Load one exact available skill.',
      parameters: { name: { type: 'string', required: true } },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute({ name }, exec) {
        skillCalls.push({ sessionId: String(exec.agent?.session.id), name })
        const skill = await ctx.skills.get(name, {
          cwd: exec.agent?.session.header.cwd ?? projectRoot,
          scope: exec.agent,
          signal: exec.signal,
        })
        if (skill === undefined) throw new Error(`unknown skill ${String(name)}`)
        return { name: skill.name, provider: skill.provider, content: skill.content }
      },
    }),
  )
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name === 'bash') {
      const value = exec.arguments as { command?: unknown }
      if (typeof value.command === 'string') {
        bashCalls.push({
          sessionId: String(exec.agent?.session.id),
          command: value.command,
          nested: exec.parent !== undefined,
        })
      }
    }
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== 'write' || result.isError) return
    const value = result.value as { path?: unknown }
    if (typeof value.path !== 'string') return
    mutations.push({
      sessionId: String(exec.agent?.session.id),
      path: value.path,
      nested: exec.parent !== undefined,
    })
  })
  const plugin = await ctx.plugin(
    { name: 'dsh-data-analysis-agent-native-report-real', inject, apply },
    {
      pythonExecutable: environment.binding.pythonExecutable,
      runtimeRoot: path.join(runRoot, 'runtime'),
    },
  )

  const specs = [
    {
      id: 'static-narrative',
      mode: 'native' as const,
      shape: 'static' as const,
      ref: fixture.timeSeriesRef,
      requirement:
        'Create a static Chinese long-form narrative with a custom SVG chart. If you show weekdays, compute them: 2026-08-20 is Thursday, 2026-08-21 is Friday, and 2026-08-22 is Saturday.',
    },
    {
      id: 'interactive-dashboard',
      mode: 'code' as const,
      shape: 'dashboard' as const,
      ref: fixture.segmentedRef,
      requirement:
        'Create an interactive Chinese dashboard. Read vendor/mini-charts.js and copy it to the bundle as assets/mini-charts.js, then use it from a local type=module script with keyboard-operable buttons.',
    },
    {
      id: 'print-audit',
      mode: 'both' as const,
      shape: 'audit' as const,
      ref: fixture.segmentedRef,
      requirement:
        'Create a print-first Chinese audit report with a table and a visible Session timeline. In both mode, call write directly rather than through run_code.',
    },
  ]
  const journeys: Array<Record<string, unknown>> = []
  for (const spec of specs) {
    const agent = ctx.agentLoop.create(
      SessionId(`agent-native-report-${spec.id}-${runId}`),
      { provider: 'deepseek-official', model, maxTokens: 8_192 },
      { cwd: projectRoot },
    )
    const releasePresentation = agent.ctx.tools.presentAs(spec.mode)
    const entryPath = path.join(projectRoot, 'reports', `${spec.id}-${runId}`, 'index.html')
    const queryPath = path.join(
      projectRoot,
      '.marivo',
      'analysis',
      'sessions',
      fixture.sessionId,
      'scripts',
      `90_report_${spec.id.replaceAll('-', '_')}.py`,
    )
    await mkdir(path.dirname(queryPath), { recursive: true })
    const program = publicReadProgram(fixture, spec.ref)
    const command = `${shellQuote(environment.binding.pythonExecutable)} -I ${shellQuote(queryPath)}`
    agent.followup(
      createUserMessage({
        source: { kind: 'user' },
        content: [
          {
            type: 'text',
            text: [
              'Load marivo-analysis and dsh-data-analysis-report, then create the explicitly requested HTML report.',
              `First use the file Tool to write this exact public-API program to ${queryPath}:\n${program}`,
              `Then call bash with this exact command and workdir ${projectRoot}: ${command}`,
              spec.requirement,
              'Use only relative local resources, include @media print, create assets before the entry, and write index.html last.',
              `The exact final entry must be ${entryPath}.`,
              `End with AGENT_NATIVE_${spec.id.toUpperCase().replaceAll('-', '_')}_OK and the exact entry path.`,
            ].join('\n'),
          },
        ],
      }),
    )
    await agent.whenIdle()
    const text = finalText(agent)
    assert.match(text, new RegExp(`AGENT_NATIVE_${spec.id.toUpperCase().replaceAll('-', '_')}_OK`))
    assert.ok(text.includes(entryPath))
    const bundle = await validateBundle(entryPath, spec.shape)
    const sessionMutations = mutations.filter((item) => item.sessionId === String(agent.session.id))
    const sessionBash = bashCalls.filter((item) => item.sessionId === String(agent.session.id))
    const sessionSkills = skillCalls
      .filter((item) => item.sessionId === String(agent.session.id))
      .map((item) => item.name)
    assert.ok(sessionSkills.includes('marivo-analysis'))
    assert.ok(sessionSkills.includes('dsh-data-analysis-report'))
    const queryBash = sessionBash.filter((item) => item.command === command)
    assert.equal(queryBash.length, 1)
    assert.equal(queryBash[0]!.nested, spec.mode === 'code')
    assert.equal((await readFile(queryPath, 'utf8')).trim(), program)
    for (const required of [
      'session.artifact',
      'session.revalidate',
      'session.graph',
      'session.runs',
      'session.get_run',
      'artifact.show',
      'artifact.contract',
      'artifact.findings',
      'artifact.to_pandas',
      'artifact.quality_summary',
      'artifact.lineage',
    ]) {
      assert.ok(program.includes(required), `missing native read ${required}`)
    }
    const entryMutationIndex = sessionMutations
      .map((mutation) => mutation.path)
      .lastIndexOf(entryPath)
    assert.notEqual(entryMutationIndex, -1)
    const entryMutation = sessionMutations[entryMutationIndex]
    assert.equal(entryMutation?.path, entryPath)
    assert.equal(entryMutation?.nested, spec.mode === 'code')
    const bundleRoot = `${path.dirname(entryPath)}${path.sep}`
    assert.deepEqual(
      sessionMutations
        .slice(entryMutationIndex + 1)
        .filter((mutation) => mutation.path.startsWith(bundleRoot)),
      [],
      'index.html must be the final mutation inside its report bundle',
    )
    journeys.push({
      id: spec.id,
      mode: spec.mode,
      entryPath,
      mutationCount: sessionMutations.length,
      bashCallCount: sessionBash.length,
      entryNested: entryMutation?.nested,
      loadedSkills: sessionSkills,
      bashNested: queryBash[0]!.nested,
      bundle,
    })
    releasePresentation()
  }
  assert.equal(new Set(journeys.map((item) => item.entryPath)).size, 3)
  assert.equal(ctx.tools.get('marivo_report_render'), undefined)
  assert.equal(ctx.tools.get('marivo_test'), undefined)
  assert.equal(ctx.tools.get('marivo_session_dag'), undefined)
  const failureAgent = ctx.agentLoop.create(
    SessionId(`agent-native-report-failure-matrix-${runId}`),
    { provider: 'deepseek-official', model, maxTokens: 8_192 },
    { cwd: projectRoot },
  )
  const releaseFailurePresentation = failureAgent.ctx.tools.presentAs('native')
  let failureMatrix: Record<string, Record<string, unknown>>
  try {
    failureMatrix = await runFailureMatrix(ctx, failureAgent, environment.binding.pythonExecutable)
  } finally {
    releaseFailurePresentation()
  }
  await plugin.dispose()
  await writeValidation({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'ok',
    model: { provider: 'deepseek-official', id: model, thinking: 'disabled' },
    environment: environment.binding,
    fixture,
    journeys,
    failureMatrix,
    externalGates: {
      browserAndHost: 'requires separately recorded local Web/Host acceptance',
      remoteHeadless:
        'requires separately recorded path-only headless acceptance; no remote Host is present here',
    },
  })
  process.stdout.write(`${validationPath}\n`)
}

try {
  await main()
} catch (error) {
  await writeValidation({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'failed',
    environment: { requestedPython: requestedPython ?? defaultPythonExecutable },
    failure: errorRecord(error),
  })
  process.stderr.write(`${validationPath}\n`)
  throw error
}
