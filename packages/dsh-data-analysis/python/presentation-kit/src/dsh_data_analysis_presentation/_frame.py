"""Bounded projection of public completed Frame schema, one detached page and its metadata."""
from __future__ import annotations

import json
from dataclasses import fields, is_dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from ._dataset import MAX_BYTES, MAX_CELLS, MAX_COLUMNS, MAX_ROWS, _fail, encode_rows

# Metadata is optional and bounded independently of data: one first page per
# audit collection, never a full scan, and never a reason to reject the rows.
AUDIT_LIMIT = 20
MAX_METHODS = 20
MAX_ITEM_FACTS = 32
MAX_ORIGINS = 32
MAX_NAME = 512
MAX_DISPLAY = 2_000
MAX_SUMMARY = 4_096
MAX_IDENTITY = 2_048
MAX_SECTION_BYTES = 64 * 1024


class _Unavailable(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _units(value):
    return len(value.encode("utf-16-le")) // 2


def _clip(value, limit, state):
    """Bound display text in UTF-16 units and record that the item was shortened."""
    if value is None:
        return None
    value = value.replace("\0", "�")
    if _units(value) <= limit:
        return value
    state["truncated"] = True
    value = value[:limit - 1]
    while _units(value) > limit - 1:
        value = value[:-1]
    return value + "…"


def _closed(value, allowed):
    """Unknown upstream variants make only this section unavailable, never the data snapshot."""
    if value not in allowed:
        raise _Unavailable("runtime-incompatible")
    return value


def _identity(value):
    """Identities are never shortened; an oversized one makes the section unavailable."""
    if type(value) is not str or not value or "\0" in value:
        raise _Unavailable("read-failed")
    if _units(value) > MAX_IDENTITY:
        raise _Unavailable("budget")
    return value


def _display(value):
    if value is None:
        return None
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int or isinstance(value, Decimal):
        return str(value)
    if type(value) is float:
        return repr(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if type(value) is str:
        return value
    raise _Unavailable("read-failed")


def _same(left, right):
    # Key types are fixed by the schema; only keep bool from equalling 1/0.
    return (type(left) is bool) == (type(right) is bool) and left == right


def _coordinates(items, schema, state):
    if len(items) > MAX_ITEM_FACTS:
        state["truncated"] = True
    result = []
    for item in items[:MAX_ITEM_FACTS]:
        slot = schema.slots.get(item.slot_id)
        result.append({"slotId": _identity(item.slot_id),
                       "name": None if slot is None else _clip(slot.name, MAX_NAME, state),
                       "value": _clip(_display(item.value), MAX_DISPLAY, state)})
    return result


def _scope(items, schema, key_slots, captured, row_count):
    """Link a record to a captured row only by its own complete, exactly matching key."""
    if not items:
        return {"kind": "unscoped"}
    values = {item.slot_id: item.value for item in items}
    if len(values) != len(items) or any(slot not in schema.slots for slot in values):
        return {"kind": "unresolved"}
    if not key_slots or not key_slots <= set(values):
        return {"kind": "partial"}
    for index in range(row_count):
        if all(_same(values[slot], captured[slot][index]) for slot in key_slots):
            return {"kind": "row", "rowIndex": index}
    return {"kind": "row-unmatched"}


def _facts(value, state, prefix=""):
    result = []
    for field in fields(value):
        item = getattr(value, field.name)
        if is_dataclass(item):
            result.extend(_facts(item, state, prefix + field.name + "."))
        else:
            result.append({"name": _clip(prefix + field.name, MAX_NAME, state),
                           "value": _clip(_display(item), MAX_DISPLAY, state)})
    return result


def _bounded(items, state):
    if len(items) > MAX_ITEM_FACTS:
        state["truncated"] = True
    return items[:MAX_ITEM_FACTS]


def _page(frame, schema, page):
    if (page.input_id != schema.input_id or page.session_id != frame.session_id
            or str(page.artifact_ref) != frame.artifact_id):
        raise _Unavailable("identity-mismatch")
    if page.total_count < len(page.items) or page.has_more != (page.next_cursor is not None):
        raise _Unavailable("read-failed")


def _evidence(frame, schema, key_slots, captured, row_count):
    page = frame.evidence(limit=AUDIT_LIMIT)
    _page(frame, schema, page)
    items = []
    for record in page.items:
        state = {}
        item = {"kind": _closed(record.kind, ("declaration", "read", "check")), "summary": _clip(record.summary, MAX_SUMMARY, state),
                "values": _bounded([{"name": _clip(name, MAX_NAME, state),
                                     "value": _clip(_display(value), MAX_DISPLAY, state)}
                                    for name, value in record.values], state),
                "coordinates": _coordinates(record.coordinates, schema, state),
                "scope": _scope(record.coordinates, schema, key_slots, captured, row_count)}
        items.append({**item, "truncated": True} if state else item)
    return {"status": "captured", "totalCount": page.total_count, "hasMore": page.has_more, "items": items}


def _findings(frame, schema, key_slots, captured, row_count):
    page = frame.findings(limit=AUDIT_LIMIT)
    _page(frame, schema, page)
    items = []
    for record in page.items:
        if record.session_id != frame.session_id or str(record.artifact_ref) != frame.artifact_id:
            raise _Unavailable("identity-mismatch")
        state = {}
        item = {"findingId": _identity(record.finding_id), "type": _identity(record.finding_type),
                "committedAt": record.committed_at.isoformat(),
                "values": _bounded(_facts(record.value, state), state),
                "coordinates": _coordinates(record.coordinates, schema, state),
                "scope": _scope(record.coordinates, schema, key_slots, captured, row_count)}
        items.append({**item, "truncated": True} if state else item)
    return {"status": "captured", "totalCount": page.total_count, "hasMore": page.has_more, "items": items}


def _methods(frame):
    facts = frame.method_facts
    items = []
    for record in facts[:MAX_METHODS]:
        state = {}
        item = {"kind": _identity(record.kind), "originResultId": _identity(record.origin_result_id),
                "targets": _bounded([{"path": _clip(".".join(t.target), MAX_NAME, state),
                                      "kind": _closed(t.kind, ("level", "absolute", "relative"))}
                                     for t in record.targets], state),
                "parentCount": len(record.parents), "coordinateCount": len(record.coordinates)}
        items.append({**item, "truncated": True} if state else item)
    return {"status": "captured", "totalCount": len(facts), "items": items}


def _origins(group):
    return [{"kind": _identity(o.kind), "path": _identity(o.path), "definitionId": _identity(o.definition_id)}
            for o in group[:MAX_ORIGINS]]


def _semantics(frame, schema, layout):
    """Static origins of displayed columns only; neither execution nor point-level proof."""
    lineage = frame.lineage
    values = {field.slot_id: name for name, field in schema.values.items()}
    presence = {field.slot_id: name for name, field in schema.presence.items()}
    columns, axes = [], set()
    for item in layout:
        if item.kind == "field":
            role = "value" if item.slot_id in values else "presence"
            name = (values if role == "value" else presence).get(item.slot_id)
            column = (lineage.values if role == "value" else lineage.presence).get(name)
            identity = item.name
        else:
            if item.axis_token in axes:
                continue
            axes.add(item.axis_token)
            role, identity, column = "axis", item.axis_token, lineage.axes.get(item.axis_token)
        if column is None:
            raise _Unavailable("identity-mismatch")
        omitted = sum(max(0, len(group) - MAX_ORIGINS)
                      for group in (column.value_origins, column.context_origins))
        columns.append({"role": role, "id": _identity(identity),
                        "valueOrigins": _origins(column.value_origins),
                        "contextOrigins": _origins(column.context_origins), "omittedOrigins": omitted})
    return {"status": "captured", "columns": columns}


def _json_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode())


def _unavailable(reason):
    return {"status": "unavailable", "reason": reason}


def _section(supported, read):
    if not supported:
        return _unavailable("runtime-incompatible")
    try:
        value = read()
    except _Unavailable as error:
        return _unavailable(error.reason)
    except Exception:
        # Raw Runtime errors may carry paths or values; disclose only the state.
        return _unavailable("read-failed")
    return value if _json_bytes(value) <= MAX_SECTION_BYTES else _unavailable("budget")


def _metadata(frame, schema, layout, captured, row_count):
    key_slots = {key.slot_id for axis in schema.axes for key in axis.keys}
    public = {name: hasattr(type(frame), name) for name in ("evidence", "findings", "method_facts", "lineage")}
    return {
        "evidence": _section(public["evidence"], lambda: _evidence(frame, schema, key_slots, captured, row_count)),
        "findings": _section(public["findings"], lambda: _findings(frame, schema, key_slots, captured, row_count)),
        "methods": _section(public["method_facts"], lambda: _methods(frame)),
        "semantics": _section(public["lineage"], lambda: _semantics(frame, schema, layout)),
    }


def _fit(snapshot):
    """Drop the largest captured metadata sections before the shared snapshot budget rejects the rows."""
    sections = snapshot["frame"]["sections"]
    while _json_bytes(snapshot) > MAX_BYTES:
        captured = [name for name, value in sections.items() if value["status"] == "captured"]
        if not captured:
            break
        largest = max(captured, key=lambda name: _json_bytes(sections[name]))
        sections[largest] = _unavailable("budget")
    return snapshot


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


def read_frame(frame, *, columns=None, row_limit=MAX_ROWS, metadata=False):
    """Read a prefix and, when requested, bounded first metadata pages; no source or full export."""
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
    coordinates, captured = {}, {}
    for axis in schema.axes:
        for key in axis.keys:
            values = page.coordinates.get(key.slot_id)
            if values is None or len(values) != len(page):
                _fail("/frame", "Frame page omitted a complete coordinate key.")
            converted = [v.as_py() if hasattr(v, "as_py") else v for v in values]
            captured[key.slot_id] = converted
            encoded = encode_rows([key.name], [[v] for v in converted], total_count=len(page),
                                  row_limit=limit, columns=[_column(key)])
            coordinates[key.slot_id] = {"column": encoded["columns"][0], "values": [row[0] for row in encoded["rows"]]}
    if set(page.coordinates) != set(coordinates):
        _fail("/frame", "Frame page coordinate identity differs from its schema.")
    retained_slots = {item.slot_id for item in page.layout if item.kind == "field"} | set(coordinates)
    return _fit({
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
                  "sections": _metadata(frame, schema, page.layout, captured, len(page)) if metadata
                  else {key: "not-captured" for key in ("evidence", "findings", "methods", "semantics")}},
    })
