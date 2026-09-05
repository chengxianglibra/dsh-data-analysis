# 语义对象引用输入

## 使用方式

在当前 Workspace 的输入框任意位置输入 `@`，可以选择 Marivo 对象。输入 `@revenue` 做文本检索；多词查询使用
`@"monthly revenue"`。菜单与文件、文件夹和 Session 候选并存。选中后显示完整 `kind:path` 原子引用；复制得到
`@kind:path` 普通文字，重新粘贴不会恢复隐藏引用。

空查询最多返回 40 个对象，其中最近七个 Host 自然日常用对象最多 10 个。非空查询按 exact、prefix、contains、
fuzzy 分层；strict 不足 12 个时才追加 trigram Dice 不低于 `0.42` 的字符相似结果，短于三个 code points 不做 fuzzy。
NFKC、大小写和空白规范化仅影响检索，不修改 ref。热度只在同等相关度内打破平局；它不表达业务有效性。

## 所有权与接口

- DSH 拥有输入状态机、generation/abort、菜单、occurrence、undo 和提交错误提示；插件注册 `marivo-semantic` source。
- Marivo 拥有 `SemanticKind`、`RefPayloadV1`、Catalog 和执行时领域验证；插件不扫描模型或维护对象 registry。
- 插件通过 `/dsh-data-analysis` 的 `trusted-host` channel 提供 `semantic-references/candidates`、`selected`、`serialize`。
  三个 endpoint 都使用 closed payload；`selected` 和 `serialize` 请求为 `{ envelope }`。
- envelope 保存 v1 schema、原 Session ID、Environment fingerprint 与精确 Marivo ref，不保存 Catalog fingerprint。
  模型只收到 `<marivo-semantic-ref>` 内的规范 ref JSON；JSON 中的标记分隔字符使用 Unicode escape。

请求 query 最多 128 code points；Session ID 与 Environment fingerprint 最多 256，kind 最多 128，path/name 最多
2048，候选描述最多 240。请求序列化总量最多 1 MiB，候选总数最多 40。Catalog 子进程限时 30 秒、stdout 最多
32 MiB、stderr 最多 8 KiB。领域 kind/path 合法性仍由 Marivo 判断；wire parser 不作成员认证。

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
每次 onPick 记录一次；序列化、发送和重试不计数。按 Workspace 排队首次 put 和后续原子 update，更新时清理窗口外
日桶并对 safe integer 饱和。只有已持久化热度影响下一次候选。

storage 故障只降级为零热度和有界 diagnostic。Catalog/Environment/RPC 错误不会退化为普通文字；候选失败沿用
DSH 移除对应 source group 的行为，提交失败沿用 composer error 并保留草稿。插件关闭时先停止新请求并取消加载，
再 drain 已入队更新、关闭 domain；Browser source 生命周期结束会取消 outstanding RPC。

## 验证

执行 `npm run test:semantic-reference-input`。确定性测试执行 checked-out DSH 的真实 controller、InputMachine 和
SessionInputShell；这些是输入管线集成证据，不代替真实 Web 验收。真实 Catalog 测试可通过
`DSH_DATA_ANALYSIS_TEST_PYTHON` 指定正式 Marivo 0.5.3；默认查找本地 DSH shared Runtime，缺失时明确 skip。

参见[设计契约](../plan/semantic-reference-input-mvp-design.md)与[验收记录](../acceptance/semantic-reference-input.md)。
