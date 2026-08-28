import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { bindMarivoEnvironment, FixedSubprocessPolicy } from '../src/environment/index.ts'
import {
  type MarivoEvidenceCiteValue,
  registerMarivoEvidenceCiteTool,
} from '../src/evidence/index.ts'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(packageRoot, '../..')
const defaultSharedPython = path.join(
  resolveDshHome(),
  'dsh-data-analysis',
  'runtimes',
  'marivo',
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
)
const pythonExecutable = process.env.DSH_DATA_ANALYSIS_PYTHON ?? defaultSharedPython
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
const runRoot = path.join(workspaceRoot, 'artifacts', 'evidence-citations-real', runId)
const fixtureRoot = path.join(runRoot, 'workspace')
const validationPath = path.join(runRoot, 'validation.json')

await mkdir(path.join(fixtureRoot, 'models', 'datasources'), { recursive: true })
await mkdir(path.join(fixtureRoot, 'models', 'semantic', 'sales'), { recursive: true })
await writeFile(
  path.join(fixtureRoot, 'marivo.toml'),
  '[project]\nname = "evidence-citations-real"\n',
)
await writeFile(
  path.join(fixtureRoot, 'models', 'datasources', 'warehouse.py'),
  "import marivo.datasource as md\nmd.duckdb(name='warehouse', path=':memory:')\n",
)
await writeFile(path.join(fixtureRoot, 'models', 'semantic', 'sales', '__init__.py'), '')
await writeFile(
  path.join(fixtureRoot, 'models', 'semantic', 'sales', '_domain.py'),
  "import marivo.semantic as ms\nms.domain(name='sales', owner='DSH validation')\n",
)
await writeFile(
  path.join(fixtureRoot, 'models', 'semantic', 'sales', 'datasets.py'),
  [
    'import marivo.datasource as md',
    'import marivo.semantic as ms',
    "orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))",
    "@ms.metric(entities=[orders], additivity='additive', name='revenue')",
    'def revenue(orders):',
    '    return orders.amount.sum()',
    '',
  ].join('\n'),
)

const fixtureScript = String.raw`
import json
import os
import sys
import ibis
import marivo.analysis as mv

workspace = os.path.abspath(sys.argv[1])
os.chdir(workspace)
connection = ibis.duckdb.connect(":memory:")
connection.raw_sql("CREATE TABLE orders (order_id INTEGER, amount DOUBLE)")
connection.raw_sql("INSERT INTO orders VALUES (1, 12.0), (2, 8.0)")
session = mv.session.get_or_create(
    name="evidence-citations-real",
    backends={"warehouse": lambda: connection},
    use_datasources=False,
)
metric = session.catalog.metrics.get("sales.revenue")
frame = session.observe(metrics=metric)
finding = session.evidence.findings(artifact_ref=frame.ref, limit=20).items[0]
print(json.dumps({
    "sessionId": session.id,
    "findingId": finding.finding_id,
    "artifactId": finding.artifact_id,
    "rendered": {
        "en": finding.render(language="en"),
        "zh": finding.render(language="zh"),
    },
}, ensure_ascii=False, allow_nan=False))
`

const policy = new FixedSubprocessPolicy(fixtureRoot)
const fixtureResult = await policy.run({
  executable: pythonExecutable,
  args: ['-I', '-c', fixtureScript, fixtureRoot],
  limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
})
assert.equal(fixtureResult.exitCode, 0, fixtureResult.stderr.toString('utf8'))
const fixture = JSON.parse(fixtureResult.stdout.toString('utf8')) as {
  sessionId: string
  findingId: string
  artifactId: string
  rendered: { en: string; zh: string }
}

const environment = await bindMarivoEnvironment({ projectRoot: fixtureRoot, pythonExecutable })
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
const session = Session.create(SessionId(`evidence-citations-real-${runId}`))
registerMarivoEvidenceCiteTool(ctx, environment, session)

async function cite(language: 'en' | 'zh'): Promise<MarivoEvidenceCiteValue> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`citation-${language}`),
    name: 'marivo_evidence_cite',
    arguments: { session_id: fixture.sessionId, finding_ids: [fixture.findingId], language },
  })
  assert.equal(result.isError, false, JSON.stringify(result))
  if (result.isError) throw new Error('unreachable')
  return result.value as unknown as MarivoEvidenceCiteValue
}

const chinese = await cite('zh')
const english = await cite('en')
assert.equal(chinese.requested[0]?.handle, 'F1')
assert.equal(english.requested[0]?.handle, 'F1')
assert.equal(chinese.requested[0]?.definition, `[^mv-f1]: ${fixture.rendered.zh}`)
assert.equal(english.requested[0]?.definition, `[^mv-f1]: ${fixture.rendered.en}`)
assert.deepEqual(chinese.registry[0]?.rendered, fixture.rendered)
assert.doesNotMatch(chinese.requested[0]?.definition ?? '', new RegExp(fixture.findingId))
assert.doesNotMatch(chinese.requested[0]?.definition ?? '', new RegExp(fixture.artifactId))

await writeFile(
  validationPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'ok',
      environment: {
        pythonExecutable,
        marivoVersion: environment.binding.marivoVersion,
        packagePath: environment.binding.packagePath,
        credentialValuesRecorded: false,
      },
      result: {
        sessionId: fixture.sessionId,
        findingId: fixture.findingId,
        artifactId: fixture.artifactId,
        handle: chinese.requested[0]?.handle,
        languages: ['zh', 'en'],
      },
    },
    undefined,
    2,
  )}\n`,
)

process.stdout.write(`${validationPath}\n`)
