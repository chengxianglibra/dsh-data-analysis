# 草稿 schema 与文件边界

这是插件的 presentation v1 写入契约。所有对象只接受列出的字段；不要把生成文档或 receipt 当作草稿。Marivo 的分析 API 与 semantic schema 以 bound Runtime 的 Skill 和 live Help 为准。

## 顶层与引用

顶层必须有 `schemaVersion: 1`、非空 `title`、`datasets`、`sources`、`blocks`。即使没有 dataset 或来源，也保留空数组；至少一个 block。datasets、sources、blocks 各自的 `id` 不重复，所有引用必须存在。

| 对象 | 必填字段 | 可选字段 |
| --- | --- | --- |
| 声明来源 | `id`, `ref: {sessionId, artifactRef}` | `ref.findingId` |
| Artifact dataset | `id`, `kind: "artifact"`, `sourceId`, `rowLimit` | `columns: string[]`, `codeRefs` |
| computed dataset | `id`, `kind: "computed"`, `path`, `sourceIds: string[]` | `codeRefs` |

`sessionId` 使用 Artifact 所属 Marivo Session 的实际 `session.id`，`artifactRef` 使用实际 `artifact.ref`。保存并传递这两个公开属性；`session.name`、显示名称、日志标题和 DSH Session ID 都不能替代持久身份。`sourceId` 和 `sourceIds` 指向草稿 `sources[].id`。computed 可声明零个或多个来源，声明不建立 Marivo lineage，也不验证转换。Artifact dataset 要求可恢复保存数据；computed 的声明来源不可用时仍可展示数据，并标明 unavailable。

`draft_path` 与 computed 的 `path` 均相对于当前绑定 Workspace 根目录，**不是相对于草稿文件目录**。使用根目录内的 JSON 文件；不使用绝对路径、`..`、`.` 路径段、反斜杠、空路径段或通向 Workspace 外的符号链接。不从其他项目、解释器或数据源补齐失败的引用。

## 生成代码

`marivo_python` 成功执行后自动保存该次提交的 Python 原文，并在结果中返回 `codeRef: {executionId, sha256}`。
需要在 cell 的“代码”Tab 查看生成脚本时，把实际返回的引用放进对应 dataset 的 `codeRefs` 数组；最多 32 项。
例如 `codeRefs: [result.codeRef]`。一次执行生成多个数据集时，各 dataset 可以引用同一个 `codeRef`；跨多次执行时按生成顺序列出需要的引用。
不手填 UUID、摘要或脚本路径，不把内联代码写进草稿，也不修改执行记录文件。

记录证明该脚本曾成功执行；dataset 与执行的关联由作者声明，不证明每个数据值来自该脚本或计算正确。
记录保存失败时，执行结果会带 `codeCaptureError`，已有执行结果仍然有效；省略缺失的引用并说明代码不可用，不为修复展示自动重放分析。
明确引用的记录丢失、摘要不匹配或属于其他 Workspace 时，报告构建失败；核对引用，不替换成当前脚本文件。

Artifact 的实际执行 SQL 由投影程序从该 Artifact 及其上游生产记录读取，无需在草稿重复提供。
没有查询、记录不可读取或超出读取预算时保留明确说明。`md.raw_sql()` 等未持久化为这些 Artifact 生产记录的 SQL 不会自动补出。
Python / SQL 原文随报告快照保存，不做字面量脱敏；reader 只显示文本，不执行它们。Python 记录的是本次提交代码，导入模块及外部文件的内容不会自动打包。

## 五类 block

| kind | 必填字段（除 `id`、`kind`） | 可选字段 |
| --- | --- | --- |
| `markdown` | `text` | 无 |
| `metric` | `datasetId`, `columnId`, `rowIndex`, `label` | `description`, `comparisons`；动态行见下文 |
| `chart` | `datasetId`, `chart`, `x`, `y: string[]`, `numericMode: "exact" \| "approximate"` | 按类型声明 `bindings`；`options`、`preparedViews`，见[图形配置](charts.md) |
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

## 可选全局筛选

Draft 与生成 Document 可声明 `interaction`；省略时不生成筛选器。字段及动态 metric 的互斥绑定见 [全局筛选与动态指标](interaction.md)。


## 草稿静态预检

在 Workspace 根目录运行 `dsh-data-analysis-presentation-lint analysis/presentation.draft.json`，
或通过 `--project-root PATH` 显式指定 Workspace。CLI 复用 present 的草稿与 TypedDataset 校验及文件边界，
检查草稿结构和引用的 computed JSON；不启动 Runtime、不执行分析、不生成报告文件。
输出 JSON 的 `ok` 仅表示这些静态检查通过；`deferredChecks` 列出仍由 `marivo_present` 完成的
Artifact 可用性与数据、codeRefs、投影后文档与渲染检查。退出码为 0（通过）、1（校验失败）、2（参数错误）。
草稿结构通过后逐份检查 computed 文件，每份保留首个错误，修正后可再次预检。

int64 单元格必须是精确整数字符串，例如 `"42"`；JSON number `42` 也不接受。
诊断保留 JSON pointer，并显示 `column query_count type=int64`、原因与修复建议。
超过 JS 安全整数范围的 number 可能已舍入，不能转成字符串来恢复精度；应从原始精确数据重写，
或使用绑定 Runtime 中的 `write_dataset`。预检通过不等于成功交付，仍需 present 的成功 receipt。


## KPI 比较卡片

`metric` 支持简短标题、主值、可选 `description`（周期或口径）以及 1–4 条 `comparisons`。
每条包含唯一 `label`（如“同比 · 去年同期”“环比 · 上月”“较目标”），并至少绑定一个
`referenceColumnId`（参考值）、`deltaColumnId`（绝对变化）或 `relativeColumnId`（变化率）。
所有引用均为同一 dataset、同一选中行的数值列；动态 KPI 的比较值也随 slice 一起切换。

```json
{"id":"queries","kind":"metric","datasetId":"summary","columnId":"current","rowIndex":0,"label":"查询量","description":"全天 0–23h","comparisons":[{"label":"较上周一","referenceColumnId":"baseline","deltaColumnId":"delta_current_minus_baseline","sentiment":"neutral"}]}
```

分析端预先计算 current − baseline 与变化率，声明分母及比较周期。百分比用已乘 100 的值
配 `unit: "%"`，百分点差用 delta 列配 `unit: "百分点"`。基准为零而变化率无定义时保存 nullable
`null`，不要伪造 0%。reader 不从日期、主值或参考值计算比较，也不自动重缩放。
`sentiment` 可为 `higher-is-better`、`lower-is-better` 或默认 `neutral`；例如失败率越低越好。
箭头取已准备的 delta 符号（缺失则取 relative 符号），零显示“持平”，两者缺失显示“变化不可用”；
作者须保证两个变化字段方向一致。颜色表达业务好坏，文字与箭头表达涨跌，不将上涨自动判为利好。
不要把基准、变化率塞进标题或拆成独立 KPI；无比较时原有单值卡片仍有效。
