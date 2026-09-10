# 数据源及对应凭证删除验收

## 范围与所有权

2026-09-10，本地开发实现增加数据源详情页删除入口、确认区和可选的对应凭证删除。
Marivo 公开 `md.remove()` 负责定义删除，Harness `CredentialProvider.unset()` 负责凭证删除；
插件负责 Workspace/Runtime identity、操作去重、等待上下文失效与部分完成反馈。
实现细节见 [Datasource Credentials](modules/datasource-credentials.md#删除数据源与对应凭证)。

默认保留共享凭证，用户可以明确勾选一并删除。确认区列出引用并提示跨数据源、跨 Workspace 的影响。
只移除 Marivo 允许删除的项目定义，不删除远端数据库数据，不级联修改语义层或分析产物。

## 自动化验证

`npm run check` 通过，TAP 合计 595 项测试、0 失败；`npm run build`、
`npm run verify:plugin-package`、文档相对链接检查及 `git diff --check` 均通过。

使用仓库指定的 Node.js 22.19.0。回归测试位于
[removal.test.ts](../packages/dsh-data-analysis/tests/datasource-credentials/removal.test.ts)，覆盖：

- 单独删除与明确选择对应凭证删除；重复 operation ID 不重复写入。
- Host 管理上下文中的 credential version、definition 和 Runtime 变化在写入前被拒绝。
- Marivo 拒绝或响应未知时不开始删除凭证；只读凭证失败分别报告数据源已删除和保留引用。
- 删除使待执行快照失效，包括不含凭证的执行；只在勾选凭证删除时撤销其他 Workspace 的共享凭证快照。
- 结束等待中的凭证与配置请求；阻止同一定义上的并发操作；取消后不回滚已完成删除。
- RPC 响应丢失时只查询既有操作；删除卡片后保留结果且可关闭；输出不包含凭证 canary。
- 删除提交被 Host 明确拒绝时保留具体错误并刷新状态，不误报成操作不可恢复。

真实 Runtime 验证通过 `npm run validate:datasource-configuration:real` 执行，使用隔离临时项目与
本地 Marivo `0.5.5.dev0`，确认公开 `md.remove()` 删除本地定义、拒绝过期 fingerprint，
并保护内置 `default`；同轮同时验证既有配置读写和 DuckDB 连接测试。

浏览器验证已通过，入口为 `npm run validate:datasource-removal:web`，使用真实 Chromium、隔离临时 Marivo
Workspace、现有 RPC/service 与实际 `CredentialPanel`。凭证 provider 使用可控夹具，覆盖确认/取消、
默认保留共享凭证、显式删除、只读部分失败，以及桌面、390px 窄屏和深色模式。
结果与人工检查的截图保存在 `/tmp/dsh-datasource-removal-web/`，包括 `browser-evidence.json`、
`delete-confirm-desktop.png`、`delete-confirm-mobile.png`、`delete-confirm-dark.png` 和 `delete-result.png`。

## 验证边界

旧 `validate:credentials:web` 的广泛凭证流程在进入本次删除验证前超时：并发操作恢复后仍显示
`default`，脚本却等待另一数据源的连接成功反馈。该旧脚本保持原样，本次删除使用独立验收入口。

未重装插件、重启现有 DSH Web、发布或提交；没有删除用户的真实数据源或凭证。
浏览器验收属于隔离组件/RPC/Runtime 集成，不代表已部署的完整 DSH Web，也不验证外部只读凭证服务的可用性。
删除定义与凭证不是原子事务；provider 失败或取消后保留的凭证由 Harness 或其原来源继续管理。
