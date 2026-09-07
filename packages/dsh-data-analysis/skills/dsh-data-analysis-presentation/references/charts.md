# 图形配置与数值表达

所有图形共享 `datasetId`、`chart`、`x`、`y`、`numericMode`。字段绑定使用列 ID，名称和单位来自 dataset；图前说明用 markdown。reader 保留输入行顺序，统计计算先在分析阶段完成。

## 图形选择与字段

| chart | x / y | bindings 与数据要求 |
| --- | --- | --- |
| `line`、`area` | 有序 x，多列 y | 无；固定 monotone |
| `stackedArea` | 有序 x，同单位多列 y | 无；先对齐系列，不补零 |
| `sparkline` | 有序 x，单列 y | 无；紧凑趋势 |
| `bar`、`horizontalBar` | 类别 x，单列或多列 y | 无；单系列或并列比较 |
| `stackedBar`、`horizontalStackedBar` | 类别 x，同单位多列 y | 无；普通堆叠 |
| `stackedBar100`、`horizontalStackedBar100` | 类别 x，预计算比例 y | `denominator`：分母列；比例为 0–1 |
| `histogram` | 区间标签 x，频数 y（单列） | `binStart`、`binEnd`：已排序、不重叠的区间边界 |
| `boxPlot` | 分组 x，中位数 y（单列） | `minimum`、`q1`、`q3`、`maximum`：五数摘要 |
| `scatter` | 数值 x，数值 y（单列） | 可选 `size`、`label`、`color`：点大小、标签、分类字段 |
| `heatmap` | 行类别 x，矩阵各列 y | 无；每行是已准备矩阵行 |
| `pie` | 切片标签 x，原值 y（单列） | `share`：预计算占比；默认环形 |
| `leaderboard` | 类别 x，数值 y（单列） | `rank`：预计算排名；先确定排序和 Top N |
| `funnel` | 有序阶段 x，原值 y（单列） | `share`：相对于明确首阶段分母的预计算占比 |
| `waterfall` | 有序步骤 x，变化量／锚点值 y（单列） | `start`、`end`：已有坐标；`role` 列取 start、delta、subtotal、total |

`bindings` 的值都是同一 dataset 的列 ID，不是数值或公式。例如箱线图：

```json
{"id":"distribution","kind":"chart","datasetId":"summary","chart":"boxPlot","x":"group","y":["median"],"numericMode":"exact","bindings":{"minimum":"min","q1":"p25","q3":"p75","maximum":"max"}}
```

堆叠系列与 heatmap 必须同单位；普通多系列图的不同单位分图展示。没有双轴或单位推断。100% 堆叠的分母为零／null 时比例也必须 null。pie/funnel 仅绑定预计算 share，作者须说明分母；share 范围为 [0,1]，pie 完整快照的已知 share 总和不超过 1，允许不足 1。null share 不绘制切片；share 已知但原值缺失时保留该角度空位。瀑布 delta 步的 end - start 必须等于 y；锚点从零绘制，不重新累计。reader 不把缺失值补为零，不修正不合法统计量。

## 受限选项

`options` 只接受以下声明，各类型仅接受适用选项：

- `showPoints: "auto" | "always" | "never"`：趋势图数据点，默认 auto 保留孤立观测。
- `series`：以 y 列 ID 为 key，值可有 `lineStyle: "solid" | "dashed" | "dotted"` 与 `role: "actual" | "baseline" | "target" | "forecast" | "plan" | "comparison"`。计划／目标／基线／预测默认为中性虚线，显式线型优先。
- `valueLabels: "none" | "auto" | "all"`：数值标签；原值始终保留在 tooltip。
- `referenceLines: [{"axis":"y","value":20,"label":"参考值"}]`：数值轴参考线。axis 是物理轴；横向柱形和箱线图的数值轴为 x。pie、funnel、heatmap、sparkline 不提供参考线。普通多系列图若含不同单位，该系列数值轴不接受参考线，须为各单位分别声明图表或已准备视图；scatter、histogram 的两个独立数值轴可各自设置参考线。

不写 linear/step、任意配置、前端 aggregate 或时间分粒度。

## 探索与已准备视图

chart 可有 `preparedViews`：每项包含唯一 `id`、说明性 `label` 和完整 `datasetId`、`chart`、`x`、`y`、`numericMode` 及适用 bindings/options。它不包含 kind，不嵌套 preparedViews；dataset 必须已在草稿声明。

普通图形可以选择当前数值列和适用类型。需要另一组分箱、分位数、分母或累计值时，先准备 dataset，再声明视图。reader 不按列名猜统计角色，不能使用的类型显示缺少的数据。

cell 菜单“探索图表”提供图形、字段、系列、方向／模式、线型、分类过滤和恢复原图。过滤与显隐只改变当前可见内容，原始排名、占比和分母保持不变。来源预览和复制上下文跟随当前视图；下载和打印使用原始快照。重新打开恢复作者配置，不保存探索状态。

## 精度与叙事

`exact` 适用于 float64 和 JS 安全整数范围内的 int64。decimal 或较大 int64 只用表格，或显式 `approximate` 绘图；所有数值坐标必须有限。tooltip、来源预览和静态表格保留原始精确文本。null 是缺失，不是 0；空数据展示空状态。

比较图先读[叙事与证据检查](narrative.md)，核对字段、方向、单位、分母、范围与正文一致。Top N 保留选取范围与其他项贡献；截断数据不代表全量，绘制成功不证明计算或因果结论成立。完整示例见[图形样例](chart-examples.md)。
