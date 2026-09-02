---
name: dsh-data-analysis-report
description: Create or revise a Workspace HTML analysis report. Use for requested HTML/web output or when an analysis needs multiple charts, tables, or a long multi-section presentation.
---

# DSH data-analysis report

本 Skill 只提供报告原则、数据读取接线与 Marivo 专属组件。页面、图表、样式、交互和通用检查由 Agent 使用普通文件、代码与浏览器能力完成；插件不提供模板、chart helper、可视化 DSL、HTML Checker、通用 renderer 或 publisher。

## 分析事实与 Marivo 投影

### 取得报告数据

先加载 `marivo-analysis`，按实时 Help 使用当前 Runtime。已有分析应恢复精确 persisted Artifacts；仅在当前有效性会影响结论时执行 identity-matched revalidation。不得只为生成页面或 DAG 重新执行 `observe`。

| 输入 | Python 发射入口 | 语义边界 |
| --- | --- | --- |
| Marivo `BaseFrame` Artifact | `emit_dataset(artifact, target, revalidation=...)` | 保留 Artifact、Evidence、quality、lineage 与 revalidation 投影。 |
| pandas `DataFrame` 计算结果 | `emit_computed(frame, target)` | 仅表示 computed snapshot，不声明 Artifact、Evidence、lineage、freshness 或 revalidation。 |

两个 emitter 都生成由 `ReportData` 注册的数据文件。不要把 DataFrame 传给 `emit_dataset`，不要手写 `ReportData.register(...)` payload，也不要从浏览器 validator 反推 schema。浏览器通过 `ReportData.get(...)` 读取快照，或通过 `ReportData.records(...)` 取得行对象；图表库和 DOM/SVG/Canvas 实现仍由 Agent 自主选择。

每个可见 KPI、图表和表格都要映射到一个已注册 dataset。Artifact 映射在轻量来源说明或审计区体现；computed 映射保留必要的输入与转换说明。机器 identity 不进入主叙事。

### 添加 Marivo 组件

- `MarivoArtifact.render(container, dataset_id)` 展示面向读者的 Artifact 摘要：正常状态仅含类型、semantic shape、行数和结果生成时间；仅在截断、Evidence 不完整、revalidation 异常、质量检查或 issues 会改变判断时追加提示。它不是 metadata inspector，不展示机器 identity、hash、Job、Finding 数量或完整 lineage。
- 对每个实质支撑报告内容的 Marivo Session，分别用公开 `session.graph(...)` 取得聚焦 `SessionGraph`，再调用 `emit_session_trace(graph, target, report_artifact_refs=[...])`。`report_artifact_refs` 只列该 Graph 内实际支撑可见内容的本地 Artifacts；不得跨 Session 合并、读取私有 Store 或补造事实。
- DAG 中需要预览的本地 Frame，必须从所属精确 Session 恢复并 `emit_dataset(...)`。浏览器按 `session_id + artifact_ref` 关联；缺少快照时明确显示未注册。Artifact 详情复用 `MarivoArtifact`，Frame 节点只显示 family 与行数。
- Graph 超出 emitter 限制时，为同一 Session 输出多个具有唯一 `trace_id` 的聚焦 Graph。`ReportTrace.renderSessionGraphs(...)` 单次最多接收 20 个 trace；超出时分批渲染，不得静默遗漏实际使用的 Session。

### 装配浏览器资源

按需复制 `assets/report-data.js`、`assets/marivo-artifact.js`、`assets/marivo-session-dag.js`。经典脚本顺序固定为：`report-data.js` → dataset snapshots → Marivo components → trace snapshots → Agent 自有 chart/runtime/app。使用 DAG 时必须同时加载 Artifact component，最后调用 `ReportTrace.renderSessionGraphs(container[, trace_ids])`。页面内 `dataset_id` 与 `trace_id` 必须唯一。

## 内容组织

- 先明确受众、决策问题、范围和约束。开头直接给答案和最重要证据，正文解释驱动因素，结尾只保留影响行动的限制与后续步骤。
- 明确区分观测事实、Agent 推断和建议；因果与置信措辞必须匹配证据。不要用固定 KPI、摘要、方法或附录章节填充内容。
- 每张图只回答一个问题并在附近解释；详细表格、方法和 DAG 放在可展开或靠后的区域。
- 对范围、口径、单位、时间边界、freshness、coverage、null、截断、revalidation、失败检查和不确定性，只披露会改变解读或行动的部分。

## 布局与样式

- 建立清晰标题层级和阅读顺序；宽屏可分栏，窄屏回到单列。关键结论不能只靠颜色、位置、hover 或动画表达。
- 优先使用语义化结构、可读字号、充足行距、稳定留白和高对比度。颜色用于编码而非装饰；同一含义保持一致，并提供文字、图例或形状冗余。
- 图表必须有标题、单位、时间范围、刻度与数据缺失说明；表格提供明确表头和适合内容的对齐。避免 3D、双轴、过密标签和无解释的视觉噪声。
- 所有图表坐标轴在各目标宽度下都不得出现刻度标签彼此重叠、被裁切、侵入绘图区，或与轴标题、图例等元素重叠。按轴类型、标签长度与可用空间选择合适的格式、刻度密度、换行、方向、边距和图表尺寸；空间不足时不要强行显示每个刻度。只有保持可读时才旋转标签，完整标签与数值保留在数据表、可访问文本或按需提示中。
- 交互只在能降低认知负担时加入；核心结论、关键数值与限制在 JavaScript 失败时仍应可读。打印或导出场景不得截断关键内容。

## 生成与检查

1. 新报告使用新的 Workspace 目录；修订使用用户指定或已确认的现有目录，只有需要隔离构建时才另建 staging 目录。所有资源置于目录内并使用相对路径；先写数据与资源，最后写 `index.html`。
2. 自查内容：问题是否被直接回答；数字、单位、口径和时间是否一致；事实、推断和建议是否混淆；重要限制、截断和未知项是否可见。
3. 自查页面：资源能否离线解析；外部输入是否安全转义；是否意外包含 credential、环境值、私有路径或其他敏感查询内容；窄屏、键盘、无脚本、打印和空/错误状态是否可用。
4. 有浏览器能力时打开精确入口，在报告默认宽度和窄屏宽度检查控制台、布局、交互和可访问性；逐图确认每条坐标轴的刻度标签无碰撞。DOM/SVG 图表优先用 `getBoundingClientRect()`、`getBBox()` 或等效布局信息检查标签边界，Canvas 或第三方图表使用其布局信息或截图检查。发现重叠、裁切或小到不可读必须调整格式、刻度密度、换行、方向、边距或图表尺寸后复查；没有浏览器能力时明确说明未执行视觉检查。任何必需检查失败都必须把报告标为未完成，不得用路径存在冒充 ready。
5. Native/both 模式以顶层文件 Tool 对 `index.html` 的写入或编辑作为 bundle 最后一次 mutation；随后若任何资源变化，再完成一次入口 mutation。最终回答用 Markdown 行内代码交付文件 Tool 返回的精确路径。Produced Files 与 Host opening 只是导航，不代表发布、不可变、可恢复或验证通过。
