from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from conftest import parse_registration, validate_contract
from dsh_data_analysis_report import ReportDatasetError, emit_dataset
from marivo.analysis import ArtifactRevalidation, BaseFrame, CandidateResolutionIssue
from marivo.analysis.evidence import (
    ComparabilityIssue,
    DataQualityIssue,
    EvidenceAvailabilityIssue,
    EvidenceRuleIssue,
)


def test_computed_dataframe_round_trip_and_script_escape(tmp_path: Path) -> None:
    frame = pd.DataFrame(
        {
            "label": ["</ScRiPt>\u2028safe", None],
            "count": [1, 2],
            "ratio": [math.inf, 1.5],
            "active": [True, False],
            "day": [date(2026, 1, 1), date(2026, 1, 2)],
            "duration": [timedelta(seconds=1), timedelta(seconds=2)],
        }
    )
    target = tmp_path / "computed.js"

    receipt = emit_dataset(frame, target, max_rows=1)
    payload = parse_registration(target, "ReportData")

    assert receipt.dataset_id == "computed"
    assert receipt.total_rows == 2
    assert receipt.written_rows == 1
    assert receipt.omitted_rows == 1
    assert receipt.content_hash.startswith("sha256:")
    assert payload["table"]["rows"][0][2] is None
    assert payload["table"]["rows"][0][4] == "2026-01-01"
    assert "</ScRiPt>" not in target.read_text()
    assert "\\u003c/ScRiPt>" in target.read_text()
    assert "\\u2028" in target.read_text()
    validate_contract("dataset-v1.schema.json", payload)


def test_numpy_datetime_scalar_is_stable(tmp_path: Path) -> None:
    frame = pd.DataFrame(
        {"when": pd.Series([np.datetime64("2026-01-01")], dtype=object)}
    )
    target = tmp_path / "datetime.js"
    emit_dataset(frame, target)
    payload = parse_registration(target, "ReportData")
    assert payload["table"]["rows"] == [["2026-01-01"]]


def test_large_integer_cells_preserve_artifact_identity(
    tmp_path: Path, artifact_frame: BaseFrame
) -> None:
    large_bytes = 26_000_000_000_000_000
    computed_target = tmp_path / "computed-large.js"
    emit_dataset(pd.DataFrame({"physical_input_bytes": [large_bytes]}), computed_target)
    computed = parse_registration(computed_target, "ReportData")
    assert computed["table"]["rows"] == [[large_bytes]]
    validate_contract("dataset-v1.schema.json", computed)

    artifact = BaseFrame(
        pd.DataFrame(
            {
                "month": pd.to_datetime(["2026-01-01"]),
                "physical_input_bytes": [large_bytes],
            }
        ),
        artifact_frame.meta,
    )
    artifact_target = tmp_path / "artifact-large.js"
    receipt = emit_dataset(artifact, artifact_target)
    payload = parse_registration(artifact_target, "ReportData")

    assert receipt.source_kind == "marivo_artifact"
    assert payload["source"]["artifact"]["ref"] == "artifact-1"
    assert payload["table"]["rows"] == [["2026-01-01T00:00:00", large_bytes]]
    validate_contract("dataset-v1.schema.json", payload)


def test_invalid_dataframe_and_cell_fail_without_replacing_target(
    tmp_path: Path,
) -> None:
    target = tmp_path / "data.js"
    target.write_text("old", encoding="utf-8")

    with pytest.raises(ReportDatasetError) as duplicate:
        emit_dataset(pd.DataFrame([[1, 2]], columns=["x", "x"]), target)
    assert duplicate.value.code == "columns-unsupported"
    assert target.read_text() == "old"

    with pytest.raises(ReportDatasetError) as unsupported:
        emit_dataset(pd.DataFrame({"x": [object()]}), target)
    assert unsupported.value.code == "cell-type-unsupported"
    assert "object" not in str(unsupported.value)
    assert target.read_text() == "old"


def test_artifact_projection_is_bounded_and_schema_valid(
    tmp_path: Path, artifact_frame: BaseFrame
) -> None:
    target = tmp_path / "artifact.js"
    receipt = emit_dataset(artifact_frame, target)
    payload = parse_registration(target, "ReportData")

    assert receipt.source_kind == "marivo_artifact"
    assert payload["source"]["artifact"]["ref"] == "artifact-1"
    assert payload["source"]["quality_summary"]["coverage"] == 1.0
    assert payload["source"]["revalidation"] == {"status": "not_checked"}
    assert "project_root" not in target.read_text()
    assert "byte_size" not in target.read_text()
    validate_contract("dataset-v1.schema.json", payload)


def test_revalidation_requires_exact_artifact_identity(
    tmp_path: Path, artifact_frame: BaseFrame
) -> None:
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
        checked_at=datetime(2026, 8, 31, 12, tzinfo=timezone.utc),
        authority_fingerprint="authority",
        fingerprint="result",
    )
    target = tmp_path / "artifact.js"
    emit_dataset(artifact_frame, target, revalidation=checked)
    payload = parse_registration(target, "ReportData")
    assert payload["source"]["revalidation"]["result"] == "admissible"
    validate_contract("dataset-v1.schema.json", payload)

    mismatch = checked.model_copy(update={"artifact_ref": "other"})
    with pytest.raises(ReportDatasetError) as error:
        emit_dataset(artifact_frame, target, revalidation=mismatch)
    assert error.value.code == "artifact-revalidation-mismatch"


def test_lineage_without_transportable_job_ref_fails_closed(
    tmp_path: Path, artifact_frame: BaseFrame
) -> None:
    from marivo.analysis.lineage import Lineage, LineageStep

    artifact_frame.meta.lineage = Lineage(
        steps=[
            LineageStep(
                intent="observe",
                job_ref=None,
                inputs=[],
                params_digest="sha256:test",
            )
        ]
    )
    with pytest.raises(ReportDatasetError) as error:
        emit_dataset(artifact_frame, tmp_path / "artifact.js")
    assert error.value.code == "artifact-contract-unsupported"


def repair() -> object:
    from marivo.analysis import errors

    return errors.AnalysisRepair(
        kind="inspect",
        action="Inspect the bounded fixture.",
        help_target={"surface": "analysis", "canonical_id": "observe"},
    )


def artifact_issues() -> tuple[object, ...]:
    return (
        DataQualityIssue.model_construct(
            issue_id="quality",
            kind="null_rate_high",
            severity="warning",
            source_refs=("artifact-1",),
            check_id="quality.null-rate",
            observed_value="must-not-leak",
            expectation="Null rate remains bounded.",
            evaluated_scope=None,
            repair=repair(),
        ),
        ComparabilityIssue.model_construct(
            issue_id="compare",
            kind="comparability_approximate",
            severity="warning",
            source_refs=("artifact-1",),
            left_scope=None,
            right_scope=None,
            incompatible_fields=("grain",),
            approximation_details=("Aligned approximately.",),
            repair=None,
        ),
        EvidenceAvailabilityIssue.model_construct(
            issue_id="evidence",
            kind="evidence_partial",
            severity="blocking",
            source_refs=("artifact-1",),
            failed_stage="digest",
            findings_available=True,
            fallback=None,
            stable_error_category="digest-unavailable",
            repair=repair(),
        ),
        CandidateResolutionIssue.model_construct(
            issue_id="candidate",
            kind="semantic_not_ready",
            severity="warning",
            source_refs=("artifact-1",),
            semantic_edge_ref=None,
            historical=True,
            repair=repair(),
        ),
    )


def test_all_artifact_issue_categories_project_without_sensitive_values(
    tmp_path: Path, artifact_frame: BaseFrame
) -> None:
    artifact_frame.meta.issues = artifact_issues()  # type: ignore[assignment]
    target = tmp_path / "issues.js"

    emit_dataset(artifact_frame, target)
    payload = parse_registration(target, "ReportData")

    assert [issue["category"] for issue in payload["source"]["issues"]] == [
        "data_quality",
        "comparability",
        "evidence_availability",
        "candidate_resolution",
    ]
    assert "observed_value" not in target.read_text()
    assert "must-not-leak" not in target.read_text()
    assert "snippet" not in target.read_text()
    validate_contract("dataset-v1.schema.json", payload)


@pytest.mark.parametrize(
    ("status", "semantic", "dependency"),
    (
        ("admissible", "current", "admissible"),
        ("stale", "stale", "admissible"),
        ("indeterminate", "indeterminate", "indeterminate"),
    ),
)
def test_revalidation_preserves_all_result_states_and_evidence_rule(
    tmp_path: Path,
    artifact_frame: BaseFrame,
    status: str,
    semantic: str,
    dependency: str,
) -> None:
    rule = EvidenceRuleIssue(
        issue_id="rule",
        kind="semantic_authority_unknown",
        severity="blocking",
        expected="known authority",
        received="unknown authority",
        repair=repair(),
    )
    checked = ArtifactRevalidation(
        artifact_ref="artifact-1",
        session_id="session-1",
        content_hash="sha256:artifact",
        artifact_schema_version="analysis-artifact/v13",
        current_catalog_fingerprint="catalog",
        semantic_status=semantic,
        evidence_status="partial",
        dependency_status=dependency,
        status=status,
        issues=(rule,),
        checked_at=datetime(2026, 8, 31, 12, tzinfo=timezone.utc),
        authority_fingerprint="authority",
        fingerprint="result",
    )
    target = tmp_path / f"{status}.js"

    emit_dataset(artifact_frame, target, revalidation=checked)
    payload = parse_registration(target, "ReportData")

    projection = payload["source"]["revalidation"]
    assert projection["result"] == status
    assert projection["issues"][0]["category"] == "evidence_rule"
    validate_contract("dataset-v1.schema.json", payload)


def test_dataset_budgets_and_atomic_replace_failure_are_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(ReportDatasetError) as rows:
        emit_dataset(pd.DataFrame({"x": range(100_001)}), tmp_path / "rows.js")
    assert rows.value.code == "payload-limit-exceeded"

    with pytest.raises(ReportDatasetError) as columns:
        emit_dataset(
            pd.DataFrame([[0] * 101], columns=[f"c{index}" for index in range(101)]),
            tmp_path / "columns.js",
        )
    assert columns.value.code == "payload-limit-exceeded"

    target = tmp_path / "atomic.js"
    target.write_text("old", encoding="utf-8")
    import dsh_data_analysis_report._common as common

    def fail_replace(source: object, destination: object) -> None:
        raise OSError("fixture replace failure")

    monkeypatch.setattr(common.os, "replace", fail_replace)
    with pytest.raises(ReportDatasetError) as write:
        emit_dataset(pd.DataFrame({"x": [1]}), target)
    assert write.value.code == "write-failed"
    assert target.read_text() == "old"
    assert [item.name for item in tmp_path.iterdir()] == ["atomic.js"]
