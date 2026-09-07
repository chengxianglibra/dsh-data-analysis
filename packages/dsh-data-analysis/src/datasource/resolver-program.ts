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
        if request.cancelled:
            reason = "timeout"
        elif Path(request.project_root).resolve() != self.root or grant is None:
            reason = "denied"
        elif any(grant["fields"].get(field) != request.reference for field in request.fields):
            reason = "denied"
        elif not request.fields or request.reference not in grant["fields"].values():
            reason = "denied"
        elif definition(md.describe(request.datasource)) != grant["definition"]:
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
with md.credential_scope(resolver=resolver):
    exec(compile(code, "<marivo_python>", "exec"), {"__name__": "__main__"})
`}`

/** Capture raw fd output before Harness collection/spill, including driver writes. */
export const PYTHON_LAUNCHER = String.raw`
import json, subprocess, sys, threading
payload = json.load(sys.stdin)
worker = payload.pop("worker")
values = sorted(set(payload["values"].values()), key=len, reverse=True)
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
if overflow.is_set():
    print("Marivo Python output limit exceeded", file=sys.stderr)
    raise SystemExit(74)
for stream, raw in zip((sys.stdout, sys.stderr), streams):
    text = raw.decode("utf-8", errors="replace")
    for value in values:
        if value:
            text = text.replace(value, "[REDACTED]")
    stream.write(text)
raise SystemExit(child.returncode if child.returncode >= 0 else 1)
`.trim()
