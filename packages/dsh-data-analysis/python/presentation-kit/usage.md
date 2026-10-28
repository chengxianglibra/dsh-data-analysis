# Presentation Python 帮助库

`dsh_data_analysis_presentation.write_dataset(frame, path, *, row_limit=5000, labels=None, dataset_id=None)`
将 pandas DataFrame 写为 `TypedDataset` v1 的纯 JSON，返回 `DatasetWriteReceipt`
（`path`、`bytes`、`row_count`、`written_rows`、`limit`、`truncated`）。目标必须是父目录已存在的
`.json` 文件；内容校验完成后才原子替换。来源引用只写在 presentation draft，helper 不读取
Marivo、不验证转换、不生成 HTML、不注册全局变量。

可选 `dataset_id` 仅用于报错定位，例如 `write_dataset(frame, "summary.json", dataset_id="summary")`。
`PresentationDatasetError` 保留原有 `code` 和 JSON Pointer `path`，报错文本增加目标路径、
dataset id（如提供），列级错误增加列名与 dtype。类型推断或单元格编码失败还会提供首个异常值的
零基行位置（不是 DataFrame index）、类型及最多 160 字符的转义预览；复杂对象仅显示类型。
混合列定位第一个使类型组合不兼容的值。诊断信息不写入数据文件，writer 仍默认静默；
内部 Artifact reader 不附加 writer 的路径或 dataset id。

可选 `labels: Mapping[str, str] | None` 按 DataFrame 列名指定独立展示名，例如：

```python
write_dataset(frame, "computed.json", labels={
    "base_0831": "基期（08月31日）",
    "cur_0907": "本期（09月07日）",
})
```

`id` 始终保留原列名，Draft 的字段绑定仍使用 `id`；中文报告的表头、图例和 tooltip 使用
`label`。允许部分映射和重复展示名，未映射列沿用列名。未知键、非字符串、空字符串、
NUL、非法 Unicode 或超过 256 UTF-16 code units 的 label 会报错；最终 JSON 字节预算包含 label。
校验失败不覆盖已有文件，不修改 DataFrame，也不从 attrs 推断展示名。

数值和预算以 [共享数据契约](../../src/presentation/contracts/types.ts) 为准：整数使用精确
`int64` 字符串，超过有符号 int64 的整数使用 `decimal` 字符串；`Decimal` 保留精度和尾零。
float64 的非有限数和不安全整数失败；`None`、`pd.NA`、`NaN`、`NaT` 写为 `null`。
datetime 必须带显式时区，超过微秒的精度失败，不能补造时区或截掉精度。混合、不支持的值类型失败。

最多 64 列、5000 行、100000 个单元格；有效 `limit` 是请求行预算与单元格预算的较小值。
保留原始 `rowCount` 并明确 `truncated`，不得把截断数据用作全量总计。单个文本最多 32768 个
UTF-16 code units，JSON 最多 2 MiB；超过文本或字节预算直接失败，不缩短单元格。
object 列只根据保留行推断类型；空或全 null 的 object 列用 nullable string 表示，不猜业务含义。
DataFrame 的 index、attrs、来源与转换代码不进入数据文件。

内部固定 Artifact reader 可复用 `_dataset.encode_dataset(frame, *, row_limit=5000, columns=None)`。
`columns` 如提供，必须是与 DataFrame 列顺序一致的展示描述符，不能用于把已舍入的值变回精确值。

Python 测试直接读取 [S0 fixtures](../../tests/presentation-s0/fixtures)，fixture emitter
复现相同 typed 数据供 Node/browser 解析器共同检查。包目录下运行：

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
捕获复用 writer 的精确值与预算规则；未调用时不写快照。SQL、datasource 与业务覆盖不从 attrs 或列名推断。
调用异常可由原分析代码捕获；未捕获异常仍按 Python 规则退出。退出时 manifest 写入失败不会覆盖原执行结果，
Host 返回 snapshotCaptureError 且不签发 snapshotRef；原代码成功时仍保留 codeRef。
捕获错误不应通过重跑分析修复。P1 的 snapshotRef 供 Host Reader 使用，marivo_present 接线在 P2 完成。
