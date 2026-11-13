# Datasource Credentials 模块

## 所有权与入口

DSH Credentials 保存、解析和描述凭证；Marivo 定义 datasource、凭证字段和连接失败语义；插件负责 Workspace 绑定、凭证页面、等待中的调用和单次执行注入。凭证使用遵循 Marivo 公开的 `md.credential_scope(resolver)` 契约。

会话标题旁的“数据源”入口以及空白会话快捷入口打开所属 Workspace 的右侧 Tab。页面只读展示数据源、引擎、连接属性、凭证字段与引用、配置状态、来源和可写性，支持刷新及凭证新增、更换、删除；已保存值不回显，替换和删除需要确认。原始引用可跨 Workspace 共享。数据源名称的状态表示凭证是否配置，不表示连接是否成功。

「数据源与凭证」页面的「数据源」标签按数据源管理连接凭证。同级的「凭证管理」标签管理当前 Host 的[报告发布凭证](report-publishing.md#对象存储发布)，使用插件发布配置声明的 Harness 凭据引用。

数据源定义由 Agent 在对话中依据 live Help 调用 Marivo 公开 API 创建、修改或删除；连接测试由对话中的 `marivo_datasource_test` 执行。密码和令牌只在凭证表单中输入，不通过聊天或代码传递。

原始引用按 UTF-8 字节编码到 `DSH_DATA_ANALYSIS_CREDENTIAL_<HEX>`，区分大小写。只访问映射地址，不回退到同名 Host credential。继续拒绝 `MARIVO_*`、`DSH_DATA_ANALYSIS_*` 和 Host 自有 Shell facts。

## 待办通知与连接生命周期

每个页面共享一个 `dshDataAnalysisCredentials.changes(sessionId, signal)` Remote stream，
通过 Harness 现有 Gateway WebSocket 多路复用。插件使用公开 Typert contribution 注册同一严格类型描述；
通知只有 `{ generation, cursor }`，不包含凭据、待办详情或执行参数。首次连接、恢复连接及版本变化后，
客户端调用 `watch` RPC 立即读取完整快照；该 HTTP 入口只接受 sessionId，拒绝 cursor。同一订阅最多一个快照请求在途，
期间的通知合并为后续一次读取；切换 Session、断线和卸载取消旧订阅及读取，旧 generation 的响应不得回写。

连接 generation 丢失或 stream carrier 失败时，客户端立即取消该连接的快照请求，不等待 Harness 重连完成。
Host 遇到临时 `credential-state-unavailable` 时，在原订阅内以 1、2、5 秒（上限）的可取消退避重试；
其他契约错误仍终止订阅并明确报错。重试和断线均不重放凭证写入或取消原调用。

Host 继续复用状态变化唤醒与每 25 秒的上下文复核，未变化时不发送通知。HTTP watch 不提供 cursor 长轮询，页面空闲时不占用凭证 HTTP 长轮询连接。断开通知不取消等待中的原调用，
凭据提交仍继续原调用，不重放写入。Harness 原生 HMR SSE 保持不变。

## 工具与自动续接

Agent 依据绑定 Runtime 的 live Help 通过 `marivo_python` 修改非秘密数据源定义，凭证引用使用 Marivo 公开 API；具体凭证值由用户在 Host 表单中填写。删除数据源不级联删除共享凭证。

子 Agent/委派调用缺凭据时返回 `handoff.reason: parent-agent-required` 和 `nextAction`，由父 Agent 完成 Host 交互。`credentialInteraction: none` 返回 `web-interaction-disabled`；回执不包含秘密值。

- `marivo_datasource_test({ name })`：通过 Host 凭证执行真实 `md.load().test()`，将连接结果返回对话。
- `marivo_python({ code, datasources, project?, resultVariables?, timeoutMs? })`：省略 project 时，非空 datasources 或合法 resultVariables 推导为 required，否则为 none；显式 required 也准备当前 Workspace 项目。显式 none 与非空 datasources 或 resultVariables 冲突时，在项目准备、凭据准入及用户代码执行前拒绝。只在代码中使用项目、没有上述声明时仍需显式传 required。项目准备可能初始化缺失的根项目。顺序固定为绑定、必要项目准备、凭据准入、fresh identity、一次用户 Python。
  声明本次可能访问的全部精确 datasource 名称，包括无需密码的数据源。使用配置中的名称，例如 Catalog ID
  `datasource:warehouse` 对应 `datasources: ["warehouse"]`。纯 Catalog 定义读取不连接数据源时可传空列表，仍安装拒绝未声明凭证请求的 resolver。

首次模型请求即可看到绑定执行和凭据表单的入口。各 Tool 说明负责数据源声明、配置与测试条件；`marivo_python` 每次启动独立进程，跨调用复用结果时按当前 Runtime Help 的 Session 生命周期和 Frame 持久化契约操作。失败后的动作依据实际回执，结果未确认时先核对已有影响。

成功 `marivo_python` 会在 Host 的 `$DSH_HOME/dsh-data-analysis/python-executions/` 按 Workspace 隔离，
原子保存本次提交的 Python 原文。声明结果导出成功后，Host 在 `results[name].resource.codeRef` 关联同次执行记录；模型不再配对顶层 codeRef、resultRefs 或 resultMetadata。
读写位置由 Host 决定，不从 Workspace 接受作者自报的执行记录文件。
可选 `resultVariables` 将 1–16 个资源名映射到 Python 变量名；省略 project 时推导为 required，不可与显式 `project:"none"` 组合。
变量可持有已经计算的 AnalysisFrame、可持久化的 pandas DataFrame 或准确固定引用。worker 在进程退出前
逐项导出。已固定的引用原样复用，内存结果通过 Marivo 公开 API 持久化，待计算的 Frame 返回导出错误。
引用通过临时控制文件和 launcher 的首个控制帧返回，Host 校验输出名、引用和 32 KiB 预算。
stdout 用于日志。普通非零退出仍可返回已导出的结果，执行状态保持失败，来源状态为 unavailable。
超时或取消的结果未确认。逐项导出错误通过 `resultCaptureError` 返回，已导出的资源继续可用。

Host 在 Harness 的 Tool Result metadata 保存命名结果引用和有界列摘要。插件在模型上下文准备阶段，
从当前 Session 的历史回执补回不在当前 surface 的近期输出，核对 Workspace 的 canonical project root，
并按可见回执去重。此过程读取的是 Harness 会话记录，展示阶段通过绑定 Runtime 读取对应的固定结果。

每个成功输出的 `results[name]` 包含 `resource`、`sourceStatus` 和有界 `metadata`。resource 复用报告 writer 的轻量公开声明 schema，为 `{kind:"analysis-frame",ref,codeRef?}` 或 `{kind:"dataframe",ref,codeRef?}`；kind 由经过验证的引用 schema 决定，可原样用于 resourcePatch.put。sourceStatus 与 metadata 不放入声明。来源保存失败时保留有效资源并省略 codeRef，返回 sourceStatus=unavailable 与 sourceError；元数据失败仅将 metadata 标记 unavailable。执行、引用导出、元数据和来源记录的成功分别表达，不因此重跑业务代码。控制帧解析后按本次 credential snapshot 检查字符串：引用包含凭据值时只拒绝引用导出，不先写入来源记录；元数据包含凭据值时将该项 metadata 标记 unavailable，不替换或伪造引用身份，错误不回显值。

工具 output schema 具体披露进程结果、需要凭据、连接失败与 execution/project 字段。Harness 的 schema 子集只支持 boolean additionalProperties，因此 PTC 中 results 的动态键值仍显示为 JSON 映射；插件通过严格的 PythonResult schema 逐项验证资源、来源状态与有界元数据。

codeRef 只证明该次执行登记导出了该引用，不证明最初生产来源、完整 lineage 或业务正确性。记录不包含 resolver、注入 wrapper 或 credential snapshot。已有外部固定引用仍可直接使用，错误 codeRef 由 writer 明确拒绝，不偷偷移除。
记录失败通过 `codeCaptureError` 单独返回，保留原执行结果；调用方不应因此重放已经成功的分析。
非零退出、超时或取消不签发成功执行引用。报告构建的精确引用读取见[展示数据投影](presentation-projection.md)。

默认 `credentialInteraction: 'web'`。缺少凭证时，根 Agent 的 test/python 保持原调用等待，并显示待办入口。用户保存凭证后复核状态并继续原调用；保存不自动测试连接，测试或分析的结果由原调用返回对话。

页面刷新只恢复 Host 待办和操作状态，不保存未提交值、不重放调用。用户取消、Agent 销毁或外层 Code Mode
超时后，原调用结束，晚到的提交不能复活它。`credentialInteraction: 'none'` 与 subagent 返回
`needs-credentials`，由调用方处理；不等待无人可见的表单。

## 超时与执行反馈

“设置 → 插件 → 插件配置 → 数据分析”提供 Python 默认执行超时，界面以秒显示，最多三位小数，持久化为 `pythonTimeoutMs` 毫秒。设置由 Harness 的 `dsh-data-analysis` namespace 保存，适用于当前 Host 的所有 Workspace；用户值覆盖插件部署值，尚未设置用户值时使用部署值或默认 600 秒。界面沿用 Harness 原生插件卡片的折叠标题、描述、全宽输入框及右侧“放弃修改 / 保存”操作，不提供恢复继承值按钮；成功保存后折叠，手动折叠保留草稿。保存后对下一次调用立即生效，已开始或正在等待凭据的调用保留入口读取的预算。表单保存绑定读取时的 revision，并确认 Harness 回读的生效值和用户覆盖记录；正常结束的保存 Promise 不代表写入成功。冲突或写入拒绝保留草稿；只读连接不能保存。无 settings provider 的 headless 部署继续使用插件部署配置。

插件仅提供 `pythonTimeoutMs`，默认 `600000` 毫秒。该配置及 Tool 的
可选 `timeoutMs` 必须是 `1..2147483647` 内的整数（JavaScript 定时器范围）。配置在 Runtime 安装、
Agent 接入和 Tool 注册前校验；参数在凭据准备前校验。Harness 参数 schema 会先拒绝非 JSON 数值及错误类型。

省略 Tool 参数时，在调用入口读取插件当前默认值；显式 `timeoutMs` 直接传给 Harness。插件不另设超时上限，经 `shell.resolve()` 应用 Harness 上限，
`execution.effectiveTimeoutMs` 取解析后的 `spec.timeoutMs`，不把请求值宣称为最终预算。必要的项目 init 与用户代码分别应用此预算，外层 Harness 取消仍覆盖整个调用；execution 的 effectiveTimeoutMs 描述用户代码进程，未到用户代码 Shell 解析时为 null。
凭据等待在 Shell 计时之前；外层 Code Mode 时限包含等待和其他步骤，仍可能先触发取消。插件不修改 Harness
超时策略，也不添加覆盖整次凭据交互的独立定时器。

内部预检子进程使用各自的超时，不受 `timeoutMs` 控制。预检的 `subprocess-timeout` 在错误 JSON 的
`preparation` 中提供 `step` 和实际 `timeoutMs`（不可用时为 null）；`datasource-describe` 指数据源描述，
其他步骤为 `workspace-binding`、`project-preparation` 或 `credential-admission`。此时用户 Python 未启动；
提示检查该步骤后再重试，不推断远端查询是否仍在运行。

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
准备返回 `needs-credentials` 或 datasource 准入失败时原因是 `not-started`。连接测试的
`failure`、`repair` 属于 `marivo_datasource_test` 结果，Python 异常使用下面的 `exception`。

输入、Host 服务、准备异常及 Shell 抛错保持错误通道，使用 `MarivoPythonExecutionError`：其 `code`、`phase`、`recovery` 与 `execution`
属性及 message 中的对应 JSON 提供稳定错误码、阶段与下一步。Host 异常只披露插件已知事实。
datasource 准入的 checked Python 与用户 Python 执行使用同一个通用异常投影，捕获普通 `Exception`，
读取已有 `type`、`message`、可用的 `code`、`kind`、`expected`、`received`、`location` 和 `repair`。
`repair` 复用异常公开字典或 `model_dump(mode="json")` 的结果；插件不按领域或异常子类生成恢复动作。
预检失败在错误通道的 `error.exception` 中携带投影，`recovery` 取原有 `repair.action`，缺失时为 null。
已完成的非零退出在工具结果的 `exception` 中携带同一投影；用户 stdout/stderr、退出码和已固定输出独立保留。
执行异常通过 launcher 拥有的首个结果控制帧传递，控制帧也用于没有 resultVariables 的调用，
解析后从 stderr 移除；用户打印的后续控制帧不会被当成异常回执。投影沿用 32 KiB 控制帧限额，
捕获失败或超过限额时保留原始执行失败及经脱敏的 stderr。已知凭据值在控制帧编码前及工具接缝逐字段脱敏，
投影不导出 traceback 或任意异常内部属性。取消、超时和进程控制继续使用执行层语义。
项目准备失败保留具体错误码，初始化结果不确定时明确要求先检查现有状态，不自动重复 init。参数 schema 在 Tool body
之前拒绝的调用保持 Harness 原生校验错误。准备异常明确尚未启动；交给 Shell 后发生异常只报告结果未确认，
取消可确认时标记 `cancelled`，不能宣称不存在副作用。

`codeCaptureError` 仍与 Python 成功分离：阶段为 `capturing-code`、原因为 `succeeded`，不得为修复代码记录
重放分析。成功执行记录同时保存本次执行声明的 datasource 名称与 backend，不保存 warnings；
`code/read` 仅对文档绑定的 codeRef 返回这些字段。`codeRef` 不证明 Artifact 清单或保存状态；超时不证明结果未保存或远端查询已取消，应通过当前
Runtime Help 检查既有效果及目标 Session。

Harness 拥有外层取消的最终错误分类，可能替换插件结果；本模块不持久化额外执行状态，不在取消后补发消息，
不承诺已取消的 Code Mode 能收到完整摘要。launcher 仍在 worker 结束后统一脱敏输出，摘要不提供实时进度或部分日志恢复。

## 单次凭证注入

固定 test bridge 和 `marivo_python` 都通过 stdin 传送 Host snapshot。Python 在任何用户代码执行前进入
公开 `md.credential_scope(resolver)`；resolver 校验 Workspace、datasource 定义和字段，返回
`md.SecretValue`。显式 resolver 内不回退到默认 env/cache，不创建或同步 `~/.marivo/secrets.toml`。
Session 和 reader 应在该 scope 内创建或恢复。固定测试沿用 snapshot 已校验的原始 definition，
不通过重新读取定义扩大 grant；定义漂移由 Python resolver 在返回凭证前拒绝。

每次 Python 执行先核验 Agent、Workspace、环境 fingerprint 并读取全部 datasource 定义。缺失配置全部补齐后，
取得一次 fresh snapshot 并复核定义和凭证版本；配置齐全不额外测试连接。执行进程在用户代码前再次核对定义。
准备期间取消、凭证轮换、删除或上下文变化会终止
原调用，不自动使用新状态重试旧代码。启动后失败也不重放；已发生的外部效果不会因取消而回滚。
不发放跨调用 lease，不保留 TTL、次数额度或 access Tool。Agent 参数仅包含代码、datasource 名称和可选超时，
凭证值不返回 Agent。

Python 通过 DSH Shell 服务继承前台执行、沙箱策略、限制和取消能力；普通 Shell 不获得 datasource 值。
独立 launcher 在 DSH 输出落盘前捕获 worker 的 stdout/stderr，分别限制到 1 MiB 并执行 exact-value
脱敏，覆盖原始文件描述符输出和 traceback。launcher 在用户 stderr 前添加独立的捕获状态头，
Host 消费并移除该头；该状态不改变原 worker 退出码，也不从用户输出推断捕获是否成功。
当前新链路不创建 capture manifest；执行记录保存失败通过 codeCaptureError 报告，结构化引用导出失败通过 resultCaptureError 报告，保留成功执行结果，不因此重跑代码。凭据快照不进入 argv、环境、日志或结果，结束时清理 Host 引用。
这保护正常执行中的凭证传递与意外输出；允许使用凭证的 Python 本身不是不可读取凭证的隔离边界。

## 管理操作与并发

私有 RPC 使用 Host generation、context token、凭证 version 和 operation ID。相同 ID 只执行一次；
响应丢失后仅查询，不重发秘密值。Client 按 operation ID 独立查询、展示与取消；刷新恢复全部未完成句柄，
一个操作结束或晚到的响应不覆盖另一个操作。Client 操作列表只展示进行中状态，结束后立即移除记录和
恢复句柄；保留必要的失败、取消或部分保存反馈，不累积历史操作列表。
Host 为响应丢失恢复而保留终态和待办 30 分钟，容量有界；Host 重启后明确不可恢复。
同一数据源的已完成操作须先刷新权威状态，后续操作才使用新的凭证版本；刷新失败或会话上下文变化时停止提交。
Host 明确拒绝的前置条件直接展示原因；提交结果不确定时只查询原 operation ID，不重发凭证值。
管理页关闭或刷新不取消正在保存的操作，显式取消才终止操作。已经成功保存的字段不会因其他字段失败而回滚。

写入与 snapshot 解析串行，写入时使受影响的待执行快照失效。执行前后复核定义和 version，拒绝旧上下文的晚到动作。
外部 DSH credential 更新也使受影响的准备失效，并刷新等待表单的配置状态。准备、快照和连接测试期间的引用有单独的
计数跟踪，不依赖管理页；中途更新会使旧快照或测试结果失效，完成后释放跟踪。provider 错误只投影安全错误码；
原始值、异常详情不进入 RPC。只读来源由 DSH provider 拒绝写入，页面同时展示不可写状态。

## 集成方 authoring 能力

公开 integration seam 保留 Workspace authoring bridge 与 `withDatasourceDefaults`，供已有集成在 Workspace 初始化时使用；社区页面不使用这些能力。集成方继续依据 checked Runtime 的 schema 验证非秘密默认值。

## 验证

```bash
npm run test:datasource-credentials
npm run validate:datasource-credentials:real
npm run validate:datasource-execution:real
npm run validate:credentials:web
```

凭证管理、对话中的定义变更、测试及模型续接分别验证；本地验证指南放在 `docs/testing/validation.md`。

## Python 设置验收记录

2026-09-11：移除插件最大超时配置，仅保留 `pythonTimeoutMs`，接入 Harness 插件配置卡片。`npm run check` 共 667 通过、4 跳过、0 失败；`npm run build`、`npm run verify:plugin-package` 通过。回归覆盖 Host 设置持久化、非法值拒绝、revision 冲突、恢复继承值、namespace 卸载，以及现有 Tool 的默认值更新和在途预算保持；15 分钟默认值与 20 分钟单次覆盖原样传给 Harness。

`npm run validate:python-settings:web` 使用真实 Harness FileSettingsProvider、未修改的原生 settings 客户端 bundle、隔离 HTTP transport 和浏览器验证卡片的保存、刷新回读、非法值、冲突保留草稿、放弃修改、恢复继承值、只读、中英文及窄屏布局。补充数值等于继承值时写入或恢复被拒绝，以及重试保持原写入意图的回归；原生客户端接入后先复现冲突丢失草稿，再验证修复。该入口不替代完整运行中 Harness 设置页验收；本次未重装插件、重启服务或修改用户 profile。

2026-09-12：数据分析设置卡片对齐 Harness 原生卡片布局与主题变量，移除界面“恢复继承值”操作。`npm run validate:python-settings:web` 通过保存、刷新回读、非法值、冲突保留草稿、放弃修改、成功保存后折叠、手动折叠保留草稿、同值写入拒绝及重试、只读、中英文和窄屏验证；桌面与窄屏截图已检查。`npm run check`、`npm run build`、`npm run verify:plugin-package` 通过。验证使用真实 FileSettingsProvider 和原生 settingsScope 的隔离 HTTP fixture，未重装插件或重启运行中的 Harness。
