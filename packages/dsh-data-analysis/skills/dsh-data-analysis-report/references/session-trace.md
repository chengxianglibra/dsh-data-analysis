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
