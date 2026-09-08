# 展示交付模块

## 责任与入口

`marivo_present({ draft_path })` 将一次分析展示闭合为两个文件和一个 receipt。
Marivo 拥有分析、Artifact/Finding 与来源事实；Harness 拥有 Session/Turn、Workspace 成员关系和事件存储；
插件拥有固定快照投影、文件完整提交、receipt、阅读器呈现编辑保存与打开/下载。

实现为 `src/presentation/{tool,reports,commit,files,receipt,delivery,rpc}.ts`，生产接线在 `plugin.ts`、
`bridges.ts` 和 `client.tsx`；客户端使用 `src/client/presentation/` 的共享 reader 与交付 adapter。
数据契约见[展示投影](presentation-projection.md)，图形和离线行为见[展示 reader](presentation-reader.md)。
Agent 的展示路由、Draft 编写与结果解释见[展示 Skill](presentation-skill.md)；已有数据可直接进入此交付流程。

## 单次调用与文件身份

1. 从 Harness `workspaceRegistry` 的 `sessionIds` 取得唯一当前 Workspace，核对 bound Runtime 的 project root。
2. 有界读取 Workspace 相对 Draft，使用同一个 checked Runtime 公开恢复 Artifact 和来源，读取 computed typed JSON。
3. 生成稳定 UUID report ID 与首次 build ID，调用共享 builder 得到完整 JSON 和自包含 HTML 字节。
4. 在同一 Workspace 的新临时目录写入两个文件并同步，检查归属和目录身份后以一次 rename 提交。
5. 重读校验两份完整文件，然后在跨进程锁内发布 current 指针，返回 receipt。指针生效前失败不破坏已有构建。

每次交付的路径固定为：

```text
<workspace>/.dsh-data-analysis/presentations/<reportId>/builds/<buildId>/presentation.json
<workspace>/.dsh-data-analysis/presentations/<reportId>/builds/<buildId>/index.html
```

document 与 receipt 使用 schema v2，保存 Workspace/report/build 身份、标题、摘要及两份文件的精确路径、SHA-256 和字节数。
重复调用 Tool 生成独立报告；阅读器保存为同一 report 创建新 build。
`presentations/<reportId>/current.json` 保存 schema v2、Workspace、reportId 与完整当前 receipt。
旧协议不读取、不迁移；旧文件保留。不提供历史浏览、回滚或自动清理。

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
第一次成功 receipt 的 `seq` 决定位置；同轮其他成功报告按 receipt 顺序加入，不改变节点身份和位置。
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

## 全局筛选的保存边界

`interaction` 随原始文档传递和保存；当前阅读选择不进入 edits。删除组件时服务端从已保存声明裁剪引用，并拒绝跨区域移动。动态 KPI 和离线默认组合见[共享 reader](presentation-reader.md#可选全局筛选与动态-kpi)。
