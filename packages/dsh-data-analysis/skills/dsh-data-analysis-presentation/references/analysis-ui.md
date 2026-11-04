# 视图选择与页面布局

## Marivo Frame

`AnalysisFrameView("result")` 根据 Frame 的结构选图。单行单组比较适合读本期值与变化，单行多组比较可在同一张表中核对各指标的本期、基期、差值和变化率。多行比较按时间或类别组织。要突出某一组，可以用 `{chart:"comparison", encoding:{value:"输出列名"}}` 引用该组的公开值名。分解图使用 Frame 已有的分解结果。

饼图适合观察型 Frame 的构成比较。快照须完整，只有一个分类轴，类别键唯一。选择一个非广播数值列，值须非空、有限、非负且至少有一个正值。用 `{chart:"pie", encoding:{axis:"轴名", value:"值名"}}` 指定字段，目标唯一时可省略映射。

## DataFrame

`DatasetView` 按保存的列 ID 映射字段。表格可用 `{chart:"table", columns:["category", "amount"]}` 选择读者需要核对的列。指标卡使用完整单行结果中的一个数值。折线图、面积图和柱图用 `{axis, values, series?}`，热力图用 `{x, y, value}`。这些图要求完整快照、数值列和唯一坐标组合，按快照中首次出现的顺序展示。趋势图应使用原分析已经按时间排好的数据。

## OpenUI Lang 布局

从 `root` 组合页面，组件按[签名](analysis-catalog.md)接受位置参数。将结论、图表和范围说明分别写成命名语句，便于调整阅读顺序。需要并排时为 Stack 指定 row 和 wrap，使卡片在窄屏可以换行。用 Image 的资源名引用已有图片，给它写出能说明内容的替代文字。读者需要核对原值时配数据视图。
