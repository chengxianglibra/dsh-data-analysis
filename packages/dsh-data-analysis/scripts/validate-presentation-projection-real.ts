import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  ensureSharedMarivoRuntime,
  type MarivoCheckedRunner,
  type MarivoCheckedRunRequest,
  MarivoWorkspaceEnvironmentManager,
} from '../src/environment/index.ts'
import {
  PresentationContractError,
  type PresentationDraft,
  type SourceRef,
} from '../src/presentation/contracts/index.ts'
import { MarivoPresentationProjection } from '../src/presentation/projection/index.ts'

// Read-only administrator admission of the selected installation. This validator
// never installs packages, switches interpreter or changes an existing profile.
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    resolveDshHome(),
    'dsh-data-analysis',
    'runtimes',
    'marivo',
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )
const runRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s2-real-')))
const workspaceRoot = path.join(runRoot, 'workspace')
const scriptsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'presentation-s0')
await mkdir(path.join(workspaceRoot, 'models', 'datasources'), { recursive: true })
await mkdir(path.join(workspaceRoot, 'models', 'semantic', 'sales'), { recursive: true })
const workspaceFiles = {
  'marivo.toml': '[project]\nname = "presentation-s2-runtime"\n',
  'models/datasources/warehouse.py':
    "import marivo.datasource as md\nmd.duckdb(name='warehouse', path=':memory:')\n",
  'models/semantic/sales/__init__.py': '',
  'models/semantic/sales/_domain.py':
    "import marivo.semantic as ms\nms.domain(name='sales', owner='S2 validation')\n",
  'models/semantic/sales/datasets.py': [
    'import marivo.datasource as md',
    'import marivo.semantic as ms',
    "orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))",
    "region = ms.dimension_column(name='region', entity=orders, column='region')",
    "@ms.metric(entities=[orders], additivity='additive', name='revenue', unit='USD')",
    'def revenue(orders):',
    '    return orders.amount.sum()',
    "@ms.metric(entities=[orders], additivity='non_additive', name='account_id')",
    'def account_id(orders):',
    '    return orders.account_id.max()',
    "precise_orders = ms.entity(name='precise_orders', datasource=ms.ref.datasource('warehouse'), source=md.table('precise_orders'))",
    "precise_region = ms.dimension_column(name='region', entity=precise_orders, column='region')",
    "@ms.metric(entities=[precise_orders], additivity='additive', name='precision_revenue', unit='USD')",
    'def precision_revenue(precise_orders):',
    '    return precise_orders.amount.sum()',
    "@ms.metric(entities=[precise_orders], additivity='non_additive', name='precision_account_id')",
    'def precision_account_id(precise_orders):',
    '    return precise_orders.account_id.max()',
    '',
  ].join('\n'),
}
for (const [relative, content] of Object.entries(workspaceFiles)) {
  await writeFile(path.join(workspaceRoot, relative), content)
}
const runtime = await ensureSharedMarivoRuntime({
  runtimeRoot: path.join(runRoot, 'runtime-marker'),
  pythonExecutable,
})
const manager = new MarivoWorkspaceEnvironmentManager(runtime)
const environment = await manager.resolve(workspaceRoot)
const generation = await environment.runChecked({
  program: await readFile(path.join(scriptsRoot, 'runtime-generate.py'), 'utf8'),
  limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
})
assert.equal(generation.exitCode, 0, generation.stderr.toString('utf8'))
const generated = JSON.parse(generation.stdout.toString('utf8'))
const ref = (value: SourceRef): SourceRef => ({
  sessionId: value.sessionId,
  artifactRef: value.artifactRef,
  ...(value.findingId ? { findingId: value.findingId } : {}),
})
const sources = [
  { id: 'revenue', ref: ref(generated.primary) },
  { id: 'account', ref: ref(generated.secondary) },
  {
    id: 'missing',
    ref: { sessionId: generated.primary.sessionId, artifactRef: 'art_000000000000000000000000' },
  },
]
const readAudits: {
  pid: number
  observe: number
  revalidate: number
  credentialResolve: number
}[] = []
const auditPrelude = String.raw`
import atexit
import json
import os
import sys
_s2_calls = {"pid": os.getpid(), "observe": 0, "revalidate": 0, "credentialResolve": 0}
def _s2_profile(frame, event, argument):
    if event != "call":
        return
    module = str(frame.f_globals.get("__name__", ""))
    name = frame.f_code.co_name
    if module.startswith("marivo.") and name in ("observe", "revalidate"):
        _s2_calls[name] += 1
        raise AssertionError("Presentation restored read attempted execution")
    if name == "resolve" and type(frame.f_locals.get("self")).__name__ == "DenyCredentials":
        _s2_calls["credentialResolve"] += 1
        raise AssertionError("Presentation restored read attempted credentials")
atexit.register(lambda: print("S2_AUDIT:" + json.dumps(_s2_calls), file=sys.stderr))
sys.setprofile(_s2_profile)
`
const runner: MarivoCheckedRunner = {
  binding: environment.binding,
  get status() {
    return environment.status
  },
  async runChecked(request: MarivoCheckedRunRequest) {
    const result = await environment.runChecked({
      ...request,
      program: auditPrelude + '\n' + request.program,
    })
    const line = result.stderr
      .toString('utf8')
      .split('\n')
      .find((line) => line.startsWith('S2_AUDIT:'))
    assert.ok(line, 'Actual reader did not emit instrumentation evidence')
    const audit = JSON.parse(line.slice('S2_AUDIT:'.length))
    assert.notEqual(audit.pid, generated.generationPid)
    assert.deepEqual(
      {
        observe: audit.observe,
        revalidate: audit.revalidate,
        credentialResolve: audit.credentialResolve,
      },
      { observe: 0, revalidate: 0, credentialResolve: 0 },
    )
    readAudits.push(audit)
    return result
  },
}
const projection = new MarivoPresentationProjection(runner)
const base = { workspaceId: 's2-isolated-validation', generatedAt: new Date().toISOString() }
const artifactDraft: PresentationDraft = {
  schemaVersion: 1,
  title: 'S2 real persisted Artifacts',
  sources: sources.slice(0, 2),
  datasets: [
    {
      id: 'revenue',
      kind: 'artifact',
      sourceId: 'revenue',
      rowLimit: 3,
      columns: ['region', 'revenue'],
    },
    {
      id: 'account',
      kind: 'artifact',
      sourceId: 'account',
      rowLimit: 4,
      columns: ['region', 'account_id'],
    },
  ],
  blocks: [
    { id: 'revenue', kind: 'table', datasetId: 'revenue' },
    { id: 'account', kind: 'table', datasetId: 'account' },
  ],
}
const artifact = await projection.project(artifactDraft, {
  ...base,
  reportId: 'report',
  buildId: 'real-artifact',
})
assert.equal(artifact.datasets[0]!.data.rowCount, 4)
assert.equal(artifact.datasets[0]!.data.truncated, true)
// Preserve Marivo row order. Compare keyed values without sorting the projection.
const fullRevenue = await projection.project(
  {
    ...artifactDraft,
    datasets: [{ id: 'revenue', kind: 'artifact', sourceId: 'revenue', rowLimit: 4 }],
    blocks: [{ id: 'table', kind: 'table', datasetId: 'revenue' }],
  },
  { ...base, reportId: 'report', buildId: 'real-full-artifact' },
)
assert.deepEqual(Object.fromEntries(fullRevenue.datasets[0]!.data.rows), {
  A: 12.5,
  B: 8.25,
  C: null,
  D: 4,
})
assert.deepEqual(Object.fromEntries(artifact.datasets[1]!.data.rows), {
  A: '9007199254740993',
  B: '9007199254740995',
  C: '9007199254740997',
  D: '9007199254740999',
})
assert.ok(
  artifact.sources.every(
    (source) =>
      source.status === 'available' && source.facts.some((fact) => fact.label === '选择的 Finding'),
  ),
)

const written = await environment.runChecked({
  program: String.raw`
from datetime import date, datetime, timezone
from decimal import Decimal
import dataclasses
import json
import pandas as pd
from dsh_data_analysis_presentation import write_dataset
frame = pd.DataFrame({"decimal": [Decimal("12345678901234.5678"), Decimal("0.1000"), None], "account": pd.Series([9007199254740993, 9223372036854775807, -9223372036854775808], dtype="int64"), "date": [date(2026, 9, 7), date(2026, 9, 8), None], "datetime": [datetime(2026, 9, 7, 1, 2, 3, 123456, tzinfo=timezone.utc), None, None], "flag": pd.Series([True, None, False], dtype="boolean")})
receipt = write_dataset(frame, "computed.json", row_limit=2)
print(json.dumps(dataclasses.asdict(receipt)))
`,
})
assert.equal(written.exitCode, 0, written.stderr.toString('utf8'))
const writerReceipt = JSON.parse(written.stdout.toString('utf8'))
const computed = await projection.project(
  {
    schemaVersion: 1,
    title: 'S2 computed writer contract example',
    sources,
    datasets: [
      {
        id: 'computed',
        kind: 'computed',
        path: 'computed.json',
        sourceIds: sources.map((source) => source.id),
      },
    ],
    blocks: [{ id: 'table', kind: 'table', datasetId: 'computed' }],
  },
  { ...base, reportId: 'report', buildId: 'real-computed' },
)
assert.deepEqual(
  computed.datasets[0]!.data,
  JSON.parse(await readFile(path.join(workspaceRoot, 'computed.json'), 'utf8')),
)
assert.equal(computed.datasets[0]!.data.rows[0]![0], '12345678901234.5678')
assert.equal(computed.datasets[0]!.data.rows[1]![0], '0.1000')
assert.equal(computed.datasets[0]!.data.rows[0]![1], '9007199254740993')
assert.equal(computed.sources[2]!.status, 'unavailable')
const sourceOnly = await projection.project(
  {
    schemaVersion: 1,
    title: 'S2 source-only',
    sources,
    datasets: [],
    blocks: [{ id: 'sources', kind: 'source', sourceIds: sources.map((source) => source.id) }],
  },
  { ...base, reportId: 'report', buildId: 'real-source-only' },
)
assert.deepEqual(sourceOnly.datasets, [])
const missingFinding = await projection.project(
  {
    schemaVersion: 1,
    title: 'Optional Finding unavailable',
    sources: [
      { id: 'revenue', ref: { ...sources[0]!.ref, findingId: 'fnd_000000000000000000000000' } },
    ],
    datasets: [],
    blocks: [{ id: 'source', kind: 'source', sourceIds: ['revenue'] }],
  },
  { ...base, reportId: 'report', buildId: 'missing-finding' },
)
assert.equal(missingFinding.sources[0]!.status, 'available')
assert.ok(missingFinding.diagnostics.some((item) => item.code === 'finding_unavailable'))
const missingData = {
  ...artifactDraft,
  sources,
  datasets: [{ id: 'revenue', kind: 'artifact' as const, sourceId: 'missing', rowLimit: 3 }],
  blocks: [{ id: 'table', kind: 'table' as const, datasetId: 'revenue' }],
}
await assert.rejects(
  projection.project(missingData, { ...base, reportId: 'report', buildId: 'missing-data' }),
  (error: unknown) =>
    error instanceof PresentationContractError && error.code === 'artifact_data_unavailable',
)
const precisionDraft = {
  ...artifactDraft,
  sources: [{ id: 'precision', ref: ref(generated.precisionProbe) }],
  datasets: [{ id: 'precision', kind: 'artifact' as const, sourceId: 'precision', rowLimit: 4 }],
  blocks: [{ id: 'table', kind: 'table' as const, datasetId: 'precision' }],
}
await assert.rejects(
  projection.project(precisionDraft, { ...base, reportId: 'report', buildId: 'unsafe-float' }),
  (error: unknown) =>
    error instanceof PresentationContractError && error.code === 'numeric_precision',
)
const evidence = {
  status: 'passed',
  runtime,
  binding: environment.binding,
  generated,
  readAudits,
  artifact,
  computed,
  writerReceipt,
  sourceOnly,
  missingFinding,
  directMissingArtifactRejected: true,
  unsafePublicFloatRejected: true,
  inputDatabaseWasProcessLocal: true,
  profileOrCredentialsModified: false,
  upstreamPublicReadMaterializesFullFrame: true,
}
const evidencePath = path.join(runRoot, 'projection-evidence.json')
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n')
process.stdout.write(
  JSON.stringify(
    { status: 'passed', runRoot, evidencePath, readProcesses: readAudits.length },
    null,
    2,
  ) + '\n',
)
