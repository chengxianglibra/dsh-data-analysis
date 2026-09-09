# 第一阶段 1a：原生右侧 Tab 原型验收

本文保留 1a 原型当时的实现和证据；后续默认入口迁移见[第一阶段验收](dsh-right-tabs-stage-one-acceptance.md)。

## 实现边界

2026-09-09 完成[新版重构设计](dsh-alpha-refactor-design.md)的隔离原型及其验收。
默认 `src/client.tsx` 没有接入新 Tab；当前安装、服务、profile 没有迁移，没有提交、推送或发布。
1b 的默认入口切换、视觉统一和旧容器删除仍是后续工作。

可复用实现位于 [`src/client/right-tabs/`](../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)。
测试包装入口组合新浏览页面与现有凭据、编辑容器，关闭旧入口和旧卡片注册，避免重复入口。
Harness 继续拥有 Session、Workspace、凭据和原生布局；Marivo 继续拥有报告与 Catalog 语义。
原型只处理资源导航、只读内容容器、事件观察和所属上下文校验，没有新增分析工具或报告/凭据协议。

## 基线与复跑

- DSH 及 sidebar-right 测试依赖：`0.1.5-alpha.1`。
- 插件工作树版本：`0.1.3-dev.0`；Marivo：`0.5.4`；Node：`v24.18.0`。
- 使用 Chrome `152.0.7977.83` 的 Playwright headless 模式；Python 解释器通过 `DSH_DATA_ANALYSIS_PYTHON` 指定，
  缺省使用既有 shared Runtime。只读取该 Runtime，不重新安装或修改它。
- 独立临时 Workspace/profile，Native、PTC 和凭据等待各一个 Session，另有既有工具验收种子 Session；
  多个报告与多个 Build。只用隔离凭据 canary，不使用用户连接凭据。
- 模型适配器是可控脚本；Agent、生产工具、Marivo、报告保存、事件传输、Web、下载均实际执行。
  本记录不代表真实模型的分析或工具选择验收。

```bash
npm run check
npm run build
npm run verify:plugin-package
npm run validate:right-tabs:web
git diff --check
```

[Web 验证脚本](../packages/dsh-data-analysis/scripts/validate-right-tabs-web.ts)复用 S4 的真实 Host/Runtime 设施，
通过独立包装插件加载原型，不要求重装现有插件。每次生成独立输出目录；退出时关闭自己的浏览器与 Host，
删除本次 Workspace/profile，保留 `evidence.json`、截图和离线 HTML。测试专用 HTTP 端点和延迟读取探针不进入默认插件入口。

## 公开接缝与资源身份

| 接缝 | 本次用途 |
| --- | --- |
| `sidebarRightTabs.register` | 注册三个目录与两类资源，精确匹配 `canOpen` |
| `sidebar.right.pane.tab`、`sidebar.right.pane.tab.title` 与 `useTabInfo()` | 正文、标题、Tab signal、navigation revision 与 occurrence 绑定的 actions |
| `sidebarRight.openTab/openResource`；Tab actions | 目录聚焦、资源聚焦、固定版本并排；导航失败呈现反馈 |
| `sessions.binding(sessionId).eventSource` | 订阅公开 `SessionEventWindow.change`，与卡片渲染独立 |
| Session/list、Workspace/list、connection generation/reset | 前台检查、绑定撤销、断线失效与重连基线 |
| 原报告 resolve/history/files/read/save 与 Catalog、数据源接口 | 复用完整性检查、元数据及安全状态，不在浏览页执行 observe |

目录 kind 为 `marivo-datasources-prototype`、`marivo-semantic-prototype`、`marivo-reports-prototype`，
导航参数只含所属 `workspaceId`。具体资源使用下列规范地址；每个变量单独 `encodeURIComponent`，
解码后经过原契约验证及 canonical round-trip 验证，拒绝多余段、query、fragment 和非规范转义。

```text
dsh-resource://marivo-report/{workspaceId}/{reportId}/current
dsh-resource://marivo-report/{workspaceId}/{reportId}/build/{buildId}
dsh-resource://marivo-semantic/{workspaceId}/{kind}/{path}
```

语义引用保留原 `marivo.semantic_ref/v1` 的 kind/path；关联跳转打开目标对象自己的资源地址，
不把其他对象显示在原对象地址下。未知对象显示读取失败；非本域资源不被匹配，原生文件预览继续工作。
current 与固定 Build 即使指向同一内容也使用不同身份；相同目标聚焦，不同报告或版本可并排。

## 事件与状态所有者

[`LiveDeliveryObserver`](../packages/dsh-data-analysis/src/client/right-tabs/live-delivery.ts)只将初始化后的
`append` 视为候选。初始快照、`replace`、`prepend` 扫描完整窗口建立调用关联和已见交付基线；
`settle-assistant` 不清除仍在等待工具结果的调用。复用 canonical receipt 解析和 Native/PTC 调用关联校验，
以 Session 加交付身份去重。导航前再次核验前台 Session、Workspace 和连接；后台不排队，重连重新基线化。
多次交付依事件顺序打开，最后一个成功导航获得焦点；失败保留卡片并显示反馈。

[`TabPage`](../packages/dsh-data-analysis/src/client/right-tabs/page.ts)由 `(sessionId, tab.id)` occurrence 拥有，
同时比对 Host signal 和目标身份。不能只用 tab.id：Host 在不同 Session 中可能复用该值。
页面持有自己的 reader、Catalog、语义浏览、数据源状态和报告筛选/排序/图形选择 memory。
React 重挂载复用有效 occurrence；请求同时受 model、navigation 和 lifetime AbortSignal 约束，返回后再次检查。
关闭、替换、撤销和卸载清理；断线使页面失效，重新打开才重新读取。

current 采用“提示后刷新”：本次交付、成功保存或恢复所属 Session 时刷新目录并核验 current，
发现新 Build 只提示。点击刷新或重新打开 current 才切换，同时清理旧 Build 筛选和选择。
固定版本只读且不随 current 改变，不增加后台轮询。
旧编辑容器继续维护草稿与乐观并发检查；取消返回原 reader。数据源配置沿用原容器和等待流程。
Ask DSH 在实际回调中检查所属 Session 必须为前台，只追加草稿，不发送。

## 验收结果与证据

`npm run check` 通过：441 项通过、0 失败，4 项原有 Python 超时/取消的 opt-in 实测因未设置专用环境变量跳过；
本次另外运行下表的隔离真实 Web/Runtime 验收，30 项浏览器断言全部通过；退出后确认本次 Workspace/profile 已删除。`npm run build`、`npm run verify:plugin-package` 与
`git diff --check` 通过；包验证检查了 221 个文件、27 个 DSH peer 及离线构建入口。

本地可复跑证据保存在 `artifacts/right-tabs-prototype-2026-09-09/`（git ignored，不随包发布）：
[机器断言与模块摘要](../artifacts/right-tabs-prototype-2026-09-09/evidence.json)、
[工作树文件摘要](../artifacts/right-tabs-prototype-2026-09-09/source-digests.json)、
[并排版本](../artifacts/right-tabs-prototype-2026-09-09/parallel-builds.png)、
[浮窗](../artifacts/right-tabs-prototype-2026-09-09/floating-reader.png)、
[窄屏](../artifacts/right-tabs-prototype-2026-09-09/narrow-reader.png)、
[原生页](../artifacts/right-tabs-prototype-2026-09-09/native-tabs.png)、
[离线报告](../artifacts/right-tabs-prototype-2026-09-09/report.html)。

| 范围 | 证据 |
| --- | --- |
| 事件识别 | 真实 Native/PTC 前台交付、重复 PTC 事件、后台完成、重新选择、刷新、断线重连；公开窗口单测补充新旧交错、错误所属与 settlement |
| 历史分页 | 真实 Session 历史经公开 `loadOlder()` 产生 `prepend`，不自动打开；单测覆盖分页含旧 receipt |
| 导航 | 三入口、current/固定版本、重复聚焦、并排、语义完整引用与关联跳转、未知资源、原生 ProducedFiles 预览 |
| 生命周期 | 延迟生产文件响应下关闭、替换、切 Session、浮窗/回嵌、折叠、Workspace 撤销和插件卸载；没有迟到内容覆盖或复活 |
| 原操作交接 | 配置取消、隔离凭据等待并继续生产工具、编辑保存与冲突保留草稿、current 提示后刷新、固定版本不变、跨 Session Ask DSH 拒绝 |
| 布局与导出 | 窄格、自动全屏、浮窗、图形选择与全局筛选重挂载恢复、图表尺寸恢复、键盘菜单焦点；下载字节对应实际 Build，离线浏览器独立打开 |

公开事件类型足以区分本次原型中的新交付和回放，不需要 Host 私有布局 store 或事件接口。
这份证据限于精确 alpha 基线和上述隔离用例。原型界面保留现有 reader 与原容器样式。
430px 视口下 Host 将右侧 surface 全屏化并保留两个 pane，长表格和精确大数值需要横向滚动；
没有改写 Host 的 pane 数量策略。1b 仍需统一视觉与窄格排版，不能把原型通过视为第一阶段产品迁移完成。
