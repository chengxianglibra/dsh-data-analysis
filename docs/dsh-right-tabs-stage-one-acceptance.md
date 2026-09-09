# 第一阶段：原生右侧 Tab 实现与验收

此记录保留第一阶段验收证据。报告编辑容器后续迁移至 Tab，见[报告 Tab 优化](report-tab-editing-acceptance.md)。后续[报告列表简化](report-catalog-simplification-acceptance.md)已移除侧栏报告入口和目录内历史操作，窄面板保持三列表格；本页对应旧截图与断言不代表调整后的界面。

## 交付范围

2026-09-09 在 [1a 原型](dsh-right-tabs-prototype-acceptance.md)上完成默认 client 接入。
数据源、语义层、报告三个标题入口按顺序打开原生 Tab，报告正文与语义对象使用独立资源地址。
本次修改源码、依赖声明、分发验证、回归测试与使用文档；未重装当前 profile、重启现有服务或发布。
当前安装不会因源码实现完成而自动切换。

Harness 拥有 Session、Workspace、原生面板与凭据生命周期；Marivo 拥有报告和 Catalog 语义。
本插件只连接导航、只读内容与既有操作容器。第二阶段上下文优化、上传分析和编辑容器迁移不在本次范围。

## 从原型到默认实现

- [`src/client.tsx`](../packages/dsh-data-analysis/src/client.tsx)安装默认原生浏览集成，声明 sidebar-right 的 client 注入与精确 peer。
  目录 kind 固定为 `marivo-datasources`、`marivo-semantic`、`marivo-reports`，去掉原型后缀。
- 报告资源身份沿用 1a 已验证的 Workspace/Report/current 或固定 Build 编码；语义对象保留完整 kind/path。
  报告目录“查看历史”以 `history: true` 定位正文的版本列表，参数不改变资源身份。
- 对话卡片显示交付时标题与摘要，打开和下载均对应固定 Build。下载使用既有读取与完整性校验，
  不打开编辑/阅读 overlay，也不重新计算数据。数据源配置交接保留 Tab 中已选择的数据源。
- 有匹配 Session 的浏览入口只走原生 Tab。侧栏报告入口在没有匹配 Session 时继续打开原目录与 reader，
  语义来源沿用无 Session 弹窗，不隐式创建 Session。数据源写操作与报告编辑继续复用原容器。
- 浏览页统一 Host 主题、按钮、边界、焦点和状态提示；目录在窄 pane 中改为逐条排版，
  语义业务域/类型筛选在窄 pane 中仍可访问。正文按 pane 宽度缩小留白，保持精确数值可滚动。
- 默认安装不收集测试事件审计。测试通过显式诊断选项与 `onInstalled` 回调取得观测句柄，
  正式 `apply` 返回 `void`，符合 Cordis effect 契约；所有注册与页面模型由插件生命周期清理。

实现集中在 [`client/right-tabs`](../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)，
共享 reader、Catalog、凭据模型只增加必要的容器/导航参数，未新增报告或凭据协议。

## 保持的运行规则

当前 Session 的新交付由 `sessions.binding(sessionId).eventSource` 独立识别；仅初始化之后的 `append`
可能触发自动打开。初始快照、`replace`、`prepend`、重连和切回 Session 建立基线；后台完成不排队补开。
Native/PTC 均经过 canonical receipt 与调用关联校验，按 Session/交付身份去重，导航前再次检查前台与 Workspace。

每个 `(sessionId, tab.id)` occurrence 独立持有页面 model；Host signal、导航 revision 与请求取消共同阻止迟到结果覆盖。
同目标聚焦；不同报告、current 和固定 Build 可并排。切换 Session、分栏和浮窗不共享可变 reader 状态。
Workspace 撤销、断线、关闭或卸载时清理/失效所属读取，不使用 Host 私有 store。

交付或编辑保存后刷新目录并核验 current，发现新 Build 只提示。点击刷新或重新打开 current 才切换，
旧 Build 的筛选与选择被清理；固定 Build 不改变。不增加后台轮询。
编辑保留冲突、取消与草稿保护；Ask DSH 必须回到所属前台 Session，且只追加草稿。
语义浏览仅读取 Catalog，数据源展示仅读取安全状态，连接测试须显式操作。

## Review 修复

配置容器关闭前重新校验 Session/Workspace、路径和 Tab 状态；失效页的 `refresh()` 不解除失效标记，
只有通过归属校验的重新导航才能恢复。回归覆盖正常关闭、解除绑定、断线后关闭，以及关闭时不再发送 `overview`。

发布刷新与自动打开分别处理。前台 Session 和已有报告页所属 Workspace 的 Session 使用公开 binding 观察器；
后台 canonical 新交付通知该 Workspace 的目录/current，前台判断只决定是否打开固定 Build。
初始快照、历史回放、分页和重连仍只建立交付基线，不补开。
冷 Session 没有已打开的事件窗口时，通过公开 `session.getSnapshot().running` 从运行到结束的变化核验发布事实；
这只是刷新提示，不是推断新报告，也不调用 Host 的历史打开或 Session 创建接口。
关闭最后一个相关报告页、Workspace 撤销、Session 移除、断线及卸载会回收不再需要的订阅。

新增真实 Web 用例检查：后台发布更新目录且只提示 current，正文 Build 与焦点不变；冷窗口后台运行更新目录而不打开历史；
配置弹窗打开期间解除绑定，弹窗自动关闭后数据源页保持失效且没有额外读取。

## 复跑与证据

本次验收按仓库 `.nvmrc` 使用 Node 22.19.0；DSH/sidebar-right 为 `0.1.5-alpha.1`，Marivo 为 `0.5.4`，
插件工作树为 `0.1.3-dev.0`。本次浏览器为 Chrome `152.0.7977.83`，精确版本与产物摘要写入机器记录。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过；446 项测试通过，4 项 opt-in Python 超时/取消测试按默认配置跳过 |
| `npm run build` | 通过 |
| `npm run verify:plugin-package` | 通过；223 个文件、28 个精确 DSH peer，离线 builder 验证通过 |
| `npm run validate:right-tabs:web` | 37 项真实 Runtime/Web 断言通过，无浏览器未捕获异常 |
| `git diff --check` | 通过 |

四项默认跳过测试属于既有 Python 执行期限边界，本次没有修改该路径。真实 Web 验收另实际执行了
生产 datasource 凭据等待、Native/PTC 工具与 Marivo 报告保存，不能用此替代被跳过的超时测试。

```bash
npm run check
npm run build
npm run verify:plugin-package
npm run validate:right-tabs:web
git diff --check
```

[Web 验收脚本](../packages/dsh-data-analysis/scripts/validate-right-tabs-web.ts)从实际构建包的 `/client` 导出加载插件，
通过公开 `ctx.plugin(production, ...)` 安装，验证真实 Cordis 生命周期，测试包装不替换默认 apply。
只在独立测试 profile 中加入脚本模型、测试驱动端点、延迟响应和观测句柄。实际执行生产工具、Marivo、报告保存、
事件传输和浏览器路径；不宣称真实模型分析验收。退出时关闭自己的浏览器/Host 并清理本次 Workspace/profile。

本地证据位于 `artifacts/right-tabs-stage-one-review-fixes-2026-09-09/`，不会随 npm 包分发：
[机器断言与模块摘要](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/evidence.json)、
[并排版本](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/parallel-builds.png)、
[浮窗](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/floating-reader.png)、
[窄格](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/narrow-reader.png)、
[默认正文](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/native-tabs.png)、
[数据源目录](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/datasource-directory.png)、
[窄格语义目录](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/semantic-directory.png)、
[报告目录](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/report-directory.png)、
[无 Session 阅读](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/no-session-reader.png)、
[后台版本提示](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/background-current-hint.png)、
[撤销后的数据源页](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/revoked-datasource.png)、
[离线 HTML](../artifacts/right-tabs-stage-one-review-fixes-2026-09-09/report.html)。
检查日志与本次实现文件的 SHA-256 另保存在同一目录。截图中的截断/来源不可用提示来自刻意构造的诊断用例。

## 验收边界

验证包含 1a 的交付、回放、分页、重连、并排、生命周期、凭据等待、编辑冲突、Ask DSH 和离线阅读矩阵，
并增加默认包安装契约、卡片固定 Build 下载、目录历史定位、窄格筛选/重复聚焦、选中数据源交接及无 Session 访问。
所用报告、凭据和 Workspace 均为隔离合成用例。极窄视口下 Host 可能保留多个 pane；长表格和大数值仍需横向滚动。
刷新不承诺恢复原生布局，用户可通过卡片或目录重开。没有迁移编辑/配置关闭拦截，也没有更改 Host 的面板策略。
