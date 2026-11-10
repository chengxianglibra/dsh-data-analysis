# 分析下一步推荐

## 责任与入口

每轮成功新建或更新报告并正式保存分析 UI 后，分析 Agent 都须为本轮最终保存版本重新生成推荐，不因上一轮已给过推荐而跳过。分析 Agent 通过 `marivo_next_steps` 提供当前 Chat 的临时下一步按钮。插件拥有工具、实时通知、收尾和按钮；Harness 拥有原生输入、消息准入、失败反馈及重试；Marivo 的分析与固定结果契约不变。

实现为 `src/next-steps/`、`src/client/next-steps.tsx` 和 `src/client/next-steps-model.ts`。报告保存与位置见[展示交付](presentation-delivery.md)，正文阅读见[分析文档 reader](presentation-reader.md)。

## 生成与收尾

`marivo_next_steps({items:[{label,prompt}],emptyReason?})` 接受 0—4 项，正常提供 1—4 项，通常为 3 项。用户明确拒绝时使用 `items=[]`、`emptyReason="declined"`，不生成推荐，也不触发补齐。没有合适推荐时使用 `items=[]`、`emptyReason="no-suggestions"`；旧调用只传 `items=[]` 也归入此情况，不能当作用户拒绝。非空列表不能携带 `emptyReason`。标题与问题分别限制 40、1000 个 Unicode code points；去除首尾空白，拒绝空文本、额外字段和空白规范化后的重复标题或问题。Session、Workspace 与 Turn 从真实工具执行取得。

短标题完整表达动作和对象，问题只能展开同一任务，不能增加未显示的操作或范围。Agent 只推荐当前数据可立即执行、报告尚未回答的任务；不默认建议补充缺少的维度、期间或数据集，宁可少给；确实没有可行任务时返回空数组，不编造填充项。推荐语言跟随分析语言，常驻 routing prompt 与工具说明指导此流程。

只有当前安装中实际观察到、属于当前 Agent、Session 与开放 Turn 的成功 `marivo_present` save 可以触发收尾。preview、旧历史、失败结果、其他 Agent 及 Turn 不匹配的结果不触发。每次保存更新最终 `reportId/buildId` 并使待定推荐失效；同一轮多次保存只针对最后成功保存的版本发布一组。新的用户输入撤销待定状态；在该输入前已开始的保存，即使迟到成功也不能重新触发收尾。

`agent/turn-stopping` 缺少有效非空推荐且用户未明确拒绝时，最多通过一次 steering 补齐；普通空列表也需要此补齐。重试标记属于 Turn，不因再次保存而重置。仍为空、未调用工具或生成失败时不编造按钮；在 Chat 所属 Turn 显示下一步暂不可用状态，并以 `no-suggestions`、`generation-incomplete` 或 `generation-failed` 区分原因。显式拒绝不显示此状态。取消、新输入与被替代的结果不补齐、不发布过期建议。生成请求的超时与取消由 Harness 拥有；插件不另开模型请求或无限重试。

推荐在工具中登记于内存；非空结果、明确拒绝或补齐后的空结果通过公开 `exec.concludeTurn()` 标记本轮结束，首次普通空结果等待一次收尾补齐。只有所属 Turn 正常 completed 才发布可用推荐；失败时仅发布 unavailable 状态，取消或异常中断丢弃待定内容。每组通知包含 `reportId/buildId`、`status` 与必要的 unavailable `reason`，一次 Turn 结束最多发布一次最终结果。该工具应是完成用户任务后的最后一次调用，不再追加复述建议的助手正文；Harness 仍处理已经到达的 steering 与同一步上下文，不截断已提交工作。工具成功只确认接收，不证明浏览器已显示。

## 实时交付与清理

插件通过公开 Typert stream `dshDataAnalysisNextSteps.watch(sessionId)` 投递实时通知。Native 和 PTC 共用工具实现与成功结果观察，不依赖 PTC 返回值或 durable dispatch。每个订阅者仅在订阅期间接收，后来的订阅没有 baseline 或历史；关闭会唤醒并终止等待。

推荐不写报告、Workspace 文件、插件存储或浏览器持久化，也不从正常模型/工具历史恢复 UI。Harness 自身工具调用历史和实际提交的用户消息保持其原生规则。

客户端只保留主视图当前 Session/Workspace/连接 generation 的一组推荐。切换会话、Workspace 路径或连接、刷新、卸载均清空；新的用户提交或下一轮开始也清空。迟到通知和已消费选项不能恢复旧按钮；同一 Turn 的重复最终通知不能覆盖已接收结果，本地清理或 declined 通知撤销并退役该 Turn。unavailable 状态与推荐共享相同的清理、归属和临时生命周期。

## Chat 与原生提交

按钮位于真实 Turn 的 Chat 结果节点内、可移动报告正文容器之外。报告移入右侧或关闭 Tab 不移动推荐；右侧 reader、目录、历史与离线 HTML 不包含推荐。正常态单排展示短标题和发送箭头；无合适任务或生成失败时显示本地化的暂不可用状态，没有提示词详情、额外说明或输入控件。窄容器横向滚动，键盘焦点可将选项滚入视野。

点击前重新核对会话归属、Workspace、连接、Agent 空闲、无待提交消息，以及原生输入为 plain 且没有文字、引用、附件、command 或队列。草稿存在时禁用按钮，保留草稿。

点击同步锁定选项，通过当前 Session 的 Harness `SessionInput.setDraft(prompt)` 和 `submit()` 写入纯文本并发起一次正常提交，随即移除推荐。组件不创建输入框、引用 codec、准备 RPC 或独立提交 API。`submit()` 返回 void，不作为已接收证明；消息失败、草稿恢复及重试由 Harness 负责，插件不自动重发。

## 验证边界

`tests/unified-analysis-ui/next-steps.test.ts` 覆盖 schema、临时 stream、一次消费、连续 Turn 创建与更新、同一步再次保存的最终版本归属、空列表有界补齐、拒绝、模型失败、取消、新输入与迟到结果，以及真实 Harness 普通/工具终止、嵌套执行下的收尾。隔离 Web 入口为 `scripts/unified-analysis-ui/web.ts --next-steps`，使用打包生产插件和脚本模型验证实际 Native/PTC、Chat、右侧移动与原生输入。

脚本模型验证接线与交互，不证明真实模型推荐质量。完整检查、打包、浏览器与真实模型证据分别记录，不互相替代。
