# 自定义页面示例

以下 OpenUI Lang 使用示例资源名。编写实际页面时，用本次分析的资源名、列 ID 和结论替换。Native 和 Code Mode 都直接使用 preview 结果的 `draftId/draftRevision` 继续，使用 save 结果的 `recordId` 标识正式版本；不从 `deliveryJson` 拼装身份。

## 比较与抵消项

以下是示例的全量明细。

| 类别 | 基期 | 本期 |
| --- | ---: | ---: |
| A | 100 | 50 |
| B | 80 | 50 |
| C | 20 | 50 |

`summary` 汇总全量、减少最多的两项及其余项，`selected` 和 `full` 分别是这两项与全量的 DataFrame 明细。

```openui
root = Stack([lead, DatasetView("summary"), detail]);
lead = TextContent("全量从 200 降至 150，净减少 50（25%）。A、B 合计减少 80，C 增加 30，抵消了部分降幅。", "large");
detail = Tabs([TabItem("selected", "减少最多的两项", [DatasetView("selected")]), TabItem("full", "全量明细", [DatasetView("full")])]);
```

变化率以基期总量 200 为分母。两项减少量与全量净减少之比是 160%，将其标为“覆盖率”会掩盖 C 的抵消作用。

## 单值与趋势

`total` 是完整的单行 DataFrame，`current` 是原分析已计算的数值。`daily` 是按日观察的 Marivo Frame。读者先看合计，再看日间波动。

`total` 快照先就绪时，用 `stage: "preview"` 提交 `root = Stack([heading, total]);`、显示“本期合计”的 `heading` 语句和下方的 `total` 语句。`daily` 就绪后，使用上次返回的 `draftId` 和 `draftRevision` 继续预览，提交下面的 `root`、`heading` 和 `trend` 语句，以及 `total`、`daily` 两份资源。读者可在同一标签页看到趋势加入。核对后用 `stage: "save"` 与最新的草稿标识生成一个正式版本。下方是合并后的完整页面。

```openui
root = Stack([heading, total, trend]);
heading = TextContent("本期合计与按日明细");
total = DatasetView("total", {chart: "metric", encoding: {value: "current"}});
trend = AnalysisFrameView("daily");
```

## Frame 看板

已有三个 Frame，分别给出 GMV 的期间比较、按日趋势与地区分解。比较卡使用紧凑视图，趋势与分解放在同一可换行的布局中。

```openui
root = Stack([heading, charts, scope]);
heading = TextContent("GMV 的变化集中在哪些地区？", "large");
charts = Stack([gmv, trend, regions], "row", "m", "start", "start", true);
gmv = AnalysisFrameView("gmv", {chart: "comparison"}, {density: "compact"});
trend = AnalysisFrameView("daily");
regions = AnalysisFrameView("by_region", {chart: "decomposition"});
scope = TextContent("地区分解使用与 GMV 比较相同的期间。");
```

## 图片与明细

`figure` 是已有的资金流向图，所需的桑基图不属于数据视图支持的图形；`flows` 是同范围的 DataFrame 明细。把图和原值并排放置，方便读者核对。

```openui
root = Stack([figure, flows], "row", "m", "start", "start", true);
figure = Image("资金在各环节间的流向", "figure");
flows = DatasetView("flows", {chart: "table", columns: ["source", "target", "amount"]});
```
