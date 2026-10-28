"""Bounded projection of public completed Frame schema and one detached page."""
from __future__ import annotations

from datetime import datetime, timezone

from ._dataset import MAX_CELLS, MAX_COLUMNS, MAX_ROWS, _fail, encode_rows


def _type(dtype):
    name = getattr(dtype, "name", None)
    if name in {"string", "boolean", "int64", "float64", "date"}:
        return {"type": name}
    if hasattr(dtype, "precision") and hasattr(dtype, "scale"):
        return {"type": "decimal", "precision": dtype.precision, "scale": dtype.scale}
    if hasattr(dtype, "timezone") and hasattr(dtype, "unit"):
        if dtype.timezone is None:
            _fail("/frame", "Naive timestamps are outside the presentation codec.", "unsupported_type")
        return {"type": "datetime", "timeUnit": dtype.unit, "timezone": dtype.timezone}
    _fail("/frame", "Frame contains an unsupported physical type.", "unsupported_type")


def _field(field):
    result = {"id": field.name, "slotId": field.slot_id, "dtype": _type(field.dtype),
              "nullable": field.nullable, "unit": field.unit}
    if type(field.nullable) is not bool:
        _fail("/frame", "Completed Frame requires resolved field nullability.", "unsupported_type")
    return result


def _column(field, name=None):
    return {"id": name or field.name, "label": name or field.name,
            "type": _type(field.dtype)["type"], "nullable": field.nullable,
            **({"unit": field.unit} if field.unit is not None else {})}


def read_frame(frame, *, columns=None, row_limit=MAX_ROWS):
    """Read a prefix only; no evidence, source connection or full Frame export."""
    if type(row_limit) is not int or not 1 <= row_limit <= MAX_ROWS:
        _fail("/limit", "Expected a row limit from 1 to 5000.")
    if not hasattr(frame, "schema") or not callable(getattr(frame, "read_page", None)):
        _fail("/frame", "Runtime requires public Frame schema/read_page support.", "runtime_incompatible")
    schema = frame.schema
    names = [column.name for column in schema.layout]
    if len(names) != len(set(names)):
        _fail("/columns", "Frame export names collide; use explicit aliases in the original analysis.", "duplicate_id")
    if columns is not None and (len(set(columns)) != len(columns) or any(c not in names for c in columns)):
        _fail("/columns", "Requested columns must be unique public export names.", "invalid_reference")
    selected = None if columns is None else tuple(c for c in columns if c in schema.values or c in schema.presence)
    if selected is None:
        layout = list(schema.layout)
    else:
        fields_by_slot = {c.slot_id: c for c in schema.layout if c.kind == "field"}
        layout = [c for c in schema.layout if c.kind == "coordinate"] + [
            fields_by_slot[(schema.values[c] if c in schema.values else schema.presence[c]).slot_id]
            for c in selected
        ]
    width = len(layout)
    key_count = sum(len(axis.keys) for axis in schema.axes)
    if not 1 <= width <= MAX_COLUMNS or key_count > MAX_COLUMNS:
        _fail("/columns", "Frame exceeds the presentation column budget.", "budget")
    limit = min(row_limit, MAX_CELLS // (width + key_count))
    page = frame.read_page(columns=selected, limit=limit)
    if page.input_id != schema.input_id or tuple(page.layout) != tuple(layout):
        _fail("/frame", "Frame page identity or layout differs from its schema.", "source_identity_mismatch")
    if page.has_more != (page.total_count > len(page)) or page.has_more != (page.next_cursor is not None):
        _fail("/frame", "Frame page returned inconsistent coverage.")
    rows = page.to_pandas()
    if list(rows.columns) != [c.name for c in page.layout]:
        _fail("/frame", "Detached page columns differ from its layout.")
    axes = {axis.token: axis for axis in schema.axes}
    descriptors, fields, exported = [], [], []
    for item in page.layout:
        if item.kind == "field":
            field = schema.slots[item.slot_id]
            descriptors.append(_column(field, item.name))
            fields.append({"id": item.name, "role": "value" if field.name in schema.values else "presence", "slotId": item.slot_id})
            exported.append({"kind": "field", "name": item.name, "slotId": item.slot_id})
        else:
            axis = axes[item.axis_token]
            if item.part == "key" and len(axis.keys) == 1:
                descriptors.append(_column(axis.keys[0], item.name))
            else:
                # Public temporal bounds are timezone-aware instants. Labels and
                # timezone names are text; tuple displays remain unsupported.
                kind = "datetime" if item.part in {"start", "end", "actual_start", "actual_end"} else "string"
                descriptors.append({"id": item.name, "label": item.name, "type": kind, "nullable": True})
            fields.append({"id": item.name, "role": "coordinate", "axisToken": item.axis_token})
            exported.append({"kind": "coordinate", "name": item.name, "axisToken": item.axis_token,
                             "endpoint": item.endpoint, "part": item.part})
    data = encode_rows(list(rows.columns), [list(row) for row in rows.itertuples(index=False, name=None)],
                       total_count=page.total_count, row_limit=limit, columns=descriptors)
    coordinates = {}
    for axis in schema.axes:
        for key in axis.keys:
            values = page.coordinates.get(key.slot_id)
            if values is None or len(values) != len(page):
                _fail("/frame", "Frame page omitted a complete coordinate key.")
            converted = [v.as_py() if hasattr(v, "as_py") else v for v in values]
            encoded = encode_rows([key.name], [[v] for v in converted], total_count=len(page),
                                  row_limit=limit, columns=[_column(key)])
            coordinates[key.slot_id] = {"column": encoded["columns"][0], "values": [row[0] for row in encoded["rows"]]}
    if set(page.coordinates) != set(coordinates):
        _fail("/frame", "Frame page coordinate identity differs from its schema.")
    retained_slots = {item.slot_id for item in page.layout if item.kind == "field"} | set(coordinates)
    return {
        "schemaVersion": 1, "kind": "frame", "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "coverage": {"start": 0, "totalRows": page.total_count, "capturedRows": len(page),
                     "complete": not page.has_more, "columns": list(rows.columns), "business": "unknown"},
        "source": {"kind": "frame", "sessionId": frame.session_id, "artifactId": frame.artifact_id},
        "frame": {"inputId": schema.input_id, "fields": fields, "layout": exported,
                  "axes": [{"token": a.token, "name": a.name, "role": a.role,
                            "keys": [_field(k) for k in a.keys]} for a in schema.axes],
                  "slots": [_field(f) for slot_id, f in schema.slots.items() if slot_id in retained_slots], "coordinates": coordinates,
                  "readStats": {"dataRowsRead": page.read_stats.data_rows_read,
                                "coordinateRowsRead": page.read_stats.coordinate_rows_read,
                                "receiptBytesHashed": page.read_stats.receipt_bytes_hashed},
                  "sections": {key: "not-captured" for key in ("evidence", "findings", "methods", "semantics")}},
    }
