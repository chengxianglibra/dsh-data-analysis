# @deepseek-ai/dsh-data-analysis

DeepSeek Harness 的 Marivo 集成插件。当前包提供：

- 精确 Marivo 0.5.1 共享 Runtime 与 per-Workspace binding；
- `marivo_help` 实时公共 Help transport；
- `marivo_datasource_test` 的 DSH Credentials 收集与显式 connection test；
- datasource one-shot Shell 的 operation-scoped credential injection；
- `marivo_evidence_sources({ session_id, sources })` 的 Artifact-owned Finding 来源投影；
- 随包分发并挂载的 `dsh-data-analysis-report` Skill，以及 `marivo-analysis` 激活后的按需路由。

旧 `marivo_test`、`marivo_report_render`、`ReportDocument`、报告 parser/renderer/publisher、专用报告 Web
卡片与 replay 入口已删除，不提供 alias。

## Compatibility

包内 `dshDataAnalysisCompatibility` 是唯一运行时兼容声明：

- DSH distribution 与所有必需 peer 精确使用 `0.1.1-rc.2`；
- Marivo package spec 精确为 `marivo[duckdb,trino,clickhouse]==0.5.1`；
- 项目自有 Runtime marker 为 `dsh-data-analysis-runtime/v1`；
- 子进程策略为 `direct-argv-inherited-env-snapshot-overlay-v1`。

管理员解释器的 `marivo.__version__` 与 package identity 必须精确匹配；不使用 capability/version matrix。

## Tool contracts

```text
marivo_help({ targets: string[] })
marivo_datasource_test({ name: string })
marivo_evidence_sources({
  session_id: string,
  sources: Array<{ artifact_ref: string, finding_id: string }>
})
```

`marivo_datasource_test` 只拥有缺失 Credentials 的 DSH/Web 闭环和显式连接测试。`md.inspect(...)`、
Session recovery、Artifact revalidation、Quality、Evidence 读取、Session Graph 与 `to_pandas()` 都直接使用
Marivo 公共 API，不增加 convenience Tool。

## 报告交付

用户明确请求或接受 HTML 报告后，Agent 加载 `dsh-data-analysis-report`。该 Skill 指导 Agent 自由生成
`<workspace>/<new-report-directory>/index.html` 与可选相对资源。Native/both 的最终入口使用顶层 DSH
`write` / `edit`；Code-only 在 `run_code` 内使用同一 Tool 并输出精确路径。插件不创建报告对象、digest、
不可变发布、历史字节 replay 或 share link。

## 验证

```bash
npm run check
npm run build
npm run verify:plugin-package
npm run validate:agent-native-report-primitives:real
```

架构与验收边界见仓库根目录的
[Agent 原生报告增强能力设计](../../docs/plan/agent-native-report-primitives-design.md)。
