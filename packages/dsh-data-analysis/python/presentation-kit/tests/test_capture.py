import json
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest

from dsh_data_analysis_presentation import PresentationDatasetError, capture_dataset
from dsh_data_analysis_presentation._capture import _capture_scope
from dsh_data_analysis_presentation._dataset import encode_rows


def test_capture_is_optional_and_requires_the_worker_context(tmp_path: Path):
    with _capture_scope(str(tmp_path), "captures/unused"):
        pass
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(PresentationDatasetError, match="active marivo_python"):
        capture_dataset(pd.DataFrame({"x": [1]}))


def test_same_execution_multiple_dataframe_captures_retain_precision_and_range(tmp_path: Path):
    frame = pd.DataFrame({
        "account": pd.Series([2**53 + 1, None], dtype=object),
        "amount": pd.Series([Decimal("12345678901234.5678"), None], dtype=object),
    })
    with _capture_scope(str(tmp_path), "captures/call"):
        first = capture_dataset(frame, row_limit=1, labels={"account": "Account"})
        second = capture_dataset(frame.iloc[:0])
    manifest = json.loads((tmp_path / "captures/call/manifest.json").read_text())
    assert not manifest["failed"]
    assert [e["captureId"] for e in manifest["entries"]] == [first.capture_id, second.capture_id]
    preview, empty = [json.loads((tmp_path / e["path"]).read_text()) for e in manifest["entries"]]
    assert preview["data"]["rows"] == [["9007199254740993", "12345678901234.5678"]]
    assert preview["data"]["columns"][0]["label"] == "Account"
    assert preview["coverage"]["totalRows"] == 2
    assert preview["coverage"]["complete"] is False
    assert preview["source"] == {"kind": "dataframe", "details": "not-captured"}
    assert empty["data"]["rows"] == []
    assert empty["coverage"]["complete"] is True


def test_caught_capture_failures_are_reported_and_credentials_never_written(tmp_path: Path):
    with _capture_scope(str(tmp_path), "captures/call", ("private-canary",)):
        with pytest.raises(PresentationDatasetError):
            capture_dataset(pd.DataFrame({"x": ["private-canary"]}))
    manifest = (tmp_path / "captures/call/manifest.json").read_text()
    assert "private-canary" not in manifest
    assert json.loads(manifest) == {"schemaVersion": 1, "failed": True, "entries": []}
    assert list((tmp_path / "captures/call").iterdir()) == [tmp_path / "captures/call/manifest.json"]


def test_rows_adapter_does_not_infer_integer_null_as_float():
    data = encode_rows(["x"], [[2**53 + 1], [None]], total_count=2)
    assert data["rows"] == [["9007199254740993"], [None]]


def test_capture_accepts_only_dataframe(tmp_path: Path):
    with _capture_scope(str(tmp_path), "captures/call"):
        with pytest.raises(PresentationDatasetError):
            capture_dataset({"rows": [{"x": 1}]})


@pytest.mark.parametrize("manifest_only", [False, True])
def test_write_failure_does_not_override_completed_user_code(tmp_path, monkeypatch, manifest_only):
    import dsh_data_analysis_presentation._capture as module
    original = module._write
    def failing(root, relative, content):
        if not manifest_only or relative.endswith("/manifest.json"):
            raise OSError("write unavailable")
        original(root, relative, content)
    monkeypatch.setattr(module, "_write", failing)
    with _capture_scope(str(tmp_path), "captures/call") as state:
        try:
            capture_dataset(pd.DataFrame({"x": [1]}))
        except OSError:
            pass
        completed = True
    assert completed
    assert state["failed"] is True
    assert not (tmp_path / "captures/call/manifest.json").exists()


def test_manifest_failure_preserves_original_exception(tmp_path, monkeypatch):
    import dsh_data_analysis_presentation._capture as module
    def failing(*args):
        raise OSError("write unavailable")
    monkeypatch.setattr(module, "_write", failing)
    with pytest.raises(RuntimeError, match="original analysis failure"):
        with _capture_scope(str(tmp_path), "captures/call"):
            try:
                capture_dataset(pd.DataFrame({"x": [1]}))
            except OSError:
                pass
            raise RuntimeError("original analysis failure")
