# DSH Data Analysis

`dsh-data-analysis` 把 Marivo 接入 DeepSeek Harness。插件只拥有跨系统 seam：共享 Runtime、
Workspace binding、实时 Help transport、DSH Credentials 闭环、用户显式请求来源时的 Turn/Web Evidence
投影，以及 Artifact/pandas 数据快照与 Marivo 专属 HTML 组件。分析语义、Artifact、Quality、
Evidence、Lineage、revalidation 和 Session Graph 由 Marivo 拥有；最终表达和报告页面由 Agent 拥有。

当前版本是一次 clean break：旧 `ReportDocument`、HTML renderer、报告发布器、专用 Web 卡片和旧产物
replay 已删除，不提供 alias 或迁移路径。

## 当前能力

- 在 `$DSH_HOME` 下安装或复用精确的 `marivo[duckdb,trino,clickhouse]==0.5.3`；
- 为每个 Workspace 建立独立 binding，并在每次领域子进程内复核 Python/package identity；
- 激活 `marivo-analysis` 或 `marivo-semantic` 时注入当前 Runtime 的实时根 Help；
- 提供 `marivo_help` 作为 Native Tool transport；
- 提供 `marivo_datasource_test`，完成缺失 DSH Credentials 的 Web 收集和显式连接测试；
- 提供 `marivo_datasource_access`，签发 30 分钟、最多 64 次 foreground Shell 的显式 lease；
- 提供 `marivo_evidence_sources`，把精确 Artifact-owned Finding 交付为可移植文本，并由 Web 增强展示；
- 安装 `dsh-data-analysis-report-kit`，提供 `emit_dataset(BaseFrame, ...)`、
  `emit_computed(DataFrame, ...)` 与 `emit_session_trace(SessionGraph, ...)`；
- 打包并挂载 `dsh-data-analysis-report` Skill，以及 `ReportData`、精简 Artifact 摘要和 Session DAG
  JavaScript 组件。

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

当前契约见[总体架构](docs/architecture.md)和[模块文档](docs/modules/)；clean break 的决策与终态证据见
[插件能力优化设计](docs/plan/plugin-capability-optimization-design.md)和
[v2 验收记录](docs/acceptance/plugin-capability-optimization-v2.md)。

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
spec。当前正式支持版本是已经发布的 Marivo 0.5.3；其他版本或开发 checkout 必须明确失败。

Workspace 解析顺序为：显式 `projectRoot`、`DSH_DATA_ANALYSIS_PROJECT_ROOT`、Session cwd、`DSH_CWD`、
进程 cwd。插件只绑定已经存在的目录；install、Help、Skill catalog 与 Skill load 不创建 `marivo.toml`、
`models/` 或 `.marivo/`。后续由 Marivo 操作拥有的 lazy materialization 仍可按需写入。

## Tool surface

### `marivo_help`

```text
marivo_help({ targets: ["analysis.session.runtime", ...] })
```

返回共享 Runtime 的实时公共 Help。插件不维护 target registry；`targets` 必须至少包含一个目标。模型可见
正文不包含绝对 Python/package 路径或完整 Environment fingerprint。

### `marivo_datasource_test` 与 `marivo_datasource_access`

```text
marivo_datasource_test({ name: "warehouse" })
marivo_datasource_access({ name: "warehouse" })
```

两个 Tool 都接受 datasource 中任意合法 POSIX 环境变量引用，但拒绝插件控制面保留的 `MARIVO_*`、
`DSH_DATA_ANALYSIS_*`，以及 Host 自有的 `DSH_HOME`、`DSH_SHELL`、`DSH_SESSION_ID`、
`DSH_SESSION_JSONL`。原始引用统一映射到插件专属的 DSH Credentials 地址后执行 operation-scoped
resolve；同名 Host credential 从不直接读取。缺失值只返回原始引用名并交给 Web 表单，不把 secret 放进
聊天、argv、日志或结果。插件不创建或同步 `~/.marivo/secrets.toml`；同名配置以 DSH Credentials 的
operation-scoped overlay 为准。

`marivo_datasource_test` 只以原始名称给真实 `md.test()` 注入一次性 overlay，成功结果只含 status、name 与
latency；任何 test 开始都会撤销同作用域旧 lease。`marivo_datasource_access` 不执行连接测试，只在凭证齐全时
返回 `shell_lease`，包含最长 30 分钟、最多 64 次 foreground Shell 可复用的精确 `bash_prelude` 与
`pwsh_prelude`。每次 Shell claim 仍 fresh-resolve 映射凭证；background、persistent、过期、耗尽、错 Agent
或错 Workspace 的调用在 resolve 前失败。开始分析时 access 一次并复用，只有 datasource 新建/修改、凭证
轮换或连接失败时才 test，不应在每个脚本前 test。Prelude 首行的 lease marker 必须保留在命令首行；缺失时
重新 access 并以前台方式重试，不读取 DSH credential 文件、备份或 `~/.marivo/secrets.toml`。

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
不会回退到 Session-wide 搜索。Tool transcript 自身包含有界 title、locator、excerpt、缺失/不支持/截断与
revalidation 状态；Web 只消费同一个 closed result。该投影证明来源 identity，不证明整句话、计算或建议正确。

## Agent 原生报告

仅当用户明确请求 HTML/Web 或耐久报告文件、接受 Agent 的生成提议，或要求修改已有 Workspace bundle 时，
Agent 才加载 `dsh-data-analysis-report` Skill。普通长回答或多图表/表格仍在对话中完成。已有分析先恢复并
revalidate 精确 persisted Artifacts，不为生成报告或补齐 DAG 细节重新执行 `observe`。报告没有页面 schema、
HTML Checker 或 renderer。Agent 直接读取：

- `artifact.show()` / `render()`、`contract()`、`quality_summary`、`lineage`；
- `session.revalidate(ref)` 和 Artifact-owned `findings()` / `finding()`；
- `session.runs(...)`、`session.get_run(...)`、`session.graph(...)`；
- 在实时 Help 允许的 terminal boundary 使用 `artifact.to_pandas()`。

报告增强面只降低数据读取与 Marivo 信息展示成本：`emit_dataset(..., detail="reader" | "audit")` 发射
Artifact snapshot，默认 reader；只有明确审计请求使用 audit。`emit_session_trace` 使用相同 profile。
`emit_computed` 发射 pandas DataFrame snapshot，二者均由浏览器 `ReportData` 读取；
`emit_session_trace` 发射公开 `SessionGraph`，由标准 DAG 组件展示。精简 Artifact 组件只显示类型、
semantic shape、行数、生成时间及会改变读者判断的截断、Evidence、revalidation、质量或 issue 提示。
插件不提供 chart helper、可视化 DSL 或页面 renderer；图表、布局与交互仍由 Agent 决定。

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
