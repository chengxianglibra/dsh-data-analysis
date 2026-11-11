"""Project exact saved Marivo references through public Python APIs, without sources or HTTP."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from ._dataset import MAX_BYTES, encode_dataset
from ._frame import read_frame


def arrow_display_type(kind):
    import pyarrow as pa

    if pa.types.is_decimal(kind):
        return "decimal"
    elif pa.types.is_integer(kind):
        return "decimal" if pa.types.is_uint64(kind) else "int64"
    elif pa.types.is_floating(kind):
        return "float64"
    elif pa.types.is_boolean(kind):
        return "boolean"
    elif pa.types.is_date(kind):
        return "date"
    elif pa.types.is_timestamp(kind) and kind.tz:
        return "datetime"
    elif pa.types.is_string(kind) or pa.types.is_large_string(kind) or pa.types.is_null(kind):
        return "string"
    return None


def read_result(reference):
    import marivo.analysis as mv

    if reference["schema"] == "marivo.frame_ref/v2":
        frame = mv.session.resume(reference["session_id"]).persisted_frame(reference["artifact_id"])
        if frame.ref.to_dict() != reference:
            raise ValueError("result-identity-mismatch")
        return read_frame(frame)
    if Path(reference["project_root"]).resolve() != Path.cwd().resolve():
        raise ValueError("result-workspace-mismatch")
    result = mv.read_dataframe(reference)
    if result.ref.to_dict() != reference:
        raise ValueError("result-identity-mismatch")
    columns = []
    for field in result.schema:
        scalar = arrow_display_type(field.type)
        if scalar is None:
            raise ValueError("result-display-type-unsupported")
        columns.append({"id": field.name, "label": field.name, "type": scalar, "nullable": field.nullable})
    data = encode_dataset(result.to_pandas(), columns=columns)
    return {
        "schemaVersion": 1, "kind": "dataset", "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "coverage": {"start": 0, "totalRows": data["rowCount"], "capturedRows": len(data["rows"]),
                     "complete": not data["truncated"], "columns": [c["id"] for c in data["columns"]],
                     "business": "unknown"},
        "source": {"kind": "dataframe", "details": "not-captured"},
    }


def error_code(error):
    """Project only recognized public failure facts; never emit traceback or raw text."""
    if (getattr(error, "kind", None) == "SessionBusy"
            and getattr(error, "location", None) == "dataset.writer_guard"):
        return "result-session-busy"
    if type(error) is ValueError and error.args in (
        ("result-identity-mismatch",), ("result-workspace-mismatch",), ("result-budget",),
        ("result-display-type-unsupported",),
    ):
        return error.args[0]
    return "result-read-failed"


def main():
    try:
        write_result()
    except Exception as error:
        sys.stdout.write(json.dumps({"error": {"code": error_code(error)}}))
        raise SystemExit(1) from None


def write_result():
    snapshot = read_result(json.load(sys.stdin))
    body = json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(body) > MAX_BYTES:
        raise ValueError("result-budget")
    sys.stdout.buffer.write(body)
