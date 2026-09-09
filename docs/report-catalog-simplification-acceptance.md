# 报告列表简化验收

## 实施范围

2026-09-09 收敛报告目录的客户端呈现：移除左下角报告链接，通过 Workspace 头部报告入口访问。
目录标题右侧只保留一个「刷新」按钮；搜索区只保留标题搜索框，输入即筛选，固定按更新时间倒序。
每个报告一行，仅显示报告标题、生成对话和更新时间；标题与对话仍可点击，历史版本从报告正文访问。
长标题单行省略并通过悬停查看完整名称，窄面板通过表格内部横向滚动保持三列。

Harness 继续拥有 Workspace、Session 与导航；插件沿用当前发布记录和 Host 会话标题，不推测缺失来源或时间。
Marivo 分析、报告内容、发布记录、权限与版本读取契约保持原有归属。此次未重装或重启用户现有环境。
当前安装不会因源码修改自动更新。

## 验证

使用 Node.js 22.19.0。浏览器验收采用隔离 Harness profile、打包后的生产插件及 scripted model，
用于验证真实客户端交互，不代表新一次真实模型分析验收。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过；544 项通过，4 项既有 opt-in 测试跳过 |
| `npm run build` | 通过；最终 check 与分发验证也重新构建产物 |
| `npm run verify:plugin-package` | 通过；244 个分发文件、28 个 DSH peer 及离线 builder |
| `npm run validate:right-tabs:web` | 通过；46 项原生 Runtime/Web 检查 |
| `npm run validate:report-catalog:web` | 通过；12 项目录/历史检查，含最终手机刷新对齐断言 |
| `git diff --check` 与相关文档链接 | 通过 |

原生检查覆盖 Workspace 入口、没有左下角快捷入口、标题与唯一刷新对齐、单搜索框、即时空结果、
刷新保留搜索词、三列与更新时间倒序、生成对话跳转，以及从报告标题进入正文查看历史。
截图已人工复核；极窄视口中 Host 仍可能保留超出视口的面板布局，本次不修改 Host 布局策略。

原生验收完成后，仅补充保留弹窗目录的手机布局，让刷新始终与标题同排，并增加对应浏览器断言。
本地证据保存在 `artifacts/report-catalog-simplification-2026-09-09-5xo8g1/`：
[原生目录截图](../artifacts/report-catalog-simplification-2026-09-09-5xo8g1/native-report-directory.png)、
[原生检查与模块摘要](../artifacts/report-catalog-simplification-2026-09-09-5xo8g1/native-evidence.json)、
[最终手机目录](../artifacts/report-catalog-simplification-2026-09-09-5xo8g1/catalog-catalog-mobile.png)、
[最终目录检查与模块摘要](../artifacts/report-catalog-simplification-2026-09-09-5xo8g1/catalog-evidence.json)。
这些隔离验证产物不进入 npm 分发，也未提交或发布。
