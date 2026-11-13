# 公开接口与破坏性迁移

## 模型协议

报告发现使用 `marivo_report_list`，支持标题检索和分页，返回当前 Workspace 已发布报告的准确 saved ref；回执缺失或损坏时先检索，再读取确认目标。报告读取与写入分别使用 `marivo_report_read` / `marivo_report_write`，输入使用 opaque ref；所有写入必填 stage，首次 mode 默认为 edit，refresh-data 强制整批原子校验。开启 `reportPublishing` 时，`marivo_publish_report` 使用准确 saved ref 发布指定版本。推荐必填准确 saved ref，empty 与 declined 为正常完成，不结束 Harness Turn。

保存回执缺失时可按同一 Session 中的 writer call ID 找到准确 Build。固定结果字段候选缺失时，`marivo_report_read` 支持按准确资源引用和候选组分页读取。调用选择和恢复见[展示交付](presentation-delivery.md)。

`marivo_python` 根据声明的数据源或结果导出推导省略的 `project`，详见[数据源与凭证](datasource-credentials.md)。`results[name].resource` 是唯一公共资源交接。

旧工具名、旧参数和 Python 顶层 resultRefs/codeRef/resultMetadata 不再接受或返回。升级前排队的旧名称由 Harness 按未知工具在执行前拒绝，不自动翻译或重放副作用。恢复会话取得当前 schema 与新 Skill；Host receipt/RPC 内部 recordId 不作为模型参数协议。现行报告写入使用 `dsh.analysis-ui/v4` 文档和 v4 current 指针，读取支持兼容的 `dsh.analysis-ui/v3`，详细契约见[展示交付](presentation-delivery.md)。

## Host 限制与选择

Harness 0.2.1-rc.2 的 execute 只返回 canonical JSON，presentationMeta 为 args/value 的纯投影。因此保留 Host-owned deliveryJson 和 Help fingerprint/bodyDigest/delivery 以支持 Native/PTC durable delivery 与重放；不能用渲染省略声称 canonical 值已经隐藏。投影不依赖一次性内存队列。

该版本 JSON Schema 的 additionalProperties 仅支持 boolean，无法表达动态名称映射的 value schema。插件使用具体 TypeScript 类型、逐项运行时验证及准确字段说明；PTC 的动态 resources/results entry 仍投影为 JSON value。顶层 ref、状态、定义与元数据采用结构化对象，不需二次 JSON.parse。

早期数据源合并实验曾保留 configure/test 两入口。单次真实模型观察中，候选单入口减少了 schema 字节，调用数相同，委派 repair 误选 create。当前数据源定义通过 `marivo_python` 和 Marivo 公开 API 管理，连接测试由 `marivo_datasource_test` 执行，见[数据源与凭证](datasource-credentials.md)。

## 稳定 npm 入口

| 入口 | 当前承诺 |
| --- | --- |
| 根 | Config、PluginConfig、apply、inject、installMarivoPlugin、name |
| ./client、./client-composition | apply、createPluginRpc、inject；分别为自注册 bundle 与可组合客户端 |
| ./integration | INTEGRATION_CONTRACT_VERSION、MarivoIntegrationV1、SharedMarivoRuntime、SharedMarivoRuntimeConfig、WorkspaceDatasourceAuthoring、applyWithIntegration、createWorkspaceDatasourceAuthoring、ensureSharedMarivoRuntime、marivoCredentialStorageRef、registerPluginRpc、withDatasourceDefaults；契约 dsh-data-analysis-integration/v1 |
| ./compatibility | 显式版本/兼容元数据，11 个名称 |
| ./package.json、./cordis.patch.yml | 安装元数据与 Host 配置入口 |

移除 ./environment、./disclosure、./datasource 公共 subpath。不会从另一个 subpath 重新公开全部实现。managed datasource 组合使用 createWorkspaceDatasourceAuthoring(environment)，仅提供 inventory/authoring/configuration/create/update；Runtime 安装验证和 credential reference 转换使用 integration 中的具名函数。外部 bili 0.1.2-dev.0 源码已核对，需修改其 imports 与 authoring 构造；本仓库不修改或验收该外部项目。其他未知消费者按破坏性迁移处理，不声称不存在。

## 根导出逐项迁移

按根 tsconfig 编译选项创建 TypeScript Program，通过 checker.getExportsOfModule 解析 re-export，按名称去重；类型和值同名计一次。基线 154，当前 6。本表中的 tests/scripts 为本仓库静态引用文件数，不能证明外部使用全貌。实际包验证会检查承诺入口、被移除 subpath 拒绝、声明消费与浏览器构建边界。

| 原名称 | 已核消费者 | 处理与目标 | 验证 |
| --- | --- | --- | --- |
| COMPATIBILITY_SCHEMA | tests/scripts 1 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| Cell | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| ColumnType | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| Config | tests/scripts 4 文件；其他外部消费者未知 | 根入口保留 | 安装包入口/声明与边界检查 |
| ConfigurationRequestView | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| ConfigurationResult | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DEFAULT_MARIVO_HELP_LIMITS | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DEFAULT_SHARED_RUNTIME_INSTALL_TIMEOUT_MS | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DEFAULT_SUBPROCESS_LIMITS | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DSH_DATA_ANALYSIS_COMPATIBILITY | tests/scripts 1 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| DSH_DISTRIBUTION | tests/scripts 0 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| DSH_PEER_DEPENDENCIES | tests/scripts 1 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| DSH_PEER_RANGE | tests/scripts 3 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| DatasetColumn | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DatasourceConfiguration | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DatasourceConfigureInput | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DatasourceUpdateInput | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DoctorCheck | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DoctorOverallStatus | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DoctorReport | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DoctorSection | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DoctorStatus | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DraftDelivery | tests/scripts 5 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| DshDataAnalysisCompatibility | tests/scripts 0 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| FixedSubprocessPolicy | tests/scripts 5 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| ImportIdentity | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_CREDENTIAL_STORAGE_PREFIX | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_DATASOURCE_CONFIGURE_TOOL_NAME | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_DATASOURCE_TEST_TOOL_NAME | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_DRAFT_DELIVERY_KIND | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_HELP_TOOL_NAME | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_PACKAGE_SPEC | tests/scripts 2 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| MARIVO_PERSIST_CREDENTIALS_DISABLED | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_PERSIST_CREDENTIALS_ENV | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_PRESENTATION_DELIVERY_KIND | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_PRESENTATION_RPC_CHANNEL | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_PRESENT_TOOL_NAME | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_ROOT_HELP_TARGETS | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MARIVO_VERSION | tests/scripts 8 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| MarivoBridgeSet | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoBridgeSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoCheckedRunRequest | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoCheckedRunner | tests/scripts 11 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoCredentialService | tests/scripts 10 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceBridge | tests/scripts 12 文件；bili 0.1.2-dev.0 workspace-bootstrap.ts | 以 ./integration.createWorkspaceDatasourceAuthoring 替代所需 authoring 方法 | 安装包入口/声明与边界检查 |
| MarivoDatasourceBridgePort | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceBridgeSource | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceDescription | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceFailure | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceInventoryBridge | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceInventoryBridgeSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceRepair | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDatasourceTestResult | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDisclosureController | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDisclosureError | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDisclosureFailureRecord | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDisclosureOptions | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDisclosureSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoDisclosureTelemetry | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoEnvironment | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoEnvironmentBinding | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoEnvironmentConfig | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoEnvironmentError | tests/scripts 7 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoEnvironmentSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpBridge | tests/scripts 4 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpBridgePort | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpBridgeSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpDelivery | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpDeliveryQuery | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpDeliveryResolver | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpError | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpFailureCode | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpLimits | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpTargetFailure | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpTargetResult | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoHelpValue | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoPresentationFileService | tests/scripts 11 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoPythonExecutionError | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoPythonExecutionSummary | tests/scripts 4 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoPythonOptions | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoRootHelpDisclosureRecord | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoRootHelpTarget | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoSkillActivationRecord | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoSkillName | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| MarivoWorkspaceEnvironmentManager | tests/scripts 4 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PLUGIN_VERSION | tests/scripts 2 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| PRESENTATION_BUDGETS | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PluginConfig | tests/scripts 0 文件；其他外部消费者未知 | 根入口保留 | 安装包入口/声明与边界检查 |
| PresentationAsset | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationContractError | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationDelivery | tests/scripts 6 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationFile | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationLocale | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationReceipt | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationWorkspace | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationWorkspaceResolver | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| PresentationWorkspaceSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| RUNTIME_INSTALLATION_VERSION | tests/scripts 1 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| SHARED_MARIVO_PACKAGE_SPEC | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| SHARED_PYTHON_SPEC | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| SUBPROCESS_POLICY_ID | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| SUBPROCESS_POLICY_VERSION | tests/scripts 1 文件；其他外部消费者未知 | 迁移 ./compatibility | 安装包入口/声明与边界检查 |
| SharedMarivoRuntime | tests/scripts 1 文件；其他外部消费者未知 | 迁移 ./integration | 安装包入口/声明与边界检查 |
| SharedMarivoRuntimeConfig | tests/scripts 0 文件；其他外部消费者未知 | 迁移 ./integration | 安装包入口/声明与边界检查 |
| SubprocessLimits | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| SubprocessRequest | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| SubprocessResult | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| TypedDataset | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| admitDoctorReport | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| apply | tests/scripts 16 文件；其他外部消费者未知 | 根入口保留 | 安装包入口/声明与边界检查 |
| assertMarivoCredentialReferences | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| bindMarivoEnvironment | tests/scripts 16 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createMarivoBridgeSet | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createMarivoDatasourceConfigureTool | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createMarivoDatasourceTestTool | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createMarivoHelpTool | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createMarivoPresentTool | tests/scripts 9 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createMarivoUiReadTool | tests/scripts 6 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| createSharedMarivoRuntimeRunner | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| draftDeliverySchema | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| ensureSharedMarivoRuntime | tests/scripts 5 文件；bili 0.1.2-dev.0 entry.mjs | 迁移 ./integration | 安装包入口/声明与边界检查 |
| formatCell | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| inject | tests/scripts 15 文件；其他外部消费者未知 | 根入口保留 | 安装包入口/声明与边界检查 |
| installMarivoDisclosure | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| installMarivoPlugin | tests/scripts 4 文件；其他外部消费者未知 | 根入口保留 | 安装包入口/声明与边界检查 |
| installMarivoPresentationCodeDelivery | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| loadTargetInventory | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| marivoCredentialStorageRef | tests/scripts 8 文件；bili 0.1.2-dev.0 integration/auth tests | 迁移 ./integration | 安装包入口/声明与边界检查 |
| marivoHelpBodyDigest | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| name | tests/scripts 170 文件；其他外部消费者未知 | 根入口保留 | 安装包入口/声明与边界检查 |
| normalizeHelpTargets | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| parseDoctorReport | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| parsePresentationBuildId | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| parsePresentationDelivery | tests/scripts 8 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| parsePresentationReceipt | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| parsePresentationToolDelivery | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| parseTypedDataset | tests/scripts 3 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| presentationReceiptText | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| presentationTurn | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| readMarivoHelpTargets | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoDatasourceConfigureTool | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoDatasourceTestTool | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoHelpTool | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoPresentTool | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoPresentationRpc | tests/scripts 2 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoPythonTool | tests/scripts 9 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| registerMarivoUiReadTool | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| renderMarivoHelpValue | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| resolveMarivoBridgeSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| resolveMarivoDatasourceBridge | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| resolveMarivoDatasourceInventoryBridge | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| resolveMarivoEnvironmentSource | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| resolveMarivoHelpBridge | tests/scripts 0 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
| resolveMarivoHelpLimits | tests/scripts 1 文件；其他外部消费者未知 | 移除公共承诺；内部消费者使用仓库路径 | 安装包入口/声明与边界检查 |
