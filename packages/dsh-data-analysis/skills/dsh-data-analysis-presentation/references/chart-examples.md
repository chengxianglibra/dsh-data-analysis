# 全部图形的可运行样例

全部数据为合成演示，不是真实业务结论。在当前 Workspace 运行 [write-charts.py](examples/write-charts.py)，使用已有 bound Runtime 和 presentation writer，再将[完整草稿](examples/charts.draft.json)写入 Workspace 并调用 marivo_present。

示例包含 18 个类型、bar/line 变体、数据点、参考线和精确小数。line 的 preparedViews 可以切换为已准备的散点、分箱、比例、箱线和瀑布数据；不在浏览器计算统计量。

| 数据文件 | 内容 |
| --- | --- |
| [charts-series.dataset.json](examples/charts-series.dataset.json) | 12 个有序时点、两列指标、散点坐标、大小和分类 |
| [charts-shares.dataset.json](examples/charts-shares.dataset.json) | 两列占比及分母 |
| [charts-bins.dataset.json](examples/charts-bins.dataset.json) | 明确区间边界与频数 |
| [charts-boxes.dataset.json](examples/charts-boxes.dataset.json) | 已计算五数摘要 |
| [charts-composition.dataset.json](examples/charts-composition.dataset.json) | 原值、占比和排名 |
| [charts-funnel.dataset.json](examples/charts-funnel.dataset.json) | 有序阶段、原值和首阶段占比 |
| [charts-waterfall.dataset.json](examples/charts-waterfall.dataset.json) | 步骤角色、变化量与累计坐标 |
| [charts-precision.dataset.json](examples/charts-precision.dataset.json) | 精确 decimal 与 null，显式近似绘图 |

Python 示例演示分析阶段的数据准备。真实任务先核实粒度、范围、分母和来源，再填写可恢复 Artifact 引用。computed 路径相对于 Workspace 根目录。
