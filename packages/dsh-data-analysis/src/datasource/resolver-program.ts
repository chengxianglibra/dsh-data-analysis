import { PYTHON_IMPORT_IDENTITY } from '../environment/identity.ts'
import { PYTHON_EXCEPTION_PROGRAM } from '../python-exception.ts'
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
export const PYTHON_WORKER = `${PYTHON_IMPORT_IDENTITY}\n${PYTHON_EXCEPTION_PROGRAM}\n${RESOLVER_PROGRAM}\n${String.raw`
payload = json.load(sys.stdin)
expected = payload["identity"]
if (_dsh_import_identity(sys.executable, marivo.__version__, marivo.__file__) !=
    _dsh_import_identity(expected["pythonExecutable"], expected["marivoVersion"], expected["packagePath"]) or
    str(Path.cwd().resolve()) != payload["project_root"]):
    raise RuntimeError("Marivo execution identity changed; rebind required")
resolver = SnapshotResolver(payload)
code = payload.pop("code")
sys.stdin = open(os.devnull)

def export_results(namespace):
    import importlib.util

    def fixed_ref(value):
        if isinstance(value, dict):
            return value
        import marivo.analysis as mv
        import pandas as pd

        if isinstance(value, (mv.FrameReference, mv.DataFrameReference)):
            return value.to_dict()
        if isinstance(value, mv.AnalysisFrame):
            try:
                return value.ref.to_dict()
            except Exception:
                pass
            # read_page rejects pending expressions and cannot read a source.
            value.read_page(columns=(), limit=1)
            return value.persist().ref.to_dict()
        if isinstance(value, pd.DataFrame):
            return mv.persist_dataframe(value, project_root=payload["project_root"]).to_dict()
        raise TypeError("Unsupported result variable")

    references, errors, captured = {}, {}, {}
    for name, variable in payload["result_variables"].items():
        if variable not in namespace:
            errors[name] = "missing-variable"
            continue
        try:
            value = namespace[variable]
            if id(value) not in captured:
                reference = fixed_ref(value)
                if len(json.dumps(reference, allow_nan=False).encode()) > 16384:
                    raise ValueError("Result reference exceeds its budget")
                captured[id(value)] = reference
            references[name] = captured[id(value)]
        except Exception:
            errors[name] = "not-fixed"

    output = {"status": "collected", "references": references, "errors": errors}
    if references:
        try:
            projection_root = Path(payload["projection_root"])
            spec = importlib.util.spec_from_file_location("_dsh_projection", str(projection_root / "__init__.py"), submodule_search_locations=[str(projection_root)])
            module = importlib.util.module_from_spec(spec)
            sys.modules["_dsh_projection"] = module
            spec.loader.exec_module(module)
            from _dsh_projection.result_metadata import result_metadata
            output["metadata"] = {name: result_metadata(ref) for name, ref in references.items()}
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

try:
    with md.credential_scope(resolver=resolver):
        for name, grant in resolver.grants.items():
            description = md.load().describe(name)
            if grant["name"] != name or description.name != name:
                raise RuntimeError("Marivo datasource identity changed; execution cancelled")
            if definition(description) != grant["definition"]:
                raise RuntimeError("Marivo datasource definition changed; execution cancelled")
        namespace = {"__name__": "__main__"}
        try:
            exec(compile(code, "<marivo_python>", "exec"), namespace)
        finally:
            if payload.get("result_variables"):
                try:
                    export_results(namespace)
                except Exception:
                    pass  # Keep the original user-code outcome.
except Exception as error:
    try:
        result_file = Path(payload["result_file"])
        output = json.loads(result_file.read_text()) if result_file.exists() else {
            "status": "collected", "references": {}, "errors": {}}
        output["error"] = python_exception(error)
        encoded = json.dumps(output, allow_nan=False).encode("utf-8")
        if len(encoded) <= 32768:
            result_file.write_bytes(encoded)
    except Exception:
        pass  # Preserve the original failure if diagnostic capture fails.
    raise
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
result_directory = tempfile.TemporaryDirectory(prefix="dsh-marivo-results-")
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
control = b'{"status":"collected","references":{},"errors":{}}'
try:
    with Path(payload["result_file"]).open("rb") as result_stream:
        candidate = result_stream.read(32769)
    if len(candidate) <= 32768:
        control = candidate
except OSError:
    pass
def redact_control(item):
    if isinstance(item, str):
        for value in values:
            if value:
                item = item.replace(value, "[REDACTED]")
        return item
    if isinstance(item, list):
        return [redact_control(value) for value in item]
    if isinstance(item, dict):
        return {redact_control(key): redact_control(value) for key, value in item.items()}
    return item
try:
    text = json.dumps(redact_control(json.loads(control)), allow_nan=False)
except (ValueError, UnicodeError):
    text = '{"status":"collected","references":{},"errors":{}}'
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
