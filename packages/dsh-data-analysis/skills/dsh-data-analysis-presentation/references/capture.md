# 捕获展示数据

本页属于插件契约；Marivo live Help 负责分析 API。仅在首次捕获或遇到捕获问题时读取。

## 在原计算中捕获

```python
from dsh_data_analysis_presentation import capture_dataset, capture_frame

# result 是本次执行已计算的 pandas DataFrame。
receipt = capture_dataset(result, row_limit=5000, labels={"amount": "金额"})
# 已完成的 AnalysisFrame 可改用 capture_frame(completed_frame, row_limit=5000)。
```

`capture_dataset` 只接受 pandas DataFrame；`capture_frame` 接受 compute 返回的完整内存 Frame 或持久 Frame，不能隐式执行待计算表达式。Frame 的执行、持久化与恢复遵循实时 Help。

Python receipt 含 `capture_id/row_count/captured_rows/truncated`。同次工具成功回执的 `snapshots` 用 `captureId` 关联 `snapshotRef`，后者交给 `marivo_present`。多个结果需要建立名称映射时，可打印结果名和 `receipt.capture_id`；不要从捕获文件路径或 stdout 拼造引用。

## 类型、预算与范围

- 每次执行最多 16 次捕获；每份快照最多 64 列、5000 行、100000 个单元格、2 MiB。`row_limit` 为 1–5000 的整数，实际行预算还受单元格预算限制。列数、单元格文本或字节超限会失败；行数超限明确标记截断。
- DataFrame 列名须为唯一、非空字符串。index 和 attrs 不进入快照；需要展示的 index 应先作为实际列准备。
- 整数与 Decimal 保留精度；输入已经舍入时不能恢复。浮点正负无穷和不安全的整数浮点值被拒绝；包括 NaN 在内的缺失值写为 null。混合或不支持的 object 值可能失败。
- datetime 必须有明确时区，精度不超过微秒。按真实业务含义处理时间，不为通过捕获猜时区或静默丢弃精度。

工具返回每个快照的 `coverage` 和 `schema`：字段摘要每份最多 16 列、整次最多 64 列，`columnsTruncated` 表示摘要省略字段；它与数据行截断不同。`coverage.complete` 只证明输入结果完整捕获，不证明业务范围全量。读取预算、筛选和 Top N 仍需由分析说明。图表要求完整快照时，不用部分数据伪装全量；选择表格或回到已保留结果准备合适视图。

## 失败处理

先看 `execution.reason`，再看 `capture.status/failureStage`、错误和 `execution.nextAction`。`available` 表示已签发引用；`unused` 表示成功执行未捕获结果；`failed` 表示成功执行后的捕获失败；`not-collected` 表示执行失败或代码来源未保存，不能据此断言计算没有产生效果。

helper 调用异常遵循普通 Python 规则，未捕获会使执行失败。任一捕获失败会使同次执行的全部快照失效，即使异常已捕获；不要在该进程继续重试捕获。worker/退出收尾、Host validation、provenance 保存失败需分别核对，Host 收集失败不改写 Python 的实际退出结果。

捕获失败不授权重跑原分析。先检查已有文件、已持久化 Frame 和其他已确认结果；仅从仍可读取的既有结果恢复展示。内存已消失且无保留结果时，说明展示缺口；如确需重新计算，将其作为明确的新执行处理，遵守原授权、范围和预算。
