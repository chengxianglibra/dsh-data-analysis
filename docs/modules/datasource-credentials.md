# Datasource Credentials 模块

## 所有权与入口

DSH Credentials 保存、解析和描述凭证；Marivo 定义 datasource、凭证字段和连接失败语义；插件负责
Workspace 绑定、管理页面、等待中的调用和单次执行注入。凭证使用遵循 Marivo 公开的
`md.credential_scope(resolver)` 契约。

在 DSH 会话标题旁点击“数据源”，打开该会话所属 Workspace 的原生右侧 Tab，不提供 Workspace 筛选项。
数据源列表以横向卡片排列在内容上方，展示图标、名称、配置状态与进行中状态；标题右上角依次提供新增和刷新图标。
Tab 直接承载新增/编辑数据源、属性、凭证配置与连接测试，不再打开数据源弹出页。
每个 Tab occurrence 拥有独立的选择、表单和操作查询；共享监听器只分发 Host 凭证待办，
新待办及“等待配置凭证”入口打开所属会话的数据源 Tab。切换会话保留 Host Tab 状态；Workspace 绑定撤销时使旧页面失效。
刷新不终止已提交操作的状态查询，操作句柄按会话及 occurrence 保存用于页面重载恢复；不保存未提交的输入值。
入口通过 `conversation.session.header.actions` 使用所属会话的 `workspaceId`；
无会话或空会话时 Harness 不显示会话标题，侧栏底部不保留入口。管理页不要求 live Agent，显示 datasource、
引擎、连接属性、字段引用、是否配置、来源、是否可写和最近测试。连接属性只读展示公开 `md.describe()` 的
`backend_type` 与 `literal_fields`，凭证字段使用 `env_refs` 独立展示；读取属性不解析 Harness 凭据。
数据源名称右侧提供编辑配置图标，“连接状态”右侧提供测试连接图标；图标保留中文悬停提示和无障碍名称。
“删除已保存值”和确认删除按钮使用浅红色背景，深色模式使用对应的深红底色。
页面支持新增数据源，以及字段旁的“新增凭证”“确认更换”、删除和测试，不回显已保存的凭据值。替换与删除需要明确确认。
管理页的新增和更换直接保存当前字段，不自动测试尚未配齐的凭证，也没有独立的“保存并验证”按钮；“测试连接”使用已保存值。
等待中的调用使用“提交凭证并继续”保存整组输入并验证，成功后继续原调用。
同一原始引用跨 Workspace 共享；测试结果属于对应的环境和 datasource 定义，凭证更新后标记过期。
入口与“语义层”共用会话标题按钮样式；管理页按数据源列表、数据源属性、凭证配置与连接状态分区，
适配窄屏和深色模式。已结束的调用不再列入会话待办；当前打开的调用仍显示结束原因和返回管理入口。
页面只保留操作所需状态与反馈；常驻区域不重复解释安全机制、等待预算或连接测试的限定条件。
保存或连接失败、取消及凭证删除结果须保持面板可操作；`data-error` 布尔值与 `data-tone` 状态值直接
用于渲染，不经过文案翻译。连接测试失败时保留原调用的待处理状态，由用户修正配置后重新验证。

原始引用按 UTF-8 字节编码到 `DSH_DATA_ANALYSIS_CREDENTIAL_<HEX>`，区分大小写。只访问映射地址，
不回退到同名 Host credential。继续拒绝 `MARIVO_*`、`DSH_DATA_ANALYSIS_*` 和 Host 自有 Shell facts。

## 待办通知与连接生命周期

每个页面共享一个 `dshDataAnalysisCredentials.changes(sessionId, signal)` Remote stream，
通过 Harness 现有 Gateway WebSocket 多路复用。插件使用公开 Typert contribution 注册同一严格类型描述；
通知只有 `{ generation, cursor }`，不包含凭据、待办详情或执行参数。首次连接、恢复连接及版本变化后，
客户端调用旧 `watch` RPC，但不传 cursor，立即读取完整快照。同一订阅最多一个快照请求在途，
期间的通知合并为后续一次读取；切换 Session、断线和卸载取消旧订阅及读取，旧 generation 的响应不得回写。

连接 generation 丢失或 stream carrier 失败时，客户端立即取消该连接的快照请求，不等待 Harness 重连完成。
Host 遇到临时 `credential-state-unavailable` 时，在原订阅内以 1、2、5 秒（上限）的可取消退避重试；
其他契约错误仍终止订阅并明确报错。重试和断线均不重放凭证写入或取消原调用。

Host 继续复用状态变化唤醒与每 25 秒的上下文复核，未变化时不发送通知。HTTP watch 的 cursor 长轮询
协议保留兼容旧页面；新页面空闲时不占用凭证 HTTP 长轮询连接。断开通知不取消等待中的原调用，
凭据提交仍继续原调用，不重放写入。Harness 原生 HMR SSE 保持不变。

## 删除数据源与对应凭证

管理页的数据源名称旁提供“删除数据源”，确认区显示目标及凭证引用。默认保留已保存凭证；
用户勾选“同时删除对应的已保存凭证”后才一并处理。引用可能跨数据源、跨 Workspace 共享，
确认区提示删除凭证对共享使用者的影响；现有字段旁的单个凭证删除入口继续保留。

删除定义通过 checked Runtime 的公开 `md.remove(name)` 执行，同一 Python 进程先复核公开
`md.describe()` 的 definition fingerprint。可删除范围由 Marivo 决定，包括对内置 `default` 的保护；
插件不直接删除定义文件，不删除远端数据库数据，也不级联修改语义层、Artifact 或 Evidence。

删除沿用 Host generation、context token、credential version 和 operation ID，按数据源与现有写入串行。
提交后通过 operation 查询结果，不自动重放删除；开始删除时使旧管理上下文、等待中的配置请求及尚未启动的执行失效。
已启动的执行仍遵循原生命周期，不因删除自动回滚。只有确认定义删除成功后，才按去重引用调用 Harness
`CredentialProvider.unset()`；凭证值不被解析、回显或传入 Python。未勾选时，不使其他数据源的共享凭证失效。

数据源删除和凭证删除不是跨系统事务。只读来源、provider 失败或取消可能留下部分凭证；结果分别展示
数据源是否确认删除、已删除引用和删除失败引用，卡片移除后仍保留结果，用户可以关闭。失败凭证可在 Harness
凭证管理或其原来源处理，不因后续失败恢复已删除的定义。浏览器重载可恢复进行中操作的查询句柄；
已关闭或已完成并清理的客户端结果不作为持久删除审计。

## 新增与编辑数据源

表单通过 checked Runtime 读取公开 `md.DatasourceSpec` union 和各 Spec 的 dataclass 字段，展示引擎、必填项、默认值及说明。
各字段说明与字段名称同行置于输入框上方，长说明和窄屏自然换行。当前 Runtime 的属性说明使用中文，字段标识保持原名；
翻译仅按完整说明文本匹配，不改变字段契约。Runtime 新增或修改的未知说明保留原文，避免套用过期解释。
插件不维护引擎注册表或连接字段 schema。`ai_context` 不在连接表单中编辑；复杂配置字段接受 JSON。连接凭证在同一表单直接填写，`*_env` 的引用名称由客户端生成，用户可展开确认或修改；
JSON 凭证映射提供 Header 名称、值与引用名的逐项输入。值仅保留在当前表单内存。非法引用在执行 Python 和写入前拒绝，
保留安全错误码 `datasource-credential-ref-invalid`，页面说明引用命名规则且不回显被拒绝的输入。
点击“确认新增数据源”时 Host 重新解析 Workspace 并核对 generation 与 Runtime fingerprint，在串行写入区间内调用 `md.register(spec)`。
Marivo 校验定义并拥有项目文件写入；现有同名定义拒绝新增。配置 RPC 不接受项目路径、Python 代码或凭证值，引用须符合 DSH 的命名限制。
普通管理入口保存配置后刷新当前 Workspace，选中新数据源并保存同页填写的凭证，随后可单独测试连接。
新增请求不自动重放；响应未确认时提示先刷新核对。插件串行化自己的新增操作，同名检查与外部编辑器的同时写入不构成跨进程事务。
已明确拒绝的非法引用、同名定义和过期上下文只提示修正原因，不附加“提交结果未确认”。

数据源详情中的“编辑配置”回填当前 Runtime 字段，名称与引擎只读。配置快照包含版本；
保存前重新读取并核对版本，经插件串行写入后调用 `md.register()`。`md.describe()` 的属性和引用、
公开 Semantic Details 的 `context` 共同用于完整回填，保留 `extra`、HTTP header 引用与 `ai_context`；
读取不完整时拒绝保存，不直接操作配置文件。修改引用不删除旧的 Harness 共享凭证。
配置变化刷新打开的管理页并使旧测试失效；其他 Tab 的编辑草稿保留，陈旧提交须重新加载。
此校验不构成与外部文件修改者之间的原子 compare-and-swap。

配置请求通过同一 watch 通道的 `configurationRequests` 传递，尚未选择数据源时没有 context。
`configuration`、`update-datasource`、`select-configuration` 补齐私有 RPC；选择或保存后重新绑定 context，
沿用已有凭证操作及查询句柄。请求的 Workspace、Runtime 与 Session 身份在操作前和完成时核验。
请求页使用“保存并测试，成功后继续”：先保存配置，再通过已有凭证 `start` 操作保存凭证并测试，失败不回滚；凭证不齐时仍可进入已有凭证表单。
配置 RPC 始终只接受引用，不携带值；客户端提交后清空凭证输入，失败或离开页面后不重放秘密值。
自动引用名包含数据源名、字段名与随机标识，不由凭证值派生。编辑时留空保留原引用，填写新值默认生成新引用；
若用户手动指定已保存值的引用，阻止自动覆盖并引导至已有凭证页确认更新，不删除旧引用。
请求说明默认折叠；新增流程与“使用已有数据源”通过显式切换区分，下拉框只在复用流程出现。
只有本次配置与凭证版本的成功测试才能完成一次原调用。取消配置请求返回非成功结果，不创建后续任务。
切换会话不抢占其他会话；Tab 关闭或重连可重新打开待办，原调用结束和 Host 重启不恢复旧任务。

## 工具与自动续接

- `marivo_datasource_configure({ mode, name?, reason })`：`create` 打开新增页，也允许选择已有数据源；
  `edit` 必须提供现有名称并直接打开编辑页。`reason` 为不含凭证的简短说明；工具不接受配置值。
  Web 根 Agent 保持原调用等待，成功返回 `status: ok`、`name` 和连接耗时，随后核验目标表；
  `failed`、`cancelled`、`call-ended`、`context-changed`、`needs-configuration` 均不是连接成功。
- `marivo_datasource_test({ name })`：执行真实 `md.test()`，同步管理页的 `lastTest/stale`。
- `marivo_python({ code, datasources, timeoutMs? })`：在本次调用内准备全部精确 datasource，再执行一次前台 Python。
  声明本次可能访问的全部精确 datasource 名称，包括无需密码的数据源；完全不访问数据源时才传空列表，
  仍安装拒绝未声明凭证请求的 resolver。

`marivo-analysis` 或 `marivo-semantic` 激活后均披露此执行接缝，提示在一次调用内创建/恢复 Session，
并在 `try/finally` 中显式 `session.close()`。插件不接管 Session 生命周期，也不拦截 Agent 代码。
这里关闭的是本次独立 Python 进程中的资源，不是结束分析问题或删除持久 Artifacts；后续调用继续恢复
同一 Session 身份。未显式关闭属于清理约定偏差，须结合子进程退出边界判断，不能直接推断分析错误或泄漏。
分析激活后另有简短收尾提示，普通文字回答也须逐项回应用户问题与比较范围，保留未完成分支。
分析语义、执行流程和 Artifact 复用指导仍由当前 Runtime Skill 与 Help 提供，插件不补写这类规则。

成功 `marivo_python` 会在 Host 的 `$DSH_HOME/dsh-data-analysis/python-executions/` 按 Workspace 隔离，
原子保存本次提交的 Python 原文，并返回 `codeRef: {executionId, sha256}`，供报告 dataset 显式关联。
读写位置由 Host 决定，不从 Workspace 接受作者自报的执行记录文件。
只保存代码和完成时间等执行记录，不包含 resolver、注入 wrapper 或 credential snapshot。
记录失败通过 `codeCaptureError` 单独返回，保留原执行结果；调用方不应因此重放已经成功的分析。
非零退出、超时或取消不签发成功执行引用。报告构建的精确引用读取见[展示数据投影](presentation-projection.md)。

默认 `credentialInteraction: 'web'`。缺失配置时，根 Agent 的 test/python 保持原调用等待，并在会话标题
显示待办入口。用户提交后先保存，再测试；成功继续原调用。测试失败保持表单，可修改后重试，或把 Marivo
的失败与修复信息交还 Agent。已经配置齐全时的测试失败直接返回 Agent，不制造缺失输入待办。

页面刷新只恢复 Host 待办和操作状态，不保存未提交值、不重放调用。用户取消、Agent 销毁或外层 Code Mode
超时后，原调用结束，晚到的提交不能复活它。`credentialInteraction: 'none'` 与 subagent 返回
`needs-credentials`，由调用方处理；不等待无人可见的表单。

## 超时与执行反馈

“设置 → 插件 → 插件配置 → 数据分析”提供 Python 默认执行超时，界面以秒显示，最多三位小数，持久化为 `pythonTimeoutMs` 毫秒。设置由 Harness 的 `dsh-data-analysis` namespace 保存，适用于当前 Host 的所有 Workspace；用户值覆盖插件部署值，尚未设置用户值时使用部署值或默认 120 秒。界面沿用 Harness 原生插件卡片的折叠标题、描述、全宽输入框及右侧“放弃修改 / 保存”操作，不提供恢复继承值按钮；成功保存后折叠，手动折叠保留草稿。保存后对下一次调用立即生效，已开始或正在等待凭据的调用保留入口读取的预算。表单保存绑定读取时的 revision，并确认 Harness 回读的生效值和用户覆盖记录；正常结束的保存 Promise 不代表写入成功。冲突或写入拒绝保留草稿；只读连接不能保存。无 settings provider 的 headless 部署继续使用插件部署配置。

插件仅提供 `pythonTimeoutMs`，默认 `120000` 毫秒。该配置及 Tool 的
可选 `timeoutMs` 必须是 `1..2147483647` 内的整数（JavaScript 定时器范围）。配置在 Runtime 安装、
Agent 接入和 Tool 注册前校验；参数在凭据准备前校验。Harness 参数 schema 会先拒绝非 JSON 数值及错误类型。

省略 Tool 参数时，在调用入口读取插件当前默认值；显式 `timeoutMs` 直接传给 Harness。插件不另设超时上限，经 `shell.resolve()` 应用 Harness 上限，
`execution.effectiveTimeoutMs` 取解析后的 `spec.timeoutMs`，不把请求值宣称为最终预算。
凭据等待在 Shell 计时之前；外层 Code Mode 时限包含等待和其他步骤，仍可能先触发取消。插件不修改 Harness
超时策略，也不添加覆盖整次凭据交互的独立定时器。

原有成功、进程结果和 datasource 准备结果字段保留，新增 `execution`：

| 字段 | 含义 |
| --- | --- |
| `phase` | 最后到达的插件阶段：`preparing`、`executing`、`capturing-code` |
| `reason` | `not-started`、`succeeded`、`nonzero-exit`、`timed-out`、`cancelled` 或 `unknown` |
| `requestedTimeoutMs` | 截断前的有效请求或默认值；参数校验失败时为 `null` |
| `effectiveTimeoutMs` | Shell 解析后的预算；尚未解析时为 `null` |
| `elapsedMs` | 从 Tool body 开始到反馈生成的单调时钟耗时，包括凭据准备 |
| `executionElapsedMs` | 从调用 Shell 到其返回或抛错的耗时；未调用 Shell 时为 `null`，不含代码记录时间 |
| `nextAction` | 失败或代码记录失败后的操作提示；正常成功时为 `null` |

`executing` 只表示交给 Shell，不证明用户代码或 Trino 查询已开始。超时与取消使用 Shell 标志分类，
不会从 stderr 猜测；无已知退出码且未报告超时/取消时为 `unknown`。
准备返回 `needs-credentials` 或 datasource 失败时原因是 `not-started`，保留已有 `failure`、`repair`。

输入、Host 服务、准备异常及 Shell 抛错保持错误通道，使用 `MarivoPythonExecutionError`：其 `execution`
属性和安全 message 中的 JSON 摘要提供阶段与下一步，不透传原始异常或注入值。参数 schema 在 Tool body
之前拒绝的调用保持 Harness 原生校验错误。准备异常明确尚未启动；交给 Shell 后发生异常只报告结果未确认，
取消可确认时标记 `cancelled`，不能宣称不存在副作用。

`codeCaptureError` 仍与 Python 成功分离：阶段为 `capturing-code`、原因为 `succeeded`，不得为修复代码记录
重放分析。`codeRef` 不证明 Artifact 清单或保存状态；超时不证明结果未保存或远端查询已取消，应通过当前
Runtime Help 检查既有效果及目标 Session。

Harness 拥有外层取消的最终错误分类，可能替换插件结果；本模块不持久化额外执行状态，不在取消后补发消息，
不承诺已取消的 Code Mode 能收到完整摘要。launcher 仍在 worker 结束后统一脱敏输出，摘要不提供实时进度或部分日志恢复。

## 单次凭证注入

固定 test bridge 和 `marivo_python` 都通过 stdin 传送 Host snapshot。Python 在任何用户代码执行前进入
公开 `md.credential_scope(resolver)`；resolver 校验 Workspace、datasource 定义和字段，返回
`md.SecretValue`。显式 resolver 内不回退到默认 env/cache，不创建或同步 `~/.marivo/secrets.toml`。
Session 和 reader 应在该 scope 内创建或恢复。固定测试沿用 snapshot 已校验的原始 definition，
不通过重新读取定义扩大 grant；定义漂移由 Python resolver 在返回凭证前拒绝。

每次 Python 执行先核验 Agent、Workspace、环境 fingerprint 和全部 datasource 定义。缺失配置全部补齐后，
再取得一次 fresh snapshot；配置齐全不额外测试连接。准备期间取消、凭证轮换、删除或上下文变化会终止
原调用，不自动使用新状态重试旧代码。启动后失败也不重放；已发生的外部效果不会因取消而回滚。
不发放跨调用 lease，不保留 TTL、次数额度或 access Tool。Agent 参数仅包含代码、datasource 名称和可选超时，
凭证值不返回 Agent。

Python 通过 DSH Shell 服务继承前台执行、沙箱策略、限制和取消能力；普通 Shell 不获得 datasource 值。
独立 launcher 在 DSH 输出落盘前捕获 worker 的 stdout/stderr，分别限制到 1 MiB 并执行 exact-value
脱敏，覆盖原始文件描述符输出和 traceback。快照不进入 argv、环境、日志或结果，结束时清理 Host 引用。
这保护正常执行中的凭证传递与意外输出；允许使用凭证的 Python 本身不是不可读取凭证的隔离边界。

## 管理操作与并发

私有 RPC 使用 Host generation、context token、凭证 version 和 operation ID。相同 ID 只执行一次；
响应丢失后仅查询，不重发秘密值。Client 按 operation ID 独立查询、展示与取消；刷新恢复全部未完成句柄，
一个操作结束或晚到的响应不覆盖另一个操作。Client 操作列表只展示进行中状态，结束后立即移除记录和
恢复句柄；对应数据源保留最近测试结果及必要的失败、取消或部分保存反馈，不累积历史操作列表。
Host 为响应丢失恢复而保留终态和待办 30 分钟，容量有界；Host 重启后明确不可恢复。
管理页关闭或刷新不取消正在保存的操作，显式取消才终止验证。已经成功保存的字段不会因为后续测试失败而回滚。

写入与 snapshot 解析串行，写入时使受影响的待执行快照失效。执行前后复核定义和 version，拒绝旧上下文的晚到动作。
外部 DSH credential 更新也使受影响的准备失效，并刷新等待表单的配置状态。准备、快照和连接测试期间的引用有单独的
计数跟踪，不依赖管理页；中途更新会使旧快照或测试结果失效，完成后释放跟踪。provider 错误只投影安全错误码；
原始值、异常详情不进入 RPC。只读来源由 DSH provider 拒绝写入，页面同时展示不可写状态。

## 新建字段默认值

Harness profile 中本插件的可选 `datasourceDefaults` 使用 `backend → 字段名 → JSON 值` 映射，
作用于该插件实例服务的 Workspace；不增加项目侧配置或热更新机制。配置示例见[用户说明](../../README.md)。
配置通过 loader 原样传入，authoring 的 `mode: 'create'` 取得 checked Runtime schema 后校验完整映射，返回独立的 `creationDefaults`；
不改写 Runtime 字段 `default`、backend 列表或 fingerprint。未配置时响应保持原样。
authoring 省略 mode 时沿用 create；编辑表单显式使用 `mode: 'edit'`，只读取 Runtime schema，不校验或返回新建默认值，
因此错误的新建默认值不会阻止已有数据源编辑。

未知 backend、未知字段、错误类型、非 JSON 值及 `*_env` 字段明确失败，错误仅使用固定错误码和中文说明，
不回显配置值。普通字符串、数字、布尔值按 Runtime 字段类型校验，JSON 字段的具体业务约束仍由 Runtime 保存流程校验。
此配置仅用于非敏感值，不能用 JSON 字段绕过 Harness 凭据管理存储密钥。

新增表单初始化和切换 backend 时填入配置值；未指定的字段继续显示原占位符或默认选项，不强制写入 Runtime 默认值。
用户修改或清空后不会在重渲染时补回。`0`、`false` 和 JSON 按原表单格式转换；显式配置的空字符串保留并作为字符串提交，
其他空字段继续沿用原有省略规则。编辑时保留原配置中的显式空字符串，即使管理员已移除新建默认值，修改其他字段也不会将它省略。
编辑已有数据源只读取已保存配置，选择复用已有数据源不应用默认值。
提交仍使用原 generation、Runtime fingerprint 与配置保存流程，不在服务端补齐默认值。

## 验证

```bash
npm run test:datasource-credentials
npm run validate:datasource-credentials:real
npm run validate:datasource-execution:real
npm run validate:credentials:web
```

配置、新建默认值、定义编辑、删除及模型续接分别验证；完整入口与环境边界见[验证指南](../validation.md)。

## Python 设置验收记录

2026-09-11：移除插件最大超时配置，仅保留 `pythonTimeoutMs`，接入 Harness 插件配置卡片。`npm run check` 共 667 通过、4 跳过、0 失败；`npm run build`、`npm run verify:plugin-package` 通过。回归覆盖 Host 设置持久化、非法值拒绝、revision 冲突、恢复继承值、namespace 卸载，以及现有 Tool 的默认值更新和在途预算保持；15 分钟默认值与 20 分钟单次覆盖原样传给 Harness。

`npm run validate:python-settings:web` 使用真实 Harness FileSettingsProvider、未修改的原生 settings 客户端 bundle、隔离 HTTP transport 和浏览器验证卡片的保存、刷新回读、非法值、冲突保留草稿、放弃修改、恢复继承值、只读、中英文及窄屏布局。补充数值等于继承值时写入或恢复被拒绝，以及重试保持原写入意图的回归；原生客户端接入后先复现冲突丢失草稿，再验证修复。该入口不替代完整运行中 Harness 设置页验收；本次未重装插件、重启服务或修改用户 profile。

2026-09-12：数据分析设置卡片对齐 Harness 原生卡片布局与主题变量，移除界面“恢复继承值”操作。`npm run validate:python-settings:web` 通过保存、刷新回读、非法值、冲突保留草稿、放弃修改、成功保存后折叠、手动折叠保留草稿、同值写入拒绝及重试、只读、中英文和窄屏验证；桌面与窄屏截图已检查。`npm run check`、`npm run build`、`npm run verify:plugin-package` 通过。验证使用真实 FileSettingsProvider 和原生 settingsScope 的隔离 HTTP fixture，未重装插件或重启运行中的 Harness。
