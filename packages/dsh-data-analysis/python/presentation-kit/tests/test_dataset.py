from __future__ import annotations

import importlib.util
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest
from dsh_data_analysis_presentation import PresentationDatasetError
from dsh_data_analysis_presentation._dataset import (
    MAX_BYTES,
    encode_dataset,
    validate_dataset,
)

PROJECT = Path(__file__).parents[1]
FIXTURES = PROJECT / "tests" / "fixtures"
spec = importlib.util.spec_from_file_location(
    "fixture_emitter", PROJECT / "scripts" / "emit_contract_fixtures.py"
)
emitter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(emitter)


def shared(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def test_same_typed_fixtures_as_node_and_browser() -> None:
    for fixture in (shared("computed.dataset"), shared("artifact.dataset")):
        assert validate_dataset(fixture) == fixture
        assert (
            encode_dataset(
                emitter.fixture_frame(fixture),
                row_limit=fixture["limit"],
                columns=fixture["columns"],
            )
            == fixture
        )


def test_integer_and_decimal_precision() -> None:
    data = encode_dataset(
        pd.DataFrame(
            {
                "i": pd.Series([-(2**63), 2**63 - 1], dtype=object),
                "d": [Decimal("1.2300"), Decimal("1E+500")],
                "u": pd.Series([2**63, 2**100], dtype=object),
            }
        )
    )
    assert [column["type"] for column in data["columns"]] == [
        "int64",
        "decimal",
        "decimal",
    ]
    assert data["rows"][0] == [str(-(2**63)), "1.2300", str(2**63)]
    assert data["rows"][1] == [str(2**63 - 1), "1E+500", str(2**100)]


@pytest.mark.parametrize(
    "value",
    [
        float(2**53),
        float("inf"),
        float("-inf"),
        Decimal("NaN"),
        Decimal("Infinity"),
        pytest.param(2**20_000, id="oversized-integer"),
        complex(1, 2),
        {"x": 1},
        [1],
        timedelta(days=1),
    ],
)
def test_nonrepresentable_values_fail(value: object) -> None:
    with pytest.raises(PresentationDatasetError):
        encode_dataset(pd.DataFrame({"x": pd.Series([value], dtype=object)}))


def test_null_boolean_time_and_empty_text() -> None:
    frame = pd.DataFrame(
        {
            "null": [None, pd.NA, float("nan"), pd.NaT],
            "bool": pd.Series([True, False, None, True], dtype="boolean"),
            "date": [date(2026, 9, 7)] * 4,
            "datetime": [
                datetime(2026, 9, 7, 12, 34, 56, 123456, timezone(timedelta(hours=8)))
            ]
            * 4,
            "text": ["", "中文", "😀", "x"],
        }
    )
    data = encode_dataset(frame)
    assert [row[0] for row in data["rows"]] == [None] * 4
    assert data["rows"][0] == [
        None,
        True,
        "2026-09-07",
        "2026-09-07T12:34:56.123456+08:00",
        "",
    ]
    assert data["columns"][0] == {
        "id": "null",
        "label": "null",
        "type": "string",
        "nullable": True,
    }
    empty = encode_dataset(
        pd.DataFrame(
            {
                "known": pd.Series([], dtype="int64"),
                "unknown": pd.Series([], dtype=object),
            }
        )
    )
    assert (
        empty["rows"] == [] and empty["rowCount"] == 0 and empty["truncated"] is False
    )
    assert [column["type"] for column in empty["columns"]] == ["int64", "string"]


@pytest.mark.parametrize(
    "value",
    [
        datetime(2026, 9, 7),  # noqa: DTZ001 -- rejection of naive timestamps
        pd.Timestamp("2026-09-07T00:00:00.123456789Z"),
        datetime(2026, 9, 7, tzinfo=timezone(timedelta(seconds=1))),
    ],
)
def test_timestamp_does_not_invent_timezone_or_drop_precision(value: object) -> None:
    with pytest.raises(PresentationDatasetError):
        encode_dataset(pd.DataFrame({"time": [value]}))


@pytest.mark.parametrize(
    "value",
    [
        "0000-01-01T00:00:00Z",
        "2026-01-01T24:00:00Z",
        "2026-01-01T00:60:00Z",
        "2026-01-01T00:00:60Z",
        "2026-01-01T00:00:00+24:00",
        "2026-01-01T00:00:00+01:60",
    ],
)
def test_datetime_json_does_not_normalize_invalid_fields(value: str) -> None:
    data = shared("computed.dataset")
    data["rows"][0][5] = value
    with pytest.raises(PresentationDatasetError):
        validate_dataset(data)


@pytest.mark.parametrize("value", [[], {}, None, 1])
def test_malformed_column_type_has_bounded_error(value: object) -> None:
    data = shared("computed.dataset")
    data["columns"][0]["type"] = value
    with pytest.raises(PresentationDatasetError) as error:
        validate_dataset(data)
    assert error.value.path == "/columns/0/type"


def test_row_cell_and_column_budgets() -> None:
    rows = encode_dataset(pd.DataFrame({"x": range(5_001)}))
    assert (len(rows["rows"]), rows["rowCount"], rows["limit"], rows["truncated"]) == (
        5_000,
        5_001,
        5_000,
        True,
    )
    cells = encode_dataset(pd.DataFrame({f"c{i}": range(2_000) for i in range(64)}))
    assert cells["limit"] == 1_562 and len(cells["rows"]) * 64 == 99_968
    with pytest.raises(PresentationDatasetError, match="64"):
        encode_dataset(pd.DataFrame({f"c{i}": [1] for i in range(65)}))


def test_byte_and_utf16_text_budgets_fail() -> None:
    with pytest.raises(PresentationDatasetError) as oversized:
        encode_dataset(pd.DataFrame({"x": ["a" * 32_768] * 65}))
    assert oversized.value.code == "budget"
    encoded = encode_dataset(pd.DataFrame({"x": ["😀" * 16_384]}))
    assert len(json.dumps(encoded).encode()) < MAX_BYTES
    with pytest.raises(PresentationDatasetError) as text:
        encode_dataset(pd.DataFrame({"x": ["😀" * 16_385]}))
    assert text.value.code == "budget"


@pytest.mark.parametrize(
    "change",
    [
        lambda data: data.update(schemaVersion=2),
        lambda data: data.update(truncated=False),
        lambda data: data.update(limit=5_001),
        lambda data: data["rows"][0].append("extra"),
        lambda data: data["rows"][0].__setitem__(1, "NaN"),
        lambda data: data["rows"][0].__setitem__(2, "9223372036854775808"),
        lambda data: data["rows"][0].__setitem__(3, 2**53),
        lambda data: data["rows"][0].__setitem__(4, "2026-02-30"),
        lambda data: data["rows"][0].__setitem__(5, "2026-01-01T00:00:00"),
        lambda data: (
            data["columns"][0].update(nullable=False)
            or data["rows"][0].__setitem__(0, None)
        ),
    ],
)
def test_shared_fixture_contract_failures(change) -> None:
    data = shared("computed.dataset")
    change(data)
    with pytest.raises(PresentationDatasetError):
        validate_dataset(data)


@pytest.mark.parametrize(
    "frame",
    [
        pd.DataFrame(),
        pd.DataFrame([[1, 2]], columns=["x", "x"]),
        pd.DataFrame({1: [2]}),
        pd.DataFrame({"x": ["a", 1]}),
    ],
)
def test_columns_and_mixed_object_types_are_explicit(frame: pd.DataFrame) -> None:
    with pytest.raises(PresentationDatasetError):
        encode_dataset(frame)


def test_integer_object_mixed_with_float_cannot_lose_precision() -> None:
    with pytest.raises(PresentationDatasetError) as error:
        encode_dataset(pd.DataFrame({"x": pd.Series([2**53 + 1, 0.5], dtype=object)}))
    assert error.value.code == "numeric_precision"


def test_public_surface_has_only_capture_and_result_types() -> None:
    import dsh_data_analysis_presentation as package

    assert package.__version__ == "1.5.1"
    assert package.__all__ == [
        "PresentationDatasetError",
        "DatasetCaptureReceipt",
        "FrameCaptureReceipt",
        "capture_dataset",
        "capture_frame",
    ]
    assert not any(
        hasattr(package, name)
        for name in ("write_dataset", "DatasetWriteReceipt", "emit_dataset", "emit_computed")
    )
