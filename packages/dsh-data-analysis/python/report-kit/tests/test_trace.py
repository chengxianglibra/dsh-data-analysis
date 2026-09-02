from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import parse_registration, validate_contract
from dsh_data_analysis_report import ReportSessionTraceError, emit_session_trace
from marivo.analysis import (
    ArtifactSummary,
    FailedRun,
    IncompleteRun,
    SessionGraph,
    SucceededRun,
)
from marivo.analysis.session._read_model import (
    ArtifactEvidenceSummary,
    ArtifactIssueCounts,
    RunFailure,
    SessionGraphEdge,
)

NOW = datetime(2026, 8, 31, 12, tzinfo=timezone.utc)


def artifact(ref: str, producer: str | None) -> ArtifactSummary:
    return ArtifactSummary(
        ref=ref,
        family="MetricFrame",
        semantic_shape="time_series",
        created_at=NOW,
        produced_by_run=producer,
        analysis_purpose="fixture",
        row_count=1,
        content_hash="sha256:must-not-leak",
        materialization="materialized",
        evidence=ArtifactEvidenceSummary(
            status="complete",
            digest_present=True,
            digest_item_count=1,
            omitted_item_count=0,
            finding_count=1,
        ),
        quality=None,
        issue_counts=ArtifactIssueCounts(warning=0, blocking=0),
    )


def graph_with_every_lifecycle() -> SessionGraph:
    produced = SucceededRun(
        run_id="run-root",
        capability_id="observe",
        analysis_purpose="root",
        input_artifact_refs=(),
        arguments=(),
        omitted_argument_names=(),
        started_at=NOW,
        output_artifact_ref="artifact-input",
        output_mode="produced",
        finished_at=NOW,
        queries=(),
    )
    failed = FailedRun(
        run_id="run-failed",
        capability_id="compare",
        analysis_purpose=None,
        input_artifact_refs=("artifact-input",),
        arguments=(),
        omitted_argument_names=(),
        started_at=NOW,
        failed_at=NOW,
        queries=(),
        failure=RunFailure(
            error_type="AnalysisError",
            message="must-not-leak",
            expected={"secret": "must-not-leak"},
            received=None,
            location=None,
            repair=None,
        ),
    )
    incomplete = IncompleteRun(
        run_id="run-incomplete",
        capability_id="compare",
        analysis_purpose=None,
        input_artifact_refs=("artifact-input",),
        arguments=(),
        omitted_argument_names=(),
        started_at=NOW,
    )
    result = SucceededRun(
        run_id="run-result",
        capability_id="compare",
        analysis_purpose="result",
        input_artifact_refs=("artifact-input",),
        arguments=(),
        omitted_argument_names=(),
        started_at=NOW,
        output_artifact_ref="artifact-result",
        output_mode="produced",
        finished_at=NOW,
        queries=(),
    )
    return SessionGraph(
        session_id="session-1",
        artifacts=(
            artifact("artifact-input", "run-root"),
            artifact("artifact-result", "run-result"),
        ),
        runs=(produced, failed, incomplete, result),
        edges=(
            SessionGraphEdge(
                kind="produces", run_id="run-root", artifact_ref="artifact-input"
            ),
            SessionGraphEdge(
                kind="consumes", run_id="run-failed", artifact_ref="artifact-input"
            ),
            SessionGraphEdge(
                kind="consumes", run_id="run-incomplete", artifact_ref="artifact-input"
            ),
            SessionGraphEdge(
                kind="consumes", run_id="run-result", artifact_ref="artifact-input"
            ),
            SessionGraphEdge(
                kind="produces", run_id="run-result", artifact_ref="artifact-result"
            ),
        ),
        root_run_ids=("run-root",),
        head_artifact_refs=("artifact-result",),
        failed_run_ids=("run-failed",),
        incomplete_run_ids=("run-incomplete",),
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )


def test_session_trace_projects_all_lifecycles_without_sensitive_fields(
    tmp_path: Path,
) -> None:
    target = tmp_path / "trace.js"
    receipt = emit_session_trace(
        graph_with_every_lifecycle(), target, report_artifact_refs=["artifact-result"]
    )
    payload = parse_registration(target, "ReportTrace")

    assert receipt.run_count == 4
    assert {run["lifecycle"] for run in payload["runs"]} == {
        "incomplete",
        "succeeded",
        "failed",
    }
    text = target.read_text()
    assert "must-not-leak" not in text
    assert "content_hash" not in text
    assert payload["projection"] == {
        "run_arguments": "omitted",
        "failure_values": "omitted",
        "query_bind_values": "omitted",
    }
    assert "queries" not in payload
    assert all(run.get("queries", []) == [] for run in payload["runs"])
    validate_contract("session-trace-v2.schema.json", payload)


def test_report_refs_fail_closed_without_rejudging_graph_summaries(tmp_path: Path) -> None:
    graph = graph_with_every_lifecycle()
    with pytest.raises(ReportSessionTraceError) as report_ref:
        emit_session_trace(
            graph, tmp_path / "trace.js", report_artifact_refs=["missing"]
        )
    assert report_ref.value.code == "session-trace-report-refs-invalid"

    broken = SessionGraph(
        session_id=graph.session_id,
        artifacts=graph.artifacts,
        runs=graph.runs,
        edges=graph.edges,
        root_run_ids=(),
        head_artifact_refs=graph.head_artifact_refs,
        failed_run_ids=graph.failed_run_ids,
        incomplete_run_ids=graph.incomplete_run_ids,
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )
    target = tmp_path / "trace.js"
    emit_session_trace(broken, target, report_artifact_refs=["artifact-result"])
    assert parse_registration(target, "ReportTrace")["root_run_ids"] == []


def test_boundary_is_preserved_only_for_truncated_graph(tmp_path: Path) -> None:
    graph = graph_with_every_lifecycle()
    bounded = SessionGraph(
        session_id=graph.session_id,
        artifacts=(graph.artifacts[-1],),
        runs=(),
        edges=(),
        root_run_ids=(),
        head_artifact_refs=("artifact-result",),
        failed_run_ids=(),
        incomplete_run_ids=(),
        boundary_artifact_refs=("artifact-result",),
        boundary_run_ids=(),
        truncated=True,
    )
    target = tmp_path / "trace.js"
    emit_session_trace(bounded, target, report_artifact_refs=["artifact-result"])
    payload = parse_registration(target, "ReportTrace")
    assert payload["truncated"] is True
    assert payload["boundary_artifact_refs"] == ["artifact-result"]
    assert payload["boundary_run_ids"] == []


def test_trace_transports_public_edges_without_rederiving_missing_edges(tmp_path: Path) -> None:
    graph = graph_with_every_lifecycle()
    broken = SessionGraph(
        session_id=graph.session_id,
        artifacts=graph.artifacts,
        runs=graph.runs,
        edges=tuple(
            edge
            for edge in graph.edges
            if not (edge.kind == "produces" and edge.run_id == "run-result")
        ),
        root_run_ids=graph.root_run_ids,
        head_artifact_refs=graph.head_artifact_refs,
        failed_run_ids=graph.failed_run_ids,
        incomplete_run_ids=graph.incomplete_run_ids,
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )
    target = tmp_path / "trace.js"
    emit_session_trace(broken, target, report_artifact_refs=["artifact-result"])
    payload = parse_registration(target, "ReportTrace")
    assert len(payload["edges"]) == len(graph.edges) - 1


def test_trace_profiles_are_closed(tmp_path: Path) -> None:
    graph = graph_with_every_lifecycle()
    query = SimpleNamespace(
        query_id="query-1",
        datasource="warehouse",
        dialect="duckdb",
        sql="select 1",
        sql_digest="sha256:query",
        row_count=1,
        duration_ms=2,
        started_at=NOW,
        finished_at=NOW,
        status="succeeded",
    )
    graph = replace(
        graph,
        runs=tuple(
            replace(run, queries=(query,)) if isinstance(run, SucceededRun) else run
            for run in graph.runs
        ),
    )
    target = tmp_path / "trace.js"
    emit_session_trace(
        graph, target, report_artifact_refs=["artifact-result"], detail="reader"
    )
    reader = parse_registration(target, "ReportTrace")
    assert all(run.get("queries", []) == [] for run in reader["runs"])
    assert sum(run.get("queries_omitted", 0) for run in reader["runs"]) == 2
    emit_session_trace(
        graph, target, report_artifact_refs=["artifact-result"], detail="audit"
    )
    audit = parse_registration(target, "ReportTrace")
    assert audit["detail"] == "audit"
    assert [query["sql"] for run in audit["runs"] for query in run.get("queries", [])] == [
        "select 1",
        "select 1",
    ]
    with pytest.raises(ReportSessionTraceError) as error:
        emit_session_trace(
            graph,
            target,
            report_artifact_refs=["artifact-result"],
            detail="full",  # type: ignore[arg-type]
        )
    assert error.value.code == "detail-unsupported"


def test_trace_string_budget_counts_utf8_bytes(tmp_path: Path) -> None:
    graph = graph_with_every_lifecycle()
    artifacts = (
        replace(graph.artifacts[0], analysis_purpose="界" * 683),
        *graph.artifacts[1:],
    )
    oversized = SessionGraph(
        session_id=graph.session_id,
        artifacts=artifacts,
        runs=graph.runs,
        edges=graph.edges,
        root_run_ids=graph.root_run_ids,
        head_artifact_refs=graph.head_artifact_refs,
        failed_run_ids=graph.failed_run_ids,
        incomplete_run_ids=graph.incomplete_run_ids,
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )
    with pytest.raises(ReportSessionTraceError) as error:
        emit_session_trace(
            oversized, tmp_path / "trace.js", report_artifact_refs=["artifact-result"]
        )
    assert error.value.code == "session-trace-identity-invalid"


def test_trace_node_and_edge_budgets_fail_before_projection(tmp_path: Path) -> None:
    graph = graph_with_every_lifecycle()
    too_many_nodes = SessionGraph(
        session_id=graph.session_id,
        artifacts=tuple(graph.artifacts[0] for _ in range(201)),
        runs=(),
        edges=(),
        root_run_ids=(),
        head_artifact_refs=(),
        failed_run_ids=(),
        incomplete_run_ids=(),
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )
    with pytest.raises(ReportSessionTraceError) as nodes:
        emit_session_trace(
            too_many_nodes,
            tmp_path / "nodes.js",
            report_artifact_refs=["artifact-input"],
        )
    assert nodes.value.code == "session-trace-limit-exceeded"

    too_many_edges = SessionGraph(
        session_id=graph.session_id,
        artifacts=graph.artifacts,
        runs=graph.runs,
        edges=tuple(graph.edges[0] for _ in range(1001)),
        root_run_ids=graph.root_run_ids,
        head_artifact_refs=graph.head_artifact_refs,
        failed_run_ids=graph.failed_run_ids,
        incomplete_run_ids=graph.incomplete_run_ids,
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )
    with pytest.raises(ReportSessionTraceError) as edges:
        emit_session_trace(
            too_many_edges,
            tmp_path / "edges.js",
            report_artifact_refs=["artifact-result"],
        )
    assert edges.value.code == "session-trace-limit-exceeded"
