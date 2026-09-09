# 第二阶段上下文接缝与披露优化调研

## 结论

第二阶段值得实施，但应把交付目标收敛为：**让用户准确地把当前阅读对象带入提问，让必要规则在正确的模型请求中生效，并用请求级证据决定是否优化披露。** `systemPrompt.context` 只是候选接法，不应成为必须采用的阶段目标。

综合价值、可行性与现有实现，建议如下排序。优先级表示本阶段的相对顺序，不是事故等级。

| 候选工作 | 价值 | 可行性与主要成本 | 建议 |
| --- | --- | --- | --- |
| 修正显式 Skill 激活首请求的规则可见性 | 高：已有可复现的接线缺口 | 能在插件公开接缝内处理；必须覆盖两种激活时序 | 优先实施 |
| 补全报告上下文身份、减少重复配置并设置单次追加预算 | 高：准确回指报告，直接控制输入体积 | 主要在纯展示投影和输入适配层，成本较低 | 优先实施 |
| 语义对象详情增加“加入提问” | 高：把浏览、理解、提问连接起来 | 原生 chip API 已有；需补浏览绑定到 Agent 引用绑定的交接，成本中等 | 独立交付 |
| 共用输入身份校验、坐标与 revision 处理 | 中：使上述入口一致 | 已有实现可提取，成本较低 | 随真实第二入口实施 |
| 请求级披露与 token 基线 | 高：避免凭感觉优化 | 已有六条真实模型流程和 usage 接缝，可增量扩展 | 在改变 prompt 内容前完成 |
| 缩短重复的插件指导 | 中：可能减少常驻指令成本 | 必须区分 Harness 凭据规则与 Marivo 分析语义，需模型对照 | 有条件实施 |
| 内存事实 `systemPrompt.context` 原型 | 中低：有助于辨别已知绑定状态，节省未证明 | 缺少同步状态投影，存在激活时序、失效与快照成本 | 通过价值门槛再实验 |
| 任意页面选中文本入口 | 中低：方便摘录，但缺少具体使用场景 | DOM 选区归属、导航、截断与键盘操作增加成本 | 后置到报告 Markdown 摘录确有需求时 |
| 完整 Help/Catalog 常驻、插件维护能力摘要、通用上下文框架 | 低或负：重复权威并扩大维护面 | 接口可调用不代表有合理产品收益 | 不纳入 |

## 调研范围与证据等级

本记录对应 [重构设计的第二阶段](dsh-alpha-refactor-design.md#第二阶段统一上下文接缝并降低重复披露)。核查日期为 2026-09-09，插件 HEAD 为 `cac809a`，安装的 Harness 关键包为 `0.1.5-alpha.1`，Node.js 为 `22.19.0`。本地 Harness HEAD 为 `5dda764ed3`；判断运行顺序时优先采用实际安装包。Marivo checkout HEAD 为 `39e3ac7e`，下述既有模型记录使用的安装版为 `0.5.4`，两者不混作同一运行基线。

调研开始时，语义引用标签等文件已有未提交修改；过程中该组工作继续变化。本文只新增调研记录，不修改这些实现，不重装插件或重启 Web。语义入口的实施需要与该组工作协调。

证据区分如下：

- **本轮源码核查**：插件、安装的 Harness 类型与实现、相关本地上游源码及公开文档。
- **本轮运行验证**：54 项相关确定性测试通过；两个独立探针分别验证合法报告的上下文体积，以及真实 Harness loop 中显式激活首请求的可见性。探针不调用远端模型、不读取业务数据。
- **既有验收记录**：第一阶段真实 Web 和兼容升级模型流程，只用于说明已有能力与评测起点，不算本轮重新验收。
- **建议与待验证项**：下面的预算、拆分与实验设计尚未实现；没有第二阶段 A/B 结果，也不预估 token 节省百分比。

## 已有能力不应重复建设

### 报告追加已经使用正确的 Host 操作

`appendPresentationContext` 已检查当前 Session、Workspace 列表状态和成员关系，使用所属 scoped action；它从最新 `draftRev` 与 `occurrences` 计算检测坐标，把每个原子引用视为一个字符，然后调用 `slash/input-insert-text`。写入失败会报错，没有整段重写或自动重试。[1]

现有真实 composer 验收脚本已覆盖两个相同语义引用的独立 occurrence、附件保留、追加后撤销，以及失败时保留报告和草稿。因而“升级成富文本安全追加”不是第二阶段的新功能；本阶段应补新入口、边界用例和当前原生 Tab 路径的验收。[2]

### Help 已有有效去重和恢复机制

`MarivoDisclosureController` 用 `environmentFingerprint + target + bodyDigest` 判断正文是否已可见。重复 focused Help 仍实时读取，内容相同返回 `already-visible` receipt；compaction 隐藏正文后重新披露。普通问题不激活 Help，同名 Agent-local `skill` shadow 不被当作可信激活。[3]

还应区分三种成本：**再次读取 Help 的子进程成本、新增重复正文的成本、历史中保留正文随请求进入模型的成本**。当前已经控制第二种；缓存正文会改变第一种的实时性，迁移到 context 也不会自动消除第三种。不要将三个问题归为“重复披露”。

### 现有 system section 基本是规则，不是待迁移的运行事实

插件目前注册三段：常驻 presentation Skill 路由；Marivo Skill 激活后的 datasource/credentials 执行规则；analysis 激活后的收尾检查。没有整个 Catalog 或长 Help 常驻 system prompt。因此现阶段没有一大块动态事实可以直接搬到 context 获益。[4]

## 优先修正的正确性缺口

### 显式 Skill 激活的首请求缺少对应 section

安装版 Harness loop 的顺序是：claim inbox → `systemPrompt.assemble()` → runtime context 投影 → `agent/pre-step` waterfall。插件在最后一步的 `prepareStep()` 中识别 `skill-invocation` 并更新 `activeSkills`，而条件 section 的 text 回调此前已经求值。[3][5]

本轮复用现有测试的 mock adapter、fixture Help 和真实 Harness loop，安装生产 `installMarivoPlugin`，分别运行以下输入。首个请求的观察结果一致：

| 激活输入 | 请求数 | root Help 在首请求可见 | credentials section 可见 | analysis closeout section 可见 |
| --- | ---: | --- | --- | --- |
| 直接提交结构化 `skill-invocation` | 1 | 是 | 否 | 否 |
| 下游 pre-step producer 追加 `skill-invocation` | 1 | 是 | 否 | 否 |

这是接线可见性问题，不是已证实的凭据泄露或模型错误操作。底层执行与凭据校验仍有独立责任。当前测试覆盖“显式激活会交付 root Help”，也覆盖“模型调用 skill 后的下一步出现规则”，但没有将这两项组合为显式激活首请求断言。[3][4]

**最小交付要求**是：该请求收到激活 Skill/Help 时，也收到必要的插件执行要求；不等模型再请求一次。直接 inbox 路径可以提前观察结构化激活，但只加 `agent/inbox/claimed` 无法覆盖在 pre-step 才产生的 invocation。

建议先以两条探针固化回归，再选择公开接缝方案。可在晚激活的当次 Help 消息中伴随有界执行指导，后续继续使用原 section，并明确去重；也可评估将最短的通用执行安全规则改为稳定 section。两者都有内容成本与规则归属取舍，不能通过调用 context 自动解决。不要重复运行整个 Host prompt 组装，也不要修改私有 loop 状态来“赶上”首请求。

验收必须同时检查首请求的实际 messages、后续请求、普通不激活问题、同名 Tool shadow、双 Skill、拒绝/取消和恢复；仅检查 `activeSkills` 最终值不够。

## 报告上下文：最确定的输入收益

### 缺口与可量化成本

`followUpContext` 包含 title、Build ID、Workspace、cell 和来源，但没有输出 `document.reportId`。它会完整写出筛选后的 `Snapshot row indices`；Markdown cell 写出整个正文。图表先写 `Saved chart binding`，随后又写 `Block binding`，原始视图下两者相同；探索时 current binding 也存在重复表达。[6]

现有报告协议本身有上限，包括 5,000 行、单文本 32,768 字符、document 4 MiB；但这不是适合单次提问的预算。本轮用 `interactionFixture()` 构造数据，并经过 `parsePresentationDocument()`，测得：

| 合法输入 | 单次 context UTF-8 字节数 | 主要体积来源 |
| --- | ---: | --- |
| detail table 的筛选 slice 包含 5,000 行 | 24,358 | 行号一行 23,913 字节，占约 98.2% |
| 一个含 32,768 个汉字的 Markdown cell | 98,451 | 完整 Markdown 正文 |

这些是受控边界输入的字节测量，不是生产分布或模型 token 测量。复现方法是扩展 fixture 的 detail rows 与每个 slice 的对应 rowIndices 到 5,000；Markdown 则追加独立固定 cell，正文为 `'中'.repeat(32768)`。两种输入都先经过现有 parser，再调用 `followUpContext`。[6][7]

### 经实施讨论修订的 2b 范围

2026-09-09 的实施讨论将目标从内容摘要调整为**精确引用与降低定位成本**。报告按不可变 Build
保存，Agent 可使用普通 Workspace 文件工具读取；上述边界测量仍描述旧实现，不作为新上下文的内容需求。

引用提供实际显示 document 的 Workspace、Report ID、Build ID、Cell 和固定 Build `presentation.json`
相对路径；标题和已有 cell 标签只用于快速理解，各最多 80 个 Unicode 码点。正文、metric 数值、单位、
比较、列定义、来源与 authored binding 由 Agent 从文件读取，不复制进问题。

文件中未保存的显示状态必须携带：受影响 cell 的有效 filter/option ID 与短标签、prepared view ID、
hidden series、必要时一份完整当前 ChartView 覆盖，以及表格排序。筛选通过原 Build 的 slices 还原，
不输出行号；表格引用全部筛选结果，不限定当前分页。不新增行、数据点或文本选区入口。

12 KiB UTF-8 仅作为单次引用异常上限，包含包装与分隔符，不再设计 Markdown 摘录或行号压缩预算。
定位或临时状态不能完整容纳时明确失败，保留页面与草稿。重复点击仍表示重复追加，不去重或替换已有问题。
在线与离线复制共用格式与失败处理；单独分享 HTML 不保证另一 Agent 有原 Workspace 文件访问权限。

Agent 先读引用 Build，修改前另读 current 并沿用已有冲突契约；不能悄悄替换用户所指版本。
验收以真实 Harness 公开文件读取工具把报告内容带回模型请求为准，不把浏览器 URI 可打开当作读取证据。
详见 [2b 验收记录](dsh-context-stage-two-b-acceptance.md)。

## 语义对象“加入提问”：值得做，但不是一个按钮的工作量

### 共用输入操作，保留语义引用协议

语义详情目前只有“复制引用”；`@` 输入源已经能插入结构化 chip，并由 source codec 在提交时执行 serialize。Host 同时提供 `slash/input-insert-text` 与 `slash/input-insert-reference`，两者共享 `TokenSpan` 和 revision guards。[8][9]

建议详情增加“加入提问”，只把当前对象作为 chip 插入，不自动发送、不追加完整对象定义、不运行 observe。共用部分是所属 Session/Workspace 检查、最新草稿快照、末尾检测坐标和失败反馈；报告文字与语义引用保留两种具体操作。`appendPresentationContext` 的报告包装和错误文案继续属于报告层，不应直接拿来包装所有内容。

暂不建设可插拔的 context provider 注册表，也不要求 text + chip 多步插入原子化。首个语义交付只插入一个 chip，可以沿用一次 Host 编辑与一次撤销的保证。

### 必须先补齐绑定交接

`SemanticBrowserService` 按 Workspace 调用 `manager.resolve(root)`，不依赖 Agent。`@` candidates 则经 Agent `resolveEnvironment()` 填充 `bindings`；后续 selected/serialize 的 `purpose: 'reference'` 明确要求已有该 Agent 的 binding。[10]

因此用户只打开语义浏览页时，即使拿到了 Catalog 的 `environmentFingerprint`，也不能假定对应 Agent 已建立引用绑定。直接用该 fingerprint 拼 envelope 并插入 chip，可能直到提交时才遇到 `environment-unbound`。目前这是由代码路径证明的前置条件，尚未做新增按钮的真实 Web 复现。

合理的最小接法是为**显式加入动作**提供一个窄的引用准备操作：校验页面所属 Session/Workspace；复用当前 Runtime 建立或核对该 Agent binding；比较浏览快照与当前身份；返回既有 envelope，再插入一次 chip。提交时继续由现有 codec 核对身份。不要在 serialize 时自动给失效引用换绑定，也不要用匹配路径代替 Workspace 身份。

实现前必须选择并写清：旧浏览快照的对象是只保证身份连续，还是还需重新核验当前 Catalog 对象存在。当前 serialize 只核验 binding 并返回 marker，不能宣称它已有完整语义对象存在性或有效性校验。若补存在性检查，仍由 Marivo Catalog 元数据提供答案，不做插件语义推断。[10]

无 Session 浏览保持可用，“加入提问”只在目标 Session 与当前输入归属明确时启用。关闭页、导航替换、Workspace 撤销、延迟准备操作、提交中与旧 revision 均不得写入新上下文；失败应保留页面与草稿，并允许重试。常用引用计数只应在真实插入成功后更新，不能将点击失败算成成功使用。

## Prompt 与 Runtime context：先有使用价值，再决定机制

### context 的实际语义

Harness 的 context 贡献最终形成带来源的 user 快照。安装版 `RuntimeContextProjection.project()` 只在最新保留快照的完整文本不同时生成新消息；发生变化时生成的是**全部 context 的新快照**，不是单字段补丁。未变化时不新增消息，但已有快照仍在后续模型历史中；旧快照也不会因此立即从历史删除。Host 支持关闭或抑制 runtime context。[5][11]

由此可知，时间戳、每步耗时、随机排序或宽泛的动态可用性列表会制造变化，并可能连带重复其他插件的 context。安全规则和唯一的错误告知不能依赖可被关闭的 context。搬动文本前还要记录实际 provider 的 `systemPromptUpdate` 能力：system 修改能否保留前缀缓存由 Host 路由和适配器决定，不应假设必然全量失效。[5]

### 当前能可靠披露哪些事实

| 事实候选 | 当前权威 | 建议 |
| --- | --- | --- |
| shared Runtime 已安装并经启动验证的版本 | `ensureSharedMarivoRuntime` 结果 | 已在 Help 提供；先证明重复提供能帮助决策 |
| 当前 Agent 激活的 Skill 名称 | disclosure controller | 可同步读取，但激活时序必须先修；名称通常与已收到 Skill 重复 |
| 当前 Session 的 Workspace 归属 | Harness Workspace registry | 可读；不要用磁盘 root 替代身份 |
| Agent Workspace binding 的未建立、进行中、完成或失败 | `bindings` promise 与 `MarivoEnvironment.status` | 尚无完整同步投影，需要窄的只读状态记录 |
| 数据源“已配置凭据”或“可查询” | Credentials 与真实操作 | 不纳入：读取凭据不应发生在 context；配置不等于连通或权限 |
| “当前有哪些分析能力可用” | 实时 Marivo Help | 不新增插件摘要或注册表；激活 Skill 也不代表能力可执行 |

状态投影只能由原有解析与操作结果驱动，不得在 context 回调中 await binding、启动 Python、加载 Catalog、检查数据库或补初始化。共享 Runtime ready、Workspace 已登记、Agent binding ready、数据库可查询是四件不同的事。[4][10][12]

若有任务证明确实需要它，原型只做一个有界文本快照：已知绑定状态、必要的 Workspace 标识及少量已验证状态。内存状态随 promise 完成更新，以所属 Agent/绑定 revision 防止迟到写回；failed runner 不能永久保持 cached ready。未观测到变化只意味着“截至最近验证”，不是持续健康监控。上游无公开 revision 的语义内容不应伪造实时性。

### 缩短指导比迁移机制更值得先试

`MARIVO_ANALYSIS_CLOSEOUT_PROMPT` 中完整性、比较范围与证据强度检查，和 Marivo analysis Skill 的工作流有职责交叠；凭据段则大多是本插件特有的 Host 执行契约。可逐句标注所有者，对分析通则尝试引用 Runtime Skill，对凭据边界保留清晰的必要指令。[4][13]

这里仅有“可能重复”的静态证据，不能直接删除。特别是靠近收尾的提醒是否改善真实模型结果，需要比较任务输出；本地 Marivo checkout 的新 Skill 也不能证明部署中的旧 Runtime 已含相同指导。

## 评测设计与实施顺序

### 利用已有基线，补上请求级归因

兼容升级的既有真实模型报告生成于 `2026-09-09T05:46:26.248Z`，使用 `deepseek-v4-flash` 与 Marivo `0.5.4`。它记录了以下结果，尚不足以证明任何改动的收益：[14]

| 既有流程 | steps | 累计输入 token，含缓存读取 | root Help targets |
| --- | ---: | ---: | --- |
| analysis 激活 | 3 | 8,734 | analysis |
| semantic 激活 | 2 | 4,787 | authoring |
| 普通计算、不激活 | 2 | 2,794 | 无 |
| focused Help 去重 | 4 | 15,618 | analysis |
| 同轮双 Skill | 3 | 10,427 | analysis、authoring |
| 缺失数据源凭据时读取 Help | 2 | 5,887 | authoring |

这些数来自该文件的 `billedInputTokens`，表示该脚本汇总的输入 token 数量，并非货币账单。安装的 DeepSeek adapter 将 cache hits 从 `inputTokens` 中扣除，故应同时统计 `inputTokens` 和 cache counts。字段不可用时保留未知，不能在新评测中一律折算为零。[14]

现有六条 prompt 明确指令模型调用哪些工具、甚至要求重复 Help，因此适合接线验收，无法测量自然任务中的冗余调用倾向。另一个名为 `validate-help-disclosure-real.ts` 的脚本采用真实 Help + 脚本 adapter，usage 中有固定测试值，不能用作模型 token 基线。

建议对每个请求记录：首请求/后续请求、实际 usage、system 字节数、工具 schema 字节数、Skill/Help/context/报告上下文字节数、Help 读取次数与正文交付次数、必要规则是否可见，以及实际请求的 Runtime identity。通过公开 LLM 请求/usage 与 Session 事件采集，不解析 Host 私有持久化文件，也不复制整个 Session 或 Help 正文到诊断报告。

对照保留六条接线任务，并加入自然任务：解释固定 Build 的某个筛选指标；从语义详情插入对象后提问；显式 Skill 首请求；激活后多轮继续；compaction 后继续；Workspace 撤销或绑定失败。输入体积另用确定性大表、长文、长列名、多来源和精确数值 fixture 验证。

先比较原版与**单一改动**；固定 Harness/Runtime/model/profile、任务与工具模式，每组多次运行，交错顺序并记录缓存情况。样本很少时只报告逐次结果与范围。采用门槛是正确性与失败可见性不退化，并至少改善可归因的体积、调用量、延迟或任务表现；没有收益就保留原方案。

### 建议切成四个独立交付

| 切片 | 范围和责任 | 完成证据 |
| --- | --- | --- |
| 2a：当前请求正确性与报告身份 | 插件 disclosure 激活接缝；纯 reader 的 Report ID 与显示 Build 传递 | 两类显式 invocation 首请求规则齐全；current/固定 Build 追问身份准确；普通问题保持原行为 |
| 2b：报告 cell 精确引用 | 插件提供固定 Build/cell 读取定位及未保存显示状态，复用原输入操作 | 引用可经公开文件工具读取；临时筛选/探索/排序可还原；体积不随正文和行数增长；真实 Tab 中 chip、附件、撤销与失败保留 |
| 2c：语义对象加入提问 | 插件负责绑定与 chip 交接；Harness 拥有 editor/serialize 生命周期；Marivo 拥有对象元数据 | 未经 `@` candidates 的首次使用可成功；失效与跨 Session 拒绝；提交只经原 codec；浏览不执行分析 |
| 2d：披露对照与可选优化 | 扩展现有评测；只在证据支持时缩短指导或试小型 context | 请求级基线与对照；compaction、失败和配置抑制覆盖；可明确决定采用或放弃 context |

2a/2b 可直接进入详细实施计划；2c 先冻结显式准备操作与失效契约；2d 的基线采集应在任何 prompt 改写前完成，但不必阻塞报告输入改善。全部工作保持原生与 PTC 的既有工具可见性，不引入新的执行门禁。

## 本轮验证与限制

本轮执行以下定向验证，54 项全部通过：

```sh
node --experimental-strip-types --test \
  packages/dsh-data-analysis/tests/help-disclosure/*.test.ts \
  packages/dsh-data-analysis/tests/presentation-integration/ask-dsh.test.ts \
  packages/dsh-data-analysis/tests/presentation-reader/model.test.ts \
  packages/dsh-data-analysis/tests/presentation-reader/interaction.test.ts
```

这些既有测试通过，与首请求探针发现并不矛盾：现有断言没有覆盖“显式激活首请求的条件 section”。探针使用临时文件，完成后已清理；未保存模型凭据、未发送模型请求。报告体积探针使用合法的合成数据，不包含业务数据。

本轮没有重新运行真实 Web、真实数据库、远端模型 A/B 或插件构建；它们是后续可执行变更的验收工作。语义入口存在并行修改，实施时须基于届时源码重新核验相关接缝。该记录不将历史验收、源码可行性或脚本模型通过表述为第二阶段功能已完成。

## 来源与定位

以下本地源码按本轮检出或安装状态读取。GitHub 链接固定到 `dsh-v0.1.5-alpha.1`，不使用滚动主分支作为安装版事实。

1. [报告草稿追加](../packages/dsh-data-analysis/src/client/presentation/ask-dsh.ts)，`appendPresentationContext`；[单元测试](../packages/dsh-data-analysis/tests/presentation-integration/ask-dsh.test.ts)。
2. [真实 composer 验收脚本](../packages/dsh-data-analysis/scripts/presentation-s4/ask-dsh.ts)，`verifyAskDsh`；[第一阶段验收范围](dsh-right-tabs-stage-one-acceptance.md)。
3. [Help 激活与可见性](../packages/dsh-data-analysis/src/disclosure/activation.ts)，`prepareStep`、`resolveDelivery`、`installMarivoDisclosure`；[激活测试](../packages/dsh-data-analysis/tests/help-disclosure/activation.test.ts)；[Help 架构](modules/help-disclosure.md)。
4. [插件注册与条件 prompt](../packages/dsh-data-analysis/src/plugin.ts)，三个 prompt 常量、`installMarivoPlugin` 与 `apply`。
5. Harness，[agent-loop 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/core/agent-loop/src/index.ts)、[runtime-context 投影](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/core/agent-loop/src/runtime-context.ts)及[公开说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/core/agent-loop/README.zh.md)；本轮同时读取安装包 `lib/index.js` 的 `preStep` 与 `RuntimeContextProjection`。
6. [上下文格式化](../packages/dsh-data-analysis/src/client/presentation/model.ts)，`followUpContext`；[现有上下文测试](../packages/dsh-data-analysis/tests/presentation-reader/model.test.ts)。
7. [报告预算和类型](../packages/dsh-data-analysis/src/presentation/contracts/types.ts)，`PRESENTATION_BUDGETS`；[合成 fixture](../packages/dsh-data-analysis/tests/presentation-reader/interaction-fixture.ts)；[文档 parser](../packages/dsh-data-analysis/src/presentation/contracts/index.ts)。
8. [语义浏览详情](../packages/dsh-data-analysis/src/client/semantic-browser/panel.tsx)，`ObjectDetail`；[语义输入源](../packages/dsh-data-analysis/src/client/semantic-reference-source.ts)，`onPick` 与 `codec.serialize`。
9. Harness，[conversation 输入公开类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/client/ui-conversation/src/client/contract/input.ts)，`InsertReferenceRequest`、`InsertTextRequest`、`TokenSpan` 及 scoped events；安装包同名 `.d.ts` 已核查。
10. [语义浏览服务](../packages/dsh-data-analysis/src/semantic-browser/service.ts)，`SemanticBrowserService.read`；[引用服务](../packages/dsh-data-analysis/src/semantic-reference/rpc.ts)，`SemanticReferenceService`；[envelope 与 model marker](../packages/dsh-data-analysis/src/semantic-reference/contracts.ts)；Agent resolver 见来源 4 的 `referenceService`。
11. Harness，[system-prompt 公开说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/core/system-prompt/README.zh.md)及[实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-alpha.1/packages/core/system-prompt/src/index.ts)，`context`、`suppressRuntimeContext`、`renderContextSections`。
12. [Workspace environment manager](../packages/dsh-data-analysis/src/environment/workspace.ts)，`resolve`；[binding 状态](../packages/dsh-data-analysis/src/environment/binding.ts)，`MarivoEnvironment.status`。
13. Marivo 本地源码 `39e3ac7e` 的 `marivo/skills/marivo-analysis/SKILL.md`，章节 `Bounded analysis loop`。用于职责交叠判断；不作为已安装 `0.5.4` Skill 内容相同的证明。
14. [兼容升级验收记录](dsh-alpha-compatibility-acceptance.md)；[真实模型流程脚本](../packages/dsh-data-analysis/scripts/validate-plugin-integration-delivery-real.ts)，`runJourney`、`usageTotals`；本地 `artifacts/plugin-integration-delivery-real-model.json` 的上述时间戳记录。该 JSON 被忽略提交，故关键观测抄录在本文；DeepSeek usage 口径另核对安装包的 `mapUsage` 实现。
