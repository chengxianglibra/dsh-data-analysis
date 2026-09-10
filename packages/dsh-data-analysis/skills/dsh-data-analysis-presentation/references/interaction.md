# 全局筛选与动态指标

## 何时启用

由 Agent 根据报告问题和数据条件决定；仅有固定结论、单图或不能形成共同筛选范围时省略 `interaction`。reader 不根据 dataset 自动生成筛选，也不推断跨 dataset 的关系。

需要启用时，将所有受影响的 metric/chart/table 连续放入 `blocks`。固定正文、固定 KPI 和 source 放在区外；区内只能有共同响应的组件。每个筛选字段固定，读者对每个字段选择一个值或“全部”，多个字段共同决定唯一组合。没有局部数据行筛选入口。

## 声明

Draft schemaVersion 2、Document schemaVersion 3 均支持以下可选字段：

```typescript
interaction?: {
  title: string
  blockIds: string[]
  filters: {
    id: string
    label: string
    allOptionId: string
    options: { id: string; label: string }[]
  }[]
  slices: {
    selection: Record<string, string>
    datasets: { datasetId: string; rowIndices: number[] }[]
  }[]
}
```

`blockIds` 唯一、按正文顺序排列且连续。一份报告只有一个区域。`filters` 的顺序决定控件顺序；每个字段至少包含“全部”和一个具体选项。`allOptionId` 明确指出“全部”，显示标签使用“全部”；普通业务值或标签 `all` 没有特殊含义。选项 ID 是稳定标识，不是 reader 执行的表达式或字段名。

每个 `selection` 为全部 filter ID 到 option ID 的完整映射。每一种可选组合必须恰好有一个 slice，含多个字段均为“全部”及部分字段为“全部”的组合。初始、重置、重新打开、打印和禁用脚本均采用全“全部”组合。

`datasets` 必须覆盖区域内全部组件实际使用的数据集，包括 chart 的全部 `preparedViews`。每个 dataset 恰好一个绑定；`rowIndices` 为该 dataset 原始快照的零起始行索引，不是排序后或分页后的索引。可以跨组合复用行，但同一绑定不能重复索引。表格与图表允许 `[]`，表示明确准备的空结果；不能用遗漏 dataset 代替空结果。

## 动态 KPI

固定 metric 继续使用 `rowIndex`。区域内 metric 改用 `rowSelection: "slice"`，与 `rowIndex` 互斥：

```json
{"id":"count","kind":"metric","datasetId":"summary","columnId":"query_count","rowSelection":"slice","label":"当前查询数"}
```

每种组合对该 dataset 必须唯一选择一行；同一行可包含多个 KPI 的不同列。不要将需要多行的 chart/table 和动态 metric 强行绑定到同一个 dataset。无数据指标显式准备 nullable 单元格 `null`，与数值零区分。

先在分析阶段按业务口径计算总计、去重、比率、排名、占比与分母，再构造各组合的展示数据。尤其“全部”必须选择预计算的全量结果，不能把汇总行与明细行一起选择，或期待 reader 累加各组选项。

既有行数、dataset 数、Draft/Document/HTML 字节预算仍适用。组合过多时减少字段或选项；不扩张预算、不静默截断、不回退到全量值。Draft 检查结构与引用，投影后检查实际行索引与 KPI 唯一性，失败按诊断修正。

## 阅读与编辑

区域边界清楚区分固定内容；区域内指标、图表、表格、来源数据预览共同切换。复制上下文包含筛选条件、原始行索引和当前指标值，来源 identity 不变。

宿主编辑可改现有呈现字段、区域内部顺序和删除组件，不能跨区域移动或编辑筛选声明。删除最后一个交互组件会移除声明，撤销可恢复。当前选择不保存，不进入下载或浏览器存储；保存的声明和全部组合仍包含在离线 HTML 中。

参见[双筛选完整示例](examples.md)。示例为合成数据，不能当成真实业务结果。
