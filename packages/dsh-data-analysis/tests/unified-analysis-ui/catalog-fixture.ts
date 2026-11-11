/** Program fixture for the Catalog contract. */
export const program = `root = Stack([intro, card, tabs]);
intro = TextContent("P0 Native prefix: 正文已到达");
card = Card([AnalysisFrameView("frame", {chart: "table"}), DatasetView("sql", {chart: "metric", encoding: {value: "amount"}})]);
tabs = Tabs([TabItem("data", "数据", [AnalysisFrameView("frame"), DatasetView("sql")]), TabItem("about", "说明", [TextContent("八组件 Catalog"), Image("P0 image")])]);`
