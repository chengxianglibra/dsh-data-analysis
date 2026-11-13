# 草稿与编辑恢复

仅在上下文缺失或失败时读取，正常成功后使用回执继续。恢复保持用户要求的编辑或数据刷新范围。

## 版本与读取

`marivo_report_list({query})` 按标题找已保存报告。存在同名时结合会话与保存时间筛选，再用 `marivo_report_read` 确认选中的版本。只有用户接受替代版本时才用其他版本。

`marivo_report_write` 始终显式选择 `stage:"preview"|"save"`。成功返回单一 `ref`，直接传递而不构造或拆分。preview 是当前 Session/Turn 的内存草稿；save 是固定 Build，可在 Workspace 与存储仍可访问时跨 Session/Host 重启读取。ref 不代替权限核验。

- 准确版本：`marivo_report_read({ref})`。
- 视图当前版本：`marivo_report_read({ref,version:"current"})`，仅限 saved ref。
- 当前 Turn 草稿：`marivo_report_read({draft:true})`。

两类输入互斥，`includeCode` 可用于任一形式；不要为 draft 传 `ref` 或 `version`。`report-read-invalid-input` 的 `error=` JSON 给出输入问题与修复建议；草稿过期、引用无效或 Workspace 不匹配属于不同状态，应按各自错误恢复，不要只改参数盲试。

结构化 `definition` 包含实际读取的 ref、程序、资源声明、配置元信息和准确引用复用组。需要脚本时传 `includeCode:true`；sources 按执行记录去重，unavailable 不阻塞内嵌快照读取，也不触发代码执行。组件签名按需读[组件签名](analysis-catalog.md)。

草稿不跨 Turn/重启。流式画面不产生可用 ref。旧 revision 用 `{draft:true}` 恢复同一草稿；已有草稿时先续接，另起草稿需在新 Turn 或在当前草稿完成后进行。

保存超时、取消或丢失回执时，先读取错误返回的 saved ref。没有 ref 时用 `marivo_report_list({callId})` 查该次调用的正式版本，PTC 使用嵌套写入 call ID。没有调用身份时按标题查找，并用 read 核对内容。确认尚未保存后才重试。

资源读取失败时按错误中的资源名检查准确引用、原 Workspace、绑定 Runtime 或图片路径。草稿未应用时，用最新 ref 和可用的固定资源继续。

## 冲突恢复

busy 时等待在途操作完成再读取；draft-conflict 时读取最新草稿并审阅预期修改；save-conflict 时读取错误给出的 `currentRef` 与草稿。不得只换 ref 盲目重放。

审阅后用 `stage:"preview"`、最新 draft ref 和 `onto:<已审阅的当前 saved ref>` 合并累计修改。onto 只供冲突预览，成功后仍需 save；没有自动保存、自动重算或自动覆盖。

refresh-data 草稿保持该模式，只合并仍兼容的同名资源替换。edit 草稿可提交已授权的程序及元数据修改。模式不可在草稿中切换；需改变任务性质时从 saved ref 开始新操作。

草稿 unavailable 时，从已保存版本及保留的准确资源重建；没有可靠输入则说明缺口。只为恢复预览不重跑分析。数据刷新另见[刷新流程](data-update.md)。

## 删除与发布

用户要求永久删除时，用 `marivo_report_delete` 和准确当前 saved ref。冲突时重新读取当前版本并核对用户要删除的目标。若返回 `cleanupPending`，用同一 ref 重试清理。

Host 提供 `marivo_publish_report` 且用户明确要求发布到对象存储时，使用准确 saved ref。上传未确认时先核对对象存储中的该版本，缺凭据时从「凭证管理」补齐。
