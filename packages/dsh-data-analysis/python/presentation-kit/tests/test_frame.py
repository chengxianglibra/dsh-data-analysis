from dataclasses import dataclass, make_dataclass
from datetime import datetime, timezone
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


def metadata_fixture(evidence=(), findings=(), method_facts=(), total=None, has_more=False):
    frame, calls = fixture()
    schema = frame.schema
    origin = NS(kind="metric", path="sales.revenue", definition_id="def-1")
    column = NS(value_origins=(origin,), context_origins=())
    frame_lineage = NS(values={"amount": column, "account": NS(value_origins=(), context_origins=())},
                       presence={}, axes={"region-axis": NS(value_origins=(), context_origins=(origin,))})
    reads = []

    def page(items):
        return NS(input_id="input", session_id="session", artifact_ref="artifact", items=tuple(items),
                  total_count=len(items) if total is None else total, has_more=has_more,
                  next_cursor="next" if has_more else None)

    class Audited(type(frame)):
        def evidence(self, *, limit):
            reads.append(("evidence", limit))
            return page(evidence)

        def findings(self, *, limit):
            reads.append(("findings", limit))
            return page(findings)

        @property
        def method_facts(self):
            return tuple(method_facts)

        @property
        def lineage(self):
            return frame_lineage

    return Audited(), calls, reads


def coordinate(slot_id, value):
    return NS(slot_id=slot_id, value=value)


def test_metadata_reads_one_bounded_page_and_scopes_only_complete_matching_keys():
    evidence = [
        NS(kind="read", summary="Actual explicit source read.", values=(("source", "sales.orders"),), coordinates=()),
        NS(kind="check", summary="Row check.", values=(), coordinates=(coordinate("key", "B"),)),
        NS(kind="check", summary="Value only.", values=(), coordinates=(coordinate("value", Decimal("1.50")),)),
        NS(kind="check", summary="Other row.", values=(), coordinates=(coordinate("key", "Z"),)),
        NS(kind="check", summary="Unknown slot.", values=(), coordinates=(coordinate("ghost", 1),)),
    ]
    frame, _, reads = metadata_fixture(evidence=evidence, total=25, has_more=True)
    result = read_frame(frame, metadata=True)
    sections = result["frame"]["sections"]
    assert reads == [("evidence", 20), ("findings", 20)]
    page = sections["evidence"]
    assert (page["status"], page["totalCount"], page["hasMore"]) == ("captured", 25, True)
    assert [item["scope"] for item in page["items"]] == [
        {"kind": "unscoped"}, {"kind": "row", "rowIndex": 1}, {"kind": "partial"},
        {"kind": "row-unmatched"}, {"kind": "unresolved"}]
    assert page["items"][0]["values"] == [{"name": "source", "value": "sales.orders"}]
    assert page["items"][2]["coordinates"] == [{"slotId": "value", "name": "amount", "value": "1.50"}]
    assert sections["findings"] == {"status": "captured", "totalCount": 25, "hasMore": True, "items": []}
    assert sections["methods"] == {"status": "captured", "totalCount": 0, "items": []}
    semantics = sections["semantics"]["columns"]
    assert [(c["role"], c["id"]) for c in semantics] == [("axis", "region-axis"), ("value", "amount"), ("value", "account")]
    assert semantics[1]["valueOrigins"] == [{"kind": "metric", "path": "sales.revenue", "definitionId": "def-1"}]
    assert semantics[0]["contextOrigins"][0]["path"] == "sales.revenue"


def test_row_scope_uses_only_rows_that_were_actually_captured():
    evidence = [NS(kind="check", summary="Second row.", values=(), coordinates=(coordinate("key", "B"),))]
    frame, _, _ = metadata_fixture(evidence=evidence)
    result = read_frame(frame, columns=["amount"], row_limit=1, metadata=True)
    assert result["frame"]["sections"]["evidence"]["items"][0]["scope"] == {"kind": "row-unmatched"}
    semantics = result["frame"]["sections"]["semantics"]["columns"]
    assert [c["id"] for c in semantics] == ["region-axis", "amount"]


def test_findings_keep_identity_and_flatten_saved_value_facts():
    Lag = make_dataclass("Lag", [("kind", str)])
    Value = make_dataclass("Value", [("method", str), ("coefficient", Decimal), ("lag", Lag)])
    finding = NS(finding_id="finding-1", finding_type="association", session_id="session",
                 artifact_ref="artifact", committed_at=datetime(2026, 10, 28, tzinfo=timezone.utc),
                 value=Value("pearson", Decimal("0.875"), Lag("none")), coordinates=(coordinate("key", "A"),))
    frame, _, _ = metadata_fixture(findings=[finding])
    item = read_frame(frame, metadata=True)["frame"]["sections"]["findings"]["items"][0]
    assert item["findingId"] == "finding-1"
    assert item["values"] == [{"name": "method", "value": "pearson"}, {"name": "coefficient", "value": "0.875"},
                              {"name": "lag.kind", "value": "none"}]
    assert item["scope"] == {"kind": "row", "rowIndex": 0}
    assert item["committedAt"] == "2026-10-28T00:00:00+00:00"


def test_metadata_failures_degrade_one_section_and_never_the_rows():
    finding = NS(finding_id="f", finding_type="association", session_id="other", artifact_ref="artifact",
                 committed_at=datetime(2026, 10, 28, tzinfo=timezone.utc), value=None, coordinates=())
    frame, _, _ = metadata_fixture(findings=[finding],
                                   evidence=[NS(kind="future", summary="x", values=(), coordinates=())])
    class Broken(type(frame)):
        @property
        def method_facts(self):
            raise RuntimeError("/private/store/path secret")

    result = read_frame(Broken(), metadata=True)
    sections = result["frame"]["sections"]
    assert sections["findings"] == {"status": "unavailable", "reason": "identity-mismatch"}
    assert sections["evidence"] == {"status": "unavailable", "reason": "runtime-incompatible"}
    assert sections["methods"] == {"status": "unavailable", "reason": "read-failed"}
    assert "secret" not in str(result)
    assert result["data"]["rows"][0][0] == "A"
    plain, _ = fixture()
    assert read_frame(plain, metadata=True)["frame"]["sections"]["evidence"] == {
        "status": "unavailable", "reason": "runtime-incompatible"}


def test_long_text_is_clipped_and_marked_but_identities_are_never_shortened():
    evidence = [NS(kind="read", summary="s" * 5000, values=tuple((f"n{i}", i) for i in range(40)), coordinates=())]
    frame, _, _ = metadata_fixture(evidence=evidence)
    item = read_frame(frame, metadata=True)["frame"]["sections"]["evidence"]["items"][0]
    assert item["truncated"] is True
    assert len(item["summary"]) == 4096 and item["summary"].endswith("…")
    assert len(item["values"]) == 32
    finding = NS(finding_id="f" * 3000, finding_type="association", session_id="session", artifact_ref="artifact",
                 committed_at=datetime(2026, 10, 28, tzinfo=timezone.utc), value=None, coordinates=())
    frame, _, _ = metadata_fixture(findings=[finding])
    assert read_frame(frame, metadata=True)["frame"]["sections"]["findings"] == {
        "status": "unavailable", "reason": "budget"}
