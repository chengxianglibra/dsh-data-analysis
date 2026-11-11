# 草稿与编辑恢复

仅在上下文缺失或失败时读取，正常成功后使用回执继续。恢复保持用户要求的编辑或数据刷新范围。

## 版本与读取

`marivo_report_write` 始终显式选择 `stage:"preview"|"save"`。成功返回单一 `ref`，直接传递而不构造或拆分。preview 是当前 Session/Turn 的内存草稿；save 是固定 Build，可在 Workspace 与存储仍可访问时跨 Session/Host 重启读取。ref 不代替权限核验。

- 准确版本：`marivo_report_read({ref})`。
- 视图当前版本：`marivo_report_read({ref,version:"current"})`，仅限 saved ref。
- 当前 Turn 草稿：`marivo_report_read({draft:true})`。

结构化 `definition` 包含实际读取的 ref、程序、资源声明、配置元信息和准确引用复用组。需要脚本时传 `includeCode:true`；sources 按执行记录去重，unavailable 不阻塞内嵌快照读取，也不触发代码执行。组件签名按需读[组件签名](analysis-catalog.md)。

草稿不跨 Turn/重启，写入串行使用最新成功 ref。流式画面是候选，不产生可用 ref；失败或取消保留最后成功版本。`deliveryJson` 是 Host-owned 投递兼容字段，不用于模型拼装版本。

## 冲突恢复

busy 时等待在途操作完成再读取；draft-conflict 时读取最新草稿并审阅预期修改；save-conflict 时读取错误给出的 `currentRef` 与草稿。不得只换 ref 盲目重放。

审阅后用 `stage:"preview"`、最新 draft ref 和 `onto:<已审阅的当前 saved ref>` 合并累计修改。onto 只供冲突预览，成功后仍需 save；没有自动保存、自动重算或自动覆盖。

refresh-data 草稿保持该模式，只合并仍兼容的同名资源替换。edit 草稿可提交已授权的程序及元数据修改。模式不可在草稿中切换；需改变任务性质时从 saved ref 开始新操作。

草稿 unavailable 时，从已保存版本及保留的准确资源重建；没有可靠输入则说明缺口。只为恢复预览不重跑分析。数据刷新另见[刷新流程](data-update.md)。
