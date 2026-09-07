import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  PYTHON_LAUNCHER,
  PYTHON_WORKER,
  RESOLVER_PROGRAM,
} from '../../src/datasource/resolver-program.ts'

/** A public credential protocol double; bound Marivo acceptance uses the separate real script. */
function pythonFixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'marivo-resolver-contract-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const packageRoot = path.join(root, 'marivo')
  mkdirSync(packageRoot)
  writeFileSync(path.join(packageRoot, '__init__.py'), '__version__ = "fixture"\n')
  writeFileSync(
    path.join(packageRoot, 'datasource.py'),
    String.raw`
from contextlib import contextmanager
from types import SimpleNamespace
CURRENT = None
DESCRIPTION = SimpleNamespace(name="warehouse", backend_type="fixture",
    literal_fields={"host": "fixture"}, env_refs={"password": "DB_PASSWORD"})
def describe(name):
    if name != "warehouse":
        raise ValueError("unknown datasource")
    return DESCRIPTION
class CredentialRequest:
    def __init__(self, project_root, datasource="warehouse", reference="DB_PASSWORD",
            fields=("password",), cancelled=False):
        self.project_root = project_root
        self.datasource = datasource
        self.reference = reference
        self.fields = fields
        self.cancelled = cancelled
class SecretValue:
    def __init__(self, value): self.value = value
class DatasourceCredentialError(Exception):
    def __init__(self, reason, **details):
        self.reason = reason
        super().__init__(reason)
@contextmanager
def credential_scope(resolver):
    global CURRENT
    previous, CURRENT = CURRENT, resolver
    try:
        yield
    finally:
        CURRENT = previous
`,
  )
  const run = (program: string, input = '') =>
    spawnSync('python3', ['-c', program], {
      cwd: root,
      encoding: 'utf8',
      input,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
      env: { ...process.env, PYTHONPATH: root },
    })
  const identity = run(
    `${RESOLVER_PROGRAM}\nprint(json.dumps({"python": os.path.abspath(sys.executable), "definition": definition(md.describe("warehouse"))}))`,
  )
  assert.equal(identity.status, 0, identity.stderr || String(identity.error))
  const discovered = JSON.parse(identity.stdout)
  const payload = (code: string) => ({
    identity: {
      pythonExecutable: discovered.python,
      marivoVersion: 'fixture',
      packagePath: path.join(packageRoot, '__init__.py'),
    },
    project_root: root,
    grants: {
      warehouse: {
        name: 'warehouse',
        refs: ['DB_PASSWORD'],
        fields: { password: 'DB_PASSWORD' },
        definition: discovered.definition,
      },
    },
    values: { DB_PASSWORD: 'resolver-canary-4791' },
    code,
    worker: PYTHON_WORKER,
  })
  return { run, root, payload }
}

test('the resolver enforces exact datasource, project, field, ref, definition, cancellation and empty scope', (t) => {
  const f = pythonFixture(t)
  const outcome = f.run(
    `${RESOLVER_PROGRAM}\n${String.raw`
root = str(Path.cwd())
payload = {"project_root": root, "grants": {"warehouse": {
    "fields": {"password": "DB_PASSWORD"}, "definition": definition(md.describe("warehouse"))}},
    "values": {"DB_PASSWORD": "resolver-canary-4791"}}
resolver = SnapshotResolver(payload)
assert resolver.resolve(md.CredentialRequest(root)).value == "resolver-canary-4791"
def denied(request, reason="denied", target=resolver):
    try:
        target.resolve(request)
    except md.DatasourceCredentialError as error:
        assert error.reason == reason, (error.reason, reason)
    else:
        raise AssertionError("credential boundary was bypassed")
denied(md.CredentialRequest(root, datasource="unlisted"))
denied(md.CredentialRequest(str(Path(root).parent)))
denied(md.CredentialRequest(root, fields=("token",)))
denied(md.CredentialRequest(root, fields=("password", "token")))
denied(md.CredentialRequest(root, fields=()))
denied(md.CredentialRequest(root, reference="OTHER_PASSWORD"))
denied(md.CredentialRequest(root, cancelled=True), "timeout")
os.environ["DB_PASSWORD"] = "ambient-must-not-resolve"
denied(md.CredentialRequest(root), target=SnapshotResolver({"project_root": root, "grants": {}, "values": {}}))
resolver.values.clear()
denied(md.CredentialRequest(root), "missing")
resolver.values["DB_PASSWORD"] = "resolver-canary-4791"
md.DESCRIPTION.literal_fields["host"] = "changed"
denied(md.CredentialRequest(root))
print("BOUNDARIES_OK")
`}`,
  )
  assert.equal(outcome.status, 0, outcome.stderr || String(outcome.error))
  assert.equal(outcome.stdout.trim(), 'BOUNDARIES_OK')
})

test('the Python worker checks identity before code and installs a scoped resolver with closed user stdin', (t) => {
  const f = pythonFixture(t)
  const payload = f.payload(String.raw`
import sys
import marivo.datasource as md
assert sys.stdin.read() == ""
assert md.CURRENT.resolve(md.CredentialRequest(str(__import__("pathlib").Path.cwd()))).value == "resolver-canary-4791"
print("EXECUTED_ONCE")
`)
  const good = f.run(PYTHON_LAUNCHER, JSON.stringify(payload))
  assert.equal(good.status, 0, good.stderr || String(good.error))
  assert.equal(good.stdout.trim(), 'EXECUTED_ONCE')
  for (const field of ['pythonExecutable', 'marivoVersion', 'packagePath'] as const) {
    const changed = structuredClone(payload)
    changed.identity[field] = 'changed'
    const rejected = f.run(PYTHON_LAUNCHER, JSON.stringify(changed))
    assert.notEqual(rejected.status, 0)
    assert.doesNotMatch(rejected.stdout, /EXECUTED_ONCE/)
    assert.match(rejected.stderr, /identity changed/)
  }
  payload.project_root = path.dirname(f.root)
  const changedWorkspace = f.run(PYTHON_LAUNCHER, JSON.stringify(payload))
  assert.notEqual(changedWorkspace.status, 0)
  assert.doesNotMatch(changedWorkspace.stdout, /EXECUTED_ONCE/)
})

test('raw fd output and failing user tracebacks are redacted before leaving the launcher, without replay', (t) => {
  const f = pythonFixture(t)
  const payload = f.payload(String.raw`
import os
from pathlib import Path
import marivo.datasource as md
marker = Path("starts.txt")
marker.write_text(marker.read_text() + "start\n" if marker.exists() else "start\n")
secret = md.CURRENT.values["DB_PASSWORD"]
os.write(1, secret[:8].encode())
os.write(1, secret[8:].encode())
os.write(2, secret.encode())
raise RuntimeError(secret)
`)
  const failed = f.run(PYTHON_LAUNCHER, JSON.stringify(payload))
  assert.equal(failed.status, 1)
  assert.doesNotMatch(failed.stdout + failed.stderr, /resolver-canary-4791/)
  assert.match(failed.stdout, /\[REDACTED\]/)
  assert.match(failed.stderr, /RuntimeError: \[REDACTED\]/)
  const count = f.run(
    'from pathlib import Path; print(len(Path("starts.txt").read_text().splitlines()))',
  )
  assert.equal(count.stdout.trim(), '1')
})

test('datasource drift or a mismatched source name fails before any user code side effect', (t) => {
  const f = pythonFixture(t)
  const payload = f.payload(
    'from pathlib import Path; Path("side-effect.txt").write_text("executed")',
  )
  for (const change of ['definition', 'source-name', 'grant-name']) {
    const prepare =
      change === 'definition'
        ? 'md.DESCRIPTION.literal_fields["host"] = "changed"'
        : change === 'source-name'
          ? 'md.DESCRIPTION.name = "another-source"\nenvelope["grants"]["warehouse"]["definition"] = definition(md.DESCRIPTION)'
          : 'envelope["grants"]["warehouse"]["name"] = "another-source"'
    const result = f.run(
      `${RESOLVER_PROGRAM}\n${String.raw`
import io
envelope = json.load(sys.stdin)
worker = envelope.pop("worker")
`}${prepare}\n${String.raw`
sys.stdin = io.StringIO(json.dumps(envelope))
exec(worker, {})
`}`,
      JSON.stringify(payload),
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /datasource (?:definition|identity) changed; execution cancelled/)
    assert.equal(existsSync(path.join(f.root, 'side-effect.txt')), false, change)
  }
})

test('an empty resolver executes without describing any datasource', (t) => {
  const f = pythonFixture(t)
  const payload = { ...f.payload('print("NO_DATASOURCE_READ")'), grants: {}, values: {} }
  const result = f.run(
    String.raw`
import io, json, sys
import marivo.datasource as md
def forbidden_describe(name):
    raise AssertionError("Empty resolver must not describe a datasource")
md.describe = forbidden_describe
envelope = json.load(sys.stdin)
worker = envelope.pop("worker")
sys.stdin = io.StringIO(json.dumps(envelope))
exec(worker, {})
`,
    JSON.stringify(payload),
  )
  assert.equal(result.status, 0, result.stderr || String(result.error))
  assert.equal(result.stdout.trim(), 'NO_DATASOURCE_READ')
})

test('the worker clears values and exits scope even when user code fails', (t) => {
  const f = pythonFixture(t)
  const payload = f.payload('raise RuntimeError("expected")')
  const wrapper = String.raw`
import io, json, sys
import marivo.datasource as md
envelope = json.load(sys.stdin)
worker = envelope.pop("worker")
envelope.pop("code")
envelope["code"] = "raise RuntimeError('expected')"
sys.stdin = io.StringIO(json.dumps(envelope))
scope = {}
try:
    exec(worker, scope)
except RuntimeError as error:
    assert str(error) == "expected"
assert scope["resolver"].values == {}
assert scope["payload"] == {}
assert md.CURRENT is None
print("CLEANED")
`
  const result = f.run(wrapper, JSON.stringify(payload))
  assert.equal(result.status, 0, result.stderr || String(result.error))
  assert.equal(result.stdout.trim(), 'CLEANED')
})
