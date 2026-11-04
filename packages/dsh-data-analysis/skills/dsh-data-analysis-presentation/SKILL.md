---
name: dsh-data-analysis-presentation
description: 将已捕获的 Frame 或 DataFrame 快照组织为分析 UI、报告或看板；自定义时使用八组件 OpenUI Lang。单个结果可直接 marivo_present。
---

# 分析展示与报告交付

本 Skill 负责用 `marivo_present` 保存已有结果的不可变快照，默认在会话级 Chat 节点展示，明确要求的报告/dashboard 使用右侧 tab。分析方法、业务语义、质量与 lineage 由分析流程和 Marivo Runtime 契约拥有；展示不能补造缺失证据。

分析报告/dashboard 统一通过 `marivo_present` 创建和更新，将结论、支撑数据及影响解读的限制放在同一份文档中；有依据的下一步建议可随结论给出。
Frame 数据优先使用 `AnalysisFrameView`，用 `TextContent` 及布局组件组织说明。成功交付后，最终文字尽量只写一句总结，
不重复报告正文；用户明确指定输出格式时遵循要求，展示失败则说明实际状态并用已有证据回答。

## 引用呈现与自定义页面

单个结果直接传准确引用，省略 program；默认表格支持精确排序和本地分页。不用先查目录或读取 UI。Frame 使用原 `marivo_python` 执行中
`capture_frame(frame)` 返回的 `frame-snapshot`；在成功回执的 `snapshots` 中按 `kind` 找到对应的 `snapshotRef`：

```json
{"resources":{"result":{"kind":"frame-snapshot","snapshotRef":"成功回执中的 Frame snapshotRef"}}}
```

DataFrame 使用成功 `marivo_python` 回执中 `kind:"dataset"` 对应的 `snapshotRef`：
`{"resources":{"result":{"kind":"dataset-snapshot","snapshotRef":"实际引用"}}}`。
尚未捕获的 DataFrame 需要在原分析进程调用 `capture_dataset(frame)`；该 helper 只接受 pandas DataFrame，
不从 SQL/文件推断来源，也不修复已有精度损失。不要为呈现重新执行已经结束的分析。

自定义页面时按需读[八组件紧凑签名](references/analysis-catalog.md)，提交完整 OpenUI Lang program，
例如 `root = Stack([TextContent("结论与分析范围"), AnalysisFrameView("result")]);`。
`DatasetView` 支持 auto/table/metric 以及显式列映射的 line/area/bar/heatmap：趋势与柱图用 `{axis, values, series?}`，热力图用 `{x, y, value}`。图表要求完整快照、数值列及唯一坐标，按保存行首次出现顺序展示，不聚合、不定义分析语义。Frame v2 的 `AnalysisFrameView` 按结构自动选择观察、成员、
比较、分解、对齐、相关或份额视图；需要指定图形时支持 auto、table、metric、line、area、bar、pie、heatmap、comparison 和
decomposition。字段映射和 display 选项见[八组件紧凑签名](references/analysis-catalog.md)；展示只画快照中已有数据，
不聚合、不计算指标，也不提供全局筛选或动态指标。
rows 不写入 program。图片资源为 `{"kind":"image-file","path":"workspace-relative.png"}`，
`Image("说明", "资源名")` 只使用保存的 PNG/JPEG/GIF/WebP，不接任意 URL。
报告语言使用 locale；按需求选择 `surface:"tool"`（默认）或 `surface:"tab"`。

成功 receipt 中的 recordId 指向不可变版本。只有确实缺少基版本定义时才调用 `marivo_ui_read({recordId})`；
不要成功后默认回读。读取失败不伪造成功回执，缺失数据交回原分析流程。

自定义、capture 或修改页面时读[Lang、捕获与更新示例](references/analysis-ui.md)。
更新传准确 `basedOnRecordId` 和变化语句，每行一条；省略 resources 继承快照，提供则替换完整资源表。
只改标题时传基版本和新标题，省略 program 与 resources。未变化数据不重读，不重发整页，不强制大纲、分步提交或成功后回读。Native 预览来自真实参数前缀；
PTC 只按实际 dispatch 粒度展示。参数建议按 surface、basedOnRecordId、resources、title、program 排列；
字段晚到可能只在保存后显示，不能为制造流式效果追加无意义调用。

## 叙事与交付边界

报告、看板及比较型展示先读[叙事与证据检查](references/narrative.md)；需要可改写的页面起点时读[完整示例](references/examples.md)。

- 分析 UI 不提供离线 HTML 导出、对象存储发布或页面内编辑；用户要求时如实说明不可用，不改用其他格式补造。
  用户要求实际文件时，CSV、PNG 等按 `dsh-data-analysis-files` 的文件交付流程生成并原生交付。
- 来源或生成代码追问用 Marivo 公开 Python API 与原执行记录回答；已有快照不证明当前数据新鲜度。
- 旧格式报告不再受支持，打开时显示不支持；需要相同内容时从实际结果重新 present 新格式。
