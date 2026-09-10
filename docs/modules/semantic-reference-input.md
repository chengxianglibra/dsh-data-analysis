# 语义对象引用输入

## 使用方式

在当前 Workspace 的输入框任意位置输入 `@`，可以选择 Marivo 对象。输入 `@revenue` 做文本检索；多词查询使用
`@"monthly revenue"`。菜单与文件、文件夹和 Session 候选并存。选中后显示完整 `kind:path` 原子引用；复制得到
`@kind:path` 普通文字，重新粘贴不会恢复隐藏引用。

空查询返回当前 Catalog 的全部对象，其中最近七个 Host 自然日常用对象最多 10 个优先展示，其余对象去重后
按类型排列。非空查询按 exact、prefix、contains、fuzzy 分层；strict 不足 12 个时才追加 trigram Dice 不低于 `0.42` 的字符相似结果，短于三个 code points 不做 fuzzy。
中文类型名与输入菜单、语义层浏览器共用展示文案，参与检索，例如 `@指标`、`@业务域`，也支持
`@"指标 revenue"`；英文 kind、对象 name/path/refKey 和业务定义仍可搜索。
检索返回全部符合匹配规则的对象，不限制候选展示条数，也不显示截断提示。
NFKC、大小写和空白规范化仅影响检索，不修改 ref。热度只在同等相关度内打破平局；它不表达业务有效性。

## 所有权与接口

- DSH 拥有输入状态机、generation/abort、菜单、occurrence、undo 和提交错误提示；插件注册 `marivo-semantic` source。
- Marivo 拥有 `SemanticKind`、`RefPayloadV1`、Catalog 和执行时领域验证；插件不扫描模型或维护对象 registry。
- 插件通过 Connection 的 `/api/dsh-data-analysis/` 精确认证路由提供 `semantic-references/prepare`、`candidates`、`selected`、`serialize`。
  四个 endpoint 都使用 closed payload；`selected` 和 `serialize` 请求为 `{ envelope }`。
- envelope 保存 v1 schema、原 Session ID、Environment fingerprint 与精确 Marivo ref，不保存 Catalog fingerprint。
  模型只收到 `<marivo-semantic-ref>` 内的规范 ref JSON；JSON 中的标记分隔字符使用 Unicode escape。

请求 query 最多 128 code points；Session ID 与 Environment fingerprint 最多 256，kind 最多 128，path/name 最多
2048，候选描述最多 240。请求序列化总量最多 1 MiB，候选响应不设条数上限。Catalog 子进程限时 30 秒、stdout 最多
32 MiB、stderr 最多 8 KiB。领域 kind/path 合法性仍由 Marivo 判断；wire parser 不作成员认证。

语义详情的“加入提问”与 `@` 共用同一个 chip 构造函数、source 和提交 codec，展示、复制及模型 marker 完全一致。
详情先调用 `prepare`，请求为 `{ sessionId, workspaceId, environmentFingerprint, ref }`，返回 `{ envelope }`。
Host 核验 Session 的唯一 Workspace 归属后建立或核对 Agent binding，完成后再次核验 Agent、Workspace、
配置路径和 binding identity。Workspace 身份不能以相同路径替代。

`prepare` 只核验身份连续，不加载 Catalog、不核验对象存在性或有效性、不执行分析、不访问凭据。
身份连续不代表对象仍存在；对象删除或改名由后续 Marivo 读取发现。浏览与引用的 opaque Environment fingerprint
共同包含 Workspace ID 与底层 Runtime fingerprint，保留 v1 envelope 结构；底层 checked runner 的执行身份不变。
同路径重新注册的 Workspace 有不同引用身份。显式 `prepare` 或 `@` candidates 可建立当前归属，旧 envelope
仍因 fingerprint 不匹配而拒绝。旧版未包含 Workspace 身份的草稿引用需重新选择，不做静默迁移。`serialize` 只检查已建立的归属与 binding，不修复或重写旧引用。

详情操作监听原生输入状态：`plain` 和 `claimed` 均可插入；进入 adjudicating/submitting 时取消准备，恢复可编辑后
迟到结果仍不得写入下一条草稿。普通消息提交保持 `plain` 并清空草稿，因此同时监听从有内容到空草稿的转换
（含附件和手动清空）来取消旧操作。普通编辑允许继续，成功准备后采用最新 revision，最终由 Host 执行插入守卫。

## Environment 与 Catalog 生命周期

候选请求复用 Agent 当前 Workspace 的 Environment resolver。首次请求按需加载；成功快照从发布开始缓存 30 秒。
相同 fingerprint 共享加载，一个 waiter 取消只解除自身等待；最后一个 waiter 取消后旧 flight 不可再共享，也不能
发布快照或清理后续 flight。没有后台刷新、文件监听或 stale fallback。

adapter 使用 `ms.load(workspace_dir=...)` 和 `RefPayloadV1.from_ref(...).to_dict()`，只投影 ref、key、name 与
有界 business definition。子进程显式设置 `MARIVO_TELEMETRY=off`、`PYTHONDONTWRITEBYTECODE=1`；checked runner
仅将这两个精确非秘密控制值排除于 secret 脱敏，其他 overlay 值仍受原有脱敏保护。

`selected` 与 `serialize` 只访问已开始绑定的 Environment，不发起新的绑定或 Catalog Python 操作。原 live Agent
不可用、当前 Workspace 归属改变或绑定失败时拒绝序列化。Catalog 更新、删除或候选刷新失败不阻断归属正确的引用
提交；Agent 必须通过执行时 Catalog 和 exact ref factory 验证，不能自动替换对象。

## 热度与错误

`dsh_data_analysis_semantic_reference_usage` v0 domain 的 `workspaces` 表按 canonical root 的 SHA-256 隔离。
输入候选每次 onPick 记录一次；详情仅在 Host 确认插入成功后记录一次，点击失败不计数。序列化、发送和重试不计数。按 Workspace 排队首次 put 和后续原子 update，更新时清理窗口外
日桶并对 safe integer 饱和。只有已持久化热度影响下一次候选。

storage 故障只降级为零热度和有界 diagnostic。Catalog/Environment/RPC 错误不会退化为普通文字；候选失败沿用
DSH 移除对应 source group 的行为，提交失败沿用 composer error 并保留草稿。插件关闭时先停止新请求并取消加载，
再 drain 已入队更新、关闭 domain；Browser source 生命周期结束会取消 outstanding RPC。

## 验证

执行 `npm run test:semantic-reference-input`。确定性测试执行 checked-out DSH 的真实 controller、InputMachine 和
SessionInputShell；这些是输入管线集成证据，不代替真实 Web 验收。真实 Catalog 测试可通过
`DSH_DATA_ANALYSIS_TEST_PYTHON` 指定正式 Marivo 0.5.5；默认查找本地 DSH shared Runtime，缺失时明确 skip。

`npm run validate:semantic-ask-dsh:web` 验证真实 composer 的两种入口、撤销及模型请求。
