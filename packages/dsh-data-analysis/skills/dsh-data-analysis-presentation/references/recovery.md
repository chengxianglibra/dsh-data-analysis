# 草稿与编辑恢复

仅在上下文缺失或失败时读取。正常 preview 后直接使用回执继续，不例行回读。恢复保持原任务边界：数据刷新只替换资源，明确的页面编辑才修改程序。

## 身份与生命周期

Native 和 Code Mode 的 `marivo_present` 公开结果均有 `stage`。preview 返回 `draftId/draftRevision`；save 返回 `recordId`。stage 与 surface 独立，两种位置均可 preview；继续和保存时省略 surface 会继承最近成功修订的位置。使用这些字段继续工作，`deliveryJson` 留给 Host 交付。

草稿只属于当前 Harness Session/Turn，每个 Session 同时一个；preview 和 save 串行调用。Turn 结束或 Host 重启后草稿失效，浏览器里的旧预览不证明仍可保存。结束 Turn 前完成保存，或明确说明未保存和阻塞原因；不要承诺下轮仍能接续该草稿。

`program` 更新使用完整命名语句作为 patch。`resourcePatch.put` 只包含新增或替换的资源；`resourcePatch.remove` 显式删除资源，未提及的资源继承。删除资源和移除其所有页面引用可在同次调用完成。

## 按缺口读取

- 已知正式版本：`marivo_ui_read({recordId})`。
- 需要该报告当前正式版本：`marivo_ui_read({recordId, current:true})`。
- 缺少当前 Turn 草稿或最新 revision：`marivo_ui_read({draft:true})`。

结果的 `definitionJson` 包含 program、全部资源声明及必要 schema/coverage，不返回业务行或组件签名；组件签名按需读取[生成的组件签名](analysis-catalog.md)。草稿结果提供 `draftId/draftRevision`、surface 和可用的 `basedOnRecordId`，不把草稿当作已保存的 record。

需要核对来源脚本或用户已授权更新数据时，加 `includeCode:true`。资源返回绑定的 `codeRef`，顶层 `sources` 按执行记录去重，包含 `status` 和可用的 `code.text`、`code.datasources`、`code.resultVariables`；`unavailable` 明确表示记录不可读，不以新查询补齐。缺少 codeRef 的资源不出现在 sources 中。读取不会执行脚本。更新步骤见[只更新报告数据](data-update.md)。

## 冲突与失效

`analysis-draft-busy`：等待正在执行的调用结束，再读取草稿核对，不能并发重试。`analysis-draft-conflict`：读取最新草稿，审阅并调整本次改动后使用新的标识，不能只换 revision 盲目重放旧 patch。

`report-save-conflict` 返回 `currentRecordId`。先读当前正式版本和 `{draft:true}`，审阅并保留其他已确认修改。使用 `stage:"preview"`、最新草稿标识和 `rebaseOnRecordId` 显式合并，只接受同一报告当前版本，不自动覆盖。

- 数据刷新：核对待替换组件在当前正式版本中的身份、配置和口径仍匹配，只用 `resourcePatch.put` 合并兼容的同名新引用，省略 program/title/locale/labels；不重放旧草稿的布局。组件或数据发生无法判断的冲突时说明阻塞。
- 明确的页面编辑：提交相对当前正式版本的累计 program patch、resourcePatch 及明确要保留的标题/语言/标签变更。普通结果直接 save 没有草稿时，以审阅后的当前版本为 basedOnRecordId 提交调整后的变更。

rebase 成功后仍须核对并 save。只换基版本或 revision 不等于解决冲突，不为了合并重跑已经完成的组件计算。

失败保留最后一次成功草稿仅限当前 Turn。`analysis-draft-unavailable` 时，从已保存版本、保留的 program 和已有持久资源声明重建预览；缺少这些内容时说明缺口，不为补预览重跑查询。数据刷新重建时仍保留正式版本程序。图片及同声明快照可复用保存版本或当前草稿内嵌的内容，不要求原捕获文件仍存在。

Native streaming 画面是尚未校验的候选，不能从画面推断新的 draftRevision 或保存成功；只使用成功回执中的标识继续。失败或取消后保留最后成功草稿，候选不进入版本历史。PTC 以实际工具 dispatch 为更新边界。

携带 draftId 或 draftRevision 时省略 stage 返回 `analysis-draft-stage-required`，草稿与正式历史保持不变。明确选择 preview 继续或 save 完成，并使用最新成功修订；不要靠默认值保存。
