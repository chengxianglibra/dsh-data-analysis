# 文本、KPI 与图表并排布局验收

## 实施范围

修正[前次宽屏验收](2026-09-08-presentation-responsive-acceptance.md)中的两项布局规则：Markdown 不再限制为
`820px`，KPI 不再拉满剩余行宽。连续 chart 新增容器自适应并排，具体规则见
[reader 布局](../modules/presentation-reader.md#通用阅读层级)。

仅修改插件展示层和作者说明；沿用现有 blocks、数据、来源、筛选与保存契约。
不新增布局 schema、统计行为或 Runtime 调用。在线 Host 和新生成 portable 使用同一实现；历史 HTML 保留旧资产。

## 验收方法

[布局浏览器验收](../../packages/dsh-data-analysis/scripts/validate-presentation-layout.ts)检查生产 builder 输出及
Host 组件在宽视口、窄内容容器、连续缩放下的实际几何和交互状态，并覆盖无脚本／打印的单列图表数据表。
现有 18 类图形验收继续检查字体、行高、几何、局部滚动和默认数据。

## 执行结果

2026-09-08，Node.js `v24.18.0`：

| 验证 | 结果 |
| --- | --- |
| 原工作区 `npm run check` | 423 个测试，零失败、零跳过；质量、依赖和类型检查通过，包含既有未提交改动 |
| `npm run build` | Host client、portable/static assets 构建通过 |
| `npm run verify:plugin-package` | 200 个打包文件，纯包环境的契约及离线 builder 通过 |
| `node --experimental-strip-types packages/dsh-data-analysis/scripts/validate-presentation-layout.ts` | 19 组检查通过，浏览器 `153.0.8010.12`，无 pageerror、portable 无网络请求 |
| `npm run validate:presentation-interaction` | 生产弹窗、文件服务、18 类图形、筛选／探索、离线及真实 200% 页面缩放通过 |
| 新验收脚本的 TypeScript / Biome、相对链接与 `git diff --check` | 通过 |

提交前从 Git 暂存索引导出独立源码快照，排除既有 Ask DSH 改动。Node.js `v24.18.0` 下重新构建、
TypeScript 检查、101 个 reader 测试和布局浏览器验收均通过；该次布局证据目录为 `dsh-presentation-layout-0ZJWQC`。

几何验收覆盖 `390 / 768 / 1440 / 1920 / 2560px` 的 portable 与 Host，包含 `2560px` 视口内的窄 Host 容器。
1／2／6 张 KPI 均不超过 `480px`；2／3／4 张普通图在宽容器形成 `2`、`2+1`、`2+2`，
普通双图 `1152px` 与双环形图 `1472px` 内容宽门槛前后均通过，尾部单图占满整行。
顺序和固定／筛选分区保持；连续调整尺寸保留 DOM identity、筛选值和隐藏系列；
无脚本与打印保留默认筛选值和单列精确图表数据表。宽屏、窄屏截图已人工检查。

用户 Trino 快照另检查 `390 / 768 / 1024 / 1440 / 1920 / 2560px`：内嵌文档与原 HTML 深度比较完全一致；
选择 `k8sdqc-dqc1` 后，各宽度的 KPI 保持 `122,871`，页面无横向溢出、无 pageerror。
`1920px` 下文本宽 `1792px`，KPI 宽 `480px`，两张图各宽 `880px`；`1440px` 仍并排，`1024px` 以下转单列。

原始证据目录为系统临时目录中的 `dsh-presentation-layout-qHlVNd` 和 `dsh-global-filters-B0BwP9`。
本机持久副本位于 `~/.codex/visualizations/2026/09/08/01a080e8-c157-7d32-b0ce-46acb7877155/layout-evidence/`；
该目录的上一级包含新版 `trino-responsive-layout.html`、原报告布局测量和关键截图。

## 验收边界

用户提供的 Trino HTML 仅提取内嵌文档并使用生产 builder 重新渲染，原业务数据与来源保持一致；
不代表重新执行 Trino 查询或验证分析结论。新版另存为本地预览，不覆盖原文件，不更新 Harness 中的报告记录。
不重装插件、不重启用户已有 Harness、不发布或推送。
