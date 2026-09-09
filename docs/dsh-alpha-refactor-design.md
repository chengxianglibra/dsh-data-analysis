# DSH 0.1.5-alpha.1 重构与优化设计

## 状态与结论

2026-09-09。本文在[兼容升级与现有功能验收](dsh-alpha-compatibility-acceptance.md)完成后编写。
当前代码已适配 DSH `0.1.5-alpha.1`；下面的产品重构尚未实施，不作为已实现功能描述。

建议先把**报告阅读与语义浏览接入原生右侧标签页**，再优化上下文披露，最后验证原生上传驱动的数据入口。
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

## 第一阶段：原生报告与语义标签页

### 用户行为

点击报告卡片后，在会话旁打开报告阅读页；再次打开同一报告聚焦已有页。用户通过 Harness 的原生控件分栏，
同时查看两个报告，或把报告与语义对象放在相邻格。窄屏、全屏、浮窗和布局手势由 Host 处理。
报告卡片、Workspace 报告目录和语义对象入口汇入同一组导航函数。

### 接入方式

使用 `ctx.sidebarRightTabs.register` 登记内容类型，通过 `sidebar.right.pane.tab` 注册正文，
由 `useTabInfo()` 读取当前 Tab 的导航、可见性、绑定动作和取消信号。
报告复用 `HostPresentationReader`；语义对象复用当前 Catalog/详情组件和服务。

建议定义插件资源类型 `dsh-resource://marivo-report/...` 和 `dsh-resource://marivo-semantic/...`，
通过 `patterns` 与 `canOpen` 认领，再调用 `openResource`。URI 是拟议的导航约定，尚非已发布协议；
原型必须验证完整身份编码、解析和未知资源失败路径，再冻结格式。
Workspace 报告目录可以作为 `openTab` 的页类型，不把任意报告都挤入一个同 kind 的页地址。

| 状态 | 权威或生命周期 |
| --- | --- |
| Tab 位置、分栏、浮窗、全屏 | Harness 的 Session 面板状态 |
| 报告 current、已发布版本与固定快照 | 现有报告存储与完整性校验 |
| 读取请求 | Tab 的所属 Session/Workspace，加导航 revision 与 AbortSignal |
| 图表筛选、探索与选中 cell | 当前 reader 状态；不写回分析结果 |
| 语义对象定义与关系 | 当前 bound Runtime 返回的 Catalog |

切换 Session 后，旧 Tab 的回调仍使用自身绑定动作，不能读取“当前会话”然后写入另一个 Session。
关闭 Tab 或导航替换后，迟到请求不更新新页面；折叠面板不等同销毁内容。

### 必须先解决的限制

上游侧栏目前在刷新后回到默认折叠态，且公开导航要求存在已挂载的 Session 面板。
因此不承诺刷新恢复布局；用户通过已有卡片或目录重开报告。没有活动 Session 的 Workspace 目录先保留现有入口。

公开契约没有证明存在通用的未保存编辑关闭拦截。第一步只迁移阅读与语义浏览，编辑继续使用现有编辑容器。
只有在原型证明关闭/切换不会丢失草稿，且保存冲突、取消、离线导出均通过后，才迁移编辑并删除重复容器。
不访问私有 `_undo()`、内部布局 store 或自行覆盖 Host 关闭逻辑。

### 验收与删除条件

- 两份不同 Report 可并排；同一 current 与固定历史 Build 能区分，标题相同也不会混淆。
- 原生文件预览与插件资源互不抢占；报告卡片和 ProducedFiles 继续同时出现。
- 切换 Session/Workspace、快速导航、关闭和重连均不串页，Workspace 撤销后旧页明确失败。
- 普通、窄屏、全屏、浮窗、键盘导航及离线 HTML 与当前基线一致。
- 只有这些检查通过，才移除有 Session 场景的旧阅读 overlay；无 Session 与编辑路径有明确替代后再移除。

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

保持 `plugin.ts` 为 lifecycle 组合入口，按实际职责整理 Runtime binding、Agent 安装与 Web routes 的小模块；
不先建设通用 adapter 框架。生产代码只依赖所需公开服务；验证工具才持有 SessionPersistence handle。

本次 Connection 精确路由适配集中在 `src/rpc.ts` 和 `src/client/rpc.ts`，继续由 Host 负责认证。
未来只有上游修复独立 channel 的 plugin-context 生命周期问题，或提供可验证的第三方 typed Remote 扩展路径后，
才替换这层接缝。不能假定原生 Gateway 自动接受插件的新 Remote，也不能借迁移减少身份校验。

新模块必须说明所有者、注册 disposer、在途请求 drain 和卸载后行为。依赖精确匹配同一 DSH 发布版；
不得私带另一套 Cordis/React/Host singleton 或恢复对邻近源码 checkout 的隐式依赖。

## 实施顺序与交付门槛

| 顺序 | 独立交付 | 开始前提 | 完成证据 |
| --- | --- | --- | --- |
| 0，已完成 | 兼容升级 | 精确 alpha 基线 | 完整检查、真实 Runtime/Web/模型、本机安装 |
| 1 | 报告与语义只读原生 Tab | 资源 identity 与无 Session 行为明确 | 导航/并排/生命周期真实 Web 验收 |
| 2 | 输入接缝复用与事实披露优化 | 第 1 阶段状态边界稳定 | 引用/附件/撤销回归与真实模型对比 |
| 3 | 单格式上传分析原型 | 公共附件映射已证明 | 所属权、取消、数据读取与执行计数 |
| 4 | 编辑迁移和旧容器删除、接线整理 | 未保存草稿与关闭行为有可靠方案 | 编辑冲突/恢复/导出、卸载和包验证 |

每个阶段独立审阅和验收，通过后再进入下一阶段。回退通过切回上一版插件构建完成，不清理 Session、Credentials、
Workspace 或报告文件。跨 alpha 版本不宣称自动向后兼容，下一次升级仍以精确发布包和真实验收为准。
