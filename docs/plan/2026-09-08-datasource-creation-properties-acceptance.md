# 数据源新增与属性展示验收

日期：2026-09-08。范围：新增数据源的凭证引用错误反馈、管理页的只读数据源属性。
当前契约见 [Datasource Credentials 模块](../modules/datasource-credentials.md)。

## 问题与修复

`*_env` 字段接收凭证引用名。非法引用原先由 Host 在 Python 执行前拒绝，但桥接异常被转换为
通用 `credential-operation-failed`，用户看不到具体原因。现在保留安全错误码
`datasource-credential-ref-invalid`，说明引用命名规则与实际凭据的填写位置，不回显被拒绝的输入。
明确拒绝不再附加提交结果未知的提示；传输错误和未知错误仍要求刷新核对，且不自动重放请求。
新增表单的字段说明与名称同行放在输入框上方；凭证引用提示也放在该说明区域，窄屏自然换行。
会话标题的两个管理按钮互换位置，从左到右为“数据源与凭证”“语义层”；待办入口继续排在后面。

管理页原先只投影 `env_refs`，没有显示 Marivo 已提供的连接配置。现在通过公开 `md.describe()`
投影 `backend_type` 和 `literal_fields`，以“数据源属性”独立只读展示；字符串、数字、布尔值、
空值和复杂 JSON 保持可辨识。凭据配置仍由 Harness 管理，属性读取不解析 Harness 保存的凭据。
`literal_fields` 遵循 Marivo 对配置的分类，不声称对任意用户配置做全面脱敏。
definition fingerprint 的计算不变，连接测试和单次执行仍核对原有 Runtime 与数据源身份。
创建成功或切换数据源后，详情滚动回到顶部，直接显示属性；同一数据源的后台状态刷新不复位滚动。

## 验证范围

- bridge → service → RPC → client：非法和保留引用在 Python 启动及写入前拒绝，不读取或写入凭据，
  错误响应不含输入 canary；未知提交结果保留刷新提示且只请求一次。
- 投影与页面：describe/inventory 严格解析属性对象；数字、布尔值、JSON、空值、长文本与 HTML 字符
  正确作为文本展示；无需凭据的数据源仍显示属性和测试入口。
- Chromium → HTTP RPC → 当前源码 service → 真实 Marivo 0.5.4：在临时 Workspace 中先拒绝非法引用，
  修正后创建 ClickHouse 定义，核对引擎、host、port、database、secure 和 settings；另验证 DuckDB
  创建、保存凭据、连接测试、同名拒绝，以及已有管理、等待输入和恢复流程。
- 桌面、390 px 窄屏与深色模式检查；窄屏数据源导航允许其既有的局部横向滚动，其余内容不得水平溢出。

验证命令：

```bash
npm run check
npm run build
npm run verify:plugin-package
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/marivo-runtime/bin/python npm run validate:credentials:web
git diff --check
```

## 验证结果与边界

`npm run check`、`npm run build`、`npm run verify:plugin-package` 通过。
字段说明布局、创建后滚动定位、按钮互换和全部凭据浏览器流程通过；对应入口回归测试通过。
文档相对链接与 `git diff --check` 通过。截图人工检查了桌面属性、390 px 属性和新增表单说明位置。

浏览器证据保存于本地 `artifacts/datasource-creation-properties-2026-09-08/`。
使用隔离的 DSH slots、HTTP transport、内存凭据 store 和临时 Workspace，不代表当前 3080 Web
profile 已部署。ClickHouse 仅验证定义创建与读取，没有连接业务数据库；当前业务凭据和服务状态未修改。
