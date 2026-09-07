# Marivo 分析展示重构实施路线图

## 状态与交付目标

状态：2026-09-07 已完成 S0 的最小契约、fixtures 和实际接缝验证，见 [S0 验收记录](marivo-analytics-presentation-s0-acceptance.md)与[契约记录](marivo-analytics-presentation-s0-contracts.md)。S1 的一次 Python 执行准入已完成，access Tool 与跨调用 lease 已删除，见 [S1 验收记录](marivo-analytics-presentation-s1-acceptance.md)。S2 的数据投影、Python helper 与 Runtime 切换已完成，见 [S2 验收记录](marivo-analytics-presentation-s2-acceptance.md)。S3 的共享 reader、离线 HTML builder 与真实 Host/portable 验收已完成，见 [S3 验收记录](marivo-analytics-presentation-s3-acceptance.md)。S4–S5 尚未实施；旧 report-kit/Skill/JS 已删除，生产 presentation Tool/Skill/receipt/RPC 尚未接入。本文落实[重构设计](marivo-analytics-presentation-refactor.md)，不新增产品范围。

交付目标固定为 4 个 Tool（`marivo_help`、`marivo_datasource_test`、`marivo_python`、`marivo_present`）、1 个插件 Skill（`dsh-data-analysis-presentation`）、1 套 reader、一次 present 完成 Web 阅读与离线 HTML。两个 Marivo Runtime Skill 继续挂载，凭据管理保留，computed 仅展示声明来源。

采用破坏性更新：不做迁移、旧格式读取、别名、双协议或过渡发布。阶段用于拆分实现和验证，不代表逐阶段向用户发布。中间实现不用于重装现有用户 profile；最终只交付新契约。旧用户文件与历史记录不主动清理。

## 阶段、依赖与分工

| 阶段 | 目标 | 前置依赖 | 阶段产出与完成门槛 |
| --- | --- | --- | --- |
| S0：契约与接缝验证 | 用最小样例证明数据、Host 和离线路径可行 | 无 | 固定最小契约及 fixtures；实际验证 Artifact 读取、React/Recharts 加载、Native/Code receipt、文件读取与下载 |
| S1：一次 Python 执行准入 | 删除 access 与跨调用 lease | S0 的执行边界 | 多 datasource 就绪后只启动一次；凭据管理与 test 状态保持正确 |
| S2：数据与来源投影 | 形成 reader 可消费的纯数据 | S0 的文档/数值契约 | Artifact、computed、source-only 三类样例通过；新 Python helper 可在 checked Runtime 使用 |
| S3：reader 与离线构建 | 把相同数据变成可读结果 | S0；最终接入依赖 S2 | 五类 block、line/bar、来源面板与自包含 HTML，数据一致、离线可读 |
| S4：present 与 DSH 交付 | 一次调用闭合文件和 UI 交付 | S2、S3；数据源分析旅程还依赖 S1 | 新 Tool、同一种 receipt、只读 RPC、打开/下载、Native/Code/headless 通过 |
| S5：单一路由、删除与验收 | 只留下目标公共面和分发物 | S1–S4 | 新 Skill、旧接口/资产完全退出，安装包与真实 Agent/Web 旅程通过 |

关键依赖是 **S0 → S2 → S3 → S4 → S5**。S1 可与 S2 并行；S3 组件可先用 S0 fixtures 开发，但不能在接入 S2 前宣称数据闭环完成。

职责分配按模块，不按工具数量拆人：执行负责人拥有 `src/datasource/`；数据负责人拥有 presentation contracts/projection 与新 Python helper；展示负责人拥有共享 reader/portable 构建；集成负责人拥有 Tool/receipt/RPC、`plugin.ts`、`client.tsx`、`index.ts`、包清单、根脚本与最终验收。并行时其他负责人提交接线需求，由集成负责人统一修改共享入口，避免交叉覆盖。

以下路径除特别注明外，均相对 `packages/dsh-data-analysis/`。新增路径为计划位置，尚不存在的模块不作为已实现接口。

## S0：先验证四个真正的阻塞点

**状态：已完成。** 实际 bound Runtime 恢复读取、Native/both/worker Code dispatch、真实 DSH Web 模块加载/RPC/下载、下载文件断网及无脚本检查均通过。验证探针位于 `scripts/presentation-s0/`，未注册到生产入口。上游 float64 精度限制、Workspace 声明前提与 S2/S3/S4 的剩余工作见验收记录。

**实施范围**：小规模契约、fixtures 和可丢弃的接缝验证，不搭建完整展示系统。

1. 明确 draft、生成 document、typed dataset、source ref、receipt 五项最小结构：字段职责、版本、预算、错误位置和文件身份。只定义展示字段，不复制 Marivo schema 或建立新语义 registry。
2. 准备三个固定样例：一个真实 persisted Artifact 文档；一个 computed 文档，含两个声明来源及一个 unavailable 来源；一个没有 dataset 的 source-only 文档。加入 Decimal、大整数、null 和截断的代表性数据。
3. 在绑定 Runtime 用公开 API 恢复 Artifact 行与来源，证明不新增 observe、不需要为离线结果再次读取凭据。公开口径无法取得时明确 unavailable，不把补齐上游功能设为隐藏前置条件。
4. 在 DSH 验证最小 React/Recharts 图形、新 receipt 的 Native/Code 记录、受控文件读取与 Web 下载；另外构建一个断网可开的 HTML。

**需要提前决定的技术点**：

- 当前 `scripts/build-client.mjs` 使用 `packages: external`，并有 browser 输入路径白名单。确定 DSH bundle 如何携带 Recharts 等非 Host 依赖、仅复用 Host 的 React；纯契约模块可以进入 browser，Node/凭据代码不得进入。
- portable entry 使用同一 reader 源码，但将 React/Recharts 一并打包，不依赖 DSH module loader。两个构建入口不等于两套 renderer。
- receipt 明确 Workspace/build ID/文件 digest/文本摘要；Code mode 验证真实 dispatch 接缝，不用手工插入最终卡片证明交付成立。
- 不新增重型图表/文档依赖来完成 line/bar 与只读 Markdown；以当前构建器和最少依赖完成验证。

**完成证据**：三个 fixtures 与期望值、精确依赖/构建选择、Runtime 读取记录、Host 接缝验证和离线浏览器证据。仅 JSON 样例或静态架构图不算完成。没有条件运行的接缝标为未验证；依赖它的阶段不能宣称完成。

## S1：凭据准入并入一次执行

**状态：已完成。** 一次调用完成多 datasource 凭据准备、fresh snapshot 和唯一启动；取消、轮换、身份漂移、秘密脱敏及管理测试状态已有回归与真实接缝证据。真实 Agent 使用 fixture 提供的有效 Python 验证原调用续接；自然代码生成路由与完整 DSH Web 部署不作为本阶段已通过项，详见 [S1 验收记录](marivo-analytics-presentation-s1-acceptance.md)。

**代码所有权**：`src/datasource/service.ts`、`python.ts`、`resolver-program.ts`、`rpc.ts` 及相关测试；公共接线由集成负责人同步完成。

**实施顺序**：

1. 以内部 `prepareExecution` 一类操作替换先 `prepare('access')` 再 `claim` 的跨调用链，输入保留当前 exec 与精确 datasource names。
2. 在启动用户代码前完成所有 datasource 的缺凭据等待与身份核验，最后取得一次 fresh snapshot。配置齐全时不附加无意义的连接测试。
3. 保留空 resolver、datasource/field/ref 限制、stdin 注入、Shell/sandbox 政策、秘密清理、脱敏和取消。保留 subagent/headless 的非交互失败行为。
4. 删除 lease 发放、TTL、使用次数和 access 专属失败状态；保留管理 UI 的操作/请求历史、测试历史、版本变化和有界回收。

**同阶段删除**：`access.ts`、注册/导出、旧 access prompt、旧 lease 测试及失效的真实验证入口。不能把悬空调用者留到 S5，也不写临时 access 转发包装。`marivo_datasource_test` 及凭据管理 RPC/slots 保留。

**验收**：多 datasource 有一个缺失时启动次数为 0，全部就绪后为 1；取消、轮换或 Workspace 变化不执行旧代码；已启动代码失败不会重放；test 的 `lastTest/stale` 与管理 UI 一致。输出及错误中 secret canary 不泄漏。

**检查入口**：`test:datasource-credentials` 已改验本次执行准入；新增 `validate:datasource-execution:real`，旧 access 命令已删除。`validate:datasource-credentials:real` 和 `validate:credentials:web` 保留有效的执行与管理用例。以上命令均已接入根脚本并实际运行。

## S2：数据投影与最小 Python 帮助库

**状态：已完成。** Artifact/computed/source-only 投影、共享 typed JSON 校验、新 Python writer、Runtime v3 identity 与安装包切换均已实现；真实 persisted Artifact 恢复、managed/admin Python 和 Chromium 数据读取已有通过证据。旧 helper/Skill/经典 JS 同阶段退出，当前仍是未发布开发状态。见 [S2 验收记录](marivo-analytics-presentation-s2-acceptance.md)。

**代码所有权**：新 `src/presentation/contracts/`、`projection/`；新 `python/presentation-kit/`；Runtime 安装和包清单由集成负责人接入。

**实施顺序**：

1. 建立 Node/browser 共用的纯数据契约与校验，Python writer 使用同一契约测试。固定数值、时间、缺失值与预算行为。
2. 编写固定的公开读取程序，按 bound Workspace + Session/Artifact 取得直接 Artifact 数据和来源。需要的旧 Evidence 读取逻辑提取到这里，不把旧 Tool payload 当新 schema。
3. 实现 `dsh_data_analysis_presentation.write_dataset(frame, path)`，只写 computed typed JSON 和有界 receipt。来源写在草稿中，helper 不审查或保存转换逻辑。
4. 支持 source-only、Artifact 可选 Finding、computed 多来源和 unavailable 状态。读取时不自动 revalidate、observe 或取得数据源凭据。
5. 同步完成新 wheel 的构建、安装、import identity/版本探测与包校验，这是唯一 Runtime 切换点；验证 managed 与 administrator Python 的错误行为，不回退解释器。

**同阶段删除**：旧 report-kit、emitter/receipt、wheel 构建/安装探测，以及依赖旧 helper 的 report Skill、经典 JS 资产、prompt 路由和对应形态测试。由集成负责人同步更新包清单与调用者，不能出现“检查新 wheel、安装旧 wheel”或“新 Runtime 仍路由旧 Skill”。新 presentation Skill 在 S5 接入；期间是未发布开发状态，不提供旧 Skill 兼容包装。

**验收**：真实 Artifact 行、字段和来源身份一致；computed 数值编码与 Python/Node/browser 读取一致；直接 Artifact 缺必要数据失败，computed 的来源缺失可标 unavailable；source-only 不伪造 dataset；不存在 computed 转换分类、复算或证明要求。

**检查入口**：`test:presentation-projection`、`test:presentation-surface` 和 `test:runtime-workspace` 已接入持续检查；旧 `report-kit-contracts` 已替换。`validate:runtime-workspace:real`、`validate:presentation-projection:real` 和 `validate:presentation-browser:real` 已实际通过，分别证明 Runtime 切换、真实 Artifact 恢复和 Python/Node/Chromium 数据一致性。

## S3：同一 reader 与离线 HTML

**状态：已完成。** 五类 block、line/bar、共享 reader、内部 HTML builder、Host 主题与 portable/打印均已实现。19 项聚焦测试、实际安装包和真实 DSH Web/离线浏览器验收通过；S2 留存的真实投影输出已接入。文件登记、receipt、RPC 与打开/下载留在 S4，见 [S3 验收记录](marivo-analytics-presentation-s3-acceptance.md)。

**代码所有权**：新 `src/client/presentation/` 的 ChartRenderer、变换、表格、布局、sources、reader；纯展示构建代码与 portable entry。

**实施顺序**：

1. 对照 Analytics App Core 阅读六部分实现，独立编写本项目组件；以 S0 fixtures 先完成表格、来源与 metric，再完成 line/bar 和布局。
2. 实现 Markdown、metric、chart、table、source 五类 block，含唯一值选择、精确数值、单位、null/empty/截断和来源 unavailable。
3. 加入必要交互：排序、分页、系列显隐和可复制追问上下文；不加入在线编辑、全局筛选或直接消息提交。
4. 接入 S2 输出，制作 Host entry 与 portable entry；只允许外层打开/下载等动作不同，组件和数据解释共用。
5. 实现返回生成文档与自包含 HTML 字节的内部 builder；HTML 含语义 fallback、打印内容和保存的来源。S3 不登记文件或发 receipt，目录提交由 S4 唯一负责。

**验收**：两种入口显示相同数值/单位/来源；line/bar 与表格可核对；窄屏、键盘、主题、tooltip 和来源展开可用；HTML 断网无请求，无脚本时正文/指标/必要表格仍可读。host bundle 不含第二份 React，portable bundle 不依赖 Host。

**检查入口**：`test:presentation-reader` 已加入持续检查；`validate:presentation-reader:real` 使用实际 DSH module loader 验证生产 reader，并验证 portable 数据一致性、交互、断网、无脚本及打印。client 构建白名单、依赖打包规则、资产产出和 package verifier 已同步更新。该阶段没有独立 export Tool，也不生成新的版本管理服务。

## S4：一个 present 接通 DSH

**代码所有权**：新 `src/presentation/` 下 Tool、构建提交、receipt、RPC；`plugin.ts`、`client.tsx`、`bridges.ts`、`index.ts` 的接线及对应客户端入口。

**实施顺序**：

1. 注册 `marivo_present(draft_path)`，内部按检查 → 公开读取 → 构建 → 临时目录完整提交 → receipt 的顺序执行；只有最终文件完整时才发成功卡。
2. 以 build ID 定位单次交付物，输出两份文件的精确路径/digest；不提供 report ID、revision、latest、CAS 或持久 operation 索引。
3. 定义一种新的 durable receipt，接通 Native/both 与 Code dispatch；同时保留可读文本输出，校验 Session/Turn 归属与事件去重。
4. 实现只读 RPC：Workspace/build ID/固定 asset/receipt digest；校验真实路径、归属、大小与字节。将 reader 接入 overlay，并从卡片打开、下载 HTML。
5. reader 仅加载产物快照，展开来源不调用 Python/凭据；新分析继续使用普通对话。

**同阶段删除**：`marivo_evidence_sources` 的注册/公共导出、专用 prompt、旧 metadata/card/delivery、client parser 和旧来源卡。其仍有价值的身份/脱敏测试迁到新 projection，其余旧协议测试删除。没有历史解码兼容路径。

**验收**：一次 present 即可打开和下载；source-only 与 computed 都可交付；Native/Code receipt 一致且不依赖模型重打结果；取消/写失败无半成品成功卡；越界、缺失、digest 变化、Workspace 切换明确失败；headless 仍有完整文本与文件位置。重复调用可生成独立产物，同一 receipt 的重复事件不重复显示。

**检查入口**：新增 presentation integration 与只读 RPC 测试，更新 `test:plugin-integration-delivery` 和对应真实脚本。在独立验证 Workspace 运行实际 Host/Web 工具旅程；最终真实 Agent 自动路由留到 S5。

## S5：单一 Skill、分发清理与最终验收

**代码所有权**：新 Skill、剩余旧文件删除、Runtime/构建/包清单、架构文档和整体验收，由集成负责人汇总。

**实施顺序**：

1. 编写并接入唯一 `dsh-data-analysis-presentation` Skill，主流程短而完整；图形配置、schema、报告/看板叙事和示例放 references。保留两个 Runtime Skill 和 live Help。
2. 核对 S1/S2/S4 的删除结果：access、旧 report Skill/三份经典 JS/report-kit/旧 emitter，以及 Evidence 协议均已退出；清理剩余无消费者依赖和路径引用，不再进行第二次 Runtime 切换。
3. 汇总验证 `build-client`、`finalize-build`、新 wheel 构建、包 `files/exports`、root scripts 与 verifier 的实际产出，补齐新 Skill/reader 资产。确认废弃命令已经删除，不以跳过失败断言代替新边界测试。
4. 在可安装包上读取真实注册结果，确认目标 4 Tool、1 个插件 Skill、两个 Runtime Skill、新 receipt 与新数据协议；不能只检查常量数组或源码关键词。
5. 更新根/包 README、总体架构、模块文档与验收记录，完成最终真实 Agent 和 Web/离线旅程。

**最终必须提供的证据**：

| 旅程 | 验收证据 |
| --- | --- |
| 分析并展示 | 真实 Agent 从问题到 python、草稿、一次 present、结果解释；记录实际 Tool 轨迹，不出现旧 access/Evidence/Skill |
| 凭据不足与管理 | 多 datasource 补齐前零启动，补齐后一次启动；管理表单添加/更新/删除/测试及状态可见；取消/轮换不复活 |
| Artifact、computed、source-only | 三种真实交付均可打开，computed 无转换信息要求，多个来源与 unavailable 显示准确 |
| Host 模式 | Native/both、Code-only 的同一种 receipt；headless 文本位置；重连/重复事件不串 Turn |
| 文件与离线 | DSH 下载后的实际文件断网打开，数值/来源与 JSON 一致；无脚本/打印可读；无网络或凭据依赖 |
| 删除与包内容 | 实际包没有旧 Tool 导出、Skill、卡协议、JS registry 或旧 wheel；当前目标功能可发现和执行 |

真实验证使用隔离的验证 Workspace/profile，不覆盖用户现有会话、报告或凭据。安装包用于完成验收；npm 发布、推送或部署到用户现有 profile 不属于本次 MVP 完成门槛。

## 检查策略与阶段退出规则

- 每个可执行切片运行聚焦测试与 `npm run check`；涉及 client、exports、包元数据或分发时运行 `npm run build`、`npm run verify:plugin-package`。这些阶段会触及相应边界，接线和测试更新属于同一切片。
- 新测试命令在对应阶段添加到 root `package.json`；旧命令随消费者删除，不预设本文列出的新模块或命令已经可用。Python 契约测试必须接入持续检查，不能仅手工跑一次。
- 每个切片的交付记录包含实际修改/删除清单、通过的检查、真实证据与未完成项。编译通过不等于 Host/Agent 旅程完成，端口/路径/mock 不能替代实际运行。
- 所需检查通过后，不因进入下一阶段机械重复全部浏览器测试；新改动、失败或未解问题涉及的边界才补测。最终安装包发生变化后需核对其内容与实际运行的一致性。
- 不满足退出门槛时修复该边界；独立阶段可继续。不能通过加入旧格式 fallback、缩减凭据约束或伪造成功 receipt 绕过阻塞。

完成 S5 即完成本次 MVP。18 类图形、完整 DAG、在线编辑、版本管理、托管和自动刷新不作为下一阶段的默认任务。

## 开始实施前的最小输入

实施起点是 S0。先记录本仓库及 sibling Marivo/DSH 的实际 revision、未提交改动与 runtime identity，取得可恢复 Artifact 样例，确认隔离验证环境及 Native/Code/Web 能力。缺少某项真实验证条件时明确列出；不因此扩大插件范围或静默改用另一 Runtime。

此路线图不要求先排日历或估算固定工期：S0 得到接缝证据后，即可按上述依赖推进，并用阶段完成门槛报告进度。
