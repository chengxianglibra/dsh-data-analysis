# 全部图形与页面探索验收记录

## 实现范围

2026-09-07 按 Data Analytics 0.2.10 的 18 个 canonical chart type 补齐共享 reader。
类型、字段与预计算要求见[图形配置](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/charts.md)，
实现边界见[reader 架构](../modules/presentation-reader.md)。

- 趋势：line、area、stackedArea、sparkline；monotone，单／多系列，实／虚／点线，数据点与显式角色样式。
- 柱形：纵／横 × 并列／堆叠／100% 堆叠；单系列自然形成单系列柱图。
- 统计与关系：histogram、boxPlot、scatter、heatmap；composition/process：pie、leaderboard、funnel、waterfall。
- presentation v1 的 chart 判别联合及受限 options；旧 line/bar 草稿仍有效。TypedDataset、Python writer 和 marivo_present 调用不变。
- cell 独立页面状态统一保存类型、字段、过滤和显隐；preparedViews 只选择已保存数据。重置／切换 build／关闭重开恢复作者配置。
- 所有统计量由分析阶段提供。保留 null、重复观测、精确字符串、作者行顺序与比例分母，不前端聚合、排名、归一化或重新累计。
- 来源预览与复制使用当前绑定并保留原始来源／build identity；下载、打印、无脚本阅读使用原始快照。

## 可重复样例与测试

[完整样例](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/chart-examples.md)
包括 8 份 typed dataset、21 个 chart block，以及使用公开 writer 的可运行 Python 数据准备脚本。
相同文件用于 Skill 契约测试、renderer 回归和真实浏览器 gallery，不维护另一份统计结果。

```sh
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-reader:real
npm run validate:presentation-integration:real
git diff --check
```

本轮以上检查全部通过。最后一轮 reader 额外通过 `--agent-document /path/presentation.json`
重读真实 Agent 的保存文档，保留其原始 identity 和来源，不重放分析。

| 证据 | 结果与本机临时目录 |
| --- | --- |
| 完整 check、build、package verify、diff | 通过；分发校验含 contracts、writer kit、离线 builder |
| 最终生产 reader | `dsh-presentation-s3-reader-XLcf03/reader-evidence.json`；6 份文档、Host/portable/静态/打印均通过，无页面错误 |
| 实际 Tool／下载链路 | `dsh-presentation-s4-real-Uhu4Uj/integration-evidence.json`；4 份报告，gallery 探索后下载及恢复通过 |
| 真实 Agent | `dsh-presentation-s5-agent-NoyyAY/complex-charts/agent-evidence.json`；自动数值和 receipt 校验通过，后续独立语义审阅通过 |

最终 reader 的生产 client SHA-256 为 `a9ab7adb5033aef8e7e65e85e058b87a37430ce59a5ce48abb4ba54417a9fca3`。
重读 Agent 文档 SHA-256 为 `a8142b69caa6e52fd1f387972ae93bc721f4be56e7fa202acdc4b17e9d23f30d`。
临时证据保留在本机；可重复入口及样例在仓库，证据文件不纳入分发包。

契约与模型覆盖有效／无效绑定、编译期统计 bindings、空数据、null、重复标签、负数、混合单位、decimal/int64、
分箱／五数／比例／排名／瀑布结构、类型适用性、引用字段收集、状态隔离、来源与复制。
几何回归覆盖不等宽区间、完整箱线、百分比固定高度、环形固定角度、缺失点、极端有限坐标及瀑布锚点连接。
不同单位的普通系列数值轴拒绝无单位归属的参考线；更换字段移除原字段参考线。

## 真实 reader 与交付证据

真实 reader 验证使用生产 client，由实际 DSH Web module loader 加载 Host React；portable 使用生产 builder 生成的 file:// HTML。
检查 18 类实际 SVG、全部柱形类型、线型／数据点、字段选择、preparedViews、过滤、显隐、重置、精确预览和复制。
Host 与 portable 均检查探索期间网络请求为空、原始打印表格不变及重开恢复。
375px 深色、键盘、无脚本、断网、打印 PDF 和原始嵌入文档另行验证。

窄屏尺寸等待 ResizeObserver 发布新宽度后再检查；不以等待固定时长掩盖布局错误。
原生 disabled option 检查其 DOM disabled 属性；几何尺寸允许小于 0.01px 的浏览器浮点差异。

S4 使用独立 profile 和 Workspace，真实 Tool／receipt／RPC／下载链路额外覆盖同一完整 gallery：
探索后关闭 reader，下载字节与原始 HTML 逐字节及 receipt SHA-256 一致；重开恢复作者图形、字段、过滤和显隐。
原有 Workspace、digest、取消与重连边界不放宽。

## 真实 Agent 复杂图表旅程

```sh
DSH_DATA_ANALYSIS_PYTHON=/absolute/verified/marivo/bin/python \
DSH_DATA_ANALYSIS_VALIDATION_JOURNEYS=complex-charts \
npm run validate:presentation-agent:real
```

本轮使用 deepseek-v4-pro/high、Marivo 0.5.4、packed plugin 和原生 Harness 工具。
Agent 实际读取 3 日期 × 3 区域的 9 个观测，生成 7 份 computed dataset、17 个 block，包含 line、stackedBar100、boxPlot、histogram、waterfall 和 preparedViews。
自动数值／receipt 校验通过后，另行阅读实际正文与执行记录完成语义审阅：

- 分母 70、200、150；瀑布 200 → 150，区域变化 −50、−30、+30。
- 五数 North [40,45,50,75,100]、South [20,35,50,65,80]、West [10,15,20,35,50]。
- 直方图区间边界 [0,25,50,75,101]、频数 [3,1,3,2]，合计 9。
- 全部 computed 数据关联真实 Artifact；两次成功 observe 声明 warehouse，Runtime 记录对应 Session.close 返回。
- 实际正文说明离散日期、每区域仅 3 个样本、缺失不是零，以及不能外推总体或因果。

原始 Agent 证据目录为 `dsh-presentation-s5-agent-NoyyAY`，自动状态保留为 `passed-awaiting-semantic-review`；
本节记录后续独立语义审阅，不改写自动证据或 Agent 产物。

## 限制与非目标

同工作区并行的来源代码工作把 Python 执行快照改为 Host profile 所有。
早前 Agent 草稿在新 profile 重放时，旧 codeRefs 被严格拒绝；本次不迁移执行记录、不删除引用、不放宽来源校验。
因此分别记录真实 Agent 生成、最终 reader 读取该保存文档、以及新隔离 gallery 的完整 S4 下载验收；不宣称该旧草稿跨 profile 重放成功。

统计 SVG 在窄屏中可内部横向滚动；静态／打印图形仍为精确表格，不宣称静态 SVG。
没有发布、重装、用户 profile 重置或重启已有服务；测试只启动独立临时验证服务。
