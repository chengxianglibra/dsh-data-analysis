# DSH Data Analysis 总体架构

## 目标与边界

`dsh-data-analysis` 是 DeepSeek Harness 与 Marivo 的窄集成 seam。DSH 拥有 Agent、Session、Tool、Skill、
Credentials、profile 和通用文件/Web 生命周期；Marivo 拥有分析语义、Artifact、Evidence、Quality、
Lineage、revalidation 与 Session runtime；本项目只连接两者，不复制上游契约。

```mermaid
flowchart LR
  D[DeepSeek Harness] --> P[dsh-data-analysis]
  P --> R[Shared Marivo 0.5.3.dev0 Runtime]
  P --> W[Per-Workspace binding]
  P --> H[marivo_help]
  P --> T[marivo_datasource_test]
  P --> E[marivo_evidence_sources]
  P --> S[Semantic reference input and usage sidecar]
  P --> B[Read-only Workspace semantic browser]
  P --> J[Marivo Artifact and DAG JS projection]
  R --> M[Marivo public objects]
  M --> A[Agent analysis and expression]
  A --> F[Workspace HTML directory bundle]
  F --> D
```

## 分层

| 层 | 本项目职责 | 不属于本项目 |
| --- | --- | --- |
| Runtime/Workspace | 精确安装、marker、zero-init binding identity | Marivo 项目语义、Session 数据与按需写入 |
| Environment | checked runner、受限 argv、资源上限、overlay 脱敏 | Artifact/Evidence/Graph schema |
| Help | 当前 binding 的 live Help transport 与激活披露 | 静态 API registry |
| Datasource | DSH Credentials 管理、调用续接、connection test、resolver 注入 | table/source inspection 语义 |
| Evidence delivery | 精确 Artifact/Finding 到 Turn/Web 的忠实投影 | 分析读取、Finding 组合、蕴含判断 |
| Semantic reference input | Catalog 文本检索、原子 ref 序列化、Workspace 热度 | composer 状态机、领域成员有效性与分析执行 |
| Semantic browser | Workspace 对象快照、只读详情与局部关系图 | observe、数据预览、对象编辑、连接配置与凭证读取 |
| Report workflow | 原则型 `dsh-data-analysis-report` Skill 与 Artifact/DAG JS 投影 | 页面模板、通用 chart helper、HTML Checker、renderer、publisher、专用 Web card |

模块文档：

- [Runtime 与 Workspace](modules/runtime-workspace.md)
- [Environment 执行边界](modules/environment-execution.md)
- [实时 Help 披露](modules/help-disclosure.md)
- [Datasource Credentials](modules/datasource-credentials.md)
- [Evidence 来源交付](modules/evidence-sources.md)
- [语义对象引用输入](modules/semantic-reference-input.md)
- [只读语义层对象浏览器](modules/semantic-browser.md)
- [插件集成与交付](modules/plugin-integration-delivery.md)

## Runtime 与 identity

Compatibility manifest 精确固定 DSH peers 与 `marivo[duckdb,trino,clickhouse]==0.5.3.dev0`。默认 Runtime 位于
`$DSH_HOME/dsh-data-analysis/runtimes/marivo/`；管理员也可提供绝对 Python。两种模式都必须让版本、
package path、解释器和 marker 一致；本开发包从随包源码 wheel 安装 Marivo，并核对 wheel SHA-256。

每个 Workspace 独立解析 project root、最小目录与 doctor admission。`MarivoEnvironment` 冻结 binding
identity；各领域 bridge 通过同一 `MarivoCheckedRunner` 执行，并在同一子进程内先复核 import identity。

## Agent scope

Plugin 为每个 Agent 安装一个 controller，并共享同一 Environment 对应的 Help、Datasource 与 Evidence
bridge。可见 DSH Tool 只有：

```text
marivo_help
marivo_datasource_test
marivo_evidence_sources
```

Plugin 同时挂载 Runtime 的 `marivo-analysis` / `marivo-semantic` 和随包分发的
`dsh-data-analysis-report`。前两者激活后，controller 披露当前 Runtime 的根 Help；报告路由随
`marivo-analysis` 激活后只注入报告选择边界：用户明确请求 HTML/Web 或耐久报告、接受生成提议，或修改已有
bundle 时才加载报告 Skill；普通长回答或多图表/表格不触发文件生成。已有分析恢复并 revalidate persisted
Artifacts，不为展示重新执行 `observe`。插件不注册报告 Tool；
Plugin disposal 只移除自身 scope 的 Tool、prompt 与事件接线。

Runtime 另外安装 `dsh-data-analysis-report-kit`。`emit_dataset` 只接受 Marivo `BaseFrame`，
`emit_computed` 只接受 pandas `DataFrame`，`emit_session_trace` 只接受调用方已取得的公开 `SessionGraph`。
Artifact/Graph emitter 默认使用 `reader` profile，明确审计请求才使用 `audit`；profile 只裁剪公开字段，
不重算 Marivo 语义。
浏览器 assets 分别提供 `ReportData`、精简 Artifact 摘要与 Session DAG；Artifact 组件只披露对报告读者有用的
正常摘要和实质风险，不充当 metadata inspector。一次分析涉及多个 Session 时，每个 Session 保持独立 Graph，
Frame preview 按 `session_id + artifact_ref` 关联。插件不拥有页面结构、图表类型、样式或可视化实现。

## 原生分析读取

Agent 直接使用 Marivo：

- `artifact.show()` / `render()`、`contract()`、`quality_summary`、`lineage`；
- `artifact.findings(...)` / `finding(...)` 和 `session.revalidate(ref)`；
- `session.runs(...)`、`get_run(...)`、`artifact(ref)`、`graph(...)`；
- `mv.session.recent(...)`、`inspect(...)`、`resume(...)`；
- `catalog.readiness(refs=[...])` 与 `md.inspect(datasource_ref, source)`；
- 经实时 Help 确认 terminal boundary 后的 `artifact.to_pandas()`。

插件不注册对应的 inspection、quality、graph、resume、readiness、inspect 或 export wrapper。特别是
`SessionGraph` 的 Run/Artifact/edge、完整性、focus、truncation 和 boundary 字段全部由 Marivo 拥有。

## Datasource 与 Credentials

DSH Credentials 是凭证值权威，Marivo 的公开 description 与 resolver 是字段和使用契约。插件把原始引用
映射到专属 DSH 地址，通过 stdin snapshot 和 `md.credential_scope` 注入；普通 Shell 不获得凭证值。

`marivo_datasource_test` 执行连接测试；`marivo_datasource_access` 发放最长 30 分钟、最多 64 次的内部
执行授权；`marivo_python` 通过 DSH Shell 前台执行服务校验授权并 fresh-resolve。凭证不进入 Agent
参数、环境或 argv。输出在 Host spill 前执行 exact-value 脱敏。

常驻“数据源与凭证”管理页支持配置、替换、删除和测试。缺失配置时，Web 根 Agent 的原调用保持等待；
提交验证成功后继续，失败可修正或交还 Agent。刷新、丢失响应、取消和定义变更由 Host 操作状态处理，
不依赖历史 Tool Result 自动弹窗。详见 [Datasource Credentials](modules/datasource-credentials.md)。

Source metadata inspection 由 Agent 直接调用 `md.inspect(...)`；connection test 不是 inspection 的前置。

## Evidence 来源 adapter

`marivo_evidence_sources` 接受 1–20 个精确 `{ artifact_ref, finding_id }`。Bridge 恢复 Session、取得 owning
Artifact，再调用 `artifact.finding(finding_id)`，并验证 Finding 的 Session 与 Artifact identity。成功结果
投影到当前 Turn；Tool text 提供完整有界 title、locator、excerpt、状态、截断、revalidation 与语义边界。
Code Mode 子调用通过 durable source block 保留相同元数据；Web 只增强同一 closed result，不重新读取 Evidence。

该 adapter 不是报告数据入口，不自动拦截回答，不生成脚注或 citation manifest，也不证明自由文本正确。

## Agent 原生报告与文件交付

Agent 按 Skill 原则自行选择 HTML/CSS/SVG/JavaScript、图表和本地依赖，输出普通目录。插件不提供页面
示例或静态 HTML Checker：

```text
<workspace>/<new-report-directory>/
├── index.html
├── assets/   # optional
└── data/     # optional
```

资源先写，入口最后写。Native/both 的顶层成功 mutation 会让入口路径进入 Produced Files；Code-only 的
嵌套 mutation 只进入 Harness 日志，因此由外层输出和最终回答交付精确路径。Host opener 仅在 loopback 且
`canOpenPath` 可用时工作；remote/headless 只交付路径。

文件级 mutation 可以原子写入，但目录没有事务、ready gate、digest、不可变 identity、历史字节 replay、
权限发布、share 或 GC。资源闭合、离线依赖、安全、浏览器、键盘与打印检查属于 Agent 工作流；失败时必须
明确报告未完成。

## 验证

```bash
npm run check
npm run build
npm run verify:plugin-package
```

确定性测试守住 Tool 最小性、旧 surface 删除、Artifact/DAG 投影契约、Evidence 精确归属与包导出。页面的
Web Produced Files、Host opener、浏览器、打印和隔离磁盘配额由具体交付工作流按 Skill 原则验证，不能由
路径存在或本地日志代替。
