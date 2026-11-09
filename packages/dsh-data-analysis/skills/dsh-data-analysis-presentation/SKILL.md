---
name: dsh-data-analysis-presentation
description: 引用已持久化的 DataFrame 或 AnalysisFrame 展示结果，编写或更新自定义报告与看板，随数据就绪增量预览，完成后保存一个正式版本。
---

# 编写自定义报告与看板

从读者的问题出发。报告先给结论，再放能核对结论的比较和明细。看板先放需要持续关注的指标，再用趋势或分组解释变化。将影响解读的范围、分母或缺失项写在对应图表旁。比较和归因的写法见[叙事与证据检查](references/narrative.md)。

用 `AnalysisFrameView` 呈现 Marivo Frame，用 `DatasetView` 呈现 DataFrame。组件引用已有资源名，指标取自快照；可用数据视图表达的图表和指标优先使用对应组件，不用文字模拟图表。已有图片或数据视图不支持的图形仍可用 `Image`，需要核对原值时配数据视图。用 `TextContent` 写解读，用 `Stack`、`Card` 或 `Tabs` 组织阅读顺序。

## 按组件编写工作稿并统一保存

首次引用结果或遇到读取问题时读[引用已持久化的分析结果](references/capture.md)。已有单个快照可直接使用工具默认视图；以下流程用于自定义报告和看板。

1. 在 Harness 中为每个数据驱动的 UI 组件单独准备符合其口径、粒度和字段要求的 DataFrame 或 AnalysisFrame。同一底层数据可供多个组件计算，每个 `DatasetView` 或 `AnalysisFrameView` 必须引用独立的结果快照和资源名。文本、布局和图片组件沿用各自的输入。
2. 使用 Marivo 公开持久化接口：AnalysisFrame 取 `saved.ref.to_dict()`，DataFrame 取 `mv.persist_dataframe(table).to_dict()`，将准确字典分别作为 `analysis-frame` 或 `dataframe` 资源交给工具，由绑定 Python Runtime 读取。已有符合该组件要求的独立快照时直接复用。第一个结果就绪后调用 `marivo_present`，先传 `stage: "preview"`。新建草稿提交以 `root` 为根的完整 OpenUI Lang。编辑已有报告时，首次调用带上当前已保存的 `basedOnRecordId`，提交相对该版本的变更。右侧标签页会显示已校验的草稿。
3. 每个后续组件就绪后再次用 `stage: "preview"`，传上次成功返回的 `draftId` 和 `draftRevision`。`program` 仅提交本次新增或替换的命名语句及相应布局改动，使新组件从 `root` 可达。资源变化时提交仍在使用的完整 `resources` 映射。每次成功都更新同一草稿页，正式版本历史在此期间保持不变。
4. 内容全部完成并核对后，只调用一次 `marivo_present`（`stage: "save"`、最新的 `draftId` 和 `draftRevision`）。成功返回正式 `recordId`，草稿页切换到正式报告，历史新增一个版本。草稿只在当前 Session/Turn 内有效，调用须串行；结束 Turn 前完成保存或说明未保存的阻塞。上下文缺失或冲突时读[草稿与编辑恢复](references/recovery.md)，按实际回执处理，不盲目重试。

## 组织页面与核对表达

数据视图自带结果卡片，默认直接放入布局，不为单个视图再加装饰性外框；`Card` 可用于有意义的内容分组。保留影响解读的范围、分母和缺失信息，不附加仅解释组件类型、数据行列数或实现条件的文字。

选择图形和字段时查[视图选择与页面布局](references/analysis-ui.md)，编写 OpenUI Lang 时查[组件签名](references/analysis-catalog.md)。[页面示例](references/examples.md)包含比较报告、指标卡和多视图看板。
