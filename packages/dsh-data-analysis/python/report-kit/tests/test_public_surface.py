from __future__ import annotations

from dataclasses import FrozenInstanceError

import dsh_data_analysis_report as report
import pytest


def test_public_surface_is_small_and_versioned() -> None:
    assert report.__version__ == "2.1.0"
    assert set(report.__all__) == {
        "DatasetReceipt",
        "ReportDatasetError",
        "ReportKitError",
        "ReportSessionTraceError",
        "SessionTraceReceipt",
        "emit_computed",
        "emit_dataset",
        "emit_session_trace",
    }


def test_receipts_are_frozen_and_slotted() -> None:
    receipt = report.DatasetReceipt(
        path="data.js",
        schema="dsh-data-analysis-dataset/v1",
        dataset_id="data",
        source_kind="computed",
        total_rows=0,
        written_rows=0,
        omitted_rows=0,
        column_count=0,
        byte_size=1,
        content_hash="sha256:test",
    )
    with pytest.raises(FrozenInstanceError):
        receipt.path = "changed"  # type: ignore[misc]
    assert not hasattr(receipt, "__dict__")
