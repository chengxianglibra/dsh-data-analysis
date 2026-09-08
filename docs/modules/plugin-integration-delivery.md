# 插件集成与交付模块

## 作用

本模块把 profile 级 Marivo Runtime、per-Workspace binding、四个跨边界 Tool、presentation-kit、
两个 Runtime Skill、唯一展示 Skill、激活式 Help 和展示交付装入同一个 DSH plugin lifecycle。它不修改 Harness
的普通 Tool、Session 或 profile 语义，也不拥有报告对象。

实现入口：

- `packages/dsh-data-analysis/src/plugin.ts`
- `packages/dsh-data-analysis/src/client.tsx`
- `packages/dsh-data-analysis/src/bridges.ts`
- `packages/dsh-data-analysis/cordis.patch.yml`

## 生命周期

1. `apply()` 确保精确 Marivo 0.5.4 shared Runtime，并注册非秘密 `DSH_DATA_ANALYSIS_PYTHON` Shell fact。
2. 通过独立 filesystem provider 挂载 Runtime 的 `marivo-analysis`、`marivo-semantic` 与插件自带的 `dsh-data-analysis-presentation`；两个 provider 均只读取各自明确目录。
3. `MarivoWorkspaceEnvironmentManager` 按 Agent cwd 惰性绑定已存在 Workspace，不创建文件。
4. 每个 Agent 安装 disclosure controller、Datasource credential bridge、Presentation Tool 与 prompt sections。
5. 相同 Environment 共享 Help/Datasource/Presentation bridge set；Agent activation state 独立。
6. profile 级 Connection RPC 与 storageDomain 承载[语义对象引用输入](semantic-reference-input.md)，Browser 注册独立 `@` source。
7. profile 同时注册只读 presentation RPC；它只依赖当前 Workspace 成员关系和保存文件。
8. plugin disposal 取消展示读取和在途 present，停止语义引用/Catalog 接线并 drain usage 写入，取消并 drain 凭据准备、测试与 Python 执行；移除自身 Tool、prompt 和事件。

## Agent scope surface

| Surface | 独有责任 | 删除条件 |
| --- | --- | --- |
| `marivo_help` | Native mode 的受控解释器与实时 Help transport | Harness/Marivo 提供等价原生 transport |
| `marivo_datasource_test` | 缺失 DSH Credentials 的 Web 收集与显式 connection test | DSH 提供通用 credential-aware datasource lifecycle |
| `marivo_python` | 一次调用内的全部 datasource 准入、fresh snapshot 与前台执行 | DSH 提供等价的执行准入与 Marivo resolver 注入 |
| `marivo_present` | 一次提交展示文件、统一 receipt 与 Web 打开/下载 | DSH 提供等价的完整快照交付 |

以下 Tool 不注册：Artifact inspect/quality/contract/lineage、Session resume/context/graph、Artifact check、
semantic readiness、datasource/table inspect、Artifact materialize/export 等 convenience wrappers。原生 API 已拥有
语义时，插件不重新装箱。

## Prompt 与 Skill 激活

`marivo-semantic` 激活后注入 credential 规则；`marivo-analysis` 激活后披露 Runtime 根 Help。
插件常驻 prompt 只给出短路由：普通事实问答使用文字；图表、表格、报告、看板和可读来源展示加载唯一
`dsh-data-analysis-presentation`。已有数据无需先激活分析 Skill；需要新分析或语义编写时，才加载对应
Runtime Skill 与 live Help。展示 Skill 不增加 Help target，也不触发分析 Skill 的激活状态。

展示 Skill 由 `dsh-data-analysis-presentation` provider 从包内 `skills/` 挂载；Runtime Skill 仍由
`dsh-data-analysis-marivo` provider 从当前 Runtime 读取。两者不包含默认 roots，也不监听目录变化。
主流程与按需 references 的职责见[展示 Skill](presentation-skill.md)。旧报告 Skill、prompt、三个经典 JS
资产、emitter 和旧 transport schemas 不再分发，当前包不提供兼容包装。

[展示数据投影](presentation-projection.md)使用相同 bound Workspace/Runtime 的公开读取程序，生成纯数据文档。
`dsh_data_analysis_presentation.write_dataset(frame, path)` 只写 computed typed JSON 与有界 receipt，
不接收来源、转换分类或复算要求。声明来源在 Draft，available/unavailable 表示可恢复性，不能证明 computed 正确。

## Web client

Web client 只保留：

- datasource 凭据管理与 `marivo_datasource_test` / `marivo_python` 的等待表单；
- 语义层对象浏览与 composer 原生引用输入；
- `marivo_present` Turn 卡片、共享 reader overlay 与离线 HTML 下载。

生产 client bundle 导出 `HostPresentationReader`，与 portable 共用[展示 reader](presentation-reader.md)。
通过统一 Session/Turn delivery 汇总卡片，加载固定快照并校验下载字节；同一 receipt 的重复事件不重复显示。
文件所有权、只读 RPC 和取消边界见[展示交付](presentation-delivery.md)。

## Compatibility 与 package

`dshDataAnalysisCompatibility` 精确声明：

| 边界 | 当前值 |
| --- | --- |
| DSH distribution/peers | `0.1.1-rc.2` |
| Marivo | `marivo[duckdb,trino,clickhouse]==0.5.4` |
| Runtime marker | `dsh-data-analysis-runtime/v3` |
| Subprocess policy | `direct-argv-inherited-env-snapshot-overlay-v2` |
| Presentation-kit | `dsh-data-analysis-presentation-kit==1.1.0`，typed dataset schemaVersion 1 |

Package 不导出 `./evidence`、`./report` 或 `./report-check`，也不暴露报告 Checker CLI。tarball 包含唯一的 presentation-kit wheel
与内部纯数据 contracts/projection、builder、预构建 portable/static 资产，以及唯一展示 Skill 的 `SKILL.md`、references 和 examples；
旧 report-kit、报告 Skill、JS registry 和旧 transport schemas 均不分发。
版本、distribution metadata、package path 或解释器不匹配时 fail closed；不维护 compatibility alias。

## npm 发布

[`release.yml`](../../.github/workflows/release.yml) 通过 GitHub Actions 的 `npm` Environment 和 OIDC
发布包，并将同一 tarball 上传为 GitHub Release 附件。项目 `.npmrc` 只配置 registry 与依赖安装选项，
不设置认证项；项目层的空认证值也会遮蔽 npm 写入 user 配置的短期 OIDC 凭据，导致发布失败。
认证由运行环境提供，仓库不保存 token。发布以 workflow 成功、公共 registry 版本与附件字节一致性为准。

## 验证

```bash
npm run test:plugin-integration-delivery
npm run test:presentation-surface
npm run test:presentation-projection
npm run test:presentation-integration
npm run build
npm run verify:plugin-package
npm run validate:plugin-integration-delivery:real
npm run validate:presentation-integration:real
```

原 plugin real-model runner 验证 Help/凭据接缝，需要正式 Marivo 0.5.4 与真实模型。
presentation integration runner 使用隔离 Workspace、真实 Tool dispatch、Host Web 与下载文件验证交付。
当前可安装包的注册结果、真实 Agent 自动路由及最终旅程状态见[S5 验收记录](../plan/marivo-analytics-presentation-s5-acceptance.md)。
路径、runner 日志或静态 schema 不替代实际交互证据。
此前 tarball 内容收窄的记录见 [Package 内容收窄验收](../acceptance/package-content-cleanup.md)。

## Browser 构建

client 使用 esbuild 打包 Browser source、共享 contracts 和 Recharts 等依赖，DSH/React 保持外部依赖，
由 DSH module loader 提供；构建检查拒绝第二份 Host React、Node 与 Runtime 模块。
portable 将 React/Recharts 一并打包且不允许外部模块，静态 renderer 同样预构建，builder 运行不依赖开发工具。
实际打包依赖保留许可证；不增加公开 npm subpath。
