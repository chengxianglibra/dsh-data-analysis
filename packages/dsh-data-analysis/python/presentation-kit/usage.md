# Presentation Python 帮助库

`dsh_data_analysis_presentation.write_dataset(frame, path, *, row_limit=5000)`
将 pandas DataFrame 写为 `TypedDataset` v1 的纯 JSON，返回 `DatasetWriteReceipt`
（`path`、`bytes`、`row_count`、`written_rows`、`limit`、`truncated`）。目标必须是父目录已存在的
`.json` 文件；内容校验完成后才原子替换。来源引用只写在 presentation draft，helper 不读取
Marivo、不验证转换、不生成 HTML、不注册全局变量。

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
