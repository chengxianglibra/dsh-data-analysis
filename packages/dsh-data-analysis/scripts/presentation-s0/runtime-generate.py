"""Create S0's real, persisted source in the already bound validation Workspace."""

import json
import os
from pathlib import Path

import ibis
import marivo.analysis as mv


root = Path.cwd()
connection = ibis.duckdb.connect(":memory:")
connection.raw_sql(
    "CREATE TABLE orders (region VARCHAR, amount DECIMAL(20, 4), account_id BIGINT)"
)
connection.raw_sql(
    "INSERT INTO orders VALUES ('A', 12.5000, 9007199254740993), ('B', 8.2500, 9007199254740995), "
    "('C', NULL, 9007199254740997), ('D', 4.0000, 9007199254740999)"
)
connection.raw_sql(
    "CREATE TABLE precise_orders (region VARCHAR, amount DECIMAL(20, 4), account_id BIGINT)"
)
connection.raw_sql(
    "INSERT INTO precise_orders VALUES "
    "('A', 12345678901234.5678, 9007199254740993), "
    "('B', 0.1000, 9007199254740995), "
    "('C', NULL, 9007199254740997), "
    "('D', -12.3400, 9007199254740999)"
)
session = mv.session.get_or_create(
    name="presentation-s0-runtime",
    backends={"warehouse": lambda: connection},
    use_datasources=False,
)
revenue = session.catalog.metrics.get("sales.revenue")
account = session.catalog.metrics.get("sales.account_id")
region = session.catalog.dimensions.get("sales.orders.region")
artifact = session.observe(metrics=revenue, dimensions=[region])
second = session.observe(metrics=account, dimensions=[region])
precision = session.observe(
    metrics=[session.catalog.metrics.get("sales.precision_revenue"), session.catalog.metrics.get("sales.precision_account_id")],
    dimensions=[session.catalog.dimensions.get("sales.precise_orders.region")],
)


def selection(frame):
    return {
        "sessionId": session.id,
        "artifactRef": frame.ref,
        "findingId": frame.findings(limit=1).items[0].finding_id,
        "persistedRowCount": frame.meta.row_count,
        "valueColumns": list(frame.value_columns),
    }


result = {
    "primary": selection(artifact),
    "secondary": selection(second),
    "precisionProbe": selection(precision),
    "generationPid": os.getpid(),
    "generationApi": "session.observe(metrics=public_catalog_metrics, dimensions=public_catalog_dimensions)",
    "precisionInputs": {"decimal": "12345678901234.5678", "int64": "9007199254740993"},
}
session.close()
connection.disconnect()
print(json.dumps(result, ensure_ascii=False, allow_nan=False))
