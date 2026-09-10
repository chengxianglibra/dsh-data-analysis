import { z } from 'zod'

export const datasourceAuthoringSchema = z.object({
  fingerprint: z.string(),
  backends: z.array(
    z.object({
      name: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.enum(['string', 'number', 'boolean', 'json']),
          required: z.boolean(),
          description: z.string(),
          default: z.unknown().optional(),
        }),
      ),
    }),
  ),
})
export type DatasourceAuthoring = z.infer<typeof datasourceAuthoringSchema>
export interface DatasourceConfiguration {
  name: string
  backend: string
  fields: Record<string, unknown>
  version: string
}
export interface DatasourceUpdateInput extends DatasourceCreateInput {
  name: string
  version: string
}
export interface DatasourceCreateInput {
  backend: string
  fields: Record<string, unknown>
}

// The public DatasourceSpec union and dataclass fields are read from the checked Runtime.
// No backend registry or field schema is duplicated in the plugin.
export const DATASOURCE_AUTHORING_PROGRAM = String.raw`
import contextlib
import dataclasses
import hashlib
import json
import sys
import typing
import marivo.datasource as md

class Discard:
    def write(self, value): return len(value)
    def flush(self): pass

def spec_fields(cls):
    hints = typing.get_type_hints(cls)
    result = []
    for field in dataclasses.fields(cls):
        if not field.init or field.name == "ai_context":
            continue
        annotation = hints[field.name]
        types = set(typing.get_args(annotation) or [annotation]) - {type(None)}
        kind = "string" if types == {str} else "boolean" if types == {bool} else "number" if types <= {int, float} else "json"
        item = {"name": field.name, "type": kind,
            "required": field.default is dataclasses.MISSING and field.default_factory is dataclasses.MISSING,
            "description": field.metadata.get("description", "")}
        if field.default is not dataclasses.MISSING:
            item["default"] = field.default
        result.append(item)
    return result

def configuration(name, cls):
    import marivo.semantic as ms
    description = md.describe(name)
    details = ms.load().datasources.get(name).details()
    if details.backend_type != description.backend_type or dict(details.fields) != description.literal_fields or dict(details.env_refs) != description.env_refs:
        raise ValueError("context-changed")
    context = {"business_definition": details.context.business_definition,
        "guardrails": list(details.context.guardrails)}
    allowed = {field["name"] for field in spec_fields(cls)}
    fields = {"name": name}
    extra = {}
    for key, value in description.literal_fields.items():
        if key in allowed and key != "extra": fields[key] = value
        else: extra[key] = value
    if extra: fields["extra"] = extra
    for key, value in description.env_refs.items():
        if key.startswith("http_header:"):
            fields.setdefault("http_headers_env", {})[key.removeprefix("http_header:")] = value
        elif key + "_env" in allowed: fields[key + "_env"] = value
        else: raise ValueError("datasource-definition-invalid")
    version = hashlib.sha256(json.dumps([description.backend_type, fields, context], sort_keys=True).encode()).hexdigest()
    return {"name": name, "backend": description.backend_type, "fields": fields, "version": version}, context

try:
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(Discard()), contextlib.redirect_stderr(Discard()):
        specs = {cls.backend_type: cls for cls in typing.get_args(md.DatasourceSpec)}
        if payload["action"] == "schema":
            result = {"backends": [{"name": key, "fields": spec_fields(cls)} for key, cls in specs.items()]}
        elif payload["action"] == "read":
            description = md.describe(payload["name"])
            result, _ = configuration(payload["name"], specs[description.backend_type])
        else:
            cls = specs[payload["backend"]]
            fields = payload["fields"]
            allowed = {field["name"] for field in spec_fields(cls)}
            context = None
            if payload["action"] == "update":
                current = md.describe(payload["name"])
                if fields.get("name") != payload["name"] or current.backend_type != payload["backend"]:
                    raise ValueError("datasource-identity-fixed")
                original, context = configuration(payload["name"], cls)
                if original["version"] != payload["version"]:
                    raise ValueError("datasource-config-changed")
            if set(fields) - allowed:
                raise ValueError("unknown-field")
            spec = cls(**fields)
            if payload["action"] == "create" and any(item.name == spec.name for item in md.list()):
                result = {"error": "datasource-already-exists"}
            else:
                if sorted(spec.env_refs.values()) != sorted(payload["refs"]):
                    raise ValueError("credential-reference-mismatch")
                if context is not None:
                    import marivo.semantic as ms
                    spec = cls(**fields, ai_context=ms.ai_context(**context))
                md.register(spec)
                result = {"name": spec.name}

except Exception as exc:
    code = str(exc)
    result = {"error": code if code in ("datasource-config-changed", "datasource-identity-fixed", "context-changed") else "datasource-definition-invalid"}
print(json.dumps(result))
`.trim()
