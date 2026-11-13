# 展示数据投影

## 责任与入口

本模块把已存在的结果读取为分析 UI 可保存的快照（Dataset v1、Frame v2）。Marivo 拥有 固定结果、Frame 字段、Quality、
issues 与语义引用；Harness 拥有 Workspace 和 Runtime identity。插件不审查 DataFrame 的计算过程、不复算，
也不把来源存在解释为计算正确性。

- Frame：`analysis-frame` 声明接收 `saved.ref.to_dict()`。Host 在当前 Workspace 的绑定 Runtime 中通过
  `mv.session.resume(...).persisted_frame(...)` 恢复，核对 Store、Session、Artifact 身份后读取。
- DataFrame：`dataframe` 声明接收 `mv.persist_dataframe(table).to_dict()`。Host 先核验引用中的
  `project_root` 属于当前 Workspace，再调用 `mv.read_dataframe(ref)` 与结果的 `to_pandas()`。
- 两者均不启动 HTTP 服务，不加载当前模型或连接来源，不计算、不持久化、不重放生产代码。
  旧 `frame-snapshot` / `dataset-snapshot` 声明继续按保存的 Host provenance 读取历史快照。

快照内嵌于不可变 Build 的 `resources`，属于 Build 的生命周期，不长期依赖 captures 临时目录。
保存、更新与 ReportRef 见[展示交付](presentation-delivery.md#分析视图写入与增量契约)，阅读呈现见[共享 reader](presentation-reader.md)。

## 展示数据契约

快照的 typed data 使用 [types.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/types.ts) 的展示编码，
文档结构以 [analysis-document.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/analysis-document.ts) 为准，
不复制 Marivo 的领域 schema。快照共用 typed data、读取时间与 coverage；coverage 区分总行数、捕获行数与 complete，
business 固定 unknown。

### 数值与行数

列类型为 `string`、`boolean`、`float64`、`int64`、`decimal`、`date`、`datetime`，属于 JSON 展示编码。

- `int64` 使用 signed 64-bit 范围的精确十进制字符串；`decimal` 保留尾随零及可选指数，不允许 NaN/Infinity。
- `float64` 必须是有限 JSON number；超出 JavaScript safe integer 范围的整值拒绝接收，不能把已舍入值改成字符串冒充精确值。
- `date` 使用有效 `YYYY-MM-DD`，`datetime` 使用带 `Z` 或 offset 的 ISO 字符串，最多六位秒小数；不猜时区。
- `null` 只出现在 nullable 列，不替换成零或空字符串；来源原值不变，Frame 按统一格式显示数值并引用保存值，DatasetView 默认精确显示，显式格式仅改变主视图的展示，详细数据仍保留精确值，图形位置可使用数值近似。

`rows.length` 必须等于 `min(rowCount, limit)`，`truncated` 必须等于 `rowCount > rows.length`。
空结果保留列定义；截断数据不能用于推导全量总计、KPI 或排名，metric 视图要求 complete 的单行快照。
插件无法恢复上游已经丢失的精度。

固定快照筛选读取 Dataset 列或 Frame ordinary 单键轴的保存值，支持 string、boolean、精确 int64 和允许的 null。匹配产生原始行索引，不改写行、coverage 或 Frame 元数据；捕获范围仍按原快照解释，匹配行数不代表重新计算的业务指标。

### 预算与错误

| 项目 | 上限 |
| --- | --- |
| 单快照 / Document | 2 MiB / 4 MiB |
| 资源 / 组件节点 | 16 / 64 |
| 单快照列 / 行 / 单元格 | 64 / 5,000 / 100,000 |
| program / 单段文本 | 32,768 字符 |

预算由 `PRESENTATION_BUDGETS` 定义，JSON 按 UTF-8 字节计算；读取前限制原始文件字节。
身份、路径、摘要及实际文件授权由 Host 检查，纯 schema 校验不代替文件边界。上游异常原文不进入保存文档，
防止路径、SQL 或 secret 混入诊断。

## 数据流程

新增引用由 [result-reader.ts](../../../packages/dsh-data-analysis/src/presentation/result-reader.ts) 在 checked Python 中读取。
内部 [read_result.py](../../../packages/dsh-data-analysis/python/presentation/read_result.py) 只适配公开结果和展示格式，
不拥有持久化、引用签发或来源语义。Runtime identity 与 Workspace 在异步边界复核。
同次准入的新资源顺序读取，避免公开 Session.resume 恢复操作的写锁竞争；每项通过校验后立即发送资源流。其他进程占锁返回 result-session-busy，提示等待后读取原固定引用，不自动重试或重跑分析。Python 只输出允许的错误 code，Host 校验后映射修复提示；未知异常保持 result-read-failed，不透传 stderr。
已有报告的相同声明（包括 codeRef）复用内嵌快照，不解析 Runtime 或启动 Python。同一次准入中多个资源名的准确相同声明也只读取一次，复制快照后分别应用标签；同一资源可由多个视图使用，保留原生产绑定。
新 `dataframe` / `analysis-frame` 声明可携带同次 `marivo_python` 回执的 codeRef；Host 读取当前 Workspace 的执行记录，核验其中登记了准确的 Marivo 引用，再绑定原 Harness Session/call。绑定失败明确报错，不降级为无来源。
有效源码记录未登记结构化结果时返回 `python-result-exports-missing`；记录无法核验时返回 `python-execution-source-unavailable`；
记录已导出其他引用但未导出目标引用时返回 `analysis-resource-code-not-bound`。三者分别说明缺口，并提示使用已导出目标引用的原回执，
或在无法核验脚本时显式省略 codeRef、继续使用已有固定结果；不能为补来源而重跑已成功分析。Host 不自动删除调用者提供的 codeRef。
该关联证明该次执行返回过引用，不推断原始计算或完整依赖；只有读取已有结果的代码不能被称为最初的生成脚本。
工具外层执行预算为 180 秒，定义见[报告执行预算](../../../packages/dsh-data-analysis/src/presentation/execution-policy.ts)。
取消或快照读取失败不发布 current，不自动重跑分析。

## 首次结果元数据

`marivo_python` 在 `results[name]` 中返回可直接提交的 `resource`、`sourceStatus` 和有界 `metadata`。Frame 通过公开 Session 恢复固定身份，从 schema 读取轴、导出 layout、值和物理类型。无需读行，`totalRows` 为 null。DataFrame 的公开 `read_dataframe` 完整读取固定结果，摘要只使用 schema 和 `row_count`。两者均不访问业务来源。

首次结果 metadata 和写入回执的每资源摘要使用同一个 `viewCandidates` 契约。旁边的 `viewCandidateUsage` 以相同分组名披露 `{nameKind,parameters}`：`nameKind` 为 `column-id`、`public-axis-name` 或 `public-value-name`，`parameters` 使用 `bar.encoding.axis` 等 chart.parameter 路径。候选数组结构保持不变；用途信息在首次结果、成功回执和配置失败回执中一致。

| 字段 | 参数用途 |
| --- | --- |
| `columns` | table 的 `columns`、metric 的 `encoding.value` 和显示标签的列 ID |
| `axis` | Frame 的图表轴、系列和热力图 x/y，或 Dataset 对应的列 ID |
| `timeAxis` | Frame line/area 的日历或区间轴名。Dataset 仍使用列 ID |
| `values` | Frame 的公开值名，或 Dataset 的列 ID |
| `numericValues` | 按物理类型可参与绘图的值或列。实际数据仍须通过图种约束 |

`coordinateColumns` 通过 `{name,axisToken,endpoint,part,axisName?}` 关联表格列和 `axes[].token`，预算允许且有对应轴时直接提供公开 `axisName`；超出预算时保留 token，可与 `axes[].token` 关联。例如轴名 `trino_query.query_info.cluster` 的导出列可以是 `cluster`。一个轴可投影出多个列，配置使用 metadata 返回的精确名称，不将短列名自动当作轴名。Frame 图表轴误填现有列 ID 时，错误同时披露 `receivedKind:"column"`、`expectedKind:"axis"` 和候选公开轴名。Frame 的比较、分解、饼图等视图另受快照事实、角色和保存值约束。

`marivo_report_write` 成功时返回本次新增或替换的资源摘要，未更改资源时返回空集合。配置失败回执的 `resultMetadata` 使用相同结构，只包含出错组件所引用的已准入快照，包括内联组件及复用资源。两条路径均从已有快照组装，不额外读取。失败诊断另提供具体参数的候选，见[展示交付](presentation-delivery.md#分析视图写入与增量契约)。

首次结果摘要上限为每结果 5 KiB、每类 64 个名称，Python 控制帧上限 32 KiB。写入回执的资源摘要上限为 32 KiB，超预算明确返回 `unavailable/budget`。元数据不可用不使有效引用失效。`coverage.business` 始终为 `unknown`。

## Frame 快照

Frame 展示格式投影复用 [_frame.py](../../../packages/dsh-data-analysis/python/presentation/_frame.py) 的 `read_frame`。
读取只用 `frame.schema`、`frame.read_page()`、`frame.read_periods()` 与 `page.to_pandas()`，捕获完整字段，不接受 columns 参数。
不调用全量 `frame.to_pandas()`，不加载当前模型、重跑分析或取得数据源凭据。schema/layout 重名、身份不符、
损坏数据和不支持的类型明确失败。

公开 `persist()`、`ref`、Session 恢复与读取约束以绑定 Marivo live Help 为准。Marivo 引用自身不包含 Harness 身份；提供 codeRef 时从 Host 的成功执行记录核验并绑定，否则只记录 Workspace。报告内嵌快照保留引用与数据，后续展示更新不依赖原 Store。

Frame 快照另保留 input identity、字段角色、实际 layout、公开字段类型与单位、完整轴键、逐行坐标和 read_stats。
默认至多读取一页，limit 由行/列/单元格预算计算，坐标也计入单元格预算；不自动续页或把已读前缀标为完整结果。

首期支持现有 scalar codec 可表达的值和坐标。坐标 part 与 Marivo 一致（key、label、start、end、nominal_start、nominal_end）；
`.start` 是实际观察起点，名义起点是 `.nominal_start`。时间边界按带时区 datetime 编码，保留 NULL；ns dtype 只在实际值包含亚微秒精度时返回 numeric_precision，不截断时间精度。
复合 tuple 展示、duration、naive timestamp 等未适配载体明确失败，不把结构字符串化。
paired 时间轴的 calendar endpoint key 使用带时区 datetime 编码；paired 自身的 ordinal key 仍按其公开槽类型编码。
slots 仅保存实际投影的 value/presence 字段和全部轴键；未选中的不支持类型不阻断选列读取，
被选中字段及完整轴键仍须通过类型检查。完整键按 slot 保存，不能用表格行号代替。

v2 保存下列已支持的数据业务语义，不读取 `evidence()`、`findings()` 或 `method_facts`。`description`、轴变体（timezone、grain、paired 端点）
随结构保存；三个元数据节为 `semantics`（实际投影列的静态 lineage）、`interpretation`（`fixed_axes`、按当前值名索引的
observation/statistic/share/pair_statistic context、comparisons、decompositions、alignments）与 `periods`（每个时间轴及时间比较的
`read_periods` 页，合计不超过 5000 项，`hasMore`/`totalCount` 照实保存）。内部 ID 在捕获时解析为当前值名、轴 token、
比较序号或比较组名，键值沿用所属轴键的 codec。各节独立为 `captured` 或带封闭原因的 `unavailable`
（`runtime-incompatible`、`read-failed`、`identity-mismatch`、`budget`），不写入原始异常，也不改用其他读法；
单节上限 semantics/interpretation 256 KiB、periods 1.5 MiB，整份快照超 2 MiB 时先降级最大节，元数据失败不阻断数据结果。
Marivo 0.6.6 的 `Frame.schema.value_time_semantics` 当前不纳入快照，因此报告不能展示该字段中的值时间语义。
契约与交叉校验见 [snapshot.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/snapshot.ts)。新 `analysis-frame` 资源通过 [result-reader.ts](../../../packages/dsh-data-analysis/src/presentation/result-reader.ts) 读取固定身份，Host 只接受 Frame v2。

日历期间按当前 Marivo 公共契约保存 civil `label`、`selection` 和可选 `cutoff`；不根据日期标签、键或时区推算未公开的起止边界。
Interval 期间继续保存上游提供的 start/end。历史 Frame v2 中包含实际和名义日历边界的期间记录仍可读取。

Frame 快照不包含 SQL 片段并标明 `sql-capability-unavailable`；
不读取私有 Store、日志或重新编译 SQL。

## DataFrame 结果投影

引用以 Marivo `marivo.dataframe_ref/v2` 为准，包含捕获的绝对 `project_root` 和 `result_id`。
插件只允许读取当前 Workspace 的结果；不接受裸 ID、其他项目或旧版引用，不替换其位置。
`read_dataframe` 返回完整且独立的 `DataFrameResult`；按公开 Arrow schema 选择展示 codec，
保留空列的物理类型与精确标量。读取会加载全量数据，内存和文件 I/O 不受展示行数预算约束。

投影仍使用 Dataset v1，记录原总行数、保留行数和 complete；不从 attrs、列名或来源存在推断
SQL、datasource、lineage、业务覆盖或转换正确性。展示标签通过 `marivo_report_write.labels` 设置。
新 Frame/DataFrame 资源的可选 codeRef 由 Host 执行记录核验，不从引用、attrs 或列名推断。省略 codeRef 的外部结果保留无脚本来源状态。
旧 capture record 仅用于历史快照读取，新 Python 执行不再创建 manifest、capture 目录或回执。

## 内部展示适配器

插件不分发或安装 `dsh-data-analysis-presentation-kit`。内部 `python/presentation/*.py` 随插件交付，
由 Host 按准确安装路径加载；Workspace 的同名模块不能覆盖它。
它保留插件拥有的 bounded typed JSON 展示编码与 Frame 元数据投影，不复制 Marivo 的持久化或语义实现。

## 验证

```sh
npm run test:presentation-projection
npm run test:runtime-workspace
npm run validate:result-references:real
npm run validate:runtime-workspace:real
```

Python codec 测试复用原共享 fixtures，与 Node 合同共同检查。真实验证使用固定版本的隔离 Runtime，
覆盖 Frame/DataFrame 跨进程读取、精确值、空类型、截断、错误 Store/Workspace、已嵌入资源的独立复用。
模块测试不代替真实 Host、浏览器和模型验收。
