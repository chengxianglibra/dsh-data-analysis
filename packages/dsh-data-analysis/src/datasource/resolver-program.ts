/** Shared Python adapter. All inputs below arrive on a Host-owned pipe. */
export const RESOLVER_PROGRAM = String.raw`
import hashlib
import json
import os
import sys
from pathlib import Path
import marivo
import marivo.datasource as md

if not all(hasattr(md, name) for name in ("credential_scope", "CredentialRequest", "SecretValue", "DatasourceCredentialError")):
    raise RuntimeError("Marivo credential_scope capability is required; upgrade the bound Runtime")

def definition(description):
    return hashlib.sha256(json.dumps({
        "name": description.name, "backend": description.backend_type,
        "fields": description.literal_fields, "refs": description.env_refs,
    }, sort_keys=True, default=str).encode()).hexdigest()

class SnapshotResolver:
    def __init__(self, payload):
        self.root = Path(payload["project_root"]).resolve()
        self.grants = payload["grants"]
        self.values = payload["values"]

    def resolve(self, request):
        grant = self.grants.get(request.datasource)
        if Path(request.project_root).resolve() != self.root or grant is None:
            reason = "denied"
        elif any(grant["fields"].get(field) != request.reference for field in request.fields):
            reason = "denied"
        elif not request.fields or request.reference not in grant["fields"].values():
            reason = "denied"
        elif definition(md.load().describe(request.datasource)) != grant["definition"]:
            reason = "denied"
        elif not self.values.get(request.reference):
            reason = "missing"
        else:
            return md.SecretValue(self.values[request.reference])
        raise md.DatasourceCredentialError(reason=reason, reference=request.reference,
            datasource=request.datasource, fields=request.fields)
`.trim()

/** The worker checks the exact binding and enters scope before any user code. */
export const PYTHON_WORKER = `${RESOLVER_PROGRAM}\n${String.raw`
payload = json.load(sys.stdin)
expected = payload["identity"]
if (os.path.abspath(sys.executable) != expected["pythonExecutable"] or
    marivo.__version__ != expected["marivoVersion"] or
    os.path.abspath(marivo.__file__) != expected["packagePath"] or
    str(Path.cwd().resolve()) != payload["project_root"]):
    raise RuntimeError("Marivo execution identity changed; rebind required")
resolver = SnapshotResolver(payload)
code = payload.pop("code")
sys.stdin = open(os.devnull)
from contextlib import nullcontext
capture = nullcontext()
if payload.get("captureDirectory") and expected.get("presentationKit"):
    import dsh_data_analysis_presentation as presentation
    from importlib.metadata import distribution
    kit = distribution("dsh-data-analysis-presentation-kit")
    expected_kit = expected["presentationKit"]
    if (presentation.__version__ != expected_kit["version"] or kit.version != expected_kit["version"] or
        os.path.realpath(presentation.__file__) != os.path.realpath(expected_kit["packagePath"]) or
        os.path.realpath(presentation.__file__) != os.path.realpath(kit.locate_file("dsh_data_analysis_presentation/__init__.py")) or
        not callable(presentation.capture_dataset) or not callable(presentation.capture_frame)):
        raise RuntimeError("Presentation helper execution identity changed; rebind required")
    from dsh_data_analysis_presentation._capture import _capture_scope
    capture = _capture_scope(payload["project_root"], payload["captureDirectory"], tuple(resolver.values.values()))
capture_state = None
try:
    with capture as capture_state, md.credential_scope(resolver=resolver):
        for name, grant in resolver.grants.items():
            description = md.load().describe(name)
            if grant["name"] != name or description.name != name:
                raise RuntimeError("Marivo datasource identity changed; execution cancelled")
            if definition(description) != grant["definition"]:
                raise RuntimeError("Marivo datasource definition changed; execution cancelled")
        exec(compile(code, "<marivo_python>", "exec"), {"__name__": "__main__"})
finally:
    if payload.get("captureOutcome"):
        try:
            Path(payload["captureOutcome"]).write_text(json.dumps({"failed": bool(capture_state and capture_state["failed"])}))
        except Exception:
            pass  # Missing outcome is a capture failure at the launcher boundary.
    resolver.values.clear()
    payload.clear()
`}`

/** Capture raw fd output before Harness collection/spill, including driver writes. */
export const PYTHON_LAUNCHER = String.raw`
import json, subprocess, sys, threading, tempfile
from pathlib import Path
payload = json.load(sys.stdin)
worker = payload.pop("worker")
values = sorted(set(payload["values"].values()), key=len, reverse=True)
outcome_directory = tempfile.TemporaryDirectory(prefix="marivo-python-outcome-")
outcome_path = Path(outcome_directory.name) / "capture.json"
payload["captureOutcome"] = str(outcome_path)
child = subprocess.Popen([sys.executable, "-c", worker], stdin=subprocess.PIPE,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
streams = [bytearray(), bytearray()]
overflow = threading.Event()
def collect(pipe, target):
    while True:
        chunk = pipe.read(8192)
        if not chunk:
            break
        if len(target) + len(chunk) > 1048576:
            overflow.set()
            child.kill()
        elif not overflow.is_set():
            target.extend(chunk)
threads = [threading.Thread(target=collect, args=(pipe, buf), daemon=True)
    for pipe, buf in zip((child.stdout, child.stderr), streams)]
for thread in threads:
    thread.start()
try:
    child.stdin.write(json.dumps(payload).encode())
    child.stdin.close()
except BrokenPipeError:
    pass
child.wait()
for thread in threads:
    thread.join()
capture_failed = True
try:
    outcome = json.loads(outcome_path.read_text())
    if type(outcome) is dict and set(outcome) == {"failed"} and type(outcome["failed"]) is bool:
        capture_failed = outcome["failed"]
except Exception:
    pass
finally:
    outcome_directory.cleanup()
if overflow.is_set():
    print("Marivo Python output limit exceeded", file=sys.stderr)
    raise SystemExit(74)
# A fixed launcher-owned status header precedes opaque user stderr; user stdout
# remains untouched and is never used as a capture protocol.
print(json.dumps({"marivoCaptureStatus": 1, "failed": capture_failed}), file=sys.stderr)
for stream, raw in zip((sys.stdout, sys.stderr), streams):
    text = raw.decode("utf-8", errors="replace")
    for value in values:
        if value:
            text = text.replace(value, "[REDACTED]")
    stream.write(text)
raise SystemExit(child.returncode if child.returncode >= 0 else 1)
`.trim()
