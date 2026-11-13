"""Bounded configuration names from exact fixed results, without producer replay or sources."""
import json
import sys
from pathlib import Path

import marivo.analysis as mv

from ._frame import _type
from .errors import PresentationDatasetError
from .read_result import arrow_display_type, error_code


def frame_value_types(schema):
    types = {}
    for name, field in schema.values.items():
        try:
            types[name] = _type(field.dtype)["type"]
        except PresentationDatasetError:
            continue
    return types


def result_facts(reference):
    if reference["schema"] == "marivo.frame_ref/v2":
        frame = mv.session.resume(reference["session_id"]).persisted_frame(reference["artifact_id"])
        if frame.ref.to_dict() != reference:
            raise ValueError("result-identity-mismatch")
        schema = frame.schema
        metadata = {
            "kind": "frame",
            "columns": [item.name for item in schema.layout],
            "values": list(schema.values),
            "axes": [{"token": axis.token, "name": axis.name, "role": axis.role} for axis in schema.axes],
            "valueTypes": frame_value_types(schema),
            "coordinateColumns": [
                {"name": item.name, "axisToken": item.axis_token,
                 "endpoint": item.endpoint, "part": item.part}
                for item in schema.layout if item.kind == "coordinate"
            ],
            # Schema does not prove the result row count or business completeness.
            "coverage": {"totalRows": None, "business": "unknown"},
        }
    elif reference["schema"] == "marivo.dataframe_ref/v2":
        if Path(reference["project_root"]).resolve() != Path.cwd().resolve():
            raise ValueError("result-identity-mismatch")
        result = mv.read_dataframe(reference)
        if result.ref.to_dict() != reference:
            raise ValueError("result-identity-mismatch")
        metadata = {
            "kind": "dataset", "columns": list(result.schema.names), "values": [], "axes": [],
            "valueTypes": {
                field.name: scalar for field in result.schema
                if (scalar := arrow_display_type(field.type)) is not None
            },
            "coordinateColumns": [],
            "coverage": {"totalRows": result.row_count, "business": "unknown"},
        }
    else:
        raise ValueError("result-reference-unsupported")
    return metadata


def result_metadata(reference):
    try:
        metadata = result_facts(reference)
        body = {"status": "captured", **metadata}
        if (any(len(metadata[key]) > 64 for key in ("columns", "values", "axes"))
                or len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()) > 4096):
            return {"status": "unavailable", "reason": "budget"}
        return body
    except Exception as error:
        # Metadata failure never invalidates a successful result export or discloses exceptions.
        reason = "identity-mismatch" if error_code(error) == "result-identity-mismatch" else "read-failed"
        return {"status": "unavailable", "reason": reason}


def write_candidate_page(request):
    try:
        facts = result_facts(request["reference"])
        group = request["group"]
        frame = facts["kind"] == "frame"
        values = facts["values"] if frame else facts["columns"]
        if group == "columns":
            names = facts["columns"]
        elif group == "values":
            names = values
        elif group == "numericValues":
            names = [name for name in values if facts["valueTypes"].get(name) in request["numericTypes"]]
        elif not frame:
            names = facts["columns"]
        elif group == "axis":
            names = [axis["name"] for axis in facts["axes"]]
        else:
            names = [axis["name"] for axis in facts["axes"] if axis["role"] in request["timeAxisRoles"]]
        offset = request["offset"]
        candidates = names[offset:offset + 12]

        def encode_page():
            next_offset = offset + len(candidates)
            result = {"kind": facts["kind"], "candidates": candidates,
                      "nextOffset": next_offset if next_offset < len(names) else None}
            return json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()

        body = encode_page()
        while len(body) > 16384 and len(candidates) > 1:
            candidates.pop()
            body = encode_page()
        if len(body) > 16384:
            raise ValueError("result-budget")
        sys.stdout.buffer.write(body)
    except Exception as error:
        sys.stdout.write(json.dumps({"error": {"code": error_code(error)}}))
        raise SystemExit(1) from None
