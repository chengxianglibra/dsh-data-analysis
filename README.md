# DSH Data Analysis

`dsh-data-analysis` 把 Marivo 接入 DeepSeek Harness。插件只拥有跨系统 seam：共享 Runtime、
Workspace binding、实时 Help transport、DSH Credentials 闭环、用户显式请求来源时的 Turn/Web Evidence
投影，以及 Marivo Artifact/Session Graph 到有界 JavaScript 快照的忠实投影。分析语义、Artifact、Quality、
Evidence、Lineage、revalidation 和 Session Graph 由 Marivo 拥有；最终表达和报告页面由 Agent 拥有。

当前版本是一次 clean break：旧 `ReportDocument`、HTML renderer、报告发布器、专用 Web 卡片和旧产物
replay 已删除，不提供 alias 或迁移路径。

## 当前能力

- 在 `$DSH_HOME` 下安装或复用精确的 `marivo[duckdb,trino,clickhouse]==0.5.2`；
- 为每个 Workspace 建立独立 binding，并在每次领域子进程内复核 Python/package identity；
- 激活 `marivo-analysis` 或 `marivo-semantic` 时注入当前 Runtime 的实时根 Help；
- 提供 `marivo_help` 作为 Native Tool transport；
- 提供 `marivo_datasource_test`，完成缺失 DSH Credentials 的 Web 收集和显式连接测试；
- 为普通 one-shot Shell 注入当前 Workspace datasource 的已配置 `DSH_*` 凭据引用；
- 提供 `marivo_evidence_sources`，把精确 Artifact-owned Finding 投影到 DSH 来源面板；
- 安装 `dsh-data-analysis-report-kit`，提供 `emit_dataset(BaseFrame, ...)` 与
  `emit_session_trace(SessionGraph, ...)` 两个 Marivo JavaScript 投影器；
- 打包并挂载 `dsh-data-analysis-report` Skill，其中只有内容组织、布局、样式和检查原则，以及配套的
  Artifact/DAG JavaScript 读取运行时。

插件不会注册 Artifact inspection、Quality、Session recovery、Session Graph、semantic readiness、
datasource inspection、Artifact export、HTML Checker 或报告 renderer Tool。Agent 应直接使用 Marivo 公共对象
和实时 Help。报告 Skill 不包含页面模板、CSS、通用 chart helper、snippets 或完整示例。

## 所有权边界

| 所有者 | 职责 |
| --- | --- |
| DeepSeek Harness | Agent/session/tool/skill lifecycle、Credentials、文件 mutation、Produced Files、Host opener |
| Marivo | Session、Run、Artifact、Finding、Evidence、Quality、Lineage、revalidation、公共读取语义 |
| 本插件 | Runtime/Workspace binding、Help transport、credential-safe seam、精确来源 UI adapter、Marivo JS 投影 |
| Agent | 分析判断、内容选择、图表、HTML/CSS/JS、页面结构、交互与叙事 |

详细设计见[总体架构](docs/architecture.md)和
[Agent 原生报告增强能力设计](docs/plan/agent-native-report-primitives-design.md)。

## Runtime 与 Workspace

默认共享 Runtime：

```text
$DSH_HOME/dsh-data-analysis/runtimes/marivo/
├── .venv/
├── skills/
└── installation.json
```

插件严格验证 `marivo.__version__`、`marivo.__file__`、report-kit identity、解释器路径和 marker。管理员可通过
`DSH_DATA_ANALYSIS_PYTHON` 提供已经安装精确版本的绝对 Python；未提供时插件使用 `uv` 安装固定 package
spec。当前正式支持版本是已经发布的 Marivo 0.5.2；其他版本或开发 checkout 必须明确失败。

Workspace 解析顺序为：显式 `projectRoot`、`DSH_DATA_ANALYSIS_PROJECT_ROOT`、Session cwd、`DSH_CWD`、
进程 cwd。默认只补齐 `marivo.toml`、`models/` 和 `.marivo/`，不覆盖已有用户文件。

## Tool surface

### `marivo_help`

```text
marivo_help({ targets: ["analysis.session.runtime", ...] })
```

返回当前 binding 的实时公共 Help。插件不维护 target registry；空数组返回环境身份回执。

### `marivo_datasource_test`

```text
marivo_datasource_test({ name: "warehouse" })
```

Tool 先读取 datasource 的 `DSH_*` 引用，再通过 DSH Credentials operation-scoped resolve，最后调用真实
`md.test()`。缺失值只返回引用名并交给 Web 表单，不把 secret 放进聊天、argv、日志或结果。Datasource
metadata inspection 不合并到该 Tool；Agent 直接在凭据注入的 one-shot Shell 中调用
`md.inspect(datasource_ref, source)`。

### `marivo_evidence_sources`

```text
marivo_evidence_sources({
  session_id: "...",
  sources: [
    { artifact_ref: "...", finding_id: "..." }
  ]
})
```

只在用户明确要求来源、出处、provenance 或审计时调用。Bridge 使用
`session.artifact(artifact_ref).finding(finding_id)`，Finding 不属于该 Artifact 时按 Marivo typed error
失败，不回退到 Session-wide 搜索。该投影证明来源 identity，不证明整句话、计算或建议正确。

## Agent 原生报告

用户请求 HTML/Web 输出，或分析需要多个图表/表格或较长的分章节呈现时，Agent 加载
`dsh-data-analysis-report` Skill。已有分析先恢复并 revalidate 精确 persisted Artifacts，不为生成报告或补齐
DAG 细节重新执行 `observe`。报告没有页面 schema、HTML Checker 或 renderer。Agent 直接读取：

- `artifact.show()` / `render()`、`contract()`、`quality_summary`、`lineage`；
- `session.revalidate(ref)` 和 Artifact-owned `findings()` / `finding()`；
- `session.runs(...)`、`session.get_run(...)`、`session.graph(...)`；
- 在实时 Help 允许的 terminal boundary 使用 `artifact.to_pandas()`。

只有两个报告增强面由插件提供：`emit_dataset` 把 Marivo `BaseFrame` 投影成有界 Artifact JavaScript
snapshot，`emit_session_trace` 把调用方已经取得的 `SessionGraph` 投影成有界 DAG JavaScript snapshot。前者
不接受普通 DataFrame；多 Session 分别投影并集中展示，Frame preview 按 `session_id + artifact_ref` 精确
关联。两者都不读取私有 Store、不重新分析，也不把快照提升为 Marivo authority。

每份新报告或修订默认使用新目录，入口固定为 `index.html`，资源使用 bundle 内相对路径：

```text
<workspace>/<new-report-directory>/
├── index.html
├── assets/   # optional
└── data/     # optional
```

先生成并检查资源，最后写 `index.html`。Native/both 模式通过顶层 `write` / `edit` 让入口进入 Produced
Files；最终回答以 Markdown 行内代码交付文件 Tool 返回的精确路径，使 DSH Web 可将同轮产出解析为可点击
入口。Code-only 模式在 `run_code` 内调用同一文件 Tool，但嵌套 mutation 只能保证精确路径。普通目录 bundle
没有目录级事务、digest、不可变身份、历史字节 replay、权限发布或 share 语义。

## 开发与验证

要求 Node.js 24+：

```bash
npm install
npm run check
npm run build
npm run verify:plugin-package
```

聚焦入口：

```bash
npm run test:agent-native-report-primitives
npm run test:datasource-credentials
npm run test:evidence-sources
```

## 模块文档

- [Runtime 与 Workspace](docs/modules/runtime-workspace.md)
- [Environment 执行边界](docs/modules/environment-execution.md)
- [实时 Help 披露](docs/modules/help-disclosure.md)
- [Datasource Credentials](docs/modules/datasource-credentials.md)
- [Evidence 来源交付](docs/modules/evidence-sources.md)
- [插件集成与交付](docs/modules/plugin-integration-delivery.md)
