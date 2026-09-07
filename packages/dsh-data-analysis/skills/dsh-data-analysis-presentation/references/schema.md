# 草稿 schema 与文件边界

这是插件的 presentation v1 写入契约。所有对象只接受列出的字段；不要把生成文档或 receipt 当作草稿。Marivo 的分析 API 与 semantic schema 以 bound Runtime 的 Skill 和 live Help 为准。

## 顶层与引用

顶层必须有 `schemaVersion: 1`、非空 `title`、`datasets`、`sources`、`blocks`。即使没有 dataset 或来源，也保留空数组；至少一个 block。datasets、sources、blocks 各自的 `id` 不重复，所有引用必须存在。

| 对象 | 必填字段 | 可选字段 |
| --- | --- | --- |
| 声明来源 | `id`, `ref: {sessionId, artifactRef}` | `ref.findingId` |
| Artifact dataset | `id`, `kind: "artifact"`, `sourceId`, `rowLimit` | `columns: string[]` |
| computed dataset | `id`, `kind: "computed"`, `path`, `sourceIds: string[]` | 无 |

`sessionId` 使用 Artifact 所属 Marivo Session 的实际 `session.id`，`artifactRef` 使用实际 `artifact.ref`。保存并传递这两个公开属性；`session.name`、显示名称、日志标题和 DSH Session ID 都不能替代持久身份。`sourceId` 和 `sourceIds` 指向草稿 `sources[].id`。computed 可声明零个或多个来源，声明不建立 Marivo lineage，也不验证转换。Artifact dataset 要求可恢复保存数据；computed 的声明来源不可用时仍可展示数据，并标明 unavailable。

`draft_path` 与 computed 的 `path` 均相对于当前绑定 Workspace 根目录，**不是相对于草稿文件目录**。使用根目录内的 JSON 文件；不使用绝对路径、`..`、`.` 路径段、反斜杠、空路径段或通向 Workspace 外的符号链接。不从其他项目、解释器或数据源补齐失败的引用。

## 五类 block

| kind | 必填字段（除 `id`、`kind`） | 可选字段 |
| --- | --- | --- |
| `markdown` | `text` | 无 |
| `metric` | `datasetId`, `columnId`, `rowIndex`, `label` | 无 |
| `chart` | `datasetId`, `chart: "line" \| "bar"`, `x`, `y: string[]`, `numericMode: "exact" \| "approximate"` | 无 |
| `table` | `datasetId` | `columns: string[]` |
| `source` | 非空 `sourceIds: string[]` | 无 |

metric 选取一个现有行列交叉值，`rowIndex` 从 0 开始；它不求和、不筛选、不计算 delta。chart 的 `x` 是已有列 ID，`y` 是一个或多个数值列 ID。table 的 `columns` 控制展示选择和顺序。需要聚合、比率或排序来回答问题时先完成分析，不能让 reader 推断。

blocks 数组决定阅读顺序，reader 自行适配布局；schema 没有 `layout`、`theme` 或 chart `title` 字段。图前说明用 markdown block，图例和坐标标签来自 dataset 列。Markdown 支持正文、标题、列表、引用、代码和链接；HTML 作为文字，图片不加载，不接受作者 JavaScript 或任意 renderer 配置。

## computed typed JSON

优先让 `write_dataset` 处理 DataFrame 类型。手工提供纯数据 JSON 时必须满足下列契约，不能使用普通 records 数组或 JavaScript 注册脚本。

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | `1` |
| `columns` | 非空数组；每列有 `id`, `label`, `type`, `nullable`；可选 `unit` |
| `rows` | 行数组，每行与 columns 等宽；null 仅用于 nullable 列 |
| `rowCount` | 截断前的总行数，非负安全整数 |
| `limit` | 1–5000；写出行数必须等于 `min(rowCount, limit)` |
| `truncated` | 必须等于 `rowCount > rows.length` |

列类型只接受 `string`、`boolean`、`float64`、`int64`、`decimal`、`date`、`datetime`。`int64` 是有符号 64 位范围内的精确整数字符串；更大整数用 `decimal`。`decimal` 用精确字符串保留尾零。`float64` 必须有限，整数值必须是 JS 安全整数。日期用 `YYYY-MM-DD`；datetime 用带 `Z` 或显式 UTC offset 的 ISO 字符串，最多微秒精度。不要猜时区或把已舍入的数据标成精确值。

Python helper 要求 `.json` 目标的父目录已存在，默认 `row_limit=5000`，返回 `path`、`bytes`、`row_count`、`written_rows`、`limit`、`truncated`。None、pandas 缺失值写为 null；无法表示的混合类型、无时区 datetime 和超精度值会报错。DataFrame index、attrs、来源和转换代码不会写入文件。

## 有界预算与诊断

一份草稿最多 256 KiB、16 个 datasets、64 个 sources、64 个 blocks。每个 dataset 最多 2 MiB、64 列、5000 行、100000 个单元格；文本字段最多 32768 UTF-16 code units，title 最多 512。helper 会按行与单元格预算缩减有效 limit 并报告截断；字节或文本超限直接失败。生成文档与 HTML 还分别受 4 MiB、8 MiB 限制。

错误中的 JSON pointer 定位需要修复的字段。列不存在时核对实际输出；metric 行不存在时改为现有值或空结果说明；`numeric_precision` 按[数值绘图规则](charts.md)处理；预算超限时选择问题需要的列和有界数据，并保留范围说明。不要删掉 unavailable 或截断提示来冒充完整结果。
