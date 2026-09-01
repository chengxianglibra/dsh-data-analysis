# Session trace

For each major persisted Artifact used in the report, obtain a focused public graph and emit it
separately from Artifact revalidation:

```python
from dsh_data_analysis_report import emit_session_trace

graph = session.graph(
    artifact_ref=artifact.ref,
    direction="ancestors",
    max_nodes=100,
)
emit_session_trace(
    graph,
    report_dir / "data" / "analysis-trace.js",
    report_artifact_refs=[artifact.ref],
)
```

页面需要展示 SQL 时，只能传入调用方已经持有并确认可披露的参数化 SQL。Report kit 不读取 Marivo
私有 Store，也不从 bind values 还原原始业务值：

```python
from dsh_data_analysis_report import SessionTraceQuery

query = SessionTraceQuery(
    run_id=run.run_id,
    query_id="query-1",
    datasource="warehouse",
    dialect="trino",
    sql="SELECT month, SUM(revenue) FROM orders WHERE month >= ? GROUP BY 1",
    digest="7f83b1657ff1fc53",
    status="succeeded",
    duration_ms=842,
    row_count=12,
    started_at=started_at,
    finished_at=finished_at,
    output_artifact_ref=artifact.ref,
)
emit_session_trace(
    graph,
    report_dir / "data" / "analysis-trace.js",
    report_artifact_refs=[artifact.ref],
    queries=[query],
)
```

SQL 在选中所属 Run 时显示于 DAG 与节点详情下方的全宽审计区，默认保留原始换行和横向滚动，并可切换
自动换行。不要把 raw SQL、bind values、credential、env value 或含敏感字面量的查询传入该字段；没有安全
SQL disclosure 时保留空数组，不从私有持久化路径补取。

Load provider, snapshot, and consumer in order:

```html
<script src="./assets/report-trace.js"></script>
<script src="./data/analysis-trace.js"></script>
<script src="./assets/app.js"></script>
```

Render the appendix with:

```javascript
ReportTrace.renderSessionGraph(
  document.querySelector('#analysis-trace'),
  ReportTrace.get('analysis-trace'),
)
```

Preserve `truncated`, boundary identities, lifecycle states, edge kinds, and read boundaries. A
focused graph records execution relationships; it does not prove current semantic authority,
datasource freshness, Evidence completeness, or that the report follows from every node.

For multiple major Artifacts, create separate focused graphs rather than merging them in the
plugin. For computed-only reports, delete the trace section, provider and snapshot scripts, and
render call. Never leave an empty or example trace as a success state.

选择 Artifact 节点时，`ReportTrace` 会按 Artifact ref 查找已注册的 `ReportData` Artifact dataset，并在节点
详情中显示行数摘要和最多 10 行的有界预览。没有匹配 dataset 时只显示“未注册预览”，不会把 computed
dataset 当作 Artifact，也不会复制数据到 trace snapshot。
