# 统一分析 UI 分阶段实施计划

## 状态、范围与实施原则

状态：P0 接缝与 P1 数据入口已实施，P2–P3 待实施。日期：2026-10-28。依据：[统一分析 UI 重构设计](unified-analysis-ui.md)。

先用现有存储、执行和精确数据展示能力完成一个可用的统一快照展示流程，再扩展图表、元数据和实时来源。本文将设计中的 S0/S1 拆成 P0–P3 四个实施阶段；P1/P2 是内部交付节点，P3 完成后才算首期交付，不能把流式更新或直接 SQL 展示推迟后仍宣称首期完成。

实施只修改 `dsh-data-analysis`。不改 Marivo、Harness、`dsh-intelligent-ui`，不抽取跨仓库共享包。验收环境不安装 Intelligent UI。上游源码用于核对公开契约，不作为构建或运行依赖。

首期保留以下目标：

- UI 有助于用户理解、比较或检查数据时使用 `marivo_present`；简单答案直接回复。
- 普通 UI 在 tool view，明确要求的报告/dashboard 在右侧 tab；共用 Lang、Catalog、Renderer 和数据呈现。
- 支持持久 Frame、DataFrame 捕获快照及受支持的文件/图片快照。单个结果可只传引用，默认一次 `marivo_present`，不增加目录查询、模型分页或成功后回读。
- 首期 Catalog 固定为 `AnalysisFrameView`、`DatasetView`、`Stack`、`TextContent`、`Card`、`Tabs`、`TabItem`、`Image`。两类数据组件仅支持 auto/table/metric。
- 支持 Native 真实参数流预览及官方语句增量更新；PTC 按当前真实可见粒度交付，不承诺生成期逐片预览。
- 保存完整不可变版本并能重新打开。历史语义对象定义、动态业务读取和新格式离线导出不作为首期条件。

不先搭通用平台。资源读取用插件内部函数与现有 RPC，组件用普通 React 上下文，阅读状态先放在所属视图中；不新建数据库、全局引用服务、任务队列、通用 Provider 发布系统或第二套增量协议。必要的身份、精度、预算和保存冲突检查沿用现有接缝，避免在每层重复实现。

## 当前代码起点与复用方式

下列为最初源码核对的起点（P0/P1 当前状态见各阶段实施记录），均在本仓库内。新模块名称在实施时可调整，但责任不另起一套。

| 现有位置 | 复用与改造 |
| --- | --- |
| [presentation/tool.ts](../../packages/dsh-data-analysis/src/presentation/tool.ts) | 保留 `marivo_present` 名称，替换 Draft 输入和编排；新写入只走 Lang/资源路径 |
| [projection](../../packages/dsh-data-analysis/src/presentation/projection/index.ts)、[program.ts](../../packages/dsh-data-analysis/src/presentation/projection/program.ts) | 保留 bound Runtime 执行接缝，改为公开 schema 与分页读取，移除旧 `evidence_digest()` 依赖 |
| [presentation-kit](../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/__init__.py)、[typed codec](../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/_dataset.py) | 复用精确编码与现有预算，增加原执行进程内的数据集捕获；不复制一套编码实现 |
| [datasource/python.ts](../../packages/dsh-data-analysis/src/datasource/python.ts)、[Python 执行记录](../../packages/dsh-data-analysis/src/python-execution.ts) | 在现有成功执行回执处增加快照收据与原调用关联，继续使用原 Shell/凭据/取消边界 |
| [commit.ts](../../packages/dsh-data-analysis/src/presentation/commit.ts)、[reports.ts](../../packages/dsh-data-analysis/src/presentation/reports.ts)、[build](../../packages/dsh-data-analysis/src/presentation/build/index.ts) | 复用 Build 文件、原子提交、历史和 current 条件更新；这些函数目前耦合旧 Document 类型，需要局部适配，不能原样套新 envelope |
| [files.ts](../../packages/dsh-data-analysis/src/presentation/files.ts)、[rpc.ts](../../packages/dsh-data-analysis/src/presentation/rpc.ts) | 复用 Workspace 文件读取、路径预算和 RPC，增加新文档/快照读取分支，不另建文件服务 |
| [DatasetTable](../../packages/dsh-data-analysis/src/client/presentation/table.tsx)、[chart-renderer](../../packages/dsh-data-analysis/src/client/presentation/chart-renderer.tsx) | 提取或适配纯呈现、精确格式化代码；首期复用表格，图形在后续按需求接入，不包装整个旧 Reader |
| [client.tsx](../../packages/dsh-data-analysis/src/client.tsx)、[right-tabs](../../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)、[delivery](../../packages/dsh-data-analysis/src/presentation/delivery.ts) | 增加 marivo_present 的 tool view，改造已有报告 tab；保留持久事件和 PTC 归属接缝 |
| [plugin-agents.ts](../../packages/dsh-data-analysis/src/plugin-agents.ts)、[presentation Skill](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/SKILL.md) | 更新触发策略、引用呈现、Lang 与 patch 指导，删除新路径的 Draft 必经步骤 |

初稿核对时开发依赖固定 Harness `0.1.7-rc.1`；设计参考过的相邻 Harness 源码不能直接证明该安装基线具备所需接口。另一个 [0.2.0 集成设计](dsh-0.2.0-integration.md)也尚未实施。P0 核实本任务真正需要的公开接缝，必要时调整本插件一致的依赖基线，不把该设计中的其他功能一并纳入。

## 阶段总览

| 阶段 | 交付内容 | 与设计的对应 | 完成后可证明什么 |
| --- | --- | --- | --- |
| P0 接缝确认 | 固定依赖、最小 Catalog/流/读取探针 | S0 | 选定安装版本能支撑后续接线，关键缺口明确 |
| P1 统一数据入口 | Frame Reader、DataFrame 捕获及快照格式 | S1 数据部分 | 两类真实结果可精确、有限地保存和恢复 |
| P2 统一呈现闭环 | 8 组件、新文档保存、默认引用、双位置 | S1 呈现部分 | 同一真实结果能从 marivo_present 保存、展示和重开 |
| P3 流式、增量与使用指导 | 真实参数流、官方 patch、精简提示、首期验收 | S1 完成 | 首期面向用户的完整路径成立 |
| P4 按需求增加图表与元数据 | 优先 line/bar 与来源/证据入口 | S2 | 对实际开放的能力逐项证明正确性 |
| P5 独立增强 | 离线导出、特定实时来源、旧格式转换等 | S3/S4 | 每个被选择的增强独立交付，不拖入首期 |

阶段按依赖推进，不为每个阶段建立新的长期功能开关、发布包或文档协议。实施提交可分阶段审阅，首期对用户开放以 P3 的完成条件为准。

## P0：确认三个关键接缝

### 阶段任务与实现方式

1. **固定依赖与接入范围。** 在本插件中直接声明 OpenUI 固定版本，以设计核对过的 `lang-core/react-lang 1.0.1`、`react-ui 0.18.1` 为探针起点，使用仓库指定的 Node.js 22.19.0 和 `npm install` 更新依赖/lockfile，检查 React 与当前构建兼容性。核对实际安装的 Harness tool view、tab、`PartialArguments` 和 PTC 事件；只有缺少必要公开接口时才调整本插件依赖及 peer 声明，不修改 Harness 源码。
2. **建立可继续使用的最小 Catalog。** 在本仓库放置派生 library 和生成入口，以两个占位领域组件验证 8 组件子集、root、Card/TabItem 子 slot、Host 纯 schema 与 Client library。占位组件随后由 P2 完成，不搭独立 demo 工程，不从相邻仓库运行生成脚本。
3. **验证实际数据与生成流。** 在选定安装 Runtime 中保存/恢复一个小 Frame，调用 schema/read_page；执行一条小型 raw_sql，核对公开值和来源字段。在真实 Host 观察一段 Native program 参数流及一次 PTC dispatch，确认插件能取得的数据，而非只检查类型声明。

### 验收标准

- 本插件在未安装 Intelligent UI 的 Host 中加载；8 个组件的声明可生成一致的 Host/Client 契约，Frame/Dataset 可进入允许的父 slot。
- 安装 Runtime 的小 Frame 可恢复并分页；RawSqlResult 的公开数据可读。结果记录实际包位置/版本，不能只写 `0.6.0.dev0`。
- Native 能取得真实 program 前缀，PTC 的实际粒度记录清楚；官方合并通过一个新增/修改/移除的组合样例。

P0 留一份简短的版本与探针结果即可，后续复用相同样例。若必要公开接缝缺失，写明哪个阶段受影响；不靠扩展到相邻仓库或构造第二套协议解决，也不继续堆积无关探针。

### P0 实施记录

已固定 OpenUI 依赖，将 Harness 开发／peer 基线提高到 `0.2.1-rc.2`，落地八组件派生 Catalog、纯 Host 契约及组合／patch 测试。在未安装 Intelligent UI 的隔离真实 Host 中观察到 Native program 前缀和成功 PTC dispatch；按用户指定的本地 wheel 安装独立 Runtime，完成 Frame schema／分页与 raw_sql 公开字段验证。领域组件保留占位，原 `marivo_present` 路径不变。准确版本、wheel 摘要、执行入口、证据与后续缺口见[简短验收记录](../testing/unified-analysis-ui-p0-2026-10-28.md)。

## P1：打通 Frame 与 DataFrame 的数据入口

### 阶段任务与实现方式

**Frame 路径。** 改造现有 projection：恢复准确 Session/Artifact，先读 schema，再按视图需要选列和读取必要页。将实际 layout、完整坐标、精确值、已读范围转换成统一投影。首期复用当前 typed dataset 的规模预算和支持类型，超出时保存明确预览或返回范围诊断，不自动读取所有页。无需模型管理 cursor，也不从私有文件重建分页。

**Dataset 路径。** 按 2026-10-28 用户最新决策，presentation-kit 的 `capture_dataset(frame)` 只接受
pandas DataFrame，不支持 RawSqlResult。复用现有 scalar codec 与受控文件写入，保留 DataFrame 已有精确值；
不负责结果转为 DataFrame 时的推断或精度修复，也不推断 SQL/datasource 元数据。

**同次执行回执。** helper 在原 Python 执行中写入 Workspace 的受控快照文件。为现有 Python worker 增加一个可选的本次捕获收据回传，Host 在执行成功后读取并绑定文件、Workspace、调用及 codeRef，返回 `snapshotRef`。使用已有文件接缝和明确的结构化清单，不从任意 stdout 或 `.show()` 文本猜结果，不增加模型工具调用或后台扫描服务。未调用捕获 helper 的执行保持原路径。

**统一快照。** 共用字段、精确值、范围和来源编码；Frame 保留自身坐标与可用分析信息，Dataset 不填造 axes、Evidence 或语义身份。DataFrame 保存总行数、捕获行数和明确范围；SQL/datasource 来源为 not-captured，business coverage 为 unknown。UI 捕获预算不能替代原分析的规模控制。

**首期元数据。** 只接通表格所需结构、实际来源与范围说明。完整 Evidence/Findings 浏览、lineage 与当前语义对象导航放入 P4；首期有明确的尚未接入/不可用状态，不为收集可选信息增加多次 Python 启动。

### 验收标准

- 同一个持久 Frame 经 schema/分页得到预期列、精确值、坐标和范围，未走原来的全量 `frame.to_pandas()` 后截断路径；默认呈现的数据读取可在一次 checked execution 内完成。
- 一个真实 DataFrame 在原执行内捕获，原 Python 进程结束后仍可读取快照；调用归属与捕获范围保留，读取不重新执行分析。
- 用一组有代表性的值覆盖 NULL、Decimal、大整数及空结果；预览只保留一行时不误判为完整单值。已有 codec 已覆盖的情况直接复用其测试，不重写另一组同义测试。
- 一份带正确引用的快照可读；捕获失败或必要数据读取失败有明确错误，不返回成功引用。manifest 写入失败独立于原执行结果报告。
- Review 回归覆盖时间轴边界、ns 时间值的实际精度、未选中不支持类型与完整键检查；不缩窄原 scalar codec 的支持范围。
- 旧 Evidence 入口不再是新 Frame 数据读取的前置条件。

P1 已落地 `AnalysisSnapshot` v1、有界 Frame Reader、DataFrame capture、Host 执行记录绑定及只读快照恢复。
helper 已升至 1.2.0；新快照尚未接入 marivo_present/Build/Client。实际版本、检查与支持范围见
[P1 验收记录](../testing/unified-analysis-ui-p1-2026-10-28.md)。

P1 不需要浏览器验收或全数据源矩阵。一个本地真实 Runtime 样例配合 codec/读取测试足够证明该阶段；性能只观察样例是否符合现有预算，不新建 benchmark 项目。

## P2：统一保存、组件与双位置呈现

### 阶段任务与实现方式

**文档与保存。** 在现有 `presentation/contracts` 附近增加新 envelope 的单一类型声明，保存 program、Catalog identity、resources 和实际快照依据。设计中的 documentId 对应现有 reportId，revision 对应 buildId；对模型只提供一个可解析这对身份的 recordId，不新增一套 ID 数据库或全目录检索。

在现有 build/commit/reports 中局部拆开文档解析、序列化与内容格式判断，继续使用现有不可变 Build、current 条件检查和历史服务。新版本保存时将快照内容放入 Build 管理的文件/附件生命周期，不能长期依赖一次执行的临时目录。旧文档按自身版本交给旧只读 Reader；新写入不再生成 block Draft。不建设自动迁移引擎。

**一套组件。** 完成 P0 的两个占位组件，共用 `DatasetTable` 的精确呈现与一个单值视图。AnalysisFrameView 增加 Frame 结构和来源入口，DatasetView 显示 SQL/文件来源及范围。首期仅实现有用的表格选列、本地排序、翻页、复制和范围提示；图例、点选等随图形阶段接入。对外仍是 8 个组件，内部控件不注册为模型节点。

**一个 Surface、两个薄适配器。** 新共享 Surface 只接收文档、运行上下文和已保存资源读取回调；tool view 负责准确调用的挂载，右侧 tab 负责标题、地址与打开。组件不直接访问 Store、MCP 或任意 URL。先用所属视图内的普通 React 状态保存必要阅读状态，位置切换可重挂同一组件；没有 live 写入需求时不做活动实例竞争、跨窗口同步或通用控制器。

**替换 marivo_present 的输入编排。** 默认单 Frame/数据集快照分别展开成 AnalysisFrameView/DatasetView；自定义页面直接接收 Lang。表格 rows 不进入 program。按声明的 surface 保存并交付，默认 tool，明确报告/dashboard 为 tab。保持原结果回执、PTC 归属和 Headless 行为；读取失败不生成成功文档。

**最小辅助入口。** 提供一个按准确 recordId 读取 UI 定义与必要 schema 的 `marivo_ui_read`，供基版本上下文缺失时使用，不默认回读。8 组件的紧凑签名由同一 Catalog 生成并放入按需 presentation Skill；首期先不建立通用 Catalog 搜索工具，只有实际出现无法用已有披露覆盖的查询需求时再增加定向 `marivo_ui_catalog`。

### 验收标准

- 两个真实结果各自只传引用即可保存和展示；同一已保存版本在 tool view 与 tab 中数据、精确值和组件一致，切换不重新分析。
- 一个 Stack/Card/Tabs 组合覆盖两类数据组件与合法图片，窄 tool view 和宽 tab 均可读；未支持组件不能借嵌套 slot 绕过准入。
- 重开及一次冷重启后可读取保存的快照；原 SQL 连接关闭不影响查看。错误引用或必要数据读取失败不会覆盖旧版本。
- 新旧文档按明确版本分派，旧文件保留。首期新格式不支持的导出/发布/旧编辑入口应明确不可用，不能传给旧 block Reader 假装兼容。

P2 是新静态呈现闭环，不是首期最终交付。流式生成与 patch 接线继续在 P3 完成；不为中间阶段对用户维护第二条长期创建路径。

## P3：流式、增量更新和首期交付

### 阶段任务与实现方式

**真实生成流。** tool view 从所属 Native ToolCallBlock 的公开 PartialArguments 读取 program 前缀，交给同一 Renderer。生成途中仅显示可解析内容、已授权基版本快照和占位，不发起新业务读取。自定义 program 的指导将 surface、basedOnRecordId 和资源声明放在前面，有利于尽早确定目标；元信息未确定时保留准备状态。默认引用模式直接生成短 Lang 并显示真实读取进度，不制造字符动画。

报告使用绑定准确 call 的临时候选 tab；保存成功后转为准确 recordId。失败或取消时保留旧成功版本，新建候选明确未保存。tool view 不同时挂载第二份报告 Renderer。PTC 沿用真实 dispatch/结果归属，不解析 run_code 源码或模拟不存在的子调用参数流。

**官方增量。** `basedOnRecordId` 存在时，将完整到达的 patch 用固定版 `mergeStatements` 合并到准确基版本；对合并后的完整文档执行一次正式校验、资源计划和条件保存。相同资源的展示修改复用原快照，不重新启动 Python。半截 patch 不进入正式合并，不覆盖 current；新版本独立可读，不要求历史 patch 回放。现有保存冲突检查继续承担并发保护，不再增加一套锁或自动重试算法。

**简化模型路径。** 同步 Agent 提示、presentation/files Skill 及相关示例：先判断 UI 是否有帮助；默认传引用；自定义时才学习 Lang；更新只提交变化语句。首次确需保留 SQL 结果时在原分析脚本中使用 capture；不为每条 SQL 强制捕获。已知基版本和签名时不查询辅助工具，不要求先大纲后补全，也不要求保存后再读。按实际结果检查一次披露量与调用轨迹即可，不建设提示评测平台。

默认引用用法直接由工具 schema 和简短呈现指导提供，不为单结果呈现强制额外读取 presentation Skill；只有编写自定义 Lang、捕获新的结果类型或修改页面需要更多说明时，才按需加载对应内容。

**完成分发与文档同步。** 新 Python helper 按现有 presentation-kit 构建方式更新 wheel、版本/身份检查和分发清单；OpenUI client 资源进入本插件构建，纯 Host 校验不导入 React。更新架构、相关模块文档、使用说明和验收记录，保证原 Draft 示例不再指向新写入路径。只读旧 Reader 保留在明确的旧格式入口。

### 验收标准

在未安装 Intelligent UI 的同一真实 Host 中，用下节的小型验收流程确认：

- 简单答案未被强制转成 UI；默认结果呈现不增加 Catalog/UI 回读工具调用。
- Native 自定义 UI 在完整参数结束前已有正文逐步出现，tool view 和 tab 使用同一机制；最终静态页面不能替代该证据。
- 对已保存页面只发送一条修改语句即可产生正确新版本，原数据不重读；中断或失败不破坏上一成功版本。
- 原 DataFrame 结果、Frame 结果和 PTC 交付可恢复；历史不抢焦点，Headless 回执不声称已打开 UI。
- 本插件构建、打包和安装不依赖相邻 Intelligent UI 仓库。P0–P3 的必需项全部完成，才将设计 S1 标为完成。

## 最小验收与测试安排

### 使用一组持续复用的样例

选一个小型本地数据集，生成一个带坐标的持久 Frame 和一个 DataFrame；包含 Decimal、大整数、NULL，以及一个有明确范围的预览。各阶段复用这些结果与快照，不为每个验收项重新分析或另建环境。

| 验收内容 | 最小证据 |
| --- | --- |
| 编码与读取 | 复用/补充现有 codec、projection 测试，检查精确值、字段/坐标、范围与空结果；一个真实 Runtime 回合证明公开接口已接通 |
| Catalog 与提交 | 一份覆盖首期组件组合的 fixture，加一个未支持组件用例；一次真实保存/读取与已有冲突用例覆盖新文档分支 |
| 使用策略 | 真实模型一次简单问答、一次需要比较/查看的数据结果；记录是否合理选择 UI、是否出现无意义的额外工具调用 |
| 双位置与 streaming | 用同一批结果在 tool view、报告 tab 呈现；记录 Native 完整参数前的实际 UI/事件，再核对最终数据。不用拼接假流证明真实集成 |
| patch 与恢复 | 修改一处说明并确认 rows 未重读；一个中断/保存失败用例保留原版本；同一会话重开后仍可读 |
| PTC 与兼容入口 | 一个实际 PTC 子调用的交付/重开；一个原有文档只读打开。无需为每个数据源重复整套流程 |

与数据编码、保存和调用归属有关的接缝需要自动化测试；颜色、间距和简单文案不单独写镜像测试。保留已有身份、撤销、路径和生命周期检查，对新分支补一个能暴露真实问题的代表用例，不重写通用文件安全或 Harness 内部测试。

### 执行检查的节奏

- 开发中运行所改模块的相关测试；presentation-kit 使用其现有 uv/pytest 环境，并通过现有 Runtime/wheel 契约检查回传。
- 每个可交付阶段运行仓库要求的 `npm run check`；涉及 client、exports、包元数据或分发时运行 `npm run build`、`npm run verify:plugin-package`。
- P2/P3 沿用现有 presentation/right-tabs 验证脚本，必要时扩充同一 driver。真实 Host 的首期综合验收集中在 P3；修复某个失败后重跑受影响路径，不因文字或布局微调重跑整个真实环境矩阵。
- 记录版本、执行入口、代表结果和未覆盖边界。单测、真实 Runtime、真实模型/Host 的证据分别标注；不上推为其他浏览器、数据源或模型的资格证明。

不新增全模型评测、故障注入平台、属性测试大全、长时间压力测试或多浏览器 × 多模型 × 多数据源的交叉矩阵。只有实际缺陷或明确支持范围要求，才扩大验证。

## P4：图表与元数据按需增加

### 阶段任务与实现方式

首先接入实际报告需要的 line/bar，复用现有 Recharts 和精确 tooltip。图形在 AnalysisFrameView/DatasetView 内部增加已验证的 view 枚举与映射，不同时开放整组官方图表，也不更换引擎。每次只接入有真实样例的图形；area/scatter/pie、复杂坐标和特殊图形随后按需求加入。

Frame 元数据按公开接口读取 Evidence/Findings/methods/lineage，界面先用组件内的简单详情入口。复用 slots/layout/完整键核验已读证据范围；没有准确关系就展示原事实，不推断点级证明。当前语义对象通过已有浏览接缝按需导航，不做语义版本库、历史定义恢复或自动漂移检测。DataFrame 快照不补造查询来源，不因接入图形而变成 Frame。

### 验收标准

- 每种新图形用一个真实、有明确粒度和完整范围的样例，确认字段映射、图形、精确 tooltip 与表格一致；一个不满足完整性/唯一性的例子被正确拒绝。
- 元数据使用一例有准确关联、一例缺失/范围不足的结果；缺失信息不阻塞已有结果，已读证据不冒充全集合检索。
- 更新同一 Catalog 和生成说明后才开放；不要求先完成设计中的所有图形或元数据能力。

## P5：独立增强，不自动成为首期任务

以下工作按真实需求单独选择，不必一起实施，也不要求先搭通用框架。

| 增强 | 最小实现 | 完成标准 |
| --- | --- | --- |
| 新格式离线 HTML | 复用同 Catalog/Renderer，把组件资源和所需快照打包，替换为本地只读资源上下文 | 断网打开仍有同样的精确数据与支持组件；在线动作明确不可用。通过后才接现有下载/发布入口 |
| 一个实际 MCP/HTTP 实时来源 | 为该来源增加一个只读适配函数，使用 Harness 已有连接、身份和授权，返回同一数据投影 | 验证其真实调用、参数绑定、取消和失败行为；不把 annotations 当授权，不为单个来源搬入通用 Provider 发布系统 |
| 更大 Frame / 在线续页 | 在现有 Reader 上增加显式续读和必要分块；只扩展被真实数据量要求的预算/交互 | 保存范围与临时读取范围清楚；实测读取成本；不会自动无限读取或用虚拟滚动冒充后端分页 |
| 旧文档转换 | 对确有保留需求且能准确映射的旧格式做显式转换，保留原文件 | 支持内容有对应新版本，不能转换的逐项说明；不自动重跑分析或静默丢图形 |

新格式导出若成为用户首要需求，可以先于 P4 的全部图形增强完成；实时来源不是导出或普通快照展示的前置条件。

## 保留的约束与本次不做的设计

最小实现仍需守住四条实际边界：数据精度与范围不造假；只读取所属 Workspace/调用已准入的资源；失败/中断不覆盖已保存版本；来源缺失不伪装成证明。分别在 codec/Reader、Host 资源准入、现有保存服务和组件说明处处理，不在每个组件重复建防护层。

首期不实现通用 provenance 图、语义对象版本控制、自动推断业务覆盖、跨窗口状态同步、Exactly-once 交付、任意远程组件、Catalog 自动安装或整套 live Query 平台。预算先复用现有常量；Catalog 只服务已验证的组件，不把未来参数提前塞进模型提示。

## 文档同步与交付记录

实施过程中，当前行为仍以代码为准，不能因为本文有计划就改写为“已支持”。P3 同步相关模块文档及[验证指南](../validation.md)，按阶段记录完成项、实际证据与剩余工作；P4/P5 只更新实际开放的能力。

已复核：[presentation-delivery](../modules/presentation-delivery.md)与[当前类型](../../packages/dsh-data-analysis/src/presentation/contracts/types.ts)均为 Document v3、Receipt v2；初稿记录的版本差异已过时，不应据此设计新 envelope。其他上游说明差异与来源边界见[设计文档的一致性记录](unified-analysis-ui.md#待验证边界与文档一致性)。

初稿仅产出实施计划与设计索引。后续 P0/P1 已完成各自记录范围；P2/P3 仍按本文完成条件推进。
