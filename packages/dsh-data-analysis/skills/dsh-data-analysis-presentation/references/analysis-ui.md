# Lang、捕获与增量更新

单 Frame 或成功捕获的 DataFrame 直接传引用，不读本页也能呈现。只有需要自定义布局、捕获或修改时使用以下说明。
组件签名见[八组件 Catalog](analysis-catalog.md)。DatasetView 只有 auto/table/metric；AnalysisFrameView 的 auto 按 Frame 结构选择图形，
需要偏离默认时才写 view，encoding 只引用 marivo_ui_read 或回执中的公开值名、轴名。不提供离线导出或发布。

## 自定义页面

```json
{
  "surface": "tab",
  "resources": {"result": {"kind": "dataset-snapshot", "snapshotRef": "实际成功引用"}},
  "title": "比较结果",
  "program": "root = Stack([heading, DatasetView(\"result\")]);\nheading = TextContent(\"已有依据支持的说明\");"
}
```

组件用位置参数，不在调用中写 name:value。每个命名语句单独一行。rows 不进入 program。图片声明 `kind:"image-file",path:"workspace-relative.png"`，
Image 的 src 填资源名。Native 使用真实 program 参数前缀展示文字和布局；新资源校验前显示占位。
PTC dispatch 可见完整参数，不承诺生成期逐片预览。失败或中断不会覆盖已保存版本。

## 在原执行中捕获

```python
from dsh_data_analysis_presentation import capture_dataset, capture_frame
capture_frame(frame)      # frame is a completed AnalysisFrame (persisted, or after compute())
capture_dataset(result)   # result is an actual pandas DataFrame in this analysis process
```

成功 marivo_python 回执按 kind 返回 snapshotRef，helper 自动关联原调用及 codeRef。Frame 声明为
`{"kind":"frame-snapshot","snapshotRef":"实际引用"}`，优先于 `marivo-frame`；待执行表达式先 compute()，
`to_pandas()` 之后得到的是 DataFrame，只能用 capture_dataset 与 DatasetView。capture 不接收 RawSqlResult。
首次确需保存 SQL 结果时，按实时 Help 将其转为 DataFrame 后捕获；含 NULL 的整数列可能变成 float64，
大整数可能在转换中舍入。helper 不检测或修复捕获前损失，不推断 SQL/datasource 来源。
不要每条 SQL 都捕获，不为展示重新执行已结束的分析。

## 修改准确版本

已知原 program 和成功 recordId 时，只提交变化语句：

```json
{
  "surface": "tab",
  "basedOnRecordId": "marivo-ui:实际-reportId:实际-buildId",
  "program": "heading = TextContent(\"修改后的说明\");"
}
```

省略 resources 继承原快照；提供时替换完整资源表，同名同声明复用已保存字节。省略 program 保留原布局，
title/locale 省略时继承。更新生成独立完整 Build，不重新分析。需要移除节点时先改写父引用，再用 `name = null` 删除语句。

缺少准确基版本定义时才调用 marivo_ui_read；成功后不默认回读。并发冲突时核对当前版本与修改意图，
重新形成 patch，不仅替换 basedOnRecordId 盲重试。
