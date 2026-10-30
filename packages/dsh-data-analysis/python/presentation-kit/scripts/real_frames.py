"""Produce real Marivo Frames and write their v2 snapshots as contract fixtures.

Usage: python real_frames.py WORK_DIR OUTPUT_DIR

WORK_DIR is a fresh directory outside the repository; it receives a small DuckDB
project modelled on Marivo's DSL test fixture. Only the selected interpreter's
installed Marivo and presentation kit are used. Each fixture is a read_frame
snapshot with the Session id and fetch time replaced by stable placeholders.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROWS = {
    "customer": (("A", "east"), ("B", "east"), ("C", "south"), ("D", "west")),
    "order": (
        ("ja", "A", "web", "2026-07-10T12:00:00+00:00", 100),
        ("jb", "B", "app", "2026-07-10T12:00:00+00:00", 100),
        ("jc", "C", "web", "2026-07-10T12:00:00+00:00", 50),
        ("aa", "A", "web", "2026-08-01T00:00:00+00:00", 60),
        ("ab", "B", "app", "2026-08-15T12:00:00+00:00", 120),
        ("ac", "C", "web", "2026-08-15T12:00:00+00:00", 30),
        ("sa", "A", "app", "2026-09-01T00:00:00+00:00", 30),
        ("sb", "B", "web", "2026-09-10T12:00:00+00:00", 200),
        ("sc", "C", "web", "2026-09-10T12:00:00+00:00", 10),
    ),
    "order_line": (
        ("l1", "ja", 60), ("l2", "ja", 40), ("l3", "jb", 100), ("l4", "jc", 50),
        ("l5", "aa", 60), ("l6", "ab", 70), ("l7", "ab", 50), ("l8", "ac", 30),
        ("l9", "sa", 30), ("l10", "sb", 200), ("l11", "sc", 10),
    ),
}

MODELS = """\
import marivo.datasource as md
import marivo.semantic as ms

warehouse = ms.ref.datasource('warehouse')
customer = ms.entity(name='customer', datasource=warehouse, source=md.table('customer'),
                     primary_key=['customer_id'])
orders = ms.entity(name='order', datasource=warehouse, source=md.table('order'), primary_key=['order_id'])
lines = ms.entity(name='order_line', datasource=warehouse, source=md.table('order_line'),
                  primary_key=['line_id'])
customer_id = ms.dimension_column(name='customer_id', entity=customer, column='customer_id')
order_customer_id = ms.dimension_column(name='customer_id', entity=orders, column='customer_id')
order_id = ms.dimension_column(name='order_id', entity=orders, column='order_id')
line_order_id = ms.dimension_column(name='order_id', entity=lines, column='order_id')
region = ms.dimension_column(name='region', entity=customer, column='region')
channel = ms.dimension_column(name='channel', entity=orders, column='channel')
ordered_at = ms.time_dimension_column(name='ordered_at', entity=orders, column='ordered_at',
                                      parse=ms.timestamp())
amount = ms.measure_column(name='amount', entity=orders, column='amount', additivity=ms.additive_all(),
                           unit='CNY')
line_amount = ms.measure_column(name='line_amount', entity=lines, column='line_amount',
                                additivity=ms.additive_all(), unit='CNY')
buyer = ms.relationship(name='order_buyer', from_entity=orders, to_entity=customer,
                        keys=[ms.join_on(order_customer_id, customer_id)])
line_order = ms.relationship(name='line_order', from_entity=lines, to_entity=orders,
                             keys=[ms.join_on(line_order_id, order_id)])
amount_value = amount
line_amount_value = line_amount
orders_value = orders
time_value = ordered_at
line_order_value = line_order

@ms.metric()
def revenue():
    return amount_value.sum(time=time_value)

@ms.metric()
def order_count():
    return orders_value.count(time=time_value)

@ms.metric()
def line_revenue():
    return line_amount_value.sum(time=time_value.via((line_order_value,)))

@ms.metric()
def aov():
    return line_revenue / order_count
"""


def seed(root: Path) -> Path:
    import duckdb

    database = root / "warehouse.duckdb"
    connection = duckdb.connect(str(database))
    try:
        connection.execute('CREATE TABLE customer (customer_id VARCHAR, region VARCHAR)')
        connection.execute('CREATE TABLE "order" (order_id VARCHAR, customer_id VARCHAR, channel VARCHAR, '
                           'ordered_at TIMESTAMPTZ, amount BIGINT)')
        connection.execute('CREATE TABLE order_line (line_id VARCHAR, order_id VARCHAR, line_amount BIGINT)')
        connection.executemany("INSERT INTO customer VALUES (?, ?)", ROWS["customer"])
        connection.executemany('INSERT INTO "order" VALUES (?, ?, ?, ?, ?)', ROWS["order"])
        connection.executemany("INSERT INTO order_line VALUES (?, ?, ?)", ROWS["order_line"])
    finally:
        connection.close()
    return database


def project(root: Path) -> None:
    database = seed(root)
    (root / "marivo.toml").write_text('[project]\nname = "dsh-frame-fixtures"\n')
    files = {
        root / "models/datasources/warehouse.py":
            f"import marivo.datasource as md\nmd.duckdb(name='warehouse', path={str(database)!r})\n",
        root / "models/semantic/sales/_domain.py":
            "import marivo.semantic as ms\nms.domain(name='sales', owner='Fixture', default=True)\n",
        root / "models/semantic/sales/models.py": MODELS,
    }
    for path, text in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


def frames(session, mv):
    """Yield (name, operation, completed Frame) for each covered Frame shape."""
    catalog = session.catalog
    revenue = catalog.get("metric:sales.revenue")
    orders = catalog.get("metric:sales.order_count")
    aov = catalog.get("metric:sales.aov")
    amount = catalog.get("measure:sales.order.amount")
    ordered_at = catalog.get("time_dimension:sales.order.ordered_at")
    region = catalog.get("dimension:sales.customer.region")
    channel = catalog.get("dimension:sales.order.channel")
    customer = catalog.get("entity:sales.customer")
    month = mv.grain("month")

    def months(start, end):
        return session.time_scope(start=start, end=end).by(month)

    q3 = months("2026-07-01", "2026-10-01")
    september = months("2026-09-01", "2026-10-01")
    august = months("2026-08-01", "2026-09-01")

    yield "observe-scalar", "session.observe by=()", session.observe({"revenue": revenue}).compute()
    series = session.observe({"revenue": revenue}, by=(q3,)).persist(description="Q3 monthly revenue")
    yield "observe-calendar", "session.observe by=(month,)", series
    by_region = session.observe({"revenue": revenue, "orders": orders}, by=(region,)).compute()
    yield "observe-category", "session.observe by=(region,)", by_region
    grid = session.observe({"revenue": revenue}, by=(q3, region)).compute()
    yield "observe-time-category", "session.observe by=(month, region)", grid

    yield "reduce", "reduce by=(region,)", grid.reduce({"revenue": grid["revenue"].sum()},
                                                      by=(grid.axis(grid.axes[1].name),)).compute()
    yield "over-broadcast", "select over(sum) by month", grid.select({
        "revenue": grid["revenue"],
        "month_total": grid.over(grid["revenue"].sum(), by=(grid.axes[0],)),
    }).compute()
    yield "share", "select share along region", grid.select({
        "revenue": grid["revenue"],
        "region_share": grid["revenue"].share(along=(grid.axes[1],)),
    }).compute()
    yield "correlate", "correlate pearson", by_region.correlate(
        by_region["revenue"], by_region["orders"], method="pearson").compute()

    members = session.members(customer)
    yield "members", "session.frame(members)", session.frame(members).compute()
    yield "read-records", "session.read(members)", session.read(members, {"region": region}).compute()
    yield "values", "session.values", session.values(
        by=(region,), columns={"target": "CNY"},
        rows=((("east",), {"target": 300}), (("south",), {"target": 80}))).compute()

    current = session.observe({"revenue": revenue}, by=(september, region))
    previous = session.observe({"revenue": revenue}, by=(august, region))
    calendar = current.compare({"previous": mv.baseline(previous, match=mv.offset(periods=-1))}).compute()
    yield "compare-calendar", "compare offset(-1) month", calendar

    # Pending fix() inputs: compute() resolves the comparison's fixed-axis key types.
    web = session.observe({"revenue": revenue}, by=(q3, channel))
    current_web, app = web.fix(web.axes[1], "web"), web.fix(web.axes[1], "app")
    yield "compare-ordinary", "compare fixed channel web vs app", current_web.compare(
        {"app": mv.baseline(app)}).compute()

    level = session.observe({"revenue": revenue}, by=(september,))
    yield "attribute-level", "attribute level by region", level.attribute(by=(region,)).compute()
    change = session.observe({"revenue": revenue}, by=(september,)).compare(
        {"previous": mv.baseline(session.observe({"revenue": revenue}, by=(august,)), match=mv.offset(periods=-1))})
    additive = change.attribute(by=(region,)).compute()
    yield "attribute-additive", "attribute compare by region", additive
    rate = session.observe({"aov": aov}, by=(september,)).compare(
        {"previous": mv.baseline(session.observe({"aov": aov}, by=(august,)), match=mv.offset(periods=-1))})
    yield "attribute-rate-mix", "attribute ratio compare by region", rate.attribute(by=(region,)).compute()
    # A product of sums is admitted only as a selected change column (sampled Shapley).
    product = amount.sum(time=ordered_at) * amount.sum(time=ordered_at)
    nonlinear = session.observe({"q": product}, by=(september,)).compare(
        {"previous": mv.baseline(session.observe({"q": product}, by=(august,)), match=mv.offset(periods=-1))})
    selected = nonlinear.select({"change": nonlinear["previous.absolute.q"]})
    yield "attribute-shapley", "attribute selected product change by channel (sampled Shapley)", selected.attribute(
        by=(channel,), permutations=8, seed=1).compute()
    regional = session.observe({"revenue": revenue}, by=(q3,)).attribute(by=(region,)).compute()
    yield "attribute-where", "attribute then where", regional.where(regional[
        next(n for n in regional.output_names if n.startswith("contribution"))] > 0).compute()
    yield "attribute-fix", "attribute then fix region", regional.fix(regional.axis(regional.axes[1].name),
                                                                     "east").compute()

    left = session.observe({"revenue": revenue}, by=(region,))
    right = session.observe({"orders": orders}, by=(region,))
    yield "align", "align by region", left.align(right).compute()
    yield "align-paired-time", "align month with prior month", session.observe(
        {"revenue": revenue}, by=(september,)).align(
        session.observe({"revenue": revenue}, by=(august,)), match=mv.offset(periods=-1)).compute()


def stable(snapshot):
    snapshot["fetchedAt"] = "2026-10-30T00:00:00+00:00"
    snapshot["source"]["sessionId"] = "session-fixture"
    return snapshot


def main(work: str, output: str) -> int:
    root = Path(work).resolve()
    root.mkdir(parents=True, exist_ok=False)
    project(root)
    os.environ["MARIVO_PROJECT_ROOT"] = str(root)
    os.chdir(root)
    import marivo
    import marivo.analysis as mv
    import marivo.semantic as ms
    import dsh_data_analysis_presentation as kit
    from dsh_data_analysis_presentation._frame import read_frame

    ms.load(workspace_dir=root)
    session = mv.session.get_or_create("frame-fixtures", timezone="UTC")
    target = Path(output).resolve()
    target.mkdir(parents=True, exist_ok=True)
    index = {"marivo": marivo.__version__, "presentationKit": kit.__version__, "python": sys.version.split()[0],
             "fixtures": []}
    for name, operation, frame in frames(session, mv):
        snapshot = stable(read_frame(frame))
        text = json.dumps(snapshot, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
        if str(root) in text or session.id in text:
            raise SystemExit(f"{name}: snapshot retains a local path or Session id")
        (target / f"{name}.json").write_text(text)
        sections = {k: v["status"] if isinstance(v, dict) else v for k, v in snapshot["frame"]["sections"].items()}
        index["fixtures"].append({"name": name, "operation": operation, "rows": snapshot["coverage"]["totalRows"],
                                  "axes": [a["variant"]["kind"] for a in snapshot["frame"]["axes"]],
                                  "values": [f["id"] for f in snapshot["frame"]["fields"] if f["role"] == "value"],
                                  "sections": sections})
    print(json.dumps(index, indent=1))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    raise SystemExit(main(sys.argv[1], sys.argv[2]))
