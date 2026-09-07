import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { bindMarivoEnvironment } from '../../src/environment/index.ts'

// Read-only use of the selected installed Runtime: no installer or interpreter fallback.
const pythonExecutable =
  process.env.DSH_DATA_ANALYSIS_PYTHON ??
  path.join(
    resolveDshHome(),
    'dsh-data-analysis',
    'runtimes',
    'marivo',
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )
const runRoot = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s0-runtime-'))
const workspaceRoot = path.join(runRoot, 'workspace')
const scriptsRoot = path.dirname(fileURLToPath(import.meta.url))
await mkdir(path.join(workspaceRoot, 'models', 'datasources'), { recursive: true })
await mkdir(path.join(workspaceRoot, 'models', 'semantic', 'sales'), { recursive: true })
const workspaceFiles = {
  'marivo.toml': '[project]\nname = "presentation-s0-runtime"\n',
  'models/datasources/warehouse.py':
    "import marivo.datasource as md\nmd.duckdb(name='warehouse', path=':memory:')\n",
  'models/semantic/sales/__init__.py': '',
  'models/semantic/sales/_domain.py':
    "import marivo.semantic as ms\nms.domain(name='sales', owner='S0 validation')\n",
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
const environment = await bindMarivoEnvironment({ projectRoot: workspaceRoot, pythonExecutable })
async function run(filename: string, args: string[] = [], expectedExitCode = 0) {
  const result = await environment.runChecked({
    program: await readFile(path.join(scriptsRoot, filename), 'utf8'),
    args,
    environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' },
    limits: { timeoutMs: 120_000, stdoutMaxBytes: 262_144, stderrMaxBytes: 65_536 },
  })
  assert.equal(result.exitCode, expectedExitCode, result.stderr.toString('utf8'))
  return JSON.parse((expectedExitCode === 0 ? result.stdout : result.stderr).toString('utf8'))
}
const generated = await run('runtime-generate.py')
await writeFile(path.join(runRoot, 'generated.json'), `${JSON.stringify(generated, null, 2)}\n`)
// The input database died with the first process. Resume still reads valid Workspace
// semantic/datasource declarations; use_datasources=False prevents their connections.
const restored = await run('runtime-read.py', [JSON.stringify(generated.primary), '3'])
const secondary = await run('runtime-read.py', [JSON.stringify(generated.secondary), '3'])
const precisionProbe = await run('runtime-read.py', [JSON.stringify(generated.precisionProbe), '4'])
const unavailable = await run('runtime-read.py', [
  JSON.stringify({
    sessionId: generated.primary.sessionId,
    artifactRef: 'art_000000000000000000000000',
  }),
  '3',
  'source-only',
])
const unavailableDataset = await run('runtime-read.py', [JSON.stringify(unavailable.ref), '3'], 70)
assert.notEqual(restored.readPid, generated.generationPid)
assert.deepEqual(restored.forbiddenCalls, { observe: 0, revalidate: 0, credentialResolve: 0 })
assert.deepEqual(restored.truncation, { totalRows: 4, writtenRows: 3, omittedRows: 1, rowLimit: 3 })
assert.deepEqual(restored.rows, [
  ['A', 12.5],
  ['B', 8.25],
  ['C', null],
])
assert.deepEqual(secondary.rows, [
  ['A', '9007199254740993'],
  ['B', '9007199254740995'],
  ['C', '9007199254740997'],
])
for (const read of [secondary, precisionProbe]) {
  assert.notEqual(read.readPid, generated.generationPid)
  assert.deepEqual(read.forbiddenCalls, { observe: 0, revalidate: 0, credentialResolve: 0 })
}
assert.equal(unavailable.status, 'unavailable')
assert.equal(unavailable.exceptionType, 'ArtifactNotFoundError')
assert.deepEqual(unavailable.forbiddenCalls, { observe: 0, revalidate: 0, credentialResolve: 0 })
assert.equal(unavailableDataset.status, 'error')
assert.equal(unavailableDataset.exceptionType, 'ArtifactNotFoundError')
assert.deepEqual(unavailableDataset.forbiddenCalls, {
  observe: 0,
  revalidate: 0,
  credentialResolve: 0,
})
assert.deepEqual(precisionProbe.rows[0], ['A', 12345678901234.568, 9007199254740992])
const evidence = {
  status: 'passed',
  binding: environment.binding,
  generated,
  restored,
  secondary,
  precisionProbe,
  unavailable,
  unavailableDataset,
  workspaceDefinitionsRequired: true,
  freshProcessRead: true,
  inputDatabaseWasProcessLocal: true,
  profileOrCredentialsModified: false,
}
await writeFile(
  path.join(runRoot, 'runtime-evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
)
process.stdout.write(
  `${JSON.stringify({ status: evidence.status, runRoot, evidencePath: path.join(runRoot, 'runtime-evidence.json'), restored }, null, 2)}\n`,
)
