# Workspace 报告列表与历史查看验收

此记录描述第一期验收。2026-09-09 的入口、搜索、排序和三列表格调整见[报告列表简化验收](report-catalog-simplification-acceptance.md)，当前行为以该记录与[展示交付模块](modules/presentation-delivery.md#workspace-报告列表与历史查看)为准。

## 范围与责任

第一期提供 Workspace 报告入口、标题搜索、最近更新与标题排序、来源会话导航、已发布历史查看和精确版本 HTML 下载。
会话头部入口顺序为「数据源与凭证 → 语义层 → 报告」。
列表、正文和历史侧栏复用同一个阅读器窗口；历史导航位于正文左侧，窄屏时位于正文上方。历史只读，当前版本沿用原有编辑与并发保护。
不包含版本比较、恢复版本、自动刷新分析、自动清理、插件发布或现有环境重装。

Harness 继续拥有 Workspace 注册、Session 标题与导航；Marivo 继续拥有分析和来源语义。
插件仅扩展报告文件读取、发布记录与阅读器入口。详细契约见[展示交付](modules/presentation-delivery.md#workspace-报告列表与历史查看)。

## 发布与读取证据

- 新 current 使用 schema v3，同时原子提交当前 receipt 和成功发布的版本记录；document、receipt、delivery 仍为 schema v2。
- 两个基于同一 Build 的写入只有一个成功；完整但发布失败的 Build 不进入列表或历史。
- schema v2 current 可读，只有其当前版本被视为已确认；首次更新保留这一已确认起点并明确标记早期历史不可用。
- Workspace RPC 直接核对注册表 id/path，不依赖来源 Session 存活；读取前后复核归属并沿用精确文件摘要校验。
- 历史下载固定已选 receipt，当前指针继续推进也不会改变下载内容；历史不更新卡片的当前版本缓存。
- 编辑期间不能切换版本；连接重置、Workspace 失效和迟到响应不会恢复旧内容。
- 损坏和符号链接记录披露不可读数量；目录及历史容量超限明确报错，不截断或清理历史。

对应回归：[报告列表与历史测试](../packages/dsh-data-analysis/tests/presentation-integration/report-catalog.test.ts)。

## 验证结果

- `npm run check`：通过，当前工作区共 439 个测试；包含 presentation integration 的 54 个测试。
- `npm run build`：通过；完整 check 的 reader 阶段也构建了客户端和离线产物。
- `npm run verify:plugin-package`：通过，206 个分发文件及离线 builder 验证通过。
- `git diff --check`：通过。
- `npm run validate:report-catalog:web`：通过。
- 浏览器采用未改写的已安装 Harness Web 与打包后的生产插件，使用隔离 profile；初始化分析采用 scripted model adapter。
- 真实浏览器验证报告搜索与空结果、已发布历史筛选、历史只读、下载字节一致、返回当前版本、编辑期间禁止切换、返回列表保留搜索，以及原会话卡片的历史入口。
- 桌面 1440×1050 与窄屏 390×844 均检查布局。首次窄屏验收发现侧栏挤压报告窗口，已改为窄屏使用视口宽度，复验通过。

浏览器证据目录：`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-report-catalog-H2Mo6h`。
其中 `evidence.json` 包含边界、模块摘要与验收项；`catalog-desktop.png`、`catalog-mobile.png`、
`history-desktop.png` 为检查截图，`historical.html` 已与对应 Build 的 HTML 逐字节核对。
可通过[验收脚本](../packages/dsh-data-analysis/scripts/validate-report-catalog.ts)重新生成隔离证据。

## 已知边界

旧记录没有可靠保存时间和来源时明确显示未记录；不按生成时间、目录时间或标题推测发布历史和来源。
列表当前版本按成功保存时间排序，正文保留生成时间，两者分别标注。
版本历史最多 4096 条、current 最多 16 MiB；目录枚举最多 4096 项，超限明确失败。
历史版本的来源链接依赖 Host 可用的会话列表，来源不可用不阻止 Workspace 内读取。
Workspace 列表直接打开报告时复制上下文，不猜测 Ask DSH 应写入的 Session。
这次验证不代表真实模型的新分析验收；没有修改、重启或重装用户现有 DSH profile，也没有提交、推送或发布。
