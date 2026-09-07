# Marivo 分析展示与交付重构设计

## 状态、约束与本轮结论

状态：目标设计；2026-09-07 已完成 [S0 契约与接缝验证](marivo-analytics-presentation-s0-acceptance.md)和 [S1 执行准入](marivo-analytics-presentation-s1-acceptance.md)，S2 数据投影和 S3 共享 reader/离线构建也已完成，S4 的 presentation Tool/receipt/RPC 和真实 Host/Web 交付已完成；新 Skill 与最终 Agent 路由留在 S5。下文“当前”清单保留重构前基线，已实现状态以[实施路线图](marivo-analytics-presentation-roadmap.md)为准。设计约束：**破坏性更新，不做迁移、兼容、别名、双协议或旧卡恢复；从完整用户旅程决定最小能力，不从已有工具清单决定保留项。**

保留以下已确认约束：凭据管理继续提供；分析基于 Marivo 公开能力；适配 DSH Host；不包含 Sites 或其他托管。ChartRenderer、图表变换、表格、布局、来源面板、reader 明确参考 Analytics App Core 的实现方式，在本项目独立编写，不直接复制源码。computed 只展示声明的 Artifact 来源，不判断或验证转换逻辑。

**修订后的最小方案是：4 个插件 Tool、1 个插件展示 Skill、1 套 reader、1 次生成完成 Web 阅读与离线 HTML 交付。** Marivo Runtime 的两个上游 Skill 继续挂载。没有展示版本管理平台、独立 validate/export Tool、在线编辑事务或长期展示服务。

此方案有意改变当前插件不拥有页面 schema/renderer 的边界。实际代码切换时同步更新[总体架构](../architecture.md)与[集成交付模块](../modules/plugin-integration-delivery.md)；S0 的内部契约和隔离探针不代表目标生产契约已经接通。

## Review：原方案为什么需要收敛

| 原设计问题 | 对合理性与用户体验的影响 | 本轮决策 |
| --- | --- | --- |
| 不论职责是否独立，先保留 5 个现有 Tool，再增加 3 个 | 模型要协调 access/python 和 validate/present/export 的先后关系，制造额外失败与状态恢复路径 | 删除 access、Evidence Tool，新增一个 present；独立 Host 边界才保留 Tool |
| presentation ID、revision、CAS、operation 状态、版本索引和编辑 RPC | 把生成文件扩展成可协作编辑的平台；读一个结果需多套状态一致 | 一次构建对应一组文件和 receipt；修改后重新生成，无版本链或编辑事务 |
| report + visualize 两个插件 Skill | 同一套数据与交付流程被拆开，模型需要选择、转发与协调 | 一个 presentation Skill，单图、表格、报告和看板只在内容组织上不同 |
| 18 类图形、完整 family 适配、Graph UI 都成为切换条件 | 用户最基本的看图、查来源、下载文件被后续功能阻塞 | 七类能力各做最小闭环；首期 line/bar + 表格，其他图形按需求扩展 |
| 同时建设分析正确性检查、复杂状态分类和展示验证 | 插件开始重新解释 Marivo 语义，也容易审查用户明确排除的 computed 转换 | 仅验证可展示、引用、预算和安全；分析正确性仍由 Agent 与 Marivo 承担 |
| 保留历史 Evidence 卡解码和分阶段旧 reader 路由 | 旧协议成为永久维护负担 | 直接删除旧协议与适配层；测试当前协议，不承诺历史格式恢复 |

2026-09-07 本轮检查时，本仓库 HEAD 为 `e9a4eef`。事实以 [plugin.ts](../../packages/dsh-data-analysis/src/plugin.ts)、[client.tsx](../../packages/dsh-data-analysis/src/client.tsx)、[凭据服务](../../packages/dsh-data-analysis/src/datasource/service.ts)、[包清单](../../packages/dsh-data-analysis/package.json)及检出的 Marivo/DSH 源码为准。工作树还有其他文档、Skill 与重装流程修改，本轮不改动这些实现或将其视为已验收。

## 第一性原则：一次分析展示需要什么

用户需要完成五件事：提出问题，取得结果，看懂结果，查到来源，保存或继续追问。插件只补足 Marivo 到 DSH 展示之间的接缝。

| 所有者 | 必须承担的职责 |
| --- | --- |
| Harness | Agent、Session、Tool/Skill、执行政策、取消、凭据存储、Workspace、RPC 与 UI 槽位 |
| Marivo | Catalog、typed analysis、Artifact/Finding、Quality/issues、Query/lineage、SessionGraph 与 revalidation |
| 本插件 | 精确 Runtime/Workspace binding、凭据进入一次执行的接缝、公开数据投影、结构化展示、文件与 DSH 交付 |
| Agent | 问题和方法选择、分析代码、结果解释、图形与叙事组织、按诊断修改草稿 |

最小工作流：

1. Agent 通过 Runtime Skill、live Help 与精确 Catalog Ref 理解问题。
2. `marivo_python` 在启动前完成本次凭据准备，然后执行一次分析；已有结果按精确 Session/Artifact 恢复。
3. Agent 写展示草稿，引用 Artifact，或引用 computed 数据文件及其声明的 Artifact 来源。
4. `marivo_present` 一次完成检查、读取、构建，返回可读 receipt；DSH 可打开，HTML 可下载并离线阅读。
5. 用户在当前快照中排序、分页、显隐系列；新分析与修改回到普通对话。

展示不会自动重新 observe、重新查询、运行作者脚本或刷新凭据。无需获取数据源的 persisted 读取使用 Marivo 公开的无 datasource 路径；缺少所需数据时明确报告，不能为凑齐展示重新执行分析。

## 七类参考能力的最小实现

完整参考 Data Analytics 的七类能力，不意味着首期复制全部图形和产品功能。

| 能力 | MVP 必须交付 | 首期不做 |
| --- | --- | --- |
| 1. 统一产物 | 一个展示文档，包含标题、有序 blocks、有界 datasets 和来源；单图也是该文档 | 四套 surface 生命周期、发布对象、版本链 |
| 2. 图表引擎 | 共用 ChartRenderer，支持 line/bar；不适合绘图的数据使用表格 | 全部 18 类图形、任意前端 aggregate、自动推断业务图形 |
| 3. 指标、表格、布局 | Markdown、metric、chart、table、source 五类 block；单列或简单响应式网格 | 拖拽画布、在线文案编辑、主题编辑器 |
| 4. 来源体验 | 精确 Artifact 身份、范围、公开 Quality/issues，按声明读取 Finding；computed 展示声明来源 | 自动收集全部 DAG、完整图形化审计平台、转换正确性证明 |
| 5. 探索与继续分析 | 表格排序/分页、系列显隐、复制所选坐标及来源的追问上下文 | 直接提交 Agent 消息的专用桥、跨图全局筛选、自动刷新 |
| 6. 多端交付 | 同一 reader 的 DSH 打开入口与自包含 HTML；Web 下载和 headless 文本路径 | Sites、其他托管、PDF/Slides、分享权限 |
| 7. 验证 | present 内部结构/引用/预算/资源检查；reader 的自动化和实际浏览器验收 | 独立 Checker Tool、统计正确性判定、自然语言结论证明 |

line/bar 的单位、标签、tooltip、空数据状态必须可靠，不能用图表数量替代完成度。复杂结果的表格表达必须保留实际字段和实质限制；不支持的图形返回明确诊断，由 Agent 改为受支持表达，不静默伪装成已支持。

## Tool：从当前 5 个收敛到 4 个

### 当前事实与目标清单

当前插件通过 Cordis 的 `ctx.tools.register` 注册 DSH 原生 Tool，**没有独立 MCP server，也没有插件自有 MCP resources/prompts**。DSH connection RPC 不是 MCP。本轮不新增 MCP、不移植 Codex MCP Apps 工具协议；Host 的文件、Shell、Code mode、`skill` 等工具不属于本插件删除范围。

| 当前/拟议 Tool | 决策 | 独立职责或替代方式 |
| --- | --- | --- |
| `marivo_help` | 保留 | 绑定 Runtime 的 live Help、按需注入与去重；具有实时披露职责，不能仅靠静态 Skill 替代 |
| `marivo_datasource_test` | 保留 | Host 凭据管理操作：连接测试、缺凭据表单、测试历史及失效状态、取消和结构化失败 |
| `marivo_python` | 保留并重构 | 接收代码及精确 datasource names；一次调用完成执行前准入、fresh credential snapshot 和一次受控执行 |
| `marivo_datasource_access` | 删除 | 执行前准入并入 `marivo_python`；删除跨调用预授权 lease，模型不再先调用 access |
| `marivo_evidence_sources` | 删除 | 普通来源追问通过 Marivo 公开 Python API 回答；需要可视来源时用统一 source block/来源面板 |
| `marivo_present` | 新增 | 唯一展示 Tool，一次完成校验、来源/数据读取、reader 数据构建、HTML 和 receipt |
| `marivo_presentation_validate` | 不新增 | 校验是 present 的必经内部步骤，失败直接返回可修复诊断 |
| `marivo_presentation_export` | 不新增 | HTML 随 present 生成；Web 下载读取现有文件，不再调用独立导出工具 |

最终注册集合固定为 `marivo_help`、`marivo_datasource_test`、`marivo_python`、`marivo_present`。不将删除项保留为 alias、隐藏 Tool 或转发入口。

### 为什么删除 access，但保留 test

当前 [service.prepare](../../packages/dsh-data-analysis/src/datasource/service.ts) 在凭据齐全时，`access` 直接发放 30 分钟、64 次执行的 lease，没有独立的人类批准步骤。随后 `claim` 再校验 lease 与身份并取 fresh snapshot。拆成两个模型调用并未增加授权主体，却增加了过期、次数耗尽和执行前状态不同步的问题。

新 `marivo_python` 保留所有实质边界：

1. 从当前 Agent/Workspace 解析 checked Runtime，声明的 datasource names 仅限定本次请求范围，不代表用户额外授权。
2. 凭据不足时，通过现有管理 UI 等待补齐；无交互能力或来自不允许发起交互的 subagent 时返回明确缺失，保留现有调用来源检查。等待只属于仍然存活的本次调用。
3. 全部 datasource 就绪后，核验 Runtime、Workspace、datasource 定义与凭据版本，取得一次 fresh snapshot，再启动用户代码。
4. snapshot 经 stdin 进入本次 `credential_scope`，保留 datasource/field/ref allowlist、DSH Shell/sandbox policy、取消与输出脱敏。`datasources=[]` 安装空 resolver，不回退环境或缓存。
5. 启动前失败不会运行用户代码；启动后失败不自动重放。结束清理秘密值，取消或 Agent dispose 结束本次操作。

删除 access 专属 `Lease/#leases`、有效期、次数和 `access-required` 等状态；保留凭据版本、上下文失效、请求/操作历史及其有界回收机制。不要把“删除展示版本状态机”或“删除 access lease”误用到凭据管理 UI 自身必要的操作状态上。执行政策和授权继续由 Harness 决定。

`test` 与之不同：[service 的测试路径](../../packages/dsh-data-analysis/src/datasource/service.ts)除调用 Marivo 外，还更新 Host 管理 UI 使用的 `lastTest/stale` 状态。让 Agent 在 Python 中测试后再回传状态，会引入更大的接缝。因此保留这个窄工具，但不要求每次执行前先 test。凭据添加、更新、删除、诊断及已有测试交互保留。

### 为什么删除独立 Evidence Tool

原 Evidence bridge（S4 已删除，其公开读取接入[展示 projection](../../packages/dsh-data-analysis/src/presentation/projection/program.ts)）使用公开 `mv.session.resume(..., use_datasources=False)`、`session.artifact`、`artifact.finding`、`finding.render` 等接口；没有独有的分析读取能力。

删除 Tool、专用 prompt、metadata/card/delivery 协议和旧客户端解析器。可信来源读取的内部实现按需提取到 presentation projection；普通追问由 `marivo_python` 读取并输出文本，需要来源面板时 `marivo_present` 支持只含 source block 的文档。无需为每次来源追问生成图表或伪造 dataset。

不保留历史 Evidence 卡解码。新 Tool 的 Native/Code 交付独立实现为一种 presentation receipt，不复用旧协议名称。

## 一个展示 Skill 与一个执行流程

插件只提供 **`dsh-data-analysis-presentation`**，直接替换现有 `dsh-data-analysis-report`，不保留旧名称，不新增独立 visualize 或 dashboard Skill。Marivo Runtime 的 `marivo-analysis`、`marivo-semantic` 原样挂载，不复制上游内容。

展示 Skill 的主文档只说明选择何时展示、引用数据、编写草稿、调用 present、修复错误和交付。图形配置、报告/看板叙事、schema 与示例放在按需读取的 references 中。图、表、报告、看板共用同一流程，区别是 block 数量与布局。

系统提示收敛为短展示路由：普通事实回答使用文字；需要图/表/报告时加载 presentation Skill。它不要求先激活 `marivo-analysis` 才能处理已有数据；需要新分析时再加载 Runtime Skill。保留 Marivo live Help 的激活、恢复、去重与 dispose，不给 presentation 伪造 Marivo Help target。

删除旧 Skill 中 Agent 自选 DOM/SVG/Canvas、复制经典 JS、固定脚本加载顺序、强制遍历每个 Session Graph、最后 mutation HTML 入口及依赖 Produced Files 的规定。凭据提示改成直接调用 python，不再出现 access lease；删除独立 Evidence Tool 的提示。仓库开发用发布/重装 Skill 不受影响。

## 最小数据与来源契约

### 一份草稿，两种 dataset，五种 block

草稿由 Agent 使用普通文件能力编写，`marivo_present` 接收 `draft_path`。正式字段在实施时固定；以下为职责约束，不是已经可调用的 schema。

| 内容 | 最小含义 |
| --- | --- |
| 文档 | schema version、标题、有序 blocks；可选简单网格布局 |
| Artifact dataset | dataset ID + 精确 Marivo Session/Artifact 引用；必要的列选择与展示行预算 |
| computed dataset | dataset ID + Workspace 内纯数据文件；零个或多个声明的 Artifact 来源引用 |
| blocks | Markdown、唯一值 metric、line/bar chart、table、独立 source；引用 dataset/列或精确来源 |
| 生成数据 | 已取得的行/列、来源公开事实、时间与实质限制；由 builder 生成，Agent 不手填 Marivo Quality/revalidation |

来源身份在同一绑定 Workspace/Runtime 下使用 owning Session + ArtifactRef，可选 FindingRef。外层绑定补齐环境上下文，不要求模型在每个字段重复填入 Runtime fingerprint。来源关联属于展示数据，不是新的 Marivo lineage 或 Artifact。

直接 Artifact dataset 由 builder 经同一 checked Runtime 公开读取；没有可恢复数据时失败，不以重新 observe 兜底。computed 文件只检查结构、类型、预算和可展示性；其内容与输入 Artifact 不比对，不要求转换代码、字段映射、代码 digest、输入输出证明或转换分类。

computed 声明的来源通过共享来源投影展示。无法恢复的来源明确标为 unavailable，不能补造详情；computed 数据仍可展示，不把“来源可恢复”变成对计算正确性的验证。错 Workspace、越界路径等属于信任边界错误，必须拒绝。离线打开只使用生成时保存的来源信息，不依赖 Marivo 或凭据在线可用。

### Python 帮助库只解决必要的序列化

直接 Artifact 已有公开引用，不再要求 Agent 先 `emit_dataset` 再向 builder 提交同一份 Artifact 数据。Graph 也不再强制先 `emit_session_trace`。

保留一个小型 Python 序列化帮助库，目标入口为 `dsh_data_analysis_presentation.write_dataset(frame, path)`：将 computed DataFrame 写为有界 typed JSON 并返回路径/大小/截断信息。来源引用写在展示草稿中，不在两个文件重复维护。该 helper 不负责分析、转换验证、HTML 或注册全局变量。

替换旧 report-kit 的公共入口与 wheel，移除 `emit_dataset`、`emit_computed`、`emit_session_trace` 及其旧 receipt 类型，不做同名兼容包装。可以复用当前公开投影与数值编码的内部实现，但只保留新契约需要的部分。Python wheel 继续由现有受控 Runtime 安装，不为展示另起解释器。

### 数值与范围

有界行列、字段类型、null、Decimal、大整数、时间编码是 MVP 必须解决的正确性。JS 无法精确表示的值保留精确文本或明确拒绝绘图，不能静默丢精度。表格显示精确值，图形使用的缩放或近似由展示配置明确声明。

截断记录总行数、写入行数与限制；前端不基于截断数据算全量 KPI、总计或排名。metric block 必须定位唯一已有值，不默认取首行或隐式求和。reader 不重算分母、加权平均、累计或统计检验。源数据的单位、时间、scope、quality/issues 保留公开含义，不依据列名猜业务口径。

不建立 `ready/partial/blocked/fixture` 覆盖状态机。构建只有成功或失败；成功结果可带明确诊断，例如截断、来源不可用、浏览器未检查。缺必要绘图字段等结构错误失败，业务缺失值按数据呈现。示例内容显式标记，不能通过一个“通过”标志变成真实数据。

## Reader：参考实现，独立编写

参考本机 Data Analytics `0.2.10-13ceeea1f599` 的 Analytics App Core。已核对其使用 Recharts 3.8.1，插件 manifest 标为 `Proprietary`。本项目优先采用 [Recharts（MIT）](https://github.com/recharts/recharts/blob/main/LICENSE)，遵守上游许可证；不复制 Data Analytics 的封装代码。Recharts 的 React peer 范围包含 DSH 当前的 React 18，集成复用 Host React 实例，不为它另升 Host React。

| 部分 | 参考的实现方式 | 本项目最小实现 |
| --- | --- | --- |
| ChartRenderer | 统一入口、图形分派、Frame/Legend/Tooltip 组合与状态 | line/bar，与表格共用 dataset、单位和来源 |
| 图表变换 | 系列组织、坐标与几何数据准备 | 为已经给出的数据准备绘图编码；不判定 computed 的上游转换 |
| 表格 | 类型化呈现、排序、分页、列组织 | 精确数值、分页、缺失与截断提示 |
| 布局 | blocks 组合、响应式、共享样式 | 单列报告或简单网格看板，无在线布局编辑 |
| 来源面板 | 就近入口、摘要与逐层展开 | 精确 Artifact、semantic Ref 与可得公开口径、范围、Quality/issues、选择的 Finding 与不可用说明 |
| reader | 数据加载、共享组件、视图状态及宿主适配 | 同一实现用于 DSH 与离线 HTML，仅打开/下载/复制等外层动作不同 |

Marivo 深度结合体现为保留分析含义：Metric 的单位与粒度、Delta 的比较方向、Attribution 的贡献与残差、Candidate 的候选性质、Forecast 的预测边界、Event/Lifecycle 的 completeness/censoring。首期以受支持图形或表格呈现，不再维护一套覆盖所有 family 的插件能力注册表，也不把候选解释成因果。

来源快照保留生成时可取得的公开口径信息，例如 ratio 的分子/分母、weighted mean 的权重定义。取不到时明确缺失；只能读取当前定义时标明读取时间及当前定义身份，不冒充历史 Artifact 的原始口径。无需为此增加定义版本库或差异视图。

Query/Graph 审计仍可通过 `marivo_python` 的公开 API 按需取得，UI 首期可以使用有界文本/表格表达公开详情并省略 bind values。完整 SVG DAG、全部 Finding 浏览器、历史定义差异视图不是 MVP，也不是删除旧 JS 资产的前提。revalidation 仅在显式分析需要时运行，普通打开与来源展开不自动触发。

## 一个 present 完成构建与交付

### Tool 内部闭环

`marivo_present(draft_path)` 使用 Agent 已绑定的 Workspace，依次完成：

1. 读取并校验草稿、文件边界、schema、引用、列类型和预算。
2. 恢复需要的 Artifact 数据与声明来源；使用固定公开读取程序，不执行草稿携带的 Python/JS。
3. 生成 reader 可消费的文档、数据和来源快照，运行必要的展示与内容检查。
4. 写入新的临时目录，完成 `presentation.json` 与自包含 `index.html`；全部成功后以一次目录提交完成产物。
5. 返回可读 receipt 和新 presentation UI 交付信息；失败返回位置、原因与修复建议，不返回可打开成功卡。

校验与导出是内部函数，不提供单独模型工具、`validate_only` 模式、validation 缓存协议或可选发布步骤。HTML 每次自动生成，增量依靠预编译 reader 资产而非让 Agent 再执行一次 export。

### 文件身份，不建立版本平台

示意文件结构：

```text
<workspace>/.dsh-data-analysis/presentations/<build-id>/
  presentation.json
  index.html
```

`build-id` 只定位一次完整构建，使用安全的生成 ID；不是长期 report identity 或 revision。receipt 包含当前 Workspace、build ID、标题、精确路径、文件 digest 和必要诊断。目录只创建不覆盖；取消/失败清理本次临时文件，不留下可打开成功 receipt。

修改草稿后再次 present 会产生新的独立交付物，不提供 latest 指针、版本链、CAS、修订合并或操作状态查询。重复调用可能产生两个文件产物；MVP 不为避免这个可控结果建设持久幂等事务。单次 Tool 的交付事件只记录一次，前端按相同 receipt 去重。

文件仍是普通 Workspace 文件，用户可以修改或删除。打开时缺失或 digest 不符明确反馈，不转向另一个“最新”结果；不承诺恢复原始字节。该检查是当前产物完整性检查，不是旧版本兼容。

### DSH Web、Code mode 与离线文件

DSH 使用新 presentation receipt 的对话卡片提供“打开”和“下载 HTML”。完整 reader 在公开 `shell.overlay` 槽位显示；首期不要求任意 Markdown 段落间嵌图或第二套紧凑 renderer。

新增最小只读 RPC，以 Workspace ID + build ID + 固定 asset 名定位上述文件，并携带 durable receipt 中该文件的预期 digest。Host 从绑定 Workspace 推导固定目录，校验归属、真实路径、大小与字节一致性；digest 只用于检测内容变化，不作为访问授权。浏览器不能请求任意路径或 Python。无需另建文件索引、来源查询服务、可写版本 RPC 或 HTTP 文件服务器。所有来源随 presentation.json 读取，展开无需再查询 Marivo。

Native/both 与 Code-only 都必须持久记录同一种 receipt 并输出文本。参考 DSH 现有 `tool/code-dispatch` 的交付接缝实现新协议，不依赖模型重新打印嵌套结果；删除旧 Evidence 协议，不保留双解码。测试实际 Turn/Session 归属、去重、重连和 headless 输出。

HTML 内嵌同一 reader、样式、数据与来源，无 CDN、fetch、Host API、凭据或 Python 依赖。内嵌 payload 与生成的 presentation.json 一致。提供语义 HTML fallback，至少保留正文、指标、必要表格与来源，供无脚本和打印阅读；不能只交付空根节点。

Web 打开和下载属于 MVP 验收，不以“已生成绝对路径”替代完成。Produced Files 和 native opener 仅是 Host 实际可用时的辅助导航，不需要伪造文件 mutation，也不是新交付依赖。

### 继续追问的最小方案

reader 允许复制图表标题、选择坐标、精确来源引用和 build ID，供用户粘贴到普通对话；复制失败提供可选文本。浏览器不调用 Agent，不创建 `AnalysisIntent` 执行协议，不绕过 Harness 队列或取消规则。新指标、新范围或刷新通过用户普通消息进入下一次分析。

排序、分页、系列显隐只改变当前视图，不更新文件、不形成版本或 Evidence。跨图筛选、保存视图、在线编辑、直接消息提交、图像导出与全屏均可在有明确需求后增加，不预先声明一大组 Host capability flags。

## 必要验证与最小验收证据

| 检查 | 本项目证明什么 | 不证明什么 |
| --- | --- | --- |
| 草稿与数据 | schema、类型、预算、文件与引用边界、metric 唯一值、图形字段可用 | 问题已经回答、computed 计算正确 |
| Marivo 来源 | 公开读取的对象身份与实际可用信息，或明确 unavailable | 来源必然参与 computed、结论被 Evidence 蕴含、数据已刷新 |
| 构建 | 资源闭合、文本/链接转义、无作者脚本、JSON/HTML 数据一致、完整文件提交 | 用户文件不会被修改或删除 |
| reader | 支持图形的数值、标签、tooltip、排序、窄屏、主题、来源、打印与无脚本行为 | Marivo 业务口径或统计有效性 |
| DSH 交付 | Native/Code receipt、Web 打开/下载、归属、取消与文本降级 | 所有 Host 都有浏览器或模型视觉能力 |

通用 reader 在 CI 与真实浏览器中验证；每份文档运行必要的结构/数据/构建检查。实际有浏览器能力时可做有界 smoke；无能力时明确未做浏览器检查，不把它扩展成强制安装浏览器的运行前提。用户明确要求视觉验收时需要实际截图/交互证据，缺失则报告未完成。

computed 不加入任何转换审查测试。输入 Artifact 的 Quality/issues 按原归属展示，不包装成输出 computed 的验证结果。代码 hash、引用存在和无 console error 都不能被描述成“分析正确”。

## 当前接口、资产与测试的破坏性处理清单

以下路径均相对 `packages/dsh-data-analysis/`，列出的名称是当前实现清理点；新内部模块名可以在实施时收敛，不据此新增公共 API。

| 当前项 | 本轮目标处理 |
| --- | --- |
| `src/datasource/access.ts` 及其导出/注册 | 删除；执行前准入并入 `python.ts` 和 CredentialService |
| CredentialService access lease 字段、发放/claim 接口 | 移除跨调用 lease 逻辑，替换为本次执行准备；保留凭据 UI 操作与历史、版本校验、取消和有界状态回收 |
| `src/evidence/sources.ts` 的 Tool/metadata/durable 交付 | 删除；公共来源投影移入内部 presentation 模块，删除 `./evidence` 包导出与旧常量/类型导出 |
| `src/evidence/bridge.ts`、`bridge-program.ts`、`src/bridges.ts` | 仅提取新 builder 真正需要的公开读取；删除旧 Evidence bridge 接口，不保留目录/公开 facade 作为兼容层 |
| `src/client.tsx` 中 Evidence parser、delivery definition、turnTail 卡和 locale | 删除旧协议与专属 UI；注册新 presentation receipt/卡片/reader，共享一个来源组件 |
| `skills/dsh-data-analysis-report/` | 整目录退出包内容，由 `dsh-data-analysis-presentation` 替代，无别名 |
| `report-data.js`、`marivo-artifact.js`、`marivo-session-dag.js` | 删除及停止分发；`ReportData`、`MarivoArtifact.render`、`ReportTrace` 全局 API 全部退出 |
| `python/report-kit`、旧 emitter、receipt、dataset/trace 注册协议 | 替换为小型 presentation 帮助库及 builder 内部投影；新数据为纯 JSON，不支持经典 JS 注册输入 |
| `MARIVO_REPORT_PROMPT`、`MARIVO_EVIDENCE_SOURCES_PROMPT` | 删除旧路由，替换为单一展示入口；不保留“只显式 HTML 才启用”“每次来源追问走旧 Tool”等指令 |
| 凭据 prompt 与 python description | 删除先 access、30 分钟/64 次等规定，描述一次执行准备与失败边界 |
| live Help、Runtime Skills、filesystem Skill provider | 保留实时披露与生命周期；更新新插件 Skill 目录，不把展示 schema 混入 Marivo Help |
| `/dsh-data-analysis-credentials` RPC 与凭据 slots | 保留管理/测试/等待能力，内部请求由新的 python/test 调用发起；不保留 access 专属请求类型 |
| semantic reference RPC、`@` 输入、semantic-browser/catalog 与对应 slots | 保留公开 Catalog/定义读取和只读边界；不新增 observe、credentials 或展示版本管理 |
| Runtime/Workspace、`dsh-data-analysis-env`、非秘密 Python shell fact | 保留绑定与管理入口，更新 Python 帮助库的精确安装检查，不引入替代解释器 |
| `package.json`、`src/index.ts`、Cordis 注册、构建/package verifier | 注册最终 4 Tool，分发一个新 Skill、新 Python wheel、reader 与必要 schema；删除旧导出/资产与废弃依赖 |
| `tests/agent-native-report-primitives/*` | 删除旧 API/资产和“四个旧 Tool”的形态断言；新测试验证实际注册的目标 4 Tool 与单一文档流程 |
| `tests/evidence-sources/*` | 将身份、脱敏和公开读取的有效用例转到 source projection；删除旧卡/旧 Tool/历史解码用例 |
| Python、runtime/report-kit-contracts、datasource access 测试 | 改验新序列化与本次执行准备；删除旧协议/lease 断言，新增多 datasource 就绪后只启动一次的验收 |
| plugin-integration、真实 delivery、build-client/build-report-kit/finalize 与 wheel 校验 | 按新结构重写相关入口与断言；真实旅程不得再调用已删除 Tool/Skill/全局 JS |
| README、架构与模块文档 | 实施时同步目标责任、4 Tool、1 Skill、一次构建与新凭据准入，不继续把旧计划作为运行指南 |

现有 `marivo_report_render`、`marivo_test`、`marivo_session_dag`、artifact inspect/quality/contract/lineage 等便利 Tool 已不在当前注册面，不恢复，也不算成本轮实际删除。当前缺少的旧 report/check CLI 和包入口不重新引入。

本次不提供旧 HTML/receipt/schema 的导入、迁移、历史卡恢复、旧路径转发或双 renderer。也不把“破坏性更新”解释为删除用户 Workspace 文件或 DSH 历史记录；这些数据不主动清理，新插件只处理新协议。

## 实施范围与完成门槛

具体代码范围、依赖、分工、同步删除项及阶段验收见[实施路线图](marivo-analytics-presentation-roadmap.md)。S0–S5 是未发布实现的工作切片，不是兼容迁移阶段。

实施按责任拆成可验证的工作项，但一次交付新契约，不发布新旧并存的过渡模式：

1. **执行与工具面**：保留 test/help，重构 python 执行前准入，删除 access/Evidence 的注册和公共面，确定单一 present 契约。
2. **最小展示闭环**：实现小型序列化帮助库、Artifact/来源投影、五类 block、line/bar、统一 reader、一次构建与离线 HTML。
3. **DSH 接入与清理**：新 receipt、只读文件 RPC、卡片/overlay、Web 下载、Code/headless 交付；替换 Skill、资产、导出、测试与文档。

以下旅程全部成立才算 MVP 完成：

- 缺凭据的多 datasource 分析：一次 `marivo_python` 完成等待与执行前准备；未全部就绪不启动代码，成功只执行一次；取消/轮换/Workspace 变化不复活旧执行。
- 凭据管理仍可添加、更新、删除、测试与诊断；test 结果在管理 UI 可见；查看已有展示不读取凭据。
- 一个真实 Marivo Artifact → 草稿 → 一次 present → DSH 打开与 HTML 下载 → 断网阅读，数值、来源和实质限制一致。
- computed 数据不提交转换信息即可展示，关联多个声明 Artifact 来源；缺失来源明确标示，没有转换比对或假冒 Marivo 验证。
- 独立来源追问可用公开 Python 文本回答，或生成只含 source block 的展示；不需要旧 Evidence Tool。
- Native/both 与 Code-only 记录同一种 receipt；headless 返回文本与精确路径；Web 重连和重复事件不串 Session/Turn。
- 大整数、Decimal、null、空结果、截断、越界引用、恶意内容、写入失败和取消有确定结果；无半成品成功卡。
- 安装包只存在目标 4 Tool、1 个插件 Skill、新数据协议和 reader；旧 access/Evidence 导出、卡协议、report Skill 与全局 JS 不存在。

代码变更按仓库规则运行相关测试、`npm run check`、`npm run build`、`npm run verify:plugin-package`，并提供受影响的真实 Runtime、DSH Agent、Web/离线浏览器证据。仅文件路径、mock transport 或端口存在不算真实运行验收。当前设计文档检查通过不等于这些工作已经完成。

18 类图形、完整 DAG 可视化、跨图筛选、在线编辑、版本管理、直接追问提交等不作为隐藏待办或 MVP 门槛，只有新的用户需求证明必要时再设计。

## 实现参考与事实入口

- Analytics App Core 本机安装包：`src/analytics-app-core.md`、`charting/ChartRenderer.tsx`、`charting/chart-transforms`、`tables/DataTable.jsx`、layout/source/reader 及 portable builder；只参考实现方式，独立编写。
- [当前插件入口](../../packages/dsh-data-analysis/src/plugin.ts)、[当前 Python Tool](../../packages/dsh-data-analysis/src/datasource/python.ts)、[当前凭据服务](../../packages/dsh-data-analysis/src/datasource/service.ts)、[当前凭据设计](marivo-credentials-design.md)。
- [当前 presentation-kit](../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/__init__.py)（S2 已替换 report-kit）、[当前来源读取](../../packages/dsh-data-analysis/src/presentation/projection/program.ts)、[语义浏览模块](../modules/semantic-browser.md)。
- [Marivo 分析 Skill](../../../marivo/marivo/skills/marivo-analysis/SKILL.md)、[公开 Session](../../../marivo/marivo/analysis/session/core.py)、[Artifact contract](../../../marivo/marivo/analysis/frames/base.py)、[语义读取](../../../marivo/marivo/semantic/reader.py)。
- [DSH slots](../../../deepseek-harness/packages/client/ui-slots/README.md)、[conversation UI](../../../deepseek-harness/packages/client/ui-conversation/README.md)、[Host API](../../../deepseek-harness/packages/host/apiproxy/README.md)、[连接边界](../../../deepseek-harness/packages/client/connection/README.md)。
