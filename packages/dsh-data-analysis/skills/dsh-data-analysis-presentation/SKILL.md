---
name: dsh-data-analysis-presentation
description: 将 Marivo 分析结果或已有 Workspace 数据展示为图表、表格、报告、看板或来源面板，并一次交付可打开的 reader 与离线 HTML。适用于需要可视展示或保存分析快照的请求；普通事实问答使用文字。
---

# Marivo 分析展示

用一份 JSON 草稿组织已有结果，再调用一次 `marivo_present` 完成检查、Web 阅读与离线 HTML。单图、表格、报告和看板使用同一流程。

## 从问题到交付

1. 先确定问题、数据范围和要表达的结论。需要新分析时，按需使用当前 Runtime 挂载的 `marivo-analysis`、`marivo-semantic` 与 `marivo_help` 了解公开能力；通过 `marivo_python` 执行，声明本次精确 datasource names，凭据准备由该调用完成。已有结果可直接展示，无需先激活分析 Skill。此 Skill 只定义展示，不代替 live Help 或 Marivo 的分析、质量与 lineage 契约。
2. 选数据。已有可恢复 Artifact 用 owning `sessionId` + `artifactRef` 引用，分别取实际 `session.id` 和 `artifact.ref`，不要从 Session 名称或日志标题猜测；必要时加 `findingId`，不重复导出同一份数据。需要计算后的 DataFrame 时，在绑定 Runtime 的 Python 中用 `dsh_data_analysis_presentation.write_dataset(frame, path)` 写纯 JSON。computed 的来源只在草稿声明，可为零个或多个 Artifact；不要求转换代码、字段映射、hash 或输入输出证明。来源 Quality/issues 仍属于原 Artifact，不证明 computed 的计算正确。
3. 写草稿前读 [schema 与文件边界](references/schema.md)；报告、看板及比较型展示还必须先读 [叙事与证据检查](references/narrative.md)，按需读 [图形配置](references/charts.md)与[可改写示例](references/examples.md)。逐项对应用户问题，确定各比较的两侧、方向、分母及尚缺分支；核对原值、差值、比例、合计和余项，让正文结论与证据强度一致。用普通文件能力在当前 Workspace 写草稿；草稿与 computed 路径都相对于 Workspace 根目录。来源事实与 unavailable 状态由 builder 读取，不手填。
4. 分析和草稿就绪后调用 `marivo_present({"draft_path":"analysis/presentation.draft.json"})`。成功已同时生成 `presentation.json` 与 `index.html`。失败按诊断的 `code`、`path`、原因和建议修正草稿或数据，再重试；没有成功 receipt 就不宣称交付完成。缺少 Artifact 保存数据时报告缺失，不为完成展示自动重新查询、observe 或 revalidate。修复展示错误也不自动重放分析。
5. 交付主要结论、未完成分支、实质限制和 receipt 的打开/下载入口；headless 时给出 receipt 的精确文件路径。computed 来源不可恢复时如实保留 unavailable；区分 Agent 预筛选与 writer 截断，局部展示不能冒充全量总计或排名。只声明实际做过的浏览器检查。用户仅修改呈现时可在宿主阅读器编辑并保存同一报告，支持 cell 移动、删除（可删空）及撤销。原卡片打开最新保存构建；筛选只是临时展示，不进入保存或下载，也不重算指标。新分析或数据变化仍修改 Draft 并调用 present，生成另一份独立报告；不修改已生成 HTML 来绕过草稿。

## 来源追问

简短来源问题可通过 Marivo 公开 Python API 回答。需要可视来源面板时，使用 `datasets: []` 与 `source` block，无需制造图表或 dataset。需要保留生成脚本时，将成功 `marivo_python` 返回的 `codeRef` 写入相应 dataset 的 `codeRefs`，详见 [生成代码](references/schema.md#生成代码)；Artifact 执行 SQL 自动读取，执行记录与数据集的关联不构成计算正确性证明。打开、下载和来源展开读取生成时保存的快照；用户要求新范围、刷新或进一步分析时回到普通分析流程。
