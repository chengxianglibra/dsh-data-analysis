# 数据源新建默认值验收

日期：2026-09-10。

## 变更边界

Harness 插件配置增加可选 `datasourceDefaults`，通过 authoring 的独立 `creationDefaults` 传给新建表单。
当前 Marivo Runtime 决定 backend、字段与类型；原 schema、字段默认值、fingerprint 和配置写入流程不变。
不包含 S3 上传、发布、用户 profile 重装或现有 Web 服务重启。

## 自动化检查

`tests/datasource-credentials/defaults.test.ts` 覆盖 loader 可选项、未配置行为、类型转换、Runtime schema 不变、
RPC/client 接线、用户提交值优先，以及未知 backend／字段、错误类型、非 JSON 值和凭据引用拒绝。
配置错误仅返回固定错误码，测试使用 canary 验证值不进入错误响应。

初次实现于 Node.js 22.19.0 下 `npm run check` 通过：597 passed、4 skipped、0 failed；包含质量检查、依赖检查、源码及脚本类型检查。
`npm run build`、`npm run verify:plugin-package` 与 `git diff --check` 通过；新增文档的相对链接已检查。

## 真实浏览器验收

执行 `npm run validate:datasource-configuration:web`，显式指定现有 Marivo Runtime 解释器。
脚本在临时目录复制源码、构建并打包候选，启动隔离 Harness profile；使用真实 Marivo 0.5.5 和 Chromium，
Agent 模型边界为脚本 fixture。服务结束后关闭隔离 Host，不改变用户运行实例。

本次通过 14 项检查，其中新增默认值检查确认：

- DuckDB 初始表单实际填入 `path: ':memory:'`、`read_only: false` 和 `extra: {}`；未配置的名称保持空白。
- 用户修改或清空 path 后，修改其他字段触发重渲染不会恢复默认值。
- 切换 Trino 自动填入 host、`port: 0` 和空 source；切换未配置的 ClickHouse 时 host 保持原行为。
- 切回 DuckDB 重新应用默认值；不手动填写 path 即可保存、真实连接测试成功，并从编辑页回读 `:memory:`。
- 原有复用、编辑、失败后修复、凭据保存及原 Tool 续接旅程全部通过，浏览器 `pageerror` 为零。

证据目录：`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-datasource-config-web-mBpnSm`。
其中 `evidence.json` 保存检查列表和候选模块摘要，`creation-defaults.png` 为已查看的填充截图。
临时证据不作为永久分发内容；内部真实数据源连接不在本次验收范围。

## Review 修复回归

- authoring 增加可选 `mode`，默认 create；edit 只返回当前 Runtime schema。生产 RPC/client 回归测试覆盖未知引擎、未知字段、
  类型错误及凭据引用配置错误：编辑仍能读取 schema 和已保存配置，新建仍明确失败，旧调用省略 mode 时保持新建语义。
- 生产表单的初始化和提交 handler 回归覆盖新建空字符串、编辑无关字段、移除默认值后继续编辑、
  普通空输入省略以及编辑不应用新建默认值。编辑保留已有空字符串，不再重建为 Runtime 的缺省值。

修复后重新运行隔离 Harness／真实 Marivo／Chromium 的配置旅程，14 项检查全部通过，浏览器错误为零。
本次证据目录：`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-datasource-config-web-UMnQ8P`。
两项 review 边界由上述生产表单 handler 及 RPC/client 回归测试覆盖；浏览器旅程验证新建、编辑和续接没有整体回归。

修复后 `npm run check` 通过：600 passed、4 skipped、0 failed，包含 `npm run build`；
`npm run verify:plugin-package`、文档相对链接检查及 `git diff --check` 通过。
