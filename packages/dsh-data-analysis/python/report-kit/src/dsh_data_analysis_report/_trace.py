"""Bounded public Marivo SessionGraph transport projection."""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from marivo.analysis import (
    ArtifactSummary,
    FailedRun,
    IncompleteRun,
    SessionGraph,
    SucceededRun,
)

from ._common import (
    atomic_write,
    bounded_string,
    content_hash,
    encoded_registration,
    nonnegative_integer,
    project_quality,
    resolve_target,
    safe_identifier,
    source_timestamp,
    strict_boolean,
    utc_timestamp,
)
from .errors import ReportSessionTraceError

TRACE_SCHEMA = "dsh-data-analysis-session-trace/v2"
TRACE_MAX_NODES = 200
TRACE_MAX_EDGES = 1_000
TRACE_MAX_BYTES = 4 * 1024 * 1024
TRACE_MAX_REPORT_REFS = 20
QUERY_SQL_MAX_BYTES = 64 * 1024
JAVASCRIPT_REGISTRY = "ReportTrace"


@dataclass(frozen=True, slots=True)
class SessionTraceReceipt:
    path: str
    schema: str
    trace_id: str
    session_id: str
    report_artifact_refs: tuple[str, ...]
    run_count: int
    artifact_count: int
    edge_count: int
    truncated: bool
    byte_size: int
    content_hash: str


def _identity(value: object, location: str) -> str:
    result = bounded_string(
        value,
        location=f"graph.{location}",
        error_type=ReportSessionTraceError,
    )
    assert result is not None
    return result


def _identity_array(value: object, location: str) -> list[str]:
    if not isinstance(value, (list, tuple)):
        raise ReportSessionTraceError(
            "session-trace-identity-invalid",
            f"{location} must be a list or tuple",
            {"location": location},
        )
    result = [
        _identity(item, f"{location}[{index}]") for index, item in enumerate(value)
    ]
    if len(set(result)) != len(result):
        raise ReportSessionTraceError(
            "session-trace-identity-invalid",
            f"{location} must contain unique identities",
            {"location": location},
        )
    return result


def _nullable_text(value: object, location: str) -> str | None:
    return bounded_string(
        value,
        location=f"graph.{location}",
        error_type=ReportSessionTraceError,
        nullable=True,
        allow_empty=True,
    )


def _query_sql(value: object, location: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value.encode("utf-8")) > QUERY_SQL_MAX_BYTES
    ):
        raise ReportSessionTraceError(
            "session-trace-limit-exceeded",
            f"graph.{location} must be a non-empty UTF-8 string of at most "
            f"{QUERY_SQL_MAX_BYTES} bytes",
            {"location": f"graph.{location}", "limit": QUERY_SQL_MAX_BYTES},
        )
    return value


def _project_artifact(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, ArtifactSummary):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported Artifact node",
            {"artifactIndex": index, "artifactType": type(value).__name__},
        )
    family = _identity(getattr(value, "family", None), f"artifacts[{index}].family")
    materialization = _identity(
        getattr(value, "materialization", None),
        f"artifacts[{index}].materialization",
    )
    evidence = getattr(value, "evidence", None)
    status = _identity(
        getattr(evidence, "status", None), f"artifacts[{index}].evidence.status"
    )
    counts = getattr(value, "issue_counts", None)
    try:
        quality = project_quality(
            getattr(value, "quality", None), error_type=ReportSessionTraceError
        )
    except ReportSessionTraceError as error:
        raise ReportSessionTraceError(
            "session-graph-unsupported", str(error), error.context
        ) from error
    return {
        "ref": _identity(getattr(value, "ref", None), f"artifacts[{index}].ref"),
        "family": family,
        "semantic_shape": _nullable_text(
            getattr(value, "semantic_shape", None), f"artifacts[{index}].semantic_shape"
        ),
        "created_at": source_timestamp(
            getattr(value, "created_at", None),
            location=f"graph.artifacts[{index}].created_at",
            error_type=ReportSessionTraceError,
        ),
        "produced_by_run": _nullable_text(
            getattr(value, "produced_by_run", None),
            f"artifacts[{index}].produced_by_run",
        ),
        "analysis_purpose": _nullable_text(
            getattr(value, "analysis_purpose", None),
            f"artifacts[{index}].analysis_purpose",
        ),
        "row_count": nonnegative_integer(
            getattr(value, "row_count", None),
            location=f"graph.artifacts[{index}].row_count",
            error_type=ReportSessionTraceError,
        ),
        "materialization": materialization,
        "evidence": {
            "status": status,
            "finding_count": nonnegative_integer(
                getattr(evidence, "finding_count", None),
                location=f"graph.artifacts[{index}].evidence.finding_count",
                error_type=ReportSessionTraceError,
            ),
            "digest_present": strict_boolean(
                getattr(evidence, "digest_present", None),
                location=f"graph.artifacts[{index}].evidence.digest_present",
                error_type=ReportSessionTraceError,
            ),
            "digest_item_count": nonnegative_integer(
                getattr(evidence, "digest_item_count", None),
                location=f"graph.artifacts[{index}].evidence.digest_item_count",
                error_type=ReportSessionTraceError,
            ),
            "omitted_item_count": nonnegative_integer(
                getattr(evidence, "omitted_item_count", None),
                location=f"graph.artifacts[{index}].evidence.omitted_item_count",
                error_type=ReportSessionTraceError,
            ),
        },
        "quality": quality,
        "issue_counts": {
            "warning": nonnegative_integer(
                getattr(counts, "warning", None),
                location=f"graph.artifacts[{index}].issue_counts.warning",
                error_type=ReportSessionTraceError,
            ),
            "blocking": nonnegative_integer(
                getattr(counts, "blocking", None),
                location=f"graph.artifacts[{index}].issue_counts.blocking",
                error_type=ReportSessionTraceError,
            ),
        },
    }


def _run_base(value: object, index: int) -> dict[str, object]:
    return {
        "run_id": _identity(getattr(value, "run_id", None), f"runs[{index}].run_id"),
        "lifecycle": value.lifecycle,
        "capability_id": _identity(
            getattr(value, "capability_id", None), f"runs[{index}].capability_id"
        ),
        "analysis_purpose": _nullable_text(
            getattr(value, "analysis_purpose", None), f"runs[{index}].analysis_purpose"
        ),
        "input_artifact_refs": _identity_array(
            getattr(value, "input_artifact_refs", None),
            f"runs[{index}].input_artifact_refs",
        ),
        "started_at": source_timestamp(
            getattr(value, "started_at", None),
            location=f"graph.runs[{index}].started_at",
            error_type=ReportSessionTraceError,
        ),
    }


def _project_queries(value: object, index: int, detail: Literal["reader", "audit"]):
    queries = getattr(value, "queries", ())
    if not isinstance(queries, (list, tuple)):
        raise ReportSessionTraceError(
            "session-graph-unsupported", "Run queries must be a public bounded sequence"
        )
    if len(queries) > 100:
        raise ReportSessionTraceError(
            "session-trace-limit-exceeded", "Run query count exceeds the transport limit"
        )
    if detail == "reader":
        return [], len(queries)
    projected = []
    for query_index, query in enumerate(queries):
        location = f"runs[{index}].queries[{query_index}]"
        projected.append(
            {
                "query_id": _identity(getattr(query, "query_id", None), f"{location}.query_id"),
                "datasource": _identity(
                    getattr(query, "datasource", None), f"{location}.datasource"
                ),
                "dialect": _identity(getattr(query, "dialect", None), f"{location}.dialect"),
                "sql": _query_sql(getattr(query, "sql", None), f"{location}.sql"),
                "sql_digest": _identity(
                    getattr(query, "sql_digest", None), f"{location}.sql_digest"
                ),
                "row_count": nonnegative_integer(
                    getattr(query, "row_count", None),
                    location=f"graph.{location}.row_count",
                    error_type=ReportSessionTraceError,
                ),
                "duration_ms": nonnegative_integer(
                    getattr(query, "duration_ms", None),
                    location=f"graph.{location}.duration_ms",
                    error_type=ReportSessionTraceError,
                ),
                "started_at": source_timestamp(
                    getattr(query, "started_at", None),
                    location=f"graph.{location}.started_at",
                    error_type=ReportSessionTraceError,
                ),
                "finished_at": source_timestamp(
                    getattr(query, "finished_at", None),
                    location=f"graph.{location}.finished_at",
                    error_type=ReportSessionTraceError,
                ),
                "status": _identity(getattr(query, "status", None), f"{location}.status"),
            }
        )
    return projected, 0


def _project_run(
    value: object, index: int, detail: Literal["reader", "audit"]
) -> dict[str, object]:
    if not isinstance(value, (IncompleteRun, SucceededRun, FailedRun)):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported Run variant",
            {"runIndex": index, "runType": type(value).__name__},
        )
    result = _run_base(value, index)
    if isinstance(value, IncompleteRun):
        return result
    if isinstance(value, SucceededRun):
        queries, queries_omitted = _project_queries(value, index, detail)
        result.update(
            {
                "finished_at": source_timestamp(
                    value.finished_at,
                    location=f"graph.runs[{index}].finished_at",
                    error_type=ReportSessionTraceError,
                ),
                "output_artifact_ref": _identity(
                    value.output_artifact_ref, f"runs[{index}].output_artifact_ref"
                ),
                "output_mode": value.output_mode,
                "queries": queries,
                "queries_omitted": queries_omitted,
            }
        )
        return result
    failure = value.failure
    queries, queries_omitted = _project_queries(value, index, detail)
    result.update(
        {
            "failed_at": source_timestamp(
                value.failed_at,
                location=f"graph.runs[{index}].failed_at",
                error_type=ReportSessionTraceError,
            ),
            "failure": {
                "error_type": _identity(
                    getattr(failure, "error_type", None),
                    f"runs[{index}].failure.error_type",
                ),
                "location": _nullable_text(
                    getattr(failure, "location", None),
                    f"runs[{index}].failure.location",
                ),
            },
            "queries": queries,
            "queries_omitted": queries_omitted,
        }
    )
    return result


def _project_edge(value: object, index: int) -> dict[str, str]:
    kind = getattr(value, "kind", None)
    if kind not in {"consumes", "produces", "reuses"}:
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported edge kind",
            {"edgeIndex": index, "kind": kind},
        )
    return {
        "kind": kind,
        "run_id": _identity(getattr(value, "run_id", None), f"edges[{index}].run_id"),
        "artifact_ref": _identity(
            getattr(value, "artifact_ref", None), f"edges[{index}].artifact_ref"
        ),
    }


def _validate_references(
    artifacts: list[dict[str, object]],
    runs: list[dict[str, object]],
    edges: list[dict[str, str]],
    root_run_ids: list[str],
    head_artifact_refs: list[str],
    failed_run_ids: list[str],
    incomplete_run_ids: list[str],
    boundary_artifact_refs: list[str],
    boundary_run_ids: list[str],
    truncated: bool,
) -> None:
    artifact_refs = [str(item["ref"]) for item in artifacts]
    run_ids = [str(item["run_id"]) for item in runs]
    if len(set(artifact_refs)) != len(artifact_refs) or len(set(run_ids)) != len(
        run_ids
    ):
        raise ReportSessionTraceError(
            "session-trace-identity-invalid",
            "SessionGraph node identities must be unique",
        )
    artifact_set = set(artifact_refs)
    run_set = set(run_ids)
    boundary_artifacts = set(boundary_artifact_refs)
    boundary_runs = set(boundary_run_ids)
    if not boundary_artifacts.issubset(artifact_set) or not boundary_runs.issubset(
        run_set
    ):
        raise ReportSessionTraceError(
            "session-trace-identity-invalid",
            "Boundary identities must identify local nodes",
        )
    if not truncated and (boundary_artifacts or boundary_runs):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "Graph boundary identities require truncated=true",
        )
    if not set(head_artifact_refs).issubset(artifact_set) or not set(
        failed_run_ids + incomplete_run_ids + root_run_ids
    ).issubset(run_set):
        raise ReportSessionTraceError(
            "session-trace-identity-invalid",
            "Graph summary identities must identify local nodes",
        )
    for run in runs:
        run_id = str(run["run_id"])
        for artifact_ref in run["input_artifact_refs"]:  # type: ignore[union-attr]
            if artifact_ref not in artifact_set and run_id not in boundary_runs:
                raise ReportSessionTraceError(
                    "session-trace-identity-invalid",
                    "Run input references an unknown Artifact",
                )
        output = run.get("output_artifact_ref")
        if (
            output is not None
            and output not in artifact_set
            and run_id not in boundary_runs
        ):
            raise ReportSessionTraceError(
                "session-trace-identity-invalid",
                "Run output references an unknown Artifact",
            )
    edge_keys: set[tuple[str, str, str]] = set()
    for edge in edges:
        key = (edge["kind"], edge["run_id"], edge["artifact_ref"])
        if key in edge_keys:
            raise ReportSessionTraceError(
                "session-trace-identity-invalid", "SessionGraph edges must be unique"
            )
        edge_keys.add(key)
        if edge["run_id"] not in run_set:
            raise ReportSessionTraceError(
                "session-trace-identity-invalid", "Graph edge references an unknown Run"
            )
        if edge["artifact_ref"] not in artifact_set:
            raise ReportSessionTraceError(
                "session-trace-identity-invalid",
                "Graph edge references an unknown Artifact",
            )
    for artifact in artifacts:
        artifact_ref = str(artifact["ref"])
        producer = artifact.get("produced_by_run")
        if producer is None:
            continue
        if producer not in run_set:
            if artifact_ref not in boundary_artifacts:
                raise ReportSessionTraceError(
                    "session-trace-identity-invalid",
                    "Artifact producer references an unknown Run",
                )
            continue


def emit_session_trace(
    graph: SessionGraph,
    target: str | os.PathLike[str],
    *,
    report_artifact_refs: Sequence[str],
    trace_id: str | None = None,
    detail: Literal["reader", "audit"] = "reader",
) -> SessionTraceReceipt:
    """Emit one bounded classic-script Session trace registration atomically."""

    if not isinstance(graph, SessionGraph):
        raise ReportSessionTraceError(
            "session-graph-unsupported", "graph must be a Marivo SessionGraph"
        )
    if detail not in {"reader", "audit"}:
        raise ReportSessionTraceError(
            "detail-unsupported", "detail must be 'reader' or 'audit'"
        )
    target_path = resolve_target(target, error_type=ReportSessionTraceError)
    identity = safe_identifier(
        target_path.stem if trace_id is None else trace_id,
        location="trace-id",
        error_type=ReportSessionTraceError,
    )
    if isinstance(report_artifact_refs, (str, bytes)):
        raise ReportSessionTraceError(
            "session-trace-report-refs-invalid",
            "report_artifact_refs must be a sequence of Artifact refs",
        )
    try:
        report_refs = _identity_array(report_artifact_refs, "report_artifact_refs")
    except ReportSessionTraceError as error:
        raise ReportSessionTraceError(
            "session-trace-report-refs-invalid", str(error), error.context
        ) from error
    if not 1 <= len(report_refs) <= TRACE_MAX_REPORT_REFS:
        raise ReportSessionTraceError(
            "session-trace-report-refs-invalid",
            "report_artifact_refs must contain between 1 and 20 unique refs",
            {"actual": len(report_refs)},
        )
    if len(graph.artifacts) + len(graph.runs) > TRACE_MAX_NODES:
        raise ReportSessionTraceError(
            "session-trace-limit-exceeded",
            "SessionGraph exceeds the trace node limit; request a smaller focused graph",
            {
                "limit": TRACE_MAX_NODES,
                "actual": len(graph.artifacts) + len(graph.runs),
            },
        )
    if len(graph.edges) > TRACE_MAX_EDGES:
        raise ReportSessionTraceError(
            "session-trace-limit-exceeded",
            "SessionGraph exceeds the trace edge limit; request a smaller focused graph",
            {"limit": TRACE_MAX_EDGES, "actual": len(graph.edges)},
        )
    artifacts = [
        _project_artifact(item, index) for index, item in enumerate(graph.artifacts)
    ]
    runs = [_project_run(item, index, detail) for index, item in enumerate(graph.runs)]
    edges = [_project_edge(item, index) for index, item in enumerate(graph.edges)]
    root_run_ids = _identity_array(graph.root_run_ids, "root_run_ids")
    head_artifact_refs = _identity_array(graph.head_artifact_refs, "head_artifact_refs")
    failed_run_ids = _identity_array(graph.failed_run_ids, "failed_run_ids")
    incomplete_run_ids = _identity_array(graph.incomplete_run_ids, "incomplete_run_ids")
    boundary_artifact_refs = _identity_array(
        graph.boundary_artifact_refs, "boundary_artifact_refs"
    )
    boundary_run_ids = _identity_array(graph.boundary_run_ids, "boundary_run_ids")
    truncated = strict_boolean(
        graph.truncated,
        location="graph.truncated",
        error_type=ReportSessionTraceError,
    )
    _validate_references(
        artifacts,
        runs,
        edges,
        root_run_ids,
        head_artifact_refs,
        failed_run_ids,
        incomplete_run_ids,
        boundary_artifact_refs,
        boundary_run_ids,
        truncated,
    )
    artifact_set = {str(item["ref"]) for item in artifacts}
    if any(ref not in artifact_set for ref in report_refs):
        raise ReportSessionTraceError(
            "session-trace-report-refs-invalid",
            "Every report Artifact ref must exist in the local graph",
        )
    payload = {
        "schema": TRACE_SCHEMA,
        "detail": detail,
        "trace_id": identity,
        "emitted_at": utc_timestamp(),
        "session_id": _identity(graph.session_id, "session_id"),
        "report_artifact_refs": report_refs,
        "artifacts": artifacts,
        "runs": runs,
        "edges": edges,
        "root_run_ids": root_run_ids,
        "head_artifact_refs": head_artifact_refs,
        "failed_run_ids": failed_run_ids,
        "incomplete_run_ids": incomplete_run_ids,
        "boundary_artifact_refs": boundary_artifact_refs,
        "boundary_run_ids": boundary_run_ids,
        "truncated": truncated,
        "projection": {
            "run_arguments": "omitted",
            "failure_values": "omitted",
            "query_bind_values": "omitted",
        },
        "read_boundaries": [
            "semantic_authority_not_checked",
            "datasource_freshness_not_checked",
            "report_entailment_not_checked",
        ],
    }
    content = encoded_registration(JAVASCRIPT_REGISTRY, identity, payload)
    if len(content) > TRACE_MAX_BYTES:
        raise ReportSessionTraceError(
            "session-trace-limit-exceeded",
            "Session trace snapshot exceeds the file-size limit",
            {"limit": TRACE_MAX_BYTES, "actual": len(content)},
        )
    digest = content_hash(content)
    atomic_write(target_path, content, error_type=ReportSessionTraceError)
    return SessionTraceReceipt(
        path=str(target_path),
        schema=TRACE_SCHEMA,
        trace_id=identity,
        session_id=graph.session_id,
        report_artifact_refs=tuple(report_refs),
        run_count=len(runs),
        artifact_count=len(artifacts),
        edge_count=len(edges),
        truncated=truncated,
        byte_size=len(content),
        content_hash=digest,
    )


__all__ = ["SessionTraceReceipt", "emit_session_trace"]
