---
name: dsh-data-analysis-presentation
description: 将已有分析结果保存为右侧阅读器中的交互图表、表格、报告、看板或来源面板，并支持报告更新、HTML 导出与按需发布。普通文字、简短聊天表格及 CSV、PNG 文件交付无需此 Skill。
---

# 分析展示与报告交付

本 Skill 负责把已有结果组织为 JSON Draft，通过 `marivo_present` 保存并打开阅读器。分析方法、业务语义、质量与 lineage 由分析流程和 Marivo Runtime 契约拥有；展示不能补造缺失证据。

## 生成报告

1. 确认展示目标与已有结果。报告语言遵循用户要求，否则根据问题和上下文决定，不跟随系统界面语言。已有结果可直接展示；缺少计算时，文件分析交给 `dsh-data-analysis-files`，Marivo 分析或建模交给对应 Runtime Skill 与 live Help。只补所需分支。
2. 选择数据与来源。可恢复 Artifact 用实际 `session.id` 和 `artifact.ref` 引用，按需加 `findingId`，不重复导出。同一问题需要计算后的 DataFrame 时，通过 `marivo_python` 在绑定 Runtime 使用 `dsh_data_analysis_presentation.write_dataset`；纯本地 pandas／原生 DuckDB 传 `datasources: []`，访问 Marivo datasource 才声明其精确名称。文件结果注明文件名与分析范围，关联实际返回的 `codeRef`，不构造 Marivo Artifact 或 Evidence 身份。
3. 写草稿前读 [schema 与文件边界](references/schema.md)。使用完整 Draft、Workspace 相对路径和实际来源身份；来源事实与 unavailable 状态由 builder 读取。报告、看板及比较型展示还需读 [叙事与证据检查](references/narrative.md)，核对展示中的数值、范围、方向、分母和文字与已有结果一致。需要图表时读 [图形配置](references/charts.md)，需要起步草稿或 writer 用法时读 [可改写示例](references/examples.md)。
4. 用普通文件能力在当前 Workspace 写 Draft。手写 computed JSON 时可按 [静态预检](references/schema.md#草稿静态预检)检查结构，再调用 `marivo_present`。成功 receipt 才表示已保存交付；失败按诊断修正草稿或引用，不为修复展示自动重新查询、observe、revalidate 或重放分析。缺失数据交回原分析流程。
5. 回复主要结论、未完成分支和实质限制，简短说明报告已在右侧 tab 打开；headless 时提供 receipt 的准确路径。保留来源 unavailable、Agent 预筛选与 writer 截断的区别。只声明实际完成的浏览器检查，不把构建成功视为计算或业务结论已验证。

## 按操作读取

- **修改、合并或刷新已有报告**：先读 [报告更新](references/schema.md#报告更新)。基于已读取内容修改完整 Draft，保留用户需要的编辑；成对传入实际 `report_id` 与 `expected_build_id`，保存同一 Report 的新 Build。冲突时读取并核对当前版本，不仅替换 expected ID 重试。
- **筛选与动态指标**：默认不添加全局筛选。需要共同维度交互时，先读 [全局筛选与动态指标](references/interaction.md)，准备所有可选组合所需结果；reader 不重算，缺组合时减少筛选或回到分析流程。
- **来源与生成代码追问**：简短问题可用 Marivo 公开 Python API 回答；需要来源面板时用 `datasets: []` 与 `source` block。脚本关联方式见 [生成代码](references/schema.md#生成代码)，从报告 cell 继续见 [引用恢复](references/schema.md#从报告-cell-引用继续)。已有快照不证明当前数据新鲜度。
- **离线 HTML 文件**：读 [导出与原生交付](references/export-html.md)，使用保存的 Build 导出，再调用原生 `present`。普通报告交付不额外生成 HTML 或附件。
- **对象存储链接**：用户要求发布时读 [发布报告](references/publishing.md)，使用实时可用的 `marivo_publish_report`；成功后返回其确认的 URL。
