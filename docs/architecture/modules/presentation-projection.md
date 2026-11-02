# 展示数据投影

## 责任与入口

本模块把已存在的结果读取为分析 UI 可保存的快照（Dataset v1、Frame v2）。Marivo 拥有 Artifact、Finding、字段、Quality、
issues 与语义引用；Harness 拥有 Workspace 和 Runtime identity。插件不审查 DataFrame 的计算过程、不复算，
也不把来源存在解释为计算正确性。

- Frame：原分析进程中的 `capture_frame(frame)` 捕获已完成的 Frame，Host 签发 `marivo-frame:` snapshotRef 并绑定 codeRef。只接受 `frame-snapshot` 声明，不提供事后恢复入口。
- DataFrame：原分析进程中的 [capture_dataset](../../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/_capture.py)
  捕获，Host 签发 snapshotRef，由 [dataset-snapshot.ts](../../../packages/dsh-data-analysis/src/presentation/dataset-snapshot.ts) 读取。

快照内嵌于不可变 Build 的 `resources`，属于 Build 的生命周期，不长期依赖 captures 临时目录。
保存、更新与 recordId 见[展示交付](presentation-delivery.md#统一分析-ui-写入与增量契约)，阅读呈现见[共享 reader](presentation-reader.md)。

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
- `null` 只出现在 nullable 列，不替换成零或空字符串；来源原值不变，Frame 表格显示可读值，悬停（`title`）与复制保留精确拼写，DatasetView 表格、tooltip 与 reader 保持精确显示，图形位置可使用数值近似。

`rows.length` 必须等于 `min(rowCount, limit)`，`truncated` 必须等于 `rowCount > rows.length`。
空结果保留列定义；截断数据不能用于推导全量总计、KPI 或排名，metric 视图要求 complete 的单行快照。
插件无法恢复上游已经丢失的精度。

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

捕获在原 `marivo_python` 执行内使用 checked Runtime 完成。`marivo_present` 仅校验捕获记录、读取快照并提交，
不绑定 Runtime、不启动 Python，也不恢复 Session；每个异步边界复核 Workspace 归属与取消。
工具外层执行预算为 180 秒，定义见[报告执行预算](../../../packages/dsh-data-analysis/src/presentation/execution-policy.ts)。
取消或快照读取失败不发布 current，不自动重跑分析。

## Frame 快照

捕获使用 [_frame.py](../../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/_frame.py) 的 `read_frame`。
`capture_frame` 只接受持久或 `compute()` 后的内存 Frame，待执行表达式报 `frame_not_computed`，DataFrame 指向 `capture_dataset`；
读取只用 `frame.schema`、`frame.read_page()`、`frame.read_periods()` 与 `page.to_pandas()`，捕获完整字段，不接受 columns 参数。
不调用全量 `frame.to_pandas()`，不加载当前模型、重跑分析或取得数据源凭据。schema/layout 重名、身份不符、
损坏数据和不支持的类型明确失败。

Frame 快照另保留 input identity、字段角色、实际 layout、公开字段类型与单位、完整轴键、逐行坐标和 read_stats。
默认至多读取一页，limit 由行/列/单元格预算计算，坐标也计入单元格预算；不自动续页或把已读前缀标为完整结果。

首期支持现有 scalar codec 可表达的值和坐标。坐标 part 与 Marivo 一致（key、label、start、end、nominal_start、nominal_end）；
`.start` 是实际观察起点，名义起点是 `.nominal_start`。时间边界按带时区 datetime 编码，保留 NULL；ns dtype 只在实际值包含亚微秒精度时返回 numeric_precision，不截断时间精度。
复合 tuple 展示、duration、naive timestamp 等未适配载体明确失败，不把结构字符串化。
paired 时间轴的 calendar endpoint key 使用带时区 datetime 编码；paired 自身的 ordinal key 仍按其公开槽类型编码。
slots 仅保存实际投影的 value/presence 字段和全部轴键；未选中的不支持类型不阻断选列读取，
被选中字段及完整轴键仍须通过类型检查。完整键按 slot 保存，不能用表格行号代替。

v2 只保存数据的业务语义，不读取 `evidence()`、`findings()` 或 `method_facts`。`description`、轴变体（timezone、grain、paired 端点）
随结构保存；三个元数据节为 `semantics`（实际投影列的静态 lineage）、`interpretation`（`fixed_axes`、按当前值名索引的
observation/statistic/share/pair_statistic context、comparisons、decompositions、alignments）与 `periods`（每个时间轴及时间比较的
`read_periods` 页，合计不超过 5000 项，`hasMore`/`totalCount` 照实保存）。内部 ID 在捕获时解析为当前值名、轴 token、
比较序号或比较组名，键值沿用所属轴键的 codec。各节独立为 `captured` 或带封闭原因的 `unavailable`
（`runtime-incompatible`、`read-failed`、`identity-mismatch`、`budget`），不写入原始异常，也不改用其他读法；
单节上限 semantics/interpretation 256 KiB、periods 1.5 MiB，整份快照超 2 MiB 时先降级最大节，元数据失败不阻断数据结果。
契约与交叉校验见 [snapshot.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/snapshot.ts)；Frame v1 及旧元数据格式明确拒绝，必须在原分析执行中捕获当前格式。

日历期间按当前 Marivo 公共契约保存 civil `label`、`selection` 和可选 `cutoff`；不根据日期标签、键或时区推算未公开的起止边界。
Interval 期间继续保存上游提供的 start/end；reader 仍可读取既有 Frame v2 中带日历边界的快照。

当前 `0.6.0.dev0` 没有公共持久化 Run SQL 读取接口，Frame 快照不包含 SQL 片段并标明 `sql-capability-unavailable`；
不读取私有 Store、日志或重新编译 SQL。

## 同次执行的 DataFrame 快照

`capture_dataset(frame, *, row_limit=5000, labels=None)` 只接受 pandas DataFrame，并要求处于
`marivo_python` worker 的捕获上下文中。`labels={列名: 展示名}` 只改变展示标签，不改变列 `id`。
RawSqlResult 不作为 helper 输入；转换及原始标量精度由原分析负责，插件不能恢复 DataFrame 创建时已经丢失的精度。
SQL、datasource、Evidence 和业务覆盖不从 DataFrame 推断。

helper 复用 typed codec，在调用专属 `.dsh-data-analysis/captures/<id>/` 内写快照和结构化 manifest，
未调用时不创建目录。Host 仅在原执行成功后读取该 manifest，校验文件边界、预算、内容和摘要，
把 captures 与 registry 中的 Workspace、Session、call/root call 及 codeRef 一并保存到原 Host execution 存储。
回执的 `snapshots` 按 captureId 返回 snapshotRef；不解析 stdout、扫描目录或新增模型捕获工具。

`readDatasetSnapshot(root, workspaceId, snapshotRef)` 先验证 Host execution 记录，再读取准确文件并校验摘要；
重开不启动 Python、不连接数据源。捕获失败返回 snapshotCaptureError，不签发 snapshotRef，
原 Python 执行状态仍据实际退出结果报告，不自动重跑。manifest 写入失败不会覆盖原退出码或原异常；
worker 通过 launcher 管理的临时状态文件报告捕获状态，launcher 在用户 stderr 前写固定状态头，Host 消费后移除。
临时状态文件位于独立临时目录并在 launcher 结束时清理；状态缺失或损坏按捕获失败处理，不能视为未调用 helper。
快照内容和引用只来自经过校验的 manifest/文件；不从用户 stdout/stderr 搜索回执。
helper 调用本身抛出的异常仍由原代码处理；超时、非零退出和取消不签发引用。
凭据值出现在快照时拒绝捕获，不修改精确单元格来伪装脱敏。

## Python helper 与 Runtime

分发 wheel 为 `dsh_data_analysis_presentation_kit-1.5.1-py3-none-any.whl`，只依赖 pandas。
Runtime marker v3 同时检查模块版本、distribution 版本、实际导入位置和公开 helper；
每次 shared checked execution 再核验 helper，避免 Workspace 同名模块遮蔽。管理员 Python 失败时提供修复信息，
不自动安装或切换解释器；managed 模式通过唯一 wheel 安装路径准备环境。
kit 只公开 `capture_dataset`、`capture_frame`、`DatasetCaptureReceipt`、`FrameCaptureReceipt` 与 `PresentationDatasetError`；
Runtime marker 与 checked execution 同时核验两个 capture helper。

## 验证

```sh
npm run test:presentation-projection
npm run test:runtime-workspace
npm run validate:runtime-workspace:real
```

Python 合同测试随 `npm run check` 持续执行；真实脚本使用隔离目录，保留机器证据。
Frame 验证在原分析执行中捕获快照，随后移除来源并独立读取；覆盖精确标量、coverage、完整键与身份校验。
旧 Frame v1 和事后恢复声明须拒绝。真实 Runtime、Host/UI 与模型验收分别记录，模块测试不能替代真实运行。
