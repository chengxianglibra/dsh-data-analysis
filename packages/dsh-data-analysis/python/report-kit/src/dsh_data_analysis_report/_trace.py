"""Bounded public Marivo SessionGraph transport projection."""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass

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

TRACE_SCHEMA = "dsh-data-analysis-session-trace/v1"
TRACE_MAX_NODES = 200
TRACE_MAX_EDGES = 1_000
TRACE_MAX_BYTES = 4 * 1024 * 1024
TRACE_MAX_REPORT_REFS = 20
JAVASCRIPT_REGISTRY = "ReportTrace"
ARTIFACT_FAMILIES = {
    "MetricFrame",
    "EventFrame",
    "LifecycleFrame",
    "SubjectSet",
    "DeltaFrame",
    "AttributionFrame",
    "ForecastFrame",
    "CandidateSet",
    "AssociationResult",
    "ComponentFrame",
    "CoverageFrame",
    "HypothesisTestResult",
}


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


def _project_artifact(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, ArtifactSummary):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported Artifact node",
            {"artifactIndex": index, "artifactType": type(value).__name__},
        )
    family = getattr(value, "family", None)
    if family not in ARTIFACT_FAMILIES:
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported Artifact family",
            {"artifactIndex": index, "family": family},
        )
    materialization = getattr(value, "materialization", None)
    if materialization not in {"materialized", "recomputed", "partial"}:
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported materialization state",
            {"artifactIndex": index},
        )
    evidence = getattr(value, "evidence", None)
    status = getattr(evidence, "status", None)
    if status not in {"complete", "partial", "unavailable"}:
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported Evidence status",
            {"artifactIndex": index},
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


def _project_run(value: object, index: int) -> dict[str, object]:
    if not isinstance(value, (IncompleteRun, SucceededRun, FailedRun)):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "SessionGraph contains an unsupported Run variant",
            {"runIndex": index, "runType": type(value).__name__},
        )
    result = _run_base(value, index)
    if isinstance(value, IncompleteRun):
        if value.lifecycle != "incomplete":
            raise ReportSessionTraceError(
                "session-graph-unsupported", "IncompleteRun lifecycle is inconsistent"
            )
        return result
    if isinstance(value, SucceededRun):
        if value.lifecycle != "succeeded" or value.output_mode not in {
            "produced",
            "reused",
        }:
            raise ReportSessionTraceError(
                "session-graph-unsupported", "SucceededRun lifecycle is inconsistent"
            )
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
            }
        )
        return result
    if value.lifecycle != "failed":
        raise ReportSessionTraceError(
            "session-graph-unsupported", "FailedRun lifecycle is inconsistent"
        )
    failure = value.failure
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


def _validate_topology(
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
    expected_failed = {
        str(run["run_id"]) for run in runs if run["lifecycle"] == "failed"
    }
    expected_incomplete = {
        str(run["run_id"]) for run in runs if run["lifecycle"] == "incomplete"
    }
    expected_roots = {
        str(run["run_id"]) for run in runs if not run["input_artifact_refs"]
    }
    if (
        set(failed_run_ids) != expected_failed
        or set(incomplete_run_ids) != expected_incomplete
    ):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "Graph lifecycle identity sets are inconsistent",
        )
    if set(root_run_ids) != expected_roots:
        raise ReportSessionTraceError(
            "session-graph-unsupported", "Graph root Run identities are inconsistent"
        )
    if not set(head_artifact_refs).issubset(artifact_set):
        raise ReportSessionTraceError(
            "session-trace-identity-invalid",
            "Graph head Artifact identities must be local",
        )
    succeeded_inputs = {
        str(item)
        for run in runs
        if run["lifecycle"] == "succeeded"
        for item in run["input_artifact_refs"]  # type: ignore[union-attr]
    }
    listed_heads = set(head_artifact_refs)
    if any(
        (ref in listed_heads) == (ref in succeeded_inputs)
        for ref in artifact_set - boundary_artifacts
    ):
        raise ReportSessionTraceError(
            "session-graph-unsupported",
            "Graph head Artifact identities are inconsistent",
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
    run_by_id = {str(run["run_id"]): run for run in runs}
    edge_keys: set[tuple[str, str, str]] = set()
    outgoing: dict[tuple[str, str], set[tuple[str, str]]] = {
        **{("run", identity): set() for identity in run_ids},
        **{("artifact", identity): set() for identity in artifact_refs},
    }
    indegree = {node: 0 for node in outgoing}
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
        run = run_by_id.get(edge["run_id"])
        if run is not None:
            if (
                edge["kind"] == "consumes"
                and edge["artifact_ref"] not in run["input_artifact_refs"]
            ):
                raise ReportSessionTraceError(
                    "session-graph-unsupported",
                    "A consumes edge disagrees with its Run",
                )
            if edge["kind"] in {"produces", "reuses"}:
                expected_mode = "produced" if edge["kind"] == "produces" else "reused"
                if (
                    run["lifecycle"] != "succeeded"
                    or run.get("output_mode") != expected_mode
                    or run.get("output_artifact_ref") != edge["artifact_ref"]
                ):
                    raise ReportSessionTraceError(
                        "session-graph-unsupported",
                        "An output edge disagrees with its Run",
                    )
        source = (
            ("artifact", edge["artifact_ref"])
            if edge["kind"] == "consumes"
            else ("run", edge["run_id"])
        )
        target = (
            ("run", edge["run_id"])
            if edge["kind"] == "consumes"
            else ("artifact", edge["artifact_ref"])
        )
        if target not in outgoing[source]:
            outgoing[source].add(target)
            indegree[target] += 1
    for run in runs:
        run_id = str(run["run_id"])
        for artifact_ref in run["input_artifact_refs"]:  # type: ignore[union-attr]
            if (
                artifact_ref in artifact_set
                and (
                    "consumes",
                    run_id,
                    artifact_ref,
                )
                not in edge_keys
            ):
                raise ReportSessionTraceError(
                    "session-graph-unsupported",
                    "A local Run input is missing its consumes edge",
                )
        output = run.get("output_artifact_ref")
        if run["lifecycle"] == "succeeded" and output in artifact_set:
            expected_kind = (
                "produces" if run.get("output_mode") == "produced" else "reuses"
            )
            if (expected_kind, run_id, str(output)) not in edge_keys:
                raise ReportSessionTraceError(
                    "session-graph-unsupported",
                    "A local succeeded Run output is missing its edge",
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
        producer_run = run_by_id[str(producer)]
        if (
            producer_run["lifecycle"] != "succeeded"
            or producer_run.get("output_mode") != "produced"
            or producer_run.get("output_artifact_ref") != artifact_ref
        ):
            raise ReportSessionTraceError(
                "session-graph-unsupported",
                "An Artifact producer disagrees with its Run",
            )
    ready = [node for node, degree in indegree.items() if degree == 0]
    visited = 0
    while ready:
        node = ready.pop()
        visited += 1
        for target in outgoing[node]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
    if visited != len(indegree):
        raise ReportSessionTraceError(
            "session-graph-unsupported", "SessionGraph must remain acyclic"
        )


def emit_session_trace(
    graph: SessionGraph,
    target: str | os.PathLike[str],
    *,
    report_artifact_refs: Sequence[str],
    trace_id: str | None = None,
) -> SessionTraceReceipt:
    """Emit one bounded classic-script Session trace registration atomically."""

    if not isinstance(graph, SessionGraph):
        raise ReportSessionTraceError(
            "session-graph-unsupported", "graph must be a Marivo SessionGraph"
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
    runs = [_project_run(item, index) for index, item in enumerate(graph.runs)]
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
    _validate_topology(
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
        "projection": {"run_arguments": "omitted", "failure_values": "omitted"},
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
