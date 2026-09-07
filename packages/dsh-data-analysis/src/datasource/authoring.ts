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
export interface DatasourceCreateInput {
  backend: string
  fields: Record<string, unknown>
}

// The public DatasourceSpec union and dataclass fields are read from the checked Runtime.
// No backend registry or field schema is duplicated in the plugin.
export const DATASOURCE_AUTHORING_PROGRAM = String.raw`
import contextlib
import dataclasses
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

try:
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(Discard()), contextlib.redirect_stderr(Discard()):
        specs = {cls.backend_type: cls for cls in typing.get_args(md.DatasourceSpec)}
        if payload["action"] == "schema":
            result = {"backends": [{"name": key, "fields": spec_fields(cls)} for key, cls in specs.items()]}
        else:
            cls = specs[payload["backend"]]
            fields = payload["fields"]
            allowed = {field["name"] for field in spec_fields(cls)}
            if set(fields) - allowed:
                raise ValueError("unknown-field")
            spec = cls(**fields)
            if any(item.name == spec.name for item in md.list()):
                result = {"error": "datasource-already-exists"}
            else:
                # Validate references before writing; the Host applies its own reserved-name check too.
                if sorted(spec.env_refs.values()) != sorted(payload["refs"]):
                    raise ValueError("credential-reference-mismatch")
                md.register(spec)
                result = {"name": spec.name}
except Exception:
    result = {"error": "datasource-definition-invalid"}
print(json.dumps(result))
`.trim()
