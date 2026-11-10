# 分析下一步推荐

## 责任与入口

每轮正式保存分析 UI 后，分析 Agent 通过 `marivo_next_steps` 提供当前 Chat 的临时下一步按钮。插件拥有工具、实时通知、收尾和按钮；Harness 拥有原生输入、消息准入、失败反馈及重试；Marivo 的分析与固定结果契约不变。

实现为 `src/next-steps/`、`src/client/next-steps.tsx` 和 `src/client/next-steps-model.ts`。报告保存与位置见[展示交付](presentation-delivery.md)，正文阅读见[分析文档 reader](presentation-reader.md)。

## 生成与收尾

`marivo_next_steps({items:[{label,prompt}]})` 接受 0—4 项，通常提供 3 项。空数组表示没有适当推荐或用户明确省略。标题与问题分别限制 40、1000 个 Unicode code points；去除首尾空白，拒绝空文本、额外字段和空白规范化后的重复标题或问题。Session、Workspace 与 Turn 从真实工具执行取得。

短标题完整表达动作和对象，问题只能展开同一任务，不能增加未显示的操作或范围。Agent 只推荐当前数据可立即执行、报告尚未回答的任务；不默认建议补充缺少的维度、期间或数据集，宁可少给或返回空数组。推荐语言跟随分析语言，常驻 routing prompt 与工具说明指导此流程。

只有当前安装中实际观察到的成功 `marivo_present` save 可以触发收尾。preview、旧历史、失败结果和其他 Agent 不触发。新的保存或用户输入使待定推荐失效；`agent/turn-stopping` 缺少有效推荐时最多补齐一次，仍失败则自然结束。取消时不补齐。

推荐在工具中登记于内存，成功后通过公开 `exec.concludeTurn()` 标记本轮结束，到所属 Turn 正常 completed 后才发布。该工具应是完成用户任务后的最后一次调用，不再追加复述建议的助手正文；Harness 仍处理已经到达的 steering 与同一步上下文，不截断已提交工作。异常或取消丢弃待定内容。工具成功只确认接收，不证明浏览器已显示。

## 实时交付与清理

插件通过公开 Typert stream `dshDataAnalysisNextSteps.watch(sessionId)` 投递实时通知。Native 和 PTC 共用工具实现与成功结果观察，不依赖 PTC 返回值或 durable dispatch。每个订阅者仅在订阅期间接收，后来的订阅没有 baseline 或历史；关闭会唤醒并终止等待。

推荐不写报告、Workspace 文件、插件存储或浏览器持久化，也不从正常模型/工具历史恢复 UI。Harness 自身工具调用历史和实际提交的用户消息保持其原生规则。

客户端只保留主视图当前 Session/Workspace/连接 generation 的一组推荐。切换会话、Workspace 路径或连接、刷新、卸载均清空；新的用户提交或下一轮开始也清空。迟到通知和已消费选项不能恢复旧按钮。

## Chat 与原生提交

按钮位于真实 Turn 的 Chat 结果节点内、可移动报告正文容器之外。报告移入右侧或关闭 Tab 不移动推荐；右侧 reader、目录、历史与离线 HTML 不包含推荐。正常态单排展示短标题和发送箭头，没有提示词详情、额外说明或输入控件。窄容器横向滚动，键盘焦点可将选项滚入视野。

点击前重新核对会话归属、Workspace、连接、Agent 空闲、无待提交消息，以及原生输入为 plain 且没有文字、引用、附件、command 或队列。草稿存在时禁用按钮，保留草稿。

点击同步锁定选项，通过当前 Session 的 Harness `SessionInput.setDraft(prompt)` 和 `submit()` 写入纯文本并发起一次正常提交，随即移除推荐。组件不创建输入框、引用 codec、准备 RPC 或独立提交 API。`submit()` 返回 void，不作为已接收证明；消息失败、草稿恢复及重试由 Harness 负责，插件不自动重发。

## 验证边界

`tests/unified-analysis-ui/next-steps.test.ts` 覆盖 schema、临时 stream、一次消费以及真实 Harness 普通/工具终止、嵌套执行下的收尾。隔离 Web 入口为 `scripts/unified-analysis-ui/web.ts --next-steps`，使用打包生产插件和脚本模型验证实际 Native/PTC、Chat、右侧移动与原生输入。

脚本模型验证接线与交互，不证明真实模型推荐质量。完整检查、打包、浏览器与真实模型证据分别记录，不互相替代。
