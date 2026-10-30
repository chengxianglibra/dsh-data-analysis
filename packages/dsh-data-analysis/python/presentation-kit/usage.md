# Presentation Python 帮助库

`dsh_data_analysis_presentation` 只公开 `capture_dataset`、`DatasetCaptureReceipt`、
`capture_frame`、`FrameCaptureReceipt` 与 `PresentationDatasetError`。`capture_frame` 只接受已完成的
AnalysisFrame（持久，或 `compute()` 后的内存 Frame），写入 schemaVersion 2 的 Frame 快照；待执行表达式以
`frame_not_computed` 拒绝且不隐式 compute，pandas DataFrame 请改用 `capture_dataset`。捕获结果是 `TypedDataset` v1 快照，Host 签发 snapshotRef 后供
`marivo_present` 引用；helper 不读取 Marivo、不推断来源、不生成 HTML、不注册全局变量。

数值和预算以 [共享数据契约](../../src/presentation/contracts/types.ts) 为准：整数使用精确
`int64` 字符串，超过有符号 int64 的整数使用 `decimal` 字符串；`Decimal` 保留精度和尾零。
float64 的非有限数和不安全整数失败；`None`、`pd.NA`、`NaN`、`NaT` 写为 `null`。
datetime 必须带显式时区，超过微秒的精度失败，不能补造时区或截掉精度。混合、不支持的值类型失败。

最多 64 列、5000 行、100000 个单元格；有效 `limit` 是请求行预算与单元格预算的较小值。
保留原始 `rowCount` 并明确 `truncated`，不得把截断数据用作全量总计。单个文本最多 32768 个
UTF-16 code units，JSON 最多 2 MiB；超过文本或字节预算直接失败，不缩短单元格。
object 列只根据保留行推断类型；空或全 null 的 object 列用 nullable string 表示，不猜业务含义。
DataFrame 的 index、attrs、来源与转换代码不进入快照。

内部 Frame reader 复用 `_dataset.encode_rows(...)` 与 `_dataset.encode_dataset(...)`。
`columns` 如提供，必须是与 DataFrame 列顺序一致的展示描述符，不能用于把已舍入的值变回精确值。

Python 测试读取 [共享 fixtures](tests/fixtures)，fixture emitter 复现相同 typed 数据供 Node 解析器共同检查。
包目录下运行：

```sh
uv run --project python/presentation-kit --frozen python -m pytest python/presentation-kit/tests
node scripts/build-presentation-kit.mjs
```

## 在原执行中捕获 DataFrame

在 `marivo_python` 原分析代码退出前调用：

```python
from dsh_data_analysis_presentation import capture_dataset
receipt = capture_dataset(frame, row_limit=5000, labels={"amount": "金额"})
```

返回 `DatasetCaptureReceipt(capture_id, row_count, captured_rows, truncated)`；Host 在同次工具成功回执的
`snapshots` 中按 captureId 关联 snapshotRef。无需打印 receipt；stdout 不是捕获协议。
helper 只接受 pandas DataFrame，不接受 RawSqlResult，不能恢复此前已丢失的精度。
未调用时不写快照。SQL、datasource 与业务覆盖不从 attrs 或列名推断。
调用异常可由原分析代码捕获；未捕获异常仍按 Python 规则退出。退出时 manifest 写入失败不会覆盖原执行结果，
Host 返回 snapshotCaptureError 且不签发 snapshotRef；原代码成功时仍保留 codeRef。
捕获错误不应通过重跑分析修复。snapshotRef 作为 `marivo_present` 的 `dataset-snapshot` 资源使用。
