from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace as NS

import pandas as pd
import pytest

from dsh_data_analysis_presentation import PresentationDatasetError
from dsh_data_analysis_presentation._frame import _dependent, _interpretation, _periods, _section, read_frame

UTC = timezone.utc
T0 = datetime(2026, 8, 1, tzinfo=UTC)
T1 = datetime(2026, 9, 1, tzinfo=UTC)


@dataclass(frozen=True)
class Layout:
    kind: str
    name: str
    slot_id: str = ""
    axis_token: str = ""
    endpoint: str = "self"
    part: str = "key"


class Rejection(Exception):
    """Mirrors the public structured fields of a Marivo AnalysisError."""

    def __init__(self, location, received):
        super().__init__("/private/store/path secret")
        self.location = location
        self.received = received


def fixture(values=None, *, stored=True):
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

        def __init__(self):
            self.schema = schema

        @property
        def artifact_id(self):
            if not stored:
                raise Rejection("frame.artifact_id", "MemoryFrameBacking")
            return "artifact"

        @property
        def description(self):
            if not stored:
                raise Rejection("frame.description", "MemoryFrameBacking")
            return "Monthly revenue by region"

        def to_pandas(self):
            raise AssertionError("Full Frame export is forbidden")

        def evidence(self, **kwargs):
            raise AssertionError("Evidence is not part of v2")

        def findings(self, **kwargs):
            raise AssertionError("Findings are not part of v2")

        @property
        def method_facts(self):
            raise AssertionError("Method facts are not part of v2")

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
    assert result["schemaVersion"] == 2
    assert result["data"]["rows"] == [["A", "12345678901234.5678"]]
    assert result["coverage"]["complete"] is False
    assert result["coverage"]["totalRows"] == 2
    assert result["frame"]["coordinates"]["key"]["values"] == ["A"]
    assert {s["slotId"] for s in result["frame"]["slots"]} == {"key", "value"}
    assert result["frame"]["slots"][0]["unit"] is None
    assert result["frame"]["axes"][0]["variant"] == {"kind": "ordinary"}
    assert result["frame"]["description"] == "Monthly revenue by region"
    assert result["source"] == {"kind": "frame", "sessionId": "session", "artifactId": "artifact"}
    assert set(result["frame"]["sections"]) == {"semantics", "interpretation", "periods"}


def test_frame_full_small_result_preserves_integer_null_and_coordinate_only_projection():
    frame, _ = fixture()
    result = read_frame(frame)
    assert result["data"]["rows"] == [["A", "12345678901234.5678", "9007199254740993"], ["B", None, None]]
    assert result["coverage"]["complete"] is True
    assert read_frame(frame, columns=["region"])["data"]["rows"] == [["A"], ["B"]]
    reordered = read_frame(frame, columns=["account", "amount"])
    assert reordered["data"]["rows"][0] == ["A", "9007199254740993", "12345678901234.5678"]


def test_computed_memory_frame_has_no_artifact_or_description():
    frame, _ = fixture(stored=False)
    result = read_frame(frame)
    assert result["source"] == {"kind": "frame", "sessionId": "session", "artifactId": None}
    assert result["frame"]["description"] is None


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


def test_pending_expression_is_rejected_through_the_public_rejection_and_never_computed():
    frame, _ = fixture()
    def pending(**kwargs):
        raise Rejection("frame.read_page", "expression")
    frame.read_page = pending
    frame.compute = lambda: pytest.fail("capture must not compute")
    with pytest.raises(PresentationDatasetError) as error:
        read_frame(frame)
    assert error.value.code == "frame_not_computed"
    assert "secret" not in str(error.value)


def test_unknown_axis_variant_rejects_the_v2_snapshot():
    frame, _ = fixture()
    frame.schema.axes[0].role = "future"
    with pytest.raises(PresentationDatasetError) as error:
        read_frame(frame)
    assert error.value.code == "runtime_incompatible"


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


def test_paired_calendar_exports_datetime_endpoints_and_keeps_the_ordinal_key():
    frame, _ = fixture()
    schema = frame.schema
    axis = schema.axes[0]
    axis.role = "paired"
    axis.keys[0].dtype = NS(name="int64")
    endpoint = NS(kind="calendar", name="month", at=None, timezone="UTC",
                  grain=NS(kind="builtin", unit="month", step=1))
    axis.left = endpoint
    axis.right = endpoint
    left = Layout("coordinate", "month.left", axis_token="region-axis", endpoint="left")
    right = Layout("coordinate", "month.right", axis_token="region-axis", endpoint="right")
    schema.layout = (left, right, *schema.layout[1:])

    def read_page(*, columns, limit):
        rows = pd.DataFrame({"month.left": [T1], "month.right": [T0],
                             "amount": [Decimal("12345678901234.5678")], "account": [2**53 + 1]})
        class Page:
            input_id = "input"
            layout = schema.layout
            coordinates = {"key": (1,)}
            total_count = 1
            has_more = False
            next_cursor = None
            read_stats = NS(data_rows_read=1, coordinate_rows_read=1, receipt_bytes_hashed=100)
            def __len__(self): return len(rows)
            def to_pandas(self): return rows.copy()
        return Page()
    frame.read_page = read_page
    result = read_frame(frame)
    assert [c["type"] for c in result["data"]["columns"][:2]] == ["datetime", "datetime"]
    assert result["data"]["rows"][0][:2] == [T1.isoformat(), T0.isoformat()]
    assert result["frame"]["coordinates"]["key"]["values"] == ["1"]


@pytest.mark.parametrize("part", ["start", "end", "nominal_start", "nominal_end", "label"])
@pytest.mark.parametrize("empty", [False, True])
def test_temporal_coordinate_parts_follow_the_marivo_enum(part, empty):
    frame, _ = fixture()
    original = frame.read_page
    bound = Layout("coordinate", "region." + part, axis_token="region-axis", part=part)
    frame.schema.layout = (frame.schema.layout[0], bound, *frame.schema.layout[1:])
    axis = frame.schema.axes[0]
    axis.role, axis.timezone, axis.grain = "calendar", "Asia/Shanghai", NS(kind="builtin", unit="month", step=1)
    stamp = pd.Timestamp("2026-10-28T00:00:00.123456+08:00")
    cell = "2026-10" if part == "label" else stamp

    def read_page(**kwargs):
        page = original(**kwargs)
        rows = page.to_pandas()
        rows.insert(1, bound.name, [cell, None][:len(rows)])
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
    assert result["data"]["columns"][1]["type"] == ("string" if part == "label" else "datetime")
    assert result["frame"]["layout"][1]["part"] == part
    assert result["frame"]["axes"][0]["variant"] == {
        "kind": "calendar", "timezone": "Asia/Shanghai", "grain": {"kind": "builtin", "unit": "month", "step": 1}}
    if empty:
        assert result["data"]["rows"] == []
    else:
        assert result["data"]["rows"][0][1] == ("2026-10" if part == "label" else stamp.isoformat())
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


# Interpretation facts -------------------------------------------------------

def origin(path="sales.revenue", kind="metric"):
    return NS(kind=kind, path=path, definition_id="def:" + path)


MONTH = NS(kind="builtin", unit="month", step=1)
REGION_KEY = NS(name="region", slot_id="region-key", dtype=NS(name="string"), nullable=False, unit=None)
ACCOUNT_KEY = NS(name="account", slot_id="account-key", dtype=NS(name="int64"), nullable=False, unit=None)
OPENED_KEY = NS(name="opened", slot_id="opened-key", dtype=NS(timezone="UTC", unit="us"), nullable=True, unit=None)
MONTH_KEY = NS(name="month", slot_id="month-key", dtype=NS(name="int64"), nullable=False, unit=None)
REGION_AXIS = NS(token="region-axis", name="sales.customer.region", role="field", keys=(REGION_KEY,))
MONTH_AXIS = NS(token="month-axis", name="sales.order.ordered_at", role="calendar", keys=(MONTH_KEY,),
                timezone="UTC", grain=MONTH)


def fixed(key=("east",), axis=None):
    axis = axis or NS(token="fixed-region", name="sales.customer.region", role="field", keys=(REGION_KEY,))
    return NS(axis=axis, key=key, origins=(origin("sales.customer.region", "dimension"),))


def schema(**facts):
    values = facts.pop("values", ("revenue", "orders"))
    presence = facts.pop("presence", ())
    base = dict(input_id="input", axes=(REGION_AXIS, MONTH_AXIS),
                values={name: NS(name=name, slot_id="v-" + name) for name in values},
                presence={name: NS(name=name, slot_id="p-" + name) for name in presence},
                fixed_axes=(), value_contexts={}, comparisons=(), decompositions=(), alignments=())
    base.update(facts)
    return NS(**base)


def observation(time=None, window=None, subject=True):
    return NS(kind="observation", subject=origin() if subject else None, time=time, window=window)


@pytest.mark.parametrize(("time", "expected"), [
    (None, None),
    (NS(kind="axis", axis_token="month-axis", endpoint="self"), {"kind": "axis", "axisToken": "month-axis", "endpoint": "self"}),
    (NS(kind="fixed", start=T0, end=T1, timezone="UTC"),
     {"kind": "fixed", "start": "2026-08-01T00:00:00+00:00", "end": "2026-09-01T00:00:00+00:00", "timezone": "UTC"}),
])
@pytest.mark.parametrize(("window", "projected"), [
    (None, None),
    (NS(kind="all_history"), {"kind": "all_history"}),
    (NS(kind="since", start=T0), {"kind": "since", "start": "2026-08-01T00:00:00+00:00"}),
    (NS(kind="to_date", grain=NS(kind="named", ref=origin("fiscal.calendar", "calendar"), level="quarter")),
     {"kind": "to_date", "grain": {"kind": "named", "level": "quarter", "ref": {
         "kind": "calendar", "path": "fiscal.calendar", "definitionId": "def:fiscal.calendar"}}}),
    (NS(kind="trailing_duration", duration=timedelta(days=7)), {"kind": "trailing_duration", "seconds": 604800.0}),
    (NS(kind="trailing_periods", count=30), {"kind": "trailing_periods", "count": 30}),
])
def test_observation_context_projects_every_time_and_window_variant(time, expected, window, projected):
    result = _interpretation(schema(value_contexts={"revenue": observation(time, window)}))
    assert result["valueContexts"]["revenue"] == {
        "kind": "observation", "subject": {"kind": "metric", "path": "sales.revenue", "definitionId": "def:sales.revenue"},
        "time": expected, "window": projected}


def test_statistic_share_and_pair_contexts_resolve_groups_and_inputs():
    region = NS(kind="axis", axis_token="region-axis")
    east = NS(kind="fixed", fixed=fixed())
    contexts = {
        "revenue": NS(kind="statistic", statistic="sum", groups=(region, east), row_scope="restricted"),
        "orders": NS(kind="share", numerator=NS(kind="named", name="revenue", subject=origin()),
                     groups=(), along=(region,), row_scope="complete"),
        "coefficient": NS(kind="pair_statistic", statistic="spearman",
                          x=NS(kind="derived", origins=(origin(), origin("sales.order_count"))),
                          y=NS(kind="named", name="orders", subject=None), groups=(), row_scope="complete"),
    }
    result = _interpretation(schema(values=("revenue", "orders", "coefficient"), value_contexts=contexts))
    statistic, share, pair = (result["valueContexts"][n] for n in ("revenue", "orders", "coefficient"))
    assert statistic["groups"][0] == {"kind": "axis", "axisToken": "region-axis"}
    assert statistic["groups"][1]["fixed"]["key"] == ["east"]
    assert statistic["rowScope"] == "restricted"
    assert share == {"kind": "share", "numerator": {"kind": "named", "name": "revenue", "subject": {
        "kind": "metric", "path": "sales.revenue", "definitionId": "def:sales.revenue"}},
        "groups": [], "along": [{"kind": "axis", "axisToken": "region-axis"}], "rowScope": "complete"}
    assert pair["x"]["kind"] == "derived" and [o["path"] for o in pair["x"]["origins"]] == ["sales.revenue", "sales.order_count"]
    assert pair["y"] == {"kind": "named", "name": "orders", "subject": None}


def comparison(**overrides):
    base = dict(
        input_id="input", comparison_id="internal.previous", alias="previous",
        groups=(NS(group_id="internal-group", name="revenue", values=(
            NS(role="current", name="revenue"), NS(role="baseline", name="previous.baseline.revenue"),
            NS(role="absolute", name="previous.absolute.revenue"), NS(role="relative", name="previous.relative.revenue")),
            current_context=observation(NS(kind="compared", comparison_id="internal.previous", endpoint="current")),
            baseline_context=observation(NS(kind="compared", comparison_id="internal.previous", endpoint="baseline"))),),
        binding=NS(kind="calendar", current_axis_token="month-axis", current_endpoint="self",
                   baseline=NS(kind="calendar", name="sales.order.ordered_at", at=None, timezone="UTC", grain=MONTH)),
        presence=NS(current="current.present", baseline="previous.present", enclosing=()),
        current_fixed_axes=(fixed(),), baseline_fixed_axes=(fixed(("west",)),))
    base.update(overrides)
    return NS(**base)


COMPARED_VALUES = ("revenue", "previous.baseline.revenue", "previous.absolute.revenue", "previous.relative.revenue")
COMPARED_PRESENCE = ("current.present", "previous.present")


def test_comparison_and_change_decomposition_replace_internal_ids_with_index_and_group_name():
    decomposition = NS(target=NS(kind="absolute", comparison_id="internal.previous", group_id="internal-group"),
                       groups=(NS(kind="axis", axis_token="month-axis"), NS(kind="fixed", fixed=fixed())),
                       row_scope="complete", outputs=(
                           NS(field_kind="value", role="contribution", name="revenue"),
                           NS(field_kind="presence", role="current_present", name="current.present")))
    result = _interpretation(schema(values=COMPARED_VALUES, presence=COMPARED_PRESENCE,
                                    comparisons=(comparison(),), decompositions=(decomposition,)))
    item = result["comparisons"][0]
    assert item["alias"] == "previous"
    assert item["binding"] == {"kind": "calendar", "axisToken": "month-axis", "endpoint": "self", "baseline": {
        "kind": "calendar", "name": "sales.order.ordered_at", "at": None, "timezone": "UTC",
        "grain": {"kind": "builtin", "unit": "month", "step": 1}}}
    assert item["groups"][0]["currentContext"]["time"] == {"kind": "compared", "comparison": 0, "endpoint": "current"}
    assert item["presence"] == {"current": "current.present", "baseline": "previous.present", "enclosing": []}
    assert [f["key"] for f in item["currentFixedAxes"] + item["baselineFixedAxes"]] == [["east"], ["west"]]
    assert result["decompositions"][0]["target"] == {"kind": "absolute", "comparison": 0, "group": "revenue"}
    assert result["decompositions"][0]["outputs"][1] == {"fieldKind": "presence", "role": "current_present",
                                                         "name": "current.present"}
    assert "internal" not in str(result)


def test_level_decomposition_and_ordinary_comparison():
    level = NS(target=NS(kind="level", name="revenue", context=observation()), groups=(),
               row_scope="restricted", outputs=(NS(field_kind="value", role="total", name="revenue"),))
    ordinary = comparison(binding=NS(kind="ordinary"), alias=None, presence=None)
    result = _interpretation(schema(values=COMPARED_VALUES, comparisons=(ordinary,), decompositions=(level,)))
    assert result["comparisons"][0]["binding"] == {"kind": "ordinary"}
    assert result["comparisons"][0]["alias"] is None
    assert result["decompositions"][0]["target"]["kind"] == "level"
    assert result["decompositions"][0]["rowScope"] == "restricted"


def test_alignment_sides_keep_axis_endpoints_and_fixed_coordinates():
    side = lambda prefix, coordinates: NS(values=(prefix + ".revenue",), presence=(prefix + "_present",),
                                         coordinates=coordinates)
    alignment = NS(input_id="input", alignment_id="internal-alignment",
                   left=side("left", (NS(axis_token="month-axis", endpoint="self"),)),
                   right=side("right", (NS(kind="fixed", fixed=fixed()),)))
    result = _interpretation(schema(values=("left.revenue", "right.revenue"),
                                    presence=("left_present", "right_present"), alignments=(alignment,)))
    left, right = result["alignments"][0]["left"], result["alignments"][0]["right"]
    assert left == {"values": ["left.revenue"], "presence": ["left_present"],
                    "coordinates": [{"kind": "axis", "axisToken": "month-axis", "endpoint": "self"}]}
    assert right["coordinates"][0]["kind"] == "fixed"


def test_fixed_axis_keys_use_the_owning_key_codec():
    axis = NS(token="fixed-account", name="sales.customer", role="identity", keys=(ACCOUNT_KEY, OPENED_KEY))
    result = _interpretation(schema(fixed_axes=(fixed((2**53 + 1, datetime(2026, 1, 2, tzinfo=UTC)), axis),)))
    item = result["fixedAxes"][0]
    assert item["key"] == ["9007199254740993", "2026-01-02T00:00:00+00:00"]
    assert [k["slotId"] for k in item["keys"]] == ["account-key", "opened-key"]
    assert item["role"] == "identity"


@pytest.mark.parametrize("facts", [
    {"value_contexts": {"revenue": NS(kind="statistic", statistic="sum", row_scope="complete",
                                      groups=(NS(kind="axis", axis_token="removed-axis"),))}},
    {"value_contexts": {"removed": observation()}},
    {"value_contexts": {"revenue": observation(NS(kind="compared", comparison_id="other", endpoint="current"))}},
    {"values": COMPARED_VALUES, "comparisons": (comparison(input_id="other-input"),)},
    {"values": COMPARED_VALUES, "presence": COMPARED_PRESENCE, "comparisons": (comparison(),), "decompositions": (
        NS(target=NS(kind="relative", comparison_id="internal.previous", group_id="missing"), groups=(),
           row_scope="complete", outputs=()),)},
])
def test_unresolvable_references_are_identity_mismatch(facts):
    assert _section("interpretation", True, lambda: _interpretation(schema(**facts))) == {
        "status": "unavailable", "reason": "identity-mismatch"}


@pytest.mark.parametrize("facts", [
    {"value_contexts": {"revenue": NS(kind="future")}},
    {"value_contexts": {"revenue": observation(window=NS(kind="rolling"))}},
    {"value_contexts": {"revenue": NS(kind="statistic", statistic="median", groups=(), row_scope="complete")}},
    {"decompositions": (NS(target=NS(kind="level", name="revenue", context=None), groups=(), row_scope="complete",
                           outputs=(NS(field_kind="value", role="future_effect", name="revenue"),)),)},
    {"value_contexts": {"revenue": NS(kind="observation", time=None, window=None)}},
])
def test_unknown_upstream_variants_and_missing_members_are_runtime_incompatible(facts):
    assert _section("interpretation", True, lambda: _interpretation(schema(**facts))) == {
        "status": "unavailable", "reason": "runtime-incompatible"}


def test_missing_public_members_are_runtime_incompatible_without_other_read_paths():
    frame, _ = fixture()
    sections = read_frame(frame)["frame"]["sections"]
    assert sections == {name: {"status": "unavailable", "reason": "runtime-incompatible"}
                        for name in ("semantics", "interpretation", "periods")}


def test_interpretation_failure_hides_raw_runtime_text():
    frame, _ = fixture()
    for name in ("fixed_axes", "comparisons", "decompositions", "alignments"):
        setattr(frame.schema, name, ())
    class Exploding:
        def items(self):
            raise RuntimeError("/private/store/path secret")
    frame.schema.value_contexts = Exploding()
    result = read_frame(frame)
    assert result["frame"]["sections"]["interpretation"] == {"status": "unavailable", "reason": "read-failed"}
    assert "secret" not in str(result)


# Periods -------------------------------------------------------------------

def calendar(key, label="2026-08", selection="full", cutoff=None):
    return NS(kind="calendar", key=key, timezone="UTC", label=label, ordinal=7,
              nominal_ordinal=7, selection=selection, cutoff=cutoff)


def interval(key):
    return NS(kind="interval", key=key, timezone="UTC", start=T0, end=T1)


def periods_frame(axes, pages, comparisons=()):
    reads = []

    class Frame:
        @property
        def axes(self):
            return tuple(NS(token=a.token) for a in axes)

        def read_periods(self, target, *, limit):
            reads.append((getattr(target, "token", None) or target.comparison_id, limit))
            return pages[getattr(target, "token", None) or target.comparison_id](limit)
    return Frame(), schema(axes=axes, comparisons=comparisons), reads


def page(target, items, total=None, has_more=False):
    return NS(input_id="input", target=target, items=tuple(items), total_count=len(items) if total is None else total,
              has_more=has_more, next_cursor="next" if has_more else None)


def test_period_pages_cover_time_axes_and_time_comparisons_within_the_shared_budget():
    interval_key = NS(name="window", slot_id="window-key", dtype=NS(timezone="UTC", unit="us"), nullable=False, unit=None)
    interval_axis = NS(token="window-axis", name="window", role="interval", keys=(interval_key,), timezone="UTC")
    paired_axis = NS(token="pair-axis", name="pair", role="paired", keys=(MONTH_KEY, interval_key))
    previous = comparison()
    frame, facts, reads = periods_frame((REGION_AXIS, MONTH_AXIS, interval_axis, paired_axis), {
        "month-axis": lambda limit: page(MONTH_AXIS, [calendar((2**53 + 1,))], total=40, has_more=True),
        "window-axis": lambda limit: page(interval_axis, [interval((T0,))]),
        "pair-axis": lambda limit: page(paired_axis, [NS(kind="paired", key=(7, T0), left=calendar((7,)), right=None)]),
        "internal.previous": lambda limit: page(previous, [NS(kind="comparison", key=(8,), current=calendar((8,)),
                                                              baseline=None, absent_reason="period_absent")]),
    }, (previous,))
    result = _periods(frame, facts)
    assert [r[1] for r in reads] == [1250] * 4
    month, window, pair, compared = result["pages"]
    assert month["target"] == {"kind": "axis", "axisToken": "month-axis"}
    assert (month["totalCount"], month["hasMore"]) == (40, True)
    assert month["items"][0] == {"kind": "calendar", "key": ["9007199254740993"], "timezone": "UTC",
                                 "label": "2026-08", "selection": "full", "cutoff": None}
    assert window["items"][0]["key"] == ["2026-08-01T00:00:00+00:00"]
    assert pair["items"][0]["key"] == ["7", "2026-08-01T00:00:00+00:00"]
    assert pair["items"][0]["left"]["key"] == ["7"] and pair["items"][0]["right"] is None
    assert compared["target"] == {"kind": "comparison", "comparison": 0}
    assert compared["items"][0]["baseline"] is None and compared["items"][0]["absentReason"] == "period_absent"
    assert "ordinal" not in str(result) and "civil" not in str(result)


def test_ordinary_frames_capture_an_empty_period_section():
    frame, facts, reads = periods_frame((REGION_AXIS,), {})
    assert _periods(frame, facts) == {"status": "captured", "pages": []}
    assert reads == []


def test_calendar_selection_and_cutoff_are_captured_without_inventing_boundaries():
    periods = [calendar((i,), selection=selection, cutoff=cutoff) for i, (selection, cutoff) in enumerate([
        ("full", None), ("prefix", "2026-08-17T12:30:00"), ("partial", None), ("unavailable", None),
    ])]
    frame, facts, _ = periods_frame((MONTH_AXIS,), {"month-axis": lambda limit: page(MONTH_AXIS, periods)})
    items = _periods(frame, facts)["pages"][0]["items"]
    assert [(item["selection"], item["cutoff"]) for item in items] == [
        ("full", None), ("prefix", "2026-08-17T12:30:00"), ("partial", None), ("unavailable", None),
    ]
    assert all(not ({"start", "end", "nominalStart", "nominalEnd"} & item.keys()) for item in items)


def test_unknown_calendar_selection_degrades_only_the_period_section():
    frame, facts, _ = periods_frame((MONTH_AXIS,), {
        "month-axis": lambda limit: page(MONTH_AXIS, [calendar((1,), selection="future-kind")]),
    })
    assert _section("periods", True, lambda: _periods(frame, facts)) == {
        "status": "unavailable", "reason": "runtime-incompatible",
    }


def test_period_page_identity_and_budget_failures_degrade_only_the_section():
    frame, facts, _ = periods_frame((MONTH_AXIS,), {"month-axis": lambda limit: page(REGION_AXIS, [])})
    assert _section("periods", True, lambda: _periods(frame, facts)) == {
        "status": "unavailable", "reason": "identity-mismatch"}
    frame, facts, _ = periods_frame((MONTH_AXIS,), {"month-axis": lambda limit: page(MONTH_AXIS, [], total=0, has_more=True)})
    assert _section("periods", True, lambda: _periods(frame, facts)) == {"status": "unavailable", "reason": "read-failed"}
    frame, facts, _ = periods_frame((MONTH_AXIS,), {"month-axis": lambda limit: page(MONTH_AXIS, [interval((1,))])})
    assert _section("periods", True, lambda: _periods(frame, facts)) == {"status": "unavailable", "reason": "read-failed"}
    big = [calendar((i,), label="x" * 2000) for i in range(5000)]
    frame, facts, _ = periods_frame((MONTH_AXIS,), {"month-axis": lambda limit: page(MONTH_AXIS, big[:limit])})
    assert _section("periods", True, lambda: _periods(frame, facts)) == {"status": "unavailable", "reason": "budget"}


def test_normal_daily_periods_fit_the_section_cap():
    days = [calendar((i,), label=f"2026-{i:04d}") for i in range(5000)]
    frame, facts, _ = periods_frame((MONTH_AXIS,), {"month-axis": lambda limit: page(MONTH_AXIS, days[:limit])})
    result = _section("periods", True, lambda: _periods(frame, facts))
    assert result["status"] == "captured" and len(result["pages"][0]["items"]) == 5000


def test_comparison_pages_cannot_outlive_their_interpretation():
    sections = {"semantics": "x", "interpretation": {"status": "unavailable", "reason": "budget"},
                "periods": {"status": "captured", "pages": [{"target": {"kind": "comparison", "comparison": 0}}]}}
    assert _dependent(sections)["periods"] == {"status": "unavailable", "reason": "budget"}
