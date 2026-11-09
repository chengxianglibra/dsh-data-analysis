import { PYTHON_RESULT_HEADER } from '../python-result-references.ts'

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
try:
    with md.credential_scope(resolver=resolver):
        for name, grant in resolver.grants.items():
            description = md.load().describe(name)
            if grant["name"] != name or description.name != name:
                raise RuntimeError("Marivo datasource identity changed; execution cancelled")
            if definition(description) != grant["definition"]:
                raise RuntimeError("Marivo datasource definition changed; execution cancelled")
        namespace = {"__name__": "__main__"}
        exec(compile(code, "<marivo_python>", "exec"), namespace)
        if payload.get("result_variables"):
            try:
                references = {name: namespace[variable] for name, variable in payload["result_variables"].items()}
                output = {"status": "ok", "references": references}
                try:
                    import importlib.util
                    spec = importlib.util.spec_from_file_location("_dsh_result_metadata", str(Path(payload["projection_root"]) / "result_metadata.py"))
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    output["metadata"] = {name: module.result_metadata(ref) for name, ref in references.items()}
                    if len(json.dumps(output).encode()) > 32768:
                        output["metadata"] = {name: {"status": "unavailable", "reason": "budget"} for name in references}
                except Exception:
                    output["metadata"] = {name: {"status": "unavailable", "reason": "read-failed"} for name in references}
                text = json.dumps(output, allow_nan=False)
                for value in resolver.values.values():
                    if value:
                        text = text.replace(value, "[REDACTED]")
                encoded = text.encode("utf-8")
                if len(encoded) <= 32768:
                    Path(payload["result_file"]).write_bytes(encoded)
            except Exception:
                pass  # Export failure does not change the successful user-code outcome.
finally:
    resolver.values.clear()
    payload.clear()
`}`

/** Capture raw fd output before Harness collection/spill, including driver writes. */
export const PYTHON_LAUNCHER = String.raw`
import base64, json, subprocess, sys, tempfile, threading
from pathlib import Path
payload = json.load(sys.stdin)
worker = payload.pop("worker")
values = sorted(set(payload["values"].values()), key=len, reverse=True)
result_directory = tempfile.TemporaryDirectory(prefix="dsh-marivo-results-") if payload.get("result_variables") else None
if result_directory:
    payload["result_file"] = str(Path(result_directory.name) / "references.json")
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
if result_directory:
    control = b'{"status":"unavailable"}'
    try:
        with Path(payload["result_file"]).open("rb") as result_stream:
            candidate = result_stream.read(32769)
        if len(candidate) <= 32768:
            control = candidate
    except OSError:
        pass
    text = control.decode("utf-8", errors="replace")
    for value in values:
        if value:
            text = text.replace(value, "[REDACTED]")
    sys.stderr.write("${PYTHON_RESULT_HEADER}" + base64.b64encode(text.encode("utf-8")).decode("ascii") + "\n")
    result_directory.cleanup()
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
