# 第三阶段：Session 单文件 SQL 分析调研

## 结论与建议范围

第三阶段应定位为 **Session 内上传一个文件，直接使用同一 Marivo Runtime 的 DuckDB SQL 完成简单分析**。
支持目标为 CSV、JSON、Excel 与 Parquet。用户不需要先建立 Entity、Measure、Metric 等语义模型，
也不需要先把附件保存成长期复用的数据源。字段类型识别属于物理读取；指标定义与业务语义建模不是本阶段前置。

最有价值的工作是补齐附件准入、临时执行环境、格式可用性与真实执行验收。Harness 已拥有上传、进度、
取消、重试与文件卡片，DuckDB 已拥有大部分格式读取与 SQL 能力，插件应集中处理两者之间的接缝。

当前可行性要分两层判断：

- **读取与 SQL 能力已经存在。** Marivo 的公开 `md.raw_sql` 可以通过 DuckDB 文件读取函数执行 SQL；
  不需要使用 typed `md.csv`，也不需要建立语义层。
- **“空 Workspace 上传即用”尚未闭环。** 当前 `md.raw_sql` 与 `marivo_python` 依赖已注册的 datasource。
  Session 临时 DuckDB 的公开生命周期需要先确定，不能把已有 datasource 的成功探针当作新用户路径已经完成。

本记录补充[第三阶段原计划](dsh-alpha-refactor-design.md#第三阶段原生文件入口的有界原型)，是调研与实施建议，
不代表上传分析功能已经实现。后续应按本范围修订原计划中的“首发仅 CSV”和“类型推断交给 Marivo”的表述：
四类文件是目标范围，自动识别由 DuckDB reader 完成，Marivo 负责执行入口与其公开结果契约。

## 基线与证据范围

调研日期为 2026-09-09。插件基线为 `b115e0d84ac624a32f674a69922857fa013c9d2c`；
实际安装的 DSH 包为 `0.1.5-alpha.1`，本地 Harness checkout 为同一发布 tag 的
`5dda764ed3aa172535a7967b06ff95d9cbfe536a`。插件兼容契约固定 Marivo `0.5.4`。[1]

实际 shared Runtime 为 Python `3.10.20`、Marivo `0.5.4`、DuckDB `1.5.5`、Ibis `12.0.0`、
PyArrow `25.0.1`。这份格式结论针对当前安装，不代表以后任意依赖版本都自动通过。

Marivo 本地开发 checkout 已包含后续私有 lazy-analysis 工作，不能代替插件安装版的事实。
本记录的执行结论以 shared Runtime 的实际导入与合成文件探针为准；公开接口另对照 `v0.5.4` 源码。
读取上游文档时固定发布 tag；当前分支的组级 README 仍可能残留旧的仅图片描述。

已进行附件服务与 Marivo 的隔离探针；未在真实用户 Session 上传文件，未运行真实模型，未安装扩展，
未修改共享 Runtime 或业务 Workspace。完整 Web → prompt → `marivo_python` 验收仍是后续交付门槛。

## 哪些工作有价值且可以做

| 工作 | 用户价值 | 当前可行性与边界 | 建议 |
| --- | --- | --- | --- |
| 原生附件进入单文件 SQL 分析 | 上传后直接提问，无需手工搬文件 | 公开附件映射和 DuckDB SQL 均存在，需补准入与执行衔接 | 第三阶段主线 |
| CSV、JSON、Parquet 默认可读 | 覆盖常见导出、日志与分析数据 | 由当前 Runtime 的 reader 探针确认；插件不写解析器 | 一起纳入首个完整验收 |
| Excel `.xlsx` 可读与工作表选择 | 覆盖业务常见输入 | 依赖 `excel` 扩展，需验证安装和加载，而非仅验证上传 | 同阶段必需的 Runtime 准备项 |
| 空 Workspace 的 Session 临时 DuckDB | 让普通用户真正上传即用 | 当前 datasource 准入要求持久定义；需要明确公开临时执行契约 | 优先解决的接缝缺口 |
| 有界检查、过滤、聚合、排序和简单图表 | 直接回答单文件问题 | SQL 结果复用现有 computed 展示路径 | 复用现有工具与 reader |
| 可追踪的文件身份与执行记录 | 同名文件、重试、恢复时仍知道分析了什么 | 公开 FileAttachmentRef、Runtime identity、codeRef 可复用 | 与主线一起验收 |
| 新上传按钮、进度条、文件管理页面 | 相比原生入口增益有限 | Host 已提供相同能力 | 暂不建设 |
| 自动建语义层、自动发布复用数据源 | 对临时单文件问题增加准备成本 | 与本阶段目标无关 | 不列为前置或自动副作用 |
| 插件 schema 推断器、SQL 引擎、通用 adapter 框架 | 重复上游职责并增加维护成本 | 无必要性证据 | 不建设 |

## 原生附件已经提供的能力

### 上传与分析是两个操作

`ctx.fileUpload.upload(sessionId, body, name, signal, onProgress)` 负责传输并返回暂存凭证。
原生 composer 已支持通用文件卡片、后台上传、进度、失败重试及移除取消；不需要插件为四种格式重新做上传 UI。
上传成功只表示字节被保存。只有用户提交含分析意图的消息后，才应进入分析流程。[2][3]

暂存凭证由准确的 Session 拥有，通过 Session Controller 的 prompt 准入事务消费。
不能在插件里直接把上传回执解释为路径，也不能用另一 Session 的回执开始分析。
原生跨 Workspace 附件携带会重新建立 stage；这属于 Harness 的行为，插件不复制它。[2]

### 公开可读映射已经存在

准入后的 `FileBlock` 携带 `FileAttachmentRef`，包含不透明 `attachmentId`、规范化显示名 `name` 与 `bytes`。
公开 `ctx.attachments.fileHostPath(ref)` 和 `ctx.fs.processPathFromHostPath(...)` 可组合得到当前执行世界的路径；
Harness 自己就使用这条路径生成模型可见的文件描述符。无法映射时，描述符明确说明没有可读路径。[4]

因此，“必须先找到公开文件映射”的前置问题可以收敛为：**对当前已准入附件，证明公开映射在实际
Marivo Shell 执行环境中可读，并核验所属 Session、Workspace 与 bound project root。**
不必为了满足措辞而强制复制每个文件进 Workspace。

通用文件的公开读取是 `readFileStream(ref, signal)`。`session.attachment` RPC 是图片读取入口，
`workspaceFiles` 的 read/readBytes 受 Workspace containment 限制，二者都不能充当任意 Host 附件导入服务。[4]

### 路径存在不等于完整性已经验证

发布包的 `fileHostPath` 不完成存在性或内容摘要校验，也不校验 Session 授权。
`readFileStream` 在完整消费后完成长度和摘要检查。合成损坏文件的实测结果是先 yield 33 bytes，
随后抛出 `ATTACHMENT_CORRUPT`。不能把已收到的流块当作已通过完整性检查的数据。

如实现需要 Workspace 副本，应先写入临时文件，完整读取并校验成功后再发布副本和执行分析；
取消或失败不发布可分析对象。路径直读方案也需要明确分析前的完整性保证，不能声称单靠路径投影已验证字节。
选择哪条接法应以真实 Shell 的路径可达性与最少新增状态为依据。

同内容不同文件名可能共享内容摘要；同名不同内容则是不同对象。显示名、完整引用与所属消息应一起保留，
不能按 basename 或摘要前缀猜文件。暂存凭证不可跨 Session 使用，不等于禁止 Harness 的合法 fork/resume
继承持久附件；授权依据应是当前 Session 已准入或继承的引用。[4]

## 单文件分析不需要语义层

### 使用公开 SQL 路径

`md.raw_sql(datasource, sql, reason=..., limit=..., timeout_seconds=...)` 是现有公开路径。
对文件型 DuckDB datasource，可直接查询 `read_csv_auto(...)` 等 reader，执行过滤、聚合、排序或结构检查。
这条路径不用定义 `ms.entity`、`ms.measure`、`ms.metric`，也不用先填 `md.csv(..., schema=...)`。[5]

之前对 typed CSV 的调查只说明：`md.csv` 要求显式 schema，`md.inspect` 本身对 CSV 不读取文件或推断列。
它不是 SQL 文件分析的障碍。把 typed source authoring 作为所有附件的入口，会给这个场景增加无必要的建模成本。[6]

`raw_sql` 的结果明确属于 terminal observation，`typed_reentry=false`。可以直接用它回答单文件问题，
或按现有展示契约生成 computed dataset；不能将这个结果冒充 typed MetricFrame 或 Marivo Evidence。
不需要为了展示一张表或图额外建立语义模型。[5][7]

### datasource 执行准备与语义建模分开处理

当前 `marivo_python` 在启动用户代码前，先 describe `datasources` 中的每个名称并验证其身份。
新名称尚未注册时，无法在同一次调用里先通过准入、再在用户代码中注册它。`datasources: []` 的公开含义是
本次不访问 datasource，不能用它隐瞒实际 SQL 数据访问。[8]

已有可用文件型 DuckDB datasource 时，这条路径可以直接验证。零定义 Workspace 的现有公开路径则涉及
`md.register(md.duckdb(...))` 与本地库初始化，会留下 Workspace 级 datasource 定义。
本轮 `:memory:` 的 read-only acquisition 探针失败，不能把内存数据库当作当前已经可用的替代。
直接把未注册 `DuckDBSpec` 传给 `md.raw_sql` 或 `md.connect` 也均得到 `TypeError`。

产品目标仍应是无需用户先配置引擎。应由 Marivo 提供或确认无需业务建模的临时 SQL 执行生命周期，
插件把它绑定到当前 Harness Session。若当前公开契约只能注册长期 datasource，应将这个差距明确列为
上游或集成前置，不能偷偷切换项目、修改 `models/`，或把创建长期数据源塞进“上传完成”。

最小上游需求可限定为：在当前 Runtime 的一次 operation 中，用临时 DuckDB 执行只读 SQL，
无需写 `models/datasources/`；复用现有 `RawSqlResult`、结果预算、超时、错误和关闭清理契约。
具体 API 名称或是否接受 `DuckDBSpec` 留给 Marivo 设计。Marivo 不接管 Harness Session，
Session/附件授权与持久引用恢复仍由 Harness 及插件接缝负责。

不建议经 `md.connect(...).backend.raw_sql` 取原生后端绕过现有结果预算与超时；
也不建议依赖空 credential resolver“碰巧可以读本地文件”。探针中的 resolver 调用次数为 0，
只能说明本地无凭据文件不触发 secret 请求，不能证明文件访问获得授权。

### Session 范围不等于进程内存寿命

`marivo_python` 每次调用使用独立 Python 进程。进程内 connection 或 temporary view 不会自然延续到下一轮。
单文件追问可以在每次执行时根据同一已准入文件重新建立读取关系；需要保留文件身份与解析选项，
不一定需要常驻 worker 或长期数据库表。[8]

关闭浏览器 Tab、Agent 休眠、Session 恢复和删除是不同生命周期事件。Harness 的持久附件当前不会自动回收；
本阶段不接管 Host 附件清理。若新增 Session 临时数据库或物化副本，必须单独说明所有者、恢复规则和删除条件，
不能在一次 Python 调用结束时删除后续追问仍依赖的文件。

## 四种文件的支持契约

四种格式应使用同一条附件准入与 SQL 执行路径，差异放在 DuckDB reader 和有界读取选项中。
“支持文件类型”不能只靠扩展名判断：上传成功、reader 可用、文件可解析和分析结果正确是不同的验收点。

| 类型 | SQL 读取方向 | 当前默认可用性 | 必须明确的格式边界 |
| --- | --- | --- | --- |
| CSV | `read_csv` / `read_csv_auto` | 已通过 SQL 实测 | 表头、分隔符、编码、日期与混合类型；不静默跳过坏行 |
| JSON | `read_json` / `read_json_auto` | 对象数组和 JSON Lines 已通过 Marivo SQL 实测 | 保留 reader 实际结构，必要时显式选择字段或展开数组，不假定任意 JSON 都是一张平表 |
| Parquet | `read_parquet` | 已通过 Marivo SQL 实测 | 优先使用文件自带 schema；保留 decimal、timestamp、null 和嵌套类型 |
| Excel `.xlsx` | `read_xlsx` | 当前 `excel` 扩展未安装，关闭自动安装时读取失败 | 工作表、表头与单元格范围 |
| Excel `.xls` | 无官方 reader | 不支持 | 如需兼容，另行定义转换依赖与验收 |

JSON/Parquet 的 Marivo 探针先设置并查询确认 `autoinstall_known_extensions=false`、
`autoload_known_extensions=false`，随后读取成功；扩展清单显示两者为 `STATICALLY_LINKED`。
独立 DuckDB 格式探针在禁止自动安装时也验证 CSV/JSON/Parquet 成功，`.xlsx` 因缺少 `excel` 失败。
Excel 失败探针是同一 Python Runtime 的底层 DuckDB 检查，不是完整 Marivo Tool 验收。

CSV/JSON 自动识别是 reader 对物理结构的判断，不自动赋予字段业务含义；Parquet 也不能仅因类型完整就推断指标口径。
Excel 不指定 sheet 时默认读取第一张表。仅确认目标就是第一张表时采用默认值；已明确目标 sheet 时显式指定，
目标不明确时才请用户选择，不合并所有工作表或静默挑一张。[9][10]

Excel `.xlsx` 依赖 DuckDB 官方 `excel` 扩展。当前默认 autoinstall/autoload 均开启，官方支持首次使用时获取并加载，
但本轮未尝试在线安装。自动安装/加载能力不等于插件已打包、离线可用，
若承诺四种格式默认可用，Runtime 准备与验收必须包含该扩展。插件不应另做一套 Excel→CSV 转换器。
旧 `.xls` 如也需要支持，应另行明确转换依赖与范围，不用“Excel”一词笼统承诺。[10]

## 有界执行与可追踪结果

首次检查只取回答问题所需的文件结构与少量样本，接着执行具体 SQL。读取记录、检查编码、完整扫描统计
和最终结果输出应分别设预算。结果 `LIMIT` 不等于文件扫描量有限，聚合、排序和 reader 推断仍可能读完整文件。[5]

产品至少应披露文件名、选定 sheet/JSON 路径等解析范围、执行状态和实质错误。统计结论要区分完整文件与样本；
坏行、截断、推断失败不能转成“文件为空”或成功结果。路径、扩展名、工作表名等文件元数据不得直接拼成 SQL
语法；由明确的 literal/identifier 转义或公开参数机制处理。当前 `md.raw_sql` 没有 `params` 参数；
探针通过 SQL literal 转义验证了含空格与单引号的文件名。文件 reader 还接受 glob，
因此必须保证实际命中一个已准入文件，SQL 转义本身不能防止把文件名通配符解释成其他文件。

本轮 25,000 行 CSV 的 `limit=2` 预览返回 2 行并标记截断；同样 `limit=2` 的 `COUNT/SUM`
返回 1 行但统计了全部 25,000 行。每次调用记录到 1 条包含文件路径的 SQL，不代表文件只打开或读取一次。
`timeout_seconds` 也不是完整调用 deadline：连接握手另有默认 30 秒预算，外层仍需服从 Harness 取消与超时。

复用 `marivo_python` 的取消、超时、Host sandbox、Runtime identity 和 codeRef。
一次执行验收应分别记录用户 Python 启动次数、connection test 次数与实际 SQL 查询次数，
不把 Help/describe 的子进程数量算成分析重放。准备失败时用户 Python 启动应为 0；单次成功调用应为 1；
执行结果未知时不自动重放，也不承诺跨崩溃的 exactly-once。[8]

报告直接复用现有 computed writer、`marivo_present`、原生右侧 Tab 和离线 reader。
来源说明保留这是哪个附件与哪次 SQL 的结果；不要为了有来源卡片制造语义定义或虚假的 Artifact 引用。[7]

## 建议实施顺序与验收

| 切片 | 范围 | 完成证据 |
| --- | --- | --- |
| 3a：公开链路与格式基线 | 合成四格式文件、已准入引用、实际 Shell 读取、当前 Runtime reader 可用性 | 原生 Web prompt → 同 Runtime SQL 的完整证据；扩展未就绪明确失败 |
| 3b：Session 临时 SQL 执行准备 | 明确无需业务建模的 DuckDB 生命周期与 `marivo_python` 准入 | 空 Workspace 上传即用；无隐式语义文件写入；取消、休眠/恢复与下一轮追问 |
| 3c：最小产品闭环 | 默认文件读取、必要解析选择、SQL 答案与可选图表 | 单文件四格式真实模型任务；问题范围、解析结果、执行次数和来源一致 |

3a 中已有 datasource 的成功不能替代 3b。四格式能力探针也不能替代真实浏览器与模型链路。
代码只补探针证实的缺口，不预先新增上传 Tool、文件管理服务、后台数据库服务或永久数据源目录。

验收应覆盖以下独立维度：

| 维度 | 关键用例 |
| --- | --- |
| 意图与准入 | 仅上传不分析；提交一次分析；未准入或其他 Session 回执拒绝；合法 fork/resume 继承 |
| 身份 | 同名异内容、同内容异名、旧附件追问、Workspace 切换、配置覆盖 project root |
| 文件 | 空文件、表头-only、损坏文件、坏行、路径特殊字符、重复列名、中文编码、宽表 |
| JSON | 对象数组、JSON Lines、嵌套字段、缺失 key、类型冲突、错误 JSON |
| Excel | 扩展缺失与就绪、单/多 sheet、明确范围、混合类型、日期、公式值、旧 `.xls` 明确失败 |
| Parquet | null、decimal、timestamp、嵌套类型、损坏元数据 |
| 生命周期 | 上传取消/重试、分析取消、超时、休眠恢复、读取期间撤销 Workspace、插件卸载 |
| 执行与输出 | 准备失败 0 次用户代码、单次启动、截断可见、全量/样本区别、展示失败不重跑 SQL |

可复用现有 `python-execution-real.test.ts`、`execution-admission.test.ts` 和
`credential-validation-fixture.ts` 的真实 Shell、取消及计数基础；新增格式样例只使用合成数据。[8]

## 隔离探针记录

以下本地研究证据保存在被 Git 忽略的 `artifacts/dsh-file-stage-three-research/`，不随产品包分发。
它们分层验证能力，尚未证明组合后的默认用户流程可用。

| 探针 | 已观测结果 | 明确未覆盖 |
| --- | --- | --- |
| [附件服务结果](../artifacts/dsh-file-stage-three-research/attachment-result.json)与[脚本](../artifacts/dsh-file-stage-three-research/attachment-probe.mjs) | 存储、流读、FileBlock、模型文本投影、路径映射、同名/同内容、取消、损坏检测 | 真实浏览器、Session Controller transaction、模型与 Marivo |
| [Marivo CSV/SQL 结果](../artifacts/dsh-file-stage-three-research/marivo-csv-result.txt)与[脚本](../artifacts/dsh-file-stage-three-research/marivo-csv-probe.py) | 未注册/内存库失败、文件型 DuckDB 成功、查询计数、截断、聚合与零 secret 请求 | Harness `marivo_python`、真实附件与 Session 生命周期 |
| [Marivo JSON/Parquet 结果](../artifacts/dsh-file-stage-three-research/marivo-formats-result.txt)与[脚本](../artifacts/dsh-file-stage-three-research/marivo-formats-probe.py) | 自动安装和加载均关闭时，JSON array、NDJSON、Parquet 读取成功 | 任意格式变体、复杂嵌套与完整性能预算 |
| [Excel 与扩展清单](../artifacts/dsh-file-stage-three-research/excel-capability.json) | 同一 Runtime 的 DuckDB 四格式探针；Excel 未安装、禁止自动安装时失败 | 安装后的 `.xlsx` 成功、Marivo Tool、真实浏览器 |

附件脚本由本次实际探针整理保存并通过语法检查，保存后没有重复执行；JSON 是本次实际执行结果。
Python 脚本使用当前 shared Runtime 的解释器运行，并在系统临时目录创建合成 Workspace；
日志中的临时文件路径仅用于定位研究样例，不能作为产品或真实用户数据输入。

## 来源

1. 本仓库：[兼容 manifest](../packages/dsh-data-analysis/package.json)、[Runtime 与 Workspace](modules/runtime-workspace.md)。
2. Harness `dsh-v0.1.5-alpha.1`：[File Upload](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/file-upload/README.zh.md)。
3. Harness `dsh-v0.1.5-alpha.1`：[附件 UI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/ui-attachment/README.zh.md)。
4. Harness `dsh-v0.1.5-alpha.1`：[AttachmentStore](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/attachment/attachment/src/index.ts)、[公开类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/attachment/attachment/src/types.ts)、[文件系统映射](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/fs/fs/src/index.ts)。同时核对已发布 package 的 `lib`。
5. Marivo `v0.5.4`：[datasource management 与 raw_sql](https://github.com/chengxianglibra/marivo/blob/v0.5.4/marivo/datasource/manage.py)。
6. Marivo `v0.5.4`：[typed source](https://github.com/chengxianglibra/marivo/blob/v0.5.4/marivo/datasource/source.py)、[inspection](https://github.com/chengxianglibra/marivo/blob/v0.5.4/marivo/datasource/inspection.py)。
7. 本仓库：[展示 Skill](modules/presentation-skill.md)、[computed projection](modules/presentation-projection.md)、[展示交付](modules/presentation-delivery.md)。
8. 本仓库：[Python Tool](../packages/dsh-data-analysis/src/datasource/python.ts)、[执行准入](../packages/dsh-data-analysis/src/datasource/service.ts)、[worker 身份](../packages/dsh-data-analysis/src/datasource/resolver-program.ts)、[真实执行测试](../packages/dsh-data-analysis/tests/datasource-credentials/python-execution-real.test.ts)、[准入测试](../packages/dsh-data-analysis/tests/datasource-credentials/execution-admission.test.ts)、[真实计数 fixture](../packages/dsh-data-analysis/scripts/credential-validation-fixture.ts)。
9. DuckDB：[文件读取](https://duckdb.org/docs/current/data/overview)、[CSV 自动识别](https://duckdb.org/docs/lts/data/csv/auto_detection)、[JSON reader](https://duckdb.org/docs/lts/data/json/loading_json)、[Parquet reader](https://duckdb.org/docs/lts/data/parquet/overview)。
10. DuckDB：[Excel Import](https://duckdb.org/docs/current/guides/file_formats/excel_import)、[Excel 扩展](https://duckdb.org/docs/lts/core_extensions/excel)、[自动安装与加载配置](https://duckdb.org/docs/current/operations_manual/securing_duckdb/securing_extensions)。
