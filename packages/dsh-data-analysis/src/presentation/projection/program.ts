import { MARIVO_PRESENTATION_SQL_CODE_PROGRAM } from './sql-code.ts'

/** Fixed public read program. Drafts contain references and data paths, never executable code. */
export const MARIVO_PRESENTATION_READ_PROGRAM = String.raw`
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import marivo.analysis as mv
import marivo.datasource as md
from dsh_data_analysis_presentation._dataset import encode_dataset


class ProjectionFailure(Exception):
    def __init__(self, code, path, message):
        self.code, self.path, self.message = code, path, message


class DenyCredentials:
    def resolve(self, request):
        raise ProjectionFailure("credential_read_forbidden", "/sources", "Persisted presentation reads cannot obtain datasource credentials.")


def text(value, limit=32768):
    result = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    result = result.replace("\0", "\\u0000")
    return result if len(result) <= limit else result[:limit - 14] + " [truncated]"


${MARIVO_PRESENTATION_SQL_CODE_PROGRAM}


def read(request):
    sessions, artifacts, contracts = {}, {}, {}
    sources, datasets, diagnostics = [], [], []
    read_at = datetime.now(timezone.utc).isoformat()
    try:
        for index, declared in enumerate(request["sources"]):
            ref = declared["ref"]
            source_path = "/sources/" + str(index)
            try:
                session = sessions.get(ref["sessionId"])
                if session is None:
                    session = mv.session.resume(ref["sessionId"], use_datasources=False)
                    sessions[ref["sessionId"]] = session
                if session.id != ref["sessionId"]:
                    raise ProjectionFailure("source_identity_mismatch", source_path + "/ref/sessionId", "Restored Session identity differs from the declared source.")
                artifact = session.artifact(ref["artifactRef"])
                contract = artifact.contract()
                meta = artifact.meta
                if artifact.ref != ref["artifactRef"] or meta.session_id != session.id or contract.ref != artifact.ref:
                    raise ProjectionFailure("source_identity_mismatch", source_path + "/ref", "Restored Artifact identity differs from the declared source.")
                if Path(meta.project_root).resolve() != Path.cwd().resolve():
                    raise ProjectionFailure("source_workspace_mismatch", source_path + "/ref", "Restored Artifact belongs to a different Workspace.")
            except ProjectionFailure:
                raise
            except Exception:
                # Only the requested source becomes unavailable. Exception messages may
                # include credentials, project paths or raw SQL and are never returned.
                sources.append({**declared, "status": "unavailable", "reason": "The declared Artifact cannot be restored through the bound Workspace public API."})
                continue

            artifacts[declared["id"]], contracts[declared["id"]] = artifact, contract
            facts = []
            def fact(label, value):
                facts.append({"label": label, "value": text(value)})
            fact("读取时间", read_at)
            fact("Artifact kind", meta.kind)
            fact("创建时间", meta.created_at.isoformat())
            fact("内容身份", meta.content_hash)
            fact("Evidence status", meta.evidence_status)
            fact("完整行数", meta.row_count)
            fact("公开语义引用", [{"role": item.role, "kind": item.semantic_kind.value, "path": item.semantic_path, "outputColumn": item.output_column} for item in contract.semantic_inputs])
            quality = meta.quality_summary
            fact("Quality", None if quality is None else {"coverage": quality.coverage, "nullRate": quality.null_rate, "sampleSize": quality.sample_size, "evaluatedCheckCount": quality.evaluated_check_count, "failedCheckCount": quality.failed_check_count, "warningCheckCount": quality.warning_check_count})
            fact("Issues", [{"kind": item.kind, "severity": item.severity} for item in contract.issues])
            if "findingId" in ref:
                try:
                    finding = artifact.finding(ref["findingId"])
                    if finding.finding_id != ref["findingId"] or finding.artifact_ref != artifact.ref or finding.session_id != session.id:
                        raise ProjectionFailure("source_identity_mismatch", source_path + "/ref/findingId", "Restored Finding identity differs from the declared source.")
                    excerpt = finding.render(max_output_bytes=4096)
                    fact("选择的 Finding", excerpt)
                except ProjectionFailure:
                    raise
                except Exception:
                    fact("选择的 Finding unavailable", "The requested Finding cannot be read through the persisted Artifact public API.")
                    diagnostics.append({"code": "finding_unavailable", "path": source_path + "/ref/findingId", "message": "Artifact is available; its requested Finding is unavailable."})
            definition_path = source_path + "/facts/" + str(len(facts))
            fact("历史定义 unavailable", "The persisted Artifact public contract does not provide a historical metric definition; no current definition was substituted.")
            diagnostics.append({"code": "definition_unavailable", "path": definition_path, "message": "Historical metric definition is unavailable in the persisted Artifact public contract."})
            fact("revalidation", "not_requested")
            sources.append({**declared, "status": "available", "label": text(str(meta.kind) + " " + artifact.ref, 512), "facts": facts, "code": sql_code_snapshot(session, artifact)})

        for selection in request["datasets"]:
            dataset_path = "/datasets/" + str(selection["index"])
            artifact = artifacts.get(selection["sourceId"])
            if artifact is None:
                raise ProjectionFailure("artifact_data_unavailable", dataset_path + "/sourceId", "A direct Artifact dataset requires an available persisted Artifact source.")
            try:
                contract = contracts[selection["sourceId"]]
                frame = artifact.to_pandas()
                public_columns = list(contract.artifact_schema.columns)
                if list(frame.columns) != [column.name for column in public_columns] or len(frame) != artifact.meta.row_count or artifact.row_count != len(frame):
                    raise ProjectionFailure("artifact_data_identity_mismatch", dataset_path, "Artifact rows or columns disagree with its public contract.")
                names = selection.get("columns", list(frame.columns))
                by_name = {column.name: column for column in public_columns}
                if any(name not in by_name for name in names):
                    raise ProjectionFailure("invalid_reference", dataset_path + "/columns", "A requested column is absent from the public Artifact schema.")
                # Use public terminal values; declared upstream dtypes cannot recover
                # Decimal precision already lost by to_pandas(). No derived metrics.
                data = encode_dataset(frame.loc[:, names], row_limit=selection["rowLimit"])
                for column in data["columns"]:
                    column["nullable"] = by_name[column["id"]].nullable
                datasets.append({"id": selection["id"], "data": data})
            except ProjectionFailure:
                raise
            except Exception as error:
                # Preserve helper contract locations without leaking upstream error text.
                code = getattr(error, "code", None)
                location = getattr(error, "path", None)
                if code in ("numeric_precision", "budget", "invalid_value") and isinstance(location, str):
                    raise ProjectionFailure(code, dataset_path + "/data" + location, "Public Artifact values cannot be encoded within the presentation data contract.") from None
                raise ProjectionFailure("artifact_data_unavailable", dataset_path + "/data", "The direct Artifact does not expose the required typed presentation data.") from None
        return {"ok": True, "sources": sources, "datasets": datasets, "diagnostics": diagnostics}
    finally:
        for session in sessions.values():
            session.close()


try:
    request = json.loads(sys.argv[1])
    with md.credential_scope(resolver=DenyCredentials()):
        result = read(request)
except ProjectionFailure as error:
    result = {"ok": False, "error": {"code": error.code, "path": error.path, "message": error.message}}
except Exception:
    result = {"ok": False, "error": {"code": "projection_read_failed", "path": "/sources", "message": "The bound public presentation read failed."}}
print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
`.trim()
