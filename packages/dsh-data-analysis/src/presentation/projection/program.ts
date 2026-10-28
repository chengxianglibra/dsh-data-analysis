import { MARIVO_PRESENTATION_SQL_CODE_PROGRAM } from './sql-code.ts'

/** Reads exact committed Frames through public APIs. Drafts never contain executable code. */
export const MARIVO_PRESENTATION_READ_PROGRAM = String.raw`
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import marivo.analysis as mv
import marivo.datasource as md
from dsh_data_analysis_presentation._frame import read_frame

class ProjectionFailure(Exception):
    def __init__(self, code, path, message):
        self.code, self.path, self.message = code, path, message

class DenyCredentials:
    def resolve(self, request):
        raise ProjectionFailure("credential_read_forbidden", "/sources", "Persisted presentation reads cannot obtain datasource credentials.")

def text(value, limit=32768):
    result = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"), default=str)
    result = result.replace("\0", "\\u0000")
    return result if len(result) <= limit else result[:limit - 14] + " [truncated]"

${MARIVO_PRESENTATION_SQL_CODE_PROGRAM}

def read(request):
    sessions, frames = {}, {}
    sources, datasets, diagnostics = [], [], []
    read_at = datetime.now(timezone.utc).isoformat()
    for index, declared in enumerate(request["sources"]):
        ref, source_path = declared["ref"], "/sources/" + str(index)
        try:
            session = sessions.get(ref["sessionId"])
            if session is None:
                session = mv.session.resume(ref["sessionId"])
                sessions[ref["sessionId"]] = session
            if session.id != ref["sessionId"]:
                raise ProjectionFailure("source_identity_mismatch", source_path + "/ref/sessionId", "Restored Session identity differs from the declared source.")
            if Path(session.project_root).resolve() != Path.cwd().resolve():
                raise ProjectionFailure("source_workspace_mismatch", source_path + "/ref", "Restored Session belongs to a different Workspace.")
            frame = session.persisted_frame(ref["artifactRef"])
            if frame.artifact_id != ref["artifactRef"] or frame.session_id != session.id:
                raise ProjectionFailure("source_identity_mismatch", source_path + "/ref", "Restored Frame identity differs from the declared source.")
        except ProjectionFailure:
            raise
        except Exception:
            # Includes incompatible historical Stores. Never migrate, reinterpret or disclose raw errors.
            sources.append({**declared, "status": "unavailable", "reason": "marivo.presentation.source-unavailable"})
            continue
        frames[declared["id"]] = frame
        facts = []
        def fact(label, value): facts.append({"label": label, "value": text(value)})
        fact("读取时间", read_at)
        fact("Session ID", frame.session_id)
        fact("Artifact ID", frame.artifact_id)
        fact("输出列", frame.output_names)
        fact("Evidence", "not-captured")
        fact("Quality", "not-captured")
        if "findingId" in ref:
            try:
                cursor, seen, finding = None, set(), None
                while True:
                    page = frame.findings(limit=100, cursor=cursor)
                    finding = next((item for item in page.items if item.finding_id == ref["findingId"]), None)
                    if finding is not None or page.next_cursor is None: break
                    cursor = page.next_cursor
                    if cursor in seen: raise ValueError("finding-cursor-repeated")
                    seen.add(cursor)
                if finding is None: raise ValueError("finding-not-found")
                if str(finding.artifact_ref) != frame.artifact_id or finding.session_id != session.id:
                    raise ProjectionFailure("source_identity_mismatch", source_path + "/ref/findingId", "Restored Finding identity differs from the declared source.")
                fact("选择的 Finding", finding.render(max_output_bytes=4096))
            except ProjectionFailure:
                raise
            except Exception:
                fact("选择的 Finding unavailable", "marivo.presentation.finding-unavailable")
                diagnostics.append({"code": "finding_unavailable", "path": source_path + "/ref/findingId", "message": "Frame is available; its requested Finding is unavailable."})
        fact("revalidation", "not_requested")
        sources.append({**declared, "status": "available", "label": text("Frame " + frame.artifact_id, 512), "facts": facts, "code": sql_code_snapshot()})

    for selection in request["datasets"]:
        dataset_path = "/datasets/" + str(selection["index"])
        frame = frames.get(selection["sourceId"])
        if frame is None:
            raise ProjectionFailure("artifact_data_unavailable", dataset_path + "/sourceId", "A direct Artifact dataset requires an available persisted Frame source.")
        try:
            snapshot = read_frame(frame, columns=selection.get("columns"), row_limit=selection["rowLimit"])
            encoded = snapshot["data"]
            if "columns" in selection:
                indices = [next(i for i, c in enumerate(encoded["columns"]) if c["id"] == name) for name in selection["columns"]]
                encoded = {**encoded, "columns": [encoded["columns"][i] for i in indices],
                           "rows": [[row[i] for i in indices] for row in encoded["rows"]]}
            datasets.append({"id": selection["id"], "data": encoded})
        except ProjectionFailure:
            raise
        except Exception as error:
            code, location = getattr(error, "code", None), getattr(error, "path", None)
            if code in ("numeric_precision", "budget", "invalid_value", "unsupported_type", "invalid_reference", "duplicate_id", "runtime_incompatible", "source_identity_mismatch") and isinstance(location, str):
                raise ProjectionFailure(code, dataset_path + "/data" + location, "Public Frame values cannot be encoded within the presentation data contract.") from None
            raise ProjectionFailure("artifact_data_unavailable", dataset_path + "/data", "The persisted Frame does not expose the required typed presentation data.") from None
    return {"ok": True, "sources": sources, "datasets": datasets, "diagnostics": diagnostics}

try:
    request = json.loads(sys.argv[1])
    with md.credential_scope(resolver=DenyCredentials()):
        if "frames" in request:
            snapshots = []
            for ref in request["frames"]:
                session = mv.session.resume(ref["sessionId"])
                frame = session.persisted_frame(ref["artifactId"])
                if (session.id != ref["sessionId"] or frame.session_id != session.id or
                    frame.artifact_id != ref["artifactId"] or Path(session.project_root).resolve() != Path.cwd().resolve()):
                    raise ProjectionFailure("source_identity_mismatch", "/frames", "Restored Frame identity differs from the requested Workspace/Session/Artifact.")
                snapshots.append(read_frame(frame, columns=ref.get("columns"), row_limit=ref.get("rowLimit", 5000)))
            result = {"ok": True, "snapshots": snapshots}
        else:
            result = read(request)
except ProjectionFailure as error:
    result = {"ok": False, "error": {"code": error.code, "path": error.path, "message": error.message}}
except Exception as error:
    code = getattr(error, "code", "projection_read_failed")
    if code not in ("numeric_precision", "budget", "invalid_value", "unsupported_type", "invalid_reference", "duplicate_id", "runtime_incompatible", "source_identity_mismatch"):
        code = "projection_read_failed"
    result = {"ok": False, "error": {"code": code, "path": "/sources", "message": "The bound public presentation read failed."}}
print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
`.trim()
