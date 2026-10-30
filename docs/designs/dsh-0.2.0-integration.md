# DSH 0.2.0 升级与数据分析能力集成设计

## 状态与目标

状态：设计，未实施。编写日期：2026-09-29。事实基线来自 `dsh-v0.1.7-rc.2` 与 `dsh-v0.2.0-rc.1` 两个 tag 的只读源码核对，以及本机 Desktop 运行身份；本文不代表 0.2.0 已通过真实验收。

目标是利用 DeepSeek Harness `0.2.0-rc.1` 相对于 `0.1.7-rc.2` 的可用增量，为数据分析流程补齐三件事：定时分析交付、长任务的未决结果语义、可选可观测性；同时为上游客户端行为变化建立回归清单，保持 Runtime/Workspace 身份、凭据作用域、报告对象与 Skill 路由不变。

首期包含四个依次验收的步骤：0.2.0 基线兼容适配、定时分析交付、长任务与未决结果语义、交付面回归。可观测性列为可选方向。发布、重装或清理用户 profile、启用上游 bundle、重启当前服务不在本设计的授权范围内。

## 事实基线

| 对象 | 核对基线 |
| --- | --- |
| 插件源码 | 当前工作区 `ef23e16`（`main`，工作区干净） |
| Harness 起点 | `dsh-v0.1.7-rc.2`，`477b4f420553e8a52c2fbccc464d7561b239c443`（2026-09-24） |
| Harness 目标 | `dsh-v0.2.0-rc.1`，`4878cdabd87d4041bdaff61d04c966883b9fd07a`（2026-09-28） |
| 同系列后续 | `dsh-v0.2.0-rc.2`，`639ed015397290b3745d163aafe02ffee4aa3f84`（2026-09-29，npm `next`） |
| 本机运行身份 | Desktop `app.asar` 内 `@deepseek-ai/dsh-desktop-runtime` `0.2.0-rc.1`，随包提供 `dsh-otel`、`dsh-schedule`、`dsh-time-context`、`dsh-client-ui-schedule`、`dsh-experimental-schedule-bundle` |
| 插件兼容声明 | `peerRange` 为 `>=0.1.7-rc.1`；devDependencies 与最近验收基线固定 `0.1.7-rc.1` |

差异范围见[两个 tag 的 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.2...dsh-v0.2.0-rc.1)：1109 个文件、约 +20.4k/−78.0k 行，其中 `docs/persistence-schema.json` 一份占约 7.5 万删除行，多数包只有版本号变更。核对方式为 `git diff`、`git grep` 与逐包 `package.json#exports` 比较；未在 0.2.0 上安装或运行本插件。

上游发布说明中的"自动化任务改由可选插件包提供"经源码核对成立；但 `packages/schedule/schedule/src` 与 `packages/context/time-context/src` 在两个 tag 之间零 diff——变化的是分发与挂载方式，不是 Schedule 本身的能力。

## 责任边界与不变量

| 所有者 | 本设计中的责任 |
| --- | --- |
| Harness | Schedule 任务的存储与到期投递、时钟上下文、失败步骤的工具结果恢复、OTel 通道、`present` 与文件预览、slot 与客户端布局 |
| Marivo | 分析语义、Catalog、Artifact、Evidence、Quality、lineage 与有效性契约 |
| 本插件 | Runtime/Workspace binding、受控执行与凭据、Skill 路由、报告保存与交付、定时任务的业务接线、集成验证与回归 |

- 不复制上游 schema、registry 或调度/遥测实现；上游已有能力（`schedule_*` 工具、OTLP 客户端、时钟读取）不做插件版 wrapper。
- 上游已有能力的**用法与 schema 不进入本插件的 prompt 或 Skill**：`schedule_*` 的时机选择、cron 方言、标题规则、DST 与补投语义由工具描述和投递框架自带，插件文档只写本项目的启用方式与交付契约。
- 不自动启用 `dsh-experimental-schedule-bundle`，不修改用户 profile，不静默安装依赖；能力缺失时明确报错并给出可执行的手动步骤。
- 不在插件 patch 中按 id 引用上游已迁出的行（`time-context`、`schedule`、`ui-schedule`），避免未启用 bundle 时的 `entry not found`。
- 凭据保持 Harness 管理、operation-scoped；secret 不进入日志、结果、Agent 参数或 telemetry 属性。
- 定时任务复用现有 `marivo_present` 与报告对象语义，不新增第二套报告、凭据或发布路径。

## 上游增量与集成判定

| 增量 | 上游证据（tag `dsh-v0.2.0-rc.1`） | 判定 |
| --- | --- | --- |
| Automation tasks 改为可选 bundle | [schedule-bundle/cordis.patch.yml#L9-L16](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/experimental/schedule-bundle/cordis.patch.yml#L9-L16) 插入三行；[app-boot/src/profile.ts#L213-L217](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/boot/app-boot/src/profile.ts#L213-L217) 列入 `OPTIONAL_BUNDLES`；对照起点这三行在 web-app 组合中且 `disabled: true` | 纳入：仅启用说明与集成验收（方案二），不改 Skill 与 prompt |
| 未决工具结果恢复 | [core/session/src/repair.ts#L15-L18](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/session/src/repair.ts#L15-L18)、[#L105](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/session/src/repair.ts#L105)；[core/agent-loop/src/agent.ts#L331](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/agent-loop/src/agent.ts#L331) | 纳入：仅回归验收（方案三），不改工具描述 |
| `ctx.otel` 共享通道（新包 `@deepseek-ai/dsh-otel`，随 `dsh-base` 交付） | [telemetry/otel/src/index.ts#L13-L30](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/telemetry/otel/src/index.ts#L13-L30)；[bundle/base/cordis.patch.yml#L188](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/bundle/base/cordis.patch.yml#L188) | 可选（方案四），默认不引入 |
| 网页搜索走 DeepSeek 账号 | [web-search-deepseek/src/index.ts#L85-L86](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/web/web-search-deepseek/src/index.ts#L85-L86) | 复用，无插件改动 |
| 插件管理安装引导、输入脱敏、刷新失败 toast | `packages/client/ui-plugin-manager`（`sanitize-install-input.ts`、`PluginRefreshToast.tsx`） | 复用；用于社区分发说明与设置卡反馈范式 |
| `TextShimmer` / `DisclosureRow` / `Tooltip` / `pointerModality` | [ui-primitives/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/client/ui-primitives/src/index.ts) | 复用为交付面样式，仅需回归 |
| Host 插件自带 Skill 的官方范式 | [sandbox-windows-acl/src/acl-skill.ts#L44](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/sandbox/sandbox-windows-acl/src/acl-skill.ts#L44) | 复用；`dsh-skill` Provider API 未变 |
| ui-chat 默认工作细节与运行时钟 | [ui-chat/src/chat-settings.ts#L32](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/client/ui-chat/src/chat-settings.ts#L32)、[client/apply.ts#L149](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/client/ui-chat/src/client/apply.ts#L149) | 回归项 |
| 浮层顶部安全区调整 | `packages/client/ui-primitives/src/overlay-top-margin.ts` | 回归项 |
| ui-workspace 标题语义与 `forkSession` | `packages/client/ui-workspace/src/client/{tree.ts,navigation.ts}` | 回归项 |
| Desktop product analytics | `packages/client/product-analytics`（Desktop-only） | 不采用 |
| Windows 沙箱权限诊断 Skill | `packages/sandbox/sandbox-windows-acl` | 不采用（Harness 自带） |
| webworker runtime | `packages/experimental/webworker-runtime` | 不采用（浏览器预览无真实进程，`marivo_python` 不适用） |

兼容性核对结果（本设计的事实依据，不是上游承诺）：

- 36 个 `@deepseek-ai/dsh-*` peer 在 0.2.0-rc.1 中全部存在、仓库路径未变、`package.json#exports` 映射零变化。
- 插件注册的 7 个 slot 名称在两个 tag 中的出现次数完全一致：`plugins.bundle.config`、`conversation.input.dock`、`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`、`conversation.session.header.actions`、`conversation.chat.node`、`tool.call.toolview`。
- 直接依赖的 host 包只有版本号变化：`workspace`、`session/session`、`scope`、`core/tools`、`typert-*`、`shell*`、`sandbox*`、`credentials`、`storage-domain`、`atomic-write`、`attachment`、`deliverables/tool-present`、session 投影与查询。
- 上游确有破坏性接口，本插件未使用：`NativeCommandRunner` 新增必填 `window` 参数；telemetry 适配器新增 `inject: ['otel']`；`DeepSeekAccount.getDeviceIdentity()`；`session-log-deepseek` 的 `Volatile<boolean>` 与必填 `maxBytes`；`config-editor` 改为组合式 `inherited`。

## 方案一：0.2.0 基线兼容适配

### 依赖与契约

将开发与验收使用的 distribution 及直接 DSH 依赖统一到精确 `0.2.0-rc.1`（或系列内最新 rc），通过 Node.js 22.19.0 与 `npm install` 更新 lockfile，并检查实际解析图，避免 rc.1／rc.2 混装造成虚假通过。

`peerRange` 暂不提高：`0.2.0-rc.1` 已落在现有 `>=0.1.7-rc.1` 声明内，提高最低基线只应在 0.2.0 通过真实验收、且确有 0.1.7 无法满足的能力需求时进行。既有 `0.1.7-rc.1`／`0.1.7-rc.2` 验收记录保留为历史证据，不因本轮适配改写。

本次手工核对（peer 包存在性、`exports` 映射、slot 名称集合）应固化为可重复检查，纳入兼容性测试或 `scripts/` 检查入口，使下次版本升级不必依赖一次性 diff。

### 回归重点

右侧 Tab 与报告 reader 仍承担主要交付面。需要证明：同一报告在当前 pane 内按 Host 规则复用；资源 Tab 显示正确 Report/Build；关闭、重连、切换 Session 与语言不会丢失身份或复活旧请求。工具卡片、设置卡（`plugins.bundle.config`）、语义引用 source 与输入触发器按新版本 slot 契约保持注册与卸载行为。

上游客户端行为已在 0.2.0 变化（见[交付面回归](#交付面回归与体验对齐)），基线适配必须把"默认工作细节模式""浮层顶部安全区""未命名会话标题"列入同一轮回归，而不是等用户报告。

## 方案二：定时分析交付（复用上游调度，不改 Skill）

### 能力与边界

上游把 `time-context`、`schedule`、`ui-schedule` 三行从默认 Web 组合移到可选 bundle [@deepseek-ai/dsh-experimental-schedule-bundle](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/experimental/schedule-bundle/README.md)，用户从插件管理页的 Official 分组启用后，根 Agent 获得 `schedule_create`、`schedule_list`、`schedule_update`、`schedule_delete`（[tools.ts#L417-L493](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/schedule/schedule/src/tools.ts#L417-L493)），并在符合条件的步骤获得时钟读数。

任务存储、到期判定、投递与 Session 复活由 Harness 拥有：记录绑定原会话，到期以 follow-up 回到该会话（[Schedule 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/docs/subsystems/schedule.md)）。插件不实现调度器、不改写任务表、不代用户启用 bundle。

### 用户流程

用户在插件管理页启用 Automation tasks；随后在已有分析会话中提出周期需求（例如"每周一 09:00 生成上周销售报告"）。到期时该会话收到 follow-up，Agent 复用既有流程完成一次分析：`marivo_python` 取数与计算、`marivo_present` 保存报告、current/Build 与 receipt 语义不变。已有报告可被后续周期继续更新，形成同一血缘链。

首期只改用户可见文档：README 与安装说明增加"启用 Automation tasks 后可排定周期报告"的说明，并写清未启用时的行为。**不修改 Skill、不向常驻 system prompt 增加调度内容、不注册插件版定时工具。**

### 为什么不在插件 Skill 里重复用法

上游 `dsh-schedule` 不注册 Skill，也不追加 system prompt 段落，只注册四个工具（[src/index.ts#L175](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/schedule/schedule/src/index.ts#L175) 的 `registerScheduleTools`）；用法完全落在模型必然能看到的两处：工具 schema 与描述（选择器、DST 跳过、错过补投、崩溃重复语义），以及到期投递时的固定框架文本（要求把 `reminder_prompt` 当作 untrusted 内容呈现、逐条呈现到期提醒，见 [Model Experience](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/schedule/schedule/README.md#model-experience)）。

在插件 Skill 里再写一份"如何使用定时任务"，代价大于收益：

- 上游 README 明确记录这四个 schema 的固定 request-context token 成本，插件再叠加一份说明等于每轮都付重复成本；
- cron 方言、标题长度、补投与 DST 语义归上游所有，插件复述会在每次版本升级后漂移；
- 到期投递可能发生在长期会话或 compaction 之后，Skill 是否仍在上下文由路由决定，不能作为触发时的可靠依据；
- 与本设计的不变量及仓库既有约定冲突：不复制上游 schema 与语义行为。

插件真正拥有的是**交付契约与集成事实**，不是调度用法。因此方案二的实现面只有文档与验收；只有在验收暴露真实缺口时（例如冷会话被唤醒后不走向展示交付、或把上一份报告当作本轮结果），才在现有 Skill 中补一条最小的、分析专属的约束。

### 失败与不变量

- 不假设 `time-context` 存在：未启用该 bundle 时没有时钟读数，涉及相对日期（"上周""环比"）的任务必须要求用户显式给出日期区间或时区，避免口径漂移。
- 定时触发不携带凭据；每次执行仍走所属 Workspace 的 binding 与 operation-scoped 凭据解析。
- 会话不可复活、Workspace 未绑定或凭据失效时报告真实原因，不静默跳过，也不把上一周期报告当作本轮结果重发。
- 任务创建与删除的动作归 Harness；插件不缓存任务状态副本，读取展示时以 Harness 的实时结果为准。

## 方案三：长任务与未决结果语义（验收为主，不改工具描述）

### 上游语义

失败步骤关闭前，driver 为每个尚无结果的 assistant 工具调用补一条错误结果：已记录 `tool/call` 的得到 `TOOL_OUTCOME_UNKNOWN`，没有启动记录的得到 `TOOL_NOT_STARTED`（[repair.ts#L15-L18](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/session/src/repair.ts#L15-L18)、[#L105](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/core/session/src/repair.ts#L105)）。恢复文本要求只对只读或幂等操作直接重试，存在副作用时先核实外部状态或询问用户；`ToolCallRecovery`、`TOOL_NOT_STARTED`、`TOOL_OUTCOME_UNKNOWN` 由 `dsh-session` 公开导出。

### 判定：收益来自上游，插件不改工具描述

这一步的用户收益在升级完成时**自动成立**，不需要插件代码：步骤失败后对话不再卡死，未答复的调用获得配对结果，后续请求可以继续、fork 或压缩，并且模型在失败结果里被直接告知"结果未知、只对只读或幂等操作重试、有副作用先核实或询问用户"。它对本插件的 `marivo_python`、`marivo_present` 一视同仁。

因此把"先核实外部状态再重试"写进插件工具描述属于重复，而且位置更差：上游把该指令注入在失败结果里，**保证在需要的那一刻在上下文中**；静态描述每轮都付 token，且可能已被压缩掉。`marivo_present` 的描述本就带有更强的专用指引（report-save-conflict 要先读当前报告再对齐，绝不只改 `expected_build_id` 重试），也无需新增。

另一半风险经核对也不存在：报告提交是原子的——单次目录 rename 发布全部文件，current 通过一次原子 rename 变为可见，rename 之后的取消无法回滚（[commit.ts](../../packages/dsh-data-analysis/src/presentation/commit.ts)、[reports.ts](../../packages/dsh-data-analysis/src/presentation/reports.ts)）。中断的 `marivo_present` 只有"未发布"或"完整发布"两种结局，不会留下看似完整、实则半截的报告。

### 缺口假设（先测后补）

方案三的实现面因此只有回归验收。只有实测暴露具体缺口时才做最小补充，候选缺口如下：

- 中断的 `marivo_present` 在模型不知道 `report_id` 时，是否有只读的核实入口（当前设计不注册报表检视 wrapper，核实依赖工作区文件或用户界面）。
- `marivo_python` 被 `exec.signal` 中止后（[tool.ts](../../packages/dsh-data-analysis/src/presentation/tool.ts) 使用 `AbortSignal.any([exec.signal, lifecycleSignal])`），部分写入的文件是否可被发现并解释。

两个假设都要先用真实中断路径验证；验证不成立就不写任何文案或代码。

### 不变量

- 不把恢复结果当成功，也不因补结果重复交付卡片或重复写文件。
- 只读路径（`marivo_help`、`marivo_datasource_test`、语义与 Catalog 查询）可直接重试；带副作用的一次执行中断后先核对已有产物再决定是否重跑。
- 计划/展示草稿的本地状态不因上游恢复语义改变；插件不复制会话事件，也不自行合成 tool result。
- PTC 嵌套调用沿用 Harness 的持久事件所有权；外层失败不撤销已成功的原生声明。

### 验收重点

在 0.2.0 上模拟步骤失败与执行中止后继续对话：历史中 call/result 成对、会话可继续；current 不出现半成品报告；不产生重复 Report Build；带 `report_id` 与 `expected_build_id` 的重试得到 `report-save-conflict` 而不是静默覆盖；中断的 Python 执行不重复写入；fork 后的子会话在缺结果历史下仍可继续。

## 方案四：可选可观测性（`ctx.otel`）

上游新增 `@deepseek-ai/dsh-otel`，随 `dsh-base` 交付，通过一次 `ctx.otel` 提供相互独立的 ordinary-event 与 Session-log 通道（[otel/src/index.ts#L13-L30](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/telemetry/otel/src/index.ts#L13-L30)）。

判定：暂不引入。只有在存在明确消费者（分析耗时、交付成功率、失败分类的观测需求）时才以可选依赖 + 运行时探测接入，并满足：属性中不含凭据值、SQL 文本与用户数据；通道在插件 `dispose()` 时关闭并遵守外层超时；未挂载 `otel` 的 profile 中插件照常工作。该方案不作为首期完成条件。

## 交付面回归与体验对齐

以下变化来自上游，本插件预计不需要改代码，但必须在 0.2.0 上回归；标注"待实测"的结论尚未在真实运行中验证。

| 变化 | 影响面 | 处理 |
| --- | --- | --- |
| 非 Desktop Web 的默认 `transcriptView` 由 `standard` 改为 `detailed`；旧值 `normal` 读作 `detailed`；运行时长展示从轮次头部移到会话级 `RunningStatus` | 工具结果与报告 Tab 的默认折叠态 | 对 Python 工具卡与报告 Tab 做详细模式截图回归 |
| 浮层顶部安全区改为 `max(min, (fullscreen ? 0 : clearance) + 20)` | Desktop 上插件自绘浮层与右侧 Tab 面板整体下移约 20px | 对比回归；仅当遮挡关键操作时调整自身边距 |
| 未命名会话行标题可能为空串（`displayTitle` 语义变化） | 报告来源跳转与会话目录展示 | 检查 `src/client/presentation/catalog.tsx` 的回退显示 |
| `forkSession` 新增可选 `onCreated` 回调并返回 childId | 未来从长分析会话分叉子分析 | 首期只用类型适配，不新增功能 |
| `TextShimmer`/`DisclosureRow` 渲染结构变化（活动态渲染装饰副本，根盒变为 `inline-grid`） | `src/client/python-tool/card.tsx` 的 `keepContentWhenOpen` 卡片 | 待实测；children 不得带副作用或 element id |
| 插件管理页安装引导、Git 模板提示、来源信任提示 | 社区插件安装路径 | README 与安装说明引用「插件 → 官方 → Automation tasks」 |

社区分发说明需要同步：0.2.0 默认组合不含定时能力，安装文档不能承诺"安装后即有周期任务"。

## 后续方向

| 方向 | 可能收益 | 纳入实施前的条件 |
| --- | --- | --- |
| 时间口径 Skill 指引 | 相对日期与跨时区分析更稳 | 明确启用 `time-context` 与未启用两种路径下的提示差异 |
| 会话日志上传设置（`ui-settings-session-log`） | 分析过程的审计与复现 | 与 Harness 的反馈策略对齐，不额外收集用户数据 |
| fork 子分析 | 在同一会话族内并行拆解大问题 | 明确子会话的 Workspace 绑定、报告归属与交付责任 |
| OTel 指标消费者 | 交付质量与性能的长期观测 | 见方案四的前置条件 |

## 实施顺序与验收

每步形成可独立检查的变更，保留工作区无关内容。前一步未通过时先修复其接缝，不叠加后续功能掩盖失败。

| 步骤 | 修改范围 | 必需证据 |
| --- | --- | --- |
| S1：0.2.0 基线适配 | 根／包 manifest、lockfile、compatibility 相关说明、受影响的客户端接缝、兼容性检查入口 | 依赖解析一致；相关测试、`npm run check`、`npm run build` 与 `npm run verify:plugin-package`；打包插件在 0.2.0-rc.1 的真实隔离 Web 核心流程回归 |
| S2：定时分析交付 | README 与安装说明；不改 Skill、prompt 与调度实现 | 启用 Automation tasks 后真实模型能创建并列出任务；冷会话到期 follow-up 完成一次分析并交付报告；未启用 bundle 时有明确的手动引导；插件注入的 prompt 段与 Skill 目录与 0.2.0 前一致 |
| S3：长任务与未决结果语义 | 不改产品代码；新增中断与失败路径的回归用例与证据 | 步骤失败后会话可继续；call/result 成对；current 无半成品；带 ids 的重试得到 conflict；中断的 Python 执行不重复写入 |
| S4：交付面回归 | 必要时的最小布局适配与测试；否则只记录结论 | 详细模式、浮层位置、未命名会话标题、工具卡片布局的对照证据 |

具体命令复用[验证指南](../validation.md)与根 `package.json`，新增用例扩展相关现有入口；表中所需覆盖不表示现有脚本已全部提供。

### 验收用例

| 场景 | 通过条件 |
| --- | --- |
| 启用 Automation tasks 后创建周报任务 | 任务出现在任务页并可列出；关闭或删除后不再投递 |
| 到期触发一次周期分析 | 在原会话（含冷会话恢复）收到 follow-up 并完成分析；报告复用 current 与既有 Build 语义，不重复新建报告，receipt 一致 |
| 未启用 Automation tasks | 明确说明能力缺失与手动启用步骤；不自动安装、不伪造任务 |
| 插件注入内容不因调度变化 | 启用前后插件 prompt 段与 Skill 目录一致；调度用法只来自上游工具描述与投递框架 |
| 未启用 `time-context` 时提出"上周"分析 | 要求显式日期区间或时区后继续；不静默按本机时间猜测 |
| 步骤失败或执行中止后继续对话 | 未决调用有配对结果；会话可继续；current 无半成品报告；无重复 Report Build；中断的 Python 执行不重复写入；带 ids 的重试得到 conflict 而非静默覆盖 |
| 详细模式下的分析交付 | Python 工具卡与报告 Tab 内容完整、折叠与展开正常 |
| Desktop 浮层与右下 Tab | 无关键操作被标题栏或安全区遮挡；位置与 0.1.7 基线差异可解释 |
| 会话目录与报告来源跳转 | 未命名会话不再显示空白入口；跳转绑定正确 Session 与 Workspace |
| 兼容性检查 | peer 包存在性、`exports` 映射与 7 个 slot 名称的断言全部通过 |

验收记录包含候选 commit 或 diff 指纹、打包产物摘要、实际 DSH／Node／Runtime 身份、profile 与模型路由、固定数据、断言结果与跳过项。真实模型自主选择、脚本强制工具调用与组件 fixture 分开记录，不能相互代替。

文档阶段仅检查相对链接、Markdown 渲染结构与 `git diff --check`。实施后再同步模块文档中的当前行为，并在 [验证指南](../validation.md) 记录实际验收；不提前把上述用例写成通过。

## 完成边界

首期完成意味着：0.2.0-rc.1 候选通过规定验证，周期分析具备可用的启用与交付闭环，未决结果语义在分析工具上可解释、可核实，交付面回归有对照证据。发布、重装用户 profile、自动启用上游 bundle、重启当前服务、清理用户状态及方案四的可观测性均不属于完成条件。升级失败时保留证据并修复候选，不通过降级、删除用户 Session 或改动上游 profile 来规避问题。
