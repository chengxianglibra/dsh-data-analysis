from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest
from jsonschema import Draft202012Validator
from marivo.analysis import BaseFrame, BaseFrameMeta
from marivo.analysis.evidence import QualitySummary
from marivo.analysis.lineage import Lineage
from referencing import Registry, Resource

CONTRACT_ROOT = Path(__file__).parents[3] / "report-contracts"


def parse_registration(path: Path, registry: str) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    prefix = f"{registry}.register("
    assert text.startswith(prefix)
    assert text.endswith(");\n")
    arguments = text[len(prefix) : -3]
    _, payload = arguments.split(", ", 1)
    return json.loads(payload)


def validate_contract(name: str, value: object) -> None:
    common = json.loads((CONTRACT_ROOT / "common-v1.schema.json").read_text())
    revalidation = json.loads(
        (CONTRACT_ROOT / "revalidation-v1.schema.json").read_text()
    )
    schema = json.loads((CONTRACT_ROOT / name).read_text())
    registry = Registry().with_resources(
        (
            (common["$id"], Resource.from_contents(common)),
            (revalidation["$id"], Resource.from_contents(revalidation)),
        )
    )
    Draft202012Validator(schema, registry=registry).validate(value)


@pytest.fixture
def artifact_frame() -> BaseFrame:
    frame = pd.DataFrame({"month": pd.to_datetime(["2026-01-01"]), "value": [10.0]})
    meta = BaseFrameMeta(
        kind="metric_frame",
        ref="artifact-1",
        session_id="session-1",
        project_root="/redacted/project",
        produced_by_job="run-1",
        analysis_purpose="fixture",
        created_at=datetime(2026, 8, 31, 11, tzinfo=timezone.utc),
        row_count=1,
        byte_size=1,
        evidence_status="complete",
        finding_count=1,
        quality_summary=QualitySummary(
            coverage=1.0,
            null_rate=0.0,
            sample_size=1,
            evaluated_check_count=1,
            failed_check_count=0,
            warning_check_count=0,
        ),
        content_hash="sha256:artifact",
        lineage=Lineage(),
    )
    return BaseFrame(frame, meta)
