# DSH 0.1.5-alpha.1 兼容升级与验收

## 结果

2026-09-09：本机全局 DSH、项目依赖及本机 Web profile 已升级并适配 `0.1.5-alpha.1`。
Web profile 安装当前插件 `0.1.3-dev.0` 的本地 tarball；安装后的 client 与项目构建字节一致。
Marivo 保持 `0.5.4`，presentation-kit 保持 `1.1.0`。

本机 Web 在 `http://127.0.0.1:3080` 运行，按 DSH 原生启动令牌完成浏览器认证。
本次未清理用户 Session、Credentials、Workspace 或报告，也未提交、推送或发布 npm 包。
后续产品调整见[重构与优化设计](dsh-alpha-refactor-design.md)，该设计尚未实施。

## 兼容修改

- 精确固定 DSH distribution 与 27 个 DSH peers，更新 lockfile、client 注入声明和分包 imports。
- 使用 Session/Workspace Controller、`uiConversation` 与 `ui-chat` 的公开 client 契约；按新版事件信封回放对话。
- `CallId` 改为 `ToolCallId`，`JsonValue` 来自 `dsh-util-values`；Programmatic Tool Calling 使用 `ptc` mode 与新 dispatch 事件。
- 保留读取既有 schemaVersion 2 receipt 的旧 `tool/code-dispatch` 事件名，新增历史回放回归；不改写旧会话记录。
- Session 事件读取改用 `snapshotEvents()`；验收工具通过 `SessionPersistence.open/read/close` 读取持久内容，
  flush 由 Session store 负责；补齐异步 Agent 创建、Projection Registry 与持久化依赖。
- 适配 Lexical composer：Ask DSH 通过 scoped input event、当前 revision 和原子引用坐标追加内容。
- 插件 RPC 改用 `/api/<plugin-namespace>/<endpoint>` 精确 Fetch 路由，保留公开 RPC 信封校验和领域输入校验。
  认证、Host/Origin fence、请求体传输仍由 Harness 处理，路由随插件生命周期撤回。

直接注册独立 `connection.rpc.handle` 在该 alpha 的实际 Cordis plugin context 中触发上游
`cannot get property "webServer" without inject`。此次改用公开 Fetch registry，未修改上游源码、
未绕过认证，也未复制 Gateway 注册表。有关接缝见[插件集成与交付](modules/plugin-integration-delivery.md)。

## 验收矩阵

| 层次 | 结果 | 证据范围 |
| --- | --- | --- |
| `npm run check` | 441 项：437 通过、0 失败、4 项显式选择运行 | 格式、依赖树、两组类型检查及完整测试套件 |
| 4 项真实 Python 补充测试 | 4 通过、0 跳过 | 超时、调用取消、PTC 外层 deadline、121 秒执行成功与一次代码捕获 |
| `npm run build`、`verify:plugin-package` | 通过 | 213 个分发文件、27 个精确 DSH peers、wheel、公开 contracts、离线 builder |
| 真实 Harness Native / both / PTC | 通过 | 实际 Tool dispatch、Marivo Runtime、规范 receipt 与持久事件读取 |
| 完整安装包的真实 DSH Web | 通过 | 4 份报告、3 个原生 ProducedFiles 行、两种 client 加载顺序、编辑/冲突/筛选/导出、重连与同 profile 重启 |
| Ask DSH 真实 DSH Web | 通过 | 空/已有草稿、重复追加、引用 occurrence、上传附件、撤销、只写草稿、失败保留报告与离线复制 |
| 语义浏览 Chromium + Marivo | 通过 | 元数据展示、搜索、关系导航、Workspace 隔离、取消、窄屏和失败保留旧内容 |
| 凭据表单 Chromium + Runtime | 通过 | 数据源创建/属性、无效引用拒绝、凭据管理、等待恢复、并发操作、原调用续接且 Python 只启动一次 |
| 真实模型接入 | 六条流程通过 | 分析/语义 Skill、普通计算、Help 去重、双 Skill 顺序、缺失数据源凭据时的 Help |
| 本机实际 Web profile | 通过 | 安装字节一致、composer 与报告入口挂载、零 page error；未认证 401、跨站 403、认证后命中插件路由 |

默认套件的 4 个跳过项已用显式 Python 路径及长执行开关全部补验，不是未执行的剩余检查。
新版输入契约测试使用已安装的公开 InputTriggerController；不再借用邻近旧 Harness checkout 的私有 InputMachine。
Lexical 的引用、附件及撤销另由真实 Web 验收覆盖。

## 复现命令

Node.js 兼容范围与 Harness 一致，为 `^22.19.0 || >=24.0.0`；本地开发与发布构建使用 22.19.0（见根目录 `.nvmrc`）。依赖安装与普通验证：

```bash
npm install
npm run check
npm run build
npm run verify:plugin-package
```

实际 Runtime 与 Web 验证：

```bash
npm run validate:presentation-integration:real
npm run validate:presentation-ask-dsh
npm run validate:semantic-browser:web
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/marivo/python npm run validate:credentials:web
npm run validate:plugin-integration-delivery:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/marivo/python \
  DSH_DATA_ANALYSIS_VALIDATE_LONG_PYTHON=1 \
  node --experimental-strip-types --test \
  packages/dsh-data-analysis/tests/datasource-credentials/python-execution-real.test.ts
```

本次安装操作：

```bash
npm install --global @deepseek-ai/dsh@0.1.5-alpha.1
node scripts/pack-plugin.mjs
dsh plugin --profile web add /absolute/path/to/chengxianglibra-dsh-data-analysis-0.1.3-dev.0.tgz
dsh web --no-open --port 3080
```

不要用未指定版本的 `npx @deepseek-ai/dsh@latest` 替代：本次选择的是 alpha 通道。

## 证据与限制

聚合证据见本地 [dsh-alpha-acceptance.json](../artifacts/dsh-alpha-acceptance.json)，
实际 profile 的 [Web 验收结果](../artifacts/dsh-alpha-local-web.json)和[页面截图](../artifacts/dsh-alpha-local-web.png)，
以及[真实模型流程记录](../artifacts/plugin-integration-delivery-real-model.json)。这些产物位于忽略提交的 `artifacts/`；
聚合记录包含原始临时验收目录和最终 tarball SHA-256，本页保留可复现摘要。

真实模型使用 `deepseek-v4-flash`、安装的 Harness services 与受控 Skill/Python 测试工具；完整 Web 报告验收使用脚本化模型 adapter。
语义与凭据专门页面使用隔离的 slot/transport fixture，不能单独视作完整 Web 验收；完整 Web 与本机 profile 另有上述证据。
本次未重新执行生产 Trino/ClickHouse 查询，未宣称完成所有历史用户会话的批量迁移。
