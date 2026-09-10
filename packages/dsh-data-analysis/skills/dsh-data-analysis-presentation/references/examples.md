# 可改写的完整示例

这些文件都是**演示内容，不是真实业务结果**。先按任务修改，再用普通文件能力写入当前 Workspace；不要在 Skill 安装目录生成分析产物。带 `example-` 的 Session/Artifact 引用仅演示字段位置，使用时替换为当前 Workspace 中实际取得的精确引用。

## 已有 Artifact

读取 [artifact.draft.json](examples/artifact.draft.json)，替换来源引用、列名和范围。草稿直接选择 Artifact 保存数据，不需要先调用 Python helper。示例使用 table，适用于尚未确认数值列是否适合绘图的已有结果。

## computed 数据

使用 [write-computed.py](examples/write-computed.py) 了解 helper 的完整用法。通过 `marivo_python` 在绑定 Runtime 执行改写后的代码；示例本身只有演示数据，可用 `datasources: []`。代码把文件写入 Workspace 的 `presentation-example/computed.dataset.json`，与 [computed.draft.json](examples/computed.draft.json) 中的路径一致。父目录由 Python 示例创建。已有 computed 文件可直接使用，无需重新计算。

[computed.dataset.json](examples/computed.dataset.json) 是该示例的实际 typed JSON 输出，含精确金额、整数和 null；[computed.draft.json](examples/computed.draft.json) 同时展示单值、趋势、分组、原值表格，未声明来源。需要声明多个 Artifact 来源时参考 [computed-sources.draft.json](examples/computed-sources.draft.json)，只增加声明与关联，不提交转换信息。无法恢复的声明来源由 present 标记 unavailable，不删除声明来隐藏缺失。

将选定草稿写成 `analysis/presentation.draft.json` 后调用：

```json
{"draft_path":"analysis/presentation.draft.json"}
```

一个成功的 `marivo_present` 已完成 reader 构建；离线 HTML 在用户下载时生成；根据 receipt 交付，不能把示例数据解释成用户的真实业务结论。

## 比较与抵消项

[write-comparison.py](examples/write-comparison.py) 使用完整演示数据：baseline `[100, 80, 20]`、current `[50, 50, 50]`。它仅演示已有数据的展示，不是业务分析流程。可用 `datasources: []` 运行；写出路径与[比较草稿](examples/comparison.draft.json)一致。

完整[明细](examples/comparison.dataset.json)保留三项原值与 `current - baseline` 的差值 `[-50, -30, +30]`；[Top 2 数据](examples/comparison-selected.dataset.json)按减少量降序预选 A、B，writer 收到两行，因此 `rowCount: 2` 且 `truncated: false`。[汇总](examples/comparison-summary.dataset.json)保留全量、选中项、其他项的两侧原值与净差。

草稿的正文、图和表统一变化方向：全量 200 → 150，净变化 -50（以 baseline 总量 200 为分母，-25%）；两项减少量 80，其他项增加 30，抵消后净减少 50。80 / 50 = 160% 是选中减少量与全量净减少的比值，不能称为覆盖率。示例只证明数值关系，没有原因或联合关系证据。

## 仅展示来源

[全部图形样例](chart-examples.md)另提供 18 类图形、bar/line 变体、预计算数据和探索配置。

[source-only.draft.json](examples/source-only.draft.json) 的 datasets 为空，直接用 source block。替换精确引用后提交即可；无须生成 computed 文件、图或虚构单值。

## 可选全局筛选与动态 KPI

既有 computed 示例不声明筛选，可直接作为固定报告。需要交互时，参考[全局筛选契约](interaction.md)与[双筛选草稿](examples/interaction.draft.json)。
[生成脚本](examples/write-interaction.py)使用合成测试数据，在 Python 中准备日期 × 集群的九个组合，每个维度均含“全部”。
脚本生成[指标数据](examples/interaction-summary.dataset.json)和[类别数据](examples/interaction-detail.dataset.json)，路径与草稿一致。
完整范围为 550 次查询、15 次失败；周一甲集群为 150 次查询、3 次失败、2.00% 失败率。区域外指标始终为 550，区域内三个 KPI、图表及表格一起切换。
