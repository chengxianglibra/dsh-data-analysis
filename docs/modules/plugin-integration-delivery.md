# 插件集成与交付模块

## 作用

本模块把 profile 级 Marivo Runtime、per-Workspace binding、四个跨边界 Tool、报告数据 runtime、两个
Marivo JavaScript 组件、激活式 Help/工作流指导和 Evidence Web 投影装入同一个 DSH plugin lifecycle。它不修改 Harness
的普通 Tool、Session 或 profile 语义，也不拥有报告对象。

实现入口：

- `packages/dsh-data-analysis/src/plugin.ts`
- `packages/dsh-data-analysis/src/client.tsx`
- `packages/dsh-data-analysis/src/bridges.ts`
- `packages/dsh-data-analysis/cordis.patch.yml`

## 生命周期

1. `apply()` 确保精确 Marivo 0.5.3 shared Runtime，并注册非秘密 `DSH_DATA_ANALYSIS_PYTHON` Shell fact。
2. Runtime 的 `marivo-analysis`、`marivo-semantic` 与随插件包分发的 `dsh-data-analysis-report` skills
   挂载到 profile skill registry。
3. `MarivoWorkspaceEnvironmentManager` 按 Agent cwd 惰性绑定已存在 Workspace，不创建文件。
4. 每个 Agent 安装 disclosure controller、Datasource credential bridge、Evidence adapter 与 prompt sections。
5. 相同 Environment 共享 Help/Datasource/Evidence bridge set；Agent activation state 独立。
6. plugin disposal 移除自身 Tool、prompt、事件与 outstanding credential leases，不影响原 profile Tool 或 Host environment。

## Agent scope surface

| Surface | 独有责任 | 删除条件 |
| --- | --- | --- |
| `marivo_help` | Native mode 的受控解释器与实时 Help transport | Harness/Marivo 提供等价原生 transport |
| `marivo_datasource_test` | 缺失 DSH Credentials 的 Web 收集与显式 connection test | DSH 提供通用 credential-aware datasource lifecycle |
| `marivo_datasource_access` | 不执行连接测试的有界 foreground Shell lease | DSH 提供通用 operation-scoped credential lease |
| `marivo_evidence_sources` | 精确来源的 Turn metadata 与 Web 折叠面板 | DSH 提供通用结构化来源附件 |

以下 Tool 不注册：Artifact inspect/quality/contract/lineage、Session resume/context/graph、Artifact check、
semantic readiness、datasource/table inspect、Artifact materialize/export 和报告 renderer。原生 API 已拥有
语义时，插件不重新装箱。

## Prompt 与 Skill 激活

`marivo-semantic` 激活后注入 credential 规则；`marivo-analysis` 激活后注入 Evidence 调用策略和报告
Skill 路由。只有用户明确请求 HTML/Web 或耐久报告、接受生成提议，或修改已有 bundle 时，Agent 加载
`dsh-data-analysis-report`；普通长回答或多图表/表格留在对话中。该 Skill 只提供：

- 直接恢复并 revalidate persisted Artifacts，不为展示重新执行 `observe`；
- 新目录、相对资源、固定 `index.html`；
- 资源先写、入口最后写；
- Native/both 顶层 mutation、精确 Markdown 行内路径与 Code-only 路径降级；
- 交付前执行资源、离线、安全、浏览器、键盘和打印检查；
- 不把 Workspace bundle 描述为不可变发布、replay、share 或 Evidence proof。

指导不给出页面模板，不定义 block、chart type、可视化 DSL 或 renderer schema。Skill assets 只保留
`report-data.js`、`marivo-artifact.js` 与 `marivo-session-dag.js`：第一项降低 Artifact/pandas 数据的
JavaScript 读取成本，后两项提供精简 Artifact 摘要与 Session DAG。Python report-kit 通过独立
`emit_dataset`、`emit_computed`、`emit_session_trace` 发射 v2 transport 快照；Artifact/Graph 默认 reader，明确
审计请求才使用 audit。插件不提供 chart helper 或 HTML Checker，
页面与图表由 Agent 使用通用文件、代码和浏览器能力完成。多 Session 各自保留独立 Graph；Frame preview
只按 `session_id + artifact_ref` 关联精确 Artifact snapshot。

## Web client

Web client 只保留：

- `marivo_datasource_test` credential form；
- `marivo_evidence_sources` Turn delivery 与折叠来源面板。

不存在报告 Tool View、durable report block、report turn-tail selector 或专用 Host opener。HTML 入口使用 DSH
通用 Produced Files 与精确行内路径，通过 `openFile` / Host capability 打开；Code-only nested mutation、
remote/headless 自动降级为路径。

## Compatibility 与 package

`dshDataAnalysisCompatibility` 精确声明：

| 边界 | 当前值 |
| --- | --- |
| DSH distribution/peers | `0.1.1-rc.2` |
| Marivo | `marivo[duckdb,trino,clickhouse]==0.5.3` |
| Runtime marker | `dsh-data-analysis-runtime/v2` |
| Subprocess policy | `direct-argv-inherited-env-snapshot-overlay-v2` |
| Report-kit | `dsh-data-analysis-report-kit==3.0.0`，dataset/trace transport v2 |

Package 不导出 `./report` 或 `./report-check`，也不暴露报告 Checker CLI。tarball 只包含 report-kit wheel、
投影 schemas、原则型 Skill、数据 runtime 与两个 Marivo components。版本、package path 或解释器不匹配时 fail closed；
不维护 compatibility alias 或 capability matrix。

## 验证

```bash
npm run test:plugin-integration-delivery
npm run test:agent-native-report-primitives
npm run build
npm run verify:plugin-package
npm run validate:plugin-integration-delivery:real
```

Real runner 需要正式 Marivo 0.5.3 与真实模型。Produced Files、Host opener、浏览器/打印、remote/headless
与隔离磁盘配额仍需在对应真实 DSH Web 环境验收；路径、runner 日志或静态 schema 不能伪造这些外部能力。
