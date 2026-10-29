"""Create 0.6 persisted Frames in an isolated validation Workspace using public APIs."""
import json
import os
from pathlib import Path
import ibis
import marivo.analysis as mv

root = Path.cwd()
(root / 'models/datasources').mkdir(parents=True, exist_ok=True)
(root / 'models/semantic/sales').mkdir(parents=True, exist_ok=True)
(root / 'models/datasources/warehouse.py').write_text("import marivo.datasource as md\nmd.duckdb(name='warehouse', path='warehouse.duckdb')\n")
(root / 'models/semantic/sales/_domain.py').write_text("import marivo.semantic as ms\nms.domain(name='sales', owner='Validation')\n")
(root / 'models/semantic/sales/datasets.py').write_text('''import marivo.datasource as md
import marivo.semantic as ms
orders = ms.entity(name='orders', datasource=ms.ref.datasource('warehouse'), source=md.table('orders'))
region = ms.dimension_column(name='region', entity=orders, column='region')
amount = ms.measure_column(name='amount', entity=orders, column='amount', additivity=ms.additive_all(), unit='USD')
account = ms.measure_column(name='account', entity=orders, column='account_id', additivity=ms.additive_all())
@ms.metric()
def revenue():
    return amount.sum()
@ms.metric()
def account_id():
    return account.max()
precise_orders = ms.entity(name='precise_orders', datasource=ms.ref.datasource('warehouse'), source=md.table('precise_orders'))
precise_region = ms.dimension_column(name='region', entity=precise_orders, column='region')
precise_amount = ms.measure_column(name='amount', entity=precise_orders, column='amount', additivity=ms.additive_all(), unit='USD')
precise_account = ms.measure_column(name='account', entity=precise_orders, column='account_id', additivity=ms.additive_all())
@ms.metric()
def precision_revenue():
    return precise_amount.sum()
@ms.metric()
def precision_account_id():
    return precise_account.max()
''')
connection = ibis.duckdb.connect(str(root / 'warehouse.duckdb'))
connection.raw_sql('CREATE TABLE orders (region VARCHAR, amount DECIMAL(20, 4), account_id BIGINT)')
connection.raw_sql("INSERT INTO orders VALUES ('A',12.5000,9007199254740993),('B',8.2500,9007199254740995),('C',NULL,9007199254740997),('D',4.0000,9007199254740999)")
connection.raw_sql('CREATE TABLE precise_orders (region VARCHAR, amount DECIMAL(20, 4), account_id BIGINT)')
connection.raw_sql("INSERT INTO precise_orders VALUES ('A',12345678901234.5678,9007199254740993),('B',0.1000,9007199254740995),('C',NULL,9007199254740997),('D',-12.3400,9007199254740999)")
connection.disconnect()
session = mv.session.get_or_create('presentation-s0-runtime')
catalog = session.catalog
region = catalog.get('dimension:sales.orders.region').value

def produce(metrics, axis):
    frame = session.observe(metrics={name: catalog.get('metric:sales.' + name).value for name in metrics}, by=(axis,)).persist()
    data = frame.to_pandas()
    return {'sessionId': frame.session_id, 'artifactRef': frame.artifact_id,
            'persistedRowCount': len(data), 'valueColumns': list(frame.output_names), 'dataColumns': list(data.columns)}

result = {
    'primary': produce(['revenue'], region),
    'secondary': produce(['account_id'], region),
    'precisionProbe': produce(['precision_revenue','precision_account_id'], catalog.get('dimension:sales.precise_orders.region').value),
    'generationPid': os.getpid(),
    'generationApi': 'session.observe(...).persist()',
    'precisionInputs': {'decimal':'12345678901234.5678','int64':'9007199254740993'},
}
# Restored reads must succeed with the business datasource and authored model unavailable.
(root / 'warehouse.duckdb').unlink()
(root / 'models/semantic/sales/datasets.py').write_text('raise AssertionError("Persisted read must not load semantic models")\n')
print(json.dumps(result))
