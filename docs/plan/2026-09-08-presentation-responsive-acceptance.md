# 报告预览与导出 HTML 自适应验收

## 实现范围

Host 报告弹窗使用 `96vw`，共享 reader 移除固定桌面宽度上限，以 `clamp(20px,4%,64px)` 保留水平留白。
Markdown 最大宽度为 `820px`，其余内容使用可用宽度。保持单列 block 顺序及相邻 KPI 自动成行；
不增加报告布局配置，不改变数据、筛选或保存契约。

普通图高为 `320px`，sparkline 为 `128px`。统计 SVG 根据父容器宽度重算横向几何，宽、高和 `viewBox`
使用相同的 CSS 像素尺寸，字号和行高不随宽度放大。普通统计图至少 `520px`，环形图保留 `720px` 固有布局，
在宽画布内整体居中；窄屏可以局部横滚到图例。瀑布图柱宽上限为 `48px`，直方图继续保留分箱区间比例。

实现说明见[展示 reader](../modules/presentation-reader.md#通用阅读层级)。

## 验收方法

扩展[生产 UI 与文件服务验收](../../packages/dsh-data-analysis/scripts/validate-presentation-interaction.ts)和
[Host 模块加载与离线 reader 验收](../../packages/dsh-data-analysis/scripts/validate-presentation-reader-real.ts)。
使用既有合成数据及 18 类图形 gallery，在 `390 / 768 / 1440 / 1920 / 2560px` 检查容器尺寸、居中、
字体、图高、几何比例、标签、局部滚动和页面溢出；连续改变窗口宽度时检查本地交互状态。
离线、无脚本和 A4 打印继续使用生产 builder 生成的 HTML，检查精确数据、默认筛选及无网络请求。

## 执行结果

2026-09-08，Node.js `v24.18.0`：

| 验证 | 结果 |
| --- | --- |
| `npm run check` | 通过，421 个测试，零失败、零跳过 |
| `npm run build` | 通过，Host client、portable/static assets 完成构建 |
| `npm run verify:plugin-package` | 通过，200 个打包文件，纯包环境的契约及离线 builder 通过 |
| 特殊图几何回归 | 现有 9 个、新增 2 个测试通过；同时包含在全仓检查内 |
| 最终 `npm run quality` / `npm run typecheck` | 通过，覆盖新增浏览器验收 helper |
| `npm run validate:presentation-interaction` | 通过，生产弹窗、文件服务、离线 HTML 及真实 200% 页面缩放 |
| `npm run validate:presentation-reader:real` | 通过，隔离 DSH 的 live module loader、离线、无脚本及 A4 打印 |
| 相对链接与 `git diff --check` | 通过 |

生产 builder 已生成合成数据示例 `responsive-report.html` 与 `responsive-chart-gallery.html`。
1920px 与 390px 示例截图已人工检查，文字、KPI、筛选、表格和环形图可读；页面无横向溢出。

浏览器为 Chrome `152.0.7977.77`，隔离 Host 使用 React `18.3.1`、`live` module loader。实际证据包括：

- 生产弹窗和 portable 均在五档宽度覆盖全部 18 类图形；1920px 下 reader 分别为约 `1827px` 和 `1920px`，
  2560px 下分别为约 `2442px` 和 `2560px`，不再受旧宽度上限限制。
- 普通图高、特殊图字体与行高稳定；环形图半径、居中位移及窄屏图例横滚通过。直方图不等宽 bin 保留 `1:2:3` 比例，
  瀑布柱宽不超过 `48px`。隐藏特殊图后调整窗口保留最近非零宽度，重新显示时恢复实际容器宽度。
- 连续十次调整窗口保留组合筛选、系列显隐、表格当前页和未保存标题；重开仍恢复作者快照。
  所有组合、prepared views、原始行 identity、来源预览及空结果继续通过，无新增 RPC／网络请求。
- 200% 缩放使用全新临时 Chrome profile 的原生页面缩放设置，保持同一报告 tab：
  `innerWidth/clientWidth` 从 `1440` 变为 `720`，DPR 从 `1` 变为 `2`，`outerWidth` 仍为 `1440`，
  `visualViewport.scale` 仍为 `1`。筛选和系列显隐保持，页面无横向溢出；未使用 CSS zoom 或设备缩放模拟。
- 窄屏长标签完整出现在 tooltip，标签与 tooltip 截图已检查；环形图右侧图例可横滚到达，键盘聚焦显示精确 tooltip。
- 无脚本、离线及 A4 打印读取默认组合与精确表格；Host/portable 数值和来源快照一致，浏览器 `pageerror` 为零。

两次成功运行的原始证据目录分别为 `dsh-global-filters-GEuUmb` 与 `dsh-presentation-s3-reader-LCJllC`
（位于系统临时目录，脚本输出完整路径）。结构化证据、关键截图、打印 PDF 和检查日志另保存在本机
`~/.codex/visualizations/2026/09/08/01a08078-3269-7ff2-9da8-876ea99d2952/responsive-evidence/`，
该目录的上一级包含可直接打开的两份 HTML 示例。

## 验收边界

合成报告用于验证展示行为，不代表重新查询业务数据或 fresh Agent／Marivo 执行。
验收创建独立临时 Workspace、测试服务和浏览器 profile；不修改用户 profile、不重启已有 Harness 服务。
更新插件不会改写历史 HTML，重新下载旧文件也不会替换其中的样式，需重新生成报告。
