# 分析下一步推荐

## 责任与入口

每轮成功新建或更新报告并正式保存分析 UI 后，分析 Agent 都须为本轮最终保存版本重新生成推荐，不因上一轮已给过推荐而跳过。分析 Agent 通过 `marivo_next_steps` 提供当前 Chat 的临时下一步按钮。插件拥有工具、实时通知、推荐完成检查和按钮；Harness 拥有原生输入、消息准入、失败反馈及重试；Marivo 的分析与固定结果契约不变。

实现为 `src/next-steps/`、`src/client/next-steps.tsx` 和 `src/client/next-steps-model.ts`。报告保存与位置见[展示交付](presentation-delivery.md)，正文阅读见[分析文档 reader](presentation-reader.md)。

## 生成与收尾

`marivo_next_steps({ref,items:[{label,prompt}],emptyReason?})` 要求准确 saved ref，接受 0—4 项，正常提供 1—4 项，通常为 3 项。用户明确拒绝时使用 `items=[]`、`emptyReason="declined"`，不生成推荐，也不触发补齐。没有合适推荐时使用 `items=[]`、`emptyReason="no-suggestions"`；只传 `items=[]` 也归入此情况，不能当作用户拒绝。非空列表不能携带 `emptyReason`。标题与问题分别限制 40、1000 个 Unicode code points；去除首尾空白，拒绝空文本、额外字段和空白规范化后的重复标题或问题。Session、Workspace 与 Turn 从真实工具执行取得。

短标题完整表达动作和对象，问题只能展开同一任务，不能增加未显示的操作或范围。Agent 只推荐当前数据可立即执行、报告尚未回答的任务；不默认建议补充缺少的维度、期间或数据集，宁可少给；确实没有可行任务时返回空数组，不编造填充项。推荐语言跟随分析语言，常驻 routing prompt 与工具说明指导此流程。

自动收尾仅由当前安装中实际观察到、属于当前 Agent、Session 与开放 Turn 的成功报告 writer save 触发。观察器核对安装时捕获的工具定义、registry execution token、准入 Workspace、成功 canonical result 的 saved ref 和 delivery 的准确版本。实际 writer 在成功保存点通过该安装独占的闭包记录 token/ref 证明，观察器必须匹配并消费它；仅靠 pre-execute 的 registry 定义快照不足以证明最终执行的 body。同名替换、结果前恢复原定义或 post-policy 改写 ref 均不能伪造保存。证明仅在单次执行内存在，错误结果消费、卸载清空，不是投递 metadata 或可重放历史。preview、旧历史、失败结果、其他 Agent 及 Turn 不匹配的结果不触发。每次保存更新最终 `reportId/buildId` 并使待定推荐失效；同一轮多次保存只针对最后成功保存的版本发布一组。新的用户输入撤销待定状态；在该输入前已开始的保存，即使迟到成功也不能重新触发收尾。

保存后使用工具返回的最终 saved ref；本轮发生新的成功保存后，旧 ref 的推荐提交被拒绝，旧待发布建议失效。用户显式请求已有报告的推荐时，使用读取到的准确 saved ref；Host 通过当前 Workspace 的 readAnalysisRecord 校验版本，并绑定当前 Turn，不再次保存报告，也不要求该版本在本轮生成。读取期间发生新输入、Turn 或 Workspace 变化即拒绝。draft ref 和跨 Workspace ref 不可用于推荐。

`agent/turn-stopping` 仅在当前最终保存版本遗漏有效推荐提交时，最多通过一次 steering 补齐。非空列表、明确 `no-suggestions` 和 `declined` 都是有效提交；首次普通空列表即完成推荐子流程，不触发补齐，也不额外唤起模型。重试标记属于 Turn，不因再次保存而重置。最终遗漏以 `unavailable`、`reason="generation-incomplete"` 表达；生成失败以 `reason="generation-failed"` 表达，不编造按钮。取消、新输入与被替代的结果不补齐、不发布过期建议。生成请求的超时与取消由 Harness 拥有；插件不另开模型请求或无限重试。

推荐工具只确认建议已接收，不调用 `exec.concludeTurn()`，也不结束整个 Harness Turn。工具后仍可继续报告更新、文件交付和必要的最终答复。推荐登记仅在其实际工具成功结果提交后有效；只有所属 Turn 正常 completed，且最终 Workspace 与输入 generation 仍匹配时才发布 `available`、`empty` 或 `declined`。明确空结果使用独立 `empty` 状态，无失败 reason；显式拒绝由客户端隐藏。Turn 失败仅发布 unavailable，取消或异常中断丢弃待定内容。每组通知包含 `reportId/buildId`、`status` 与必要的 unavailable `reason`，一次 Turn 结束最多发布一次最终结果。工具成功只确认接收，不证明浏览器已显示。

## 实时交付与清理

插件通过公开 Typert stream `dshDataAnalysisNextSteps.watch(sessionId)` 投递实时通知。Native 和 PTC 共用工具实现与成功结果观察，不依赖 PTC 返回值或 durable dispatch。每个订阅者仅在订阅期间接收，后来的订阅没有 baseline 或历史；关闭会唤醒并终止等待。

推荐不写报告、Workspace 文件、插件存储或浏览器持久化，也不从正常模型/工具历史恢复 UI。Harness 自身工具调用历史和实际提交的用户消息保持其原生规则。

客户端只保留主视图当前 Session/Workspace/连接 generation 的一组推荐。切换会话、Workspace 路径或连接、刷新、卸载均清空；新的用户提交或下一轮开始也清空。迟到通知和已消费选项不能恢复旧按钮；同一 Turn 的重复最终通知不能覆盖已接收结果，用户提交、点击消费或 declined 通知撤销并退役该 Turn；carrier 中断仅隐藏，不退役。unavailable 状态与推荐共享相同的清理、归属和临时生命周期。

合法通知通过 owner 校验后调用 RemoteStreamItem.accept，复用 Harness 的重连。终止异常在当前报告/显式推荐区域显示连接失败与重试入口；重试只重开订阅，失败 mount 不会永久缓存。没有 baseline，重连不恢复已丢通知，需再次请求推荐。

## Chat 与原生提交

自动保存后的按钮位于真实 Turn 的 Chat 结果节点内、可移动报告正文容器之外；显式已有报告请求位于 Harness 的 conversation.chat.turnTail，避免被工具执行详情折叠隐藏。通知的可选 callId 区分承载位置，避免重复按钮。工具 metadata 只保留定位身份，不含推荐正文，也不能从历史重建推荐。报告移入右侧或关闭 Tab 不移动推荐；右侧 reader、目录、历史与离线 HTML 不包含推荐。正常态单排展示短标题和发送箭头；无合适任务时显示本地化的无建议文案，生成失败或最终遗漏显示暂不可用状态；正常 empty 不带生成重试入口，没有提示词详情、额外说明或输入控件。窄容器横向滚动，键盘焦点可将选项滚入视野。

点击前重新核对会话归属、Workspace、连接、Agent 空闲、无待提交消息，以及原生输入为 plain 且没有文字、引用、附件、command 或队列。草稿存在时禁用按钮，保留草稿。

点击同步锁定选项，通过当前 Session 的 Harness `SessionInput.setDraft(prompt)` 和 `submit()` 写入纯文本并发起一次正常提交，随即移除推荐。组件不创建输入框、引用 codec、准备 RPC 或独立提交 API。`submit()` 返回 void，不作为已接收证明；消息失败、草稿恢复及重试由 Harness 负责，插件不自动重发。

## 验证边界

`tests/unified-analysis-ui/next-steps.test.ts` 覆盖 schema、临时 stream、一次消费、连续 Turn 创建与更新、同一步再次保存的最终版本归属、首次空列表零补齐与遗漏时的一次有界补齐、拒绝、模型失败、取消、新输入与迟到结果，以及真实 Harness 正常结束、嵌套执行、推荐后文件交付和最终答复、同名替换 writer 拒绝、准确 ref 版本校验。隔离 Web 入口为 `scripts/unified-analysis-ui/web.ts --next-steps`，使用打包生产插件和脚本模型验证实际 Native/PTC、Chat、右侧移动与原生输入。

`next-steps-client.browser.test.ts` 直接覆盖客户端安装、真实 RemoteStream 两次中断、mount 失败重试、显式 Turn 尾部位置及消费后的失效。

脚本模型验证接线与交互，不证明真实模型推荐质量。完整检查、打包、浏览器与真实模型证据分别记录，不互相替代。
