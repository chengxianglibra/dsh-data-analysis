/** Explicit public Details projection. No object dump, source-code read or data operation. */
export const BROWSER_CATALOG_PROGRAM = String.raw`
import contextlib, json, sys
from datetime import date, datetime
from enum import Enum
from collections.abc import Mapping

class DiscardOutput:
    def write(self, text):
        return len(text)
    def flush(self):
        pass

with contextlib.redirect_stdout(DiscardOutput()), contextlib.redirect_stderr(DiscardOutput()):
    import marivo.semantic as ms
    from marivo.refs import Ref, RefPayloadV1, SemanticKind

    FIELDS = {
        "domain": "owner default",
        "datasource": "backend_type",
        "entity": "datasource primary_key",
        "dimension": "entity",
        "measure": "entity unit additivity",
        "time_dimension": "entity parse_kind data_type granularity format timezone is_default sample_interval",
        "metric": "metric_type entities root_entity aggregation aggregation_target aggregation_target_kind measure unit additivity fold status_time_dimension fanout_policy filter effective_entities candidate_dimensions candidate_time_dimensions measure_lineage weighted_mean_value weighted_mean_weight composition components linear_terms required_relationships parity_status",
        "relationship": "from_entity to_entity from_keys to_keys",
        "event": "source_entity identity occurred_at participants predicate_kind definition_fingerprint",
        "state_model": "subject states inceptions transitions definition_fingerprint",
        "period_calendar": "date boundary_timezone coverage correspondences snapshot_status snapshot_digest",
        "temporal_set": "boundary_timezone coverage occurrence_id start end category occurrence_count snapshot_status",
        "work_schedule": "boundary_timezone coverage date is_working snapshot_status",
    }

    def ref_payload(value):
        return RefPayloadV1.from_ref(value).to_dict()

    # Traversal is restricted to values of the explicitly selected public fields.
    def display(value, field, relations):
        if isinstance(value, Ref):
            relations.append({"field": field, "ref": ref_payload(value)})
            return value.key
        if isinstance(value, Enum):
            return str(value.value)
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        if value is None:
            return "—"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (str, int, float)):
            return str(value)
        if isinstance(value, (tuple, list)):
            return "\n".join(display(v, field, relations) for v in value)
        if isinstance(value, Mapping):
            return "\n".join(str(k) + ": " + display(v, field, relations) for k, v in value.items())
        # Public temporal value, not a generic repr of a Python object.
        if field == "sample_interval":
            return value.to_token()
        raise TypeError("unsupported display field: " + field)

    def project(entry):
        d = entry.details()
        relations, fields = [], []
        def add(name, value):
            if value is not None:
                fields.append({"name": name, "value": display(value, name, relations)})
        for name in FIELDS.get(entry.kind.value, "").split():
            if hasattr(d, name):
                add(name, getattr(d, name))
        for name in ("parents", "children", "dependents"):
            for ref in getattr(d, name):
                relations.append({"field": name, "ref": ref_payload(ref)})
        if entry.kind.value == "entity":
            source = d.source
            add("source_kind", source.kind)
            # Remote file URLs may contain credentials. Only table identity is projected.
            if source.kind == "table":
                add("source_table", source.table)
                add("source_database", source.database)
            version = d.versioning
            if version is not None:
                for name in ("kind", "partition_field", "grain", "timezone", "format", "valid_from", "valid_to", "interval", "open_end"):
                    if hasattr(version, name):
                        add("version_" + name, getattr(version, name))
        if entry.kind.value == "period_calendar":
            for level in d.levels:
                add("level", level.name)
                for name in ("key_ref", "period_count", "direct_finer_levels", "direct_coarser_levels", "rollup_targets"):
                    add("level_" + name, getattr(level, name))
        computation = d.definition.to_dict() if entry.kind.value in ("metric", "measure", "dimension", "time_dimension") else None
        def definition_refs(value, role="definition"):
            if isinstance(value, dict):
                if value.get("schema") == "marivo.semantic_ref/v1":
                    relations.append({"field": role, "ref": value})
                else:
                    for key, item in value.items():
                        definition_refs(item, role + "." + key)
            elif isinstance(value, list):
                for item in value:
                    definition_refs(item, role)
        if computation is not None:
            definition_refs(computation["node"])
            definition_refs(computation["temporal"], "temporal")
        unique = {(r["field"], r["ref"]["kind"], r["ref"]["path"]): r for r in relations}
        return {
            "computation": computation, "ref": ref_payload(entry.ref), "name": entry.name, "domain": d.domain,
            "definition": d.context.business_definition, "guardrails": list(d.context.guardrails),
            "source": {"file": d.source_location.file, "line": d.source_location.line, "symbol": d.python_symbol},
            "fields": fields, "relations": list(unique.values()),
        }

    catalog = ms.load(workspace_dir=sys.argv[1])
    result = {
        "fingerprint": catalog.definition_fingerprint,
        "kinds": [kind.value for kind in SemanticKind],
        "objects": [project(entry) for kind in SemanticKind for entry in catalog.items(kind).items],
    }
print(json.dumps(result, ensure_ascii=True))
`.trim()
