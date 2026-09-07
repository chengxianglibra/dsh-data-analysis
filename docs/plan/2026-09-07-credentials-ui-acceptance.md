# 数据源与凭证界面验收

日期：2026-09-07。范围：插件 client 的侧栏入口、凭证管理页、操作结果展示与隔离浏览器验证。
当前行为见 [Datasource Credentials](../modules/datasource-credentials.md)。

## 界面与行为

- “语义层”和“数据源与凭证”共用侧栏按钮，统一边框、字体、间距、图标与交互状态。
- 管理页采用 Workspace 与数据源导航、凭证卡片、连接状态和操作区，支持窄屏与深色模式。
- 移除重复的常驻谨慎提醒，保留配置状态、真实失败、已保存字段、删除确认和任务后续入口。
- 操作结束后立即移除 Client 列表记录和恢复句柄；每个数据源只显示最近结果及必要反馈。
- 后台操作完成后原地更新 overview，保持当前选择；新的结果在 overview 刷新失败时也可见。
- 当前请求从 Host Workspace 的会话归属显示导航和返回地址；原调用仍使用自身 context。

DSH Credentials 的保存和解析、Marivo 连接测试、原调用续接、Host 有界终态保留契约均保持原行为。

## 验证入口与覆盖

```bash
npm run check
npm run build
npm run verify:plugin-package
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/marivo-runtime/bin/python npm run validate:credentials:web
git diff --check
```

本次工作区执行 `npm run check`、build、plugin package 验证和隔离浏览器验证均通过。
截图与浏览器证据保存在本地 `artifacts/credentials-ui-2026-09-07/`。

Client 回归覆盖完成清理、取消和部分保存、多个 Workspace 的响应隔离、刷新恢复、原地 overview 更新、
晚到响应拒绝、结果确认以及失效 context 清理。

浏览器加载当前源码构建的 client，使用隔离 DSH slots、HTTP RPC、内存 credential store 和真实 Marivo
0.5.4 Runtime。覆盖保存、删除、测试、并发恢复、等待输入刷新、原 Python 调用只启动一次，并检查
凭证不进入可见页面或 sessionStorage。失败结果使用测试夹具，另注入 overview 失败，验证新失败不会被
旧成功遮盖，且已保存字段仍有反馈。

桌面 1200 px、窄屏 390 px、深色模式均检查水平溢出并人工查看截图。该验证不涉及当前 3080 profile 的
重装、服务重启或真实业务数据源凭证修改。
