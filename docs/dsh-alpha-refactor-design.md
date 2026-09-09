# DSH 0.1.5-alpha.1 重构与优化设计

## 状态与结论

2026-09-09。本文在[兼容升级与现有功能验收](dsh-alpha-compatibility-acceptance.md)完成后编写。
当前代码已适配 DSH `0.1.5-alpha.1`；第一阶段的默认 client 迁移已实现，保留无 Session 阅读与写操作容器。
实现与验收见[第一阶段记录](dsh-right-tabs-stage-one-acceptance.md)；[1a 记录](dsh-right-tabs-prototype-acceptance.md)保留原型时的证据。

第一阶段目标已确认：**保留数据源、语义层、报告三个入口，将浏览页面与报告正文接入原生右侧 Tab，
当前会话的新报告交付后自动展开正文**。随后优化上下文披露，再验证原生上传驱动的数据入口。
暂不重写分析执行、报告协议、凭据管理或离线 reader。新版主要降低通用交互和接线成本，不替代 Marivo 的分析能力。

## 相比 0.1.2-rc.1，哪些变化有实际价值

比较基线是 npm 发布的 `0.1.2-rc.1` 与 `0.1.5-alpha.1`，不是旧本地源码目录。
本项目升级前锁定的部分开发依赖还是 `0.1.1-rc.2`，因此本次兼容修改量不能直接当作两个指定版本的差异量。

| 变化 | 本项目的实际影响 | 设计判断 |
| --- | --- | --- |
| Client API 从旧 `dsh-client-runtime` 分到 Session/Workspace Controller、Conversation、Chat 等包 | 类型、注入声明、对话节点注册需要迁移 | 跟随公开服务边界，减少以后追随内部模块变动的成本 |
| 原生右侧 Tab、分栏、浮窗、全屏与资源导航 | 报告、语义对象和会话可同时显示 | 最值得优先采用；不再自行实现这组布局功能 |
| Lexical composer 与原子引用、scoped input 操作 | 用整段 `setDraft` 写 Ask DSH 会丢失引用结构 | 当前已修复；后续所有追加入口共用同一接缝 |
| 独立文件上传服务及 Session 所属的上传凭证 | 可复用传输、进度、取消和附件准入 | 支持新的文件分析入口，但上传成功不等于数据源创建或分析完成 |
| Session 公共读取/持久化契约与 PTC 事件调整 | 测试与事件适配不能依赖原始数组、文件布局或旧事件名 | 当前已迁移；继续由 Harness 保存 Session 事实 |
| 浏览器启动令牌、cookie 与共享 API 认证 | 自定义 RPC 必须接入 Host 的认证边界 | 当前使用 Connection 精确 Fetch 路由；不另建认证层 |
| Prompt/context 公共贡献接口 | 可以分离稳定规则与变化的运行事实 | **rc.1 已有动态 section/context/variable**，这属于既有能力优化，不是 alpha 新增功能 |

依据：[版本发布记录](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1)、
[右侧面板公开契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/ui-sidebar-right/README.zh.md)、
[文件上传公开契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/file-upload/README.zh.md)、
[Prompt 公开契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/core/system-prompt/README.zh.md)。

## 责任边界与不变量

| 所有者 | 保留的责任 |
| --- | --- |
| Harness | Agent、DSH Session、Tool/Skill 生命周期、Credentials、profile、通用上传、composer、对话与面板布局 |
| Marivo | 分析语义、datasource 定义、Artifacts、Evidence、Quality、lineage、有效性与 Marivo Session |
| 本插件 | Runtime/Workspace binding、实时披露、凭据安全接入、展示投影与提交、receipt、面向 Marivo 的 UI 接缝 |

任何阶段都保持以下约束：

- Runtime 与 Workspace identity 不因切换 Tab、上传或重连而改变；相同磁盘路径不能替代 Workspace 身份。
- 报告以 `workspaceId / reportId / buildId` 寻址。current 指针与固定 Build 的含义继续分开，历史事件不重写。
- 语义浏览只读 Catalog 元数据；打开关系、标签页、来源详情不执行 observe、分析或隐式凭据测试。
- 凭据仍由 Harness 管理，值只在 operation-scoped 边界进入子进程，不进入导航参数、引用、模型上下文或日志。
- Ask DSH 只准备草稿；自动发送、自动分析和自动创建数据源都不由点击报告上下文触发。
- 原生与 PTC 共用 canonical receipt；离线 HTML 不依赖新的 Host 面板、上传服务或在线 Runtime。

## 第一阶段：数据源、语义层与报告原生标签页

### 目标与页面分工

三个入口保持稳定，浏览页面统一进入原生右侧 Tab。用户可在会话旁查看数据源与语义定义，分析完成后直接阅读报告，
并通过报告目录跨会话找回 Workspace 中的成果。数据源展示页迁移属于本阶段范围；写操作继续使用现有操作容器。

| 入口或页面 | 位置 | 职责 |
| --- | --- | --- |
| 数据源、语义层、报告三个入口 | 保留在会话标题旁，按此顺序排列 | 打开所属 Workspace 的对应页面 |
| 数据源展示页 | 原生右侧 Tab | 列表、属性、凭证配置状态与最近测试结果；不回显凭据值 |
| 语义层展示页 | 原生右侧 Tab | 搜索对象，浏览定义与关系 |
| 报告展示页 | 原生右侧 Tab，作为报告目录 | 查找报告、查看更新时间与来源、进入历史版本 |
| 单份报告正文 | 独立原生右侧 Tab | 阅读、筛选、探索、来源、下载与 Ask DSH |
| 新增数据源、填写或更换凭证等写操作 | 保留现有操作容器 | 输入、确认、取消与操作反馈；连接测试仍须显式触发 |
| 报告编辑 | 保留现有编辑容器 | 草稿、保存冲突与取消保护 |

点击三个入口分别打开或聚焦对应目录页，重复点击不新增。数据源的一般详情在数据源页内切换，本阶段不要求每个
数据源独立开 Tab。语义对象支持独立打开，报告中的语义引用可直接定位对象。打开单份报告正文时保留报告目录，
便于继续查找第二份报告。用户通过 Host 原生控件分栏、浮窗或全屏；窄屏与布局手势由 Host 处理。

Workspace 决定内容范围，Session 决定 Tab 所属的界面与交互上下文。同一 Workspace 的不同 Session 看到同一份
报告目录，各自保留打开状态。目录与资源身份均须包含正确的 Workspace 绑定，不能用当前前台 Session 替换所属身份。

### 新报告交付、对话卡片与报告目录

用户正在查看当前分析 Session，且报告成功保存并完成交付后，对话中保留报告卡片，右侧自动打开这次交付的报告正文，
Workspace 报告目录同步反映该报告或新版本。三处呈现引用同一份报告事实；不自动打开报告目录。

自动打开仅针对当前 Session 的新交付。后台 Session 完成、历史消息回放、刷新、重连或重新进入旧 Session 都不触发
自动打开或抢焦点；失败和未完成保存的报告也不触发。关闭 Tab 不删除报告，后续仍可从卡片或目录打开。
新交付的识别必须依据 Harness 公开事件与生命周期，不能把卡片渲染或组件挂载当作新交付。

报告卡片提供某次分析交付的回看入口；报告目录提供 Workspace 范围的查找入口，每份报告只占一条记录，更新形成
新的历史版本。来源 Session 不再可用时，仍沿用既有 Workspace 报告访问能力。

| 打开来源 | 默认目标 |
| --- | --- |
| 新交付后自动打开 | 本次交付的固定 Build |
| 对话报告卡片 | 该次交付的固定 Build |
| 报告目录中的标题 | current，解析报告当前版本 |
| 历史版本列表 | 所选固定 Build |

current 与固定 Build 必须明确标识并允许并排；即使当前解析到相同 Build，也保留两种导航目标的区别。
重复打开同一目标聚焦已有 Tab；再次打开 current 时重新核验当前指针，固定 Build 不随新版本发布改变。
下载、来源与 Ask DSH 始终对应实际显示的 Build。current 采用“提示后刷新”：本次交付或编辑保存后刷新报告目录，
并核验已打开 current 页；发现新版本只提示，用户点击刷新或重新打开 current 才切换 Build。切换时重置旧版本的
筛选、选择与来源上下文，固定 Build 保持不变。不新增后台轮询；重连和回到所属 Session 时重新建立事件基线。

Workspace 的发布刷新独立于前台自动打开。已有报告页的 Workspace 同时订阅所属 Session 的公开事件与运行状态：
后台新交付刷新目录并提示 current，仍不打开 Tab；没有已打开事件窗口的后台 Session 结束运行时，仅核验发布事实。
这不主动打开历史窗口或创建 Session。配置容器关闭的自动刷新必须先核验页面生命周期和所属绑定，不能解除页面失效状态。

### 接入方式

使用 `ctx.sidebarRightTabs.register` 登记内容类型，通过 `sidebar.right.pane.tab` 注册正文，
由 `useTabInfo()` 读取当前 Tab 的导航、可见性、绑定动作和取消信号。
报告复用 `HostPresentationReader`；语义对象复用当前 Catalog/详情组件和服务；数据源页复用现有安全状态读取接缝。
报告卡片、三个入口、目录条目和语义引用共用导航函数；浏览与写操作拆分，不复制凭据管理或分析语义。

第一阶段采用 `dsh-resource://marivo-report/{workspaceId}/{reportId}/current`、
`dsh-resource://marivo-report/{workspaceId}/{reportId}/build/{buildId}` 和
`dsh-resource://marivo-semantic/{workspaceId}/{kind}/{path}`，每一段单独规范编码。通过严格的 `patterns` 与
`canOpen` 认领后调用 `openResource`。三个目录使用 `marivo-datasources`、`marivo-semantic`、`marivo-reports`
页类型，参数显式携带所属 Workspace；绑定变化使旧页失效，重新打开时不继承旧 Workspace 状态。
`history` 仅作为报告导航的定位参数，不参与报告身份；未知格式不予认领。
具体报告与独立语义对象使用资源地址；current 与固定 Build 的差异进入资源身份，不能仅放在导航 params 中。
不把任意报告都挤入一个同 kind 的页地址；未知地址明确失败，资源匹配范围不能抢占原生文件预览。

| 状态 | 权威或生命周期 |
| --- | --- |
| Tab 位置、分栏、浮窗、全屏 | Harness 的 Session 面板状态 |
| 报告 current、已发布版本与固定快照 | 现有报告存储与完整性校验 |
| 读取请求 | Tab 的所属 Session/Workspace，加导航 revision 与 AbortSignal |
| 图表筛选、探索与选中 cell | 当前 reader 状态；不写回分析结果 |
| 目录搜索、对象选择、加载与错误 | 各 Tab 独立的页面状态；不共享单个可变 overlay model |
| 语义对象定义与关系 | 当前 bound Runtime 返回的 Catalog |
| 数据源配置与操作结果 | 现有 datasource/credentials 服务；Tab 只呈现安全状态与触发显式操作 |

切换 Session 后，旧 Tab 的回调仍使用自身绑定动作，不能读取“当前会话”然后写入另一个 Session。
关闭 Tab 或导航替换后，迟到请求不更新新页面；折叠面板不等同销毁内容。
Tab signal 不替代导航 revision 检查。Ask DSH 第一阶段保留所属 Session 必须为当前 Session 的保护，
不满足时提示回到所属 Session；只追加草稿，不自动发送。

### 必须先解决的限制

上游侧栏目前在刷新后回到默认折叠态，且公开导航要求存在已挂载的 Session 面板。
因此不承诺刷新恢复布局；用户通过已有卡片或目录重开报告。没有活动 Session 的 Workspace 目录先保留现有入口。

公开契约没有证明存在通用的未保存编辑关闭拦截。第一步迁移数据源展示、语义浏览、报告目录与阅读，
报告编辑和数据源写操作继续使用现有容器；不能因为新增 Tab 而改变凭据等待流程或关闭时的操作归属。
只有在原型证明关闭/切换不会丢失草稿，且保存冲突、取消、离线导出均通过后，才迁移编辑并删除重复容器。
不访问私有 `_undo()`、内部布局 store 或自行覆盖 Host 关闭逻辑。

### 实施前的纵向原型

目标已经确定；原型用于证明公开接缝能实现目标，并确定状态与事件的具体接法，不将原型通过等同于本阶段完成。
使用精确 alpha 发布包和真实 Web，保留现有入口与容器，先跑通下面的最小链路，再全面迁移。

最小链路：在测试 Workspace 的前台 Session 完成一次真实报告交付，自动打开固定 Build；从报告目录打开 current
并排对照；由报告来源打开语义对象；打开数据源展示页并进入、取消现有配置操作。在第二个 Session 中验证后台交付，
并在上述页面中加入延迟响应，覆盖导航替换、关闭、重连和 Workspace 撤销。

| 待验证的不确定性 | 原型必须给出的证据 | 未通过时的处理 |
| --- | --- | --- |
| 新交付与历史回放能否通过公开接缝可靠区分 | Native/PTC 各一次真实交付只触发一次自动打开；重复事件、重挂载、刷新、重连和后台交付均不重开或抢焦点；新旧交付交错时不漏开、不误开 | 记录自动打开能力阻塞，保留点击卡片打开；不能以此宣称目标完成，不按组件挂载推断新交付 |
| 资源与目录的去重是否符合身份要求 | current 与固定 Build 可并排；同目标聚焦；同名不同报告不合并；三个目录绑定正确 Workspace；畸形 URI 失败且原生文件预览正常 | 先调整最小导航接缝与 URI 方案，再冻结格式，不访问 Host 私有布局 store |
| Tab、组件与请求的生命周期是否一致 | 切 Session、折叠、浮窗、替换导航后，各页状态符合所属身份；故意迟到的结果不覆盖新页；关闭与卸载清理请求；撤销 Workspace 后旧页失败 | 先拆分每个 Tab 的可变状态，结合 signal、revision 与所属身份校验 |
| 新 Tab 与旧操作容器能否安全交接 | 从数据源页进入再取消配置，测试与等待操作仍属于原上下文；从报告进入编辑并保存后，目录/current 正确反映更新，固定 Build 不变；旧 Tab 的 Ask DSH 不写入别的 Session | 保留旧容器并修正交接，不提前迁移写操作或删除旧路径 |
| 现有正文在原生容器中是否可用 | 两个窄格、全屏、浮窗与键盘导航下，图表、表格、来源弹窗和焦点正常；折叠再展开后尺寸恢复；离线 HTML 仍独立可读 | 在 Host 展示层调整容器与尺寸响应，不把 Host 依赖带入 portable reader |

交付记录应包含实际采用的公开 API、资源编码、事件判定依据、各页状态所有者、异常路径结果和真实 Web 证据。

### 验收与删除条件

- 三个入口打开所属 Workspace 的原生页面，重复点击聚焦；目录与独立资源页各自保留状态。
- 当前 Session 新报告交付后自动打开固定 Build；历史回放、后台完成、重连与重复事件不误开。
- 卡片默认打开交付 Build，报告目录默认打开 current；关闭 Tab 后报告仍可从目录找回，更新不新增重复报告记录。
- 两份不同 Report 可并排；同一 current 与固定历史 Build 能区分，标题相同也不会混淆。
- 原生文件预览与插件资源互不抢占；报告卡片和 ProducedFiles 继续同时出现。
- 切换 Session/Workspace、快速导航、关闭和重连均不串页，Workspace 撤销后旧页明确失败。
- 数据源展示不触发连接测试，语义浏览不执行分析；配置与报告编辑交接保留归属、取消和保存保护。
- 普通、窄屏、全屏、浮窗、键盘导航及离线 HTML 与当前基线一致。
- 只有这些检查通过，才移除有 Session 场景已被替代的浏览与阅读 overlay；无 Session、报告编辑与数据源写操作路径继续保留，直到有明确替代。

## 第二阶段：统一上下文接缝并降低重复披露

### 输入接缝

保留本次已验证的 `appendPresentationContext`：先核对所属 Session/Workspace，再用当前 `draftRev` 和原子引用坐标
调用 scoped `slash/input-insert-text`。后续来自报告、语义对象或选中文本的追加动作共用它。
出现 revision 冲突或提交中状态时保留来源页面和草稿，让用户重试；不改为整段文本重写。

上下文必须写出所选 Report/Build/cell、当前筛选和来源，控制体积；引用序列化仍交给所属 InputTrigger source。
不把展示文字升级为新的分析证据，也不因追加上下文自动执行工具。

### Prompt 与 Runtime 事实

将稳定安全规则、Skill 路由保留为短 section；只有确实变化的已知事实才考虑 `systemPrompt.context`。
候选事实包括当前绑定状态、已激活能力与有限的可用性摘要，不包括密码、数据行、长 Help 正文或整个 Catalog。

每次组装只读取内存中的已验证事实；不得在 context 回调里启动 Python、请求数据库或读取凭据。
尚未绑定时明确显示未绑定，而不是为丰富 prompt 提前初始化 Workspace。事实排序和表示稳定，内容未变化时不制造新差异。

现有 root Help 激活、实时读取、可见性与去重契约继续保留；不能把完整 Help 搬入常驻 prompt。
是否采用 context，以同一组真实模型任务的正确性、重复披露量与请求 token 观测决定，不预设节省比例。

### 验收

重复追加保留引用 occurrence、附件与撤销；跨 Session 和旧 revision 不写入。分析/语义激活、双 Skill 顺序、
普通问题不激活、Help 已可见去重、缺失凭据下读取 Help 均维持当前结果。
记录首请求和后续请求的输入量与 Help 交付次数，同时核验 Runtime identity 和失败可见性。

## 第三阶段：原生文件入口的有界原型

复用用户的原生附件操作；确实需要插件专用入口时才调用 `ctx.fileUpload.upload(sessionId, body, name, signal, onProgress)`。
上传的暂存凭证和附件身份由 Harness 拥有，不能直接当作任意本机文件路径，更不能跨 Session 使用。

首个原型只处理一种明确格式，例如 CSV：上传后向用户展示文件名和下一步意图，经过既有 prompt 准入与公开附件解析，
再通过同一 Runtime 的实时 Help 和 `marivo_python` 完成有界检查。解析、类型推断和 datasource 语义交给 Marivo。
是否将结果保存为复用数据源，需要明确的用户意图和 Marivo authoring 契约；不因上传完成自动写定义。

原型前置门槛是证明“Host 暂存附件 → 当前 Workspace 中可分析对象”的公开、可追踪映射。
若 API 不提供可用映射，记录阻塞并保留原生附件入口，不读取 Host 私有缓存、不解析内部路径、不自建上传服务。

验收覆盖取消、失败后重试、同名文件、跨 Session 拒绝、引用寿命、异常/空文件、Workspace 改变及一次执行计数。
上游当前不支持断点续传；stream 请求体也不能直接重放，因此产品不能承诺恢复中断上传。
大文件和 Excel 等其他格式在首个原型通过后再定义预算与范围。

## 第四阶段：收紧接线与维护成本

调研见[接线与维护成本调研](dsh-wiring-stage-four-research.md)，实施记录见[第四阶段验收](dsh-wiring-stage-four-acceptance.md)。
已实现单 Agent 与批量安装失败回滚、service 关闭所有权与实际任务等待、依赖兼容范围和生产边界检查；
按这些职责拆出 Agent installer、Tool lifetime 与 cleanup 小模块。编辑迁移与旧容器删除不纳入本轮。

保持 `plugin.ts` 为 lifecycle 组合入口，按实际职责整理 Runtime binding、Agent 安装与 Web routes 的小模块；
不先建设通用 adapter 框架。生产代码只依赖所需公开服务；验证工具才持有 SessionPersistence handle。

本次 Connection 精确路由适配集中在 `src/rpc.ts` 和 `src/client/rpc.ts`，继续由 Host 负责认证。
未来只有上游修复独立 channel 的 plugin-context 生命周期问题，或提供可验证的第三方 typed Remote 扩展路径后，
才替换这层接缝。不能假定原生 Gateway 自动接受插件的新 Remote，也不能借迁移减少身份校验。

新模块必须说明所有者、注册 disposer、在途请求 drain 和卸载后行为。DSH peers 使用 `^0.1.5-alpha.1`，逐项满足范围且与 Host 解析身份一致；
不得私带另一套 Cordis/React/Host singleton 或恢复对邻近源码 checkout 的隐式依赖。

## 实施顺序与交付门槛

| 顺序 | 独立交付 | 开始前提 | 完成证据 |
| --- | --- | --- | --- |
| 0，已完成 | 兼容升级 | 精确 alpha 基线 | 完整检查、真实 Runtime/Web/模型、本机安装 |
| 1a，已完成 | 三入口与报告交付纵向原型 | 精确 alpha 基线与已确认的页面分工 | 新交付判定、资源身份、生命周期、旧容器交接与布局的真实 Web 证据 |
| 1b，已完成 | 数据源/语义层/报告浏览页与独立正文原生 Tab | 1a 关键接缝通过，资源 identity 与无 Session 行为明确 | 默认包完整检查与 37 项真实 Runtime/Web 断言通过，见[验收记录](dsh-right-tabs-stage-one-acceptance.md) |
| 2 | 输入接缝复用与事实披露优化 | 第 1 阶段状态边界稳定 | 引用/附件/撤销回归与真实模型对比 |
| 3 | 单格式上传分析原型 | 公共附件映射已证明 | 所属权、取消、数据读取与执行计数 |
| 4，已实现 | 安装回滚、卸载与接线整理、依赖和生产边界检查 | 精确 alpha 基线与各资源 owner 明确；不依赖编辑迁移 | 故障注入、在途任务结束、真实 lifecycle 与包验证，见[第四阶段验收](dsh-wiring-stage-four-acceptance.md) |
| 独立候选 | 编辑迁移及按职责删除旧容器 | 未保存草稿与全部关闭入口有可靠方案，无 Session 路径有替代 | 编辑冲突/恢复/导出、凭据操作归属与真实 Web 验证 |

每个阶段独立审阅和验收，通过后再进入下一阶段。回退通过切回上一版插件构建完成，不清理 Session、Credentials、
Workspace 或报告文件。依赖声明允许同系列兼容升级，已验收版本单独记录；范围匹配 fixture 不代表未来版本已完成真实验收。
