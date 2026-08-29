import { createHash } from 'node:crypto'
import { access, constants, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { admitDoctorReport, parseDoctorReport } from './doctor.ts'
import { MarivoEnvironmentError } from './errors.ts'
import { FixedSubprocessPolicy } from './subprocess.ts'
import type {
  DoctorReport,
  ImportIdentity,
  MarivoEnvironmentBinding,
  MarivoEnvironmentConfig,
  SubprocessLimits,
} from './types.ts'

const DOCTOR_LIMITS: Readonly<Partial<SubprocessLimits>> = Object.freeze({
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_048_576,
  stderrMaxBytes: 65_536,
})

const IDENTITY_LIMITS: Readonly<Partial<SubprocessLimits>> = Object.freeze({
  timeoutMs: 10_000,
  stdoutMaxBytes: 16_384,
  stderrMaxBytes: 16_384,
})

const IMPORT_IDENTITY_SCRIPT = String.raw`
import json
import os
import sys
import marivo

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
print(json.dumps(actual, sort_keys=True))
`.trim()

const CHECKED_HELP_SCRIPT = String.raw`
import json
import os
import sys
import marivo

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
marivo.help(sys.argv[4])
`.trim()

const CHECKED_DATASOURCE_DESCRIBE_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import marivo.datasource as md

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
description = md.describe(sys.argv[4])
print(json.dumps({
    "name": description.name,
    "refs": list(description.env_refs.values()),
}, sort_keys=True))
`.trim()

const CHECKED_DATASOURCE_INVENTORY_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import marivo.datasource as md

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
print(json.dumps({
    "datasources": [{
        "name": description.name,
        "refs": list(description.env_refs.values()),
    } for description in (md.describe(item.name) for item in md.list())],
}, sort_keys=True))
`.trim()

const CHECKED_DATASOURCE_TEST_SCRIPT = String.raw`
import contextlib
import io
import json
import os
import sys
import marivo
import marivo.datasource as md

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)
captured_stdout = io.StringIO()
captured_stderr = io.StringIO()
try:
    with contextlib.redirect_stdout(captured_stdout), contextlib.redirect_stderr(captured_stderr):
        description = md.describe(sys.argv[4])
        secret_values = [
            value
            for ref in description.env_refs.values()
            if (value := os.environ.get(ref))
        ]
        result = md.test(sys.argv[4])
except Exception as exc:
    print(json.dumps({"kind": "datasource-test-failed", "exception_type": type(exc).__name__}), file=sys.stderr)
    raise SystemExit(70)

def redact(value):
    if isinstance(value, str):
        for secret in secret_values:
            value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value

failure = None if result.failure is None else {
    "code": result.failure.code,
    "exception_type": result.failure.exception_type,
    "backend_code": result.failure.backend_code,
    "backend_name": result.failure.backend_name,
    "message": result.failure.message,
}
repair = None if result.repair is None else result.repair.model_dump(mode="json")
print(json.dumps(redact({
    "name": result.name,
    "ok": result.ok,
    "latency_ms": result.latency_ms,
    "failure": failure,
    "repair": repair,
}), sort_keys=True))
`.trim()

const CHECKED_EVIDENCE_FINDINGS_SCRIPT = String.raw`
import json
import os
import sys
import marivo
import marivo.analysis as mv

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)

session_id = sys.argv[4]
finding_ids = json.loads(sys.argv[5])
try:
    session = mv.session.resume(session_id, use_datasources=False)
    findings = [session.evidence.finding(finding_id) for finding_id in finding_ids]
except Exception as exc:
    print(json.dumps({
        "kind": "evidence-read-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

for finding in findings:
    if not callable(getattr(finding, "render", None)):
        print(json.dumps({
            "kind": "finding-render-unavailable",
            "required_capability": "finding-render-v1",
        }, sort_keys=True), file=sys.stderr)
        raise SystemExit(69)

try:
    rendered = [{
        "en": finding.render(language="en"),
        "zh": finding.render(language="zh"),
    } for finding in findings]
except Exception as exc:
    print(json.dumps({
        "kind": "finding-render-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

print(json.dumps({
    "session_id": session.id,
    "findings": [{
        "finding_id": finding.finding_id,
        "finding_type": finding.finding_type,
        "epistemic_kind": finding.epistemic_kind,
        "artifact_id": finding.artifact_id,
        "session_id": finding.session_id,
        "canonical_item_key": finding.canonical_item_key,
        "quality_status": finding.quality_status,
        "committed_at": finding.committed_at.isoformat(),
        "extractor_version": finding.extractor_version,
        "artifact_schema_version": finding.artifact_schema_version,
        "rendered": rendered[index],
    } for index, finding in enumerate(findings)],
}, sort_keys=True))
`.trim()

const CHECKED_REPORT_PROJECTION_SCRIPT = String.raw`
import dataclasses
import datetime
import json
import math
import numbers
import os
import sys
import marivo
import marivo.analysis as mv

actual = {
    "python_executable": os.path.abspath(sys.executable),
    "marivo_version": marivo.__version__,
    "package_path": os.path.abspath(marivo.__file__ or ""),
}
expected = {
    "python_executable": os.path.abspath(sys.argv[1]),
    "marivo_version": sys.argv[2],
    "package_path": os.path.abspath(sys.argv[3]),
}
if actual != expected:
    print(json.dumps({"kind": "identity-mismatch", "actual": actual}), file=sys.stderr)
    raise SystemExit(78)

session_id = sys.argv[4]
artifact_refs = json.loads(sys.argv[5])

class ProjectionProblem(Exception):
    def __init__(self, code, location, message, repair):
        self.issue = {
            "code": code,
            "location": location,
            "message": message,
            "repair": repair,
        }

def blocked(issues, omitted_issue_count=0):
    retained = issues[:100]
    print(json.dumps({
        "status": "blocked",
        "issues": retained,
        "omitted_issue_count": omitted_issue_count + max(0, len(issues) - len(retained)),
    }, ensure_ascii=False, allow_nan=False, sort_keys=True))

def blocked_outcome(identity_key, identity, issues, extra=None):
    retained = issues[:100]
    return {
        "status": "blocked",
        identity_key: identity,
        **({} if extra is None else extra),
        "issues": retained,
        "omitted_issue_count": max(0, len(issues) - len(retained)),
    }

def normalize_cell(value, location, nullable):
    if value is None or (type(value).__module__.startswith("pandas") and type(value).__name__ in {"NAType", "NaTType"}):
        if nullable:
            return None
        raise ProjectionProblem(
            "unexpected-null-cell", location,
            "Artifact contains a null value in a non-nullable public column.",
            "Regenerate the Artifact so its values match the public nullable contract.",
        )
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, str) or isinstance(value, bool):
        return value
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        result = float(value)
        if math.isnan(result):
            if nullable:
                return None
            raise ProjectionProblem(
                "unexpected-null-cell", location,
                "Artifact contains a missing numeric value in a non-nullable public column.",
                "Regenerate the Artifact so its values match the public nullable contract.",
            )
        if not math.isfinite(result):
            raise ProjectionProblem(
                "non-finite-cell", location,
                "Artifact contains a non-finite numeric display value.",
                "Produce an Artifact with finite display values before rendering a report.",
            )
        return result
    raise ProjectionProblem(
        "unsupported-cell", location,
        "Artifact contains a display value that cannot be projected as a JSON scalar.",
        "Produce an Artifact with string, boolean, finite numeric, date/time, or null display values.",
    )

def public_json(value, location):
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump(mode="json")
    if dataclasses.is_dataclass(value):
        return dataclasses.asdict(value)
    raise TypeError(f"{location} is not a public serializable model or dataclass")

PRIVATE_JOB_KEYS = {
    "bind_params",
    "normalized_sql",
    "semantic_project_root",
    "credential",
    "credentials",
    "password",
    "secret",
    "token",
}

def safe_job_value(value, location):
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        value = model_dump(mode="json")
    elif dataclasses.is_dataclass(value):
        value = dataclasses.asdict(value)
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ProjectionProblem(
                "invalid-job-value", location,
                "A persisted Job field contains a non-finite number.",
                "Regenerate the affected analysis Job and retry the report.",
            )
        return value
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [safe_job_value(item, f"{location}[{index}]") for index, item in enumerate(value)]
    if isinstance(value, dict):
        return {
            str(key): safe_job_value(item, f"{location}.{key}")
            for key, item in value.items()
            if str(key).lower() not in PRIVATE_JOB_KEYS
        }
    raise ProjectionProblem(
        "invalid-job-value", location,
        "A persisted Job field cannot be projected as bounded JSON.",
        "Regenerate the affected analysis Job and retry the report.",
    )

def require_job_string(record, key, location):
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise ProjectionProblem(
            "malformed-session-job", f"{location}.{key}",
            f"A successful persisted Job has no valid {key!r} field.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    return value

def project_query(query, job_index, query_index):
    location = f"session.jobs[{job_index}].queries[{query_index}]"
    if not isinstance(query, dict):
        raise ProjectionProblem(
            "malformed-session-query", location,
            "A persisted query record is not an object.",
            "Regenerate the affected analysis Job so its query audit is valid.",
        )
    required_strings = ("query_id", "datasource", "dialect", "sql", "sql_digest", "started_at", "finished_at", "status")
    for key in required_strings:
        if not isinstance(query.get(key), str) or not query[key]:
            raise ProjectionProblem(
                "malformed-session-query", f"{location}.{key}",
                f"A persisted query record has no valid {key!r} field.",
                "Regenerate the affected analysis Job so its query audit is valid.",
            )
    row_count = query.get("row_count")
    duration_ms = query.get("duration_ms")
    output_ref = query.get("output_ref")
    if not isinstance(row_count, int) or isinstance(row_count, bool) or row_count < 0:
        raise ProjectionProblem(
            "malformed-session-query", f"{location}.row_count",
            "A persisted query record has an invalid row_count.",
            "Regenerate the affected analysis Job so its query audit is valid.",
        )
    if not isinstance(duration_ms, int) or isinstance(duration_ms, bool) or duration_ms < 0:
        raise ProjectionProblem(
            "malformed-session-query", f"{location}.duration_ms",
            "A persisted query record has an invalid duration_ms.",
            "Regenerate the affected analysis Job so its query audit is valid.",
        )
    if output_ref is not None and (not isinstance(output_ref, str) or not output_ref):
        raise ProjectionProblem(
            "malformed-session-query", f"{location}.output_ref",
            "A persisted query record has an invalid output_ref.",
            "Regenerate the affected analysis Job so its query audit is valid.",
        )
    return {
        "query_id": query["query_id"],
        "datasource": query["datasource"],
        "dialect": query["dialect"],
        "sql": query["sql"],
        "sql_digest": query["sql_digest"],
        "row_count": row_count,
        "duration_ms": duration_ms,
        "started_at": query["started_at"],
        "finished_at": query["finished_at"],
        "status": query["status"],
        "output_ref": output_ref,
    }

def project_session_job(record, job_index):
    location = f"session.jobs[{job_index}]"
    if not isinstance(record, dict):
        raise ProjectionProblem(
            "malformed-session-job", location,
            "A persisted Job record is not an object.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    job_id = require_job_string(record, "id", location)
    intent = require_job_string(record, "intent", location)
    status = require_job_string(record, "status", location)
    output_ref = record.get("output_frame_ref") or record.get("output_artifact_id")
    if status != "succeeded" or not isinstance(output_ref, str) or not output_ref:
        return None
    started_at = require_job_string(record, "started_at", location)
    finished_at = require_job_string(record, "finished_at", location)
    duration_ms = record.get("duration_ms")
    if not isinstance(duration_ms, int) or isinstance(duration_ms, bool) or duration_ms < 0:
        raise ProjectionProblem(
            "malformed-session-job", f"{location}.duration_ms",
            "A successful persisted Job has an invalid duration_ms.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    inputs = record.get("input_frame_refs")
    if not isinstance(inputs, list) or any(not isinstance(ref, str) or not ref for ref in inputs):
        raise ProjectionProblem(
            "malformed-session-job", f"{location}.input_frame_refs",
            "A successful persisted Job has invalid input_frame_refs.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    params = record.get("params")
    if not isinstance(params, dict):
        raise ProjectionProblem(
            "malformed-session-job", f"{location}.params",
            "A successful persisted Job has no valid params object.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    purpose = record.get("analysis_purpose")
    if purpose is not None and not isinstance(purpose, str):
        raise ProjectionProblem(
            "malformed-session-job", f"{location}.analysis_purpose",
            "A successful persisted Job has an invalid analysis_purpose.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    reused = record.get("reused_artifact")
    if not isinstance(reused, bool):
        raise ProjectionProblem(
            "malformed-session-job", f"{location}.reused_artifact",
            "A successful persisted Job has an invalid reused_artifact flag.",
            "Repair the Session Job record or regenerate the analysis in a new Session.",
        )
    queries = record.get("queries", [])
    query_issues = []
    projected_queries = []
    if not isinstance(queries, list):
        query_issues.append({
            "code": "malformed-session-query",
            "location": f"{location}.queries",
            "message": "The persisted Job query audit is not a list.",
            "repair": "Regenerate the affected analysis Job so its query audit is valid.",
        })
    else:
        for query_index, query in enumerate(queries):
            try:
                projected_queries.append(project_query(query, job_index, query_index))
            except ProjectionProblem as exc:
                query_issues.append(exc.issue)
    return {
        "id": job_id,
        "intent": intent,
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_ms": duration_ms,
        "analysis_purpose": purpose,
        "params": safe_job_value(params, f"{location}.params"),
        "input_artifact_refs": list(inputs),
        "output_artifact_ref": output_ref,
        "reused_artifact": reused,
        "queries": projected_queries,
        "query_issues": query_issues,
    }

def graph_artifact_shell(ref, status, family, issues):
    return {
        "ref": ref,
        "status": status,
        "family": family,
        "shape": None,
        "columns": [],
        "content_hash": None,
        "artifact_schema_version": None,
        "created_at": None,
        "contract": None,
        "revalidation": None,
        "lineage": None,
        "preview_rows": [],
        "total_rows": None,
        "omitted_rows": None,
        "issues": issues,
    }

def project_graph_artifact(session, summary, artifact_index):
    ref = summary.ref
    location = f"session_dag.artifacts[{artifact_index}]"
    frame = session.get_frame(ref)
    contract = frame.contract()
    if frame.ref != ref or contract.ref != ref:
        raise ProjectionProblem(
            "dag-artifact-identity-drift", location,
            "A Session DAG Artifact did not resolve to the same canonical ref.",
            "Repair the persisted Artifact identity and retry the report.",
        )
    result = session.revalidate(frame)
    if result.status != "admissible":
        raise ProjectionProblem(
            "dag-artifact-not-admissible", location,
            f"A Session DAG Artifact revalidation is {result.status!r}.",
            "Repair or regenerate this Artifact to restore its Session DAG details.",
        )
    content_hash = frame.state.content_hash
    if not content_hash or result.content_hash != content_hash:
        raise ProjectionProblem(
            "dag-artifact-identity-drift", location,
            "A Session DAG Artifact content identity changed during projection.",
            "Recover and revalidate the exact Artifact before retrying the report.",
        )
    schema = contract.artifact_schema
    column_names = [column.name for column in schema.columns]
    dataframe = frame.to_pandas().head(10)
    if list(dataframe.columns) != column_names or len(column_names) != frame.shape[1]:
        raise ProjectionProblem(
            "dag-artifact-projection-drift", location,
            "A Session DAG Artifact preview does not match its public contract.",
            "Regenerate the Artifact and retry the report.",
        )
    units = {}
    measures_meta = getattr(frame, "measures_meta", None)
    if callable(measures_meta):
        for measure in measures_meta():
            if isinstance(measure, dict) and isinstance(measure.get("column"), str) and isinstance(measure.get("unit"), str) and measure["unit"]:
                units[measure["column"]] = measure["unit"]
    meta_unit = getattr(frame.meta, "unit", None)
    value_columns = [column.name for column in schema.columns if column.role in {"value", "measure"}]
    if isinstance(meta_unit, str) and meta_unit and len(value_columns) == 1:
        units.setdefault(value_columns[0], meta_unit)
    preview_rows = [
        [normalize_cell(value, f"{location}.preview_rows[{row_index}][{column_index}]", schema.columns[column_index].nullable) for column_index, value in enumerate(row)]
        for row_index, row in enumerate(dataframe.itertuples(index=False, name=None))
    ]
    total_rows = int(frame.shape[0])
    return {
        "ref": ref,
        "status": "ready",
        "family": contract.kind,
        "shape": list(frame.shape),
        "columns": [{**column.model_dump(mode="json"), "unit": units.get(column.name)} for column in schema.columns],
        "content_hash": content_hash,
        "artifact_schema_version": result.artifact_schema_version,
        "created_at": frame.meta.created_at.isoformat(),
        "contract": contract.model_dump(mode="json"),
        "revalidation": result.model_dump(mode="json"),
        "lineage": public_json(frame.meta.lineage, f"{location}.lineage"),
        "preview_rows": preview_rows,
        "total_rows": total_rows,
        "omitted_rows": total_rows - len(preview_rows),
        "issues": [],
    }

def analysis_issue(exc):
    repair = getattr(exc, "repair", None)
    action = getattr(repair, "action", None)
    return {
        "code": "marivo-" + str(getattr(exc, "kind", type(exc).__name__)).lower(),
        "location": str(getattr(exc, "location", None) or "marivo"),
        "message": str(getattr(exc, "message", str(exc))),
        "repair": str(action or "Repair the Marivo Session or exact reference, then submit the complete report again."),
    }

def at_location(value, location):
    return {**value, "location": location}

try:
    session = mv.session.resume(session_id, use_datasources=False)
except mv.errors.AnalysisError as exc:
    blocked([analysis_issue(exc)])
    raise SystemExit(0)
except Exception as exc:
    print(json.dumps({
        "kind": "report-projection-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

try:
    job_summaries_before = session.jobs()
    job_ids_before = [summary.id for summary in job_summaries_before]
    if len(set(job_ids_before)) != len(job_ids_before):
        raise ProjectionProblem(
            "duplicate-session-job", "session.jobs",
            "The Session Job snapshot contains duplicate IDs.",
            "Repair the Session persistence store or regenerate the analysis in a new Session.",
        )
    job_records = []
    for job_index, summary in enumerate(job_summaries_before):
        record = session.job(summary.id)
        job_records.append((job_index, summary, record))

    frame_summaries = []
    frame_cursor = None
    seen_frame_cursors = set()
    while True:
        page = session.frame_summaries(limit=100, cursor=frame_cursor)
        frame_summaries.extend(page.items)
        if not page.has_more:
            break
        next_cursor = page.next_cursor
        if not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen_frame_cursors:
            raise ProjectionProblem(
                "session-frame-pagination-drift", "session.frame_summaries",
                "The Session Artifact inventory returned an invalid pagination cursor.",
                "Retry after the Session is stable; repair its persistence store if this recurs.",
            )
        seen_frame_cursors.add(next_cursor)
        frame_cursor = next_cursor
    main_summary_by_ref = {}
    for summary in frame_summaries:
        if summary.ref in main_summary_by_ref:
            raise ProjectionProblem(
                "duplicate-session-artifact", "session.frame_summaries",
                "The Session Artifact inventory contains duplicate refs.",
                "Repair the Session persistence store or regenerate the analysis in a new Session.",
            )
        main_summary_by_ref[summary.ref] = summary

    dag_jobs = []
    for job_index, summary, record in job_records:
        if (
            summary.status != "succeeded"
            or not isinstance(summary.output_frame_ref, str)
            or not summary.output_frame_ref
            or summary.output_frame_ref not in main_summary_by_ref
        ):
            continue
        projected_job = project_session_job(record, job_index)
        if projected_job is None:
            raise ProjectionProblem(
                "session-job-identity-drift", f"session.jobs[{job_index}]",
                "An eligible Session Job summary no longer matches its full persisted record.",
                "Repair the Session persistence store or regenerate the analysis in a new Session.",
            )
        summary_identity = {
            "id": summary.id,
            "intent": summary.intent,
            "status": summary.status,
            "started_at": summary.started_at,
            "duration_ms": summary.duration_ms,
            "output_artifact_ref": summary.output_frame_ref,
        }
        projected_identity = {
            "id": projected_job["id"],
            "intent": projected_job["intent"],
            "status": projected_job["status"],
            "started_at": projected_job["started_at"],
            "duration_ms": projected_job["duration_ms"],
            "output_artifact_ref": projected_job["output_artifact_ref"],
        }
        if projected_identity != summary_identity:
            raise ProjectionProblem(
                "session-job-identity-drift", f"session.jobs[{job_index}]",
                "The Session Job summary and full record disagree on persisted identity.",
                "Repair the Session persistence store or regenerate the analysis in a new Session.",
            )
        dag_jobs.append(projected_job)

    artifact_outcomes = []
    for artifact_index, requested_ref in enumerate(artifact_refs):
      try:
        frame = session.get_frame(requested_ref)
        contract = frame.contract()
        if frame.ref != requested_ref or contract.ref != requested_ref:
            raise ProjectionProblem(
                "non-canonical-artifact-ref", f"artifact_refs[{artifact_index}]",
                "Artifact reference did not resolve to the same canonical ref.",
                "Use the exact frame.ref returned by Marivo.",
            )
        result = session.revalidate(frame)
        if result.status != "admissible":
            raise ProjectionProblem(
                "artifact-not-admissible", f"artifact_refs[{artifact_index}]",
                f"Artifact {requested_ref!r} revalidation is {result.status!r}.",
                "Regenerate or repair the Artifact until session.revalidate(frame).status is admissible.",
            )
        if frame.shape[0] > 2000:
            raise ProjectionProblem(
                "artifact-row-limit", f"artifact_refs[{artifact_index}]",
                f"Artifact {requested_ref!r} has {frame.shape[0]} rows; the report limit is 2000.",
                "Produce a bounded Marivo Artifact with at most 2000 rows.",
            )
        content_hash = frame.state.content_hash
        if not content_hash or result.content_hash != content_hash:
            raise ProjectionProblem(
                "artifact-identity-drift", f"artifact_refs[{artifact_index}]",
                "Artifact content identity changed during report projection.",
                "Recover and revalidate the exact Artifact again before retrying.",
            )
        schema = contract.artifact_schema
        column_names = [column.name for column in schema.columns]
        dataframe = frame.to_pandas()
        if list(dataframe.columns) != column_names or tuple(dataframe.shape) != tuple(frame.shape):
            raise ProjectionProblem(
                "artifact-projection-drift", f"artifact_refs[{artifact_index}]",
                "Artifact terminal projection does not match its public contract and shape.",
                "Regenerate the Artifact and retry with its canonical ref.",
            )
        units = {}
        measures_meta = getattr(frame, "measures_meta", None)
        if callable(measures_meta):
            for measure in measures_meta():
                if isinstance(measure, dict) and isinstance(measure.get("column"), str) and isinstance(measure.get("unit"), str) and measure["unit"]:
                    units[measure["column"]] = measure["unit"]
        meta_unit = getattr(frame.meta, "unit", None)
        value_columns = [column.name for column in schema.columns if column.role in {"value", "measure"}]
        if isinstance(meta_unit, str) and meta_unit and len(value_columns) == 1:
            units.setdefault(value_columns[0], meta_unit)
        rows = [
            [normalize_cell(value, f"artifacts[{artifact_index}].rows[{row_index}][{column_index}]", schema.columns[column_index].nullable) for column_index, value in enumerate(row)]
            for row_index, row in enumerate(dataframe.itertuples(index=False, name=None))
        ]
        artifact_outcomes.append({
            "status": "ready",
            "value": {
                "ref": frame.ref,
                "family": contract.kind,
                "shape": list(frame.shape),
                "columns": [{**column.model_dump(mode="json"), "unit": units.get(column.name)} for column in schema.columns],
                "content_hash": content_hash,
                "artifact_schema_version": result.artifact_schema_version,
                "created_at": frame.meta.created_at.isoformat(),
                "contract": contract.model_dump(mode="json"),
                "revalidation": result.model_dump(mode="json"),
                "lineage": public_json(frame.meta.lineage, f"artifacts[{artifact_index}].lineage"),
                "rows": rows,
            },
        })
      except ProjectionProblem as exc:
        artifact_outcomes.append(blocked_outcome(
            "ref", requested_ref, [exc.issue],
        ))
      except mv.errors.AnalysisError as exc:
        artifact_outcomes.append(blocked_outcome(
            "ref", requested_ref,
            [at_location(analysis_issue(exc), f"artifact_refs[{artifact_index}]")],
        ))

    graph_refs = [summary.ref for summary in frame_summaries]
    for job in dag_jobs:
        for ref in [*job["input_artifact_refs"], job["output_artifact_ref"]]:
            if ref not in graph_refs:
                graph_refs.append(ref)
    dag_artifacts = []
    for graph_index, ref in enumerate(graph_refs):
        summary = main_summary_by_ref.get(ref)
        if summary is None:
            dag_artifacts.append(graph_artifact_shell(ref, "boundary", None, []))
            continue
        try:
            dag_artifacts.append(project_graph_artifact(session, summary, graph_index))
        except ProjectionProblem as exc:
            if exc.issue["code"] in {"dag-artifact-identity-drift", "dag-artifact-projection-drift"}:
                raise
            dag_artifacts.append(graph_artifact_shell(ref, "unavailable", summary.kind, [exc.issue]))
        except mv.errors.AnalysisError as exc:
            dag_artifacts.append(graph_artifact_shell(
                ref, "unavailable", summary.kind,
                [at_location(analysis_issue(exc), f"session_dag.artifacts[{graph_index}]")],
            ))
        except Exception as exc:
            dag_artifacts.append(graph_artifact_shell(ref, "unavailable", summary.kind, [{
                "code": "dag-artifact-unavailable",
                "location": f"session_dag.artifacts[{graph_index}]",
                "message": f"The persisted Artifact preview is unavailable ({type(exc).__name__}).",
                "repair": "Repair or regenerate this Artifact to restore its Session DAG details.",
            }]))

    job_ids_after = [summary.id for summary in session.jobs()]
    if job_ids_after != job_ids_before:
        raise ProjectionProblem(
            "session-dag-changed", "session.jobs",
            "The Session changed while its report DAG snapshot was being projected.",
            "Retry the complete report after the Session is stable.",
        )

    payload = {
        "status": "checked",
        "session_id": session.id,
        "artifact_outcomes": artifact_outcomes,
        "session_dag": {
            "jobs": dag_jobs,
            "artifacts": dag_artifacts,
        },
    }
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(encoded) > 16 * 1024 * 1024:
        size_problem = ProjectionProblem(
            "projection-too-large", "marivo.projection",
            "The checked Marivo report projection exceeds 16 MiB.",
            "Reduce referenced rows, columns, Artifacts, or report content before retrying.",
        )
        compact_issues = [size_problem.issue]
        compact_omitted = 0
        for outcome in artifact_outcomes:
            if outcome["status"] != "blocked":
                continue
            target_locations = []
            if outcome["ref"] in artifact_refs:
                target_locations.append(f"artifact_refs[{artifact_refs.index(outcome['ref'])}]")
            if not target_locations:
                compact_issues.extend(outcome["issues"])
            else:
                compact_issues.extend([
                    at_location(issue, location)
                    for issue in outcome["issues"]
                    for location in target_locations
                ])
            compact_omitted += outcome["omitted_issue_count"] * max(1, len(target_locations))
        blocked(compact_issues, compact_omitted)
        raise SystemExit(0)
except ProjectionProblem as exc:
    blocked([exc.issue])
    raise SystemExit(0)
except mv.errors.AnalysisError as exc:
    blocked([analysis_issue(exc)])
    raise SystemExit(0)
except Exception as exc:
    print(json.dumps({
        "kind": "report-projection-failed",
        "exception_type": type(exc).__name__,
    }, sort_keys=True), file=sys.stderr)
    raise SystemExit(70)

sys.stdout.buffer.write(encoded)
`.trim()

function redactSubprocessOutput(
  result: Awaited<ReturnType<FixedSubprocessPolicy['run']>>,
  environmentOverlay: Readonly<NodeJS.ProcessEnv> | undefined,
) {
  if (environmentOverlay === undefined) return result
  const secrets = Object.values(environmentOverlay).filter(
    (value): value is string => value !== undefined && value !== '',
  )
  const redactText = (source: string): string => {
    let text = source
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]')
    return text
  }
  const redactJsonValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value)
    if (Array.isArray(value)) return value.map(redactJsonValue)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJsonValue(item)]),
    )
  }
  const redactStdout = (): Buffer => {
    const text = result.stdout.toString('utf8')
    try {
      return Buffer.from(JSON.stringify(redactJsonValue(JSON.parse(text))))
    } catch {
      return Buffer.from(redactText(text))
    }
  }
  return {
    ...result,
    stdout: redactStdout(),
    stderr: Buffer.from(redactText(result.stderr.toString('utf8'))),
  }
}

function normalizeAbsolute(value: string): string {
  return path.normalize(path.resolve(value))
}

async function assertProjectRoot(projectRoot: string): Promise<string> {
  const resolved = normalizeAbsolute(projectRoot)
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('not a directory')
    return await realpath(resolved)
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'project-root-invalid',
      `Marivo project root is not an existing directory: ${resolved}`,
      { projectRoot: resolved },
      { cause },
    )
  }
}

async function assertExecutable(executable: string): Promise<void> {
  try {
    const info = await stat(executable)
    if (!info.isFile()) throw new Error('not a file')
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'python-unavailable',
      `Marivo Python executable is missing or not executable: ${executable}`,
      { pythonExecutable: executable },
      { cause },
    )
  }
}

async function resolvePythonExecutable(
  projectRoot: string,
  configured: string | undefined,
): Promise<string> {
  if (configured !== undefined && !path.isAbsolute(configured)) {
    throw new MarivoEnvironmentError(
      'python-path-relative',
      `Configured Marivo Python executable must be absolute: ${configured}`,
      { pythonExecutable: configured },
    )
  }
  const executable =
    configured === undefined
      ? path.join(
          projectRoot,
          process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
        )
      : path.normalize(configured)
  await assertExecutable(executable)
  return executable
}

function fingerprint(binding: Omit<MarivoEnvironmentBinding, 'fingerprint'>): string {
  const payload = [
    binding.projectRoot,
    binding.pythonExecutable,
    binding.marivoVersion,
    binding.packagePath,
    binding.subprocessPolicyId,
  ]
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function parseImportIdentity(stdout: Buffer): ImportIdentity {
  try {
    const value = JSON.parse(stdout.toString('utf8')) as Record<string, unknown>
    if (
      typeof value.python_executable !== 'string' ||
      typeof value.marivo_version !== 'string' ||
      typeof value.package_path !== 'string'
    )
      throw new TypeError('identity fields must be strings')
    return {
      pythonExecutable: value.python_executable,
      marivoVersion: value.marivo_version,
      packagePath: value.package_path,
    }
  } catch (cause) {
    throw new MarivoEnvironmentError(
      'binding-identity-mismatch',
      'Marivo import identity probe returned an invalid payload; explicit rebind is required',
      { stdoutBytes: stdout.byteLength },
      { cause },
    )
  }
}

/** A ready binding and the single frozen subprocess policy that established it. */
export class MarivoEnvironment {
  readonly binding: Readonly<MarivoEnvironmentBinding>
  readonly subprocessPolicy: FixedSubprocessPolicy
  #failed = false

  constructor(binding: MarivoEnvironmentBinding, subprocessPolicy: FixedSubprocessPolicy) {
    this.binding = Object.freeze({ ...binding })
    this.subprocessPolicy = subprocessPolicy
  }

  get status(): 'ready' | 'failed' {
    return this.#failed ? 'failed' : 'ready'
  }

  /**
   * Run the same-process assertion that future inventory/focused-help runners must execute before
   * rendering help. A mismatch permanently fails this binding.
   */
  async assertImportIdentity(signal?: AbortSignal): Promise<ImportIdentity> {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        IMPORT_IDENTITY_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
      ],
      limits: IDENTITY_LIMITS,
      signal,
    })
    if (result.exitCode !== 0) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    try {
      const identity = parseImportIdentity(result.stdout)
      if (
        normalizeAbsolute(identity.pythonExecutable) !==
          normalizeAbsolute(this.binding.pythonExecutable) ||
        identity.marivoVersion !== this.binding.marivoVersion ||
        normalizeAbsolute(identity.packagePath) !== normalizeAbsolute(this.binding.packagePath)
      )
        throw new Error('identity values differ from binding')
      return identity
    } catch (cause) {
      this.#failed = true
      if (cause instanceof MarivoEnvironmentError) throw cause
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
        { cause },
      )
    }
  }

  /**
   * Execute one real `marivo.help(target)` only after an in-process identity assertion. The
   * assertion and render share one Python process, removing a check/use race. Ordinary Marivo
   * target failures do not poison the binding; identity exit 78 does.
   */
  async runCheckedHelpTarget(
    target: string,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_HELP_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        target,
      ],
      limits,
      signal,
    })
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }

  async #runCheckedDatasourceScript(
    script: string,
    name: string,
    limits: Partial<SubprocessLimits>,
    environmentOverlay?: Readonly<NodeJS.ProcessEnv>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const rawResult = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        script,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        name,
      ],
      ...(environmentOverlay === undefined ? {} : { environmentOverlay }),
      limits,
      signal,
    })
    const result = redactSubprocessOutput(rawResult, environmentOverlay)
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint, exitCode: result.exitCode },
      )
    }
    return result
  }

  /** Return only the credential reference names declared by `md.describe(name)`. */
  runCheckedDatasourceDescribe(
    name: string,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    return this.#runCheckedDatasourceScript(
      CHECKED_DATASOURCE_DESCRIBE_SCRIPT,
      name,
      limits,
      undefined,
      signal,
    )
  }

  /** Return datasource names and credential reference names for one Workspace. */
  runCheckedDatasourceInventory(limits: Partial<SubprocessLimits>, signal?: AbortSignal) {
    return this.#runCheckedDatasourceScript(
      CHECKED_DATASOURCE_INVENTORY_SCRIPT,
      '',
      limits,
      undefined,
      signal,
    )
  }

  /** Execute one real `md.test(name)` with a per-operation credential overlay. */
  runCheckedDatasourceTest(
    name: string,
    environmentOverlay: Readonly<NodeJS.ProcessEnv>,
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    return this.#runCheckedDatasourceScript(
      CHECKED_DATASOURCE_TEST_SCRIPT,
      name,
      limits,
      environmentOverlay,
      signal,
    )
  }

  /** Read exact persisted Findings without loading datasource definitions. */
  async runCheckedEvidenceFindings(
    sessionId: string,
    findingIds: readonly string[],
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_EVIDENCE_FINDINGS_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        sessionId,
        JSON.stringify(findingIds),
      ],
      limits,
      signal,
    })
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }

  /** Check every independent report target and return valid partial projections without datasource access. */
  async runCheckedReportProjection(
    sessionId: string,
    artifactRefs: readonly string[],
    limits: Partial<SubprocessLimits>,
    signal?: AbortSignal,
  ) {
    if (this.#failed) {
      throw new MarivoEnvironmentError(
        'binding-failed',
        'Marivo Environment Binding has failed; explicit rebind is required',
        { fingerprint: this.binding.fingerprint },
      )
    }
    const result = await this.subprocessPolicy.run({
      executable: this.binding.pythonExecutable,
      args: [
        '-c',
        CHECKED_REPORT_PROJECTION_SCRIPT,
        this.binding.pythonExecutable,
        this.binding.marivoVersion,
        this.binding.packagePath,
        sessionId,
        JSON.stringify(artifactRefs),
      ],
      limits,
      signal,
    })
    if (result.exitCode === 78) {
      this.#failed = true
      throw new MarivoEnvironmentError(
        'binding-identity-mismatch',
        'Marivo import identity changed; explicit rebind is required',
        {
          fingerprint: this.binding.fingerprint,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
      )
    }
    return result
  }
}

/** Resolve, probe, and establish one Marivo Environment Binding. */
export async function bindMarivoEnvironment(
  config: MarivoEnvironmentConfig,
  options: { environment?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<MarivoEnvironment> {
  const projectRoot = await assertProjectRoot(config.projectRoot)
  const pythonExecutable = await resolvePythonExecutable(projectRoot, config.pythonExecutable)
  const subprocessPolicy = new FixedSubprocessPolicy(projectRoot, options.environment)
  const result = await subprocessPolicy.run({
    executable: pythonExecutable,
    args: ['-m', 'marivo', 'doctor', '--project-root', projectRoot, '--format', 'json'],
    limits: DOCTOR_LIMITS,
    signal: options.signal,
  })
  let report: DoctorReport
  try {
    report = parseDoctorReport(result.stdout)
  } catch (cause) {
    if (cause instanceof MarivoEnvironmentError && cause.code === 'doctor-json-invalid') {
      throw new MarivoEnvironmentError(
        cause.code,
        cause.message,
        {
          ...cause.details,
          exitCode: result.exitCode,
          stderr: result.stderr.toString('utf8').slice(0, 2_000),
        },
        { cause },
      )
    }
    throw cause
  }
  admitDoctorReport(report, projectRoot, pythonExecutable)

  const partialBinding = {
    projectRoot,
    pythonExecutable,
    marivoVersion: report.marivo.version,
    packagePath: normalizeAbsolute(report.marivo.package_path),
    subprocessPolicyId: subprocessPolicy.id,
  }
  const binding: MarivoEnvironmentBinding = {
    ...partialBinding,
    fingerprint: fingerprint(partialBinding),
  }
  return new MarivoEnvironment(binding, subprocessPolicy)
}
