> 状态：核心方案已实施。以下保留设计推导；实际执行入口已确定为 `marivo_python` + stdin snapshot +
> `md.credential_scope`，不再采用 Shell 环境凭证 lease。当前契约以
> [模块说明](../modules/datasource-credentials.md) 为准，验收范围见
> [验收记录](../plan/2026-09-07-credential-service-acceptance.md)。

# Marivo 凭证配置、使用与管理设计

## 1. 状态与范围

- 日期：2026-09-05。
- 状态：设计推导归档；核心方案已实施，当前契约与实现差异见上方模块说明和验收记录。
- 实施方：`dsh-data-analysis` 插件，包含 Host、Client、测试、文档和打包。
- 约束：不修改 DSH 或 Marivo 源码、公共协议、内置 UI、安装产物，不要求升级 DSH。
- 恢复范围：Host 持续运行时支持页面刷新、会话切换和网络重连；不恢复 Host 重启前的执行等待。

本文覆盖 datasource 凭证的发现、配置、展示、更换、删除、验证、分析使用和失败处理。DSH 的模型 API Key、
其他插件的凭证、OAuth 登录和通用密码管理器不属于本文范围。数据源定义的创建、连接地址修改和认证方式选择
仍使用 Marivo 的公共 authoring 能力；首版管理页不增加通用 datasource 编辑器。

当前实现以 [Datasource Credentials 模块](../modules/datasource-credentials.md)为准。本文落地后再同步当前
架构文档，不提前把设计状态写成可用功能。

阅读导航：[职责](#2-职责与权威来源) · [身份与作用域](#3-对象身份与作用域) ·
[使用场景](#4-使用场景与交互) · [管理与展示](#5-管理与展示设计) ·
[操作数据流](#6-配置验证和执行的数据流) · [等待与恢复](#7-等待生命周期与恢复) ·
[接口](#8-插件接口与模块分工) · [验收](#10-验收矩阵)。

### 1.1 现状与问题

当前两个 datasource Tool 在缺少凭证时直接返回 `needs-credentials`，Client 解析已完成结果后弹出表单。
保存成功只更新 UI，不挂起原调用，也不唤醒 Agent。Agent 可能继续调用工具，直到自行结束 turn；用户发送
“好了”后才能开始下一轮。已经配置的字段不可编辑，且没有常驻的 Marivo 凭证管理入口。

相关源码：

- [Tool：test](../../packages/dsh-data-analysis/src/datasource/test.ts)、[access](../../packages/dsh-data-analysis/src/datasource/access.ts)。
- [Client 表单](../../packages/dsh-data-analysis/src/client.tsx)。
- [凭证映射与 Shell lease](../../packages/dsh-data-analysis/src/datasource/shell-env.ts)。

### 1.2 成功标准

用户无需在聊天中提供秘密值。支持交互且原调用仍存活时，缺少凭证的工具等待用户；提交并验证通过后，同一
调用返回结果，Agent 在同一轮继续，无需用户发送“好了”。native 调用不增加插件人工等待期限；Code Mode
等待受外层执行预算限制，预算耗尽后不能续接旧调用，具体边界见[第 7.2 节](#72-超时)。

普通连接测试失败直接交给 Agent；只有已进入凭证配置流程的请求保留人工纠错入口。用户也可以在没有分析
任务时主动管理所选 Workspace 的 datasource 凭证。取消、刷新和原调用结束均有明确的状态展示与后续路径。

## 2. 职责与权威来源

| 参与方 | 负责 | 不负责 |
|---|---|---|
| DSH Credentials | 秘密值存储、来源优先级、可写性、resolve/set/unset | Marivo datasource 语义、连接有效性 |
| DSH Agent/Tools | 工具等待、轮次执行、取消和会话生命周期 | 插件表单和凭证纠错流程 |
| Marivo | datasource 定义、环境变量引用、连接测试、结构化 failure/repair | 插件 Web 等待和聊天恢复 |
| 插件 Host | 精确引用映射、操作级注入、本插件待办、RPC、验证与原调用结算 | 第二套秘密值存储、决定一般故障如何处理、重写 Agent loop |
| 插件 Client | 管理页、输入表单、状态和错误展示、用户动作 | 判定凭证有效、通过前端状态授权执行 |
| Agent | 选择 datasource、调用工具、根据失败证据排查问题 | 接收、读取或保管秘密值 |

复用以下已存在的接口。相邻 checkout 链接用于工程核对，不代表需要修改上游：

- [DSH CredentialProvider](../../../deepseek-harness/packages/credentials/credentials/src/index.ts)。
- [DSH 凭证来源与写入规则](../../../deepseek-harness/packages/credentials/credentials-local/src/index.ts)。
- [DSH 插件 RPC](../../../deepseek-harness/packages/client/connection/src/rpc.ts)。
- [DSH Agent 取消接口](../../../deepseek-harness/packages/core/agent/src/runtime-types.ts)。
- [DSH Conversation Slots](../../../deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts)。
- [DSH Code Mode 调用生命周期](../../../deepseek-harness/packages/core/tools/src/code-mode.ts)与[Code Runtime 执行预算](../../../deepseek-harness/packages/code-runtime/code-runtime-worker-thread/src/index.ts)。
- [Marivo datasource 管理与测试](../../../marivo/marivo/datasource/manage.py)。

等待协调器只登记本插件的活动操作，不登记上游 datasource 定义或全部凭证。Datasource 列表和引用始终从
当前绑定 Runtime 的公共 `md.list()` / `md.describe()` 获取；连接结果使用 `md.test()`，不复制 Marivo 错误分类。

## 3. 对象、身份与作用域

### 3.1 凭证引用与秘密值

Datasource 的 `*_env` 字段保存环境变量引用，例如 `TRINO_USER`，不保存秘密值。合法引用和保留名规则沿用
当前模块与映射函数；Host 与 Client 不各自演进一套新规则。

每个原始引用映射到 `DSH_DATA_ANALYSIS_CREDENTIAL_<HEX>`。映射只取决于原始名称，区分大小写，不包含
Workspace、datasource 或 Agent 身份。因此，同一个 DSH 凭证提供方中的同名引用可能被多个 datasource、多个
Workspace 共用。Tool/lease 按 Workspace 绑定，并不等于秘密值按 Workspace 隔离。

首版保持这个映射，不迁移或增加双读路径。需要隔离账号时，使用不同的环境变量引用，并通过 Marivo 修改
datasource 定义。管理页必须提示共享影响；不得暗示“在这个 Workspace 删除只影响这个 Workspace”。

### 3.2 四种状态独立展示

| 状态轴 | 示例 | 含义 |
|---|---|---|
| 配置状态 | 未配置 / 已配置 / 状态读取失败 | DSH 当前能否解析引用；读取失败不等于未配置 |
| 写入能力 | 可更换 / 来源只读 | 以 DSH `writable` 为准，不根据来源名称自行推断 |
| 连接测试 | 尚未测试 / 测试中 / 上次成功 / 上次失败 | 某个 datasource 在一次测试中的结果，不是永久有效认证 |
| 执行状态 | 等待填写 / 等待处理失败 / 正在验证 / 已继续 / 已取消 | 当前请求的生命周期，不是凭证自身属性 |

“已配置”不表示值正确；“连接测试成功”不表示所有查询具有权限；“lease 可用”不表示网络或 datasource 永久健康。
不同 datasource 即使使用相同引用，也分别展示测试结果。

### 3.3 上下文、请求与操作

| 对象 | 最小职责 | 生命周期 |
|---|---|---|
| `DatasourceContext` | Workspace、environment 与 datasource 定义身份的快照；不注册第二份定义 | 一次页面读取或操作的绑定 |
| `CredentialRequest` | 因缺少凭证而等待的原 Tool 调用；拥有用户等待状态与一次性结算权 | 原调用存活期间；终态仅短期保留供查询 |
| `CredentialOperation` | 一次用户动作的执行、取消、去重和结果；保存/删除/测试共用实现 | 一次动作及其有界终态保留窗口 |
| 现有 Shell lease | 限定哪些执行可获得引用对应的秘密值；不表示连接健康 | 现有授权期限及撤销边界 |

请求可以先后关联多次操作，例如提交错误值后再次更换；每次操作只有一个拥有者。独立管理操作没有请求或
Agent continuation。RPC 和 Client 展示这些对象的状态，不拥有另一套动作去重或任务状态机。

运行中的等待请求绑定准确的存活根 Agent、session、`callId`、Workspace、environment fingerprint、datasource
名称及其描述签名。描述签名覆盖 backend 类型、字段到引用的映射和连接定义；只依据公共描述做一致性比较，不向
模型或 Client 暴露连接字面值。不读取源码或用时间戳猜测定义是否改变。

当前 describe bridge 只返回名称与引用，实施时需补充从 `md.describe()` 公共返回计算的不透明定义版本令牌。
令牌仅用于识别陈旧操作，不作为秘密值摘要、可读取的连接配置或长期保留的认证记录。

管理操作可以没有 Agent，只绑定选定 Workspace 与它解析出的 Runtime/environment。每次异步操作完成后重新
确认绑定仍有效，不能因页面切换或 Workspace 修改而在新目标上继续旧操作。

请求 ID 由 Host 生成；每次用户动作的 `operation ID` 由 Client 在首次提交前生成，同时作为去重和查询身份，
不再另设 action ID。两者均为随机、不透明标识，不是访问秘密值的凭证，也不进入模型工具结果。

## 4. 使用场景与交互

### 4.1 分析前已有凭证

Agent 调用 `marivo_datasource_access`。若引用齐全，按现有规则签发 foreground Shell lease，不弹窗，不执行
连接测试。普通分析脚本复用完整 prelude；过期或额度耗尽时重新 access。

因此，事先存入但输错的凭证可能直到显式 test 或实际连接时才被发现。插件不把 access 的成功文案写成
“凭证验证成功”，也不为避免这种情况而在每个 access/分析脚本前做连接测试。

### 4.2 分析中发现缺失凭证

```text
原 test/access 调用
  → 发现缺失 → 等待用户填写
  → 保存并验证 → DSH 保存 → fresh-resolve → md.test()
      → 成功：完成原 test，或为原 access 签发 lease → Agent 继续
      → 失败：等待用户修改、重试、交给助手排查或取消
```

在第 4.7 节定义的交互路径中，缺失时不提前返回 `needs-credentials`；原工具 Promise 保持 pending，依赖它的
下一次模型请求不会开始。等待服从原调用的取消信号与外层预算；其他独立任务、会话和已经启动的工作不受影响。

弹窗展示该 datasource 的全部引用。缺失项要求填写；已配置项显示状态并允许主动“更换”，不能因
`configured=true` 永久禁用。用户只提交新增或更换项，未修改项保持原值；空白不表示删除。

“保存并验证”只测试当前请求的 datasource。一次提交验证成功后，恢复发起该提交的请求；不自动恢复其他
会话中恰好使用相同引用的等待。其他待办通过显式“使用已有配置验证并继续”重新检查。

此处明确扩展当前 access 行为：正常 access 仍不测试；access 因缺失进入人工配置流程后，恢复前必须验证一次。
这次验证属于凭证配置闭环，不等于每次执行授权都做健康检查。

### 4.3 凭证输错与显式测试失败

保存成功后测试失败，文案为“凭证已保存，连接验证失败”，不能显示“保存失败”或自动删除刚保存的值。
不自动恢复旧值：DSH 没有凭证事务回滚契约，插件也不保存一份旧秘密值用于回滚。

只有因缺少凭证而进入配置流程的存活请求，才在验证失败后继续等待，展示脱敏后的失败详情。已配置引用可
更换；用户每次点击只启动一次测试，不在后台无限重试。

初始凭证齐全时，Agent 显式调用 test 的失败直接返回实际 `failure/repair`，不创建人工等待，不要求用户批准
后才允许 Agent 排查。管理页可展示上次失败，并让用户主动更换、重试，但不重新挂起已经完成的调用。

已进入配置流程的存活请求提供以下动作：

| 动作 | 凭证写入 | 连接测试 | Agent 行为 |
|---|---|---|---|
| 修改后保存并验证 | 仅覆盖修改项 | 一次 | 成功后原调用继续；失败仍等待 |
| 使用已有配置重试 | 无 | 一次 fresh-resolve 测试 | 成功后原调用继续；失败仍等待 |
| 交给助手排查 | 无 | 无 | 结束等待，把本次结构化失败返回原调用 |
| 稍后处理 | 无 | 无 | 保持等待，收起弹窗 |
| 取消本轮 | 无 | 由 DSH 取消信号中止所属 turn 内的执行 | 取消所属 turn，不继续后续模型步骤 |

“交给助手排查”适用于有 Agent 的请求。脱敏的 `failure` / `repair` 是实际 `md.test()` 结果，不由 UI
补写原因。已经返回失败的调用不会复活；后续修复与测试由新调用承接。

### 4.4 非凭证问题与原因不明

Marivo 当前的公共 failure code 主要区分连接建立、往返及其超时，并不统一表示“密码错误”。插件不得把
`connection_open_failed` 自动标成认证失败，不根据异常文本中的单词建立影子错误分类。

以下 UI 动作用于已经打开的配置或管理流程；普通 Tool 测试失败直接返回 Agent，不因失败类别进入人工等待。

| 情况 | 展示与处理 |
|---|---|
| 后端明确报告认证拒绝 | 展示后端原始含义的脱敏信息，提供更换入口；不擅自认定某个字段一定错误 |
| 连接超时或往返超时 | 展示对应阶段与 repair，提供重试或交给助手排查 |
| 网络、地址、TLS、驱动等问题 | 展示实际 failure/repair；不要求用户无条件重填凭证 |
| 认证通过但查询权限不足 | 按实际查询失败交给 Agent 处理；不能因 test 成功而隐藏错误 |
| 原因无法确认 | 显示“连接失败，原因尚未确认”，保留结构化详情与相同动作 |
| 凭证存储调用失败 | 显示保存失败，停留填写阶段，不启动连接测试 |
| Runtime 启动、协议或环境绑定失败 | 返回插件自身结构化错误，不伪装成 Marivo 认证失败 |

Agent 可以依据实际失败检查非秘密配置、网络条件和 Marivo repair。需要修改凭证时让用户使用管理入口；不
读取 DSH credential 文件、备份或 Marivo secrets 文件来代替表单。

### 4.5 主动配置与连接测试

用户在没有任务时打开“数据源与凭证”，选择 Workspace 与 datasource，补填或更换后点击“保存并验证”。
成功只形成该次连接测试结果，不创建 Agent、不签发 lease、不自动开始分析。

管理页“测试连接”使用当前值，不进行写入。缺少引用时展示缺失项；没有待恢复调用，不制造虚假的“继续任务”
动作。管理页测试失败提供更换、重试和错误详情；不自动向聊天发送诊断请求。

管理页单纯测试连接不撤销任何 lease，测试成功或失败均不改变其他任务的执行授权。管理操作可以单独取消
自己的测试，不调用 Agent 取消接口。保存或删除造成的共享引用影响按第 4.6 节处理。

### 4.6 更换、共享引用与删除

更换操作允许一次选择多个字段，未修改字段不随表单提交。保存前显示当前 Workspace 内已知的共享 datasource，
并明确说明其他 Workspace 也可能引用同名凭证；不扫描整个文件系统推断“全部使用者”。

删除动作叫“删除已保存值”，与“删除 datasource”分开。用户确认后调用 DSH `unset`；不修改 datasource
定义，不清理别的引用。删除后重新 `describe`：如果仍有回退来源，展示“已删除保存值，当前由其他来源提供”。

来源只读时，更换和删除均禁用，显示 DSH 返回的来源与说明。`.env` 来源不必然意味着无法在管理存储中覆盖，
是否可写以 `writable` 为准；插件不自行编辑任何 `.env`。

更换或删除前撤销本插件所有存活 lease 中包含该映射引用的授权，涵盖已加载的其他 Agent/Workspace。
每次 Shell 仍 fresh-resolve。撤销与 snapshot 提交的先后由第 6.1 节的短临界区确定：尚未提交 snapshot 的
claim 不得使用已撤销 lease；已提交 snapshot、获准执行的操作可继续，即使子进程尚在启动。轮换或删除不
追溯撤回这次已接受执行的授权；需要停止该执行时使用现有取消能力。

删除或手动更换使相关测试结果显示“配置已变更，请重新测试”，但历史成功记录仍可作为历史事实展示。
插件无法观察的外部更改不被宣称为已追踪，展示边界见第 5 节。

### 4.7 多任务、页面切换与无交互环境

多个会话分别持有自己的等待。一个会话的成功、失败或取消不能结算另一会话的请求；共享值写入只改变下次
fresh-resolve 的输入。当前页面只自动打开当前会话的待办，其他待办在切回时恢复。

用户关闭弹窗或切换会话只取消 Client 的订阅与未提交输入，不取消 Host 等待。停止任务则撤销请求，清理
测试子进程和等待监听。取消与提交竞争时，仅一个结束动作生效；旧请求不能误取消新 turn。

新增插件配置 `credentialInteraction: 'web' | 'none'`，默认 `web`，对应当前 Web 分发用途。`none` 用于无
人工交互的验证和自动化：缺失直接返回 `needs-credentials`，连接失败直接返回 `failed`。网络断开不自动
切换成 `none`。在 `web` 模式下没有打开浏览器时，等待仍有效，用户可以稍后打开页面或取消任务。

子 Agent 不创建人工等待，立即返回缺口或失败给父 Agent。`none` 模式同样只返回工具结果，不调用
`concludeTurn()` 决定整个任务结束；Agent 可汇总已有结果或选择其他来源。Tool 指导说明缺口需用户配置，
不得无条件反复请求。已知存活实例和根 Agent 身份均使用 DSH 公共 registry 校验。

根 Agent 的 native 与 Code Mode 调用均可进入 `web` 等待，但后者只能在外层调用仍存活时续接。预算耗尽
后的结束与重新发起路径见第 7.2 节；断网、关闭表单或填写动作都不能延长上游执行预算。

## 5. 管理与展示设计

### 5.1 常驻入口与页面结构

插件在现有侧栏 Slot 增加“数据源与凭证”入口，复用 Workspace 选择与 Modal/overlay 基础组件。分析中等待
通过当前会话 Header 的“等待配置凭证”入口重新打开同一表单。页面不依赖工具卡片挂载或历史结果解析。

```text
数据源与凭证
  Workspace 选择
  Datasource 列表：名称、引用配置摘要、上次测试时间与结果
  Datasource 详情
    凭证引用：原始名称、已配置/未配置、来源、可写性、当前 Workspace 已知使用者
    操作：补填 / 更换 / 删除已保存值 / 测试连接
    测试详情：阶段、时间、延迟、脱敏 failure/repair
```

列表来自当前 Runtime 的 datasource inventory，再批量 `describe` 映射引用。零引用 datasource 显示
“无需配置环境凭证”，仍可测试连接；不要求填写空表单。目录加载错误与空目录分开显示，单个 datasource
损坏按实际公共接口错误展示，不静默丢失该对象。

### 5.2 可以与不可以查看的内容

| 内容 | 展示规则 |
|---|---|
| 引用名、配置状态、当前来源、可写性 | 可展示，以 DSH 当前返回为准 |
| 同一 Workspace 中的使用关系 | 从当前 inventory 生成，明确不是全局完整使用清单 |
| 已保存秘密值 | 不读取到 Client、不回显、不复制、不导出 |
| 用户本次尚未提交的输入 | 默认隐藏，允许显隐切换；关闭、提交或切换上下文时清除 |
| 映射后的内部存储地址 | 普通页面不显示；不把它作为用户需要理解的操作步骤 |
| 数据源地址及其他 literal fields | 首版不直接倾倒 `md.describe()` 字段；不假定连接字符串天然不含秘密 |
| 上次连接测试 | 显示时间、datasource 和实际结果，固定说明仅代表该次测试 |

“用户名”即使通常不敏感，只要通过 credential reference 输入，就统一按秘密值处理，不自动降级成明文字段。
密码字段不以假掩码字符串作为输入值；“已保存”是独立状态，空白输入只表示未替换。

DSH 引用接口没有全量枚举和明文读取能力。管理页只能列出当前已发现 datasource 引用，不声称展示全部已保存
凭证；datasource 被删除后留下、且不再被任何可发现 datasource 引用的值，首版不提供扫描或批量清理。

### 5.3 测试结果与状态新鲜度

最近测试摘要只保存于插件进程内存，供刷新和重新打开页面使用；不持久化秘密值、secret hash 或认证有效性
数据库。摘要记录 datasource、环境/定义身份、开始/结束时间、结果和脱敏错误，数量有界，Host 重启后清空。

页面打开、恢复连接、完成写入或删除后重新获取配置状态。插件自身的写入使相关摘要标记为配置已变更。
外部 credential 写入无可靠统一 revision 通知时，UI 不把旧成功标为“当前有效”，仅称“上次测试成功”。

## 6. 配置、验证和执行的数据流

### 6.1 凭证写入与验证

为保证请求关联、变更前撤销 lease 与写入错误脱敏，首版采用插件私有 mutation RPC 接收本次用户输入，Host
调用现有公开 `ctx.credentials.set/unset`。这调整了早期“Client 直接 set，再单独通知完成”的方案；DSH
仍是唯一存储提供方，插件不建立副本，也不修改 DSH 的 credentials API。

写入只允许当前 datasource 已描述的原始引用。Client 不指定任意内部 credential 地址；Host 校验上下文后
自行映射。秘密值仅存在于此次写入的短生命周期请求体和调用内存中，不进入模型 Tool arguments、结果或日志。

操作顺序固定为：接纳操作身份并验证请求/Workspace/定义 → 在引用短临界区内撤销受影响 lease、逐项 DSH 写入
并推进变更代次 → 清除提交内存 → 重新读取状态 → 引用齐全后获取 fresh-resolve snapshot → `md.test()` →
校验绑定与 snapshot 仍适用 → 返回测试结果或完成原请求。原调用在任一步结束，都不能再自动续接。

DSH 不提供批量原子写入，故允许部分成功，但该操作不继续测试或恢复原请求。响应逐项报告已保存项和错误，不自动
回滚，不回显值。失败后用户只需补交失败项；重新提交前读取当前配置，不信任旧前端标记。

同一请求有保存或测试操作执行时拒绝另一动作，取消除外；同一操作 ID 的重复提交只查询已知状态。独立请求
或管理操作可以分别测试同一 datasource，不增加 datasource 级单飞约束。

涉及相同映射引用的插件写入、test/Shell snapshot 获取和 lease 签发使用同一组引用锁，按稳定顺序获取。
写入在锁内撤销相关 lease，并在出现部分失败时仍推进相应代次。读取方在锁内完成整组 fresh-resolve，避免
混合一次插件更新前后的字段。Shell claim 在提交 snapshot 前再次检查 lease、执行信号与环境绑定；尚在
resolve 的 claim 不能穿过撤销继续提交。snapshot 提交是该次执行接受授权的边界，不以 OS 进程创建时刻推断。

锁不跨连接测试、Shell 执行或人工等待持有。验证完成后，在短临界区内检查引用代次、fresh-resolve 值与本次
测试 snapshot；再校验上下文和原调用存活状态，完成请求或签发 lease。发生变化时提示重新验证或上下文变化，
不复用旧测试续接。秘密值比较仅存在于本次操作内存，结束后清除；代次不包含秘密值或其摘要。

这只防止本插件并发操作交错，不让部分写入变成 DSH 事务。其他操作仍可能在写入结束后读到已部分保存的实际
配置，必须按自己的缺口、测试结果或真实连接结果处理。

外部存储或远端数据库仍可能在检查之后变化；系统只承诺单次操作 snapshot，不承诺跨进程、跨系统的全局
原子“验证后永远可用”。下一次执行继续以 fresh-resolve 和真实连接结果为准。

### 6.2 test 与 access 的结果

| 调用路径 | 测试次数 | 成功结果 |
|---|---|---|
| 显式 test，输入已齐全 | 一次；失败直接返回 Agent | 原 `status: ok`、名称、延迟 |
| test 缺失后填写 | 提交齐全后一次 | 使用该次测试直接完成原 test，不再重复测试 |
| access，输入已齐全 | 零次 | 原 bounded foreground Shell lease |
| access 缺失后填写 | 提交齐全后一次 | 验证通过后签发原 access 的 lease |
| 管理页保存并验证 / 测试 | 每次点击一次 | 仅测试摘要，不签发 lease、不启动 Agent |

test 的最终结构化失败沿用当前 `failure/repair`。access 的交互配置分支新增 `status: failed` 结果，承载
实际连接验证失败，用于用户选择“交给助手排查”；不能把它包装成 lease 成功。`needs-credentials` 仅用于
无交互/子 Agent 路径。等待请求的内部状态不作为模型工具结果提前返回。

同调用成功续接以原调用仍存活为前提；外层取消或超时沿用 DSH 执行终态，不由插件包装成 `ok`、重放调用或
再创建一个模型可见结果。保留当前 Agent 显式 test 撤销自身同作用域 lease 的行为，不扩展到管理页测试。

### 6.3 Shell 使用

沿用[当前 lease 契约](../modules/datasource-credentials.md#access-是执行授权)：Agent/Workspace/datasource
绑定、完整首行 marker、30 分钟、64 次 foreground 使用、每次 fresh-resolve、operation-scoped snapshot、
settle/cancel/dispose 清理以及 stdout/stderr 脱敏。普通 Shell 不获得 datasource secret，background 和
persistent Shell 不接受 lease。

插件不修改 Host `process.env`，不把秘密值放入 argv、项目源码、报告或日志，不同步 `~/.marivo/secrets.toml`。
执行 overlay 固定 `MARIVO_PERSIST_CREDENTIALS=0`。Shell 中出现凭证缺失或真实连接失败时，由 Agent
重新 access/test；不尝试解析任意脚本错误后自动重放可能已有副作用的分析命令。

## 7. 等待生命周期与恢复

### 7.1 状态机

```text
请求：awaiting-input → executing → succeeded
                       ├→ awaiting-input（保存失败或仍有缺口）
                       └→ awaiting-decision（配置验证失败）
      awaiting-decision → executing / handed-off
      任一未结束状态 → cancelled / context-changed / call-ended / disposed

操作：running → succeeded / failed / cancelled
      running 的展示阶段：saving / validating（不适用的阶段跳过）
```

请求协调器负责等待状态和原调用的一次性结算；操作层负责动作去重、实际写入/测试与操作结果。请求中的操作
继承原 Tool 的取消信号，Tool 等待操作结果后决定最终返回或签发 lease。RPC 只转发动作和状态，不复制执行
循环。独立管理操作使用相同操作实现，但没有 Agent continuation。普通 test 失败不创建 `CredentialRequest`。

取消接口以请求 ID 同步确认请求仍有效，再调用 DSH `agent.cancel` 并保留 inbox，避免在 await 间隙取消另一
轮任务。旧请求和过期操作返回明确已结束状态。“取消本轮”由 DSH 中止同 turn 内的执行；管理操作取消只
中止自己的测试。关闭页面与取消订阅均不产生这两种取消效果。

环境、datasource 定义或引用变化进入 `context-changed`，返回可诊断结果；不得把旧请求重新绑定到新目标。
若写入已经成功，则保留 DSH 中的值并告知用户，不把操作取消伪装成写入回滚。

### 7.2 超时

移除 test 当前覆盖整个工具调用的 65 秒超时，保留实际 datasource 子进程的 30 秒预算。Marivo 本身的连接
测试阶段超时仍由其公共结果表达。移除内部 Tool 超时不改变外层执行预算。

| 调用路径 | 人工等待边界 | 结束后行为 |
|---|---|---|
| native 根 Agent，`web` | 插件不加人工等待期限；服从原调用取消、Agent 生命周期和插件卸载 | 只有原调用存活时才能提交并续接 |
| Code Mode 根 Agent，`web` | 额外受 Code Runtime 外层预算约束，等待不会暂停 `maxWallMs` | 外层结束即撤销等待、取消子操作；旧调用不可续接 |
| 子 Agent 或 `none` | 不创建人工等待 | 直接返回缺口或失败，由 Agent 决定后续 |

当前 DSH worker-thread Code Runtime 的墙钟预算不会因等待 Tool 而暂停；`run_code` 结束会取消内部调用。
首版遵守该契约，不改 Runtime 配置或用另起任务绕过预算。Code Mode 无期限同调用等待需要上游提供明确能力，
不属于本插件首版承诺。UI 说明等待受原调用限制，不显示无法从公共接口取得的剩余时间。

外层结束时，请求进入 `call-ended`，以 DSH 已知原因展示超时或调用已结束，禁止再提交旧请求。已成功保存的
值保留；用户可通过管理页完成配置，再重新发起任务。插件不自动发送聊天消息、不重放分析脚本。该路径需要
用户重新发起，不能宣称满足“无需额外消息即可同调用继续”。

等待工具 Promise 不产生新的模型请求或 token 消耗，但会保留 Host 活动调用及其非秘密元数据；不是把任务
提交给新的持久化调度器。插件卸载必须先停止接受动作、撤销等待，再等待自己启动的测试达到静止状态。

### 7.3 刷新、重连与重复提交

Client 用当前会话的长轮询获取活动请求及保留期内终态的快照；首次请求返回完整状态，携带不透明游标的后续请求等待变化，
最长 25 秒后返回。重连先读取完整快照；网络重试按 1、2、5 秒退避，最多停在 5 秒。游标包含进程代际，
旧代际不能造成重启后无限等待。浏览器订阅取消不取消 Host 的原工具 Promise。

Client 以请求 ID 防止同一页面反复自动弹窗；收起后仅保留入口。刷新丢失未提交输入，但恢复 Host 中的待办。
多标签页提交由 Host 的状态与操作 ID 处理，UI 不能靠本地 `busy` 保证唯一执行。终态仅展示结果，不自动弹出
输入表单；没有提交过动作的请求在外层结束后，也能通过 watch 显示已结束状态。

Client 在首次提交前生成 operation ID，并保存非秘密的查询句柄（进程代际、作用域、operation ID）；句柄可
放入 sessionStorage 以支持刷新，绝不附带字段值或整个请求体。请求动作绑定请求 ID，管理动作绑定选定的
DatasourceContext。Host 在任何副作用前登记操作；首次响应丢失也能直接凭预先生成的 ID 查询。

在记录保留期内，重复 operation ID 不再次写入、测试或结算，只返回已知状态；同 ID 的作用域或动作类型不符
时拒绝，不以秘密值摘要比较载荷。不同内容必须使用新的 ID。响应丢失后只查询，不自动重发写请求；同一请求
忙碌时拒绝另一执行动作，不排队覆盖旧输入。独立管理动作也遵守相同的身份与查询契约。

活动操作及请求不能因容量压力被淘汰；达到上限时在副作用前拒绝新操作。请求和操作终态在完成后保留 30 分钟，
不随原 Tool 返回立即删除；容量接纳须为该窗口保留空间。记录只含非秘密状态，窗口届满后可清理，去重保证
限于此窗口。查询到未知 ID、进程重启或记录到期时，统一表示“操作状态不可恢复”，不推断写入未发生。
Client 清除旧句柄、重新读取实际配置，由用户决定是否以新 ID 发起新动作，不重放原秘密输入。

容量限制不得阻止查询或取消现有工作；接纳请求时预留其终结动作所需的记录空间。

Host 重启清空待办、操作记录和测试摘要；已提交到 DSH 的值保留。恢复页面显示旧调用不能续接，需要用户
重新发起继续；不从历史 `needs-credentials` 结果创建新的活动请求。

## 8. 插件接口与模块分工

### 8.1 现有与新增接口

DSH 和 Marivo 公共接口不变。插件复用现有 `connection.rpc.handle` 注册独立通道
`/dsh-data-analysis-credentials`，采用 `trusted-host`，不拦截或扩展 DSH `/api`，不修改 mux union。

| 插件私有接口 | 输入要点 | 输出与用途 |
|---|---|---|
| `overview` | Workspace ID | 当前 datasource、上下文令牌、引用、来源、可写性和历史测试摘要；不含值 |
| `watch` | session ID、可选游标 | 活动请求、关联操作和保留期内请求终态的完整快照 |
| `submit` | 请求 ID、operation ID、预期版本、修改字段 | 保存并验证；无修改时使用当前值验证；只返回操作状态 |
| `diagnose` | 请求 ID、operation ID、预期版本 | 把已有真实失败交还原 Tool，不携带秘密值 |
| `cancel` | 请求 ID、operation ID | 校验后取消所属 turn |
| `manage-update` | 上下文令牌、operation ID、修改字段 | 更换/补填并验证；无 Agent continuation |
| `manage-delete` | 上下文令牌、operation ID、引用 | 删除保存值，重新返回实际配置状态 |
| `manage-test` | 上下文令牌、operation ID | 使用已有值测试，不签发或撤销 lease |
| `manage-cancel` | 查询句柄 | 幂等中止该管理操作的测试；已经完成的保存不回滚 |
| `operation` | 查询句柄 | 查询首次响应丢失、正在进行或保留期内已结束的操作；结果不含值 |

这些名称是本文的插件内设计，不是 DSH 已提供的 API。Wire 输入采用显式 schema、长度与数量上限，拒绝未知
字段、非法引用、错 session/Workspace、过期请求或过期定义；复用现有 Marivo 引用校验，不引入新名称语义。

查询句柄不依赖首次响应，按第 7.3 节在提交前保存；查询终态不要求原请求或 Workspace 仍存活。管理写请求的
上下文令牌绑定进程代际、Workspace、environment fingerprint 与定义版本，Host 验证当前目标仍匹配后才执行，
不能只比较 datasource 名称或相同的引用列表。新进程拒绝旧代际的写请求。

版本来自插件观察到的操作/定义状态，作用是拒绝陈旧操作，不冒充 DSH credential revision。秘密值字段只在
写请求 schema 中出现，读响应、错误详情和状态 schema 没有对应字段。写入异常映射为不含原始 provider
异常内容的字段级错误；连接错误使用现有 operation-scoped exact-value redaction。

### 8.2 实现分工

| 插件内部模块 | 责任 |
|---|---|
| datasource credential coordinator | `CredentialRequest` 的等待状态、原调用结算、取消与生命周期；只处理已进入配置流程的请求 |
| credential operations | `CredentialOperation` 身份、去重、取消、终态保留；读取公共上下文、DSH 写入及 bridge 验证；统一引用短临界区 |
| 现有 Shell lease 管理器 | 授权签发、撤销、claim 与 snapshot 清理；接入引用短临界区，不判断连接健康 |
| credential RPC | wire 校验、转发与长轮询；由请求/操作所有者检查状态和绑定，不复制执行循环或去重状态 |
| Client model | 订阅、状态收敛、提交前操作 ID 与查询句柄、连接恢复和输入清理 |
| Client UI | 常驻管理页、会话待办入口、同一套表单和失败面板 |
| test/access Tools | 选择是否交互，消费验证结果，完成原结果或签发 lease |

新增 Client 代码拆入插件自己的目录，不继续扩大单一 `client.tsx`。通过现有 Sidebar/Header/overlay Slot
注册组件；不接管 DSH 全部 composer，不扩展 DSH 的 session 状态机。native 和 Code Mode 都从 Host
协调器读取待办，不要求嵌套 Tool 拥有可见卡片；待办存活时间服从第 7.2 节的执行边界。

## 9. 凭证保护与可观测性

- DSH Credentials 是唯一秘密值存储。插件不读取存储文件、不建立 credential value cache、不迁移或导出值。
- 表单值不进入 localStorage/sessionStorage、草稿、剪贴板自动复制、URL、模型上下文或 telemetry。
- 写请求需要秘密值进入传输体；仅使用 DSH 现有受信任连接通道，不记录请求体。Host 权限没有因插件而扩大。
- 秘密值内存只属于写入、验证或已授权 Shell 的实际操作；人工等待和历史摘要中不保留值或可比较的秘密摘要。
- 管理页操作并不授予后续 Shell 权限；lease 只由 Agent 的 access 路径签发。
- 错误文案区分存储失败、连接失败、取消、原调用结束、上下文变化和交互不可用，不把所有错误压成“密码错误”。
- 验收记录使用请求/调用关联、状态、时间和脱敏 failure code，不记录值、连接字符串或用户填写内容。
- 不新增持久化操作审计数据库；需要保存的模型可见结论仍通过原有最终 `tool/result` 进入 DSH session log。

## 10. 验收矩阵

| 编号 | 场景 | 必须观察到的结果 |
|---|---|---|
| C01 | 凭证齐全的 access | 不测试、不弹窗，现有 lease 行为保持 |
| C02 | `web` 根 Agent test 缺失一项或多项 | 原调用存活时 pending；提交前没有依赖它的后续模型请求或连接测试 |
| C03 | access 缺失后在原调用存活时提交 | 一次配置验证成功后签发 lease，原调用继续 |
| C04 | native 填写等待超过 65 秒 | 不因原 Tool 预算失败；测试本身仍受操作超时约束 |
| C05 | 错误值已保存、认证被拒绝 | 显示保存成功与测试失败，可覆盖更换，不自动回滚或死循环 |
| C06 | 已有凭证显式 test 失败 | 直接返回实际 failure/repair，不创建人工等待；Agent 可继续排查 |
| C07 | 网络/往返超时、未知错误 | 保留 failure/repair，不自动归因为密码错误 |
| C08 | 连接通过、实际查询权限不足 | 正常返回查询失败；不冒称 test 已证明查询权限 |
| C09 | 部分凭证写入失败 | 保留成功项，报告失败项，不测试、不续接 |
| C10 | 只读来源与回退来源 | 以 writable 控制操作；删除后展示重新解析的实际来源 |
| C11 | 同引用被多个 datasource/Workspace 使用 | 展示共享边界；撤销本插件已加载的相关 lease |
| C12 | 删除或轮换与 Shell claim 并发 | 撤销前已提交的 snapshot 可执行；仍在 resolve 的 claim 不穿过撤销提交，不混合插件一次更新前后的字段 |
| C13 | 管理页没有 Agent、没有引用、空 inventory | 独立测试可用；零引用无需填写；空列表与加载失败可区分 |
| C14 | 刷新、断线、切换会话再返回 | 恢复正确待办，不保留未提交秘密值，不错误取消 Host 等待 |
| C15 | 多标签、重复 operation ID、首次或终态响应丢失 | 保留窗口内写入/测试/续接不重复；用提交前生成的句柄查询，包括无请求的管理操作 |
| C16 | submit/cancel/任务停止竞争 | 单次结算，旧请求不恢复或取消后来任务 |
| C17 | 测试期间值、引用或连接定义变化 | 旧验证不触发自动继续，提示重新验证或上下文变化 |
| C18 | plugin/Agent dispose 与 Host 重启 | 无悬挂子进程；重启后不重建旧 continuation，DSH 保存值仍保留 |
| C19 | 子 Agent 和 none 模式 | 返回缺口/失败，不创建人工等待或调用 concludeTurn；Agent 可处理其他工作 |
| C20 | native 与外层预算内的 Code Mode | 不依赖嵌套卡片显示；原调用存活时提交成功后继续下一模型步骤 |
| C21 | canary 秘密值贯穿保存、测试、Shell、失败 | 读响应、日志、模型输入输出、报告和状态中均无泄露 |
| C22 | 历史工具结果、孤立已存引用 | 不据历史结果自动弹窗，不声称支持全量凭证枚举 |
| C23 | Code Mode 等待超过外层 maxWallMs | 外层结束并取消子操作，待办进入 call-ended；旧请求不可提交或续接，已保存值保留 |
| C24 | 管理页单纯测试与其他会话分析并发 | 不撤销 lease；同 datasource 独立测试可分别完成，无全局单飞要求 |
| C25 | 终态保留到期、容量不足与刷新 | 未到期记录不被提前淘汰；满载在副作用前拒绝；未知结果不被当作未写入，不自动重发秘密值 |
| C26 | Workspace 重绑定但 datasource 名称和引用相同 | 旧上下文写请求被拒绝，不在新 environment 上执行旧动作 |

测试分为协调器/操作定向测试、真实 RPC 与 Client 组件测试、通过现有 DSH Loader 的组装场景，以及真实
Web/Agent 验收。仅有 mock Promise 或端口健康不能作为自动续接已通过的证据。

真实验收在隔离测试 Workspace 和明确的测试凭证上进行：native 等待超过 65 秒、刷新、提交错误值、修改为
正确值，确认无需聊天消息即可继续；Code Mode 分别验证外层预算内提交和超过实际配置的 maxWallMs 后结束，
记录运行时与预算，不能以内部 Tool 超时测试替代外层验证。

再验证普通 test 网络失败直接返回 Agent、配置验证失败后交给助手排查、管理操作首次响应丢失及取消/轮换
竞争。不能清空现有用户 DSH 凭证来准备测试。无法取得真实 Code Runtime 验证环境时，明确记录该项阻塞。

## 11. 落地顺序与交付条件

1. 实现上下文、请求与操作边界、公共 credential/bridge 封装及 RPC；先验证首次响应丢失恢复、终态保留和引用读写竞争。
2. 接入 test/access 与现有 lease 管理器，完成非交互、子 Agent、普通失败直返和 Code Mode 预算结束路径；不修改 DSH loop。
3. 实现常驻管理页、待办入口、可更换表单和失败面板，删除旧结果触发弹窗的实现。
4. 验证映射与存储保持原规则，无迁移、无双通道秘密值存储；补充包内 Client 构建与分发验证。
5. 完成组装与真实环境验收后，同步模块/总体架构及用户文档，并记录未通过或被阻塞的用例。

执行变更使用 Node 24，运行定向测试、`npm run check`、`npm run build`、`npm run verify:plugin-package`
和 `git diff --check`。不得修改 sibling 仓库或 DSH 安装产物来让验收通过；不支持的现有扩展接口应作为插件
方案的真实阻塞说明。提交与发布按用户另行指令执行，保留本仓库当前无关改动。

## 12. 首版明确不提供的能力

- 全量 DSH credential 枚举、已保存秘密值回显、导入导出、历史秘密值或自动回滚。
- Workspace 独立秘密值命名空间、现有引用映射迁移、通用 OAuth/SSO 和密码管理器。
- 自动判断所有连接失败的根因、自动轮换账号、连接失败后的无限自动重试。
- 对任意 Shell/SQL 分析的透明重放，或因一次测试成功而保证未来权限与连通性。
- Host 重启后的原调用恢复、跨进程全局原子凭证更新、持久化凭证有效性数据库。
- Code Mode 无期限人工等待、延长上游执行预算、外层结束后的原调用自动续接。

首版支持发现和管理 datasource 引用、任务中安全输入、配置失败纠错，以及原调用存活时验证成功后继续。
普通连接失败交给 Agent 处理；原调用结束后，用户通过管理页完成配置并重新发起任务。
