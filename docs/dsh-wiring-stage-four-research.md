# 第四阶段：接线与维护成本调研

本文保留实施前调研事实。后续已按用户确认的同系列兼容策略实施，结果见[第四阶段验收](dsh-wiring-stage-four-acceptance.md)；
下文精确固定全部 DSH 依赖的初始建议已被 `^0.1.5-alpha.1` 范围与 Host 解析身份检查替代。

## 结论与建议范围

第四阶段最值得做的是 **安装失败回滚、卸载完成语义、依赖与生产边界检查**。这些工作可以基于当前
DSH `0.1.5-alpha.1` 实施，不需要先完成文件上传，也不依赖编辑器迁移。模块拆分应服务于这些可验证的
责任边界；减少 `plugin.ts` 行数本身不构成交付。

[原设计](dsh-alpha-refactor-design.md#第四阶段收紧接线与维护成本)正文聚焦接线，交付表却把编辑迁移、
旧容器删除及未保存关闭保护绑在一起。建议拆开：第四阶段交付可靠的安装、停止、等待与分发边界；
编辑迁移保留为单独候选，不作为这一阶段的开始前提或完成条件。

| 工作 | 价值 | 当前可做性 | 建议 |
| --- | --- | --- | --- |
| 单 Agent 安装失败的完整回滚 | 高，已有故障注入复现残留 | 可直接修复，不改上游 | 第一优先 |
| 明确 service owner，补齐停止与在途任务等待 | 高，当前撤路由与等待完成被混用 | 可用现有 AbortSignal、Promise 和 disposer 完成 | 第四阶段核心 |
| 精确依赖、Host singleton 与生产导入边界检查 | 高，降低后续升级漂移和误引入成本 | 可在现有校验脚本上增量实现 | 独立并行交付 |
| 按上述所有者拆分 `plugin.ts` | 中，便于独立测试与审阅 | 可做，小模块足够 | 随核心修复实施 |
| 聚合测试减少重复 client 构建 | 中，构建调用重复已确认，耗时收益尚未测量 | 可做，不需更换测试框架 | 可选后续小切片 |
| 冲突时可带走编辑内容、明确恢复操作 | 有直接用户价值 | 插件可独立实现 | 单列产品改进，先做最小范围 |
| 将报告编辑搬进原生 Tab | 有布局价值，但不直接减少全部容器 | 缺关闭保护或独立 Draft 生命周期方案 | 有界原型后再决定 |
| 换独立 RPC channel 或全面 typed Remote 化 | 当前收益低于迁移成本 | channel 问题仍可复现；Remote 有扩展机制但尚未完成插件原型 | 暂缓 |
| 删除全部 overlay、重写 Runtime/Workspace cache、通用 adapter 框架 | 收益不足或改变现有责任 | 不属于本次必要工作 | 不纳入 |

## 基线、事实与证据限制

调研日期为 2026-09-09。插件代码基线为 `b115e0d84ac624a32f674a69922857fa013c9d2c`，Node.js
为 `22.19.0`；开始调研时已有第三阶段设计增补与单文件分析调研，均予以保留。
Harness 本地检出为干净的 `dsh-v0.1.5-alpha.1`，提交 `5dda764ed3aa172535a7967b06ff95d9cbfe536a`；
同时核对已安装发布包与该 tag 的官方文档。[1]、[2]、[3]

本次新鲜检查包括：插件集成测试 6 项全部通过、`npm run deps:check` 通过、lockfile 同版检查、
单 Agent 安装失败的内存故障注入，以及实际安装的 Cordis/Connection 的 channel、精确 Fetch 与第三方
typed Remote Host 探针。后三项使用内存 transport，没有启动真实 HTTP 或重新验收浏览器认证。
这些证据用于判断工作价值和当前 API 可行性；不等同于第四阶段实现完成或真实业务旅程验收。
本次没有重装插件、重启用户 Web、调用远端模型或业务数据库。

以下区分三类结论：已复现的局部缺陷、由源码确定的契约缺口、尚需产品选择或真实运行验收的候选。
既有验收文档仅说明已有覆盖，不冒充本次重新执行的结果。

## 安装与卸载：优先解决可观察的行为

### 单 Agent 部分安装没有进入回滚集合

`installMarivoPlugin` 先创建 disclosure controller，再依次注册 execution guidance、三个执行工具、
PTC delivery 和 prompt sections，最后才 `installed.set(agent, controller)`。外层异常处理只遍历
已经进入 `installed` 的 controller。因此后段注册抛错时，当前这个 Agent 的部分安装不在回滚集合内。
参见 [plugin.ts](../packages/dsh-data-analysis/src/plugin.ts) 181–230 行。

内存 Host mock 直接调用当前生产 `installMarivoPlugin`，让第一个 presentation prompt section 抛错，
得到以下结果；Runtime resolver 被设置为调用即失败，本次没有触发它：

```text
caught: injected section failure
remaining tools: marivo_help, marivo_datasource_test, marivo_python, marivo_present
remaining Agent hooks: 5
remaining root hooks: 0
credentialService.close calls: 1
credentialService.disposeAgent calls: 0
```

这证明公开安装函数的局部回滚不完整。它不证明通过 `ctx.plugin` 安装后，完整 Cordis fiber 卸载也必然
留下相同资源：Cordis 会自动清理所属 effects，必须另测。现有
[Web profile 测试](../packages/dsh-data-analysis/tests/plugin-integration-delivery/web-profile.test.ts)
覆盖成功安装、两个 Agent、零 Workspace 初始化和正常卸载，尚未覆盖这个中途失败位置。

最小修改是为单 Agent 安装建立异常边界：失败立即 dispose 当前 controller，成功才加入集合；明确已有
Agent 批量安装失败和后续 `agent/created` 安装失败的回滚范围。使用现有 controller/disposer 即可，
不需要事务管理器、通用插件框架或新公开配置。
多步子 installer 在返回 disposer 前失败，也必须回滚已完成注册，例如
[PTC delivery](../packages/dsh-data-analysis/src/presentation/delivery.ts) 13–68 行的两次 hook 注册。

验收应逐点注入 Tool、hook、prompt 注册失败，覆盖首次 Agent、第二个已有 Agent及后续新建 Agent；
失败后无本插件残留，其他插件工具不受影响，修复故障后可重新安装。再通过真实 Cordis effect scope
验证失败卸载与重装，避免 mock 的资源模型掩盖 Host 行为。

### 撤下路由、中止执行和等待完成是三个不同事实

当前 [registerPluginRpc](../packages/dsh-data-analysis/src/rpc.ts) 返回的异步 disposer 等待各路由
disposer；已安装 alpha 的 `registerFetchRoute` 实现只从 registry 删除路由，没有记录或等待已进入
handler 的 Promise。源码 40 行的 drain 注释不能当作运行保证。[9]

领域层的完成语义也不相同：

| 资源 | 当前行为 | 需要明确的完成条件 |
| --- | --- | --- |
| 精确 Fetch routes | 撤下注册，后续请求不再命中 | 已进入 handler 的请求何时全部 settle |
| `MarivoPresentationFileService` | `close()` abort 内部 signal | 读文件、保存及提交确认何时结束 |
| `MarivoCredentialService` | 有取消与异步 close | 唯一 owner 等待完整 close，不能由多个安装层各自假定已完成 |
| Semantic reference | `stop()` 中止，`close()` 等待 usage 写入 | RPC handler、Catalog 子进程与 usage 各自的结束边界 |
| Agent controller | 移除工具/hook、触发 disposer | 已在执行的 Help、present、Python 如何纳入插件结束等待 |

领域实现见 [presentation RPC](../packages/dsh-data-analysis/src/presentation/rpc.ts) 92–94、246–249 行，
[credential RPC](../packages/dsh-data-analysis/src/datasource/rpc.ts) 104–108 行及
[reference RPC](../packages/dsh-data-analysis/src/semantic-reference/rpc.ts) 126–134、169–176 行。

顶层 `apply` 在 catch 与正常 disposer 中串行执行清理，最后才调用 Agent installer 的 disposer。
同一个 credential service 又被 Agent installer、credential RPC 与顶层 close。
参见 [plugin.ts](../packages/dsh-data-analysis/src/plugin.ts) 145–147、224–250、291–299、381–400 行。
重复 close 不自动等于缺陷，但说明 owner 和“谁等待完成”不清晰。Cordis 自身会并发清理 fiber effects，
所以不能仅凭这个串行代码顺序断言真实 Host 卸载期间一定还接收新请求。

建议由创建 shared credential service 的 profile 组合层承担关闭责任，Agent 只清理自己的 operation，
RPC 只撤回自己的入口。独立调用 `installMarivoPlugin` 时若由它创建 service，则继续承担该 service
的结束责任。保留现有公开安装出口兼容性，具体 await 接法在实施时根据调用者确定。

整体结束需要做到：先停止新注册与请求准入，向已有工作发出取消，再等待各自负责的任务 settle，
最后释放 manager、shell fact 等依赖。一个清理项失败后仍尝试清理其余资源，错误可见；重复调用共享
同一次完成结果。不能用一个等待超时后直接返回成功，伪称任务已清空。

对于报告保存，abort 不能证明尚未提交；已跨过提交点的结果仍须沿既有 receipt/current 确认，不删除
已发布 Build，不重放写入。对 Python/数据库，插件结束等待只证明本地拥有的工作结束，不能推断远端
查询已取消。无需为统一等待重新定义 Marivo 的执行或报告协议。

必要的故障验收是：把读请求、present、凭据等待/测试、Python、usage 写入分别暂停在可控位置，触发
卸载，确认新入口拒绝、旧工作收到取消、dispose 等待正确终态；再制造一个 cleanup rejection，确认
其他清理仍完成。现有正常卸载测试应保留，增加这些能区分行为的断言即可。

### 模块拆分应围绕上述 owner

可形成三个内部职责单元：Agent 安装及回滚；profile Web 服务与路由组合；Runtime/Workspace binding
装配。`plugin.ts` 保留配置、公开入口及 lifecycle 组合，现有领域模块继续负责自己的业务行为。
不要求三个都新建文件；只有能独立验收、减少交错状态的边界才抽出。

以下规则应保留：[Runtime/Workspace 模块](modules/runtime-workspace.md)已定义失败 binding 缓存到
显式重建 manager/plugin，不能顺手改成自动重试；按 canonical root 缓存 Runtime 绑定不等于以路径
代替 Harness Workspace 身份。报告和引用已有的 Workspace ID、成员关系与 Runtime 核验继续执行。
SkillFilesystem 已属于 Cordis effect，不再给它建第二套手工生命周期系统。

## 依赖与生产边界：补检查，不重建现有保护

当前包的 DSH peers 已精确固定，browser build 已 externalize DSH、Cordis 和 Host React，并通过
metafile 检查禁止 Browser 混入 Node/Runtime。portable 自带 React 是离线产物的必要条件，不能与
Host bundle 的 singleton 要求混为一谈。生产 `src` 本次检索没有 SessionPersistence 引用；验证脚本
通过公开 persistence handle 读事件，这条分工目前已经成立。[4]、[5]、[6]

本次 lockfile 检查得到 232 个 DSH package 记录，全部为 `0.1.5-alpha.1`；没有嵌套 DSH 记录，Cordis、
React、ReactDOM 各一个 package 记录，未发现 `file:` / `link:` / `workspace:` dependency spec。这里没有已发生重复依赖
的证据。问题是 [deps:check](../scripts/check-dependencies.mjs) 目前只执行 `npm ls --all`，而根
devDependencies 的许多 DSH 包使用 `^0.1.5-alpha.1`，包目录的开发依赖也有相同情况；合法 semver
依赖树不等于同一精确发布基线。包验证的 isolated consumer 将 peers 链回工作区安装树，能证明
packed entry 可加载，但不能单独证明消费者全新安装时的 singleton 身份。[4]

最小增量包括：

1. 精确固定根与 workspace 包直接声明的 DSH devDependencies，并检查安装树内全部 DSH 包版本。发现混版明确
   失败；不要通过自动强制 overrides 掩盖上游真实依赖冲突。
2. 对 Node Host 侧 Cordis 与相关 DSH 服务核验实际解析的物理身份；对 Host client 继续保留现有
   external/metafile 检查。不要把 lockfile 的单条记录当作所有安装/运行路径都已验证。
3. 在现有依赖/包检查中限制生产依赖图进入 SessionPersistence、验证脚本及隐式邻近 checkout；
   允许验收工具显式消费公开 handle。采用窄规则和明确允许项，不扫描所有文档字符串判违规。

验收用隔离 manifest/lock/解析 fixture 注入合法但混版的 DSH、第二份 Cordis、生产 persistence import
与本机路径依赖，确认各自被拒绝；正常 Host client 与 portable 都通过。exports、依赖或分发内容变化
还需完整 build 和 package verification，不只运行 `npm ls`。

## RPC：保留当前接缝，只完善 lifecycle 语义

独立 channel 的限制在精确 alpha 环境仍能复现。使用已安装 Cordis 与分离 provider fibers 调用
`connection.rpc.handle`，包括调用方声明 `connection` 和 `webServer` 的场景，仍出现
`cannot get property "webServer" without inject`。相同测试环境的精确 Fetch 路由能返回 200，所属
effect 撤回后返回 404。该探针验证内存 transport 的注册/撤回，不证明 HTTP 认证或 handler drain。[9]

因此当前应继续使用 `src/rpc.ts` 与 `src/client/rpc.ts` 的精确 `/api` 接缝，让 Harness 保持认证与
Host/Origin fence。值得做的是让路由撤回、请求取消与等待完成的名称、注释、实现和测试一致，保留
envelope、endpoint、Workspace/Session 及领域输入校验；没有必要为迁移增加另一套 transport。

typed Remote 不能简单判断为“上游完全不支持第三方”。公开 Typert registry/loader、生成 descriptor
和 Gateway 已有扩展机制。本次以自有包名和严格 descriptor 注册一个只读 echo，实际 Gateway/Connection
调用成功，owner 撤回后返回 `gateway/definition-unavailable`，没有降级 SRC。这个探针证明第三方 Host
dispatch 可行，尚未验证生成器、npm 分发、浏览器 `$mount`、类型投影或实际 HTTP 认证。
若未来考虑迁移，应先用一个只读 endpoint 验证生成物、插件安装加载、客户端引用、错误/取消与卸载，
比较实际删除多少维护代码、增加多少构建依赖，再决定。当前路由规模和需求不支持全面迁移。[3]、[7]

## 编辑与旧容器：单列价值，分开删除条件

alpha.1 的公开 Tab definition 是静态声明；`close(): void` 和记录消失后的 AbortSignal 没有提供
before-close、dirty 或 veto 契约。`canOpen` 是资源认领准入。当前 TabPage 由 Session/Tab occurrence
拥有，signal abort 会 dispose reader；导航 revision 变化也会重新打开目标。只包装插件自己的关闭
按钮或在 unmount 后弹确认，无法覆盖 Host Tab X、浮窗关闭和 replace 导航。[1]、[8]

| 保留容器 | 当前有效职责 | 删除前提 |
| --- | --- | --- |
| `PresentationOverlay` | 报告编辑；无 Session 的目录、阅读及历史 | 编辑保护通过，且无 Session 有实际替代入口 |
| `CredentialPanel` | secret 输入；原调用等待、继续/取消；operation 查询恢复 | 新容器保持关闭与取消分离，secret 生命周期不延长 |
| 语义浏览 overlay | 无 Session 报告来源对象及原生导航不可用的 fallback | 该阅读路径有可验证替代 |

这些责任已在 [right-tabs install](../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)
111–151 行及各领域 installer 中体现。Credential panel 关闭只中止页面读取，不取消 operation，
[client-model 测试](../packages/dsh-data-analysis/tests/datasource-credentials/client-model.test.ts)
195–234 行明确覆盖后台查询继续。不能为了布局统一，把 operation 挂到只读 datasource Tab 的寿命上。
默认关闭旧 cards/entries 分支也不等于可直接删 exported installer：当前 fixture 仍使用它。

比迁移更具体的用户价值是冲突处理：当前保存冲突保留内存 draft，但提示重新打开；重新打开及
connection reset 又会清空 editing。已有 HTML 下载取已保存 Build，不含冲突草稿。参见
[delivery-model.ts](../packages/dsh-data-analysis/src/client/presentation/delivery-model.ts)
105–106、292–311、406–462、499–517、583–621 行。当前 Web 验收证明冲突后文本框保留，然后取消；
没有证明重开、断连或刷新后可恢复。

最小候选是改清楚冲突操作说明，并提供复制或下载当前编辑内容的路径，携带 Workspace、Report、
base Build 身份，供用户显式重新应用；不自动 rebase 或覆盖 current。完整的跨刷新 Draft 存储会
新增容量、清理、撤销与身份重验责任，只有确有产品需求时才设计，不为搬 Tab 先建草稿平台。

如果继续做编辑 Tab 原型，二选一的前提必须成立：Host 提供覆盖全部入口的公开关闭保护；或者插件
明确拥有独立于 Tab 的有界 Draft，并给出关闭后的找回路径。两者都要验证保存中关闭、响应丢失、
冲突、断连、Workspace 撤销和实际编辑导出，之后才谈删除特定 overlay。

## 验证脚本的维护成本

根 [package.json](../package.json) 的聚合 `npm test` 在 datasource、semantic-reference、
semantic-browser 三个套件前分别构建 client，reader 套件又完整 build；
[finalize-build.mjs](../packages/dsh-data-analysis/scripts/finalize-build.mjs) 再导入 client build。
所以同一次聚合检查至少四次构建 client，CI 在后面还完整 build。这里确认的是调用次数，尚未测量
这些重复占总耗时的比例，不能预先承诺性能收益。

可以先保留单套件自足入口，给聚合检查统一准备一次最新产物，再调用不重复准备的测试体。
测试顺序、断言和真实打包路径保持；修改 client 后运行相关入口必须测试新字节，不能依赖残留 lib。
当前 [Host client fixture](../packages/dsh-data-analysis/tests/presentation-integration/host-client-fixture.ts)
74–75 行直接读取 `lib/client.js`，正好可用于验证产物来源。暂不增加缓存系统、不并行争用 clean/build。

## 建议切片与验收门槛

| 切片 | 实施边界 | 完成证据 |
| --- | --- | --- |
| 4a：Agent 安装回滚 | 单 Agent 原子安装，明确批量及新建失败边界；必要的小模块抽取 | 分点故障注入、真实 Cordis scope 安装/失败/重装、其他插件保持可用 |
| 4b：停止、等待与唯一 owner | profile shared service 关闭责任、路由准入、中止和在途任务完成；保留公开出口 | 暂停任务时卸载、cleanup 失败仍清理、重复 close、提交边界与一次执行断言 |
| 4c：依赖与生产边界 | 直接 DSH 依赖、安装树/解析身份、生产导入和包检查 | 混版与重复包 fixture 拒绝，正常 Host/portable 和 package 验证通过 |
| 可选 4d：构建准备去重 | 聚合测试一次准备，单套件仍自足 | 测试数/跳过条件不变，新源码对应新产物，固定快照前后耗时比较 |
| 独立编辑改进 | 冲突文案与编辑内容带走；Tab 迁移另做原型 | 编辑内容、身份、保存冲突与恢复真实 Web 验收 |

4a、4b 有前后关系，4c 可以独立推进；4d 先确认实际时间收益。编辑迁移不阻塞前三项，第三阶段文件
分析也不是这些内部接线工作的技术前置。每个可执行切片运行相关测试与 `npm run check`；涉及 exports、
client、包元数据或分发再运行 `npm run build`、`npm run verify:plugin-package`。

跨实际 lifecycle 边界的 4b 应补隔离 profile 的真实 Harness/Runtime 验收；触及编辑或原生 Tab 再补
对应 Web 旅程。使用现有 scripted adapter 即可验证安装/卸载和 UI，不为接线重构额外安排远端模型 A/B。
没有触及模型输入/路由时，也不宣称 token 节省或分析质量提升。

## 主要来源

本地源码行号均对应上述插件基线；实施后应按函数/类型定位。官方链接固定到已验证 alpha tag，
不将未来上游修复假定为当前可用。

| 编号 | 来源 | 支持范围 |
| --- | --- | --- |
| 1 | [Harness：右侧 Sidebar 公开契约][1] | Tab occurrence、导航、关闭 API 与无 Session 限制 |
| 2 | [Harness：Connection 公开契约][2] | 精确 Fetch 与认证归属 |
| 3 | [Harness：API Gateway 公开契约][3] | Remote descriptor、signal、运行时解析与严格校验 |
| 4 | [插件包验证][4] | 精确 peers、分发文件与离线 builder 现有门槛 |
| 5 | [Browser 构建][5] | external 与 metafile 检查 |
| 6 | [插件集成与交付模块][6] | 当前服务所有权约定及生产/验证边界 |
| 7 | [Harness：Typert Loader 公开契约][7] | 生成物加载与第三方扩展前提 |
| 8 | [TabPage 实现][8] | navigation、signal 与 reader dispose |
| 9 | [Harness：Connection RPC Host 实现][9]，`registerFetchRoute` / `registerRpcChannel` | 路由撤回与 channel 的 provider context |

[1]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/ui-sidebar-right/README.zh.md
[2]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/connection/README.zh.md
[3]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/api/gateway/README.zh.md
[4]: ../scripts/verify-plugin-package.mjs
[5]: ../packages/dsh-data-analysis/scripts/build-client.mjs
[6]: modules/plugin-integration-delivery.md
[7]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/typert/loader/README.zh.md
[8]: ../packages/dsh-data-analysis/src/client/right-tabs/page.ts
[9]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/connection/src/rpc-host.ts
