---
name: dsh-data-analysis-presentation
description: 编写或调整自定义分析报告和看板，用 OpenUI Lang 将已有分析结果、结论和限制组织成页面。
---

# 编写自定义报告与看板

从读者的问题出发。报告先给结论，再放能核对结论的比较和明细。看板先放需要持续关注的指标，再用趋势或分组解释变化。将影响解读的范围、分母或缺失项写在对应图表旁。比较和归因的写法见[叙事与证据检查](references/narrative.md)。

用 `AnalysisFrameView` 呈现 Marivo Frame，用 `DatasetView` 呈现 DataFrame。组件引用已有资源名，指标取自快照；可用数据视图表达的图表和指标优先使用对应组件，不用文字模拟图表。已有图片或数据视图不支持的图形仍可用 `Image`，需要核对原值时配数据视图。用 `TextContent` 写解读，用 `Stack`、`Card` 或 `Tabs` 组织阅读顺序。

数据视图自带结果卡片，默认直接放入布局，不为单个视图再加装饰性外框；`Card` 可用于有意义的内容分组。保留影响解读的范围、分母和缺失信息，不附加仅解释组件类型、数据行列数或实现条件的文字。

选择图形和字段时查[视图选择与页面布局](references/analysis-ui.md)，编写 OpenUI Lang 时查[组件签名](references/analysis-catalog.md)。[页面示例](references/examples.md)包含比较报告、指标卡和多视图看板。
