# 可改写的完整示例

以下内容都是**演示，不是真实业务结果**。`example-`、`实际` 开头的引用仅演示字段位置，使用时替换为当前 Workspace 中实际取得的精确引用。组件签名见[八组件 Catalog](analysis-catalog.md)，捕获与更新规则见[Lang、捕获与增量更新](analysis-ui.md)。

## 比较与抵消项

在原分析进程中准备并捕获三个 DataFrame：baseline `[100, 80, 20]`、current `[50, 50, 50]`。示例只演示已有数据的展示，不是业务分析流程。

```python
import pandas as pd
from dsh_data_analysis_presentation import capture_dataset

full = pd.DataFrame({"category": ["A", "B", "C"], "baseline": [100, 80, 20], "current": [50, 50, 50]})
full["delta_current_minus_baseline"] = full["current"] - full["baseline"]
# Agent-side Top 2 selection; the captured range is two rows, not the full scope.
selected = (full.assign(decrease_baseline_minus_current=-full["delta_current_minus_baseline"])
            .sort_values("decrease_baseline_minus_current", ascending=False).head(2))
summary = pd.DataFrame({
    "scope": ["all", "selected", "other"],
    "baseline": [200, 180, 20],
    "current": [150, 100, 50],
})
summary["delta_current_minus_baseline"] = summary["current"] - summary["baseline"]
for frame in (full, selected, summary):
    capture_dataset(frame)
```

成功回执按调用顺序返回三个 snapshotRef，分别声明为 `full`、`selected`、`summary`：

```json
{
  "surface": "tab",
  "resources": {
    "full": {"kind": "dataset-snapshot", "snapshotRef": "实际 full 引用"},
    "selected": {"kind": "dataset-snapshot", "snapshotRef": "实际 selected 引用"},
    "summary": {"kind": "dataset-snapshot", "snapshotRef": "实际 summary 引用"}
  },
  "title": "比较示例",
  "program": "root = Stack([lead, kpi, detail]);\nlead = TextContent(\"全量 200 → 150，净变化 -50（-25%）；A、B 减少 80，C 增加 30 抵消。\", \"large\");\nkpi = DatasetView(\"summary\", {chart: \"table\"});\ndetail = Tabs([TabItem(\"selected\", \"Top 2 减少项\", [DatasetView(\"selected\", {chart: \"table\"})]), TabItem(\"full\", \"全量明细\", [DatasetView(\"full\")])]);"
}
```

正文与表格统一 `current - baseline` 方向：全量 200 → 150，净变化 -50（以 baseline 总量 200 为分母，-25%）；两项减少量 80，其他项增加 30，抵消后净减少 50。80 / 50 = 160% 是选中减少量与全量净减少的比值，不能称为覆盖率。示例只证明数值关系，没有原因或联合关系证据。

## 单值与 Frame

metric 必须指向完整的单行结果。下例把原执行中 `capture_frame` 捕获的 Frame 与单行汇总放在同一页：

```json
{
  "resources": {
    "total": {"kind": "dataset-snapshot", "snapshotRef": "实际单行汇总引用"},
    "trend": {"kind": "frame-snapshot", "snapshotRef": "实际 Frame 引用"}
  },
  "program": "root = Card([TextContent(\"本期合计与按日明细\"), DatasetView(\"total\", {chart: \"metric\", encoding: {value: \"current\"}}), AnalysisFrameView(\"trend\")]);"
}
```

展示层不计算总计、达成率或同比；这些值需要在原分析中先算出并捕获。AnalysisFrameView 的比较与分解图只画 Frame 已有的
compare/attribute 输出列，`auto` 已按结构选择默认视图。

## 单行多指标比较

一个 Frame 只有一行、包含多个比较组时，省略 program 就得到一张对比表（指标 × 本期/基期/Δ/Δ%）；
需要中文名称时同时给 `labels`：

```json
{
  "resources": {"result": {"kind": "frame-snapshot", "snapshotRef": "实际比较引用"}},
  "labels": {"result": {"total_charged": "乘客支付总额", "distance": "计价器上报里程"}},
  "title": "5 月 vs 6 月"
}
```

只想看其中一个指标时再声明 `AnalysisFrameView("result", {chart:"comparison", encoding:{value:"total_charged"}})`；
多行、多组也用它定位所属比较组。不要把这类单行结果拆成多张卡，也不要手写全部列。

## Frame 看板

多个比较结果纵向排列时，用 compact 只保留值名和头部数字；需要并排时给 Stack 显式 `row` 与 `wrap`：

```json
{
  "surface": "tab",
  "resources": {
    "gmv": {"kind": "frame-snapshot", "snapshotRef": "实际 GMV 比较引用"},
    "daily": {"kind": "frame-snapshot", "snapshotRef": "实际按日观察引用"},
    "by_region": {"kind": "frame-snapshot", "snapshotRef": "实际地区分解引用"}
  },
  "program": "root = Stack([gmv, trend, bridge], \"row\", \"m\", \"start\", \"start\", true);\ngmv = AnalysisFrameView(\"gmv\", {chart: \"comparison\"}, {density: \"compact\"});\ntrend = AnalysisFrameView(\"daily\");\nbridge = AnalysisFrameView(\"by_region\", {chart: \"decomposition\"});"
}
```

## 文件结果与图片

文件分析得到的 pandas DataFrame 或原生 DuckDB `.df()` 结果同样用 `capture_dataset` 捕获，无需 Marivo datasource 或语义模型；读取指引见 `dsh-data-analysis-files`。正文说明实际文件名、sheet／字段选择及样本或全量范围。

已保存在 Workspace 的 PNG/JPEG/GIF/WebP 可作为说明性图片：

```json
{
  "resources": {"figure": {"kind": "image-file", "path": "exports/amounts.png"}},
  "program": "root = Stack([TextContent(\"按类别金额（由原分析生成的图片）\"), Image(\"按类别金额条形图\", \"figure\")]);"
}
```

图片不是数据视图，不提供数值核对；需要核对的原值同时用 DatasetView 展示。
