# 报告编写示例

示例资源名、输入路径、列 ID 和结论须按实际任务替换。各视图使用准确固定结果，可以共享同一结果及生产 codeRef；以下纯文件示例使用 DatasetView，适用的 governed 分析优先使用后面的 Frame 组件。

## 从初始草稿到一次正式保存

用户要查看 sales.csv 的类别汇总与原始明细。两个组件分别从同一准确路径读取，互不依赖内存或对方输出。先展示问题和范围，组件就绪后及时 preview。下面适用于 Code Mode 和 Native。当前任意 Python 与草稿写入按 Harness exclusive 调度；按就绪情况增量交付，同批已就绪相关视图可一并 preview，草稿写入使用最新 revision，不等待完整分析。

```javascript
let draft = await tools.marivo_present({
  stage: "preview", title: "销售文件分析",
  program: 'root = Stack([heading, status]);\nheading = TextContent("sales.csv：类别汇总与原始明细");\nstatus = TextContent("正在准备类别汇总，尚未形成结论。");',
});
function dataResource(result, name) {
  if (result.execution.reason !== "succeeded" || result.resultCaptureError || !result.resultRefs?.[name] || !result.codeRef) {
    throw new Error("Inspect execution and capture status; do not replay blindly.");
  }
  return { kind: "dataframe", ref: result.resultRefs[name], codeRef: result.codeRef };
}
const categoryResult = await tools.marivo_python({
  datasources: [], resultVariables: { by_category: "category_ref" },
  code: `import pandas as pd
import marivo.analysis as mv
path = "/actual/readable/sales.csv"
source = pd.read_csv(path)
result = source.groupby("category", dropna=False)["amount"].sum(min_count=1).reset_index()
result = result.rename(columns={"amount": "value"})
category_ref = mv.persist_dataframe(result).to_dict()`,
});
draft = await tools.marivo_present({
  stage: "preview", draftId: draft.draftId, draftRevision: draft.draftRevision,
  resourcePatch: { put: { by_category: dataResource(categoryResult, "by_category") } },
  program: 'root = Stack([heading, categories, status]);\ncategories = DatasetView("by_category", {chart:"table", columns:["category", "value"]});\nstatus = TextContent("类别汇总已准备，正在准备原始明细。");',
});
const detailResult = await tools.marivo_python({
  datasources: [], resultVariables: { detail: "detail_ref" },
  code: `import pandas as pd
import marivo.analysis as mv
path = "/actual/readable/sales.csv"
source = pd.read_csv(path)
result = source[["category", "amount"]].rename(columns={"amount": "value"})
detail_ref = mv.persist_dataframe(result).to_dict()`,
});
draft = await tools.marivo_present({
  stage: "preview", draftId: draft.draftId, draftRevision: draft.draftRevision,
  resourcePatch: { put: { detail: dataResource(detailResult, "detail") } },
  program: 'root = Stack([heading, categories, detail, scope]);\ndetail = DatasetView("detail", {chart:"table", columns:["category", "value"]});\nscope = TextContent("来源为 sales.csv；汇总按 category 分组，明细保留文件原行。数值与分组口径以本次输入为准。");\nstatus = null;',
});
// Inspect the actual results and answer coverage before this final save.
const saved = await tools.marivo_present({
  stage: "save", draftId: draft.draftId, draftRevision: draft.draftRevision,
});
```

合并后的页面如下。计算结果需要解释时，在保存前补上已经证实的结论和实质限制；示例不从工具成功推断业务结论。

```openui
root = Stack([heading, categories, detail, scope]);
heading = TextContent("sales.csv：类别汇总与原始明细");
categories = DatasetView("by_category", {chart:"table", columns:["category", "value"]});
detail = DatasetView("detail", {chart:"table", columns:["category", "value"]});
scope = TextContent("来源为 sales.csv；汇总按 category 分组，明细保留文件原行。数值与分组口径以本次输入为准。");
```

preview 校验并更新内存草稿，返回 draftId/draftRevision，前端自动读取并展示；不需要浏览器检查或用户确认，回执也不证明浏览器已渲染。save 返回 recordId；不从 deliveryJson 拼装身份。新报告在同一 Chat 区域连续更新，以图表动效表达生成和修订，保存后停止；读者用“在边栏查看”图标移动，Chat 隐藏正文、标题和链接，关闭 Tab 后恢复。报告目录与版本链接始终在右侧打开。Native 把 stage 和身份放在 program 前；不传 surface。

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

三个组件分别回答 GMV 期间比较、按日趋势与地区分解，三个独立脚本各自读取 governed 输入并计算、持久化 Frame。按 live Help 构造分析，不在展示参考中复制计算 API。示例 daily 的时间轴名为 day，数值名为 gmv；按实际公开字段替换。每个结果就绪就 preview，下方为最终程序。

```openui
root = Stack([heading, charts, scope]);
heading = TextContent("GMV 的变化集中在哪些地区？", "large");
charts = Stack([gmv, trend, regions], "row", "m", "start", "start", true);
gmv = AnalysisFrameView("gmv", {chart:"comparison"}, {density:"compact"});
trend = AnalysisFrameView("daily", {chart:"line", encoding:{axis:"day", values:["gmv"]}});
regions = AnalysisFrameView("by_region", {chart:"decomposition"});
scope = TextContent("地区分解使用与 GMV 比较相同的期间。");
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
table = DatasetView("by_category", {chart:"table", columns:["category", "value"]});
```
