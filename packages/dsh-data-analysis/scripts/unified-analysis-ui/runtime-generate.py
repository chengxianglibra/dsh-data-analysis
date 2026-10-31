"""Small reusable P0 dataset; source removed before the second process reads."""
import importlib.metadata
import json
import os
from decimal import Decimal
from pathlib import Path

import ibis
import marivo
import marivo.analysis as mv
import marivo.datasource as md
import marivo.semantic as ms

root = Path.cwd()
(root / "models/datasources").mkdir(parents=True, exist_ok=True)
(root / "models/semantic/sales").mkdir(parents=True, exist_ok=True)
(root / "models/datasources/warehouse.py").write_text(
    "import marivo.datasource as md\nmd.duckdb(name='warehouse', path='warehouse.duckdb')\n"
)
(root / "models/semantic/sales/_domain.py").write_text(
    "import marivo.semantic as ms\nms.domain(name='sales', owner='P0')\n"
)
model = root / "models/semantic/sales/metrics.py"
model.write_text("""import marivo.datasource as md
import marivo.semantic as ms
orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))
region = ms.dimension_column(name='region', entity=orders, column='region')
amount = ms.measure_column(name='amount', entity=orders, column='amount', additivity=ms.additive_all(), unit='USD')
account = ms.measure_column(name='account', entity=orders, column='account', additivity=ms.additive_all())
@ms.metric()
def revenue():
    return amount.sum()
@ms.metric()
def account_id():
    return account.max()
""")
connection = ibis.duckdb.connect(str(root / "warehouse.duckdb"))
connection.raw_sql("CREATE TABLE orders (region VARCHAR, amount DECIMAL(20,4), account BIGINT)")
connection.raw_sql("INSERT INTO orders VALUES ('A',12345678901234.5678,9007199254740993),('B',NULL,NULL)")
connection.disconnect()
sql = md.raw_sql(ms.ref.datasource("warehouse"), "SELECT region, amount, account FROM orders ORDER BY region LIMIT 2", reason="P0 public result and precision probe")
assert isinstance(sql.rows[0]["amount"], Decimal)
assert isinstance(sql.rows[0]["account"], int)
session = mv.session.get_or_create("unified-ui-p0")
catalog = session.catalog
frame = session.observe(metrics={
    "revenue": catalog.get("metric:sales.revenue"),
    "account": catalog.get("metric:sales.account_id"),
}, by=(catalog.get("dimension:sales.orders.region"),)).persist()
result = {
    "pid": os.getpid(),
    "package": {"version": importlib.metadata.version("marivo"), "path": marivo.__file__,
                "directUrl": importlib.metadata.distribution("marivo").read_text("direct_url.json")},
    "frame": {"sessionId": frame.session_id, "artifactId": frame.artifact_id},
    "sql": {"columns": sql.columns, "types": sql.types,
            "rows": [{k: None if v is None else str(v) for k, v in row.items()} for row in sql.rows],
            "returned_row_count": sql.returned_row_count, "datasource": str(sql.datasource),
            "backend_type": sql.backend_type, "sql": sql.sql, "reason": sql.reason,
            "warnings": sql.warnings, "timeout_seconds": sql.timeout_seconds, "duration_ms": sql.duration_ms},
}
# CAPTURE_BEFORE_SOURCE_REMOVAL
(root / "warehouse.duckdb").unlink()
model.write_text("raise AssertionError('Saved reads must not load source models')\n")
print(json.dumps(result))
