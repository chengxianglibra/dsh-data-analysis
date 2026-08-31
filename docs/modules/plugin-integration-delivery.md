# 插件集成与交付模块

## 作用

本模块把 profile 级 Marivo Runtime、per-Workspace binding、三个跨边界 Tool、激活式 Help/工作流指导和
Evidence Web 投影装入同一个 DSH plugin lifecycle。它不修改 Harness 的普通 Tool、Session 或 profile
语义，也不拥有报告对象。

实现入口：

- `packages/dsh-data-analysis/src/plugin.ts`
- `packages/dsh-data-analysis/src/client.tsx`
- `packages/dsh-data-analysis/src/bridges.ts`
- `packages/dsh-data-analysis/cordis.patch.yml`

## 生命周期

1. `apply()` 确保精确 Marivo 0.5.1 shared Runtime。
2. Runtime 的 `marivo-analysis`、`marivo-semantic` 与随插件包分发的 `dsh-data-analysis-report` skills
   挂载到 profile skill registry。
3. `MarivoWorkspaceEnvironmentManager` 按 Agent cwd 惰性初始化并绑定 Workspace。
4. 每个 Agent 安装 disclosure controller、Datasource credential bridge、Evidence adapter 与 prompt sections。
5. 相同 Environment 共享 Help/Datasource/Evidence bridge set；Agent activation state 独立。
6. plugin disposal 移除自身 Tool、prompt、事件与 credential policy，不影响原 profile Tool。

## Agent scope surface

| Surface | 独有责任 | 删除条件 |
| --- | --- | --- |
| `marivo_help` | Native mode 的受控解释器与实时 Help transport | Harness/Marivo 提供等价原生 transport |
| `marivo_datasource_test` | 缺失 DSH Credentials 的 Web 收集与显式 connection test | DSH 提供通用 credential-aware datasource lifecycle |
| `marivo_evidence_sources` | 精确来源的 Turn metadata 与 Web 折叠面板 | DSH 提供通用结构化来源附件 |

以下 Tool 不注册：Artifact inspect/quality/contract/lineage、Session resume/context/graph、Artifact check、
semantic readiness、datasource/table inspect、Artifact materialize/export 和报告 renderer。原生 API 已拥有
语义时，插件不重新装箱。

## Prompt 与 Skill 激活

`marivo-semantic` 激活后注入 credential 规则；`marivo-analysis` 激活后注入 Evidence 调用策略和报告
Skill 路由。用户明确请求或接受 HTML 报告时，Agent 加载 `dsh-data-analysis-report`；该 Skill 只说明：

- 直接使用 Marivo public objects；
- 新目录、相对资源、固定 `index.html`；
- 资源先写、入口最后写；
- Native/both 顶层 mutation 与 Code-only 路径降级；
- 交付前执行资源、离线、安全、浏览器、键盘和打印检查；
- 不把 Workspace bundle 描述为不可变发布、replay、share 或 Evidence proof。

指导不定义章节、block、chart type、layout 或 renderer schema。

## Web client

Web client 只保留：

- `marivo_datasource_test` credential form；
- `marivo_evidence_sources` Turn delivery 与折叠来源面板。

不存在报告 Tool View、durable report block、report turn-tail selector 或专用 Host opener。HTML 入口使用 DSH
通用 Produced Files 与 `openFile` / Host capability；remote/headless 自动降级为路径。

## Compatibility 与 package

`dshDataAnalysisCompatibility` 精确声明：

| 边界 | 当前值 |
| --- | --- |
| DSH distribution/peers | `0.1.1-rc.2` |
| Marivo | `marivo[duckdb,trino,clickhouse]==0.5.1` |
| Runtime marker | `dsh-data-analysis-runtime/v1` |
| Subprocess policy | `direct-argv-inherited-env-snapshot-overlay-v1` |

Package 不导出 `./report`，tarball 不包含 report implementation/types。版本、package path 或解释器不匹配
时 fail closed；不维护 compatibility alias 或 capability matrix。

## 验证

```bash
npm run test:plugin-integration-delivery
npm run test:agent-native-report-primitives
npm run build
npm run verify:plugin-package
npm run validate:plugin-integration-delivery:real
npm run validate:agent-native-report-primitives:real
```

Real runner 需要正式 Marivo 0.5.1 与真实模型。它要求 Agent 实际加载 `marivo-analysis` 和
`dsh-data-analysis-report`，通过生产 `dsh-tool-bash` / local subprocess seam 执行可审计的原生公共 API
step，再使用 Harness 真实文件 Tool 跑 Native、Code、both 三种 report journey 并检查目录 bundle。
Produced Files、Host opener、浏览器/打印、remote/headless 与隔离磁盘配额仍需在对应真实 DSH Web 环境验收；
runner 不能伪造这些外部能力。
