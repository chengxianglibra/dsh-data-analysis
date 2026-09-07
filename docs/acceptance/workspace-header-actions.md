# Workspace 会话标题入口验收

日期：2026-09-07。

## 范围与行为

“语义层”和“数据源与凭证”注册到 Harness 的 `conversation.session.header.actions`，
按顺序显示在会话标题旁；侧栏底部不再注册这两个入口。按钮使用 slot 传入的 `sessionId`，
从 Workspace 列表解析其 `workspaceId`，打开现有 `shell.overlay` 面板。没有匹配 Workspace 时禁用按钮。
面板内保留显式 Workspace 选择，业务读取、凭证所有权与 RPC 契约保持原样。

凭证待办监听由全局 overlay 跟随当前会话，独立于标题栏是否挂载；“等待配置凭证”仍在会话标题旁显示。
桌面显示图标和文字，640px 以下显示带无障碍名称的图标按钮。

## 验证结果

- `npm run check` 通过，包含新增的两个入口回归测试：标题栏会话与全局选择不同时仍绑定正确 Workspace；
  未绑定或 Workspace 删除时禁用两个入口且不发出读取。另检查两个管理项和待办的顺序，以及无侧栏注册。
- `npm run build`、`npm run verify:plugin-package` 通过：插件 `0.1.2-dev.0`，DSH peers `0.1.1-rc.2`，Marivo `0.5.4`。
- `npm run validate:semantic-browser:web` 通过：会话标题入口默认选定所属 Workspace，真实 Catalog 读取、
  切换项目、刷新失败、关系图、窄屏及关闭后焦点恢复通过。
- `npm run validate:credentials:web` 通过：默认 Workspace、桌面样式、320px 下的 32×32 图标按钮及无横向溢出通过；
  标题栏从未挂载时即发起当前会话的待办监听，卸载标题栏后仍收到待办；重新挂载后待办按钮能打开表单。
  保存、删除、并发操作恢复、刷新恢复待办与原 Python 调用仅启动一次均通过。
- 验收夹具补充后，相关 Biome 检查与 `npm run typecheck:source` 通过。`git diff --check` 通过。

本次浏览器证据输出到本机 `/tmp/dsh-header-semantic-web` 和 `/tmp/dsh-header-credentials-web`；
标题入口截图为后者的 `header-entries.png` 与 `header-entries-mobile.png`。
语义层验收首次因缺少 Playwright Chromium 未启动，安装匹配浏览器后重跑通过。

## 验收边界

浏览器验收使用生产插件入口、面板和真实 Marivo，以及隔离的 DSH slot/HTTP transport 夹具。
没有重装插件或重启当前 DSH Profile，不能将夹具结果称为已安装 DSH Web 的端到端验收。
Harness 无会话或空会话时不渲染标题栏，因此这两种状态没有管理入口；已有内容的会话不要求 live Agent。

实现说明见[语义层浏览器](../modules/semantic-browser.md)和[数据源与凭证](../modules/datasource-credentials.md)。
