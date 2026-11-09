"""Project exact saved Marivo references through public Python APIs, without sources or HTTP."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import marivo.analysis as mv
import pyarrow as pa

from ._dataset import MAX_BYTES, encode_dataset
from ._frame import read_frame


def read_result(reference):
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
        kind = field.type
        if pa.types.is_decimal(kind):
            scalar = "decimal"
        elif pa.types.is_integer(kind):
            scalar = "decimal" if pa.types.is_uint64(kind) else "int64"
        elif pa.types.is_floating(kind):
            scalar = "float64"
        elif pa.types.is_boolean(kind):
            scalar = "boolean"
        elif pa.types.is_date(kind):
            scalar = "date"
        elif pa.types.is_timestamp(kind) and kind.tz:
            scalar = "datetime"
        elif pa.types.is_string(kind) or pa.types.is_large_string(kind) or pa.types.is_null(kind):
            scalar = "string"
        else:
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


def main():
    snapshot = read_result(json.load(sys.stdin))
    body = json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(body) > MAX_BYTES:
        raise ValueError("result-budget")
    sys.stdout.buffer.write(body)
