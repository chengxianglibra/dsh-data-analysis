# Session trace

For each major persisted Artifact used in the report, obtain a focused public graph and emit it
separately from Artifact revalidation:

```python
from dsh_data_analysis_report import emit_dataset, emit_session_trace

graph = session.graph(
    artifact_ref=artifact.ref,
    direction="ancestors",
    max_nodes=100,
)

# 每个 Frame 节点都必须注册 identity-matched Artifact dataset；只需 10 行预览。
for index, summary in enumerate(graph.artifacts, start=1):
    frame = session.artifact(summary.ref)
    emit_dataset(
        frame,
        report_dir / "data" / f"trace-frame-{index}.js",
        max_rows=10,
    )

emit_session_trace(
    graph,
    report_dir / "data" / "analysis-trace.js",
    report_artifact_refs=[artifact.ref],
)
```

每个 `output_mode="produced"` 的 `observe` Run 都必须提供 SQL execution disclosure。只能传入调用方已经
持有并确认可披露的参数化 SQL；Report kit 不读取 Marivo 私有 Store，也不从 bind values 还原原始业务值：

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

SQL 在选中所属分析动作时显示于 DAG 与节点详情下方的全宽审计区，默认保留原始换行和横向滚动，并可切换
自动换行。不要把 raw SQL、bind values、credential、env value 或含敏感字面量的查询传入该字段。当前 pin
没有公开的 post-hoc Query read；调用方未在执行边界持有安全 Query record 时，报告必须保留
`trace.observe-query-missing` error 并标记为未完成，不能读取私有持久化路径或把 `0 条 SQL` 当作完整链路。

Load provider, snapshot, and consumer in order:

```html
<script src="./assets/report-data.js"></script>
<script src="./data/trace-frame-1.js"></script>
<!-- 继续加载 graph 中其余 identity-matched Frame snapshots。 -->
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

选择 Frame 节点时，`ReportTrace` 会按内部 Artifact ref 查找已注册的 `ReportData` Artifact dataset，并在节点
详情中显示行数摘要和最多 10 行的有界预览。每个本地 Frame 节点都必须有匹配 dataset；缺失时 Checker
返回 `trace.artifact-preview-missing` error。不会把 computed dataset 当作 Artifact，也不会复制数据到 trace
snapshot。页面只用内部 identity 做关联，不向读者展示 Run ID 或 Artifact ref；分析动作展示 `analysis_purpose`
（缺失时回退到 capability），Frame 展示 family 并用分析目的作辅助标签。DAG 不重复显示 edge kind 文本，也不
提供线性 fallback。
