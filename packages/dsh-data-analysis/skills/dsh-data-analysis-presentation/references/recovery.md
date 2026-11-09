# 草稿与编辑恢复

仅在上下文缺失或失败时读取。正常 preview 后直接使用回执继续，不例行回读。

## 身份与生命周期

Native 和 Code Mode 的 `marivo_present` 公开结果均有 `stage`。preview 返回 `draftId/draftRevision`；save 返回 `recordId`。使用这些字段继续工作，`deliveryJson` 留给 Host 交付。

草稿只属于当前 Harness Session/Turn，每个 Session 同时一个；preview 和 save 串行调用。Turn 结束或 Host 重启后草稿失效，浏览器里的旧预览不证明仍可保存。结束 Turn 前完成保存，或明确说明未保存和阻塞原因；不要承诺下轮仍能接续该草稿。

`program` 更新使用完整命名语句作为 patch。`resources` 省略则继承，提供则替换完整映射；它不是资源 patch。修改或追加组件时保留仍在使用的全部资源声明。

## 按缺口读取

- 已知正式版本：`marivo_ui_read({recordId})`。
- 需要该报告当前正式版本：`marivo_ui_read({recordId, current:true})`。
- 缺少当前 Turn 草稿或最新 revision：`marivo_ui_read({draft:true})`。

结果的 `definitionJson` 包含 program、全部资源声明及必要 schema/coverage，不返回业务行。草稿结果提供 `draftId/draftRevision` 和可用的 `basedOnRecordId`，不把草稿当作已保存的 record。

需要核对来源脚本或用户已授权更新数据时，加 `includeCode:true`。资源返回绑定的 `codeRef`，顶层 `sources` 按执行记录去重，包含 `status` 和可用的 `code.text`、`code.datasources`、`code.resultVariables`；`unavailable` 明确表示记录不可读，不以新查询补齐。缺少 codeRef 的资源不出现在 sources 中。读取不会执行脚本。更新步骤见[只更新报告数据](data-update.md)。

## 冲突与失效

`analysis-draft-busy`：等待正在执行的调用结束，再读取草稿核对，不能并发重试。`analysis-draft-conflict`：读取最新草稿，审阅并调整本次改动后使用新的标识，不能只换 revision 盲目重放旧 patch。

`report-save-conflict` 返回 `currentRecordId`。先读当前正式版本，审阅并保留其他已确认修改。直接 save 没有草稿时，以当前版本为 `basedOnRecordId` 提交调整后的修改。有草稿时再读 `{draft:true}` 比较差异，用 `stage:"preview"`、最新草稿标识和 `rebaseOnRecordId`，提交相对新正式版本的累计 program patch 与完整 resources；需要保留的标题、语言及标签改动也明确提交。此操作只接受同一报告，成功后仍须核对并 save，不自动合并或覆盖。若业务内容冲突无法判断，保留已支持的答案并明确阻塞。

失败保留最后一次成功草稿仅限当前 Turn。`analysis-draft-unavailable` 时，从已保存版本、保留的 program 和已有 snapshotRefs 重建预览；缺少这些内容时说明缺口，不为补预览重跑查询。图片及同声明快照可复用保存版本或当前草稿内嵌的内容，不要求原捕获文件仍存在。
