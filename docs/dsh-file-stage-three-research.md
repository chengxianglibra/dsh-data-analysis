# 第三阶段：Session 文件分析调研

## 结论与建议范围

第三阶段定位为 **Session 内上传文件，直接使用绑定 Runtime 中的 pandas 或原生 DuckDB 分析**。
首版验收目标为 CSV、JSON、Excel `.xlsx` 与 Parquet 的单文件问题。用户无需注册 datasource、
调用 `md.raw_sql` 或建立语义模型；字段类型识别属于 reader 的物理读取，不是业务语义建模。

插件值得补齐的是简洁的文件分析路由、现有报告交付与真实上传验收。Harness 已拥有附件上传、进度、
取消、重试和模型可见的文件路径；pandas／DuckDB 已拥有读取与计算能力。纯本地分析使用
`marivo_python(datasources: [])`，复用 Runtime/Workspace identity、取消、代码记录和 computed 报告，
不要求 Marivo 分析 Skill 或 live Help。原生 DuckDB 支持同一调用内的多条 SQL、临时表和 pandas 互操作；
插件不为本地文件强制增加 `md.raw_sql` 包装。

以下保留 Marivo `0.5.5` 的已有可行性证据，它们说明可选路径已经可用，不作为首版的强制执行链路：

- 内建 `default` 是免注册、无凭据的内存 DuckDB。`md.raw_sql` 已通过 CSV、JSON、JSON Lines、Parquet 与 `.xlsx` 合成文件验证。
- `marivo_python(datasources: ["default"])` 的 CSV Tool/Shell 与取消探针已通过；此声明只适用于实际访问 Marivo datasource 的代码。
- `.xlsx` 首次读取自动下载并加载官方扩展，独立连接再次读取成功；这不等于冷缓存离线可用。
- 这些研究探针没有运行真实浏览器上传或模型任务。探针时已运行的 Web profile 仍兼容 Marivo `0.5.4`，Runtime 升级不等于该 Web 实例已切换。

首个实施切片为[文件分析 Skill](modules/file-analysis-skill.md)、两条简短示例、展示路由与四格式真实验收。
不增加上传 Tool、文件管理服务、Python 依赖或报告 schema；只在实际验收发现路径接缝缺口时补相应代码。
本记录中的历史探针与后续产品验收分开报告，不能以单层 API 成功宣布上传分析闭环完成。

## 基线与证据范围

首次调研日期为 2026-09-09，Marivo `0.5.5` API 复验日期为 2026-09-10。该次研究的插件基线为 `fd16a25`，
兼容契约已固定 Marivo `0.5.5`。实际安装的 DSH 包仍为 `0.1.5-alpha.1`，本地 Harness checkout
为同一发布 tag 的 `5dda764ed3aa172535a7967b06ff95d9cbfe536a`。[1]

公开 Marivo 契约对照 `v0.5.5`，tag 对应 commit `c86447eeff613e67907a7dbbd8d3bd20b1c6d88e`；
执行事实以安装包的真实导入与探针为准，不用本地开发 checkout 的后续工作替代。

| 环境 | 已确认状态 | 证据边界 |
| --- | --- | --- |
| 隔离 managed Runtime | Python `3.14.4`、Marivo `0.5.5`、DuckDB `1.5.5`、Ibis `12.0.0`、PyArrow `25.0.1` | 公开 SQL/格式探针和真实插件 Tool smoke 已通过；使用合成 Workspace |
| 默认 shared Runtime | 已由现有 installer 升级为 Marivo `0.5.5`，保留 Python `3.10.20`；DuckDB `1.5.5`、Ibis `12.0.0`、PyArrow `25.0.1`；重复 ensure 已确认复用 | [升级记录](../artifacts/dsh-file-stage-three-revalidation/default-runtime-upgrade.json)保留 marker 前后状态；公开 API 格式复验与真实插件 Tool smoke 均通过 |
| API 复验时已运行的 DSH Web profile | 当时安装兼容 Marivo `0.5.4` 的插件，研究未重装或重启它 | API 探针不证明该实例与升级后的 Runtime 匹配，也不证明浏览器上传或模型验收 |

该次研究已升级默认 Runtime；Excel 探针首次读取时自动将官方扩展安装到用户 DuckDB 缓存，未显式执行 `INSTALL` 或 `LOAD`。
研究探针未在真实用户 Session 上传文件、运行真实模型或修改业务 Workspace。Tool smoke 使用真实 ToolRuntime、ShellEnv 与 Shell，但关闭 telemetry，
返回 `sandbox: null`，因此不构成 Host sandbox 或 Web 部署验收。完整 Web → prompt →
`marivo_python` 验收单独记在[文件分析验收](file-analysis-acceptance.md)。这些结论针对已记录的安装版本，不承诺任意依赖版本自动通过。

## 哪些工作有价值且可以做

| 工作 | 用户价值 | 当前可行性与边界 | 建议 |
| --- | --- | --- | --- |
| 原生附件进入文件分析 | 上传后直接提问，无需手工搬文件 | 复用公开附件路径、pandas／DuckDB 与 Python Tool，补 Skill 路由和组合验收 | 第三阶段主线 |
| CSV、JSON、Parquet 默认可读 | 覆盖常见导出、日志与分析数据 | 由当前 Runtime 的 reader 探针确认；插件不写解析器 | 一起纳入首个完整验收 |
| Excel `.xlsx` 可读与工作表选择 | 覆盖业务常见输入 | 默认首次自动安装/加载与独立连接读取已通过；需补工作表选择和下载失败验收 | 复用官方 reader，明确首次联网依赖 |
| 零定义 Workspace 直接计算 | 无需用户配置引擎即可分析 | pandas／原生 DuckDB 使用 `datasources: []`；Marivo `default` 仍是可选路径 | 不强制包装原生能力 |
| 有界检查、过滤、聚合、排序和简单图表 | 直接回答单文件问题 | 调用方控制 SQL 范围与 `LIMIT`；结果复用现有 computed 展示路径 | 复用现有工具与 reader |
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

## 已验证的可选 Marivo SQL 路径

### 使用公开 SQL 路径

`md.raw_sql(datasource, sql, reason=..., timeout_seconds=..., include_types=...)` 是 `0.5.5` 的公开路径。
使用内建 `ms.ref.datasource("default")`，即可查询 `read_csv_auto(...)` 等 reader，执行过滤、聚合、排序或结构检查。
这条路径不用定义 `ms.entity`、`ms.measure`、`ms.metric`，也不用先填 `md.csv(..., schema=...)`。[5]

以下代码展示执行形态；`admitted_path` 必须来自当前 Session 已准入附件的公开映射，并已通过单文件匹配与完整性检查。
调用 `marivo_python` 时声明 `datasources: ["default"]`。`marivo.semantic` 在此只用于构造公开 datasource 引用，
不会创建语义模型：

```python
import marivo.datasource as md
import marivo.semantic as ms

path_literal = "'" + admitted_path.replace("'", "''") + "'"
result = md.raw_sql(
    ms.ref.datasource("default"),
    f"SELECT * FROM read_csv_auto({path_literal}) LIMIT 50",
    reason="预览当前已准入 CSV 的字段与前 50 行",
    timeout_seconds=10,
)
print(result.rows)
```

`0.5.5` 不再接受 `limit` 参数，`RawSqlResult` 也不再包含 `is_truncated` 或 `requested_limit`。
它完整读取提交 SQL 的结果，调用方需要在 SQL 中使用过滤、聚合或 `LIMIT` 控制结果规模，
不能沿用旧版参数或把返回行数当作完整源文件行数。[5]

此前 typed CSV 路径要求显式 schema 的结论只描述 typed source authoring；
它不是 SQL 文件分析的前置。插件不应为了读取文件而补建语义定义。[6]

`raw_sql` 的结果明确属于 terminal observation，`typed_reentry=false`。可以直接用它回答单文件问题，
或按现有展示契约生成 computed dataset；不能将这个结果冒充 typed MetricFrame 或 Marivo Evidence。
不需要为了展示一张表或图额外建立语义模型。[5][7]

### 内建 default 已满足临时执行准备

当前 `marivo_python` 在启动用户代码前，先 describe `datasources` 中的每个名称并验证其身份。
`0.5.5` 的 `md.list()`、`md.describe("default")` 已包含内建 DuckDB，属性为 `path=":memory:"`、
`read_only=false`，无凭据引用，且无需注册。`default` 为保留名称，不应创建同名用户 datasource。
`raw_sql` 获取它时使用只读 transaction；探针确认表写入被拒绝，失败后仍可继续执行新查询。[5]

使用升级后默认 shared Runtime 的真实插件 smoke，在初始不存在 `models/` 和 `marivo.toml` 的合成 Workspace 中声明
`datasources: ["default"]`，成功得到 CSV `COUNT=2`、`SUM=30`，计数为 Tool 1 次、Shell 启动 1 次、
connection test 0 次、credential describe/resolve 0 次。单独取消用例确认 worker 已退出，没有自动重放。[8]

因此，选择 Marivo SQL 时无需等待上游新增临时引擎 API，也无需 `md.register(...)` 或写入语义定义。
这里的 `datasources` 声明 Marivo datasource：访问 `default` 必须声明它；纯 pandas／原生 DuckDB 本地文件
分析使用 `[]`。Marivo 只拥有其 API 路径的连接、只读执行、查询超时与关闭契约；直接使用原生 DuckDB
由调用代码管理连接，外层仍受 Harness Shell 取消、超时和 Session/Workspace 边界约束。

“无需定义”不等于“完全不写文件”。使用默认 telemetry 的公开 API 探针创建了 `.marivo/telemetry/`，
但没有创建 `models/`、`marivo.toml` 或数据库文件。Tool smoke 关闭 telemetry，不能将其文件清单推广为默认行为。

`md.raw_sql` 可用于需要 Marivo datasource 身份和查询契约的任务；本地文件分析可以直接使用原生
`duckdb.connect`，不需要从 Marivo 取得 backend。
无 credential 请求只能证明内建执行不需要 secret，不能代替当前附件的访问授权。

### Session 范围不等于进程内存寿命

`marivo_python` 每次调用使用独立 Python 进程。原生 DuckDB 连接可在一次调用内复用、创建临时表，
但不会跨调用持久化；内建 `default` 的每次连接也各自拥有独立内存数据库。
即使在同一进程，另一次连接也无法看到前一次创建的表。`raw_sql` 完成或失败后关闭其后端，
connection 或 temporary view 不会自然延续到下一轮。
单文件追问可以在每次执行时根据同一已准入文件重新建立读取关系；需要保留文件身份与解析选项，
不一定需要常驻 worker 或长期数据库表。[8]

关闭浏览器 Tab、Agent 休眠、Session 恢复和删除是不同生命周期事件。Harness 的持久附件当前不会自动回收；
本阶段不接管 Host 附件清理。默认采用已有内存连接；如为路径可达性新增物化副本，应说明所有者、恢复规则和删除条件，
不能在一次 Python 调用结束时删除后续追问仍依赖的文件。

## 四种文件的支持契约

四种格式复用同一条附件准入与 Python 执行路径，由任务选择 pandas 或原生 DuckDB reader。
下表保留此前 Marivo API 探针的实际结果，并未把它们重写成原生 DuckDB 或完整产品验收。
“支持文件类型”不能只靠扩展名判断：上传成功、reader 可用、文件可解析和分析结果正确是不同的验收点。

| 类型 | SQL 读取方向 | Marivo 0.5.5 实测状态 | 必须明确的格式边界 |
| --- | --- | --- | --- |
| CSV | `read_csv` / `read_csv_auto` | `md.raw_sql(default)` 聚合成功，且通过插件 Tool smoke | 表头、分隔符、编码、日期与混合类型；不静默跳过坏行 |
| JSON | `read_json` / `read_json_auto` | 对象数组和 JSON Lines 均通过 `md.raw_sql(default)` | 保留 reader 实际结构，必要时显式选择字段或展开数组，不假定任意 JSON 都是一张平表 |
| Parquet | `read_parquet` | 已通过 `md.raw_sql(default)` 聚合 | 优先使用文件自带 schema；保留 decimal、timestamp、null 和嵌套类型 |
| Excel `.xlsx` | `read_xlsx` | `md.raw_sql(default)` 首次自动安装/加载成功，第二次独立连接读取也成功 | 冷缓存需获取官方扩展；工作表、表头与单元格范围 |
| Excel `.xls` | 无官方 reader | 不支持 | 如需兼容，另行定义转换依赖与验收 |

`0.5.5` 公开 API 探针对 CSV、JSON array、NDJSON 与 Parquet 均返回 `COUNT=2`、`SUM=30`。
JSON 与 Parquet 为 `STATICALLY_LINKED`。Excel 合成文件返回 `COUNT=3`、`SUM=60.0`；
复杂嵌套、日期与混合类型仍需补充格式验收。
插件 Tool smoke 当前只覆盖 CSV，不能用公开 API 四种 reader 的状态代替四格式真实 Tool/模型验收。

CSV/JSON 自动识别是 reader 对物理结构的判断，不自动赋予字段业务含义；Parquet 也不能仅因类型完整就推断指标口径。
Excel 不指定 sheet 时默认读取第一张表。仅确认目标就是第一张表时采用默认值；已明确目标 sheet 时显式指定，
目标不明确时才请用户选择，不合并所有工作表或静默挑一张。[9][10]

Excel `.xlsx` 依赖 DuckDB 官方 `excel` 扩展。默认 autoinstall/autoload 均开启；实际 shared Runtime
在扩展原先为 `NOT_INSTALLED` 的情况下，首次 `read_xlsx` 自动获取 `core` 扩展并成功读取，耗时约 16.6 秒；
第二次独立 `raw_sql` 连接从缓存加载并成功读取，约 0.018 秒。这里只记录本机合成样例，不作为性能承诺。
扩展缓存位于 `~/.duckdb/extensions/v1.5.5/osx_arm64/`，由 DuckDB 版本与平台区分，不属于某个 Workspace 的内存库。
当前默认 shared Runtime 的公开 `raw_sql` 直接读取 `.xlsx` 已验证，但不能承诺未预置扩展时冷缓存离线可用；目标部署应验证下载失败、
缓存就绪及 Host sandbox 的网络/路径边界。插件不应另做一套 Excel→CSV 转换器。
旧 `.xls` 如也需要支持，应另行明确转换依赖与范围，不用“Excel”一词笼统承诺。[10]

## 有界执行与可追踪结果

pandas 与原生 DuckDB 都应按任务控制读取和输出范围，不能仅靠 Shell 输出裁剪控制计算内存。
以下 `raw_sql` 参数与结果说明专属于已验证的可选 Marivo 路径。

首次检查只取回答问题所需的文件结构与少量样本，接着执行具体 SQL。`0.5.5` 的 `raw_sql` 没有隐式行数或字节上限，
全部返回行会进入客户端内存。调用方应明确样本 SQL、过滤条件、聚合范围和输出规模；Shell 输出裁剪也不能降低此前的
SQL 结果内存占用。结果 `LIMIT` 不等于文件扫描量有限，聚合、排序和 reader 推断仍可能读完整文件。[5]

产品至少应披露文件名、选定 sheet/JSON 路径等解析范围、执行状态和实质错误。统计结论要区分完整文件与样本；
坏行、推断失败以及展示层或 Shell 输出裁剪不能转成“文件为空”或完整成功结果。路径、扩展名、工作表名等文件元数据不得直接拼成 SQL
语法；由明确的 literal/identifier 转义或公开参数机制处理。当前 `md.raw_sql` 没有 `params` 参数；
探针通过 SQL literal 转义验证了含空格与单引号的文件名。文件 reader 还接受 glob，
因此必须保证实际命中一个已准入文件，SQL 转义本身不能防止把文件名通配符解释成其他文件。

`0.5.5` 实测对 250 行查询没有隐式裁剪，添加 SQL `LIMIT 2` 后返回 2 行；旧 `limit=` 参数直接得到 `TypeError`。
`RawSqlResult` 没有 `is_truncated`，SQL `LIMIT` 返回的是该查询的完整结果，不能据此声称扫描或分析了完整源文件。
执行记录中的 SQL 次数也不等于文件打开或读取次数。
`timeout_seconds` 也不是完整调用 deadline：连接握手另有默认 30 秒预算，外层仍需服从 Harness 取消与超时。

复用 `marivo_python` 的取消、超时、Runtime identity、codeRef 及 Host 配置的 sandbox 边界；
本轮 Tool smoke 的 `sandbox: null` 只证明无 sandbox 的真实 Shell 路径，Host sandbox 仍需在目标部署中验收。
一次执行验收应分别记录用户 Python 启动次数、connection test 次数与实际 SQL 查询次数，
不把 Help/describe 的子进程数量算成分析重放。准备失败时用户 Python 启动应为 0；单次成功调用应为 1；
执行结果未知时不自动重放，也不承诺跨崩溃的 exactly-once。[8]

报告直接复用现有 computed writer、`marivo_present`、原生右侧 Tab 和离线 reader。
来源说明保留这是哪个附件、哪些读取范围与哪次执行的结果；关联实际 `codeRef`，
不要为了有来源卡片制造语义定义或虚假的 Artifact 引用。[7]

## 建议实施顺序与验收

| 切片 | 范围 | 完成证据 |
| --- | --- | --- |
| 3a：文件 Skill 与路由 | 直接文件分析使用简短 Skill；pandas／原生 DuckDB 都经 `marivo_python(datasources: [])`；展示指引复用已有 Skill | Skill 可发现、可加载、随插件释放；不触发 Marivo 根 Help；两条示例可执行并随包分发 |
| 3b：四格式与 Session 追问 | 复用 native reader 和附件可读路径；明确 `.xlsx` 扩展获取与 sheet／读取范围 | 原生 receipt → 真实模型 → Python；四格式结果正确，同名文件、旧附件追问与恢复保持正确输入身份 |
| 3c：最小报告闭环 | DataFrame → computed writer → `marivo_present`；正文说明文件与范围，关联实际 codeRef | 至少一次真实文件报告交付；报告数值、代码和输入范围一致，无虚构 Artifact 来源 |

Marivo `default` API 与 Tool 准入已经验证，不再作为新增引擎需求，也不是纯文件分析的前置。
历史四格式公开 SQL 的成功不能替代目标部署、原生附件与真实模型链路；完整产品验收单独记录。
代码只补实际发现的接缝缺口，不增加上传 UI、常驻数据库服务或永久数据源目录。

后续扩展验收可按以下独立维度选取用例；本次已执行范围以[验收记录](file-analysis-acceptance.md)为准：

| 维度 | 关键用例 |
| --- | --- |
| 意图与准入 | 仅上传不分析；提交一次分析；未准入或其他 Session 回执拒绝；合法 fork/resume 继承 |
| 身份 | 同名异内容、同内容异名、旧附件追问、Workspace 切换、配置覆盖 project root |
| 文件 | 空文件、表头-only、损坏文件、坏行、路径特殊字符、重复列名、中文编码、宽表 |
| JSON | 对象数组、JSON Lines、嵌套字段、缺失 key、类型冲突、错误 JSON |
| Excel | 扩展缺失与就绪、单/多 sheet、明确范围、混合类型、日期、公式值、旧 `.xls` 明确失败 |
| Parquet | null、decimal、timestamp、嵌套类型、损坏元数据 |
| 生命周期 | 上传取消/重试、分析取消、超时、休眠恢复、读取期间撤销 Workspace、插件卸载 |
| 执行与输出 | 准备失败 0 次用户代码、单次启动、显式 SQL 范围、展示/输出裁剪可见、全量/样本区别、展示失败不重跑 SQL |

可复用现有 `python-execution-real.test.ts`、`execution-admission.test.ts` 和
`credential-validation-fixture.ts` 的真实 Shell、取消及计数基础；新增格式样例只使用合成数据。[8]

## 实测证据与历史记录

以下本地研究证据保存在被 Git 忽略的 `artifacts/dsh-file-stage-three-revalidation/` 与
`artifacts/dsh-file-stage-three-research/`，不随产品包分发。它们分层验证能力，
本身不证明组合后的原生上传与模型用户流程；后续证据见[文件分析验收](file-analysis-acceptance.md)。

### Marivo 0.5.5 当前证据

| 探针 | 已观测结果 | 明确未覆盖 |
| --- | --- | --- |
| [默认 Runtime 升级记录](../artifacts/dsh-file-stage-three-revalidation/default-runtime-upgrade.json) | Marivo `0.5.4` → `0.5.5`，保留 Python `3.10.20`；installation marker 更新与重复 ensure 复用 | 已运行 Web 插件的重装、重启与绑定刷新 |
| [默认 Runtime API 结果](../artifacts/dsh-file-stage-three-revalidation/default-runtime-evidence.json)与[脚本](../artifacts/dsh-file-stage-three-revalidation/runtime-probe.py) | 内建 `default` 免注册；CSV/JSON/NDJSON/Parquet 聚合成功；250 行完整返回与 SQL `LIMIT 2`；只读 transaction、连接隔离与失败后可用 | 真实附件、模型、Excel 安装后读取；任意格式变体与完整性能预算 |
| [默认 Runtime Excel 自动加载结果](../artifacts/dsh-file-stage-three-revalidation/excel-autoload-evidence.json)与[脚本](../artifacts/dsh-file-stage-three-revalidation/excel-autoload-probe.py) | 未改配置、未显式 `INSTALL`/`LOAD`；首次从 `core` 自动安装，独立连接再次自动加载；两次 `COUNT=3`、`SUM=60.0` | 冷缓存离线、Host sandbox、多 sheet、复杂类型和真实上传/模型任务 |
| [默认 Runtime 插件 Tool 结果](../artifacts/dsh-file-stage-three-revalidation/plugin-smoke-evidence.json)与[脚本](../artifacts/dsh-file-stage-three-revalidation/plugin-smoke.ts) | 真实 ToolRuntime、ShellEnv、Shell；`datasources: ["default"]` 的 CSV `COUNT=2`、`SUM=30`；一次 Tool/一次 Shell、零 connection test/credential 请求；取消 worker 退出无重放 | telemetry 已关闭、`sandbox: null`；无浏览器、原生上传 transaction、模型或其他格式 Tool 任务 |
| [隔离 Runtime API 结果](../artifacts/dsh-file-stage-three-revalidation/runtime-evidence.json)与[Tool 结果](../artifacts/dsh-file-stage-three-revalidation/plugin-smoke-isolated-runtime-evidence.json) | Python `3.14.4` managed Runtime 的同类公开 API 与 CSV Tool smoke 成功 | 不能替代默认 Python `3.10.20` Runtime 的复验；同样未覆盖 Web/模型 |

默认与隔离 Runtime 的公开 API 探针均使用合成 Workspace，默认 telemetry 可创建 `.marivo/telemetry/`；
没有创建 `models/`、`marivo.toml` 或数据库文件。Tool smoke 的关闭 telemetry 设置只属于验收 fixture，
没有改变产品默认配置。API 清单中的 Excel `NOT_INSTALLED` 是补充 Excel 探针之前的快照；
后续自动加载证据确认默认 Runtime 的用户缓存中已安装官方扩展，不能混用前后状态。

### Marivo 0.5.4 历史证据与仍适用的附件证据

2026-09-09 的 SQL 探针使用当时默认 shared Runtime：Python `3.10.20`、Marivo `0.5.4`。
当时未注册 datasource、`:memory:` 只读 acquisition 失败，以及 `limit`/截断字段存在的结论属于旧版事实，
已被本轮 `0.5.5` 对应探针取代，不能继续作为当前 blocker 或 API 用法。

| 探针 | 已观测结果 | 明确未覆盖 |
| --- | --- | --- |
| [附件服务结果](../artifacts/dsh-file-stage-three-research/attachment-result.json)与[脚本](../artifacts/dsh-file-stage-three-research/attachment-probe.mjs) | Harness `0.1.5-alpha.1` 存储、流读、FileBlock、模型文本投影、路径映射、同名/同内容、取消、损坏检测；仍适用 | 真实浏览器、Session Controller transaction、模型与 Marivo |
| [旧版 CSV/SQL 结果](../artifacts/dsh-file-stage-three-research/marivo-csv-result.txt)与[脚本](../artifacts/dsh-file-stage-three-research/marivo-csv-probe.py) | `0.5.4` 未注册/内存库失败、文件型 DuckDB 成功；25,000 行上的 `limit=2` 预览裁剪、聚合与零 secret 请求 | 不能作为 `0.5.5` 的准入或结果契约证据 |
| [旧版 JSON/Parquet 结果](../artifacts/dsh-file-stage-three-research/marivo-formats-result.txt)与[脚本](../artifacts/dsh-file-stage-three-research/marivo-formats-probe.py) | `0.5.4` 自动安装和加载均关闭时，JSON array、NDJSON、Parquet 读取成功 | 不能替代内建 `default`、新 Runtime 或真实模型验证 |
| [旧版 Excel 与扩展清单](../artifacts/dsh-file-stage-three-research/excel-capability.json) | 当时同一 Runtime 的 DuckDB 格式探针；Excel 未安装、禁止自动安装时失败 | 安装后的 `.xlsx` 成功、Marivo Tool、真实浏览器 |

附件脚本由首次实际探针整理保存并通过语法检查，保存后没有重复执行；JSON 保留首次实际执行结果。
各 Python 脚本使用对应记录中的解释器运行，并在系统临时目录创建合成 Workspace；
日志中的临时文件路径仅用于定位研究样例，不能作为产品或真实用户数据输入。

## 来源

1. 本仓库：[兼容 manifest](../packages/dsh-data-analysis/package.json)、[Runtime 与 Workspace](modules/runtime-workspace.md)。
2. Harness `dsh-v0.1.5-alpha.1`：[File Upload](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/file-upload/README.zh.md)。
3. Harness `dsh-v0.1.5-alpha.1`：[附件 UI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/ui-attachment/README.zh.md)。
4. Harness `dsh-v0.1.5-alpha.1`：[AttachmentStore](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/attachment/attachment/src/index.ts)、[公开类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/attachment/attachment/src/types.ts)、[文件系统映射](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/fs/fs/src/index.ts)。同时核对已发布 package 的 `lib`。
5. Marivo `v0.5.5`：[datasource management、内建连接与 raw_sql](https://github.com/chengxianglibra/marivo/blob/v0.5.5/marivo/datasource/manage.py)、[内建 default 定义](https://github.com/chengxianglibra/marivo/blob/v0.5.5/marivo/datasource/_builtin.py)。历史对照保留 [v0.5.4 raw_sql](https://github.com/chengxianglibra/marivo/blob/v0.5.4/marivo/datasource/manage.py)。
6. Marivo `v0.5.5`：[typed source](https://github.com/chengxianglibra/marivo/blob/v0.5.5/marivo/datasource/source.py)、[inspection](https://github.com/chengxianglibra/marivo/blob/v0.5.5/marivo/datasource/inspection.py)。
7. 本仓库：[展示 Skill](modules/presentation-skill.md)、[computed projection](modules/presentation-projection.md)、[展示交付](modules/presentation-delivery.md)。
8. 本仓库：[Python Tool](../packages/dsh-data-analysis/src/datasource/python.ts)、[执行准入](../packages/dsh-data-analysis/src/datasource/service.ts)、[worker 身份](../packages/dsh-data-analysis/src/datasource/resolver-program.ts)、[真实执行测试](../packages/dsh-data-analysis/tests/datasource-credentials/python-execution-real.test.ts)、[准入测试](../packages/dsh-data-analysis/tests/datasource-credentials/execution-admission.test.ts)、[真实计数 fixture](../packages/dsh-data-analysis/scripts/credential-validation-fixture.ts)。
9. DuckDB：[文件读取](https://duckdb.org/docs/current/data/overview)、[CSV 自动识别](https://duckdb.org/docs/lts/data/csv/auto_detection)、[JSON reader](https://duckdb.org/docs/lts/data/json/loading_json)、[Parquet reader](https://duckdb.org/docs/lts/data/parquet/overview)。
10. DuckDB：[Excel Import](https://duckdb.org/docs/current/guides/file_formats/excel_import)、[Excel 扩展](https://duckdb.org/docs/lts/core_extensions/excel)、[自动安装与加载配置](https://duckdb.org/docs/current/operations_manual/securing_duckdb/securing_extensions)。
