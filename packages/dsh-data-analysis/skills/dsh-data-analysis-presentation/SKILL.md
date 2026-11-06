---
name: dsh-data-analysis-presentation
description: 为每个数据视图准备独立的 DataFrame 或 AnalysisFrame，随数据就绪用 OpenUI Lang 增量编写或更新自定义报告和看板。
---

# 编写自定义报告与看板

从读者的问题出发。报告先给结论，再放能核对结论的比较和明细。看板先放需要持续关注的指标，再用趋势或分组解释变化。将影响解读的范围、分母或缺失项写在对应图表旁。比较和归因的写法见[叙事与证据检查](references/narrative.md)。

用 `AnalysisFrameView` 呈现 Marivo Frame，用 `DatasetView` 呈现 DataFrame。组件引用已有资源名，指标取自快照；可用数据视图表达的图表和指标优先使用对应组件，不用文字模拟图表。已有图片或数据视图不支持的图形仍可用 `Image`，需要核对原值时配数据视图。用 `TextContent` 写解读，用 `Stack`、`Card` 或 `Tabs` 组织阅读顺序。

## 按组件准备数据并增量保存

1. 在 Harness 中为每个数据驱动的 UI 组件单独准备符合其口径、粒度和字段要求的 DataFrame 或 AnalysisFrame。同一底层数据可供多个组件计算，每个 `DatasetView` 或 `AnalysisFrameView` 必须引用独立的结果快照和资源名。文本、布局和图片组件沿用各自的输入。
2. 在 `marivo_python` 的原计算中使用 `capture_dataset` 或 `capture_frame` 捕获各组件结果。已有符合该组件要求的独立快照时直接复用。取得第一个可展示的 `snapshotRef` 后，用 `marivo_present`（`surface: "tab"`）保存首版，提交从 `root` 开始的完整 OpenUI Lang。编辑已有页面时以当前版本为起点。
3. 每个后续组件的快照就绪后立即增量保存同一报告或看板。每次调用继续使用 `surface: "tab"`，将上一次成功返回的 `recordId` 作为 `basedOnRecordId`，在 `program` 中提交新增或替换的命名语句及使组件从 `root` 可达的布局改动。新增或替换资源时传入完整 `resources` 映射，包含仍在用的已有资源和本次就绪的资源。每次保存成功后用新的 `recordId` 继续，避免等待全部数据就绪才首次交付。

## 组织页面与核对表达

数据视图自带结果卡片，默认直接放入布局，不为单个视图再加装饰性外框；`Card` 可用于有意义的内容分组。保留影响解读的范围、分母和缺失信息，不附加仅解释组件类型、数据行列数或实现条件的文字。

选择图形和字段时查[视图选择与页面布局](references/analysis-ui.md)，编写 OpenUI Lang 时查[组件签名](references/analysis-catalog.md)。[页面示例](references/examples.md)包含比较报告、指标卡和多视图看板。
