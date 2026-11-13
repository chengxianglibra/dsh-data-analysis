# 分析视图编写示例

示例资源名、输入路径、列 ID 和结论须按实际任务替换。优先保留适用的类型化分析并使用 AnalysisFrameView，纯文件和外部计算使用 DatasetView。

## AnalysisFrame 从早期草稿到正式保存

用户想了解 GMV 的期间变化及地区贡献，无需明确说“生成报告”。问题和范围确认后先展示草稿；比较就绪后展示，再继续地区分解。下面是 Host 编排模板，Native 可按同样顺序逐次调用；计算代码由 marivo-analysis 和 live Help 确定。

两次脚本各自读取准确输入，并声明实际访问的数据源；存在依赖时读取前一调用的固定引用。

先提交仅含 heading 和 status 的 `stage:"preview"`。比较计算的 `resultVariables` 导出成功后，以返回的 `resource` 更新同一草稿；再计算地区分解、追加第二个 resource，并将 status 删除。核对结果和限制后，用最新草稿 ref 执行 `stage:"save"`。

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
let draft = await tools.marivo_report_write({stage:"preview", title:"销售文件分析", program:'root = TextContent("正在读取明细");'});
function resource(result, name) {
  if (result.execution.reason !== "succeeded" || !result.results?.[name]) throw new Error("Inspect execution and export state");
  return result.results[name].resource;
}
const detailResult = await tools.marivo_python({project:"required", datasources:[], resultVariables:{detail:"result"}, code:`import pandas as pd
result = pd.read_csv("/actual/readable/sales.csv", usecols=["category", "amount"]).rename(columns={"amount": "value"})`});
const detail = resource(detailResult, "detail");
draft = await tools.marivo_report_write({stage:"preview", ref:draft.ref, resourcePatch:{put:{detail}}, program:'root = DatasetView("detail", {chart:"table"});'});
const categoryResult = await tools.marivo_python({project:"required", datasources:[], resultVariables:{by_category:"result"}, code:`import json
from marivo import analysis as mv
source = mv.read_dataframe(json.loads(${JSON.stringify(JSON.stringify(detail.ref))})).to_pandas()
result = source.groupby("category", dropna=False)["value"].sum(min_count=1).reset_index()`});
draft = await tools.marivo_report_write({stage:"preview", ref:draft.ref, resourcePatch:{put:{by_category:resource(categoryResult,"by_category")}}, program:'root = Stack([DatasetView("detail", {chart:"table"}), DatasetView("by_category", {chart:"table"})]);'});
const saved = await tools.marivo_report_write({stage:"save", ref:draft.ref});
```

也可将页面组织为下方布局。修改汇总方法时复用准确的 detail 固定引用；派生读取完整结果，保存前核对结论和限制。

```openui
root = Stack([heading, detail, categories, scope]);
heading = TextContent("sales.csv：类别明细与汇总");
categories = DatasetView("by_category", {chart:"table", columns:["category", "value"]});
detail = DatasetView("detail", {chart:"table", columns:["category", "value"]});
scope = TextContent("来源为 sales.csv。明细保留原行的类别与金额，汇总按 category 分组。");
```

preview 返回 draft ref，save 返回 saved ref；回执不证明浏览器已渲染。每次显式指定 stage，不传 surface。

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

## 跨资源日期筛选

在 `marivo_report_write` 中与 `program` 一起提交如下 `selectionSources`；更新时提供完整来源表，省略则继承现有声明：

```json
{
  "day": {"ref":"daily", "field":{"kind":"column", "name":"day"}, "label":"日期", "mode":"single", "options":{"allowAll":false, "defaultPolicy":"latest"}},
  "period": {"ref":"daily", "field":{"kind":"column", "name":"day"}, "label":"日期范围", "mode":"date-range", "options":{"defaultPolicy":"latest"}}
}
```

```openui
$day = "a";
$period = {};
root = Stack([dailyScope, hourlyScope]);
dailyScope = Card([dayInput, dailyKpi]);
hourlyScope = Card([periodInput, applyPeriod, resetPeriod, hourlyTrend]);
dayInput = FormControl("日期", Select("day", @Each($source_3_day_options, "item", SelectItem(item.id, item.label)), null, null, $day));
periodInput = FormControl("日期范围", DatePicker("period", "range", null, $source_6_period_draft));
applyPeriod = Button("应用", @Set($period, @SelectionOrCurrent($period, $source_6_period_draft, $source_6_period_options, "date-range", true)));
resetPeriod = Button("恢复默认", Action([@Set($period, $source_6_period_default), @Set($source_6_period_draft, $source_6_period_default)]));
dailyKpi = DatasetView("daily", {chart:"metric", encoding:{value:"total"}}, {}, [{source:"day",selection:$day}]);
hourlyTrend = DatasetView("hourly", {chart:"line", encoding:{axis:"hour", values:["total"]}}, {}, [{source:"period",field:{kind:"column",name:"hour"},selection:$period}]);
```

假定字段和类型已核验、daily 每个 day 恰有一行；日期单选仅联动指标，日期范围仅联动趋势，分别用 Card 标示范围。其他维度须有保存字段并显式绑定。

## 多选维度筛选

在 `selectionSources` 声明来源。以下应用操作先检查草稿；恢复默认同时更新已应用值和草稿。

```json
{"region":{"ref":"sales","field":{"kind":"column","name":"region"},"label":"地区","mode":"multiple"}}
```

```openui
$region = {};
root = Stack([regionInput, applyRegion, resetRegion, salesTable]);
regionInput = FormControl("地区", CheckBoxGroup("region", @Each($source_6_region_options, "item", CheckBoxItem(item.label, "", item.id)), null, $source_6_region_draft));
applyRegion = Button("应用", @Set($region, @SelectionOrCurrent($region, $source_6_region_draft, $source_6_region_options, "multiple", true)));
resetRegion = Button("恢复默认", Action([@Set($region, $source_6_region_default), @Set($source_6_region_draft, $source_6_region_default)]));
salesTable = DatasetView("sales", {chart:"table"}, {}, [{source:"region",selection:$region}]);
```
