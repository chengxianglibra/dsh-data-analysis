import { CATALOG_READ_HELPERS } from '../semantic-reference/catalog-program.ts'
import { CATALOG_FORMAT_VERSION } from './contracts.ts'

/** Explicit projection of public captured definitions; never reads source rows or credentials. */
export const BROWSER_CATALOG_PROGRAM = String.raw`
import contextlib, json, sys

class DiscardOutput:
    def write(self, text): return len(text)
    def flush(self): pass

with contextlib.redirect_stdout(DiscardOutput()), contextlib.redirect_stderr(DiscardOutput()):
    import marivo.semantic as ms
    from marivo.refs import SemanticKind
    from marivo.semantic.errors import SemanticError, SemanticLoadFailed

${CATALOG_READ_HELPERS}

FIELDS = {
    "domain": "owner default members",
    "datasource": "backend_type entities",
    "entity": "datasource primary_key versioning default_time fields dependencies",
    "dimension": "entity unit additivity default_time parse sample_interval is_default_time dependencies",
    "measure": "entity unit additivity default_time parse sample_interval is_default_time dependencies",
    "time_dimension": "entity unit additivity default_time parse sample_interval is_default_time dependencies",
    "metric": "roots unit dependencies",
    "relationship": "from_entity to_entity keys cardinality dependencies",
    "period_calendar": "date boundary_timezone coverage levels correspondences",
    "temporal_set": "occurrence_id start end category boundary_timezone coverage",
}

def display(value):
    if isinstance(value, str): return value
    return json.dumps(value, ensure_ascii=False, indent=2)

def display_field(name, value):
    result = {"name": name, "value": display(value)}
    if isinstance(value, (list, dict)): result["structured"] = True
    return result

def project(entry):
    payload = entry.to_dict()
    definition, provenance = payload["definition"], payload["provenance"]
    fields = [display_field(name, definition[name])
              for name in FIELDS[entry.kind].split() if definition.get(name) is not None]
    # Project table identity only; file locations may contain signed URLs or credentials.
    if entry.kind == "entity":
        source = definition["source"]
        fields.append({"name": "source_kind", "value": source["kind"]})
        if source["kind"] == "table":
            for name in ("table", "database"):
                if source.get(name) is not None:
                    fields.append({"name": "source_" + name, "value": display(source[name])})
    relations = []
    for relation in ("dependencies", "dependents"):
        for related in pages(lambda cursor: entry.related(relation, limit=100, cursor=cursor)):
            relations.append({"field": relation, "ref": wire_ref(related)})
    # Link exact canonical identities exposed in selected public definition fields.
    kinds = {kind.value for kind in SemanticKind}
    def field_refs(value, field):
        if isinstance(value, str) and value.count(":") == 1 and value.split(":")[0] in kinds:
            kind, path = value.split(":")
            relations.append({"field": field, "ref": {"schema": "marivo.semantic_ref/v1", "kind": kind, "path": path}})
        elif isinstance(value, list):
            for item in value: field_refs(item, field)
        elif isinstance(value, dict):
            for item in value.values(): field_refs(item, field)
    for name in FIELDS[entry.kind].split():
        field_refs(definition.get(name), name)
    # MetricTimeBinding declares exact refs in field, path and entity_default.
    if entry.kind == "metric":
        for binding in definition.get("time_bindings", []):
            for name in ("field", "path", "entity_default"):
                field_refs(binding.get(name), "time_bindings")
    relations = list({(r["field"], r["ref"]["kind"], r["ref"]["path"]): r for r in relations}.values())
    computation = None
    if entry.kind in ("metric", "measure", "dimension", "time_dimension"):
        computation = {
            "schema": "dsh-data-analysis-computation/v1",
            "ref": wire_ref(entry),
            "catalog_definition_fingerprint": provenance["definition_fingerprint"],
            "expression": definition.get("formula", definition.get("expression", "")),
            "facts": [display_field(name, definition[name])
                      for name in ("reductions", "conditions", "time_bindings", "null_rules", "facts")
                      if definition.get(name)],
        }
    return {
        "computation": computation, "ref": wire_ref(entry), "name": entry.name, "domain": entry.domain,
        "definition": definition["context"]["business_definition"],
        "guardrails": definition["context"]["guardrails"],
        "source": {"file": provenance["source_file"], "line": provenance["source_line"], "symbol": provenance["python_symbol"]},
        "fields": fields, "relations": relations,
    }

try:
    with contextlib.redirect_stdout(DiscardOutput()), contextlib.redirect_stderr(DiscardOutput()):
        catalog = ms.load(workspace_dir=sys.argv[1])
        result = {
            "formatVersion": ${CATALOG_FORMAT_VERSION},
            "fingerprint": catalog.definition_fingerprint,
            "kinds": [kind.value for kind in SemanticKind],
            "objects": [project(entry) for entry in pages(lambda cursor: catalog.search(limit=100, cursor=cursor))],
        }
except (SemanticLoadFailed, SemanticError) as error:
    print(json.dumps({"schema": "marivo.semantic_catalog_error/v1", "kind": "semantic", "message": str(error)}, ensure_ascii=True))
    raise SystemExit(1)
print(json.dumps(result, ensure_ascii=True))
`.trim()
