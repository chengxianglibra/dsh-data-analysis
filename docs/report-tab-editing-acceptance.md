# 报告 Tab 菜单与编辑优化验收

## 范围与责任

默认 DSH client 的报告正文使用标题行右侧三点菜单，版本只显示短 `buildId`。菜单包含刷新、编辑报告、历史版本，
以及原有下载完整报告、导出当前视图；下载含义不变。阅读和编辑均在原生 Tab 内完成，默认入口不再挂载报告弹出页。
独立 reader 验证夹具保留其展示容器，不构成默认产品入口。

Harness 继续拥有面板、Tab occurrence、Session 与 Workspace 生命周期；插件持有各 occurrence 的阅读、编辑和撤销状态，
沿用既有 current 指针及 `expectedBuildId` 保存协议，不改变 Marivo 数据与分析语义。

## 行为

- 历史列表中点击当前版本导航到 current；带 Build 的地址若仍是当前版本，也可直接编辑。进入编辑前重新核验 current，旧版本只读。
- 当前 Tab 保存成功直接展示新版本，其他 current 页按原规则提示更新；固定地址编辑保存后以公开 `replaceTab` 在原位置接续 current，避免地址与内容不一致。
- 保存冲突保留草稿，撤销／重做和阅读探索按各自 Tab 隔离；切换、浮动与停靠不会丢失编辑。
- 刷新与取消修改确认放弃；重复打开编辑中的资源保留草稿。依照用户确认，关闭 Tab 直接丢弃草稿，不增加关闭拦截或草稿持久化。
- 编辑时禁用历史切换、Ask DSH 与当前视图导出；保存、取消、撤销、重做直接可见。

## 验证

验证入口：`npm run check`、`npm run build`、`npm run verify:plugin-package`、`npm run validate:right-tabs:web`。

`npm run check` 已通过（547 项测试通过，4 项按既有条件跳过）；构建、分发验证、Markdown 相对链接和 `git diff --check` 均通过。

2026-09-09 已完成真实 Harness 浏览器验收，47 项检查通过，未捕获页面 JavaScript 异常。环境为 Node v22.19.0、
DSH 0.1.5-alpha.1、Chrome 152.0.7977.83。本次新增／调整的检查覆盖五项菜单及键盘导航、短版本号、历史列表当前版本可编辑、
Tab 内保存、浮动／停靠后的草稿与撤销／重做、拒绝刷新时保留草稿、保存冲突、固定地址当前版本保存接续 current、
关闭后丢弃草稿与离线下载，并继续通过原有 Session／Workspace 隔离、断线、延迟读取、语义来源和卸载检查。

本次证据目录为 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-right-tabs-stage-one-0NP7xd`，包含 `evidence.json`、`report-header.png`、`tab-editor.png`、
`narrow-reader.png`、`parallel-builds.png` 及其他检查截图。临时目录可能由系统清理；持久回归入口保留在仓库。
验证使用隔离测试 profile、生产工具与 Runtime，模型边界由脚本驱动，不代表真实模型验收，也不重装或重启用户日常 DSH 服务。
