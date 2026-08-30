export const MARIVO_DATASOURCE_DESCRIBE_PROGRAM = String.raw`
import json
import os
import sys
import marivo
import marivo.datasource as md

description = md.describe(sys.argv[1])
print(json.dumps({
    "name": description.name,
    "refs": list(description.env_refs.values()),
}, sort_keys=True))
`.trim()

export const MARIVO_DATASOURCE_INVENTORY_PROGRAM = String.raw`
import json
import os
import sys
import marivo
import marivo.datasource as md

print(json.dumps({
    "datasources": [{
        "name": description.name,
        "refs": list(description.env_refs.values()),
    } for description in (md.describe(item.name) for item in md.list())],
}, sort_keys=True))
`.trim()

export const MARIVO_DATASOURCE_TEST_PROGRAM = String.raw`
import contextlib
import io
import json
import os
import sys
import marivo
import marivo.datasource as md

captured_stdout = io.StringIO()
captured_stderr = io.StringIO()
try:
    with contextlib.redirect_stdout(captured_stdout), contextlib.redirect_stderr(captured_stderr):
        description = md.describe(sys.argv[1])
        secret_values = [
            value
            for ref in description.env_refs.values()
            if (value := os.environ.get(ref))
        ]
        result = md.test(sys.argv[1])
except Exception as exc:
    print(json.dumps({"kind": "datasource-test-failed", "exception_type": type(exc).__name__}), file=sys.stderr)
    raise SystemExit(70)

def redact(value):
    if isinstance(value, str):
        for secret in secret_values:
            value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value

failure = None if result.failure is None else {
    "code": result.failure.code,
    "exception_type": result.failure.exception_type,
    "backend_code": result.failure.backend_code,
    "backend_name": result.failure.backend_name,
    "message": result.failure.message,
}
repair = None if result.repair is None else result.repair.model_dump(mode="json")
print(json.dumps(redact({
    "name": result.name,
    "ok": result.ok,
    "latency_ms": result.latency_ms,
    "failure": failure,
    "repair": repair,
}), sort_keys=True))
`.trim()
