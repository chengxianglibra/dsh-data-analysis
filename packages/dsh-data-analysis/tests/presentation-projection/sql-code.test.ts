import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test, { type TestContext } from 'node:test'
import { MARIVO_PRESENTATION_READ_PROGRAM } from '../../src/presentation/projection/program.ts'
import { createSemanticWorkspace } from '../semantic-reference-input/workspace.ts'

const bootstrap = String.raw`
import atexit
import contextlib
import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

fixture = json.load(sys.stdin)
audit = {"artifacts": [], "runs": [], "closed": False}
atexit.register(lambda: print(json.dumps(audit), file=sys.stderr))
class SucceededRun(types.SimpleNamespace):
    pass
class Artifact:
    def __init__(self, ref, config):
        self.ref = config.get("ref", ref)
        self.meta = types.SimpleNamespace(kind=config.get("kind", "fixture"), created_at=datetime.now(timezone.utc), content_hash="hash", evidence_status="complete", row_count=0, quality_summary=None, session_id=config.get("session_id", "session"), project_root=config.get("project_root", str(Path.cwd())), produced_by_job=config.get("producer"))
        self.contract_ref = config.get("contract_ref", self.ref)
        self.semantic_inputs = [types.SimpleNamespace(role="metric", semantic_kind=types.SimpleNamespace(value=kind), semantic_path="fixture.value", output_column=None) for kind in config.get("semantic_kinds", [])]
    def contract(self):
        return types.SimpleNamespace(ref=self.contract_ref, semantic_inputs=self.semantic_inputs, issues=[])
class Session:
    id = "session"
    def artifact(self, ref):
        audit["artifacts"].append(ref)
        return Artifact(ref, fixture["artifacts"][ref])
    def get_run(self, run_id):
        audit["runs"].append(run_id)
        config = fixture["runs"][run_id]
        if config.get("error"):
            raise RuntimeError("private-exception-canary")
        cls = SucceededRun if config.get("succeeded", True) else types.SimpleNamespace
        return cls(run_id=config.get("run_id", run_id), output_mode=config.get("output_mode", "produced"), output_artifact_ref=config["output"], input_artifact_refs=config.get("inputs", []), queries=[types.SimpleNamespace(query_id=item.get("id", "query"), sql=item["sql"]) for item in config.get("queries", [])])
    def close(self):
        audit["closed"] = True
def resume(identity, *, use_datasources):
    assert identity == "session" and use_datasources is False
    return Session()
def forbidden(*args, **kwargs):
    raise AssertionError("No query compilation, execution or data read is allowed")
mv = types.ModuleType("marivo.analysis")
mv.session = types.SimpleNamespace(resume=resume)
mv.observe = forbidden
if not fixture.get("old_api"):
    mv.SucceededRun = SucceededRun
md = types.ModuleType("marivo.datasource")
md.credential_scope = lambda *, resolver: contextlib.nullcontext()
kit = types.ModuleType("dsh_data_analysis_presentation._dataset")
kit.encode_dataset = forbidden
sys.modules.update({"marivo": types.ModuleType("marivo"), "marivo.analysis": mv, "marivo.datasource": md, "dsh_data_analysis_presentation": types.ModuleType("dsh_data_analysis_presentation"), "dsh_data_analysis_presentation._dataset": kit})
`

type Fixture = {
  artifacts: Record<string, Record<string, unknown>>
  runs: Record<string, Record<string, unknown>>
  old_api?: boolean
}
function fixture(): Fixture {
  return {
    artifacts: { artifact: { producer: 'producer' } },
    runs: { producer: { output: 'artifact', queries: [{ id: 'query', sql: 'SELECT 1' }] } },
  }
}
const request = {
  sources: [{ id: 'source', ref: { sessionId: 'session', artifactRef: 'artifact' } }],
  datasets: [],
}
async function root(t: TestContext) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'presentation-sql-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
async function readFixture(t: TestContext, value: Fixture, readRequest = request) {
  const result = spawnSync(
    'python3',
    ['-c', `${bootstrap}\n${MARIVO_PRESENTATION_READ_PROGRAM}`, JSON.stringify(readRequest)],
    {
      cwd: await root(t),
      encoding: 'utf8',
      // Large SQL fixtures can exceed Linux's per-argument execve limit.
      input: JSON.stringify(value),
      maxBuffer: 2 * 1024 * 1024,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  const audit = JSON.parse(result.stderr.trim())
  assert.equal(audit.closed, true)
  return { payload, audit, code: payload.sources?.[0]?.code }
}

test('SQL snapshot preserves original execution text, query identities and source availability', async (t) => {
  const value = fixture()
  const sql =
    "SELECT '<script>alert(1)</script>', 'password=literal', '😀'\nFROM orders WHERE token = 'plain-token'"
  value.runs.producer!.queries = [
    { id: 'one', sql },
    { id: 'one', sql },
    { id: 'two', sql },
  ]
  const { payload, audit, code } = await readFixture(t, value)
  assert.equal(payload.sources[0].status, 'available')
  assert.deepEqual(code, {
    snippets: ['one', 'two'].map((queryId) => ({
      language: 'sql',
      text: sql,
      provenance: 'execution',
      runId: 'producer',
      queryId,
      artifactRef: 'artifact',
    })),
    notices: [],
  })
  assert.deepEqual(audit.runs, ['producer'])
})

test('SQL ancestry follows exact producer inputs once and never reads unrelated Runs', async (t) => {
  const value: Fixture = {
    artifacts: { artifact: { producer: 'derived' }, upstream: { producer: 'origin' } },
    runs: {
      derived: { output: 'artifact', inputs: ['upstream', 'upstream'] },
      origin: {
        output: 'upstream',
        inputs: ['artifact'],
        queries: [{ id: 'sql', sql: 'SELECT * FROM orders' }],
      },
      unrelated: { output: 'unrelated', error: true },
    },
  }
  const { code, audit } = await readFixture(t, value)
  assert.deepEqual(code.snippets, [
    {
      language: 'sql',
      text: 'SELECT * FROM orders',
      provenance: 'execution',
      runId: 'origin',
      queryId: 'sql',
      artifactRef: 'upstream',
    },
  ])
  assert.deepEqual(code.notices, [])
  assert.deepEqual(audit.artifacts, ['artifact', 'upstream'])
  assert.deepEqual(audit.runs, ['derived', 'origin'])
})

test('producer mismatch, reused output and incomplete Runs cannot claim SQL provenance', async (t) => {
  for (const change of [
    { run_id: 'other' },
    { output: 'other' },
    { output_mode: 'reused' },
    { succeeded: false },
  ]) {
    const value = fixture()
    Object.assign(value.runs.producer!, change)
    const { payload, code } = await readFixture(t, value)
    assert.equal(payload.sources[0].status, 'available')
    assert.deepEqual(code.snippets, [])
    assert.match(code.notices.join(''), /不匹配/)
  }
})

test('upstream identity and Workspace mismatches block producer reads on that branch', async (t) => {
  for (const change of [
    { ref: 'other' },
    { contract_ref: 'other' },
    { session_id: 'other' },
    { project_root: '/' },
  ]) {
    const value = fixture()
    value.runs.producer = { output: 'artifact', inputs: ['upstream'] }
    value.artifacts.upstream = { producer: 'origin', ...change }
    value.runs.origin = { output: 'upstream', queries: [{ sql: 'SELECT private' }] }
    const { payload, code, audit } = await readFixture(t, value)
    assert.equal(payload.sources[0].status, 'available')
    assert.deepEqual(code.snippets, [])
    assert.match(code.notices.join(''), /身份或 Workspace 不一致/)
    assert.deepEqual(audit.runs, ['producer'])
  }
})

test('missing producer, missing Run, missing API and no SQL are explicit code-only gaps', async (t) => {
  const values: Fixture[] = [
    { ...fixture(), old_api: true },
    { ...fixture(), artifacts: { artifact: {} } },
    { ...fixture(), runs: {} },
    { ...fixture(), runs: { producer: { output: 'artifact', error: true } } },
    { ...fixture(), runs: { producer: { output: 'artifact', queries: [] } } },
  ]
  for (const value of values) {
    const { payload, code } = await readFixture(t, value)
    assert.equal(payload.sources[0].status, 'available')
    assert.deepEqual(code.snippets, [])
    assert.ok(code.notices.length > 0)
    assert.doesNotMatch(JSON.stringify(payload), /private-exception-canary/)
  }
})

test('blank SQL is omitted without making the available source invalid', async (t) => {
  const value = fixture()
  value.runs.producer!.queries = [
    { id: 'empty', sql: '' },
    { id: 'blank', sql: ' \t\r\n' },
    { id: 'sql', sql: '\nSELECT 1\n' },
  ]
  const { payload, code } = await readFixture(t, value)
  assert.equal(payload.sources[0].status, 'available')
  assert.deepEqual(code.snippets, [
    {
      language: 'sql',
      text: '\nSELECT 1\n',
      provenance: 'execution',
      runId: 'producer',
      queryId: 'sql',
      artifactRef: 'artifact',
    },
  ])
  assert.match(code.notices.join(''), /SQL 为空/)
})

test('unavailable source has no code snapshot', async (t) => {
  const { payload } = await readFixture(t, { artifacts: {}, runs: {} })
  assert.equal(payload.sources[0].status, 'unavailable')
  assert.equal(payload.sources[0].code, undefined)
})

test('SQL budget preserves complete text at the limit and explicitly omits oversized records', async (t) => {
  const value = fixture()
  value.runs.producer!.queries = [
    { id: 'maximum', sql: 'x'.repeat(32768) },
    { id: 'oversized', sql: 'x'.repeat(32769) },
    { id: 'astral-maximum', sql: '😀'.repeat(16384) },
    { id: 'astral-oversized', sql: '😀'.repeat(16385) },
  ]
  const { code } = await readFixture(t, value)
  assert.deepEqual(
    code.snippets.map((item: { queryId: string }) => item.queryId),
    ['maximum', 'astral-maximum'],
  )
  assert.match(code.notices.join(''), /32768.*未截断/)
  value.runs.producer!.queries = Array.from({ length: 35 }, (_, i) => ({
    id: `q${i}`,
    sql: `SELECT ${i}`,
  }))
  const bounded = await readFixture(t, value)
  assert.equal(bounded.code.snippets.length, 32)
  assert.match(bounded.code.notices.join(''), /32 条/)
})

test('SQL ancestry budget reads at most 64 upstream Artifacts', async (t) => {
  const value = fixture()
  value.runs.producer = {
    output: 'artifact',
    inputs: Array.from({ length: 70 }, (_, i) => `upstream${i}`),
  }
  for (let i = 0; i < 70; i++) {
    value.artifacts[`upstream${i}`] = { producer: `run${i}` }
    value.runs[`run${i}`] = { output: `upstream${i}` }
  }
  const { code, audit } = await readFixture(t, value)
  assert.equal(audit.artifacts.length, 65)
  assert.equal(audit.runs.length, 65)
  assert.match(code.notices.join(''), /64 个/)
})

test('real persisted Marivo SQL is restored in a fresh process with no analysis execution', async (t) => {
  const python =
    process.env.DSH_DATA_ANALYSIS_TEST_PYTHON ??
    path.join(homedir(), '.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python')
  try {
    await access(python)
  } catch {
    t.skip('Marivo Python missing; set DSH_DATA_ANALYSIS_TEST_PYTHON')
    return
  }
  const directory = await root(t)
  await createSemanticWorkspace(directory, 'sales', 1)
  await writeFile(path.join(directory, 'marivo.toml'), '[project]\nname = "sql-snapshot-test"\n')
  const generated = spawnSync(
    python,
    [
      '-c',
      String.raw`
import json
import ibis
import marivo.analysis as mv
connection = ibis.duckdb.connect(":memory:")
connection.raw_sql("CREATE TABLE orders (region VARCHAR, amount BIGINT)")
connection.raw_sql("INSERT INTO orders VALUES ('A', 12)")
session = mv.session.get_or_create(name="sql-snapshot", backends={"warehouse": lambda: connection}, use_datasources=False)
artifact = session.observe(metrics=session.catalog.metrics.get("sales.revenue"))
run = session.get_run(artifact.meta.produced_by_job)
print(json.dumps({"ref": {"sessionId": session.id, "artifactRef": artifact.ref}, "runId": run.run_id, "queries": [{"queryId": query.query_id, "text": query.sql} for query in run.queries]}))
session.close()
connection.disconnect()
`,
    ],
    { cwd: directory, encoding: 'utf8', timeout: 60_000 },
  )
  assert.equal(generated.status, 0, generated.stderr)
  const source = JSON.parse(generated.stdout)
  assert.ok(source.queries.length > 0)
  const auditPrelude = String.raw`
import sys
def audit(frame, event, argument):
    if event == "call" and str(frame.f_globals.get("__name__", "")).startswith("marivo.") and frame.f_code.co_name in ("observe", "execute", "revalidate", "compile"):
        raise AssertionError("Persisted SQL read attempted analysis execution")
sys.setprofile(audit)
`
  const restored = spawnSync(
    python,
    [
      '-c',
      `${auditPrelude}\n${MARIVO_PRESENTATION_READ_PROGRAM}`,
      JSON.stringify({ sources: [{ id: 'source', ref: source.ref }], datasets: [] }),
    ],
    { cwd: directory, encoding: 'utf8', timeout: 60_000 },
  )
  assert.equal(restored.status, 0, restored.stderr)
  const payload = JSON.parse(restored.stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.sources[0].status, 'available')
  assert.deepEqual(payload.sources[0].code, {
    snippets: source.queries.map((query: { queryId: string; text: string }) => ({
      language: 'sql',
      provenance: 'execution',
      artifactRef: source.ref.artifactRef,
      runId: source.runId,
      ...query,
    })),
    notices: [],
  })
})

test('historical definition limitation is informational and aggregated across nine metric sources', async (t) => {
  const value = fixture()
  value.artifacts.artifact!.kind = 'metric_frame'
  const { payload } = await readFixture(t, value, {
    sources: Array.from({ length: 9 }, (_, index) => ({
      id: `source-${index}`,
      ref: { sessionId: 'session', artifactRef: 'artifact' },
    })),
    datasets: [],
  })
  assert.equal(payload.ok, true)
  assert.equal(payload.sources.length, 9)
  assert.equal(payload.diagnostics.length, 1)
  assert.equal(payload.diagnostics[0].code, 'definition_unavailable')
  assert.equal(payload.diagnostics[0].path, '/sources')
  assert.match(payload.diagnostics[0].message, /^信息：9 个指标来源/)
  for (const source of payload.sources) {
    assert.equal(source.status, 'available')
    const notice = source.facts.find((fact: { label: string }) => fact.label === '指标定义说明')
    assert.match(notice.value, /来源概要无法展示/)
    assert.match(notice.value, /正常阅读无需处理/)
    assert.match(notice.value, /核验历史口径需补充生成时的定义快照/)
  }
})

test('non-metric sources do not emit historical metric definition limitations', async (t) => {
  const { payload } = await readFixture(t, fixture())
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.diagnostics, [])
  assert.equal(
    payload.sources[0].facts.some((fact: { label: string }) => fact.label === '指标定义说明'),
    false,
  )
})

test('metric semantic references receive the limitation while unavailable sources do not', async (t) => {
  const value = fixture()
  value.artifacts.artifact!.semantic_kinds = ['metric']
  const { payload } = await readFixture(t, value, {
    sources: [
      ...request.sources,
      { id: 'missing', ref: { sessionId: 'session', artifactRef: 'missing' } },
    ],
    datasets: [],
  })
  assert.equal(payload.ok, true)
  assert.equal(payload.sources[1].status, 'unavailable')
  assert.equal(payload.diagnostics.length, 1)
  assert.match(payload.diagnostics[0].message, /^信息：1 个指标来源/)
})
