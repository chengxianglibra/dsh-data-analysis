# 展示交付模块

## 责任与入口

分析视图是右侧 Tab 中的整页分析结果，可包含一个或多个数据视图和说明。内部使用 `AnalysisDocument` 保存 OpenUI Lang program、元数据和资源。报告与看板是用户可要求的编排方式。`marivo_report_write` 预览草稿或保存不可变版本（`dsh.analysis-ui/v2`），Chat 保留打开入口。

Marivo 拥有分析、AnalysisFrame、Artifact 与来源事实。Harness 拥有 Session/Turn、Workspace 成员关系和事件存储。插件拥有快照读取、文件完整提交、receipt、交付事件与分析视图目录。

实现位于 `src/presentation/{tool,analysis,reports,commit,files,receipt,delivery,rpc}.ts`，生产接线在 `plugin.ts`、
`bridges.ts` 和 `client.tsx`。快照来源见[展示投影](presentation-projection.md)，阅读呈现见[共享 reader](presentation-reader.md)，
触发、编排与最终回复规则见[展示 Skill](presentation-skill.md)。

## 分析视图写入与增量契约

`marivo_report_write` 的工具输入见 [tool.ts](../../../packages/dsh-data-analysis/src/presentation/tool.ts)。每次必须显式提供 `stage:"preview" | "save"`；省略时在访问 Workspace 前拒绝。新建分析视图省略 `ref`，编辑已有视图传准确 saved ref，续接草稿传最新 draft ref。`mode` 首次缺省为 edit；refresh-data 必须从 saved ref 开始。草稿继承首次模式，不允许后续切换。`onto` 只允许与 preview、draft ref 以及审阅后的当前 saved ref 一起使用。模型不再传内部 recordId、draftId 或 revision。

分析视图工作流要求显式选择 stage：数据准备前尽早 preview，固定结果就绪后及时更新同一草稿，不等全部计算完成，最终 save 一次；相同固定结果可以供多个视图复用。计算按 Harness 能力、依赖和资源预算安排，同一草稿的 preview/save 串行执行。初始程序可只有标题、范围和问题文字，省略 resourcePatch。该工作流由 Prompt/Skill/工具说明引导，工具仍支持普通单结果直接保存，不把文案规则声明为服务端强约束。

`resourcePatch.put` 按资源名新增或替换声明，`resourcePatch.remove` 显式删除；未提及的资源继承基版本。省略 patch 或提供空 patch 不删除资源；同名 put/remove、重复删除、删除不存在的资源均拒绝。程序和资源变更按最终文档一起校验，失败保留最后成功草稿。旧调用参数 `resources` 不再接受；已保存 Build 内的 resources 保留原义。

- 创建自定义页面时提供完整 OpenUI Lang。只有一个资源时可省略 `program`，Frame、DataFrame 和图片分别使用 `AnalysisFrameView`、`DatasetView` 和 `Image`。
- 不接收 rows、`draft_path` 或旧的 `report_id`／`expected_build_id` 更新参数。
- Tool 不公开 `surface` 输入；新生成的分析视图正文固定在右侧 Tab。v2 回执与历史仍保留必填 surface 供旧记录解析，新调用固定写入 `tool`，不表示原生 tool view，也不记录读者的导航操作。
- 成功回执表示对应的草稿更新或正式保存完成，不证明浏览器已打开或渲染；调用不等待浏览器检查或用户确认。Native 使用真实参数前缀形成生成期候选；PTC 按实际 dispatch 粒度交付。
  Native 候选不依赖字段顺序。ref/onto 已完整且有效，或整个参数对象关闭并证明相应字段省略后，才允许应用 program、resourcePatch、title 和 locale；身份未决时保持最后成功内容。

资源声明如下：

| kind | 字段 | 读取 |
| --- | --- | --- |
| `dataframe` | Marivo `DataFrameReference.to_dict()` | 核验当前 Workspace 后，在 checked Python 中读取固定结果 |
| `dataset-snapshot` | `snapshotRef` | 先校验 Host execution provenance，再读取旧捕获链路签发的快照 |
| `analysis-frame` | Marivo `FrameReference.to_dict()` | 在当前 Workspace 的 checked Python 中恢复固定身份并读取；不计算、不使用 HTTP |
| `frame-snapshot` | `snapshotRef` | 先校验 Host execution provenance，再读取旧 Frame 捕获快照 |
| `image-file` | Workspace 相对 `path` | 只读取所属 Workspace 的普通 PNG/JPEG/GIF/WebP 文件，内嵌为 data URL |

`labels` 按资源名、快照列 ID 映射到显示名称，例如 `{"result":{"amount":"金额"}}`。标签只影响显示，列 ID、排序、单位与精确值保持原义。更新时复用的快照沿用已保存的标签。指定某个资源的映射会替换该资源整组标签，未列出的列显示其 ID，空映射将该资源所有列重置为 ID。

新 Frame/DataFrame 资源声明可带 `codeRef:{executionId,sha256}`，来自返回该引用的成功 `marivo_python` 调用。Host 核验 Workspace、记录摘要及登记的完整结果引用，再保存 binding，UI 通过既有 `code/read` 读取脚本。无关、失效或没有结果登记的记录拒绝关联；不从 Marivo 引用推断执行来源。省略 codeRef 的既有外部结果仍可展示并明确缺少脚本。

数据更新使用 `mode:"refresh-data"` 和准确 saved ref；可先 preview 再计算，也可直接保存已准备好的结果。服务端在读取新资源前禁止 program/title/locale/labels、任何 remove 及新增资源名。原页面程序、正文、标题、语言和同 ID 列的显示标签保留；所有受影响视图及完整文档必须通过校验。比较新旧解析后的图形类型，auto 换图明确拒绝；数据条数变化导致的内部几何变化不等同于页面修改。

每次 preview/save 整批原子准入：任一资源读取、视图或完整文档失败，均保留最后成功 revision、document、current 和 history；临时资源流不能成为成功草稿。调用者可显式提交已就绪子集，未提交项保持旧数据，不能自动剔除已失败资源。结果中的 changed/reused 区分真正替换与复用；同一固定引用即使更换来源记录也不冒充新计算，同路径图片继续复用。reader 的 reuseGroups 按准确固定引用分组，不按 codeRef 或相同值推断；writer 的 unchangedAliases 提示仍保留旧数据的共享别名，不自动扩大更新范围。

视图配置失败保持 Harness 工具失败状态。错误消息末尾的 `error=` 后是完整 JSON 对象，含 `code`、`phase`、`path`、可确定的 `resource` 及 `recovery.applied:false`。已有基准时提供 `recovery.currentRef`。可定位到名称参数时附 `received`（若已填写）、`expectedKind` 和最多 8 个 `candidates`。错误内的 `resultMetadata` 与成功回执使用同一结构。当前 Harness 的工具异常接缝只传递消息和标准错误标识，Native 与 PTC 均从错误消息读取该 JSON。

候选按参数约束生成，例如 line/area 的 Frame 轴、排除已选轴的系列、可绘图的数值和未占用的表格列。候选解决指定参数，配置中的其他问题仍会独立校验。语法、身份、Runtime 与存储失败走各自原有错误路径。修复配置后沿用固定资源及成功基准，草稿上下文缺失或冲突时通过 `marivo_report_read` 恢复。

比较或分解目标存在歧义时，候选值名对应 `view/encoding/value`。筛选字段种类不匹配时，路径指向 `field/kind`，`expectedKind` 为 `field-kind`，候选为 `axis` 或 `column`；种类正确后再校验 `field/name`。

新 Build 将 contentReview 持久写入 `presentation.json`：已有资源真正替换且存在非空 TextContent、TextCallout 的 title/description 或 AccordionItem 的 trigger 时为 required，无静态正文时为 not-needed。旧 v1 未记录状态，读取解释为 unknown；普通 edit 继承 required，不把模型声明当成已复核证明。提示显示在报告正文之外，当前/历史重开及离线 HTML 均使用对应 Build 的事实。

组件不读取任意 URL。错误资源、取消或必要读取失败都不发布 current。新资源使用 `analysis-frame` / `dataframe` 和 Marivo 固定引用；历史 snapshot 声明保留原 Host provenance，
与 `dataset-snapshot` 一样绑定 codeRef、Session 与 call。保存前分别用 `resolveFrameView` 和 `resolveDatasetView` 校验 Frame 与 Dataset 数据视图：
metric 要求完整单行快照，table 的 `columns` 使用互异的快照列 ID。Frame 图表 encoding 使用公开轴名和值名，Dataset 图表 encoding 使用列 ID，要求完整快照、数值列和唯一坐标组合。

`SnapshotFilter` 须为可达的具名声明，数据视图通过 `filters` 显式绑定同一快照。完整文档准入校验字段、候选默认值、唯一 ID、消费关系与支持的原始视图；刷新后默认成员消失或视图不再受支持时拒绝新版本，保留最后成功的草稿和正式版本。筛选选择只属于阅读状态，不进入更新请求或保存数据。

program、Catalog id/build、资源声明、实际快照和来源绑定全部保存在 Build 的 `presentation.json` 内。
模型使用 [report-ref.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/report-ref.ts) 编码的版本化 ReportRef（上限 4096 字符），不构造或拆分。`report-ref-invalid` 提示复用成功回执；明确需要恢复当前 Turn 草稿时可通过 `marivo_report_read({draft:true})` 取回上下文并确认目标，不自动纠正引用或选择最新版本。saved ref 只有稳定 Workspace/report/build 定位，不含 Turn、进程 token 或连接 generation，可跨 Session/Host 重启读取；每次仍重新核验当前 Workspace 权限与磁盘边界。draft ref 另绑定 Session/Turn/草稿/revision，仅在原进程与活动 Turn 有效。内部 `marivo-ui:<reportId>:<buildId>` 仅供 receipt、RPC 和存储定位。

新保存使用严格 `dsh.analysis-ui/v2`，required/not-needed/unknown 为必填 contentReview；reader 支持读取严格 v1，缺失复核状态不推定已复核。v1 可作为新版本的基础，保存新版本使用 v2；旧 Build 文件不迁移或改写。

更新读取准确 saved ref，用固定 `mergeStatements` 合并完整命名语句，再校验完整程序与资源计划
（[analysis-program.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/analysis-program.ts)）。

- 同一 patch 的语句名不可重复；新增或替换的语句合并后必须仍可从 root 到达，否则明确拒绝，避免被上游垃圾回收静默丢弃。
  `name = null` 删除语句，需先改写父引用。
- 省略 program 保留基版本布局，省略 title/locale 继承；resourcePatch 只改变显式列出的资源。
  同名同声明复制基版本已保存字节，只有新资源执行读取。
- 纯展示更新只核验 Workspace，不获取 Runtime、不启动 Python；原数据源或捕获文件不存在仍可更新。
- 新版本独立内嵌全部资源，以基版本 buildId 执行条件保存；冲突不自动重试，失败不改 current。

`marivo_report_read({ref,version?:"exact"|"current",includeCode?})` 读取准确版本（默认 exact），current 只用于 saved ref；`{draft:true,includeCode?}` 恢复当前 Session/Turn 草稿，两类输入互斥。读取结果为结构化 definition，包含实际读取到的 ref、contentReview、reuseGroups、title、locale、Catalog、program、完整资源声明及有界 schema/coverage；不返回业务行。草稿还返回 mode 及可用的 basedOn saved ref。

definition 和 sources 使用具体本地 schema 逐项校验；当前 Harness 只支持 boolean additionalProperties，无法在 PTC 中为动态 resources/resultMetadata 名称映射推导 entry 类型。Tool schema 明确披露顶层字段及来源结构，并用准确 description 标明 map entry 的列、coverage 和 Frame 元数据约束，不宣称 Host 已提供 typed map。

includeCode 按 codeRef 去重返回 definition.sources，逐项标明 available 的 code.text、datasources、resultVariables，或 unavailable。未绑定来源的资源没有来源项。记录的空 datasource 数组只代表执行未声明 Marivo datasource，旧记录缺失时保持未知。读取核验当前 Workspace 的 Host 文件，不执行代码或业务查询；源码未内嵌报告，记录丢失不阻止读取固定快照。组件签名按展示 Skill 的生成 Catalog 参考取得，不例行回读成功保存。
报告视图以 Session/Turn/首次 call 建立稳定身份，草稿后续调用通过 draftId 关联；Workspace 路径与连接 generation 共同限定读写归属。真实 Turn 的 Chat 节点保留轻量分析视图入口，正文仅在右侧 Tab 展示；原生 tool view 保留错误说明或已保存视图入口。[下一步推荐](analysis-next-steps.md)位于 Chat 回合尾部。

首次 Native 参数候选、已校验草稿修订和最终 Build 由同一报告视图更新。前台会话首次出现可展示候选时自动打开并选中原生 Tab；此操作会展开侧栏并切换当前 Tab。用户关闭或切换 Tab 后，后续更新不再次打开或抢焦点；可从 Chat 入口手动重开。草稿保存后同一 Tab 展示准确 Build。
同一 Turn 的新建请求在产生成功草稿前被拒绝时，后续独立尝试可复用失败的临时入口和 Tab。已接受草稿继续按 draftId 关联。

Tab 与报告视图身份由客户端和原生地址管理，不写入报告内容、草稿、receipt 或 Workspace 文件。为避免抢焦点，非活动的 live Tab 在用户再次选中时才转换为准确 Build 地址；转换前刷新依赖会话投影重建，若历史不完整而无法确定身份，需从 Chat 的已保存入口或分析视图目录重开。历史回放与后台会话不自动打开 Tab；已保存报告按准确 Build 地址读取，草稿不承诺跨 Host 重启恢复，失效时明确提示。分析视图目录、历史和工具结果入口打开右侧 Tab。失败保留最后成功文档；Workspace 失效或连接重置撤销旧归属，迟到读取不能恢复它。

已保存版本可在分析视图 Tab 中下载离线 HTML；对象存储发布与 Reader 内编辑不受支持，见[分析视图 HTML 导出](report-publishing.md)。

## 分析视图草稿与正式保存

- `stage: "preview"` 为当前 Harness Session/Turn 创建一个内存草稿。可指定 saved ref 以现有正式版本为基准。调用使用与保存相同的资源、视图和预算校验，Native 与 Code Mode 原始结果均直接返回 `stage` 和准确 draft ref。
- 后续 preview 必须携带最新草稿标识，命名语句合并到上一次预览的程序，resourcePatch 只更新指定资源。错误或并发冲突保留最后一次成功的草稿。草稿不写 Workspace 文件、分析视图目录或历史，Turn 结束后释放。
- Native 和 PTC 的预览通知携带草稿身份与 surface。浏览器通过 Session 绑定的 `draft/read` 读取确切修订；Chat 入口与右侧 Tab 引用同一报告状态，后续 preview 更新同一处内容，不逐次追加结果卡片。
- `stage: "save"` 携带最新草稿标识后，以最初正式基版本为条件保存一个新版本；同次可携带最后一批 program、resourcePatch 或元数据修改。若正式基版本已变化，保存失败并保留当前草稿。成功后，当前阅读位置的草稿在正式文档读取完成后原位切换到正式结果；读取间隙继续显示已有内容，历史只增加本次保存的一个版本。
- save 原始结果直接返回 `stage` 和准确 saved ref，并含 mode/contentReview/changed/reused/unchangedAliases 及结构化 resultMetadata。Host-owned deliveryJson 保留可重放完整投递身份；当前 Harness 缺少 execute 返回模型 canonical value 之外的持久 metadata 接缝，不能声称该字段已移出模型。
- 草稿不跨 Turn 或 Host 重启保留。`analysis-draft-busy`、`analysis-draft-conflict`、`analysis-draft-unavailable` 的错误包含稳定 code、phase、recovery，message 携带同一 JSON，指导等待、核对最新草稿或从保留结果重建；不自动重放分析。
- Native 生成期间从 Harness `PartialArguments` 读取 OpenUI Lang 的 program 前缀，基于上一成功草稿合并为临时候选，持续更新同一视图。参数流期间不会启动新资源读取；已有草稿且 patch 范围尚未确定时保持基版本，不预测资源依赖；范围确定后交给 OpenUI 按语句更新。完整 patch 保留未变声明；替换项准备期间，前端继续显示该组件此前可读的快照和配置，删除项明确移除。完整工具调用进入执行后，Host 按声明去重，依次准备新资源以避免同 Session 恢复锁竞争；每个资源通过身份、来源和快照检查后即可发送给该调用的候选视图，不等待其他资源。客户端只用与调用、Workspace 和声明匹配的临时快照，组件仍按自身配置校验。资源流不产生 draftRevision、不保存；完整程序、资源关系和总预算仍须在预览或保存前校验。失败或取消保留最后成功草稿；尚无成功草稿时可保留客户端已显示候选，不将其视为正式结果。正常 Turn 结束不显示保存失败；PTC 按 Harness 实际 dispatch 粒度更新，不承诺代码字符串中的 token 流。未出现的 ref/onto 在参数对象关闭前属于未知状态，迟到或不完整的身份均不能触发独立 patch 预览；完整 standalone 对象仍可显示候选。
- 正式版本冲突返回 `recovery.currentRef`。Agent 读取当前正式版本和草稿、审阅差异后，可用 `stage: "preview"`、最新草稿标识、`onto` 和相对新基版本的累计 program 与 resourcePatch 显式合并；需要保留的 title/locale/labels 变更也须提交。只允许同一报告的当前版本，成功后仍需 save，保存时再次核对基版本。
- 数据刷新发生冲突时只合并与当前组件契约兼容的资源替换，保持已审阅当前正式版本的页面。省略 program/title/locale/labels，只传相对新基版本的资源增量；无法判断资源或业务冲突时明确阻塞。
- 合并优先复用新正式基版本中同名同声明的资源，其次复用原草稿中的对应资源，只有新声明读取来源。无效输入、陈旧版本及校验失败不替换草稿；合并不自动决定业务内容冲突。结束 Turn 后不能继续承诺草稿可保存。

## 永久删除分析视图

`marivo_report_delete({ref})` 接受当前 Workspace 内准确的 current saved ref；草稿和旧版本不能作为删除目标。客户端使用 `reports/delete` RPC 传入 Workspace、report ID 和预期 current Build。两者共用插件删除服务，在锁内重新核验归属与当前版本；版本冲突不删除。菜单删除需要用户确认，删除范围包括视图及全部历史版本。

保存与删除共用报告目录外的锁，覆盖 Build 写入、发布及删除。删除将报告移出正常目录后清理文件；正常读取和旧引用不再可用，已有草稿不能重新发布。若清理未完成，返回 `cleanupPending`，使用同一目标重试清理，不将其报告为磁盘文件已全部移除。删除不级联 Marivo 结果或数据源，也不能撤回已导出的离线 HTML。

## 单次调用与文件身份

1. 从 Harness `workspaceRegistry` 的 `sessionIds` 取得唯一当前 Workspace，保存过程不初始化 Runtime。
2. 更新时先解析 saved ref 并读取目标 Report 的准确版本。
3. 新建时生成 report ID，更新时沿用；每次生成新 build ID 并构建完整 JSON 字节。
4. 取得报告目录外的跨进程锁后，在同一 Workspace 的新临时目录写入 JSON 并同步，检查归属和目录身份后以一次 rename 提交。
5. 保持该锁，重读校验完整 JSON 文件后发布 current 指针并返回 receipt。指针生效前失败不破坏已有构建。

```text
<workspace>/.dsh-data-analysis/presentations/<reportId>/builds/<buildId>/presentation.json
```

receipt 保存 Workspace/report/build 身份、标题、摘要及已保存 JSON 的精确路径、SHA-256 和字节数。
`presentations/<reportId>/current.json` 使用 schemaVersion 4，保存当前 receipt 及按发布顺序排列的版本记录；
每项必须包含有效 publishedAt、Agent Session 和 surface，不包含旧历史缺失标记。
current v2/v3 均不再接受，包含此前新格式报告的旧指针；不自动迁移或修改磁盘文件。

磁盘上已有的旧格式报告（Presentation Document v3 及更早）不删除、不迁移；分析视图目录不再列出它们，
打开旧报告地址时显示“不支持的报告”错误。需要相同内容时从实际结果重新 present。

## Native、PTC 与 headless

`PresentationDelivery` envelope 使用 `kind: "marivo.presentation.delivery"`、`schemaVersion: 2`、
`dshSessionId`、`turn`、必填 `surface` 与同一个 `PresentationReceipt`；缺少 surface 的历史事件拒绝读取。
Native 使用 Tool metadata；Code 子调用通过 Harness `tools/ptc-dispatch-log` 写入同一种 durable envelope，
即使代码丢弃返回值也保留交付。新版写入 `tool/ptc-dispatch`，只读取该事件名称；旧 `tool/code-dispatch` 及嵌套 `tool-result` 包装不再接受。

客户端要求 Native receipt 对应同一 Turn 的实际 `marivo_report_write` call，Code 对应同一 Turn 的 root call；
再核对当前 Session，按 Session/Turn/Workspace/build 去重，不解析模型正文。模型可见文本包含标题、摘要、ref、模式、资源变化及正文复核状态，不披露 Workspace 路径或摘要。
结构化 durable envelope 保存完整 receipt，headless 通过该回执取得 JSON 产物。

## RPC 与当前指针

逻辑 channel 为 `/marivo-presentation`；通过 Connection 注册 `/api/marivo-presentation/<endpoint>` 精确 POST 路由，
复用 Harness 的浏览器认证及 Host/Origin 校验。

| Endpoint | 输入 | 作用 |
| --- | --- | --- |
| `reports/resolve` | `{ sessionId \| workspaceId, reportId }` | 校验 current、receipt 与固定文档的身份和摘要，返回当前 receipt |
| `files/read` | `{ sessionId \| workspaceId, receipt, asset }` | 读取 receipt 指定的固定 Build JSON |
| `reports/list` | `{ workspaceId }` | 枚举新格式 Report 的当前标题、摘要、保存时间和来源 |
| `reports/history` | `{ workspaceId, reportId }` | 返回已确认发布的版本记录和当前 Build 身份 |
| `report/refresh-prepare` | `{ sessionId, workspaceId, recordId }` | 核验会话 Workspace、固定文档及 current Build，返回准确 saved ref |
| `resource-stream/read` | `{ sessionId, workspaceId, turn, callId, after }` | 读取该次真实调用已准入的临时资源增量，不触发读取或生成正式版本 |
| `code/read` | `{ sessionId \| workspaceId, receipt, codeRef }` | 读取固定文档资源绑定的执行记录 |
| `point/prepare` | `{ sessionId, workspaceId, recordId, resourceName, row, field }` | 重读固定 Build，生成可用于草稿的 Frame 数据点引用 |
| `point/serialize` | `{ envelope }` | 以引用中的 Harness Session 重验 Workspace、固定 Build、原始值、轴键、presence 和角色，从已保存快照向模型返回点上下文及 Marivo Frame 身份 |
| `dataset/prepare`、`dataset/serialize` | 请求或 `{ envelope }` | 准备并重验 Dataset 资源或单元格引用，返回有界快照上下文 |
| `component/prepare`、`component/serialize` | 组件配置请求或 `{ envelope }` | 核对固定 Build 的组件配置及资源摘要，返回有界的视图、数据和语义上下文 |

`reports/resolve` 和 `files/read` 的 `sessionId` 与 `workspaceId` 必须恰好提供一个；`point/prepare` 同时要求二者，并通过 Session 核验 Workspace。不接受客户端路径。服务端从 Harness Workspace 成员关系推导路径，
拒绝符号链接、非普通文件、越界、超预算、身份变化和 digest 不符，并在返回前再次核对 Workspace。

`marivo_report_write` 的外层执行预算为 180 秒，包含新引用的 checked Python 读取，不重放生成脚本，由
[execution-policy.ts](../../../packages/dsh-data-analysis/src/presentation/execution-policy.ts) 定义；
超时或取消不发布本次 Build、不更新 current／历史，也不返回成功 receipt。超时诊断见
[展示投影](presentation-projection.md#数据流程)。外层取消覆盖完整操作，180 秒不是保证完成的时限。

current 更新由直接 peer `@deepseek-ai/dsh-atomic-write` 的 `withFileLock` 串行化。锁内重新比较基版本 buildId，
不一致返回 `report-save-conflict`。指针通过临时文件写入、文件同步、rename、目录同步提交；rename 是保存生效点。
冲突或指针提交前失败保留旧构建，并在目录及父目录身份仍匹配时尽力清理本次未发布的 Build；指针 rename 生效后不清理。历史数量或指针大小达到上限时返回 `report-history-full` 和可恢复建议，不自动裁剪历史。锁等待 5 秒后明确失败，不移除未知所有者的锁。

客户端验证文件身份、大小和 SHA-256 后才渲染。SHA-256 使用随客户端打包的 `@noble/hashes`，
不依赖安全上下文的 `crypto.subtle`，内网 HTTP／代理访问执行相同校验。关闭、Workspace 失效或连接重置取消旧请求，
迟到响应不能恢复旧内容。

## Workspace 分析视图目录与历史

默认 client 从 Workspace 会话头部的「分析视图」入口打开当前 Workspace 的原生目录 Tab。列表按 Report ID 去重，
只显示「分析视图标题」「生成对话」「更新时间」三列；搜索框随输入筛选标题，列表按成功保存时间降序，
同时间以 Report ID 稳定排序。统一列出所有已保存的分析视图，不按生成时的 surface 分类或过滤；
发布历史中的 `source.surface` 保留旧格式兼容，不决定当前阅读位置。列表包含支持的 `dsh.analysis-ui/v1` 和 v2 记录，旧格式报告被隐藏。

来源会话使用发布时记录的 Harness Session ID，通过 Host 当前会话列表解析标题和导航；不可用时明确披露，不猜测来源。
历史版本从报告正文的「历史版本」入口打开，版本切换读取精确 receipt，历史只读；返回当前版本显式重新 resolve。

版本记录包含 `receipt`、`publishedAt`、`source`（Agent 及可用的 Session ID 与 surface），按发布顺序存于 current，
与当前 receipt 在同一锁和原子 rename 中生效；Build 提交后冲突或发布前失败不增加历史。列表仅枚举 current，
不扫描 Build 目录拼凑历史，也不按文件时间伪造保存时间。

目录枚举上限 4096 项，超限明确报错；单个 current 上限 16 MiB、4096 个版本，超限保存明确失败并保留旧指针。
单个损坏或不安全的记录不阻塞其他列表项，但披露不可读数量。列表、历史和读取均不执行 Agent、Python、
Marivo 分析、数据源或凭据操作。

## 验证

```sh
npm run test:presentation-integration
npm run test:plugin-integration-delivery
npm run check
npm run build
npm run verify:plugin-package
```

确定性测试覆盖原子提交、取消、读取预算/路径/摘要、Workspace 变化、统一 receipt、事件去重与增量合并；
客户端测试通过未修改的 Harness 注册表和 assembler 验证交付节点归位与 ProducedFiles 共存。
真实 Native/PTC、右侧 tab 与模型路由验收需在隔离环境另行执行。
