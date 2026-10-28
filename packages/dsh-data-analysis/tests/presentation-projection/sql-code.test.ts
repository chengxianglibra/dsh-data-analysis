import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { MARIVO_PRESENTATION_READ_PROGRAM } from '../../src/presentation/projection/program.ts'

// Public-only doubles deliberately reject old APIs and all private access.
const bootstrap = String.raw`
import contextlib,json,sys,types
from pathlib import Path
config=json.load(sys.stdin)
class Frame:
    artifact_id=config.get("artifact", "artifact")
    session_id=config.get("frameSession", "session")
    output_names=("value",)
    def evidence_digest(self):raise AssertionError("Removed digest API is forbidden")
    def findings(self, **kwargs):
        return types.SimpleNamespace(items=(), next_cursor=None)
    def __getattr__(self,name):raise AssertionError("Unsupported Frame read: "+name)
class Session:
    id=config.get("session", "session")
    project_root=config.get("root",str(Path.cwd()))
    def persisted_frame(self,identity):
        if config.get("missing"):raise ValueError("private-canary")
        assert identity == "artifact"
        return Frame()
    def __getattr__(self,name):raise AssertionError("Unsupported Session read: "+name)
mv=types.ModuleType("marivo.analysis")
mv.session=types.SimpleNamespace(resume=lambda identity:Session())
md=types.ModuleType("marivo.datasource")
md.credential_scope=lambda *,resolver:contextlib.nullcontext()
kit=types.ModuleType("dsh_data_analysis_presentation._frame")
def forbidden(*args,**kwargs):raise AssertionError("Source-only read attempted data access")
kit.read_frame=forbidden
sys.modules.update({"marivo":types.ModuleType("marivo"),"marivo.analysis":mv,"marivo.datasource":md,"dsh_data_analysis_presentation":types.ModuleType("dsh_data_analysis_presentation"),"dsh_data_analysis_presentation._frame":kit})
`
function read(config: Record<string, unknown> = {}, finding = false, dataset = false) {
  const request = {
    sources: [
      {
        id: 'source',
        ref: {
          sessionId: 'session',
          artifactRef: 'artifact',
          ...(finding ? { findingId: 'missing' } : {}),
        },
      },
    ],
    datasets: dataset ? [{ index: 0, id: 'data', sourceId: 'source', rowLimit: 1 }] : [],
  }
  const result = spawnSync(
    'python3',
    ['-c', bootstrap + '\n' + MARIVO_PRESENTATION_READ_PROGRAM, JSON.stringify(request)],
    { encoding: 'utf8', input: JSON.stringify(config) },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /private-canary/)
  return JSON.parse(result.stdout)
}
test('new sources explicitly mark SQL unavailable without requesting private or removed APIs', () => {
  const result = read()
  assert.equal(result.ok, true)
  assert.equal(result.sources[0].status, 'available')
  assert.deepEqual(result.sources[0].code, {
    snippets: [],
    notices: ['marivo.presentation.sql-capability-unavailable'],
  })
  assert.ok(result.sources[0].facts.some((fact: { label: string }) => fact.label === 'Evidence'))
})
test('persisted source identity and Workspace checks cannot degrade into availability notices', () => {
  for (const config of [{ session: 'other' }, { frameSession: 'other' }, { artifact: 'other' }])
    assert.equal(read(config).error.code, 'source_identity_mismatch')
  assert.equal(read({ root: '/wrong-workspace' }).error.code, 'source_workspace_mismatch')
})
test('missing historical sources remain explicit; direct data fails and optional Finding is diagnosed', () => {
  assert.equal(read({ missing: true }).sources[0].status, 'unavailable')
  assert.equal(read({ missing: true }, false, true).error.code, 'artifact_data_unavailable')
  const result = read({}, true)
  assert.equal(result.sources[0].status, 'available')
  assert.equal(result.diagnostics[0].code, 'finding_unavailable')
})
