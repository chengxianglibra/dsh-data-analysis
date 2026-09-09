# 语义对象引用输入 MVP 验收

## 结论

2026-09-05 完成实现与本机验收。使用 Node.js 24.18.0、DSH 0.1.1-rc.2、正式 Marivo 0.5.3，所有新增测试
实际运行，无 skip。独立 DSH home/profile 安装 npm tarball 后启动并重装重启，未清理已有用户 profile、Session 或
Workspace。本次未提交、推送或发布。

## 确定性与真实 Runtime

`npm run test:semantic-reference-input`：17 项通过。覆盖 closed shape、Unicode bounds、类型/path 身份、排序与
40 项上限、fuzzy 门槛、TTL、singleflight 取消隔离、旧 flight 完成不覆盖新 flight、取消后迟到拒绝、七日日桶、
Workspace 隔离、真实 storageDomain 并发首次选择与持久化重开、storage 故障降级、RPC authority、错误脱敏和关闭。

输入测试运行 checked-out DSH 的真实 `InputTriggerController`、`InputMachine`、`SessionInputShell`，验证 source
共存、quoted query、generation drop、copy/undo/delete、普通粘贴不升级，以及 codec 失败保留草稿和 notice。
独立环境测试补充验证控制项不破坏 `v1` ref，同时 credential overlay 仍脱敏。

真实 Marivo 测试在父环境未关闭 telemetry/bytecode 的条件下，分别检查空 Catalog、109 对象 Catalog、编译失败
路径的完整文件树与内容摘要。均未生成 `.marivo/`、`marivo.toml` 或 `__pycache__`；已有模型文件没有变化。

## 实际 Web 用户旅程

| 场景 | 观察结果 |
| --- | --- |
| Workspace A / B 隔离 | A 有 109 个跨 kind 对象，B 有 8 个；A 菜单 40 项，B 不显示 A 的语义对象或热度 |
| source 共存 | Marivo group 在文件/文件夹和 Session group 前；异步加载不移除其他 source |
| 检索与选择 | quoted contains、exact/prefix、`revnue` fuzzy 均可选择，chip 保存完整 `kind:path` |
| 热度恢复 | B 选择后页面重载及 Host 重启，`operations.revenue` 仍在“最近 7 天常用”首位 |
| 定义变更 | 先选择 `metric:sales.revenue`，再把计算体改为 `amount.sum() * 2`；提交成功，真实 Agent 得到 **60.0** |
| 对象删除 | 再次选择后删除 `sales.revenue`；提交成功，真实 Agent 的 `catalog.require(ms.ref.metric(...))` 返回 `not_found`，明确报告分析失败且未替换对象 |
| 候选刷新 | 后续候选加载不再返回已删除 ref，旧 usage 未重新引入该对象 |
| 归属变化 | 保留 A 的原子 chip，将独立 Host 的 projectRoot 改绑 B 并重启；新候选为 B，原 chip 提交被拒绝，composer 显示 error 并保留草稿/chip |
| 视觉检查 | 使用 DSH 通用 chip；候选 kind glyph 已收敛为单字符，避免窄图标栏换行 |

真实 Agent 使用 DeepSeek-V4-Flash，DSH Session 为 `session-3830a6fe-8588-474e-bf06-144d60af2d70`。
两次 `turn/end` 均为 `completed`；第二次的完成表示 Agent 已正确报告领域失败，并不表示对象分析成功。
第一次分析生成 Marivo Artifact `art_e6165197f5f35f9f16aa08c9`，对应 Session
`sess_dd658ed1ca2b8735381d3537`。浏览、选择与提交的 usage sidecar 未进入模型 marker；Agent 正常分析阶段的
Artifact、Evidence 和 telemetry 写入仍由 Marivo 拥有。

本机证据保存在忽略版本控制的 `artifacts/semantic-reference-input/web-journey.json` 与 `agent-finals.json`；前者包含
终态、测试 profile 和最终 client 摘要，后者只提取 assistant 可见正文，不导出 reasoning。

## 仓库与分发门禁

- `npm run check`：通过，包括新增 suite 和既有回归测试。
- `npm run verify:plugin-package`：通过；包含完整 build/prepack、安装包 import 验证及 Python report-kit 检查。
- 独立 profile 的最终 client SHA-256 与本地构建一致：`83ec54eda0a7bcadd6c8569edf5a150e2e8f9bf3a18a0008c347aaf36e35e1b5`。
- `git diff --check`：通过；文档相对链接与 Markdown 渲染已检查。

测试可移植性：没有 sibling DSH checkout 时，仅私有输入 core 集成测试明确 skip；没有正式 Marivo Python 时，真实
Catalog 测试明确 skip，可用 `DSH_DATA_ANALYSIS_TEST_PYTHON` 指定解释器。这些 skip 不应当作真实验收通过。


## 2026-09-09 中文类型名检索与完整候选展示

输入菜单、语义层浏览器和检索共用中文类型文案，例如 `@指标`、`@业务域` 和 `@"指标 revenue"`。
英文 kind、对象 name/path/refKey 与业务定义检索保持可用。共享文案仅用于展示和文本匹配，Catalog
对象类型仍由 Marivo 实时提供。

取消候选展示条数上限和截断提示，空查询及关键词查询均返回所有符合匹配规则的对象；常用对象最多
10 个优先展示，其他对象去重后全部保留。请求移除 `limit`，响应保留 `environmentFingerprint` 和 `items`。
原有 Catalog 加载保护及请求、字段校验继续生效，不改变 Harness 菜单或 Marivo 语义契约。

验收覆盖全部 13 个中文类型名、混合查询、未知 kind、超过 40/100 条的空查询、关键词与 fuzzy 检索、
常用项去重、响应解析，以及已安装 Harness 控制器中第 250 个候选的选择与原子引用插入。
真实 Marivo Catalog 验证完整对象返回、中文指标检索和 Workspace 无额外文件写入。

本次未进行浏览器页面视觉验收，也未重装插件或重启用户 DSH 服务。


使用 Node.js 22.19.0、DSH 0.1.5-alpha.1 与 Marivo 0.5.4 验证：

- `npm run test:semantic-reference-input`：19 项全部通过，无跳过。
- `npm run check`：450 项通过、0 失败，4 项真实进程取消与长时执行测试因未指定所需 Runtime 而跳过。
- 完整检查内执行的 `npm run build`、`npm run verify:plugin-package` 和 `git diff --check` 通过。
