# 展示交付模块

## 责任与入口

`marivo_present({ draft_path })` 将一次分析展示闭合为两个文件和一个 receipt。
Marivo 拥有分析、Artifact/Finding 与来源事实；Harness 拥有 Session/Turn、Workspace 成员关系和事件存储；
插件拥有固定快照投影、文件完整提交、receipt、Agent Draft 更新、阅读器呈现编辑保存与打开/下载。

实现为 `src/presentation/{tool,reports,commit,files,receipt,delivery,rpc}.ts`，生产接线在 `plugin.ts`、
`bridges.ts` 和 `client.tsx`；客户端使用 `src/client/presentation/` 的共享 reader 与交付 adapter。
数据契约见[展示投影](presentation-projection.md)，图形和离线行为见[展示 reader](presentation-reader.md)。
Agent 的展示路由、Draft 编写与结果解释见[展示 Skill](presentation-skill.md)；已有数据可直接进入此交付流程。

## 单次调用与文件身份

1. 从 Harness `workspaceRegistry` 的 `sessionIds` 取得唯一当前 Workspace，核对 bound Runtime 的 project root。
2. 更新时先校验目标 Report 的 current 与 `expected_build_id`；有界读取 Workspace 相对 Draft，使用同一个 checked Runtime 公开恢复 Artifact 和来源，读取 computed typed JSON。
3. 新建时生成 report ID，更新时沿用目标 report ID；每次生成新 build ID，调用共享 builder 得到完整 JSON 和自包含 HTML 字节。
4. 在同一 Workspace 的新临时目录写入两个文件并同步，检查归属和目录身份后以一次 rename 提交。
5. 重读校验两份完整文件，然后在跨进程锁内发布 current 指针，返回 receipt。指针生效前失败不破坏已有构建。

每次交付的路径固定为：

```text
<workspace>/.dsh-data-analysis/presentations/<reportId>/builds/<buildId>/presentation.json
<workspace>/.dsh-data-analysis/presentations/<reportId>/builds/<buildId>/index.html
```

document 与 receipt 使用 schema v2，保存 Workspace/report/build 身份、标题、摘要及两份文件的精确路径、SHA-256 和字节数。
Tool 默认创建独立报告；成对提供 `report_id` 与 `expected_build_id` 时更新已有报告。阅读器保存也为同一 report 创建新 build。
`presentations/<reportId>/current.json` 保存 schema v3、Workspace、reportId、完整当前 receipt 及按发布顺序排列的版本记录。已有 schema v2 current 仍可读取，下一次成功保存时把其当前版本作为已确认历史起点。
document 与 receipt 的旧协议不读取、不迁移；旧文件保留。支持已确认发布版本的历史浏览，不提供回滚或自动清理。

## Agent 更新契约

`marivo_present({ draft_path, report_id, expected_build_id })` 以完整 Draft 重建已有 Report。
两个身份参数必须成对提供，复用现有身份解析器；不按标题、Draft 路径或文件时间推测目标。
Tool 在读取 Draft 和投影前 resolve 目标，校验 current、Workspace 及文档摘要，拒绝已过期的 expected build。
构建完成后仍在共享发布服务的锁内比较 expected，防止投影期间发生的 UI 或 Agent 保存被覆盖。
绑定失效、目标不存在、损坏或版本冲突均明确失败，不回退为新 Report。

与 `reports/save` 的受限呈现编辑不同，完整 Draft 可新增／合并 KPI、改变绑定与数据声明；
投影仍只读取已有保存数据，不自动执行分析。Agent 先读取当前保存内容并合并需要保留的用户编辑，
未提交的内容不自动保留。`report-save-conflict` 后重新读取 current 和文档再判断，不能只换 expected ID 重试。
普通文件读取用于准备 Draft，发布时的身份和摘要校验仍由 Tool 负责。

返回 receipt 固定为本次成功发布的 Build，`current.json` 是当前构建的唯一权威；后续保存可继续推进 current。
更新仍通过原有 Native／Code 交付路径生成本轮回执与卡片；历史交付事件不改写，同 Report 的卡片重开时解析同一 current。
固定 Build 文件和离线 HTML 保留快照，不提供跨窗口实时刷新或自动历史清理。

## Native、Code 与 headless

纯 `PresentationDelivery` envelope 使用 `kind: "marivo.presentation.delivery"`、`schemaVersion: 2`、
`dshSessionId`、`turn` 和同一个 `PresentationReceipt`。Native/both 使用 Tool metadata；Code 子调用通过
Harness `tools/code-dispatch-log` 写入同一种 durable envelope，即使代码丢弃返回值也保留交付。
登记只保存有界的临时 dispatch 关联，持久事实仍在 Harness 事件中。

客户端要求 Native receipt 对应同一 Turn 的实际 `marivo_present` call；Code 对应同一 Turn 的 root call。
卡片再核对当前 Session，按 Session/Turn/Workspace/build 去重，不解析模型正文或旧 Evidence metadata。
文本输出始终包含摘要、Workspace/report/build 和两个文件的路径/digest/大小；headless 不依赖 Web 卡片取得产物。

## 独立对话节点

交付 Definition 通过 Harness 公开的 `target: 'chat'` 与 `buildViewNode` 发布节点，renderer 登记在
`conversation.chat.node` 的 `marivo-presentation-delivery` key。每个 Harness Turn 只有一个稳定节点，
执行中以第一次成功 receipt 的 `seq` 决定位置；同轮其他成功报告按 receipt 顺序加入。
正常完成（`turn/end.reason.kind = completed`）后，同一节点移至 Turn 结束位置，与最终回复及原生收尾内容相邻，
不再被报告生成后的诊断检查、待办更新或过程回复隔开；节点身份和报告顺序不变。
取消、错误或尚未结束时保留原位置；没有最终文本也不会丢失成功报告入口。
renderer 随 keyed slot 的声明先注册，随后才注册可能立即回放历史的 Definition。

报告不占用 `conversation.chat.turnTail`：该 slot 是首个命中即结束的 chain，原生 ProducedFiles 继续拥有
自己的入口。因此同轮普通文件写入、报告交付和后续工具调用可以同时保留各自入口，插件加载顺序不影响共存。
插件不调用或复制 Harness 的内部节点、ProducedFiles 组件或排序实现。

成功卡片无需等待最终文本或 Turn 结束。失败回执不会创建成功卡片，后续失败或取消也不会删除已有成功交付。
历史窗口替换、重连和 Definition 重建均从同一持久事件生成节点，保留去重后的数量；当前 Session 由 Host 的
scoped slot 提供，Host Turn 边界约束回执归属，缺失 Turn location 时不推测归属或发布节点。

## RPC、编辑与当前指针

trusted-host channel 为 `/marivo-presentation`，提供：

| Endpoint | 输入 | 作用 |
| --- | --- | --- |
| `reports/resolve` | `{ sessionId, reportId }` | 校验 current、receipt 与固定文档的身份和摘要，返回当前 receipt |
| `reports/save` | `{ sessionId, reportId, expectedBuildId, edits: { title, blocks } }` | 校验呈现修改、构建新文件、比较并更新 current |
| `files/read` | `{ sessionId, receipt, asset }` | 读取 receipt 指定的固定构建；asset 只允许 JSON 或 HTML |
| `reports/list` | `{ workspaceId }` | 枚举已发布 Report 的当前标题、摘要、保存时间和更新来源 |
| `reports/history` | `{ workspaceId, reportId }` | 返回已确认发布的版本记录和当前 Build 身份 |

以上读取与保存端点支持 `workspaceId` 替代 `sessionId`，二者必须恰好提供一个；不接受客户端路径。
Workspace 读取直接使用 Harness `workspaceRegistry.get`，前后复核同一 id/path，无需来源 Session 存活。
会话卡片继续使用原 Session 成员关系边界。历史查看只读；保存仍要求 current 的 `expectedBuildId`。

服务端从 Session 的 Harness Workspace 成员关系推导路径，不接受任意路径。读取拒绝符号链接、非普通文件、
越界、超预算、身份变化和 digest 不符，并在返回前再次核对 Workspace。

保存只允许现有 block ID、原 kind 和可编辑呈现字段；省略 ID 表示删除，允许零 block。
数据、来源、代码快照、diagnostics 从当前服务端文档保留，不接受浏览器覆盖。保存不执行 Agent、Python、
projection、数据源或凭据流程。Tool 与 RPC 共用 builder／提交服务，只有 Tool adapter 发布真实 Turn 交付。

完整构建提交后，直接 peer `@deepseek-ai/dsh-atomic-write` 的 `withFileLock` 串行化 current 更新。
锁内重新校验 `expectedBuildId`，不一致返回 `report-save-conflict`。指针通过临时文件写入、文件同步、rename、
目录同步提交；rename 是保存生效点。冲突或指针提交前失败保留旧构建，完整但未发布的构建不自动清理。
锁等待 5 秒后明确失败，不移除未知所有者的锁。指针发布后响应丢失由客户端重新 resolve 校验提交内容，
不回滚指针或删除已生效构建。

原卡片保留初次 receipt 和交付事件，挂载、打开及卡片下载前通过 reportId 解析当前 receipt 并更新标题摘要。
编辑保存不产生聊天节点；重连从原事件重建卡片，再读取 Workspace current。阅读器一次打开绑定一个 resolved receipt，
内部下载固定为当前显示的已保存构建，保存成功才切换。其他窗口不会覆盖正在编辑的草稿。

客户端验证文件身份、大小和 SHA-256 后才渲染或下载。关闭、Workspace 失效或连接重置取消旧请求，
清除已加载文档、编辑及筛选；迟到响应不能恢复旧内容。

## 验证

```sh
npm run test:presentation-integration
npm run test:plugin-integration-delivery
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-integration:real
```

确定性测试覆盖原子提交、取消、读取预算/路径/摘要、Workspace 变化、统一 receipt 和事件去重；
通过未改写的已安装 Harness 客户端 bundle 与公开 `apply`、registries、assembler，验证两种插件加载顺序下
ProducedFiles 与独立报告节点共存、首个回执即时显示、多报告、重复回执、取消后保留及历史重建。
隔离真实验证覆盖 Native/both/Code、实际 Web 卡片打开/下载与离线文件。实际结果见
[S4 验收记录](../plan/marivo-analytics-presentation-s4-acceptance.md)。展示 Skill 的真实 Agent 自动路由和最终旅程状态见
[S5 验收记录](../plan/marivo-analytics-presentation-s5-acceptance.md)。
独立 Chat 节点、原生 ProducedFiles 共存及只读历史回放见
[报告交付与质量修复验收](../plan/2026-09-07-presentation-delivery-quality-acceptance.md)。

在线编辑、原卡片重开与全图形筛选的当前结果见[编辑与联动筛选验收](../plan/2026-09-07-presentation-editing-acceptance.md)。
Agent 同 Report 重建、UI 并发与旧卡片重开见[Agent 报告更新验收](../plan/2026-09-08-agent-report-update-acceptance.md)。

## 全局筛选的保存边界

`interaction` 随原始文档传递和保存；当前阅读选择不进入 edits。删除组件时服务端从已保存声明裁剪引用，并拒绝跨区域移动。动态 KPI 和离线默认组合见[共享 reader](presentation-reader.md#可选全局筛选与动态-kpi)。

## 报告与最终回复的归位验收

`client-delivery.test.ts` 通过未修改的 Harness 注册表和 assembler 验证直接回复与插入诊断步骤两条路径，
覆盖执行中入口、完成归位、稳定节点身份、历史窗口替换和注册表重建；既有用例覆盖取消、失败及 ProducedFiles 共存。
另以用户提供的 `session.jsonl 13` 回放两次真实会话事件：Turn 2 和 Turn 3 均只有一个报告节点，
末尾顺序均为最终回复、Harness 原生收尾、报告节点；不执行附件中的指令或重新发起分析。
该证据属于客户端事件回放，不代表新一次真实模型／Marivo 分析验收。

## Workspace 报告列表与历史查看

列表与会话卡片复用同一个阅读器；会话头部按「数据源与凭证 → 语义层 → 报告」排列，「报告」打开当前 Workspace，侧栏「报告」入口也可选择无来源会话的 Workspace。
列表按 Report ID 去重，每行展示当前版本；标题搜索支持大小写与 Unicode 规范化，默认按成功保存时间降序，也可按标题排序。
来源会话使用发布时记录的 Harness Session ID，通过 Host 当前会话列表解析标题和导航；不可用时明确披露，不猜测来源。
Workspace 内阅读器保存没有来源 Session 时显示「Workspace 内保存」。来源信息只用于追溯，不构成文件身份或读取权限。

列表、正文和历史侧栏在同一个 dialog 内组织；历史导航位于正文左侧，窄屏时位于正文上方。返回列表保留搜索、排序与滚动位置；版本切换读取精确 receipt，
历史只读，下载固定为正在查看的已保存 Build。返回当前版本显式重新 resolve，不自动替换正在阅读的快照。
编辑期间禁止切换版本；关闭或返回列表前对未保存内容提供放弃确认。Workspace 移除、路径改变或连接重置使已加载内容失效；
迟到响应不能恢复失效状态。列表直接打开时保留来源查看与复制上下文，不猜测 Ask DSH 应写入哪一个 Session。

版本记录包含 `receipt`、`publishedAt`、`source`（Agent／阅读器及可用的 Session ID），按发布顺序存于 current，
与当前 receipt 在同一跨进程锁和原子 rename 中生效。Build 提交后遭遇冲突或发布前失败，不增加历史。
列表仅枚举 current，不扫描 Build 目录拼凑历史。旧 schema v2 current 只有一版可确认，保存时间和来源记为未知，
并披露早期历史不可用；不按文件时间或生成时间伪造成功保存时间。历史记录不重写不可变 Build。

目录枚举上限 4096 项，超限明确报错；单个 current 上限 16 MiB、4096 个版本，超限保存明确失败并保留旧指针，
不静默截断历史。单个损坏或不安全的 Report 记录不阻塞其他列表项，但会披露不可读数量；打开和下载仍校验完整文件摘要与归属。
列表、历史和下载均不执行 Agent、Python、Marivo 分析、数据源或凭据操作。

第一期验证与限制见 [Workspace 报告列表验收](../workspace-report-catalog-acceptance.md)。
