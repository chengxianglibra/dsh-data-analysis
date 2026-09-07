# 插件集成与交付模块

## 作用

本模块把 profile 级 Marivo Runtime、per-Workspace binding、四个跨边界 Tool、presentation-kit、
激活式 Help 和 Evidence Web 投影装入同一个 DSH plugin lifecycle。它不修改 Harness
的普通 Tool、Session 或 profile 语义，也不拥有报告对象。

实现入口：

- `packages/dsh-data-analysis/src/plugin.ts`
- `packages/dsh-data-analysis/src/client.tsx`
- `packages/dsh-data-analysis/src/bridges.ts`
- `packages/dsh-data-analysis/cordis.patch.yml`

## 生命周期

1. `apply()` 确保精确 Marivo 0.5.4 shared Runtime，并注册非秘密 `DSH_DATA_ANALYSIS_PYTHON` Shell fact。
2. 仅将 Runtime 的 `marivo-analysis`、`marivo-semantic` 挂载到 profile skill registry；新展示 Skill 在 S5 接入。
3. `MarivoWorkspaceEnvironmentManager` 按 Agent cwd 惰性绑定已存在 Workspace，不创建文件。
4. 每个 Agent 安装 disclosure controller、Datasource credential bridge、Evidence adapter 与 prompt sections。
5. 相同 Environment 共享 Help/Datasource/Evidence bridge set；Agent activation state 独立。
6. profile 级 Connection RPC 与 storageDomain 承载[语义对象引用输入](semantic-reference-input.md)，Browser 注册独立 `@` source。
7. plugin disposal 先停止语义引用 RPC、取消 Catalog 加载并 drain usage 写入，再取消并 drain 凭据准备、测试与 Python 执行，移除自身 Tool、prompt 和事件，不影响原 profile Tool 或 Host environment。

## Agent scope surface

| Surface | 独有责任 | 删除条件 |
| --- | --- | --- |
| `marivo_help` | Native mode 的受控解释器与实时 Help transport | Harness/Marivo 提供等价原生 transport |
| `marivo_datasource_test` | 缺失 DSH Credentials 的 Web 收集与显式 connection test | DSH 提供通用 credential-aware datasource lifecycle |
| `marivo_python` | 一次调用内的全部 datasource 准入、fresh snapshot 与前台执行 | DSH 提供等价的执行准入与 Marivo resolver 注入 |
| `marivo_evidence_sources` | 精确来源的 Turn metadata 与 Web 折叠面板 | DSH 提供通用结构化来源附件 |

以下 Tool 不注册：Artifact inspect/quality/contract/lineage、Session resume/context/graph、Artifact check、
semantic readiness、datasource/table inspect、Artifact materialize/export 和报告 renderer。原生 API 已拥有
语义时，插件不重新装箱。

## Prompt 与 Skill 激活

`marivo-semantic` 激活后注入 credential 规则；`marivo-analysis` 激活后注入 Evidence 调用策略。
S2 已删除旧报告 Skill、prompt、三个经典 JS 资产、emitter 和旧 transport schemas；不会将新 Runtime 路由到旧 helper。
新 presentation Skill 留在 S5，当前开发包不提供报告兼容包装。

[展示数据投影](presentation-projection.md)使用相同 bound Workspace/Runtime 的公开读取程序，生成纯数据文档。
`dsh_data_analysis_presentation.write_dataset(frame, path)` 只写 computed typed JSON 与有界 receipt，
不接收来源、转换分类或复算要求。声明来源在 Draft，available/unavailable 表示可恢复性，不能证明 computed 正确。

## Web client

Web client 只保留：

- datasource 凭据管理与 `marivo_datasource_test` / `marivo_python` 的等待表单；
- `marivo_evidence_sources` Turn delivery 与折叠来源面板。

不存在报告 Tool View、durable report block、report turn-tail selector 或专用 Host opener。生产 reader 与 `marivo_present` 分别留在 S3/S4；现有 S0 Web 探针不属于生产入口。

## Compatibility 与 package

`dshDataAnalysisCompatibility` 精确声明：

| 边界 | 当前值 |
| --- | --- |
| DSH distribution/peers | `0.1.1-rc.2` |
| Marivo | `marivo[duckdb,trino,clickhouse]==0.5.4` |
| Runtime marker | `dsh-data-analysis-runtime/v3` |
| Subprocess policy | `direct-argv-inherited-env-snapshot-overlay-v2` |
| Presentation-kit | `dsh-data-analysis-presentation-kit==1.0.0`，typed dataset schemaVersion 1 |

Package 不导出 `./report` 或 `./report-check`，也不暴露报告 Checker CLI。tarball 包含唯一的 presentation-kit wheel
与内部纯数据 contracts/projection；旧 report-kit、Skill、JS registry 和旧 transport schemas 均不分发。
版本、distribution metadata、package path 或解释器不匹配时 fail closed；不维护 compatibility alias。

## 验证

```bash
npm run test:plugin-integration-delivery
npm run test:presentation-surface
npm run test:presentation-projection
npm run build
npm run verify:plugin-package
npm run validate:plugin-integration-delivery:real
```

Real runner 需要正式 Marivo 0.5.4 与真实模型。Produced Files、Host opener、浏览器/打印、remote/headless
与隔离磁盘配额仍需在对应真实 DSH Web 环境验收；路径、runner 日志或静态 schema 不能伪造这些外部能力。
本次 tarball 内容收窄的确定性证据见 [Package 内容收窄验收](../acceptance/package-content-cleanup.md)。

## Browser 构建

client 使用 esbuild 打包本地 Browser source 与共享 wire contracts，DSH/React 保持外部依赖，由 DSH module loader 提供。
构建白名单拒绝 Host 模块进入 Browser bundle；不增加公开 npm subpath。
