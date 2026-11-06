import { z } from 'zod'

export const datasourceAuthoringSchema = z.object({
  fingerprint: z.string(),
  backends: z.array(
    z.object({
      name: z.string(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.enum(['string', 'number', 'boolean', 'json', 'credential', 'secrets']),
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
        kind = "credential" if types == {md.EnvRef} else "secrets" if field.name == "secrets" else "string" if types == {str} else "boolean" if types == {bool} else "number" if types <= {int, float} else "json"
        item = {"name": field.name, "type": kind,
            "required": field.default is dataclasses.MISSING and field.default_factory is dataclasses.MISSING,
            "description": field.metadata.get("description", "")}
        if field.default is not dataclasses.MISSING:
            item["default"] = field.default
        result.append(item)
    return result

def configuration(name, cls):
    import marivo.semantic as ms
    description = md.load().describe(name)
    details = ms.load().get("datasource:" + name).to_dict()["definition"]
    if details["backend_type"] != description.backend_type or dict(details["fields"]) != description.literal_fields or dict(details["env_refs"]) != description.env_refs:
        raise ValueError("context-changed")
    context = details["context"]
    allowed = {field["name"] for field in spec_fields(cls)}
    fields = {"name": name}
    extra = {}
    for key, value in description.literal_fields.items():
        if key in allowed and key != "extra": fields[key] = value
        else: extra[key] = value
    if extra: fields["extra"] = extra
    refs = dict(description.env_refs)
    for key in ("user", "password", "auth"):
        if key in refs and key in allowed:
            fields[key] = refs.pop(key)
    if "secrets" in fields:
        secrets = []
        for metadata in fields["secrets"]:
            item = dict(metadata)
            kind, scope = item.pop("type"), item["scope"]
            prefix = kind + "@" + scope + "."
            if kind == "s3":
                has_token = item.pop("session_token")
                for key in ("key_id", "secret") + (("session_token",) if has_token else ()):
                    item[key] = refs.pop(prefix + key)
                item["type"] = "s3"
            elif kind == "http" and "headers" in item:
                item["headers"] = {key: refs.pop(prefix + "header:" + key) for key in item["headers"]}
                item["type"] = "http_headers"
            elif kind == "http":
                item["token"] = refs.pop(prefix + "token")
                item["type"] = "http_bearer"
            else: raise ValueError("datasource-definition-invalid")
            secrets.append(item)
        fields["secrets"] = secrets
    if refs: raise ValueError("datasource-definition-invalid")
    version = hashlib.sha256(json.dumps([description.backend_type, fields, context], sort_keys=True).encode()).hexdigest()
    return {"name": name, "backend": description.backend_type, "fields": fields, "version": version}, context

try:
    payload = json.load(sys.stdin)
    with contextlib.redirect_stdout(Discard()), contextlib.redirect_stderr(Discard()):
        specs = {cls.backend_type: cls for cls in typing.get_args(md.DatasourceSpec)}
        if payload["action"] == "schema":
            result = {"backends": [{"name": key, "fields": spec_fields(cls)} for key, cls in specs.items()]}
        elif payload["action"] == "read":
            description = md.load().describe(payload["name"])
            result, _ = configuration(payload["name"], specs[description.backend_type])
        else:
            cls = specs[payload["backend"]]
            fields = payload["fields"]
            allowed = {field["name"] for field in spec_fields(cls)}
            context = None
            if payload["action"] == "update":
                current = md.load().describe(payload["name"])
                if fields.get("name") != payload["name"] or current.backend_type != payload["backend"]:
                    raise ValueError("datasource-identity-fixed")
                original, context = configuration(payload["name"], cls)
                if original["version"] != payload["version"]:
                    raise ValueError("datasource-config-changed")
            if set(fields) - allowed:
                raise ValueError("unknown-field")
            fields = dict(fields)
            hints = typing.get_type_hints(cls)
            for key, value in fields.items():
                types = set(typing.get_args(hints[key]) or [hints[key]]) - {type(None)}
                if types == {md.EnvRef} and value is not None:
                    fields[key] = md.env(value)
            if "secrets" in fields:
                secrets = []
                for raw in fields["secrets"]:
                    item = dict(raw)
                    kind = item.pop("type")
                    if kind == "s3":
                        for key in ("key_id", "secret", "session_token"):
                            if item.get(key) is not None: item[key] = md.env(item[key])
                        secrets.append(md.s3_secret(**item))
                    elif kind == "http_bearer":
                        item["token"] = md.env(item["token"])
                        secrets.append(md.http_bearer_secret(**item))
                    elif kind == "http_headers":
                        item["headers"] = {key: md.env(value) for key, value in item["headers"].items()}
                        secrets.append(md.http_headers_secret(**item))
                    else: raise ValueError("datasource-definition-invalid")
                fields["secrets"] = secrets
            spec = cls(**fields)
            if payload["action"] == "create" and any(item.name == spec.name for item in md.load().list()):
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
