import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CatalogSnapshot, SemanticObjectView } from '../../src/semantic-browser/contracts.ts'

export function object(name = 'revenue', kind = 'metric'): SemanticObjectView {
  return {
    ref: { schema: 'marivo.semantic_ref/v1', kind, path: `sales.${name}` },
    computation: null,
    name,
    domain: 'sales',
    definition: '收入 Revenue',
    guardrails: [],
    source: { file: '/project/models/sales.py', line: 1, symbol: name },
    fields: [],
    relations: [],
  }
}
export function snapshot(workspaceId = 'a', objects = [object()]): CatalogSnapshot {
  return {
    workspaceId,
    projectRoot: '/project',
    environmentFingerprint: 'env',
    fingerprint: 'catalog-1',
    loadedAt: '2026-09-05T00:00:00Z',
    kinds: [...new Set(objects.map((x) => x.ref.kind))],
    objects,
  }
}
/** Public authoring fixture: every supported kind; no database exists or is needed. */
export async function createBrowserWorkspace(root: string): Promise<void> {
  await mkdir(path.join(root, 'models/datasources'), { recursive: true })
  await mkdir(path.join(root, 'models/semantic/sales'), { recursive: true })
  await writeFile(
    path.join(root, 'models/datasources/warehouse.py'),
    'import marivo.datasource as md\nwarehouse = md.duckdb(name="warehouse", path="DO_NOT_DISCLOSE_DATABASE_PATH.duckdb")\n',
  )
  await writeFile(
    path.join(root, 'models/semantic/sales/_domain.py'),
    'import marivo.semantic as ms\nms.domain(name="sales", owner="Analytics", default=True)\n',
  )
  await writeFile(
    path.join(root, 'models/semantic/sales/objects.py'),
    String.raw`
from datetime import date
import marivo.datasource as md
import marivo.semantic as ms
orders = ms.entity(name="orders", datasource=ms.ref.datasource("warehouse"), source=md.table("orders"), primary_key=["id"])
users = ms.entity(name="users", datasource=ms.ref.datasource("warehouse"), source=md.table("users"))
order_id = ms.dimension_column(name="order_id", entity=orders, column="id")
user_id = ms.dimension_column(name="user_id", entity=users, column="id")
region = ms.dimension_column(name="region", entity=orders, column="region")
week = ms.dimension_column(name="week", entity=orders, column="week")
ordered_at = ms.time_dimension_column(name="ordered_at", entity=orders, column="ordered_at", parse=ms.timestamp(timezone="UTC"), is_default=True)
calendar_date = ms.time_dimension_column(name="calendar_date", entity=orders, column="calendar_date", parse=ms.date(timezone="UTC"))
ends = ms.time_dimension_column(name="ends", entity=orders, column="ends", parse=ms.timestamp(timezone="UTC"))
amount = ms.measure_column(name="amount", entity=orders, column="amount", additivity=ms.additive_all(), unit="CNY")
orders_to_users = ms.relationship(name="orders_to_users", from_entity=orders, to_entity=users, keys=[ms.join_on(order_id, user_id)])
fiscal = ms.period_calendar(name="fiscal", date=calendar_date, coverage=(date(2026, 1, 1), date(2027, 1, 1)), levels={"week": week})
campaigns = ms.temporal_set(name="campaigns", occurrence_id=order_id, start=ordered_at, end=ends, category=region, boundary_timezone="UTC", coverage=(date(2026, 1, 1), date(2027, 1, 1)))
@ms.metric(ai_context=ms.ai_context(business_definition="收入 Revenue <script>window.secret = true</script> " + "长定义😀" * 90, guardrails=("排除退款",)))
def revenue():
    return amount.sum(time=ordered_at)
@ms.metric()
def order_count():
    return amount.count()
@ms.metric()
def linear():
    return revenue * 2 - revenue
@ms.metric()
def ratio():
    return revenue / order_count
`,
  )
}
