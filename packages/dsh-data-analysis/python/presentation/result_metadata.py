"""Bounded configuration names from exact fixed results, without producer replay or sources."""
import json
from pathlib import Path

import marivo.analysis as mv


def result_metadata(reference):
    try:
        if reference["schema"] == "marivo.frame_ref/v2":
            frame = mv.session.resume(reference["session_id"]).persisted_frame(reference["artifact_id"])
            if frame.ref.to_dict() != reference:
                return {"status": "unavailable", "reason": "identity-mismatch"}
            schema = frame.schema
            metadata = {
                "kind": "frame",
                "columns": [item.name for item in schema.layout],
                "values": list(schema.values),
                "axes": [{"token": axis.token, "name": axis.name, "role": axis.role} for axis in schema.axes],
                # Schema does not prove the result row count or business completeness.
                "coverage": {"totalRows": None, "business": "unknown"},
            }
        elif reference["schema"] == "marivo.dataframe_ref/v2":
            if Path(reference["project_root"]).resolve() != Path.cwd().resolve():
                return {"status": "unavailable", "reason": "identity-mismatch"}
            result = mv.read_dataframe(reference)
            if result.ref.to_dict() != reference:
                return {"status": "unavailable", "reason": "identity-mismatch"}
            metadata = {
                "kind": "dataset", "columns": list(result.schema.names), "values": [], "axes": [],
                "coverage": {"totalRows": result.row_count, "business": "unknown"},
            }
        else:
            raise ValueError("result-reference-unsupported")
        body = {"status": "captured", **metadata}
        if (any(len(metadata[key]) > 64 for key in ("columns", "values", "axes"))
                or len(json.dumps(body, ensure_ascii=False).encode()) > 4096):
            return {"status": "unavailable", "reason": "budget"}
        return body
    except Exception:
        # Metadata failure never invalidates a successful result export or discloses exceptions.
        return {"status": "unavailable", "reason": "read-failed"}
