# 展示交付模块

## 责任与入口

`marivo_present` 将已有结果保存为不可变的分析 UI 版本（`dsh.analysis-ui/v1`），默认在会话级 Chat 节点呈现，
显式报告/dashboard 使用右侧 tab。Marivo 拥有分析、Artifact/Finding 与来源事实；Harness 拥有 Session/Turn、
Workspace 成员关系和事件存储；插件拥有快照读取、文件完整提交、receipt、交付事件与报告目录。

实现位于 `src/presentation/{tool,analysis,reports,commit,files,receipt,delivery,rpc}.ts`，生产接线在 `plugin.ts`、
`bridges.ts` 和 `client.tsx`。快照来源见[展示投影](presentation-projection.md)，阅读呈现见[共享 reader](presentation-reader.md)，
自定义报告和看板的编写指导见[展示 Skill](presentation-skill.md)。

## 统一分析 UI 写入与增量契约

`marivo_present` 的工具输入见 [tool.ts](../../../packages/dsh-data-analysis/src/presentation/tool.ts)。直接交付时，`stage` 默认 `save`，并使用 `surface`、`basedOnRecordId`、`resources`、`labels`、`title`、`program` 和 `locale` 构造正式版本。

- 创建自定义页面时提供完整 OpenUI Lang。只有一个资源时可省略 `program`，Frame、DataFrame 和图片分别使用 `AnalysisFrameView`、`DatasetView` 和 `Image`。
- 不接收 rows、`draft_path` 或旧的 `report_id`／`expected_build_id` 更新参数。
- `surface` 默认 `tool`；成功保存后结果由会话级 Chat 节点呈现，保持在 Harness 工作步骤折叠区之外。`tab` 用于明确要求的报告/dashboard。
- 成功只表示保存，headless 回执不声称已打开 UI。Native 使用真实参数前缀形成生成期候选；PTC 按实际 dispatch 粒度交付。
  字段顺序仅是建议，surface 晚到时保存后打开，不回补生成期预览。

资源声明支持三类：

| kind | 字段 | 读取 |
| --- | --- | --- |
| `dataset-snapshot` | `snapshotRef` | 先校验 Host execution provenance，再读取 `capture_dataset` 签发的快照 |
| `frame-snapshot` | `snapshotRef` | 先校验 Host execution provenance，再读取 `capture_frame` 签发的快照 |
| `image-file` | Workspace 相对 `path` | 只读取所属 Workspace 的普通 PNG/JPEG/GIF/WebP 文件，内嵌为 data URL |

`labels` 按资源名、快照列 ID 映射到显示名称，例如 `{"result":{"amount":"金额"}}`。标签只影响显示，列 ID、排序、单位与精确值保持原义。更新时复用的快照沿用已保存的标签。指定某个资源的映射会替换该资源整组标签，未列出的列显示其 ID，空映射将该资源所有列重置为 ID。

组件不读取任意 URL。错误资源、取消或必要读取失败都不发布 current。`frame-snapshot` 声明的 `snapshotRef` 由 `capture_frame` 签发，
与 `dataset-snapshot` 一样绑定 codeRef、Session 与 call。保存前分别用 `resolveFrameView` 和 `resolveDatasetView` 校验 Frame 与 Dataset 数据视图：
metric 要求完整的单行快照，table 的 `columns` 必须是快照中的唯一列，图形 encoding 只引用公开值名与轴名；
Dataset 图表编码引用列 ID，要求完整快照、数值列和唯一坐标组合；不推断分析语义。
不满足时返回带语句路径的结构化错误（如 `analysis-view-role-missing`），不保存。

program、Catalog id/build、资源声明、实际快照和来源绑定全部保存在 Build 的 `presentation.json` 内。
recordId 为 `marivo-ui:<reportId>:<buildId>`，由 receipt 返回并指向不可变版本；关闭原连接或删除捕获文件后仍可读取。

更新读取准确的 `basedOnRecordId`，用固定 `mergeStatements` 合并完整命名语句，再校验完整程序与资源计划
（[analysis-program.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/analysis-program.ts)）。

- 同一 patch 的语句名不可重复；新增或替换的语句合并后必须仍可从 root 到达，否则明确拒绝，避免被上游垃圾回收静默丢弃。
  `name = null` 删除语句，需先改写父引用。
- 省略 program 保留基版本布局，省略 title/locale 继承；省略 resources 继承，提供则替换完整资源表。
  同名同声明复制基版本已保存字节，只有新资源执行读取。
- 纯展示更新只核验 Workspace，不获取 Runtime、不启动 Python；原数据源或捕获文件不存在仍可更新。
- 新版本独立内嵌全部资源，以基版本 buildId 执行条件保存；冲突不自动重试，失败不改 current。

`marivo_ui_read({recordId})` 只读取准确已发布版本的 title、locale、Catalog、program 及资源的必要 schema 与范围，
不返回 rows、不查询实时数据、不执行 Python；只在基版本上下文缺失时按需使用，不默认回读。

候选以 Session/Turn/call、Workspace 和连接 generation 归属。tab 使用临时页，成功后原位改为准确 Build 地址；
tool 结果在会话节点中读取准确 Build，工具调用内只保留简短入口。关闭的候选不被片段或成功事件重新打开；
历史加载不触发自动导航。取消或失败时基版本保持可读，新建标明未保存。

已保存版本可在报告 tab 中下载离线 HTML；对象存储发布与 Reader 内编辑不受支持，见[报告 HTML 导出](report-publishing.md)。

## 报告草稿与正式保存

- `stage: "preview"` 为当前 Harness Session/Turn 创建一个内存草稿。可指定 `basedOnRecordId` 以现有正式版本为基准。调用使用与保存相同的资源、视图和预算校验，返回 `draftId` 与 `draftRevision`。
- 后续 preview 必须携带最新草稿标识，命名语句合并到上一次预览的程序。提供 `resources` 时仍替换完整映射。错误或并发冲突保留最后一次成功的草稿。草稿不写 Workspace 文件、报告目录或历史，Turn 结束后释放。
- Native 和 PTC 的预览通知只携带草稿身份。浏览器通过 Session 绑定的 `draft/read` 读取确切的预览数据，在同一个报告草稿标签页中更新内容。
- `stage: "save"` 携带最新草稿标识后，以最初正式基版本为条件保存一个新版本。若正式基版本已变化，保存失败并保留当前草稿。成功后，草稿 tab 原位切换到正式报告。

## 单次调用与文件身份

1. 从 Harness `workspaceRegistry` 的 `sessionIds` 取得唯一当前 Workspace，保存过程不初始化 Runtime。
2. 更新时先解析 `basedOnRecordId` 并读取目标 Report 的准确版本。
3. 新建时生成 report ID，更新时沿用；每次生成新 build ID 并构建完整 JSON 字节。
4. 在同一 Workspace 的新临时目录写入 JSON 并同步，检查归属和目录身份后以一次 rename 提交。
5. 重读校验完整 JSON 文件，再在跨进程锁内发布 current 指针并返回 receipt。指针生效前失败不破坏已有构建。

```text
<workspace>/.dsh-data-analysis/presentations/<reportId>/builds/<buildId>/presentation.json
```

receipt 保存 Workspace/report/build 身份、标题、摘要及已保存 JSON 的精确路径、SHA-256 和字节数。
`presentations/<reportId>/current.json` 使用 schemaVersion 4，保存当前 receipt 及按发布顺序排列的版本记录；
每项必须包含有效 publishedAt、Agent Session 和 surface，不包含旧历史缺失标记。
current v2/v3 均不再接受，包含此前新格式报告的旧指针；不自动迁移或修改磁盘文件。

磁盘上已有的旧格式报告（Presentation Document v3 及更早）不删除、不迁移；报告目录不再列出它们，
打开旧报告地址时显示“不支持的报告”错误。需要相同内容时从实际结果重新 present。

## Native、PTC 与 headless

`PresentationDelivery` envelope 使用 `kind: "marivo.presentation.delivery"`、`schemaVersion: 2`、
`dshSessionId`、`turn`、必填 `surface` 与同一个 `PresentationReceipt`；缺少 surface 的历史事件拒绝读取。
Native 使用 Tool metadata；Code 子调用通过 Harness `tools/ptc-dispatch-log` 写入同一种 durable envelope，
即使代码丢弃返回值也保留交付。新版写入 `tool/ptc-dispatch`，只读取该事件名称；旧 `tool/code-dispatch` 及嵌套 `tool-result` 包装不再接受。

客户端要求 Native receipt 对应同一 Turn 的实际 `marivo_present` call，Code 对应同一 Turn 的 root call；
再核对当前 Session，按 Session/Turn/Workspace/build 去重，不解析模型正文。模型可见文本包含标题、摘要、recordId、buildId 和 surface，不披露 Workspace 路径或摘要。
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
| `code/read` | `{ sessionId \| workspaceId, receipt, codeRef }` | 读取固定文档资源绑定的执行记录 |
| `point/prepare` | `{ sessionId, workspaceId, recordId, resourceName, row, field }` | 重读固定 Build，生成可用于草稿的 Frame 数据点引用 |
| `point/serialize` | `{ envelope }` | 以引用中的 Harness Session 重验 Workspace、固定 Build、原始值、轴键、presence 和角色，从已保存快照向模型返回点上下文及 Marivo Frame 身份 |
| `dataset/prepare`、`dataset/serialize` | 请求或 `{ envelope }` | 准备并重验 Dataset 资源或单元格引用，返回有界快照上下文 |
| `component/prepare`、`component/serialize` | 组件配置请求或 `{ envelope }` | 核对固定 Build 的组件配置及资源摘要，返回有界的视图、数据和语义上下文 |

`reports/resolve` 和 `files/read` 的 `sessionId` 与 `workspaceId` 必须恰好提供一个；`point/prepare` 同时要求二者，并通过 Session 核验 Workspace。不接受客户端路径。服务端从 Harness Workspace 成员关系推导路径，
拒绝符号链接、非普通文件、越界、超预算、身份变化和 digest 不符，并在返回前再次核对 Workspace。

`marivo_present` 的外层执行预算为 180 秒，不启动 Frame 读取子进程，由
[execution-policy.ts](../../../packages/dsh-data-analysis/src/presentation/execution-policy.ts) 定义；
超时或取消不创建本次 Build、不更新 current／历史，也不返回成功 receipt。超时诊断见
[展示投影](presentation-projection.md#数据流程)。外层取消覆盖完整操作，180 秒不是保证完成的时限。

current 更新由直接 peer `@deepseek-ai/dsh-atomic-write` 的 `withFileLock` 串行化。锁内重新比较基版本 buildId，
不一致返回 `report-save-conflict`。指针通过临时文件写入、文件同步、rename、目录同步提交；rename 是保存生效点。
冲突或指针提交前失败保留旧构建，完整但未发布的构建不自动清理。锁等待 5 秒后明确失败，不移除未知所有者的锁。

客户端验证文件身份、大小和 SHA-256 后才渲染。SHA-256 使用随客户端打包的 `@noble/hashes`，
不依赖安全上下文的 `crypto.subtle`，内网 HTTP／代理访问执行相同校验。关闭、Workspace 失效或连接重置取消旧请求，
迟到响应不能恢复旧内容。

## Workspace 报告列表与历史查看

默认 client 从 Workspace 会话头部的「报告」入口打开当前 Workspace 的原生目录 Tab。列表按 Report ID 去重，
只显示「报告标题」「生成对话」「更新时间」三列；搜索框随输入筛选标题，列表按成功保存时间降序，
同时间以 Report ID 稳定排序。默认只列 surface 为 tab 的报告，另选“对话结果”查看 tool 内容；
发布历史中的 `source.surface` 只用于分类，不进入文档内容。列表只包含 `dsh.analysis-ui/v1` 记录，旧格式报告被隐藏。

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
