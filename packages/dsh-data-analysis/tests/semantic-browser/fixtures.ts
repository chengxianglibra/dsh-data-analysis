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
is_working = ms.dimension_column(name="is_working", entity=orders, column="is_working")
week = ms.dimension_column(name="week", entity=orders, column="week")
ordered_at = ms.time_dimension_column(name="ordered_at", entity=orders, column="ordered_at", granularity="day", parse=ms.timestamp(timezone="UTC"))
calendar_date = ms.time_dimension_column(name="calendar_date", entity=orders, column="calendar_date", granularity="day")
ends = ms.time_dimension_column(name="ends", entity=orders, column="ends", granularity="day", parse=ms.timestamp(timezone="UTC"))
amount = ms.measure_column(name="amount", entity=orders, column="amount", additivity="additive", unit="CNY")
revenue = ms.aggregate(name="revenue", measure=amount, agg="sum", ai_context=ms.ai_context(business_definition="收入 Revenue <script>window.secret = true</script> " + "长定义😀" * 90, guardrails=("排除退款",)))
orders_to_users = ms.relationship(name="orders_to_users", from_entity=orders, to_entity=users, keys=[ms.join_on(order_id, user_id)])
@ms.event(name="order_created", identity=(order_id,), occurred_at=ordered_at, participants=(ms.participant(name="order", cardinality="one"),))
def order_created(rows):
    return ms.all_rows()
@ms.event(name="order_paid", identity=(order_id,), occurred_at=ordered_at, participants=(ms.participant(name="order", cardinality="one"),))
def order_paid(rows):
    return ms.all_rows()
created = ms.lifecycle_state(name="created", initial=True)
paid = ms.lifecycle_state(name="paid", terminal=True)
lifecycle = ms.state_model(name="lifecycle", subject=orders, states=(created, paid), transitions=(ms.inception(on=order_created), ms.transition(from_state=created, on=order_paid, to_state=paid)))
fiscal = ms.period_calendar(name="fiscal", date=calendar_date, boundary_timezone="UTC", coverage=(date(2026, 1, 1), date(2027, 1, 1)), levels={"week": week})
campaigns = ms.temporal_set(name="campaigns", occurrence_id=order_id, start=ordered_at, end=ends, category=region, boundary_timezone="UTC", coverage=(date(2026, 1, 1), date(2027, 1, 1)))
quarter_spend = ms.cumulative(name="quarter_spend", base=revenue, over=ordered_at, anchor=ms.grain_to_date(grain=ms.calendar_grain(calendar=fiscal, level="week")))
all_spend = ms.cumulative(name="all_spend", base=revenue, over=ordered_at)
rolling_spend = ms.cumulative(name="rolling_spend", base=revenue, over=ordered_at, anchor=ms.trailing(count=3, unit="day"))
weighted = ms.weighted_mean(name="weighted", value=amount, weight=amount)
ratio = ms.ratio(name="ratio", numerator=revenue, denominator=revenue)
@ms.metric(name="order_count", entities=[orders], additivity="additive")
def order_count(rows):
    return rows.id.count()
@ms.metric(name="cancelled_orders", entities=[orders], additivity="additive")
def cancelled_orders(rows):
    return rows.is_cancelled.cast("int64").sum()
cancellation_rate = ms.ratio(name="cancellation_rate", numerator=cancelled_orders, denominator=order_count)
linear = ms.linear(name="linear", add=[revenue, revenue], subtract=[revenue])
schedule = ms.work_schedule(name="schedule", date=calendar_date, is_working=is_working, boundary_timezone="UTC", coverage=(date(2026, 1, 1), date(2027, 1, 1)))
`,
  )
}
