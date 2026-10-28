from dataclasses import dataclass
from decimal import Decimal
from types import SimpleNamespace as NS

import pandas as pd
import pytest

from dsh_data_analysis_presentation import PresentationDatasetError
from dsh_data_analysis_presentation._frame import read_frame


@dataclass(frozen=True)
class Layout:
    kind: str
    name: str
    slot_id: str = ""
    axis_token: str = ""
    endpoint: str = "self"
    part: str = "key"


def fixture(values=None):
    values = values or {"region": ["A", "B"], "amount": [Decimal("12345678901234.5678"), None], "account": [2**53 + 1, None]}
    key = NS(name="region", slot_id="key", dtype=NS(name="string"), nullable=False, unit=None)
    amount = NS(name="amount", slot_id="value", dtype=NS(precision=20, scale=4), nullable=True, unit="USD")
    account = NS(name="account", slot_id="account", dtype=NS(name="int64"), nullable=True, unit="1")
    layout = (Layout("coordinate", "region", axis_token="region-axis"),
              Layout("field", "amount", slot_id="value"), Layout("field", "account", slot_id="account"))
    schema = NS(input_id="input", layout=layout, values={"amount": amount, "account": account}, presence={},
                axes=(NS(token="region-axis", name="region", role="identity", keys=(key,)),),
                slots={"key": key, "value": amount, "account": account})
    calls = []

    class Frame:
        session_id = "session"
        artifact_id = "artifact"

        def __init__(self):
            self.schema = schema

        def to_pandas(self):
            raise AssertionError("Full Frame export is forbidden")

        def evidence_digest(self):
            raise AssertionError("Evidence is not a prerequisite")

        def read_page(self, *, columns, limit):
            calls.append((columns, limit))
            selected = list(layout) if columns is None else [layout[0]] + [next(c for c in layout if c.name == name) for name in columns]
            rows = pd.DataFrame({c.name: pd.Series(values[c.name][:limit], dtype=object) for c in selected})
            class Page:
                input_id = "input"
                layout = tuple(selected)
                coordinates = {"key": tuple(values["region"][:limit])}
                total_count = 2
                has_more = limit < 2
                next_cursor = "opaque" if limit < 2 else None
                read_stats = NS(data_rows_read=len(rows), coordinate_rows_read=len(rows), receipt_bytes_hashed=100)

                def __len__(self):
                    return len(rows)

                def to_pandas(self):
                    return rows.copy()
            return Page()
    return Frame(), calls


def test_frame_uses_one_bounded_page_and_keeps_coordinates_types_and_preview():
    frame, calls = fixture()
    result = read_frame(frame, columns=["amount"], row_limit=1)
    assert calls == [(("amount",), 1)]
    assert result["data"]["rows"] == [["A", "12345678901234.5678"]]
    assert result["coverage"]["complete"] is False
    assert result["coverage"]["totalRows"] == 2
    assert result["frame"]["coordinates"]["key"]["values"] == ["A"]
    assert {s["slotId"] for s in result["frame"]["slots"]} == {"key", "value"}
    assert result["frame"]["slots"][0]["unit"] is None
    assert result["frame"]["sections"]["evidence"] == "not-captured"


def test_frame_full_small_result_preserves_integer_null_and_coordinate_only_projection():
    frame, _ = fixture()
    result = read_frame(frame)
    assert result["data"]["rows"] == [["A", "12345678901234.5678", "9007199254740993"], ["B", None, None]]
    assert result["coverage"]["complete"] is True
    assert read_frame(frame, columns=["region"])["data"]["rows"] == [["A"], ["B"]]
    reordered = read_frame(frame, columns=["account", "amount"])
    assert reordered["data"]["rows"][0] == ["A", "9007199254740993", "12345678901234.5678"]


def test_frame_rejects_unknown_columns_colliding_names_and_page_identity():
    frame, _ = fixture()
    with pytest.raises(PresentationDatasetError):
        read_frame(frame, columns=["missing"])
    original = frame.read_page
    def wrong(**kwargs):
        page = original(**kwargs)
        page.input_id = "other-input"
        return page
    frame.read_page = wrong
    with pytest.raises(PresentationDatasetError, match="identity"):
        read_frame(frame)
    frame.schema.layout = (*frame.schema.layout, frame.schema.layout[0])
    with pytest.raises(PresentationDatasetError, match="collide"):
        read_frame(frame)


def test_selection_omits_unsupported_unselected_slots_but_keeps_all_keys():
    frame, calls = fixture()
    frame.schema.slots["account"].dtype = NS(name="duration", unit="us")
    result = read_frame(frame, columns=["amount"], row_limit=1)
    assert calls == [(("amount",), 1)]
    assert {s["slotId"] for s in result["frame"]["slots"]} == {"key", "value"}
    assert result["frame"]["coordinates"]["key"]["values"] == ["A"]
    with pytest.raises(PresentationDatasetError, match="unsupported physical type"):
        read_frame(frame, columns=["account"])
    frame.schema.slots["key"].dtype = NS(name="duration", unit="us")
    with pytest.raises(PresentationDatasetError):
        read_frame(frame, columns=["amount"])


@pytest.mark.parametrize("part", ["start", "end", "actual_start", "actual_end"])
@pytest.mark.parametrize("empty", [False, True])
def test_temporal_coordinate_bounds_keep_instants_and_nulls(part, empty):
    frame, _ = fixture()
    original = frame.read_page
    bound = Layout("coordinate", "region." + part, axis_token="region-axis", part=part)
    frame.schema.layout = (frame.schema.layout[0], bound, *frame.schema.layout[1:])
    frame.schema.axes[0].role = "calendar" if part.startswith("actual_") else "interval"
    stamp = pd.Timestamp("2026-10-28T00:00:00.123456+08:00")

    def read_page(**kwargs):
        page = original(**kwargs)
        rows = page.to_pandas()
        rows.insert(1, bound.name, [stamp, None][:len(rows)])
        page.layout = (page.layout[0], bound, *page.layout[1:])
        if empty:
            rows = rows.iloc[:0]
            page.coordinates = {"key": ()}
            page.total_count = 0
        # The fixture's __len__ closes over its original rows.
        class TemporalPage:
            def __len__(self):
                return len(rows)
            def to_pandas(self):
                return rows
        result = TemporalPage()
        for name in ("input_id", "layout", "coordinates", "total_count", "has_more", "next_cursor", "read_stats"):
            setattr(result, name, getattr(page, name))
        return result

    frame.read_page = read_page
    result = read_frame(frame, columns=["amount"])
    assert result["data"]["columns"][1]["type"] == "datetime"
    assert result["frame"]["layout"][1]["part"] == part
    if empty:
        assert result["data"]["rows"] == []
    else:
        assert result["data"]["rows"][0][1] == stamp.isoformat()
        assert result["data"]["rows"][1][1] is None


@pytest.mark.parametrize("field", ["account", "region"])
@pytest.mark.parametrize("fraction", ["", ".123456", ".123456789"])
def test_ns_timestamp_fields_and_keys_check_actual_precision(field, fraction):
    stamp = pd.Timestamp("2026-10-28T00:00:00" + fraction + "Z").as_unit("ns")
    values = {"region": ["A", "B"], "amount": [None, None], "account": [1, None]}
    values[field] = [stamp, None]
    frame, _ = fixture(values)
    source = frame.schema.slots["key" if field == "region" else "account"]
    source.dtype = NS(timezone="UTC", unit="ns")
    source.nullable = True
    if fraction == ".123456789":
        with pytest.raises(PresentationDatasetError, match="Sub-microsecond"):
            read_frame(frame)
    else:
        result = read_frame(frame)
        column = next(i for i, c in enumerate(result["data"]["columns"]) if c["id"] == field)
        assert result["data"]["rows"][0][column] == stamp.isoformat()
        assert result["data"]["rows"][1][column] is None
        if field == "region":
            assert result["frame"]["coordinates"]["key"]["values"] == [stamp.isoformat(), None]
        assert next(s for s in result["frame"]["slots"] if s["slotId"] == source.slot_id)["dtype"]["timeUnit"] == "ns"
