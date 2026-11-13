# 分析视图编写示例

示例资源名、输入路径、列 ID 和结论须按实际任务替换。优先保留适用的类型化分析并使用 AnalysisFrameView，纯文件和外部计算使用 DatasetView。

## AnalysisFrame 从早期草稿到正式保存

用户想了解 GMV 的期间变化及地区贡献，无需明确说“生成报告”。问题和范围确认后先展示草稿；比较就绪后展示，再继续地区分解。下面是 Host 编排模板，Native 可按同样顺序逐次调用；计算代码由 marivo-analysis 和 live Help 确定。

`comparisonScript` 与 `regionsScript` 分别是本次任务已按 live Help 准备的完整 Python 脚本，各自显式读取准确输入，将已计算的 AnalysisFrame 赋给 `result`。`comparisonDatasources` 与 `regionsDatasources` 声明各自实际访问的数据源；存在依赖时在后一脚本中显式读取前一调用的固定引用。不要原样执行这些占位变量。

```javascript
let draft = await tools.marivo_report_write({
  stage: "preview", title: "GMV 变化分析",
  program: 'root = Stack([heading, status]); heading = TextContent("GMV 的期间变化与地区贡献"); status = TextContent("正在核对约定期间的比较，尚未形成结论。");',
});
const comparison = await tools.marivo_python({
  project: "required", datasources: comparisonDatasources,
  code: comparisonScript, resultVariables: { comparison: "result" },
});
if (comparison.execution.reason !== "succeeded" || !comparison.results?.comparison) {
  throw new Error("Inspect execution and export state; preserve the draft.");
}
draft = await tools.marivo_report_write({
  stage: "preview", ref: draft.ref,
  resourcePatch: { put: { comparison: comparison.results.comparison.resource } },
  program: 'root = Stack([heading, comparison, status]); comparison = AnalysisFrameView("comparison", {chart:"comparison"}); status = TextContent("期间比较已就绪，正在分析地区贡献。");',
});
const regions = await tools.marivo_python({
  project: "required", datasources: regionsDatasources,
  code: regionsScript, resultVariables: { regions: "result" },
});
if (regions.execution.reason !== "succeeded" || !regions.results?.regions) {
  throw new Error("Inspect execution and export state; preserve the comparison preview.");
}
draft = await tools.marivo_report_write({
  stage: "preview", ref: draft.ref,
  resourcePatch: { put: { regions: regions.results.regions.resource } },
  program: 'root = Stack([heading, comparison, regions]); regions = AnalysisFrameView("regions", {chart:"decomposition"}); status = null;',
});
// Review results, coverage and limitations; add supported explanations before saving.
const saved = await tools.marivo_report_write({ stage: "save", ref: draft.ref });
```

示例假设结果支持相应比较与分解，实际字段和可用形态按 metadata 核对。合并后的数据视图如下；保存前补上已有证据支持的解释、期间和实质限制，不从执行成功推断业务结论。随后按 Skill 完成推荐与聊天回复。

```openui
root = Stack([heading, comparison, regions]);
heading = TextContent("GMV 的期间变化与地区贡献");
comparison = AnalysisFrameView("comparison", {chart:"comparison"});
regions = AnalysisFrameView("regions", {chart:"decomposition"});
```

## 纯文件结果的增量交付

用户要先核对 sales.csv 的类别与金额明细，再看按类别汇总。文件解析有成本，两次执行使用同一份固定明细。明细核对就绪后先 preview，再从准确引用派生汇总。下面适用于 Code Mode 和 Native。

```javascript
let draft = await tools.marivo_report_write({
  stage: "preview", title: "销售文件分析",
  program: 'root = Stack([heading, status]);\nheading = TextContent("sales.csv：类别明细与汇总");\nstatus = TextContent("正在读取类别与金额明细。");',
});
function dataResource(result, name) {
  if (result.execution.reason !== "succeeded" || !result.results?.[name]) {
    throw new Error("Inspect execution and export status before continuing.");
  }
  return result.results[name].resource;
}
const detailResult = await tools.marivo_python({
  project: "required", datasources: [], resultVariables: { detail: "result" },
  code: `import pandas as pd
path = "/actual/readable/sales.csv"
result = pd.read_csv(path, usecols=["category", "amount"]).rename(columns={"amount": "value"})`,
});
const detail = dataResource(detailResult, "detail");
draft = await tools.marivo_report_write({
  stage: "preview", ref: draft.ref,
  resourcePatch: { put: { detail } },
  program: 'root = Stack([heading, detail, status]);\ndetail = DatasetView("detail", {chart:"table", columns:["category", "value"]});\nstatus = TextContent("类别与金额明细已就绪，正在汇总。");',
});
const categoryResult = await tools.marivo_python({
  project: "required", datasources: [], resultVariables: { by_category: "result" },
  code: `import json
from marivo import analysis as mv
source = mv.read_dataframe(json.loads(${JSON.stringify(JSON.stringify(detail.ref))})).to_pandas()
result = source.groupby("category", dropna=False)["value"].sum(min_count=1).reset_index()`,
});
draft = await tools.marivo_report_write({
  stage: "preview", ref: draft.ref,
  resourcePatch: { put: { by_category: dataResource(categoryResult, "by_category") } },
  program: 'root = Stack([heading, detail, categories, scope]);\ncategories = DatasetView("by_category", {chart:"table", columns:["category", "value"]});\nscope = TextContent("来源为 sales.csv。明细保留原行的类别与金额，汇总按 category 分组。");\nstatus = null;',
});
// Inspect the actual results and answer coverage before this final save.
const saved = await tools.marivo_report_write({
  stage: "save", ref: draft.ref,
});
```

合并后的页面如下。后续若只修改汇总方法，可从仍适用的 detail 固定引用重新派生，保留明细。展示快照可能截断，派生使用原固定引用读取完整结果。保存前核对结论和实质限制。

```openui
root = Stack([heading, detail, categories, scope]);
heading = TextContent("sales.csv：类别明细与汇总");
categories = DatasetView("by_category", {chart:"table", columns:["category", "value"]});
detail = DatasetView("detail", {chart:"table", columns:["category", "value"]});
scope = TextContent("来源为 sales.csv。明细保留原行的类别与金额，汇总按 category 分组。");
```

preview 校验并更新内存草稿，返回 draft ref，前端自动读取并展示；不需要浏览器检查或用户确认，回执也不证明浏览器已渲染。save 返回 saved ref；不从 deliveryJson 拼装身份。新分析视图正文在右侧 Tab 连续更新，以图表动效表达生成和修订，保存后停止；前台会话首次出现可展示候选时自动打开，Chat 保留入口供关闭后重开，后续更新不自动抢焦点。分析视图目录与版本链接也在右侧打开。每次显式指定 stage，身份与 patch 完整后候选才可更新；不传 surface。

## 比较与抵消项

以下为示例的全量明细。

| 类别 | 基期 | 本期 |
| --- | ---: | ---: |
| A | 100 | 50 |
| B | 80 | 50 |
| C | 20 | 50 |

summary 汇总全量、减少最多的两项及其余项，selected 和 full 分别是两项与全量的 DataFrame 明细。这些资源按实际依赖准备；selected 可通过公开 API 从准确 full 固定输入派生为新结果，而多个相同范围的视图可直接共享一个资源。保留原生产 codeRef；派生输出使用新代码记录，不声称它是完整依赖图。下方只展示最终页面；有对应 governed 比较结果时使用独立 AnalysisFrame 与 AnalysisFrameView。

```openui
root = Stack([lead, summary, detail]);
lead = TextContent("全量从 200 降至 150，净减少 50（25%）。A、B 合计减少 80，C 增加 30，抵消了部分降幅。", "large");
summary = DatasetView("summary", {chart:"table"});
selected = DatasetView("selected", {chart:"table"});
full = DatasetView("full", {chart:"table"});
detail = Tabs([TabItem("selected", "减少最多的两项", [selected]), TabItem("full", "全量明细", [full])]);
```

变化率以基期总量 200 为分母。两项减少量与全量净减少之比是 160%，不能标为“覆盖率”。这种静态结论不会随资源刷新；更新数据时发现结论失效须说明，不能自行重写正文。

## Frame 看板

三个组件分别回答 GMV 期间比较、按日趋势与地区分解，按实际计算依赖读取 governed 输入，计算 Frame 并通过 resultVariables 导出。按 live Help 构造分析，不在展示参考中复制计算 API。示例 daily 的时间轴名为 day，数值名为 gmv；按实际公开字段替换。每个结果就绪就 preview，下方为最终程序。

```openui
root = Stack([heading, scope, charts, details]);
heading = TextContent("GMV 的变化集中在哪些地区？", "large");
scope = TextCallout("info", "统计范围", "地区分解使用与 GMV 比较相同的期间。");
charts = DashboardGrid([gmvItem, trendItem, regionsItem], 4, "m");
gmvItem = DashboardGridItem([gmv], 1);
trendItem = DashboardGridItem([trend], 3);
regionsItem = DashboardGridItem([regions], 4);
gmv = AnalysisFrameView("gmv", {chart:"comparison"}, {density:"compact"});
trend = AnalysisFrameView("daily", {chart:"line", encoding:{axis:"day", values:["gmv"]}});
regions = AnalysisFrameView("by_region", {chart:"decomposition"});
details = Accordion([AccordionItem("method", "补充说明", [TextContent("按实际分析填写已核实的统计口径。")])]);
```

## 图片与明细

figure 为数据视图不支持的资金流向图，flows 为同范围明细。分析生成的图片和明细分别通过独立脚本读取输入、准备结果；已有外部图片则保留其真实来源。图片没有数据视图的 codeRef 绑定，不承诺相同的脚本追溯。逐个加入草稿，核对后保存。

```openui
root = Stack([figure, flows], "row", "m", "start", "start", true);
figure = Image("资金在各环节间的流向", "figure");
flows = DatasetView("flows", {chart:"table", columns:["source", "target", "amount"]});
```

## 同一固定结果支持多个视图

已取得 by_category 的准确引用和生产 codeRef 后，表格与柱状图共享该资源，不启动新的 Python，不重新读取来源。以下程序可作为同一草稿的命名语句 patch；省略 resourcePatch 以继承原资源声明。仅改变展示配置使用同一数据，不称为刷新。

```openui
root = Stack([bars, table]);
bars = DatasetView("by_category", {chart:"bar", encoding:{axis:"category", values:["value"]}});
table = DatasetView("by_category", {chart:"table", columns:["category", "value"]}, {title:"类别汇总", subtitle:"按已保存结果展示", formats:[{value:"value", format:"number", decimals:0}]});
```

## 跨资源日期筛选

```openui
root = Stack([dailyScope, hourlyScope]);
dailyScope = Card([day, dailyKpi]);
hourlyScope = Card([period, hourlyTrend]);
day = SnapshotFilter("day", "daily", {kind:"column", name:"day"}, "日期", "single", [], {allowAll:false, defaultPolicy:"latest"});
period = SnapshotFilter("period", "daily", {kind:"column", name:"day"}, "日期范围", "date-range", [], {defaultPolicy:"latest"});
dailyKpi = DatasetView("daily", {chart:"metric", encoding:{value:"total"}}, {}, ["day"]);
hourlyTrend = DatasetView("hourly", {chart:"line", encoding:{axis:"hour", values:["total"]}}, {}, [{filter:"period", field:{kind:"column",name:"hour"}}]);
```

假定字段和类型已核验、daily 每个 day 恰有一行；日期单选仅联动指标，日期范围仅联动趋势，分别用 Card 标示范围。其他维度须有保存字段并显式绑定。
