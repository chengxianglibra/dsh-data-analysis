# 展示数据投影

## P2 新写入的数据依据

新 `marivo_present` 使用 P1 的 AnalysisSnapshot v1：Frame 通过 schema/read_page 在一次 checked execution 内有界读取，
依据声明的 table/metric 选列；DataFrame 用成功原执行的 snapshotRef 读取，不能接受任意 JSON 作为新结果。
原执行的 Host provenance、Workspace 与摘要检查沿用 dataset-snapshot 接缝。
所有快照及范围保存在新文档 resources 中，属于 Build 的生命周期，不长期依赖 captures 临时目录。
不再为新写入创建 block Draft；旧 projection/project/readDraft 只保留给旧格式及其验证入口。
详见[统一交付](presentation-delivery.md#p2-统一静态写入契约)。下文中的 Draft/writer 为旧格式契约。


## 责任与入口

本模块将已存在的数据和声明来源投影为 reader 可消费的纯数据。Marivo 拥有 Artifact、Finding、字段、Quality、
issues 与语义引用；Harness 拥有 Workspace 和 Runtime identity。插件不审查 computed 转换、不复算，
也不把来源存在解释为计算正确性。

实现入口为 [contracts](../../packages/dsh-data-analysis/src/presentation/contracts/index.ts)、
[projection](../../packages/dsh-data-analysis/src/presentation/projection/index.ts)和
[Python writer](../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/_dataset.py)。
结构、数值编码和预算见下文[展示数据契约](#展示数据契约)。
这些是内部展示接口；[共享 reader 与离线 builder](presentation-reader.md)消费其输出，[展示交付](presentation-delivery.md)通过 `marivo_present` 保存报告。

## 展示数据契约

纯展示结构以 [types.ts](../../packages/dsh-data-analysis/src/presentation/contracts/types.ts) 和
[校验入口](../../packages/dsh-data-analysis/src/presentation/contracts/index.ts)为准，不复制 Marivo 的领域 schema。
Document 使用 schemaVersion 3，Draft 使用 schemaVersion 2，两者均要求 `locale: "zh-CN" | "en-US"`。Receipt 仍使用 schemaVersion 2，computed `TypedDataset` 仍使用 schemaVersion 1。旧报告不自动迁移，需由 DSH 重新生成。
current 指针与 Host delivery envelope 的版本由[展示交付](presentation-delivery.md)独立定义。

| 结构 | 职责 |
| --- | --- |
| `PresentationDraft` | 标题、声明来源、dataset 输入、有序 blocks 与可选交互；作者不能填入生成时来源事实 |
| `SourceRef` | 精确 `sessionId`、`artifactRef` 和可选 `findingId`，在同一绑定 Workspace/Runtime 下恢复 |
| `TypedDataset` | 列定义、按列顺序的 rows、完整 rowCount、写入 limit 与 truncated |
| `PresentationDocument` | Workspace/Report/Build 身份、物化 datasets、来源与代码快照、blocks 和诊断 |
| `PresentationReceipt` | 保存结果、身份、摘要与文件路径/字节数/SHA-256；HTML 可选，Session/Turn 归属由 delivery envelope 提供 |

五类 block 为 `markdown`、`metric`、`chart`、`table`、`source`；图形配置和交互见[reader](presentation-reader.md)。
metric 精确绑定已有单元格或已准备的筛选切片，不隐式求和；source 只展示保存快照。
Artifact dataset 必须有可恢复的必要来源和数据；computed 可声明零到多个来源，source-only 保持 `datasets: []`。
available/unavailable 表达来源读取结果，不能解释为分析正确性状态。

### 数值与行数

列类型为 `string`、`boolean`、`float64`、`int64`、`decimal`、`date`、`datetime`，属于 JSON 展示编码。

- `int64` 使用 signed 64-bit 范围的精确十进制字符串；`decimal` 保留尾随零及可选指数，不允许 NaN/Infinity。
- `float64` 必须是有限 JSON number；超出 JavaScript safe integer 范围的整值拒绝接收，不能把已舍入值改成字符串冒充精确值。
- `date` 使用有效 `YYYY-MM-DD`，`datetime` 使用带 `Z` 或 offset 的 ISO 字符串，最多六位秒小数；不猜时区。
- `null` 只出现在 nullable 列，不替换成零或空字符串；精确表格保留原值。

图形 `numericMode` 明确区分 `exact` 与 `approximate`。exact 不接受 decimal 或无法精确转换的 int64；
approximate 才允许将其转成有限 JavaScript number，显示近似提示并保留原始表格值。reader 不静默聚合、缩放或重算指标。

`rows.length` 必须等于 `min(rowCount, limit)`，`truncated` 必须等于 `rowCount > rows.length`。
空结果保留列定义；截断数据不能用于推导全量总计、KPI 或排名。插件无法恢复上游已经丢失的精度。

### 预算与错误

| 项目 | 上限 |
| --- | --- |
| Draft / 单 TypedDataset / Document / HTML | 256 KiB / 2 MiB / 4 MiB / 8 MiB |
| datasets / sources / blocks | 16 / 64 / 64 |
| 单 dataset 列 / 行 / 单元格 | 64 / 5,000 / 100,000 |
| 代码片段 / 单段文本 | 32 / 32,768 字符 |

预算由 `PRESENTATION_BUDGETS` 定义，JSON 按 UTF-8 字节计算；读取前限制原始文件字节。
`PresentationContractError` 提供 `code`、RFC 6901 `path`、`message` 与修复 `hint`；
身份、路径、摘要及实际文件授权由 Host 检查，纯 schema 校验不代替文件边界。

## 数据流程

`MarivoPresentationProjection` 只接受 ready、携带 presentation-kit identity 的 bound runner。
`readDraft(relativePath)` 从绑定 Workspace 有界读取草稿；
`project(draft, { workspaceId, reportId, buildId, generatedAt?, signal? })` 返回校验过的 `PresentationDocument`。
Workspace/report/build identity 由 Host 提供，Draft 不允许自行填写生成文档的来源事实。

| 输入 | 处理 | 失败边界 |
| --- | --- | --- |
| Artifact dataset | 固定程序恢复 Session/Artifact，核对公开字段顺序和完整行数，再按声明列与行预算编码 | 来源、必要字段或数据不可恢复时失败 |
| computed dataset | 读取 Workspace 相对路径的 typed JSON，保持原值及 Draft 的零到多个 source refs | 文件、数值或预算不合法时失败；来源 unavailable 可以保留 |
| source-only | 只恢复声明来源，保存 available/unavailable 快照 | 保持无 dataset，不生成占位表格 |

计算文件先限制原始字节再解码 UTF-8/JSON，拒绝目录、FIFO、符号链接、越界及读取期间身份变化。
每个异步边界检查取消和 runner 状态。错误位置使用 RFC 6901 pointer，关联回 Draft/dataset；
上游异常原文不进入生成文档，防止路径、SQL 或 secret 混入诊断。

来源读取使用[报告执行预算](../../packages/dsh-data-analysis/src/presentation/execution-policy.ts)中的
120 秒子进程上限，包含 Runtime identity 检查、导入、Session 恢复与来源快照读取；零来源跳过该子进程。
`marivo_present` 外层预算为 180 秒，给绑定检查、数据读取和报告提交留出余量；该预算不保证任意数量 Session 均可完成。
取消、进程树终止、输出限制和 identity 校验保持有效，不自动重试，也不将操作超时转换为来源 `unavailable`。

来源超时保留 `subprocess-timeout`，仅增加 `phase: presentation-source-read`、`timeoutMs`、`durationMs`、
`sourceCount` 和去重后的 `sessionCount`。耗时覆盖整个来源读取调用，不表示语义加载的单独耗时；不附带来源身份、路径、
SQL、凭据或上游异常。提示明确本次来源投影未完成、尚未进入报告提交，应保留草稿及来源声明后重试，
不删除来源或重跑分析。这只说明报告提交边界，不承诺 Runtime 完全没有副作用。

## 公开来源快照

固定程序通过 `mv.session.resume(session_id)`、`session.persisted_frame(artifact_id)` 恢复准确引用，
再以 `frame.schema`、`frame.read_page()` 和 `page.to_pandas()` 读取有界前缀。
初次投影在一次 checked execution 内完成；不调用全量 `frame.to_pandas()` 或已移除的 `evidence_digest()`，
不加载当前模型、重跑分析或取得数据源凭据。schema/layout 重名、身份不符、损坏数据和不支持的类型明确失败。

`MarivoPresentationProjection.readFrames(refs)` 返回插件 `AnalysisSnapshot` v1：共用 typed data、
读取时间与 coverage；Frame 另保留 input identity、字段角色、实际 layout、公开字段类型与单位、
完整轴键、逐行坐标和 read_stats。默认至多读取一页，limit 由现有行/列/单元格预算计算，
坐标也计入单元格预算；不自动续页或把已读前缀标为完整结果。没有 UI 在线续页入口。
旧 Draft 的 Artifact 投影复用同一 Reader，再按原声明选列；原文档协议不变。

首期支持现有 scalar codec 可表达的值和坐标。calendar/interval 的 start/end、actual_start/actual_end
按带时区 datetime 编码，保留 NULL；ns dtype 不直接拒绝，只在实际值包含亚微秒精度时返回 numeric_precision，
不截断时间精度。复合 tuple 展示、duration、naive timestamp 等未适配载体仍明确失败，不把结构字符串化。
slots 仅保存实际投影的 value/presence 字段和全部轴键；未选中的不支持类型不阻断选列读取，
被选中字段及完整轴键仍须通过类型检查。完整键按 slot 保存，不能用表格行号代替。
Evidence、Findings、methods 和 semantics 在新快照中为 not-captured，不扫描审计重建旧 digest。
旧 Draft 明确指定的 Finding 仍按既有来源路径读取，缺失时保留诊断。

当前 `0.6.0.dev0` 没有公共持久化 Run SQL 读取接口。新来源的 `code` 固定为无 snippets，
并标明 `sql-capability-unavailable`；不读取私有 Store、日志或重新编译 SQL。
已有报告 Build 中保存的 SQL 快照继续展示，不改写历史文档。
旧 Session Store 不自动迁移，无法恢复的旧引用明确 unavailable；原始 Store 留给兼容旧 Runtime 读取/导出。

dataset 可通过 `codeRefs` 引用成功 `marivo_python` 的执行记录。投影只从 Host 管理的执行存储按精确 Workspace、execution ID 和
完整记录字节的 SHA-256 读取 Python 原文，再保存到 dataset 的 `code`；不接受 Workspace 自报记录。
引用不可恢复时构建失败，不读取同名脚本补齐。
执行记录证明提交的 Python 成功执行，作者仍负责它与 dataset 的关联；不审计外部导入文件或计算正确性。
代码以原文保存，不做字面量脱敏，不从凭据 payload 提取内容。生成 JSON 与离线 HTML 均包含同一份代码快照。

## Python helper 与 Runtime

`dsh_data_analysis_presentation.write_dataset(frame, path, *, row_limit=5000, labels=None)` 只接受 pandas DataFrame，
原子写入 computed typed JSON，并返回路径、字节数、完整/写入行数和截断信息的有界 receipt。

computed writer 可通过 `labels={列名: 展示名}` 显式设置列 `label`，未映射列沿用列名；
列 `id` 和 Draft 绑定保持原样。typed JSON 继续使用现有 schemaVersion 1，展示名不改变分析语义。
writer 不接收来源或转换说明；来源只写在 Draft。
行和单元格预算确定实际 limit，超出字节预算明确失败；空结果保留列，未指定的展示标签使用列名。

分发 wheel 为 `dsh_data_analysis_presentation_kit-1.2.0-py3-none-any.whl`，只依赖 pandas。
Runtime marker v3 同时检查模块版本、distribution 版本、实际导入位置和公开 writer；
每次 shared checked execution 再核验 helper，避免 Workspace 同名模块遮蔽。管理员 Python 失败时提供修复信息，
不自动安装或切换解释器；managed 模式通过唯一新 wheel 安装路径准备环境。

## 验证

```sh
npm run test:presentation-projection
npm run test:runtime-workspace
npm run test:presentation-surface
npm run validate:runtime-workspace:real
npm run validate:presentation-projection:real
npm run validate:presentation-browser:real
```

Python 合同测试随 `npm run check` 持续执行；真实脚本使用隔离目录，保留机器证据。
Artifact 验证先通过 Marivo 公开分析生成并持久化，再在另一进程恢复；
该 Chromium 验证只证明 Python/Node/browser 数据解释一致；reader、离线 HTML、Host 交付和真实 Agent 路由需分别验证。

来源预算回归包括超过旧 30 秒上限的真实 Node 子进程夹具、安全超时元数据、非超时错误原样传播，
以及 Native／Code 新建和更新在来源超时或取消后不发布 receipt、已有报告文件与 current／历史字节保持不变。
子进程终止由 environment-execution 的短预算超时、取消及后代进程测试覆盖。
该延迟夹具仅验证插件执行预算，不代表 19 域项目的 Marivo 加载性能或 5／15 来源真实验收；
原项目 Workspace、草稿及实际 Runtime 未核验前，这项真实验收仍待完成。

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

### 预检与诊断验证

[presentation-projection 回归测试](../../packages/dsh-data-analysis/tests/presentation-projection/lint.test.ts)
覆盖 JSON number 拒绝、精确 int64 边界保真、跨 computed 文件错误收集、CLI 退出码与无写入、符号链接和无效 JSON 拒绝；
[projection 测试](../../packages/dsh-data-analysis/tests/presentation-projection/projection.test.ts)
验证 present 使用的投影路径保留列级诊断且不重复拼接 pointer。
分发检查验证 CLI 声明、可执行权限和安装包内启动。上述验收不代表真实 Agent 或完整报告渲染验收。

## 同次执行的 DataFrame 快照

`capture_dataset(frame, *, row_limit=5000, labels=None)` 只接受 pandas DataFrame，并要求处于
`marivo_python` worker 的捕获上下文中。RawSqlResult 不作为 helper 输入；转换及原始标量精度由原分析负责，
插件不能恢复 DataFrame 创建时已经丢失的精度。SQL、datasource、Evidence 和业务覆盖不从 DataFrame 推断。

helper 复用 typed codec，在调用专属 `.dsh-data-analysis/captures/<id>/` 内写快照和结构化 manifest，
未调用时不创建目录。Host 仅在原执行成功后读取该 manifest，校验文件边界、预算、内容和摘要，
把 captures 与 registry 中的 Workspace、Session、call/root call 及 codeRef 一并保存到原 Host execution 存储。
回执的 `snapshots` 按 captureId 返回 snapshotRef；不解析 stdout、扫描目录或新增模型捕获工具。

`readDatasetSnapshot(root, workspaceId, snapshotRef)` 先验证 Host execution 记录，再读取准确文件并校验摘要；
重开不启动 Python、不连接数据源。捕获失败返回 snapshotCaptureError，不签发 snapshotRef，
原 Python 执行状态仍据实际退出结果报告，不自动重跑。manifest 写入失败不会覆盖原退出码或原异常；
worker 通过 launcher 管理的临时状态文件报告捕获状态，launcher 在用户 stderr 前写固定状态头，Host 消费后移除。
临时状态文件位于独立临时目录并在 launcher 结束时清理；状态缺失或损坏按捕获失败处理，不能视为未调用 helper。
该状态只标记捕获失败，快照内容和引用仍只来自经过校验的 manifest/文件；不从用户 stdout/stderr 搜索回执。
helper 调用本身抛出的异常仍由原代码处理；未捕获异常按正常 Python 规则导致非零退出。
超时、非零退出和取消不签发引用。
凭据值出现在快照时拒绝捕获，不修改精确单元格来伪装脱敏。

快照覆盖说明区分总行数、捕获行数与 complete；business 固定 unknown。一行截断预览仍为 incomplete。
这些文件在 P1 中随 Workspace 保存，P2 才将被引用内容纳入不可变 Build 的附件生命周期；
现有 marivo_present 尚不接受 snapshotRef，新 UI 与双位置交付也未开放。
