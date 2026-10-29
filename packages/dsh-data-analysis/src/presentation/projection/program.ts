/** Reads exact committed Frames through public APIs. Requests never contain executable code. */
export const MARIVO_PRESENTATION_READ_PROGRAM = String.raw`
import json
import sys
from pathlib import Path

import marivo.analysis as mv
import marivo.datasource as md
from dsh_data_analysis_presentation._frame import read_frame

class ProjectionFailure(Exception):
    def __init__(self, code, path, message):
        self.code, self.path, self.message = code, path, message

class DenyCredentials:
    def resolve(self, request):
        raise ProjectionFailure("credential_read_forbidden", "/frames", "Persisted presentation reads cannot obtain datasource credentials.")

try:
    request = json.loads(sys.argv[1])
    with md.credential_scope(resolver=DenyCredentials()):
        snapshots = []
        for ref in request["frames"]:
            session = mv.session.resume(ref["sessionId"])
            frame = session.persisted_frame(ref["artifactId"])
            if (session.id != ref["sessionId"] or frame.session_id != session.id or
                frame.artifact_id != ref["artifactId"] or Path(session.project_root).resolve() != Path.cwd().resolve()):
                raise ProjectionFailure("source_identity_mismatch", "/frames", "Restored Frame identity differs from the requested Workspace/Session/Artifact.")
            snapshots.append(read_frame(frame, columns=ref.get("columns"), row_limit=ref.get("rowLimit", 5000), metadata=True))
        result = {"ok": True, "snapshots": snapshots}
except ProjectionFailure as error:
    result = {"ok": False, "error": {"code": error.code, "path": error.path, "message": error.message}}
except Exception as error:
    code = getattr(error, "code", "projection_read_failed")
    if code not in ("numeric_precision", "budget", "invalid_value", "unsupported_type", "invalid_reference", "duplicate_id", "runtime_incompatible", "source_identity_mismatch"):
        code = "projection_read_failed"
    result = {"ok": False, "error": {"code": code, "path": "/frames", "message": "The bound public presentation read failed."}}
print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
`.trim()
