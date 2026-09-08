# 可选全局筛选与动态 KPI 验收

## 本次实现

Agent 决定是否声明 `interaction`。声明后，固定字段的单选控件（含显式“全部”）共同选择唯一预计算组合；
动态 KPI、图表、表格与来源预览全部响应，固定区域即使共用 dataset 也不响应。缺失组合、遗漏 dataset、
错误行索引、KPI 非唯一行、跨区域移动均拒绝。作者契约见[全局筛选与动态指标](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/interaction.md)。

原有按 dataset 自动生成的过滤器和图表局部数据行过滤已移除。统计图按当前 slice 校验和绘制，保留原始行身份和
作者预计算值，不把不同组合连接成同一条排行、瀑布或饼图序列。绘图只编码所选行，避免无关行影响当前组合。
宿主编辑从原文档裁剪已删除的区域引用；阅读选择不保存，打印和无脚本阅读显示默认组合。

浏览器验收同时修复了数据源弹窗 Escape 事件冒泡导致外层报告关闭的问题；现在只关闭内层弹窗并恢复焦点。

## 执行结果

2026-09-08，Node.js `v24.18.0`：

| 验证 | 结果 |
| --- | --- |
| `npm run check` | 通过，386 个测试，零失败 |
| `npm run build` | 通过，共享 reader、Host client、portable/static assets 完成构建 |
| `npm run quality` 与 `npm run typecheck` | 最终代码通过 |
| `npm run verify:plugin-package` | 通过，193 个打包文件，纯包环境的契约与离线 builder 验证通过 |
| `npm run validate:presentation-interaction` | 通过，生产 UI 与文件服务的隔离浏览器验收 |
| 文档相对链接与 `git diff --check` | 通过 |

浏览器入口为[可重跑脚本](../../packages/dsh-data-analysis/scripts/validate-presentation-interaction.ts)，使用明确标注的
[合成数据草稿](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples/interaction.draft.json)。
脚本创建独立临时 Workspace 和 loopback 测试服务，直接使用生产 `PresentationCards`、`PresentationOverlay`、
`PresentationDeliveryModel`、reader、文件服务和保存实现；结束后关闭测试服务，不重启已有 Harness。

本次证据目录为本机临时目录 `dsh-global-filters-tbTuDU`（脚本会打印完整路径），包含 `evidence.json`、
`interaction.html`、`download.html`、`chart-gallery.html`、桌面与窄屏截图。证据记录如下：

- 两个字段组合筛选：全量为查询 550、失败 15、失败率 2.73%；周一甲集群为 150、3、2.00%。固定 KPI 始终为 550。
- 当前 slice 同步作用于图表、表格、动态 KPI、来源数据预览及复制上下文；预备图形切换保持当前组合；跨数据集切换至 `charts-bins` 的直方图时，来源概要与数据预览仍使用对应组合。
- 搜索、键盘选择、Escape、外部点击关闭与焦点返回通过；390px 窄屏无页面横向溢出，截图已人工视觉检查。
- 生产编辑与 RPC 保存、删除/撤销/重做、禁止跨区域上移、原卡片重开恢复默认组合通过；筛选不产生 dirty 或保存请求。
- 下载字节与原保存 HTML 一致；Host 打印和禁用脚本均只显示默认组合，不混排全部切片。
- 离线 HTML 交互与重开通过，无外部网络请求；浏览器 `pageerror` 为零。
- 全部 18 种 chart 的共同筛选、原始行 ID、来源预览、预计算值/占比保留及空结果通过。饼图组合独立安排角度，不重新归一化占比。
- 契约回归额外覆盖独立饼图、排行、瀑布组合的统计校验、null/精确指标和未选行不参与绘图编码。

## 验收限制

这是合成数据驱动的真实浏览器与生产文件服务验证，不是 fresh Agent、真实 Marivo Runtime 或真实 Harness 模块加载验收。
本次没有重新查询 Trino，没有重装插件、重启现有服务、提交或发布。已下载的旧 HTML 不会自动变化。

[之前的编辑与局部过滤验收](2026-09-07-presentation-editing-acceptance.md)保留为历史记录，其中按 dataset 过滤的行为由本次显式全局组合契约取代。
