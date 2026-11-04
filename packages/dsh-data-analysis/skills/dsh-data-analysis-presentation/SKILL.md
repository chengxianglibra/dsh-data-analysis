---
name: dsh-data-analysis-presentation
description: 编写或调整自定义分析报告和看板，用 OpenUI Lang 将已有分析结果、结论和限制组织成页面。
---

# 编写自定义报告与看板

从读者的问题出发。报告先给结论，再放能核对结论的比较和明细。看板先放需要持续关注的指标，再用趋势或分组解释变化。将影响解读的范围、分母或缺失项写在对应图表旁。比较和归因的写法见[叙事与证据检查](references/narrative.md)。

用 `AnalysisFrameView` 呈现 Marivo Frame，用 `DatasetView` 呈现 DataFrame。组件引用已有资源名，指标取自快照。用 `TextContent` 写解读，用 `Stack`、`Card` 或 `Tabs` 组织阅读顺序。

选择图形和字段时查[视图选择与页面布局](references/analysis-ui.md)，编写 OpenUI Lang 时查[组件签名](references/analysis-catalog.md)。[页面示例](references/examples.md)包含比较报告、指标卡和多视图看板。
