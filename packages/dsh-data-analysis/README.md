# @deepseek-ai/dsh-data-analysis

DeepSeek Harness 的 Marivo 集成插件。当前包提供：

- 精确 Marivo 0.5.3 共享 Runtime 与 zero-init per-Workspace binding；
- `marivo_help` 实时公共 Help transport；
- `marivo_datasource_test` 的 DSH Credentials 收集与显式 connection test；
- `marivo_datasource_access` 的 30 分钟、最多 64 次 foreground Shell credential lease；
- `marivo_evidence_sources({ session_id, sources })` 的可移植 Artifact-owned Finding 来源交付；
- `emit_dataset(BaseFrame, ...)`、`emit_computed(DataFrame, ...)` 与
  `emit_session_trace(SessionGraph, ...)` 的有界 JavaScript 投影；
- 随包分发并挂载的 `dsh-data-analysis-report` Skill，以及 `marivo-analysis` 激活后的按需路由。

旧 `marivo_test`、`marivo_report_render`、`ReportDocument`、报告 parser/renderer/publisher、专用报告 Web
卡片与 replay 入口已删除，不提供 alias。

## Compatibility

包内 `dshDataAnalysisCompatibility` 是唯一运行时兼容声明：

- DSH distribution 与所有必需 peer 精确使用 `0.1.1-rc.2`；
- Marivo package spec 精确为 `marivo[duckdb,trino,clickhouse]==0.5.3`；
- 项目自有 Runtime marker 为 `dsh-data-analysis-runtime/v2`；
- 子进程策略为 `direct-argv-inherited-env-snapshot-overlay-v2`。

管理员解释器的 `marivo.__version__` 与 package identity 必须精确匹配；不使用 capability/version matrix。

## Tool contracts

```text
marivo_help({ targets: string[] })
marivo_datasource_test({ name: string })
marivo_datasource_access({ name: string })
marivo_evidence_sources({
  session_id: string,
  sources: Array<{ artifact_ref: string, finding_id: string }>
})
```

`marivo_datasource_test` 只拥有缺失 Credentials 的 DSH/Web 闭环和显式连接测试；
`marivo_datasource_access` 只签发有界 foreground Shell lease，不执行连接测试。`md.inspect(...)`、
Session recovery、Artifact revalidation、Quality、Evidence 读取、Session Graph 与 `to_pandas()` 都直接使用
Marivo 公共 API，不增加 convenience Tool。

## 报告交付

仅当用户明确请求 HTML/Web 或耐久报告、接受生成提议，或修改已有 bundle 时，Agent 加载
`dsh-data-analysis-report`；普通长回答或多图表/表格不会自动产出文件。已有分析恢复并 revalidate persisted
Artifacts，不为报告展示重新执行 `observe`。
该 Skill 只提供内容组织、布局、样式和检查原则，不包含页面 Starter、通用 chart helper、可视化 DSL 或
HTML Checker。配套 assets 提供 `ReportData` 读取、精简 Artifact 摘要和 Session DAG；Python report-kit
分别通过 `emit_dataset`、`emit_computed`、`emit_session_trace` 发射 Artifact、pandas DataFrame 与 Graph
快照；Artifact 与 Graph emitter 默认 `reader`，明确审计请求才使用 `audit`。多 Session 的独立 Graph 集中展示，
Frame preview 只按精确 Session 与 Artifact identity 关联。Agent 自由生成
`<workspace>/<new-report-directory>/index.html` 与可选相对资源。Native/both 的
最终入口使用顶层 DSH `write` / `edit`，并以精确 Markdown 行内路径交付，让 DSH Web 复用 Produced Files
提供点击；Code-only 在 `run_code` 内使用同一 Tool，但嵌套 mutation 只保证精确路径。插件不创建报告对象、
digest、不可变发布、历史字节 replay 或 share link。

## 验证

```bash
npm run check
npm run build
npm run verify:plugin-package
```

当前架构与验收边界见仓库根目录的[总体架构](../../docs/architecture.md)、
[插件能力优化设计](../../docs/plan/plugin-capability-optimization-design.md)和
[v2 验收记录](../../docs/acceptance/plugin-capability-optimization-v2.md)。
