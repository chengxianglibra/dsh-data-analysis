# 语义对象引用输入 MVP 设计

## 状态与结论

> 已实施并完成本机验收：2026-09-05。Host、Browser、热度、包集成及真实用户旅程见[验收记录](../acceptance/semantic-reference-input.md)。

本方案只修改 `dsh-data-analysis` 仓库，复用 DSH `0.1.1-rc.2` 已有的 `@` input-trigger 与
`ReferenceInsert` 管线，不要求修改 DeepSeek Harness 或 Marivo。用户在 DSH 输入框中输入 `@` 后，可以在
现有文件、文件夹和 Session 候选之外看到当前 Workspace 的 Marivo 语义对象；继续输入时按分层词法规则
异步筛选，选择后写入一个由输入状态机管理的原子引用。输入框显示明确的对象类型与 path，内部保存真实
`marivo.semantic_ref/v1`，提交时校验结构与 Workspace/Environment 归属，不能从显示名称反推对象身份。

候选使用 30 秒 TTL，到期后的下一次请求刷新。引用表达用户选择的对象身份，不锁定选择时的 Catalog 定义；
Agent 执行时使用当前语义层。同一 ref 的定义变化后使用新定义，对象已删除或不满足分析要求时由 Marivo 明确
报错，Agent 报告当次分析失败，不自动替换对象。

第一版同时提供 Workspace 级“最近 7 个自然日选择热度”。空查询优先展示常用对象；有查询时，文本匹配
等级始终优先于热度，避免热门但不相关的对象压过精确匹配。

## 决策摘要

- 复用 `@`，注册名为 `marivo-semantic` 的独立 `InputTriggerSource`，与现有 reference source 并存。
- 候选只来自当前精确 Environment 中 `ms.load()` 返回的编译后 `SemanticCatalog`；插件不扫描模型文件，
  不维护第二套语义对象 registry。
- “可用”在本设计中只表示对象存在于最近一次成功加载的 Catalog 快照、可形成精确 ref；不表示 datasource 可连接、对象已经
  readiness-certified、查询一定成功或分析结论有效。
- 候选 ref 使用 Marivo 公共 `{schema, kind, path}` 结构；插件只增加 Session 与 Environment identity
  envelope，用于输入生命周期和归属校验，不携带 Catalog fingerprint。
- `selected` 和 `serialize` 不加载 Catalog、不校验当前 membership；Catalog 变化不阻断提交，领域验证由
  Agent 执行时通过 Marivo 完成，不要求一次提交的多个引用共享 Catalog 快照。
- 空查询最多返回 40 个候选：最近 7 个自然日常用对象最多 10 个，其余按稳定类型/path 顺序补齐且不重复。
- 非空查询最多返回 40 个候选：精确、前缀和包含匹配优先；严格结果不足 12 个时，才用字符相似度补齐。
- 热度只在相同匹配等级内参与排序；不使用 embedding，不推断业务同义词，不把相似度称为语义等价。
- 一次菜单点击或键盘选中记为一次选择；打开菜单、移动高亮、序列化重试和最终发送都不重复计数。
- 热度写入 DSH profile 的 `storageDomain`，不写 `marivo.toml`、`models/`、`.marivo/` 或 Session transcript。
- 第一版使用 DSH 现有通用原子 chip 外观。候选行显示对象类型，选中后的 label 显示完整 `kind:path`；不增加
  Marivo 专属图标或修改 DSH 的 `appearance` union。

## 目标与非目标

### 目标

1. 用户可以在普通分析问题的任意 inline 位置输入 `@` 打开候选菜单。
2. 候选按当前 Session 对应 Workspace 隔离，只列出该 Workspace 最近一次成功加载的 Catalog 快照中的对象。
3. 用户继续输入单词或 quoted 多词查询时，旧请求会被取消，菜单只接受当前 generation 的结果。
4. 大型 Catalog 下，空查询优先展示近期高频对象；搜索结果保持可预测、稳定且有界。
5. 选择结果在输入框内是原子引用，显示文字、剪贴板文字与模型序列化彼此分离。
6. Catalog 变化允许提交并在执行时解析；Session/Environment 归属校验失败则阻断提交，保留草稿和引用并显示
   现有 composer error。
7. 候选浏览和热度统计不进入模型 prompt，不改变 Marivo 语义、分析或 Evidence 状态。

### 非目标

- 新增 `#` trigger 或替换 DSH composer；
- 为 metric、dimension 等类型增加 DSH 专属图标、颜色或 React renderer；
- embedding、向量数据库、LLM rerank、跨语言业务同义词推断；
- 跨 Workspace 聚合热度，或在同一 DSH profile 内再划分多用户身份；
- 把粘贴的 `@metric:sales.revenue` 自动恢复为隐藏 ref occurrence；
- 自动激活 `marivo-analysis`、自动执行查询或自动判断用户分析意图；
- 计算 readiness、datasource health、freshness、Quality 或 Evidence 状态；
- 锁定选择时的 Catalog 版本、提交前重新加载 Catalog，或保证多个引用共享同一编译快照；
- 修改 Marivo Catalog、语义对象、ref schema、Help 或 Skill；
- 将候选选择记录写入 Session event log、Agent transcript 或 Marivo telemetry。

## 当前公共契约

本设计依赖以下当前公共能力：

- DSH [`InputTriggerSource`](../../../deepseek-harness/packages/client/ui-input-trigger/src/types.ts) 允许多个 source
  绑定同一个 `@`，并向每次候选请求提供 `sessionId`、`query`、`quoted` 与 `AbortSignal`；
- DSH candidate menu 保留 source 返回的 item 顺序，generation 与 abort 会丢弃过期异步结果；
- DSH `ReferenceInsert` 保存 `source`、opaque `ref`、`label` 和 `clipboardText`，输入状态机为每次插入建立独立
  occurrence；
- DSH `ReferenceCodec.serialize(ref, signal)` 在提交时展开模型文本，owner 缺失或序列化失败会阻断发送，保留
  草稿和 chip；
- DSH Web profile 已挂载 [`storageDomain`](../../../deepseek-harness/packages/storage/storage-domain/src/index.ts)，
  支持 schema-validated KV domain 和原子 `update()`；
- DSH Connection 提供 Host/Client 通用 RPC channel 与 `trusted-host` authority；
- Marivo [`Ref`](../../../marivo/marivo/refs.py) 的公共 JSON 形式为 `marivo.semantic_ref/v1`，identity 是精确
  `kind + path`；
- Marivo [`SemanticCatalog`](../../../marivo/marivo/semantic/catalog.py) 可按 `SemanticKind` 遍历
  `catalog.items(kind).items`，并用 `catalog.require(ref)` 验证当前精确成员。

`ReferenceCodec` 没有 Session 参数，因此 occurrence 的 opaque `ref` 必须携带选择时的 `sessionId`。这不是用
Session 代替语义身份；它只是让全局 source-owned codec 在提交时重新找到原 Workspace。真正的领域身份仍是
envelope 内的 Marivo ref。

## 用户体验

### 空查询

用户输入：

```text
请分析 @
```

菜单按以下结构返回，合计不超过 40 个对象：

```text
最近 7 天常用
  Metric · sales.revenue
  Time dimension · sales.orders.created_at

Entity
  sales.orders
  sales.customers

Metric
  sales.average_order_value
  ...
```

“最近 7 天常用”最多 10 个，并从后续类型 section 中去重。没有历史记录时直接从类型 section 开始。当前
Catalog 为空时，`marivo-semantic` source 返回空数组；现有文件与 Session 候选仍可正常工作。

### 单词与多词查询

普通 `@revenue` 查询持续到空白字符；需要空格时复用 DSH 已有 quoted grammar：

```text
@"monthly revenue"
```

非空查询不按类型分段，以保持全局相关度顺序；每一行显式显示 kind：

```text
Metric · sales.monthly_revenue
Metric · sales.revenue_growth
Measure · sales.orders.gross_revenue
```

严格匹配不足时，相似结果追加在“相近结果”section。相近结果只是输入检索补全，不声明业务对象相似、可替换
或可组合。

### 选择与编辑

选择 `metric:sales.revenue` 后，输入框显示：

```text
请分析 @metric:sales.revenue 最近三个月的变化
```

整个 `@metric:sales.revenue` 是一个 occurrence。显示 label 使用完整 `kind:path`，避免不同 kind 拥有相同 path
时产生视觉歧义。用户可以整体删除该引用；对 chip 内文字的普通编辑遵循现有 DSH 输入状态机，不由插件实现
第二套编辑行为。

复制/cut 的文字为：

```text
@metric:sales.revenue
```

第一版不把重新粘贴的普通文字升级为隐藏引用。用户需要重新从 `@` 菜单选择，才能恢复可验证 occurrence。

### Catalog 更新后的行为

候选是输入辅助，允许在 TTL 内继续展示旧快照中的对象；已经打开的菜单不主动刷新。TTL 到期后的下一次
候选请求加载新快照，新增、删除与描述变化随后反映到菜单中，无需后台轮询或文件监听。

已选 chip 的 label 与精确 ref 保持不变，不因 Catalog 更新失效或自动替换。提交不检查对象是否仍存在：
同一 ref 的定义改变时，分析使用执行时加载的新定义；对象已删除、重命名或不再满足操作要求时，Marivo
明确报错，Agent 报告当次分析失败。用户可以根据错误重新选择对象或调整问题。

## 所有权边界

| 参与方 | 第一版职责 | 明确不拥有 |
| --- | --- | --- |
| DSH | `@` 检测、候选菜单、键盘/IME、generation/abort、occurrence、undo、提交与 composer notice | Marivo 对象、筛选规则、热度数据含义 |
| `dsh-data-analysis` | Session/Workspace 路由、Catalog 投影、检索排序、热度 sidecar、RPC、ref envelope 与模型序列化 | Marivo ref/对象语义、readiness、分析执行 |
| Marivo | `SemanticKind`、`Ref`、执行时的 Catalog membership 与领域验证 | DSH 输入状态、候选热度、展示顺序 |
| 用户 | 输入查询、选择和删除引用 | 手工构造隐藏 ref |

热度是插件拥有的 UX sidecar，不是 Marivo 使用统计、业务热度或推荐权威。它不得进入 Artifact、Evidence、
Lineage、Quality 或分析结果，也不得影响 Agent 对问题的解释。

## 目标架构

```text
DSH composer
  |
  | @ + query + sessionId + AbortSignal
  v
marivo-semantic InputTriggerSource (browser)
  |
  | trusted Host RPC: semantic-references/candidates
  v
SemanticReferenceService (Host)
  |-- resolve exact live Agent and MarivoEnvironment
  |-- load/coalesce SemanticCatalog projection on cache miss or TTL expiry
  |-- project public refs and bounded descriptions
  |-- join Workspace-local 7-day usage sidecar
  `-- filter, rank, cap
  |
  v
InputTriggerCandidate[]
  |
  | onPick
  |-- immediate ReferenceInsert
  `-- best-effort semantic-references/selected RPC
  |
  v
DSH occurrence { source, opaque ref envelope, label, clipboardText }
  |
  | submit -> ReferenceCodec.serialize
  v
semantic-references/serialize RPC
  |-- resolve envelope Session and exact Environment
  |-- validate closed envelope shape and Environment ownership
  `-- return bounded model marker
  |
  v
ordinary DSH user prompt
  |
  | Agent executes analysis
  v
current ms.load() + exact ref factory + catalog.require(ref)
  `-- use current definition, or report analysis failure
```

Browser 不读取 Workspace 文件、不运行 Python，也不持有全量 Marivo IR。Host RPC response 不返回绝对路径、
Python executable、package path、credential、完整 Environment 内容或内部 IR。

## Host 投影与 ref envelope

### Marivo ref

插件从真实 Marivo `Ref` JSON serialization 接收以下公共结构：

```ts
interface MarivoSemanticRefV1 {
  readonly schema: 'marivo.semantic_ref/v1'
  readonly kind: string
  readonly path: string
}
```

`kind` 必须来自当前精确 Marivo Runtime 的 `SemanticKind` 遍历；插件不得维护独立 kind registry。Host adapter
同时返回 `ref.key`，并交叉检查它等于 `kind:path`。Browser 只转发 Host 投影的 ref，不从 query、label 或
clipboard text 拼接 ref。后续 RPC 的 closed parser 校验 wire shape、字段类型与长度，不复制 Marivo 的
kind/path 领域规则，也不把合法 JSON 当作当前 Catalog membership 或 Host 签发证明。

### 候选投影

```ts
interface SemanticReferenceCandidateV1 {
  readonly ref: MarivoSemanticRefV1
  readonly refKey: string
  readonly name: string
  readonly businessDefinition: string | null
}
```

只投影当前 Catalog entry 的公共 `ref`、`name` 与有界 `business_definition`。定义最多 240 个 Unicode code
points，截断只影响候选描述，不影响 ref。不得投影源代码位置、SQL、datasource credential ref、内部 IR、完整
details 或 Workspace 路径。

### occurrence envelope

选择时生成规范 JSON，再作为 `ReferenceInsert.ref` 的 opaque string 保存：

```ts
interface SemanticReferenceEnvelopeV1 {
  readonly schema: 'dsh-data-analysis-semantic-reference/v1'
  readonly sessionId: string
  readonly environmentFingerprint: string
  readonly ref: MarivoSemanticRefV1
}
```

规范 JSON 使用固定字段顺序和 UTF-8，不依赖 display label。`sessionId` 只用于提交时解析原 Session；
`environmentFingerprint` 用于比较当前绑定，防止引用在不同 Runtime/Workspace 归属下发送。Session 不可解析、
绑定已失败或 Environment identity 不匹配时拒绝序列化。Envelope 不保存 Catalog fingerprint，Catalog 定义
变化不要求用户重新选择；它既不承诺对象仍存在，也不锁定分析使用的定义版本。

## RPC 契约

插件在 DSH Connection 的独立 `/dsh-data-analysis` channel 下注册三个 endpoint，authority 为
`trusted-host`。所有请求使用 closed shape、长度上限和调用方 `AbortSignal`；不复用 `/api` fallback，不创建
浏览器直连 Python 的旁路。

### `semantic-references/candidates`

请求：

```ts
interface SemanticReferenceCandidatesRequestV1 {
  readonly version: 1
  readonly sessionId: string
  readonly query: string
  readonly quoted: boolean
  readonly limit: 40
}
```

约束：

- `query` 最多 128 个 Unicode code points；
- `limit` 第一版只能是 40，browser 不能自行放大；
- Host 必须按 `sessionId` 找到当前 live Agent 和它已绑定的 Environment；
- browser 不提供 Workspace path 或 Environment fingerprint；这些身份只能由 Host 解析；
- 请求取消只解除该请求对共享加载的等待，不影响其他有效 waiter；最后一个 waiter 离开时才终止未完成的
  Catalog subprocess，取消的请求不发布部分或过期结果。

响应包含 Environment fingerprint 和已经排好序的候选。browser 只映射为
`InputTriggerCandidate`，不二次筛选或重排。

### `semantic-references/selected`

请求携带完整 envelope。Host 校验 closed envelope/ref shape、Session 与当前 Environment 归属后，原子更新
该 Workspace 的热度记录。此调用不加载 Catalog，也不校验当前 membership；即使选中对象随后被删除，仍可
记录这次选择，刷新后的候选只与新 Catalog 投影求交。它不返回新的 ref，不影响已经完成的 `ReferenceInsert`。

该调用由同步 `onPick()` 以 fire-and-observe 方式启动：选择立即落入输入框，持久化失败只记录有界 diagnostic，
不得撤销 chip、阻断输入或改写为其他 ref。下一次候选请求只使用 Host 已持久化的热度；browser 不维护第二套
计数，也不对 Host 响应二次排序。

### `semantic-references/serialize`

请求只携带 envelope。Host 必须：

1. 解析 exact v1 envelope 和 `marivo.semantic_ref/v1` 的 closed wire shape、字段类型与长度；
2. 通过 envelope `sessionId` 找到原 live Agent；
3. 确认当前绑定未失败，比较 Environment fingerprint，校验原 Workspace/Runtime 归属；
4. 成功后返回以下模型文本，字段顺序固定：

```text
<marivo-semantic-ref>{"schema":"marivo.semantic_ref/v1","kind":"metric","path":"sales.revenue"}</marivo-semantic-ref>
```

模型文本不包含 display label、热度、Session ID、Workspace/Python 路径、Environment fingerprint 或 Catalog
fingerprint。任何校验、取消或 transport 失败都使 codec reject；DSH 现有提交事务负责显示 error 并保留草稿和
所有 chip，不允许退化为 `clipboardText`。

该 marker 表达用户选择的精确 ref，不是 authorization、readiness 或可信证明。用户也可以手工输入相同文字，
因此 Agent 和后续 Marivo 操作仍必须以当前 `ms.load()`、exact ref factory 与 `catalog.require(ref)` 为准；不得因为
marker 形状看似结构化就跳过领域验证，也不得在 ref 不存在时做 fuzzy replacement。

`serialize` 不启动 Python、不调用 `ms.load()`、不校验当前 membership，也不读取候选缓存。即使 Catalog 已变化、
对象已删除或候选 reload 失败，归属与结构校验通过的引用仍可提交。多个 occurrence 独立序列化为稳定模型
marker，无需 batch identity 或提交级 singleflight；执行时的领域校验与错误处理由 Marivo 和 Agent 负责。

## Catalog 加载与缓存

候选检索按 Environment fingerprint 缓存一个不可变投影快照：

- 第一次 `@` 请求按需加载，不在每个 Session 创建时预热；
- snapshot TTL 为 30 秒；TTL 内只读同一不可变投影，避免每个键入字符重新运行 `ms.load()`；
- TTL 从成功发布快照时起算；到期后的第一个请求发起一次 reload，同 Environment 并发请求共享 singleflight；
  不设置后台刷新 timer，不监听模型文件，也不在 TTL 到期时主动更新已打开的菜单；
- 不使用 stale-while-revalidate：reload 失败时本次语义 source 失败，不返回上一快照冒充当前结果；
- Environment identity mismatch 使对应 cache 永久失效，沿用现有 `MarivoEnvironment` fail-closed 规则；
- Catalog drift 不触发提交错误或主动 cache invalidation，候选按 TTL 更新；`selected` 与 `serialize` 均不参与
  Catalog 加载与缓存；
- singleflight 使用独立的 load AbortController，并记录有效 waiter；单个 waiter 取消只结束自身请求，最后
  一个 waiter 离开才终止加载。已取消的 flight 立即从可共享入口移除，后来的请求创建新 flight；旧 flight
  的完成或清理不得发布快照，也不得清除新 flight；
- plugin dispose 停止新 RPC，取消全部 waiter 与 load，丢弃未进入 storage write chain 的选择工作；已入链
  的更新 drain 后再关闭 usage domain。

Catalog 加载和候选浏览遵循 zero-init：空 Workspace 可以得到空 Catalog，不能创建 `marivo.toml`、`models/`
或 `.marivo/`。

Python adapter 通过当前 Environment 的 checked runner 执行，显式传入
`ms.load(workspace_dir=environment.binding.projectRoot)`，并为整个子进程设置
`environmentOverlay: { MARIVO_TELEMETRY: 'off', PYTHONDONTWRITEBYTECODE: '1' }`。前者关闭加载、Catalog 遍历与
错误路径的 Marivo telemetry；后者避免导入模型时生成 `__pycache__`。不能依赖 doctor admission 的 overlay，
该设置不会自动传递到后续 checked run。`selected` 与 `serialize` 不运行 Catalog Python adapter，也不产生
Marivo telemetry。上述 overlay 仅用于本输入能力，不修改 Agent 正常分析的 telemetry 设置。

## 文本筛选与稳定排序

### 可搜索字段

每个对象构造以下非持久化 search document：

```text
ref.key
ref.path
entry.name
ref.kind
business_definition（若存在）
```

normalize 过程固定为 Unicode NFKC、locale-independent lowercase、首尾 trim，并把连续空白折叠为一个空格。
`.`、`:`、`_` 和 `-` 同时保留在完整字符串中并作为 token boundary 使用。原始内容仍用于显示。

### 匹配等级

非空 query 按以下互斥等级取第一个命中：

| 等级 | 规则 | 示例 |
| --- | --- | --- |
| 0 exact | query 等于规范化 name、path 或 ref key | `metric:sales.revenue` |
| 1 prefix | name、path、ref key 或任一 token 以 query 开头 | `rev` → `revenue` |
| 2 contains | query 的所有 token 都出现在 search document | `monthly revenue` |
| 3 fuzzy | 严格结果少于 12 时，通过有界字符 n-gram 相似度补齐 | `revnue` → `revenue` |

fuzzy 只对至少 3 个 Unicode code points 的 query 启用。使用 normalized character trigram Dice score；短于 3
个 code points 时只执行 exact/prefix/contains。每个候选取 name、path token 与完整 path 中的最高 score，
`business_definition` 只参与 contains，不参与 fuzzy，避免长描述制造噪声。第一版阈值为 `0.42`，低于阈值不展示。

这是一种字符相似度，不是 embedding 或业务语义相似度。中文查询如果出现在 `business_definition` 中，可以通过
contains 命中英文 ref；没有文字交集时第一版不会猜测同义关系。

### 排序键

非空 query 使用以下稳定排序键：

```text
matchTier ASC
relevanceScore DESC
selectedCount7d DESC
lastSelectedAt DESC
ref.key ASC
```

exact 的 `relevanceScore` 固定为 1；prefix 先比较 query/path 覆盖比例，再比较命中字段优先级；contains 比较命中
token 数和覆盖比例；fuzzy 使用 Dice score。热度永远不能跨越 `matchTier`。

空 query 使用：

```text
hasRecentUsage DESC
selectedCount7d DESC
lastSelectedAt DESC
kindDisplayOrder ASC
ref.key ASC
```

`kindDisplayOrder` 是插件展示策略，不是 Marivo 领域顺序。第一版只用当前 `SemanticKind` 枚举遍历顺序作为稳定
fallback，不复制每种对象的行为或有效性规则。

## 最近 7 天热度

### 统计口径

- 一次 `onPick` 产生一次选择；鼠标和 Enter 等价；
- 同一个 ref 在一条问题中被选择两次，计数两次；
- 高亮、菜单打开、候选加载、copy、serialize、发送、重试和 Agent 实际使用都不计数；
- 时间窗口是 Host 当前时区中“当天及之前 6 个自然日”；不是精确滚动 168 小时；
- `selectedCount7d` 是七个日桶计数之和，`lastSelectedAt` 是最后一次已持久化选择时间；
- 候选刷新后不再返回新快照中不存在的 ref；TTL 内允许旧候选，usage 本身不能重新引入被删除的对象。
  过期 usage 会在后续原子更新时清理。

### storageDomain

定义版本为 0 的 domain：

```text
name: dsh_data_analysis_semantic_reference_usage
table: workspaces
key: sha256(canonical project root)
```

每个 Workspace 一条完整记录：

```ts
interface SemanticReferenceUsageWorkspaceV0 {
  readonly entries: Record<string, {
    readonly ref: MarivoSemanticRefV1
    readonly days: readonly {
      readonly day: string       // Host local YYYY-MM-DD
      readonly count: number     // positive safe integer
    }[]                          // unique day, ascending, at most 7
    readonly lastSelectedAt: number
  }>
}
```

表 key 使用 canonical project root 的 SHA-256，不把绝对路径写入存储内容。entry key 是 `ref.key`。usage store
为每个 Workspace 维护一个进程内 mutation queue：缺少 row 时在该队列内 `put()` 第一份完整记录，已有 row 时通过
`KvTable.update()` 做原子 read-modify-write。更新会校验 ref wire shape、丢弃窗口外日桶、增加当天计数、更新时间，
并删除最后选择已早于窗口的其他 entries。计数溢出 safe integer 时保持上限，不 wrap。插件的所有写入都必须
经过这一入口，避免并发首次选择的 `put()` 覆盖另一笔更新。

DSH profile 是第一版的个性化边界；同一 profile 内不再区分用户。不同 Workspace 的 row 完全隔离，也不建立
全局热门榜。如果未来一个 profile 由多个用户共享，必须先使用 DSH-owned account identity 扩展 key，不能由
插件从路径、Session 内容或浏览器属性猜测用户。

Domain 打开或写入失败不影响 Marivo ref 正确性：候选使用零热度稳定排序，选择仍可插入。该降级只写有界 Host
diagnostic，不写 transcript，也不把 storage fault 伪装成 Catalog 或 ref 错误。Catalog/Environment/serialize
错误则不能用热度降级掩盖。

## Browser source

browser client 增加 `inputTriggers` 与 `connection` injection，并注册：

```ts
const source: InputTriggerSource = {
  trigger: '@',
  name: 'marivo-semantic',
  order: -20,
  candidates,
  onPick,
  codec,
}
```

`order: -20` 只让 Marivo group 在默认 order 0 的 reference group 之前出现；它不改变文件/Session group 内部
顺序。Catalog 为空时 source 返回零候选；当前 Session 没有 live Agent 或 Environment 不能绑定时 RPC 失败，
DSH 只移除该 source group，不抢占其他 `@` source。

候选映射：

- `name`：`<Kind display> · <path>`；
- `description`：有界 `business_definition`，不存在时省略；
- `icon`：短文本 kind glyph，由插件 locale 映射；不声称是 DSH reference appearance；
- `section`：空查询使用“最近 7 天常用”或 kind；非空严格结果使用“语义对象”，fuzzy 使用“相近结果”；
- `value`：规范 JSON candidate/envelope seed，`onPick` 必须 closed-parse，不能信任任意 menu value。

选择后的 `ReferenceInsert`：

```ts
{
  source: 'marivo-semantic',
  ref: canonicalEnvelopeJson,
  label: 'metric:sales.revenue',
  clipboardText: '@metric:sales.revenue'
}
```

不设置 `appearance`，因此使用 DSH 当前通用 chip 展示；不冒用 `file`、`folder` 或 `session` 图标。第一版也不
实现 `lexicon()`，避免把普通 `@name` 文本装饰误认为已验证 occurrence。

## 错误、安全与生命周期

### 候选阶段

- invalid request、unknown Session、无 live Agent、Environment failure、Catalog load failure 与 timeout 都不返回
  stale candidate；
- DSH 当前 input-trigger 对 source failure 的产品行为是移除该 group 并记录 browser console error，因此第一版
  不伪造一个可选择的“错误候选”；
- 其他 `@` source 独立完成，Marivo failure 不关闭文件/Session 候选；
- 空 Catalog 是成功的空结果，不是 failure；
- response 只返回有界 display metadata 和 opaque envelope seed。

候选失败缺少 composer 内可见提示是当前 DSH 管线限制。它不影响提交正确性；如果后续需要可见 source health，
应在 DSH 增加通用 pending/error group contract，不能由插件伪造普通候选。

### 选择与提交阶段

- `selected` RPC 失败不撤销已插入 ref，只使热度持久化降级；
- envelope parse、Session 或 Environment 归属校验任一失败都阻断提交；Catalog drift 与 missing ref 留到执行时处理；
- codec 只序列化 envelope 内的 ref，不读取 clipboard text，也不从 label 或 query 恢复 kind/path；
- browser 与模型正文都不接收 Workspace absolute path、Python path、credential 或内部 Catalog object；
- RPC body、query、candidate count、description 和错误正文都有固定上限；
- 日志只能包含 session ID、ref key、状态码和 digest，不记录用户整段问题或 business definition 全文；
- dispose 先停止新 RPC，再取消 subprocess/singleflight，drain 已进入 storageDomain write chain 的更新，最后关闭
  domain 和 browser source effect。

## 实现模块与依赖变化

建议新增独立模块，不把检索、热度或 RPC 塞进现有 Help/Datasource/Evidence bridge：

```text
packages/dsh-data-analysis/src/semantic-reference/
├── bridge.ts          # checked Marivo Catalog projection + TTL cache and shared load lifecycle
├── contracts.ts       # closed Host/browser DTO and canonical JSON
├── search.ts          # normalization, strict/fuzzy matching and ranking
├── usage.ts           # storageDomain spec and 7-day atomic updates
├── rpc.ts             # trusted-host endpoint registration
└── index.ts

packages/dsh-data-analysis/src/client/
└── semantic-reference-source.ts
```

当前单文件 `src/client.tsx` 可以先导入 browser source installer；不要在本 Slice 同时重构现有 Evidence 与
credential UI。实现时相应增加：

- Host inject 增加 `connection`、`storageDomain`，peer 增加 `@deepseek-ai/dsh-storage-domain`；现有
  `@deepseek-ai/dsh-client-connection` peer 继续提供 Host RPC；
- browser inject 增加 `inputTriggers`，peer 增加 `@deepseek-ai/dsh-client-ui-input-trigger`；
- `zod` 作为 storage-domain record schema 的直接依赖，不依赖 transitive package；
- package verification 的 peer、client bundle 与 installed-profile checks。

不新增 Agent Tool、Skill、Workspace 文件、Marivo Python package、报告 schema 或公开 npm subpath。

## 实施阶段

### Slice 1：Host Catalog 投影与搜索 core

- 新建 exact DTO parser、Python adapter 和 `SemanticReferenceBridge`；
- 遍历当前 Marivo `SemanticKind` 与 `SemanticCatalog.items(kind).items`，为 adapter 显式关闭 telemetry 和 bytecode 写入；
- 实现 30 秒 TTL、按需刷新与 waiter 取消隔离；
- 实现 NFKC normalize、四级匹配、稳定排序和 bounds；
- 用 fixture Catalog 覆盖重复 path/different kind、中文 definition、短 query、typo、截断和稳定 tie-break。

### Slice 2：热度 sidecar 与 Host RPC

- 定义/open/close storage domain；
- 实现 Workspace hash、七日日桶、原子并发 update、prune 和零热度降级；
- 注册 candidates、selected、serialize endpoint；
- 覆盖 Session/Workspace isolation、RPC authority、cancellation 与 error redaction；
- 证明 `selected` 和 `serialize` 仅校验结构与归属，不加载 Catalog，也不因 Catalog drift 或 missing ref 阻断提交。

### Slice 3：Browser `@` source 与原子引用

- 注册 locale、source、candidate mapping、onPick 与 codec；
- 保证 existing file/Session source 共存、source order、quoted query、generation drop 和 empty group；
- 覆盖真实 DSH InputMachine 的插入、删除、undo、多个同名 occurrence、copy 和 serialize failure notice；
- 证明 ordinary text 与 pasted clipboard text 不会升级成隐藏 ref。

### Slice 4：集成、文档与真实验收

- 更新 package peer/client inject、依赖检查与 package verifier；
- 实现后把稳定事实同步到 `docs/architecture.md` 与对应 `docs/modules/`；
- 增加 `test:semantic-reference-input` 并接入 `npm test`；
- 运行真实 DSH Web profile、正式 Marivo `0.5.3` 与大型 fixture Catalog 的 terminal journey；
- 未完成 profile reinstall/restart 或真实输入旅程时，不把文档状态改为已实施。

## 验收标准

### 确定性测试

- `@` 同时出现 Marivo 与现有 file/Session groups，Marivo source 不覆盖、不 shadow 原 source；
- query generation 变化取消旧 RPC，旧结果不能覆盖新结果；
- 同 Environment 的两个 Session 共享候选加载；一个请求取消不影响另一个，最后一个 waiter 取消才终止加载；
  取消后立即请求能启动新 flight，旧 flight 完成或清理不影响新结果；
- TTL 内复用快照，到期后的下一次请求刷新；空闲时不轮询，已打开菜单不主动刷新，reload 失败不返回过期快照；
- 空查询 recent 最多 10、总数最多 40、无重复、无历史时稳定 fallback；
- exact > prefix > contains > fuzzy，热度不能跨 tier；strict 不足 12 才补 fuzzy；短 query 不做 fuzzy；
- NFKC、大小写、`.`/`:`/`_` token、中文 contains 和 typo 阈值结果固定；
- 七日日桶边界、Host date rollover、原子并发 increment、过期 prune、safe-integer saturation；
- 两个 Workspace 的相同 ref key 不共享热度，绝对 Workspace path 不落盘；
- Catalog 删除的对象在候选刷新后消失，不因 usage 记录重新出现；TTL 内允许旧候选；
- Catalog 成功、为空及加载失败路径均零写 Workspace；adapter 显式设置 telemetry off 和禁写 bytecode，
  在默认开启 telemetry 的真实 Runtime 下检查磁盘，不能只使用全局关闭 telemetry 的测试环境；
- occurrence 保存 exact envelope，label/clipboard 修改不能改变内部 ref；
- same path/different kind 的 chip 显示与 ref 均可区分；
- Environment 归属变化、已失败绑定、unknown Session、invalid envelope 和 cancellation 阻断 serialize；
- Catalog drift、对象删除或候选 reload 失败不阻断结构与归属正确的引用提交；`selected` 和 `serialize` 不调用
  Catalog adapter，不要求候选 cache 存在；
- 多 occurrence submit 独立生成稳定模型 marker，不携带 Catalog fingerprint，也不进行提交级 Catalog 加载；
- serialize failure 保留草稿/chip，绝不回退 clipboard text；
- usage storage failure 只降级排序，不影响 Catalog/ref 正确性；
- response/log/prompt 不包含 Workspace/Python absolute path、credential、内部 IR 或完整用户问题。

### 仓库门禁

- `npm run test:semantic-reference-input`；
- `npm run check`；
- `npm run build`；
- `npm run verify:plugin-package`；
- `git diff --check`；
- 文档 relative link 与 Markdown rendering 检查。

### 真实用户旅程

在两个不同 Workspace、同一 Web profile 中验证：

1. Workspace A 含至少 100 个跨 kind 对象，Workspace B 含不同 Catalog；
2. A 输入 `@`，最近常用置顶且总候选有界；B 不出现 A 的对象或热度；
3. 连续输入、退格和 quoted 多词查询，只展示最新结果，文件/Session source 仍可用；
4. 选择 exact、prefix、contains 和 typo fuzzy 各一个对象，chip 显示完整 `kind:path`；
5. 多次选择后重载 Web，七日热度仍保留；
6. 选择后保持 ref 不变并修改其定义，提交成功；Agent 收到精确 marker，使用执行时加载的新定义完成分析；
7. 选择后删除或重命名对象，提交仍成功；Agent 使用当前 Catalog exact ref 校验时收到错误，并明确报告当次
   分析失败，不自动替换对象；
8. TTL 内允许菜单保留旧候选，到期后的下一次请求刷新，新增/删除/描述变化得到体现，usage 不引入旧对象；
9. 切换 Workspace/Runtime 归属或使绑定失败后，原引用提交被阻断并保留草稿/chip；
10. 整个浏览、选择和提交过程不创建额外 Workspace 文件，不把热度写入 Session transcript；Agent 实际分析
    的正常 Artifact、Evidence 与 telemetry 生命周期仍由 Marivo 拥有。

## 后续扩展

以下能力不进入第一版，只有独立需求和上游契约后再设计：

- DSH 通用 reference appearance registry，使插件可注册 metric/dimension 等图标；
- DSH 通用 paste matcher，使 canonical clipboard text 可安全恢复 occurrence；
- 可见的 candidate-source error/pending 状态；
- exact rolling 168-hour 或可配置热度窗口；
- 用户主动清除/关闭个性化排序的设置；
- embedding 或其他语义召回。若实现，索引必须绑定 Workspace、Catalog fingerprint 和 embedding model identity，
  只能重排当前 exact Catalog refs，不能生成、修复或替换 Marivo 对象。
