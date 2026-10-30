"""Bounded schemaVersion 2 projection of a completed Frame: one detached page and its public business semantics."""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

from ._dataset import MAX_BYTES, MAX_CELLS, MAX_COLUMNS, MAX_ROWS, _fail, _kind, encode_rows

# Metadata is optional and bounded independently of data; it never rejects the rows.
MAX_ORIGINS = 32
MAX_FIXED = 32
MAX_GROUPS = 32
MAX_FACTS = 16
MAX_TEXT = 512
MAX_DISPLAY = 2_000
MAX_IDENTITY = 2_048
MAX_SAFE_INTEGER = 9_007_199_254_740_991
# Per-section JSON caps. Periods carry up to 5000 items (about 230 bytes per calendar
# period), so 1.5 MiB keeps a full daily directory. Attribute Frames export about 50
# columns with up to 20 origins each (about 125 KB of lineage), so semantics allows
# 256 KiB. _fit still enforces the shared 2 MiB snapshot budget, largest section first.
SECTION_BYTES = {"semantics": 256 * 1024, "interpretation": 256 * 1024, "periods": 1536 * 1024}
INTERPRETATION_MEMBERS = ("fixed_axes", "value_contexts", "comparisons", "decompositions", "alignments")
GRAIN_UNITS = ("second", "minute", "hour", "day", "week", "month", "quarter", "year")
ENDPOINTS = ("self", "left", "right")
ROW_SCOPES = ("complete", "restricted")
DECOMPOSITION_ROLES = (
    "contribution", "total", "observed_total", "share", "value", "current", "baseline", "absolute",
    "numerator", "denominator", "valid_count", "current_present", "baseline_present", "value_present",
    "numerator_current", "numerator_baseline", "denominator_current", "denominator_baseline",
    "valid_count_current", "valid_count_baseline", "effect_within", "effect_mix", "effect_entry_exit",
    "effect_additive", "contribution_std_error",
)
TIME_ROLES = ("calendar", "interval", "paired")


class _Unavailable(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _units(value):
    return len(value.encode("utf-16-le")) // 2


def _clip(value, limit):
    """Bound display text in UTF-16 units."""
    value = value.replace("\0", "�")
    if _units(value) <= limit:
        return value
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


def _text(value):
    """Names and labels are never shortened either; the contract bounds them to 512 units."""
    if type(value) is not str or not value or "\0" in value:
        raise _Unavailable("read-failed")
    if _units(value) > MAX_TEXT:
        raise _Unavailable("budget")
    return value


def _bounded(items, limit):
    items = tuple(items)
    if len(items) > limit:
        raise _Unavailable("budget")
    return items


def _instant(value):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise _Unavailable("read-failed")
    return value.isoformat()


def _origin(item):
    return {"kind": _identity(item.kind), "path": _identity(item.path), "definitionId": _identity(item.definition_id)}


def _origin_list(group):
    return [_origin(item) for item in _bounded(group, MAX_ORIGINS)]


def _key(values, fields=None):
    """Encode one complete key with the coordinate codec of its owning key fields.

    Period endpoint key fields are not public; FrameKeyScalar values are typed, so
    their own scalar type selects the same codec instead of a guessed field.
    """
    values = [v.as_py() if hasattr(v, "as_py") else v for v in values]
    if not values or len(values) > MAX_COLUMNS:
        raise _Unavailable("read-failed")
    names = [f"k{index}" for index in range(len(values))]
    if fields is None:
        columns = []
        for name, value in zip(names, values):
            kind = "string" if value is None else _kind(value)
            if kind == "unsupported":
                raise _Unavailable("read-failed")
            columns.append({"id": name, "label": name, "type": kind, "nullable": True})
    else:
        fields = tuple(fields)
        if len(fields) != len(values):
            raise _Unavailable("identity-mismatch")
        columns = [_column(field, name) for field, name in zip(fields, names)]
    row = encode_rows(names, [values], total_count=1, columns=columns)["rows"][0]
    if any(type(cell) is str and _units(cell) > MAX_DISPLAY for cell in row):
        raise _Unavailable("budget")
    return row


def _label(value):
    if type(value) is bool:
        return value
    if type(value) is str:
        if _units(value) > MAX_DISPLAY or "\0" in value:
            raise _Unavailable("budget")
        return value
    if type(value) is int and abs(value) <= MAX_SAFE_INTEGER:
        return value
    if type(value) is float and math.isfinite(value):
        return value
    raise _Unavailable("read-failed")


def _grain(grain):
    kind = _closed(grain.kind, ("builtin", "named"))
    if kind == "builtin":
        if type(grain.step) is not int or grain.step < 1:
            raise _Unavailable("read-failed")
        return {"kind": kind, "unit": _closed(grain.unit, GRAIN_UNITS), "step": grain.step}
    return {"kind": kind, "ref": _origin(grain.ref), "level": _text(grain.level)}


def _endpoint(endpoint, allowed=("calendar", "interval")):
    kind = _closed(endpoint.kind, allowed)
    result = {"kind": kind, "name": _text(endpoint.name),
              "at": None if endpoint.at is None else _instant(endpoint.at), "timezone": _text(endpoint.timezone)}
    if kind == "calendar":
        result["grain"] = _grain(endpoint.grain)
    return result


def _variant(axis):
    role = axis.role
    if role in ("field", "identity"):
        return {"kind": "ordinary"}
    if role == "calendar":
        return {"kind": "calendar", "timezone": _text(axis.timezone), "grain": _grain(axis.grain)}
    if role == "interval":
        return {"kind": "interval", "timezone": _text(axis.timezone)}
    if role == "paired":
        return {"kind": "paired", "left": _endpoint(axis.left), "right": _endpoint(axis.right)}
    raise _Unavailable("runtime-incompatible")


def _fixed(item):
    axis = item.axis
    keys = _bounded(axis.keys, MAX_COLUMNS)
    if not keys:
        raise _Unavailable("read-failed")
    return {"token": _text(axis.token), "name": _text(axis.name), "role": _closed(axis.role, ("field", "identity")),
            "keys": [_field(key) for key in keys], "key": _key(item.key, keys), "origins": _origin_list(item.origins)}


def _interpretation(schema):
    """Resolve internal IDs to current names, axis tokens and snapshot indexes."""
    tokens = {axis.token for axis in schema.axes}
    values, presence = set(schema.values), set(schema.presence)
    comparisons = _bounded(schema.comparisons, MAX_FACTS)
    indexes = {}
    for index, item in enumerate(comparisons):
        if item.input_id != schema.input_id or item.comparison_id in indexes:
            raise _Unavailable("identity-mismatch")
        indexes[item.comparison_id] = index

    def token(value):
        if value not in tokens:
            raise _Unavailable("identity-mismatch")
        return value

    def current(name, names):
        if name not in names:
            raise _Unavailable("identity-mismatch")
        return _text(name)

    def comparison(identity):
        if identity not in indexes:
            raise _Unavailable("identity-mismatch")
        return indexes[identity]

    def group(item):
        kind = _closed(item.kind, ("axis", "fixed"))
        if kind == "axis":
            return {"kind": kind, "axisToken": token(item.axis_token)}
        return {"kind": kind, "fixed": _fixed(item.fixed)}

    def groups(items):
        return [group(item) for item in _bounded(items, MAX_GROUPS)]

    def value_input(item):
        kind = _closed(item.kind, ("named", "derived"))
        if kind == "named":
            return {"kind": kind, "name": _text(item.name),
                    "subject": None if item.subject is None else _origin(item.subject)}
        return {"kind": kind, "origins": _origin_list(item.origins)}

    def time(item):
        if item is None:
            return None
        kind = _closed(item.kind, ("axis", "compared", "fixed"))
        if kind == "axis":
            return {"kind": kind, "axisToken": token(item.axis_token), "endpoint": _closed(item.endpoint, ENDPOINTS)}
        if kind == "compared":
            return {"kind": kind, "comparison": comparison(item.comparison_id),
                    "endpoint": _closed(item.endpoint, ("current", "baseline"))}
        return {"kind": kind, "start": _instant(item.start), "end": _instant(item.end), "timezone": _text(item.timezone)}

    def window(item):
        if item is None:
            return None
        kind = _closed(item.kind, ("all_history", "since", "to_date", "trailing_duration", "trailing_periods"))
        if kind == "all_history":
            return {"kind": kind}
        if kind == "since":
            return {"kind": kind, "start": _instant(item.start)}
        if kind == "to_date":
            return {"kind": kind, "grain": _grain(item.grain)}
        if kind == "trailing_duration":
            if not isinstance(item.duration, timedelta) or item.duration.total_seconds() <= 0:
                raise _Unavailable("read-failed")
            return {"kind": kind, "seconds": item.duration.total_seconds()}
        if type(item.count) is not int or item.count < 1:
            raise _Unavailable("read-failed")
        return {"kind": kind, "count": item.count}

    def context(item):
        if item is None:
            return None
        kind = _closed(item.kind, ("observation", "statistic", "share", "pair_statistic"))
        if kind == "observation":
            return {"kind": kind, "subject": None if item.subject is None else _origin(item.subject),
                    "time": time(item.time), "window": window(item.window)}
        scope = _closed(item.row_scope, ROW_SCOPES)
        if kind == "statistic":
            return {"kind": kind, "statistic": _closed(item.statistic, ("sum", "mean", "row_count")),
                    "groups": groups(item.groups), "rowScope": scope}
        if kind == "share":
            return {"kind": kind, "numerator": value_input(item.numerator), "groups": groups(item.groups),
                    "along": groups(item.along), "rowScope": scope}
        return {"kind": kind, "statistic": _closed(item.statistic, ("pearson", "spearman", "pair_count")),
                "x": value_input(item.x), "y": value_input(item.y), "groups": groups(item.groups), "rowScope": scope}

    def binding(item):
        kind = _closed(item.kind, ("ordinary", "calendar", "interval"))
        if kind == "ordinary":
            return {"kind": kind}
        return {"kind": kind, "axisToken": token(item.current_axis_token),
                "endpoint": _closed(item.current_endpoint, ENDPOINTS), "baseline": _endpoint(item.baseline, (kind,))}

    def compared(item):
        status = item.presence
        return {
            "alias": None if item.alias is None else _text(item.alias),
            "groups": [{"name": _text(g.name),
                        "values": [{"role": _closed(v.role, ("current", "baseline", "absolute", "relative")),
                                    "name": current(v.name, values)} for v in _bounded(g.values, MAX_COLUMNS)],
                        "currentContext": context(g.current_context),
                        "baselineContext": context(g.baseline_context)}
                       for g in _bounded(item.groups, MAX_COLUMNS)],
            "binding": binding(item.binding),
            "presence": None if status is None else {
                "current": current(status.current, presence), "baseline": current(status.baseline, presence),
                "enclosing": [current(name, presence) for name in _bounded(status.enclosing, MAX_GROUPS)]},
            "currentFixedAxes": [_fixed(f) for f in _bounded(item.current_fixed_axes, MAX_FIXED)],
            "baselineFixedAxes": [_fixed(f) for f in _bounded(item.baseline_fixed_axes, MAX_FIXED)],
        }

    def target(item):
        kind = _closed(item.kind, ("level", "absolute", "relative"))
        if kind == "level":
            return {"kind": kind, "name": _text(item.name), "context": context(item.context)}
        index = comparison(item.comparison_id)
        names = [g.name for g in comparisons[index].groups if g.group_id == item.group_id]
        if len(names) != 1:
            raise _Unavailable("identity-mismatch")
        return {"kind": kind, "comparison": index, "group": _text(names[0])}

    def decomposed(item):
        outputs = []
        for output in _bounded(item.outputs, MAX_COLUMNS):
            kind = _closed(output.field_kind, ("value", "presence"))
            outputs.append({"fieldKind": kind, "role": _closed(output.role, DECOMPOSITION_ROLES),
                            "name": current(output.name, values if kind == "value" else presence)})
        return {"target": target(item.target), "groups": groups(item.groups),
                "rowScope": _closed(item.row_scope, ROW_SCOPES), "outputs": outputs}

    def coordinate(item):
        # Public variants: FrameFixedGroup carries kind="fixed"; FrameAlignmentAxis is the axis_token form.
        kind = getattr(item, "kind", None)
        if kind == "fixed":
            return {"kind": kind, "fixed": _fixed(item.fixed)}
        if kind is not None or not hasattr(item, "axis_token"):
            raise _Unavailable("runtime-incompatible")
        return {"kind": "axis", "axisToken": token(item.axis_token), "endpoint": _closed(item.endpoint, ENDPOINTS)}

    def side(item):
        names = _bounded(item.presence, MAX_GROUPS)
        if not names:
            raise _Unavailable("read-failed")
        return {"values": [current(name, values) for name in _bounded(item.values, MAX_COLUMNS)],
                "presence": [current(name, presence) for name in names],
                "coordinates": [coordinate(c) for c in _bounded(item.coordinates, MAX_GROUPS)]}

    def aligned(item):
        if item.input_id != schema.input_id:
            raise _Unavailable("identity-mismatch")
        return {"left": side(item.left), "right": side(item.right)}

    contexts = _bounded(schema.value_contexts.items(), MAX_COLUMNS)
    return {
        "status": "captured",
        "fixedAxes": [_fixed(item) for item in _bounded(schema.fixed_axes, MAX_FIXED)],
        "valueContexts": {current(name, values): context(item) for name, item in contexts},
        "comparisons": [compared(item) for item in comparisons],
        "decompositions": [decomposed(item) for item in _bounded(schema.decompositions, MAX_FACTS)],
        "alignments": [aligned(item) for item in _bounded(schema.alignments, MAX_FACTS)],
    }


def _period(item, fields):
    kind = _closed(item.kind, ("calendar", "interval"))
    result = {"kind": kind, "key": _key(item.key, fields), "timezone": _text(item.timezone),
              "start": _instant(item.start), "end": _instant(item.end)}
    if kind == "calendar":
        result.update(label=_label(item.label), nominalStart=_instant(item.nominal_start),
                      nominalEnd=_instant(item.nominal_end))
    return result


def _period_item(item, expected, fields):
    kind = _closed(item.kind, ("calendar", "interval", "paired", "comparison"))
    if kind != expected:
        raise _Unavailable("read-failed")
    if kind in ("calendar", "interval"):
        return _period(item, fields)
    if kind == "paired":
        return {"kind": kind, "key": _key(item.key, fields),
                "left": None if item.left is None else _period(item.left, None),
                "right": None if item.right is None else _period(item.right, None)}
    return {"kind": kind, "key": _key(item.key, fields), "current": _period(item.current, fields),
            "baseline": None if item.baseline is None else _period(item.baseline, None),
            "absentReason": None if item.absent_reason is None
            else _closed(item.absent_reason, ("period_absent", "cutoff_absent", "unmatched"))}


def _periods(frame, schema):
    """One bounded first page per time axis and time comparison; the shared item budget is split evenly."""
    handles = tuple(frame.axes)
    if len(handles) != len(schema.axes):
        raise _Unavailable("identity-mismatch")
    axes = {axis.token: axis for axis in schema.axes}
    targets = []
    for handle, axis in zip(handles, schema.axes):
        if handle.token != axis.token:
            raise _Unavailable("identity-mismatch")
        role = _closed(axis.role, ("field", "identity", *TIME_ROLES))
        if role in TIME_ROLES:
            targets.append(({"kind": "axis", "axisToken": axis.token}, handle, role, axis))
    for index, item in enumerate(schema.comparisons):
        kind = _closed(item.binding.kind, ("ordinary", "calendar", "interval"))
        if kind == "ordinary":
            continue
        owner = axes.get(item.binding.current_axis_token)
        if owner is None:
            raise _Unavailable("identity-mismatch")
        if index >= MAX_FACTS:
            raise _Unavailable("budget")
        targets.append(({"kind": "comparison", "comparison": index}, item, "comparison", owner))
    if len(targets) > MAX_COLUMNS:
        raise _Unavailable("budget")
    limit = MAX_ROWS // max(1, len(targets))
    pages = []
    for target, handle, expected, axis in targets:
        page = frame.read_periods(handle, limit=limit)
        if page.input_id != schema.input_id or (
                getattr(page.target, "token", None) != axis.token if target["kind"] == "axis"
                else getattr(page.target, "comparison_id", None) != handle.comparison_id):
            raise _Unavailable("identity-mismatch")
        items = tuple(page.items)
        if (type(page.total_count) is not int or page.total_count < len(items) or len(items) > limit
                or page.has_more != (page.next_cursor is not None)
                or page.has_more != (page.total_count > len(items))):
            raise _Unavailable("read-failed")
        pages.append({"target": target, "totalCount": page.total_count, "hasMore": page.has_more,
                      "items": [_period_item(item, expected, axis.keys) for item in items]})
    return {"status": "captured", "pages": pages}


def _semantic_origins(group):
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
                        "valueOrigins": _semantic_origins(column.value_origins),
                        "contextOrigins": _semantic_origins(column.context_origins), "omittedOrigins": omitted})
    return {"status": "captured", "columns": columns}


def _json_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode())


def _unavailable(reason):
    return {"status": "unavailable", "reason": reason}


def _section(name, supported, read):
    if not supported:
        return _unavailable("runtime-incompatible")
    try:
        value = read()
        size = _json_bytes(value)
    except _Unavailable as error:
        return _unavailable(error.reason)
    except AttributeError:
        # A public member this reader needs is missing; never try another read path.
        return _unavailable("runtime-incompatible")
    except Exception:
        # Raw Runtime errors may carry paths or values; disclose only the state.
        return _unavailable("read-failed")
    return value if size <= SECTION_BYTES[name] else _unavailable("budget")


def _dependent(sections):
    """Comparison period pages index interpretation.comparisons and cannot outlive it."""
    interpretation, periods = sections["interpretation"], sections["periods"]
    if (periods["status"] == "captured" and interpretation["status"] != "captured"
            and any(page["target"]["kind"] == "comparison" for page in periods["pages"])):
        sections["periods"] = _unavailable(interpretation["reason"])
    return sections


def _sections(frame, schema, layout):
    return _dependent({
        "semantics": _section("semantics", hasattr(type(frame), "lineage"),
                              lambda: _semantics(frame, schema, layout)),
        "interpretation": _section("interpretation", all(hasattr(schema, n) for n in INTERPRETATION_MEMBERS),
                                   lambda: _interpretation(schema)),
        "periods": _section("periods", hasattr(type(frame), "axes") and callable(getattr(frame, "read_periods", None))
                            and hasattr(schema, "comparisons"), lambda: _periods(frame, schema)),
    })


def _fit(snapshot):
    """Drop the largest captured metadata sections before the shared snapshot budget rejects the rows."""
    sections = snapshot["frame"]["sections"]
    while _json_bytes(snapshot) > MAX_BYTES:
        captured = [name for name, value in sections.items() if value["status"] == "captured"]
        if not captured:
            break
        largest = max(captured, key=lambda name: _json_bytes(sections[name]))
        sections[largest] = _unavailable("budget")
        _dependent(sections)
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


def _artifact(frame):
    """Only stored roots carry a commit identity; Marivo states that in a structured rejection."""
    try:
        return frame.artifact_id
    except Exception as error:
        if getattr(error, "location", None) == "frame.artifact_id":
            return None
        raise


def read_frame(frame, *, columns=None, row_limit=MAX_ROWS):
    """Read a prefix and bounded public business semantics; no source, full export or computation."""
    if type(row_limit) is not int or not 1 <= row_limit <= MAX_ROWS:
        _fail("/limit", "Expected a row limit from 1 to 5000.")
    if (not hasattr(frame, "schema") or not callable(getattr(frame, "read_page", None))
            or not all(hasattr(type(frame), n) for n in ("session_id", "artifact_id", "description"))):
        _fail("/frame", "Runtime requires public Frame schema/read_page/identity support.", "runtime_incompatible")
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
    try:
        page = frame.read_page(columns=selected, limit=limit)
    except Exception as error:
        # A pending expression is never computed here; Marivo's structured rejection is the signal.
        if getattr(error, "location", None) == "frame.read_page" and getattr(error, "received", None) == "expression":
            _fail("/frame", "Frame is a pending expression; capture the Frame returned by compute() or persist().",
                  "frame_not_computed")
        raise
    if page.input_id != schema.input_id or tuple(page.layout) != tuple(layout):
        _fail("/frame", "Frame page identity or layout differs from its schema.", "source_identity_mismatch")
    if page.has_more != (page.total_count > len(page)) or page.has_more != (page.next_cursor is not None):
        _fail("/frame", "Frame page returned inconsistent coverage.")
    rows = page.to_pandas()
    if list(rows.columns) != [c.name for c in page.layout]:
        _fail("/frame", "Detached page columns differ from its layout.")
    try:
        variants = {axis.token: _variant(axis) for axis in schema.axes}
    except (_Unavailable, AttributeError):
        _fail("/frame", "Runtime axis structure is outside the presentation contract.", "runtime_incompatible")
    artifact_id = _artifact(frame)
    description = None if artifact_id is None else frame.description
    if description is not None and type(description) is not str:
        _fail("/frame", "Runtime Frame description is not text.", "runtime_incompatible")
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
                # Marivo CoordinateExportColumn.part: bounds are timezone-aware
                # instants, labels are text; tuple displays remain unsupported.
                kind = "datetime" if item.part in {"start", "end", "nominal_start", "nominal_end"} else "string"
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
    return _fit({
        "schemaVersion": 2, "kind": "frame", "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "coverage": {"start": 0, "totalRows": page.total_count, "capturedRows": len(page),
                     "complete": not page.has_more, "columns": list(rows.columns), "business": "unknown"},
        "source": {"kind": "frame", "sessionId": frame.session_id, "artifactId": artifact_id},
        "frame": {"inputId": schema.input_id,
                  "description": None if description is None else _clip(description, MAX_DISPLAY),
                  "fields": fields, "layout": exported,
                  "axes": [{"token": a.token, "name": a.name, "role": a.role,
                            "keys": [_field(k) for k in a.keys], "variant": variants[a.token]} for a in schema.axes],
                  "slots": [_field(f) for slot_id, f in schema.slots.items() if slot_id in retained_slots], "coordinates": coordinates,
                  "readStats": {"dataRowsRead": page.read_stats.data_rows_read,
                                "coordinateRowsRead": page.read_stats.coordinate_rows_read,
                                "receiptBytesHashed": page.read_stats.receipt_bytes_hashed},
                  "sections": _sections(frame, schema, page.layout)},
    })
