# 第二阶段 2c 语义对象加入提问验收

## 交付范围与责任

按[第二阶段实施决定](dsh-context-stage-two-research.md#必须先补齐绑定交接)，语义列表详情、独立对象 Tab
与兼容弹层提供“加入提问”。详情与输入框 `@` 使用同一个 chip 构造函数，完整 source、v1 envelope、
label、clipboardText 及原提交 codec 相同。点击仅追加一个原生 chip，不自动发送或提前 serialize。

插件新增 `semantic-references/prepare`：校验 Session 的唯一 Workspace 归属，复用 shared Runtime 建立或
核对 Agent binding，异步完成后再次核验身份。相同路径不能代替 Workspace 身份。Harness 继续拥有输入
状态机、revision、occurrence、附件、撤销和提交；Marivo 继续拥有语义内容及执行时对象验证。

采用用户确认的**只核验身份连续**策略。准备操作不重新加载 Catalog、不检查对象存在性、不执行分析、
不读取凭据。身份连续不代表对象仍存在；删除或改名由后续 Marivo 读取发现。`serialize` 不自动重绑，
不改写旧 envelope。无 Session 时浏览仍可用，“加入提问”禁用。

## 输入与失效行为

报告和语义输入共用所属 Session/Workspace 校验、最新草稿读取和末尾 detect 坐标计算；报告包装及错误文案
留在报告层。准备完成后使用最新 `draftRev` 调用一次 `slash/input-insert-reference`，保留文字、已有 chips
和附件。准备期间禁止重复点击，完成后可再次追加；常用计数仅在 Host 确认插入成功后更新，计数失败不回滚。

页面关闭、导航、刷新或快照替换、Session 切换、Workspace 撤销、连接重置和卸载都会阻止迟到结果写入。
`plain` 与 `claimed` 均允许插入，Host 拒绝不可编辑状态或旧 revision。准备操作监听输入状态，命令进入提交即取消；
普通发送保持 plain，因此从有文字/附件到空草稿也取消准备（包括手动清空），
恢复为新草稿后也不接受迟到响应；失败保留页面与草稿，提供可重试的固定中文反馈。

## 确定性验证

新增测试覆盖首次未建立 binding 的准备与序列化、同路径不同 Workspace、跨 Session、fingerprint 变化、
Runtime 失败、Agent/配置变化、取消和迟到完成。准备时 checked runner 无 Catalog/分析调用，Catalog 对象
删除不改变身份连续策略。引用 fingerprint 包含 Workspace ID 和 Runtime fingerprint，同路径的新 Workspace
可通过新的 prepare/candidates 建立归属，旧 envelope 在恢复前后均拒绝；底层 Runtime 身份及 v1 envelope 结构不变。

客户端对比两个入口的完整 chip、复制格式与 codec 输出；覆盖等待期间继续输入、原子坐标、旧 revision、
提交中拒绝、普通发送与手动清空后迟到响应拒绝、claimed 状态插入、错误响应、重复点击、关闭/导航/刷新/撤销/重置/卸载，以及成功后计数与计数失败保留。
原报告输入测试继续通过。

## 真实 Web 证据

2026-09-09，使用 Node.js `22.19.0`、Harness `0.1.5-alpha.1`、Marivo `0.5.4`，通过
`npm run validate:semantic-ask-dsh:web` 执行 **10 项真实 Web 检查**：

- 首次不经过 candidates，从独立对象详情插入；保留文字和图片附件，没有提前 serialize。
- 一次原生撤销恢复原草稿、引用和图片附件。
- 实际 `@` 候选菜单与详情生成相同的引用字段和 chip DOM。
- 列表详情再次追加，保留已有 `@` chip。
- 暂停真实 prepare 响应，切换 Session 后返回，释放迟到响应也不写入草稿。
- 准备期间完成普通发送，释放迟到响应后下一条草稿保持为空。
- 用户原生提交分别调用两次既有 codec；实际模型请求包含两个规范语义 marker。
- 通过 Host 公开接口建立 claimed 命令草稿，详情按钮与实际 `@` 菜单均插入相同引用。
- 无 Session 的报告来源回退到语义弹层，仍可浏览、复制按钮可用，“加入提问”禁用。
- 真实 Workspace 注册删除并按相同路径重建，保留同一个 Agent；新详情与 `@` 引用恢复可用，旧引用仍被 codec 拒绝。

验收使用打包的生产插件、真实 Harness Web/composer、真实 Runtime 和独立临时 profile；模型 adapter 为
脚本边界。测试 Session 先完成一条不使用工具的初始化消息，未建立 Marivo Agent binding；模型通过公开选择
接口显式设为测试 adapter。图片保留和撤销单独验证，随后通过 Host 输入接口移除图片，再验证文本提交。
此证据不代表真实模型推理质量或图片请求支持。

证据保存在 [Web 检查与模型请求](../artifacts/dsh-context-stage-two-c/evidence.json)和
[两个入口的 chip 截图](../artifacts/dsh-context-stage-two-c/semantic-chips.png)，均被 Git 忽略。
原运行目录标识为 `dsh-semantic-ask-dsh-5dqzf1`；临时 Workspace、profile 和测试服务已清理。

## 构建与检查

最终 `npm run check` 通过 quality、依赖检查、源码及脚本 typecheck，共 486 项测试中 482 项通过、
4 项既有 Runtime 条件测试跳过，无失败。`npm run build` 与 `npm run verify:plugin-package` 通过：
236 个分发文件，28 个 DSH peers 均为 `0.1.5-alpha.1`，打包的 presentation kit、契约及 offline builder 通过。
真实 Web 安装包的 85 个生产 JS 模块摘要与最终构建完全一致。5 份修改文档的本地链接与 `git diff --check` 通过。

本次未发布、未重装生产 profile、未重启现有服务。
