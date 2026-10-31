# 插件集成与交付模块

## 作用

本模块把 profile 级 Marivo Runtime、per-Workspace binding、跨边界 Tool、presentation-kit、
两个 Runtime Skill、展示与文件分析 Skill、激活式 Help 和展示交付装入同一个 DSH plugin lifecycle。它不修改 Harness
的普通 Tool、Session 或 profile 语义，也不拥有报告对象。

实现入口：

- `packages/dsh-data-analysis/src/plugin.ts`
- `packages/dsh-data-analysis/src/client.tsx`
- `packages/dsh-data-analysis/src/integration.ts`
- `packages/dsh-data-analysis/src/bridges.ts`
- `packages/dsh-data-analysis/cordis.patch.yml`

## 生命周期

1. `apply()` 确保精确 Marivo 0.6.0.dev0 shared Runtime，并注册非秘密 `DSH_DATA_ANALYSIS_PYTHON` Shell fact。
2. 通过独立 filesystem provider 挂载 Runtime 的 `marivo-analysis`、`marivo-semantic` 与插件自带的 `dsh-data-analysis-presentation`、`dsh-data-analysis-files`；两个 provider 均只读取各自明确目录。
3. `MarivoWorkspaceEnvironmentManager` 按 Agent cwd 惰性绑定已存在 Workspace，不创建文件。
4. 每个 Agent 安装 disclosure controller、Datasource credential bridge、Presentation Tool 与 prompt sections。
5. 相同 Environment 共享 Help/Datasource/Presentation bridge set；Agent activation state 独立。
6. profile 级 Connection RPC 与 storageDomain 承载[语义对象引用输入](semantic-reference-input.md)，Browser 注册独立 `@` source。
7. profile 同时注册只读 presentation RPC；它只依赖当前 Workspace 成员关系和保存文件。
8. plugin disposal 取消展示读取和在途 present，停止语义引用/Catalog 接线并 drain usage 写入，取消并 drain 凭据准备、测试与 Python 执行；移除自身 Tool、prompt 和事件。

Agent 安装位于 `src/plugin-agents.ts`：已有 Agent 批量安装失败会回滚本批全部安装；后续新 Agent
失败只清理自身。多步子 installer 在返回 disposer 前失败也负责撤回先前注册，包括 PTC 第二个 hook。

profile 创建的 credential service 由 profile 关闭；Agent 只结束自身 operation，credential RPC 只关闭入口
与自身请求。独立 `installMarivoPlugin` 自建的 service 由该 installer 关闭。

`dispose()` 保持同步停止；controller 的 `close()` 和 installer 返回的可调用 disposer 返回同一次完成 Promise。
顶层先同步停止 Agent 安装、撤入口和发送取消，再等待 Help、present、Python、凭据、RPC、Catalog 与 usage
的实际任务，最后释放 binding manager 与 shell fact。`src/lifecycle.ts` 汇总清理失败，保证其他资源仍被清理；
`src/tool-lifecycle.ts` 跟踪 Tool 的完整执行。取消调用者等待不等于底层任务已经结束，也不代表远端数据库查询已取消。
已提交的报告 current、Build 和 receipt 不随卸载删除或重放。

## 通用组合契约

`./integration` 公开 `dsh-data-analysis-integration/v1`：`applyWithIntegration` 与普通
`apply` 共享实现；空扩展保持原行为。扩展只可在 Workspace 成功绑定后执行回调，为数据源操作
提供 Harness 管理的 `CredentialStore`，并提供经该 Workspace 实时 authoring schema 校验的
受管凭据**引用名**。普通 profile 配置仍拒绝 `*_env` 默认值；扩展引用不携带 secret 值。
回调失败使该 Workspace 绑定失败并允许下次重试，不将失败 binding 缓存在其他 Workspace。

`ensureSharedMarivoRuntime(..., { existingOnly: true })` 仅验证现有 Runtime，缺失或无效时明确
报错，不创建目录、锁或安装。 `./client-composition` 导出可组合的浏览器 `apply`、`inject`
及 RPC helper；普通 `./client` 仍是 Harness 自注册 bundle。组合方只激活自己的客户端行，避免
重复执行社区客户端。兼容版本在包元数据和 `./compatibility` 中同步声明。

## Agent scope surface

| Surface | 独有责任 | 删除条件 |
| --- | --- | --- |
| `marivo_help` | Native mode 的受控解释器与实时 Help transport | Harness/Marivo 提供等价原生 transport |
| `marivo_datasource_configure` | 将数据源配置表单绑定到原调用并续接 | DSH 提供等价的领域配置续接 |
| `marivo_datasource_test` | 缺失 DSH Credentials 的 Web 收集与显式 connection test | DSH 提供通用 credential-aware datasource lifecycle |
| `marivo_python` | 一次调用内的全部 datasource 准入、fresh snapshot 与前台执行 | DSH 提供等价的执行准入与 Marivo resolver 注入 |
| `marivo_present` | 引用/Lang 准入、不可变 JSON 与默认 tool/显式 tab 交付 | DSH 提供等价的完整快照交付 |
| `marivo_ui_read` | 按准确 recordId 恢复定义与必要 schema，不读取业务数据 | Harness 提供等价的文档定义恢复 |

以下 Tool 不注册：Artifact inspect/quality/contract/lineage、Session resume/context/graph、Artifact check、
semantic readiness、datasource/table inspect、Artifact materialize/export 等 convenience wrappers。
`marivo_export_html` 与 `marivo_publish_report` 已随旧报告管线移除，插件不再注册 HTML 导出或发布 Tool。原生 API 已拥有
语义时，插件不重新装箱。

## Prompt 与 Skill 激活

系统提示只负责任务入口与宿主接入边界。常驻路由区分聊天回答（含简短表格）、原生文件交付与报告展示：
文件分析（含简短聊天比较）先加载 `dsh-data-analysis-files`，指定 CSV、JSON、PNG 等生成文件通过原生 `present` 交付；已有 CSV、TSV、XLSX 表格文件也可通过 `present` 打开 Harness 原生只读预览。已有单结果直接用 marivo_present 传准确引用，不额外读取 Skill/Catalog。自定义 Lang 时按需加载
dsh-data-analysis-presentation；分析 UI 的 AnalysisFrameView 按 Frame 结构选择图形，DatasetView 支持 auto/table/metric；支持 Native 参数流和基版本语句更新，默认 tool，明确报告为 tab。
不提供离线 HTML 导出或发布。

`marivo-analysis` / `marivo-semantic` 激活后披露对应 Runtime 根 Help 和 Host 执行、凭据边界；具体配置与
测试顺序由 `marivo_datasource_configure`、`marivo_datasource_test` 的 Tool 描述指导，凭据、路径与身份由
代码校验。首次激活补发与 compaction 恢复保持原机制，见 [Help 披露](help-disclosure.md)。

文件 Skill 拥有文件分析与收尾核对；Runtime Skill 拥有 Marivo 分析、语义与证据有效性；展示 Skill 只核对
呈现是否忠实于已有结果。系统中的 analysis 收尾提醒暂时保留，移除须另有绑定 Runtime Skill 和真实模型
覆盖证据。插件不复制上游 API，也不因纯文件或展示任务自动激活 Runtime Skill。

分析收尾提示建议用货币代码、名称或转义美元符号，降低与 Markdown 数学定界符的歧义；它只是模型提示，
不能保证所有回答正确渲染，聊天 Markdown 解析仍由 Harness 拥有。

系统仅增加可复用语义的条件性交接入口：限于当前任务需要或用户已授权的范围，问题已有答案或阻塞已明确
即停止。文件 Skill 判断候选的用途、依据与范围，进入 `marivo-semantic` 后按上游契约优先复用、补齐最小
必要定义并验证；返回引用后继续原问题。范围外机会只简要说明，不自动建模、另建记录文件或递归扩展。
这属于 Agent 工作指导，不增加工具门禁、自动持久化机制或新的语义对象类型；展示 Skill 职责保持不变。

展示 Skill 由 `dsh-data-analysis-presentation` provider 从包内 `skills/` 挂载；Runtime Skill 仍由
`dsh-data-analysis-marivo` provider 从当前 Runtime 读取。两者不包含默认 roots，也不监听目录变化。
主流程与按需 references 的职责见[展示 Skill](presentation-skill.md)。旧报告 Skill、prompt、三个经典 JS
资产、emitter、旧 transport schemas 及 Draft/图形示例不再分发，当前包不提供兼容包装。

[展示数据投影](presentation-projection.md)使用相同 bound Workspace/Runtime 的公开读取程序生成快照。
`dsh_data_analysis_presentation.capture_dataset(frame)` 在原 `marivo_python` 进程中捕获 pandas DataFrame，
成功回执返回 `snapshotRef` 并关联原调用的 `codeRef`；它不推断 SQL/文件来源，也不证明捕获前的转换正确。
presentation-kit 公开 `capture_dataset`、`capture_frame` 及对应 capture receipt，不再提供写出 TypedDataset 文件的 helper。

## Web client

Web client 只保留：

- datasource 凭据管理与 `marivo_datasource_test` / `marivo_python` 的等待表单；
- 语义层对象浏览与 composer 原生引用输入；
- 原生报告目录、版本历史与分析 UI 正文 Tab（只读）。

报告呈现编辑、HTML 下载、[报告发布](report-publishing.md)菜单与发布凭据管理已移除。

生产 client bundle 由 `client.tsx` 注册共享 AnalysisSurface，作为右侧 Tab 的[展示 reader](presentation-reader.md)。
通过统一 Session/Turn delivery 观察新交付，自动打开固定 Build Tab；重复事件去重，历史回放不自动打开。
成功回执不渲染聊天卡片，打开失败时提供错误反馈。旧格式报告不出现在目录，直接打开时显示不支持。
文件所有权、只读 RPC 和取消边界见[展示交付](presentation-delivery.md)。

## 空白首页工作区入口

`conversation.input.dock` 中的三个快捷入口与顶栏共用目录打开动作，分别进入数据源、语义层和报告 Tab。
组件使用公开 `conversationPhase`，仅在已有空白 Session 的 blank 阶段显示；完全无 Session 时不显示，
不创建额外 Session。输入草稿不会隐藏入口，正式对话使用原顶栏操作。

首页入口通过局部 grid 布局与前一组 Workspace / Agent preset 控件并排，空间不足时换行；
保留原生 slot 树和焦点顺序，不搬移 DOM。布局依赖当前 Harness hero row 紧邻 dock 的结构，
上游调整该结构时需重跑 `validate:workspace-shortcuts:web` 的同排与窄屏验收。

Workspace 从所属 Session 的成员关系确定，连接或 Workspace 未就绪时禁用；点击时再次校验当前身份。
显示入口不加载目录数据，失败在按钮旁显示。窄屏保留文字并换行，locale 切换不影响输入或报告语言。

## Harness 接缝

当前开发与验收基线为 `0.2.1-rc.2`。Session/Workspace client API 分别来自 `dsh-api-session-controller`
和 `dsh-api-workspace-controller`；对话组装由 `ui-conversation` 拥有，chat 节点渲染由 `ui-chat` 拥有。
新版 Lexical composer 通过 scoped `slash/input-insert-reference` 和当前 `draftRev` 追加语义对象引用，
采用 reference 的原子位置坐标，保留现有引用、附件和原生撤销历史，细节见[语义对象引用输入](semantic-reference-input.md)。
报告 cell 的“加入提问”（`marivo-report-cell`）已随旧 reader 移除。

`src/rpc.ts` 与 `src/client/rpc.ts` 将插件逻辑 endpoint 接入 Connection 的精确 Fetch 路由，
认证、Host/Origin 检查和请求体传输继续由 Harness `/api` 拥有。插件只解析公开 `clientRequestSchema`
和自己的 payload；路由撤回与领域操作 drain 仍属于原 plugin lifecycle。
此接法避开 alpha 的独立 `rpc.handle` 在 Cordis plugin context 中访问 `webServer` 失败的问题，
不修改 DSH 源码或 profile 的认证策略。

验证工具通过 `snapshotEvents()` 和 SessionPersistence 的 `open/read/close` 读取事件，
不把底层 JSONL 文件路径当作 Session identity。模型请求校验读取 `messages` 中的 system 消息。

## Compatibility 与 package

`dshDataAnalysisCompatibility` 保持 v2 结构，分别声明兼容范围与精确 Runtime 身份：

| 边界 | 当前值 |
| --- | --- |
| DSH peers 兼容范围 | `>=0.2.1-rc.2`，npm 默认预发布匹配规则 |
| DSH 开发 distribution | `0.2.1-rc.2`，直接开发依赖精确固定，lockfile 保留全部 DSH 包的实际解析版本 |
| Marivo | `marivo[duckdb,trino,clickhouse]==0.6.0.dev0` |
| Runtime marker | `dsh-data-analysis-runtime/v3` |
| Subprocess policy | `direct-argv-inherited-env-snapshot-overlay-v2` |
| Presentation-kit | `dsh-data-analysis-presentation-kit==1.5.0`，Dataset schemaVersion 1、Frame schemaVersion 2 |

Package 不导出 `./evidence`、`./report` 或 `./report-check`，也不暴露报告 Checker CLI。tarball 包含唯一的 presentation-kit wheel
与内部纯数据 contracts、builder，以及展示及文件分析 Skill 的 `SKILL.md` 和 references；
旧 report-kit、报告 Skill、JS registry、旧 transport schemas、portable/static 离线资产和
`dsh-data-analysis-presentation-lint` CLI 均不分发。
版本、distribution metadata、package path 或解释器不匹配时 fail closed；不维护 compatibility alias。

依赖检查直接使用 `semver.satisfies`，不启用 `includePrerelease`：接受 `0.2.1-rc.2` 及同一 `0.2.1` 核心版本中后续满足范围的预发布
和之后满足 `>=0.2.1-rc.2` 的稳定版本，不自动接受其他 core 版本的预发布。逐项检查直接消费的 peers 与 Host 实际解析身份，
不要求不同名称的包版本字符串相同。生产源码禁止引入 SessionPersistence、验证脚本和邻近 checkout；
正常 workspace 链接允许，Host client external/metafile 检查保留。

## npm 发布

[`release.yml`](../../../.github/workflows/release.yml) 通过 GitHub Actions 的 `npm` Environment 和 OIDC
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

plugin real-model runner 验证 Help/凭据接缝，需要目标 Marivo 0.6.0.dev0 与真实模型。
presentation integration runner 使用隔离 Workspace、真实 Tool dispatch 与 Host Web 验证交付。
路径、runner 日志或静态 schema 不替代实际交互证据。

## Browser 构建

client 使用 esbuild 打包 Browser source 与共享 contracts 等依赖，DSH/React 保持外部依赖，
由 DSH module loader 提供；构建检查拒绝第二份 Host React、Node 与 Runtime 模块。
不再构建 portable/static 离线 renderer；实际打包依赖保留许可证，不增加公开 npm subpath。

## 凭证通知的连接接入

Host 声明 `typert` 注入，Client 声明 `remote` 与 api-gateway 注入；依赖公开
`dsh-api-gateway`、`dsh-typert-protocol` 和 `dsh-typert-registry`。插件自有严格 contribution
在 Host 注册、在 Client 挂载；挂载后通过声明 `remote.dshDataAnalysisCredentials` 注入的子级消费者
使用动态 namespace，消费者与订阅一同清理。逻辑 stream 使用 Harness 现有 WebSocket 及恢复机制。
不新建物理 WebSocket，不修改 HMR SSE。通知与快照生命周期见[凭证模块](datasource-credentials.md#待办通知与连接生命周期)。
