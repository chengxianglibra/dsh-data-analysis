"""Emit deterministic payloads for the TypeScript Slice 1 contract validator."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dsh_data_analysis_report import emit_computed, emit_dataset, emit_session_trace
from marivo.analysis import (
    ArtifactRevalidation,
    ArtifactSummary,
    BaseFrame,
    BaseFrameMeta,
    SessionGraph,
    SucceededRun,
)
from marivo.analysis.evidence import QualitySummary
from marivo.analysis.lineage import Lineage
from marivo.analysis.session._read_model import (
    ArtifactEvidenceSummary,
    ArtifactIssueCounts,
    SessionGraphEdge,
)


def main() -> None:
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=True)
    artifact_path = root / "artifact.js"
    computed_path = root / "computed.js"
    trace_path = root / "trace.js"
    frame = pd.DataFrame(
        {
            "month": pd.to_datetime(["2026-01-01", "2026-02-01"]),
            "revenue": [1024.5, None],
        }
    )
    now = datetime(2026, 8, 31, 12, tzinfo=timezone.utc)
    artifact_frame = BaseFrame(
        frame,
        BaseFrameMeta(
            kind="metric_frame",
            ref="artifact-1",
            session_id="session-1",
            project_root="/redacted/project",
            produced_by_job="run-1",
            analysis_purpose="fixture",
            created_at=now,
            row_count=2,
            byte_size=1,
            evidence_status="complete",
            finding_count=1,
            quality_summary=QualitySummary(
                coverage=1.0,
                null_rate=0.5,
                sample_size=2,
                evaluated_check_count=1,
                failed_check_count=0,
                warning_check_count=0,
            ),
            content_hash="sha256:artifact",
            lineage=Lineage(),
        ),
    )
    checked = ArtifactRevalidation(
        artifact_ref="artifact-1",
        session_id="session-1",
        content_hash="sha256:artifact",
        artifact_schema_version="analysis-artifact/v13",
        current_catalog_fingerprint="catalog",
        semantic_status="current",
        evidence_status="complete",
        dependency_status="admissible",
        status="admissible",
        checked_at=now,
        authority_fingerprint="authority",
        fingerprint="result",
    )
    emit_dataset(artifact_frame, artifact_path, revalidation=checked)
    emit_computed(frame, computed_path)
    run = SucceededRun(
        run_id="run-1",
        capability_id="observe",
        analysis_purpose="fixture",
        input_artifact_refs=(),
        arguments=(),
        omitted_argument_names=(),
        started_at=now,
        output_artifact_ref="artifact-1",
        output_mode="produced",
        finished_at=now,
    )
    artifact = ArtifactSummary(
        ref="artifact-1",
        family="MetricFrame",
        semantic_shape="time_series",
        created_at=now,
        produced_by_run="run-1",
        analysis_purpose="fixture",
        row_count=2,
        content_hash="sha256:not-transported",
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
    graph = SessionGraph(
        session_id="session-1",
        artifacts=(artifact,),
        runs=(run,),
        edges=(
            SessionGraphEdge(
                kind="produces", run_id="run-1", artifact_ref="artifact-1"
            ),
        ),
        root_run_ids=("run-1",),
        head_artifact_refs=("artifact-1",),
        failed_run_ids=(),
        incomplete_run_ids=(),
        boundary_artifact_refs=(),
        boundary_run_ids=(),
        truncated=False,
    )
    emit_session_trace(graph, trace_path, report_artifact_refs=["artifact-1"])
    print(
        json.dumps(
            {
                "artifact": str(artifact_path),
                "computed": str(computed_path),
                "trace": str(trace_path),
            }
        )
    )


if __name__ == "__main__":
    main()
