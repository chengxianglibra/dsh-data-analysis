"""Bounded Marivo Artifact snapshot emission."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Literal

import pandas as pd
from marivo.analysis import (
    ArtifactRevalidation,
    BaseFrame,
    CandidateResolutionIssue,
    ComparabilityIssue,
    DataQualityIssue,
    EvidenceAvailabilityIssue,
    EvidenceRuleIssue,
)

from ._common import (
    ISSUE_LIMIT,
    ISSUE_MAX_BYTES,
    atomic_write,
    bounded_string,
    content_hash,
    encoded_registration,
    json_scalar,
    nonnegative_integer,
    project_quality,
    project_repair,
    resolve_target,
    safe_identifier,
    source_timestamp,
    strict_boolean,
    utc_timestamp,
)
from .errors import ReportDatasetError

DATASET_SCHEMA = "dsh-data-analysis-dataset/v1"
DATASET_MAX_COLUMNS = 100
DATASET_MAX_ROWS = 100_000
DATASET_MAX_BYTES = 16 * 1024 * 1024
JAVASCRIPT_REGISTRY = "ReportData"


@dataclass(frozen=True, slots=True)
class DatasetReceipt:
    path: str
    schema: str
    dataset_id: str
    source_kind: Literal["computed", "marivo_artifact"]
    total_rows: int
    written_rows: int
    omitted_rows: int
    column_count: int
    byte_size: int
    content_hash: str


def _bounded_list(
    values: object,
    *,
    location: str,
    limit: int,
    truncate: bool,
) -> tuple[list[str], int]:
    if not isinstance(values, (list, tuple)):
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            f"{location} must be a list or tuple",
            {"location": location},
        )
    if not truncate and len(values) > limit:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            f"{location} exceeds the supported item limit",
            {"location": location, "limit": limit, "actual": len(values)},
        )
    retained = values[:limit]
    projected = [
        bounded_string(
            item, location=f"{location}[{index}]", error_type=ReportDatasetError
        )
        for index, item in enumerate(retained)
    ]
    return projected, len(values) - len(retained)


def _issue_size(issue: dict[str, object]) -> None:
    size = len(json.dumps(issue, ensure_ascii=False, separators=(",", ":")).encode())
    if size > ISSUE_MAX_BYTES:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "An Artifact issue exceeds the transport budget",
            {"limit": ISSUE_MAX_BYTES, "actual": size},
        )


def _project_issue(issue: object, *, allow_evidence_rule: bool) -> dict[str, object]:
    kind = bounded_string(
        getattr(issue, "kind", None),
        location="issue.kind",
        error_type=ReportDatasetError,
    )
    severity = getattr(issue, "severity", None)
    if severity not in {"warning", "blocking"}:
        raise ReportDatasetError(
            "artifact-contract-unsupported", "Artifact issue severity is unsupported"
        )
    if isinstance(issue, DataQualityIssue):
        projected: dict[str, object] = {
            "category": "data_quality",
            "kind": kind,
            "severity": severity,
            "check_id": bounded_string(
                issue.check_id, location="issue.check_id", error_type=ReportDatasetError
            ),
            "expectation": bounded_string(
                issue.expectation,
                location="issue.expectation",
                error_type=ReportDatasetError,
            ),
            "repair": project_repair(
                issue.repair, error_type=ReportDatasetError, nullable=True
            ),
        }
    elif isinstance(issue, ComparabilityIssue):
        incompatible, _ = _bounded_list(
            issue.incompatible_fields,
            location="issue.incompatible_fields",
            limit=100,
            truncate=False,
        )
        approximation, _ = _bounded_list(
            issue.approximation_details,
            location="issue.approximation_details",
            limit=100,
            truncate=False,
        )
        projected = {
            "category": "comparability",
            "kind": kind,
            "severity": severity,
            "incompatible_fields": incompatible,
            "approximation_details": approximation,
            "repair": project_repair(
                issue.repair, error_type=ReportDatasetError, nullable=True
            ),
        }
    elif isinstance(issue, EvidenceAvailabilityIssue):
        if issue.failed_stage not in {"extract", "digest", "store"}:
            raise ReportDatasetError(
                "artifact-contract-unsupported", "Evidence issue stage is unsupported"
            )
        projected = {
            "category": "evidence_availability",
            "kind": kind,
            "severity": severity,
            "failed_stage": issue.failed_stage,
            "findings_available": strict_boolean(
                issue.findings_available,
                location="issue.findings_available",
                error_type=ReportDatasetError,
            ),
            "stable_error_category": bounded_string(
                issue.stable_error_category,
                location="issue.stable_error_category",
                error_type=ReportDatasetError,
            ),
            "repair": project_repair(
                issue.repair, error_type=ReportDatasetError, nullable=True
            ),
        }
    elif isinstance(issue, CandidateResolutionIssue):
        if severity != "warning":
            raise ReportDatasetError(
                "artifact-contract-unsupported",
                "Candidate resolution issues must retain warning severity",
            )
        projected = {
            "category": "candidate_resolution",
            "kind": kind,
            "severity": severity,
            "historical": strict_boolean(
                issue.historical,
                location="issue.historical",
                error_type=ReportDatasetError,
            ),
            "repair": project_repair(
                issue.repair, error_type=ReportDatasetError, nullable=False
            ),
        }
    elif allow_evidence_rule and isinstance(issue, EvidenceRuleIssue):
        projected = {
            "category": "evidence_rule",
            "kind": kind,
            "severity": severity,
            "expected": bounded_string(
                issue.expected, location="issue.expected", error_type=ReportDatasetError
            ),
            "received": bounded_string(
                issue.received, location="issue.received", error_type=ReportDatasetError
            ),
            "repair": project_repair(
                issue.repair, error_type=ReportDatasetError, nullable=False
            ),
        }
    else:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Artifact issue type is unsupported by this report-kit version",
            {"issueType": type(issue).__name__},
        )
    _issue_size(projected)
    return projected


def _project_issues(
    issues: object, *, allow_evidence_rule: bool
) -> tuple[list[dict[str, object]], int]:
    if not isinstance(issues, (list, tuple)):
        raise ReportDatasetError(
            "artifact-contract-unsupported", "Artifact issues must be a list or tuple"
        )
    retained = issues[:ISSUE_LIMIT]
    return (
        [
            _project_issue(issue, allow_evidence_rule=allow_evidence_rule)
            for issue in retained
        ],
        len(issues) - len(retained),
    )


def _project_lineage(lineage: object) -> dict[str, object]:
    external_inputs, external_omitted = _bounded_list(
        getattr(lineage, "external_inputs", None),
        location="lineage.external_inputs",
        limit=100,
        truncate=True,
    )
    steps = getattr(lineage, "steps", None)
    if not isinstance(steps, (list, tuple)):
        raise ReportDatasetError(
            "artifact-contract-unsupported", "Artifact lineage steps are unsupported"
        )
    projected_steps: list[dict[str, object]] = []
    for index, step in enumerate(steps[:100]):
        inputs, _ = _bounded_list(
            getattr(step, "inputs", None),
            location=f"lineage.steps[{index}].inputs",
            limit=100,
            truncate=False,
        )
        projected_steps.append(
            {
                "intent": bounded_string(
                    getattr(step, "intent", None),
                    location=f"lineage.steps[{index}].intent",
                    error_type=ReportDatasetError,
                ),
                "job_ref": bounded_string(
                    getattr(step, "job_ref", None),
                    location=f"lineage.steps[{index}].job_ref",
                    error_type=ReportDatasetError,
                ),
                "inputs": inputs,
                "params_digest": bounded_string(
                    getattr(step, "params_digest", None),
                    location=f"lineage.steps[{index}].params_digest",
                    error_type=ReportDatasetError,
                ),
                "analysis_purpose": bounded_string(
                    getattr(step, "analysis_purpose", None),
                    location=f"lineage.steps[{index}].analysis_purpose",
                    error_type=ReportDatasetError,
                    nullable=True,
                    allow_empty=True,
                ),
            }
        )
    return {
        "external_inputs": external_inputs,
        "external_inputs_omitted": external_omitted,
        "steps": projected_steps,
        "steps_omitted": len(steps) - len(projected_steps),
    }


def _project_revalidation(
    value: ArtifactRevalidation | None, *, artifact: BaseFrame
) -> dict[str, object]:
    if value is None:
        return {"status": "not_checked"}
    if not isinstance(value, ArtifactRevalidation):
        raise ReportDatasetError(
            "artifact-revalidation-mismatch",
            "revalidation must be a Marivo ArtifactRevalidation",
        )
    meta = artifact.meta
    expected = {
        "artifact_ref": meta.ref,
        "session_id": meta.session_id,
        "content_hash": meta.content_hash,
        "artifact_schema_version": meta.artifact_schema_version,
    }
    received = {
        "artifact_ref": value.artifact_ref,
        "session_id": value.session_id,
        "content_hash": value.content_hash,
        "artifact_schema_version": value.artifact_schema_version,
    }
    if not expected["content_hash"] or any(
        received[key] != item for key, item in expected.items()
    ):
        raise ReportDatasetError(
            "artifact-revalidation-mismatch",
            "revalidation identity does not match the emitted Artifact",
            {
                "mismatchedFields": [
                    key for key, item in expected.items() if received[key] != item
                ]
            },
        )
    if value.status not in {"admissible", "stale", "indeterminate"}:
        raise ReportDatasetError(
            "artifact-contract-unsupported", "Revalidation status is unsupported"
        )
    if value.semantic_status not in {"current", "stale", "indeterminate"}:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Revalidation semantic status is unsupported",
        )
    if value.evidence_status not in {"complete", "partial", "unavailable"}:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Revalidation Evidence status is unsupported",
        )
    if value.dependency_status not in {"admissible", "stale", "indeterminate"}:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Revalidation dependency status is unsupported",
        )
    issues, omitted = _project_issues(value.issues, allow_evidence_rule=True)
    return {
        "status": "checked",
        "result": value.status,
        "semantic_status": value.semantic_status,
        "evidence_status": value.evidence_status,
        "dependency_status": value.dependency_status,
        "checked_at": source_timestamp(
            value.checked_at,
            location="revalidation.checked_at",
            error_type=ReportDatasetError,
        ),
        "issues": issues,
        "issues_omitted": omitted,
    }


def _validate_frame(df: pd.DataFrame) -> None:
    if isinstance(df.index, pd.MultiIndex) or isinstance(df.columns, pd.MultiIndex):
        raise ReportDatasetError(
            "columns-unsupported", "DataFrame MultiIndex axes are not supported"
        )
    if any(not isinstance(column, str) or not column for column in df.columns):
        raise ReportDatasetError(
            "columns-unsupported", "DataFrame columns must be non-empty strings"
        )
    if not df.columns.is_unique:
        raise ReportDatasetError(
            "columns-unsupported", "DataFrame column names must be unique"
        )
    if len(df.columns) > DATASET_MAX_COLUMNS:
        raise ReportDatasetError(
            "payload-limit-exceeded",
            "DataFrame exceeds the report column limit",
            {"limit": DATASET_MAX_COLUMNS, "actual": len(df.columns)},
        )


def _rows(df: pd.DataFrame) -> list[list[object]]:
    return [
        [
            json_scalar(
                cell,
                location=f"table.rows[{row_index}][{column_index}]",
                error_type=ReportDatasetError,
            )
            for column_index, cell in enumerate(row)
        ]
        for row_index, row in enumerate(df.itertuples(index=False, name=None))
    ]


def _computed_columns(df: pd.DataFrame) -> list[dict[str, object]]:
    return [
        {
            "name": bounded_string(
                name, location="table.columns.name", error_type=ReportDatasetError
            ),
            "dtype": bounded_string(
                str(df.dtypes.iloc[index]),
                location="table.columns.dtype",
                error_type=ReportDatasetError,
            ),
            "contains_null": bool(df.iloc[:, index].isna().any()),
        }
        for index, name in enumerate(df.columns)
    ]


def _artifact_source(
    artifact: BaseFrame,
    df: pd.DataFrame,
    revalidation: ArtifactRevalidation | None,
) -> tuple[dict[str, object], list[dict[str, object]], str | None]:
    meta = artifact.meta
    if meta.artifact_schema_version != "analysis-artifact/v13":
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Artifact schema version is unsupported",
            {"artifactSchemaVersion": meta.artifact_schema_version},
        )
    contract = artifact.contract()
    if contract.ref != meta.ref or contract.kind != meta.kind:
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Artifact contract identity does not match metadata",
        )
    schema = contract.artifact_schema
    contract_columns = list(schema.columns)
    if [column.name for column in contract_columns] != list(df.columns):
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Artifact contract columns do not match the terminal DataFrame",
        )
    if meta.row_count != len(df):
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Artifact row count does not match the terminal DataFrame",
        )
    columns = [
        {
            "name": bounded_string(
                column.name,
                location="table.columns.name",
                error_type=ReportDatasetError,
            ),
            "dtype": bounded_string(
                str(df.dtypes.iloc[index]),
                location="table.columns.dtype",
                error_type=ReportDatasetError,
            ),
            "artifact_dtype": bounded_string(
                column.dtype,
                location="table.columns.artifact_dtype",
                error_type=ReportDatasetError,
            ),
            "contains_null": bool(df.iloc[:, index].isna().any()),
            "nullable": strict_boolean(
                column.nullable,
                location="table.columns.nullable",
                error_type=ReportDatasetError,
            ),
            "role": column.role,
        }
        for index, column in enumerate(contract_columns)
    ]
    if any(
        column["role"] not in {"time", "dimension", "value", "measure", "unknown"}
        for column in columns
    ):
        raise ReportDatasetError(
            "artifact-contract-unsupported", "Artifact column role is unsupported"
        )
    issues, issues_omitted = _project_issues(contract.issues, allow_evidence_rule=False)
    evidence_status = meta.evidence_status
    if evidence_status not in {"complete", "partial", "unavailable"}:
        raise ReportDatasetError(
            "artifact-contract-unsupported", "Artifact Evidence status is unsupported"
        )
    raw_hash = meta.content_hash
    artifact_hash = (
        None
        if raw_hash in {None, ""}
        else bounded_string(
            raw_hash, location="artifact.content_hash", error_type=ReportDatasetError
        )
    )
    source = {
        "kind": "marivo_artifact",
        "artifact": {
            "session_id": bounded_string(
                meta.session_id,
                location="artifact.session_id",
                error_type=ReportDatasetError,
            ),
            "ref": bounded_string(
                meta.ref, location="artifact.ref", error_type=ReportDatasetError
            ),
            "kind": bounded_string(
                meta.kind, location="artifact.kind", error_type=ReportDatasetError
            ),
            "artifact_schema_version": meta.artifact_schema_version,
            "content_hash": artifact_hash,
            "created_at": source_timestamp(
                meta.created_at,
                location="artifact.created_at",
                error_type=ReportDatasetError,
            ),
            "row_count": nonnegative_integer(
                meta.row_count,
                location="artifact.row_count",
                error_type=ReportDatasetError,
            ),
            "evidence_status": evidence_status,
            "finding_count": nonnegative_integer(
                meta.finding_count,
                location="artifact.finding_count",
                error_type=ReportDatasetError,
            ),
        },
        "quality_summary": project_quality(
            meta.quality_summary, error_type=ReportDatasetError
        ),
        "issues": issues,
        "issues_omitted": issues_omitted,
        "lineage": _project_lineage(meta.lineage),
        "revalidation": _project_revalidation(revalidation, artifact=artifact),
    }
    semantic_shape = bounded_string(
        schema.semantic_shape,
        location="table.semantic_shape",
        error_type=ReportDatasetError,
        nullable=True,
    )
    return source, columns, semantic_shape


def emit_dataset(
    value: BaseFrame,
    target: str | os.PathLike[str],
    *,
    dataset_id: str | None = None,
    max_rows: int | None = None,
    revalidation: ArtifactRevalidation | None = None,
) -> DatasetReceipt:
    """Emit one bounded Marivo Artifact registration atomically."""

    target_path = resolve_target(target, error_type=ReportDatasetError)
    identity = safe_identifier(
        target_path.stem if dataset_id is None else dataset_id,
        location="dataset-id",
        error_type=ReportDatasetError,
    )
    if max_rows is not None and (
        isinstance(max_rows, bool) or not isinstance(max_rows, int) or max_rows < 1
    ):
        raise ReportDatasetError(
            "payload-limit-exceeded", "max_rows must be a positive integer"
        )
    if not isinstance(value, BaseFrame):
        raise ReportDatasetError(
            "input-type-unsupported",
            "value must be a Marivo BaseFrame",
            {"valueType": type(value).__name__},
        )
    artifact = value
    frame = value.to_pandas()
    if not isinstance(frame, pd.DataFrame):
        raise ReportDatasetError(
            "artifact-contract-unsupported",
            "Artifact to_pandas() did not return a DataFrame",
        )
    _validate_frame(frame)
    total_rows = len(frame)
    written_rows = total_rows if max_rows is None else min(total_rows, max_rows)
    if written_rows > DATASET_MAX_ROWS:
        raise ReportDatasetError(
            "payload-limit-exceeded",
            "Dataset exceeds the report row limit; provide max_rows or pre-aggregate",
            {"limit": DATASET_MAX_ROWS, "actual": written_rows},
        )
    retained = frame.iloc[:written_rows]
    source, columns, semantic_shape = _artifact_source(artifact, frame, revalidation)
    table: dict[str, object] = {
        "total_rows": total_rows,
        "written_rows": written_rows,
        "omitted_rows": total_rows - written_rows,
        "columns": columns,
        "rows": _rows(retained),
    }
    table["semantic_shape"] = semantic_shape
    payload = {
        "schema": DATASET_SCHEMA,
        "dataset_id": identity,
        "emitted_at": utc_timestamp(),
        "source": source,
        "table": table,
    }
    content = encoded_registration(JAVASCRIPT_REGISTRY, identity, payload)
    if len(content) > DATASET_MAX_BYTES:
        raise ReportDatasetError(
            "payload-limit-exceeded",
            "Dataset snapshot exceeds the file-size limit",
            {"limit": DATASET_MAX_BYTES, "actual": len(content)},
        )
    digest = content_hash(content)
    atomic_write(target_path, content, error_type=ReportDatasetError)
    return DatasetReceipt(
        path=str(target_path),
        schema=DATASET_SCHEMA,
        dataset_id=identity,
        source_kind="marivo_artifact",
        total_rows=total_rows,
        written_rows=written_rows,
        omitted_rows=total_rows - written_rows,
        column_count=len(columns),
        byte_size=len(content),
        content_hash=digest,
    )


def emit_computed(
    value: pd.DataFrame,
    target: str | os.PathLike[str],
    *,
    dataset_id: str | None = None,
    max_rows: int | None = None,
) -> DatasetReceipt:
    """Emit one bounded pandas DataFrame registration atomically."""

    target_path = resolve_target(target, error_type=ReportDatasetError)
    identity = safe_identifier(
        target_path.stem if dataset_id is None else dataset_id,
        location="dataset-id",
        error_type=ReportDatasetError,
    )
    if max_rows is not None and (
        isinstance(max_rows, bool) or not isinstance(max_rows, int) or max_rows < 1
    ):
        raise ReportDatasetError(
            "payload-limit-exceeded", "max_rows must be a positive integer"
        )
    if not isinstance(value, pd.DataFrame):
        raise ReportDatasetError(
            "input-type-unsupported",
            "value must be a pandas DataFrame",
            {"valueType": type(value).__name__},
        )
    _validate_frame(value)
    total_rows = len(value)
    written_rows = total_rows if max_rows is None else min(total_rows, max_rows)
    if written_rows > DATASET_MAX_ROWS:
        raise ReportDatasetError(
            "payload-limit-exceeded",
            "Dataset exceeds the report row limit; provide max_rows or pre-aggregate",
            {"limit": DATASET_MAX_ROWS, "actual": written_rows},
        )
    payload = {
        "schema": DATASET_SCHEMA,
        "dataset_id": identity,
        "emitted_at": utc_timestamp(),
        "source": {"kind": "computed"},
        "table": {
            "total_rows": total_rows,
            "written_rows": written_rows,
            "omitted_rows": total_rows - written_rows,
            "columns": _computed_columns(value),
            "rows": _rows(value.iloc[:written_rows]),
        },
    }
    content = encoded_registration(JAVASCRIPT_REGISTRY, identity, payload)
    if len(content) > DATASET_MAX_BYTES:
        raise ReportDatasetError(
            "payload-limit-exceeded",
            "Dataset snapshot exceeds the file-size limit",
            {"limit": DATASET_MAX_BYTES, "actual": len(content)},
        )
    digest = content_hash(content)
    atomic_write(target_path, content, error_type=ReportDatasetError)
    return DatasetReceipt(
        path=str(target_path),
        schema=DATASET_SCHEMA,
        dataset_id=identity,
        source_kind="computed",
        total_rows=total_rows,
        written_rows=written_rows,
        omitted_rows=total_rows - written_rows,
        column_count=len(value.columns),
        byte_size=len(content),
        content_hash=digest,
    )


__all__ = ["DatasetReceipt", "emit_computed", "emit_dataset"]
