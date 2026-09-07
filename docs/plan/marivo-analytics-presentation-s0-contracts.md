# S0 最小展示契约与固定样例

## 范围与责任

本记录落实[路线图 S0](marivo-analytics-presentation-roadmap.md#s0先验证四个真正的阻塞点)的数据接缝。
[纯 TypeScript 契约](../../packages/dsh-data-analysis/src/presentation/contracts/types.ts)
及[校验函数](../../packages/dsh-data-analysis/src/presentation/contracts/index.ts)已实现，供 S0 验证入口共用。
它们未接入生产 Tool、插件公共 exports、Python helper 或生产 reader；本记录不宣称 S2–S4 已完成。

Marivo 继续拥有 Artifact、Finding、语义引用、Quality、issues 与有效性。
契约只保存展示数据、精确来源定位及读取时公开事实。Harness 拥有 Workspace、Runtime、Session/Turn
和交付事件归属。文件所属 Workspace、真实路径、digest 与读取授权由 Host 接缝验证，纯数据校验器不访问文件系统。

## 五项结构

所有结构使用 `schemaVersion: 1`；拒绝其他版本和未知字段，不引入别名或旧协议解析。

| 结构 | 字段与职责 |
| --- | --- |
| `PresentationDraft` | `title`、`sources`、`datasets`、有序 `blocks`。不允许 Agent 填写生成时来源事实。 |
| `SourceRef` | `sessionId` + `artifactRef`，可选 `findingId`。同一绑定 Workspace/Runtime 下定位 owning Session 的公开引用。 |
| `TypedDataset` | `columns`、按列顺序的 `rows`、`rowCount`、`limit`、`truncated`。列携带展示类型、标签、nullability 和可选 `unit`。 |
| `PresentationDocument` | `workspaceId`、`buildId`、`title`、`generatedAt`、已物化的 `datasets`、来源快照、有序 `blocks` 和诊断；reader 仅消费此快照。 |
| `PresentationReceipt` | `kind: "marivo.presentation"`、Workspace/build 身份、标题、文本 `summary`，以及两个文件的 `asset/path/sha256/bytes`。Session/Turn 归属保留在 Host delivery envelope。 |

Draft 的 `sources` 是本次展示内的引用列表，以局部 `id` 被 blocks/datasets 引用；它不是新的语义 registry。
Artifact dataset 使用 `sourceId` 精确选择一个 `SourceRef`，并指定 `rowLimit` 与可选 `columns`。
computed dataset 使用 Workspace 相对文件 `path` 及 `sourceIds`；来源只在 Draft 声明，不重复写入 computed typed JSON。
普通相对文件路径禁止绝对路径、`..`、`.`、空段和反斜线；真实路径与符号链接边界由 Host 再检查。

生成文档中的 dataset 使用 `origin: "artifact" | "computed"`、`data` 与 `sourceIds`。
直接 Artifact dataset 必须有且仅有一个 available 来源；缺失的数据或来源不能转换为成功交付。
computed 可以声明零到多个来源，也可保留 unavailable 来源。source-only 文档直接使用 `datasets: []`。

来源快照为 `available` 或 `unavailable`。available 保存展示 `label` 与有界的 `{label, value}` 文本事实；
unavailable 保存原始 `ref` 和 `reason`，没有伪造事实字段。两者都是来源读取结果，并非分析正确性状态机。
公开定义不可取得时，事实明确写出 unavailable；若未来读取当前定义，必须同时保存读取时间和当前定义身份，不能冒充历史 Artifact 口径。

## Block 与数值行为

| Block | 最小字段与约束 |
| --- | --- |
| `markdown` | `id/kind/text`，不携带可执行脚本。S0 reader 将内容作为普通文本显示；完整只读 Markdown 归 S3。 |
| `metric` | `datasetId/columnId/rowIndex/label`。唯一定位一个已存在的单元格，不取默认首行、不隐式求和。 |
| `chart` | `datasetId/chart/x/y/numericMode`；`chart` 仅 `line` 或 `bar`，`y` 是数值列列表。 |
| `table` | `datasetId` 与可选 `columns`，按所给列顺序展示精确值。 |
| `source` | `sourceIds`，只展开文档已保存的快照。 |

列类型固定为 `string`、`boolean`、`float64`、`int64`、`decimal`、`date`、`datetime`。
这是一组 JSON 展示编码，不是上游类型或 semantic family registry：

- `int64` 是 signed 64-bit 范围的十进制字符串。大于此范围的整数可使用精确 `decimal` 字符串。
- `decimal` 保留十进制字符串，包括尾随零和可选十进制指数；禁止 NaN/Infinity。
- `float64` 必须是有限 JSON number；整值若超出 JS safe integer 范围则拒绝，不能把已丢失的精度贴成精确字符串。
- `date` 使用 `YYYY-MM-DD`；`datetime` 使用带 `Z` 或显式 offset 的 ISO 字符串，保留最多六位秒小数。不猜时区、不接受不存在的日历日期。
- `null` 仅可出现在 nullable 列；它不是 `0` 或空字符串。表格用 `—` 表示，图形保留断点。

`numericMode` 必须明确为 `exact` 或 `approximate`。exact 接受已有 float64 与安全范围的 int64，
拒绝 decimal 和不能精确转换的 int64。approximate 才允许 Decimal/大整数转为有限 JS number，reader 必须标明近似并保留原始精确表格值。
不允许静默缩放、补零、聚合或重新计算指标。S0 主 Artifact 使用 line；computed 的 bar 仅绘制已经给出的 `count` 列。

`rowCount` 是完整行数，`rows.length` 是写入行数，且必须等于 `min(rowCount, limit)`。
`truncated` 必须等于 `rowCount > rows.length`。`limit` 是此次实际写入的行预算；因其他预算需要减少时应先确定有效 limit。
截断数据不能用于推导全量总计、KPI 或排名。空结果允许 `rowCount: 0`、`rows: []`，但仍保留列定义。

## 预算、错误与文件身份

| 项目 | S0 上限 |
| --- | --- |
| Draft JSON | 256 KiB |
| 单 TypedDataset JSON | 2 MiB |
| 生成 document JSON | 4 MiB |
| 自包含 HTML | 8 MiB |
| Receipt JSON | 16 KiB |
| datasets / sources / blocks | 16 / 64 / 64 |
| 单 dataset 列 / 写入行 / 单元格 | 64 / 5,000 / 100,000 |
| 单段文本 | 32,768 字符；标题、ID、原因等另有更小限制，见契约实现 |

JSON 预算按 UTF-8 序列化字节计算。生产读取仍须先限制原始文件字节，不得先无界读取再解析。
校验失败抛出 `PresentationContractError`，含 `code`、RFC 6901 `path`、`message` 和修复 `hint`。
例如 `numeric_precision` 的 `/datasets/0/data/rows/0/2` 精确定位不安全整数；未知字段对 `~` 和 `/` 正确转义。
生成文档诊断同样保存 `code/path/message`，不引入 `ready/partial/blocked` 等状态。

每次 build 只对应一个目录：

```text
<workspace>/.dsh-data-analysis/presentations/<buildId>/presentation.json
<workspace>/.dsh-data-analysis/presentations/<buildId>/index.html
```

`buildId` 使用 1–80 位安全字母数字、下划线或短横线，不是长期 presentation ID、revision 或 latest 指针。
Receipt 的两个绝对路径必须属于同一 build 目录，`asset` 名固定，SHA-256 为 64 位小写十六进制。
Schema 校验只确认身份结构；Host 必须根据绑定 Workspace 推导路径并检查归属、真实路径、大小和实际 digest。
digest 用于检测文件变化，不是访问授权，也不是恢复旧文件的承诺。

## 固定样例与真实证据

| 样例 | 期望值与证据 |
| --- | --- |
| [artifact.document.json](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/artifact.document.json) | 真实 persisted `metric_frame`，`region/revenue`；`["A",12.5]`、`["B",8.25]`、`["C",null]`，4 行写入 3 行，包含 line 与可选 Finding 引用。 |
| [computed.document.json](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/computed.document.json) | 明确标记固定序列化样例；Decimal `12345678901234.5678` 与 `0.1000`，int64 `9007199254740993` 及正负边界、null、日期/时间、boolean，5 行写入 3 行；两个真实 available 声明来源与一个真实 unavailable 来源。 |
| [source-only.document.json](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/source-only.document.json) | `datasets: []`，保留同一 Session 中不存在的 Artifact 引用和 unavailable 原因，不伪造表格。 |

另保存 [computed typed JSON](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/computed.dataset.json)、
[computed Draft](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/computed.draft.json)、
[Artifact Draft](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/artifact.draft.json)
与[固定期望值](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/expected.json)。
computed 的数值是明确标记的契约测试内容，不声称由两个声明来源计算得出；S0 不要求转换代码、复算或输入输出证明。

[Runtime 快照](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/artifact.runtime-snapshot.json)
来自 2026-09-07 真实 checked Runtime 的 Marivo `0.5.4`，已去除本机绝对路径与进程 ID。
生成进程通过公开 observe 创建 Artifact；不同恢复进程使用 `mv.session.resume(use_datasources=False)`、
`session.artifact`、`artifact.contract`、`artifact.to_pandas`、`artifact.finding`、`finding.render`。
恢复时 `observe/revalidate/credentialResolve` 均为零；不存在的来源由实际 `ArtifactNotFoundError` 证明。
来源事实直接取自此快照，包含读取时间、Artifact 内容身份、公开语义引用、Quality/issues 和选择的 Finding。
临时验证 Workspace 的 fixture ID 不是生产 Workspace 的可恢复性承诺；S2 接入时仍需用绑定 Workspace 的实际引用再验。

该真实验证也发现一个上游限制：混合指标的 public float64 结果已将 `12345678901234.5678` 变为
`12345678901234.568`，并将 `9007199254740993` 变为 `9007199254740992`。
独立 int64 Artifact 则完整恢复 `9007199254740993`。S0 保留独立 precision probe 记录并验证拒绝不安全 float64 整数，
不把已经丢失的位补造成 Decimal/int64；computed typed JSON 的精确保真不等于上游所有 Artifact 原始数值都可恢复。

## 验证入口与结论边界

[契约测试](../../packages/dsh-data-analysis/tests/presentation-s0/contracts.test.ts)覆盖真实快照与固定值一致、
精确数值/近似准入、null/日期/预算、source-only、唯一 metric、引用失败、错误位置和 receipt 文件身份：

```sh
node --experimental-strip-types --test packages/dsh-data-analysis/tests/presentation-s0/contracts.test.ts
```

S0 契约测试通过仅证明纯数据边界。Host dispatch、Web 打开/下载、离线浏览器与 React/Recharts 构建证据由 S0 接缝验证记录汇总；
本文件不把 fixtures 或纯函数测试当作生产 present、真实 Agent 路由或完整 reader 验收。
