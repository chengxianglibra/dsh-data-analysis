# 插件能力优化 v2 验收记录

## 用途

本文是 [插件能力优化设计](../plan/plugin-capability-optimization-design.md) 的阶段门禁与真实 Agent 验收记录。
实现过程只修改本仓库；Marivo `0.5.3` 与 DSH `0.1.1-rc.2` 的已发布公共接口是不可修改的外部约束。

状态只使用以下值：

- `passed`：已取得本条要求的完整证据；
- `failed`：已执行并得到 terminal failure；
- `blocked`：已执行，但外部前置条件阻止到达 terminal state；
- `unverified`：尚未在要求的真实环境执行。

测试 harness、Host 启动、端口健康、Tool dispatch、Web panel 出现、Produced Files 路径或本地静态检查都不能
单独把真实 Agent 旅程标记为 `passed`。

## 阶段 0 基线

记录日期：2026-09-02。基线提交：`7723950`，另有本方案及计划索引的未提交文档输入。

### 当前能力与包内容

- Agent Tool 只有 `marivo_help`、`marivo_datasource_test`、`marivo_evidence_sources`；
- shared Runtime 从精确 Marivo 安装同步 `marivo-analysis` 与 `marivo-semantic`；
- 插件另行分发 `dsh-data-analysis-report` 及 `report-data.js`、`marivo-artifact.js`、
  `marivo-session-dag.js`；
- Runtime marker 为 `dsh-data-analysis-runtime/v2`，包含 Marivo、Python、report-kit 与 Skill root identity；
- 已发布的插件基线为 `0.1.0`，锁定 Marivo `0.5.2`、DSH `0.1.1-rc.2` 与 report-kit `2.1.0`；
- 基线包共 101 个文件，包含编译后的 server/client、类型、compatibility、report-kit wheel、三个 report
  schema、报告 Skill/assets、README 与 Cordis patch，不包含源码、测试、fixture 或已删除的旧 report API。

### 已确认的失败基线

以下是当前行为，不是 v2 接受的目标状态：

| 边界 | 基线行为 | v2 terminal condition |
| --- | --- | --- |
| Host 环境 | plugin lifecycle 写入并恢复 `process.env.MARIVO_PERSIST_CREDENTIALS` | install、error、dispose 前后 Host 环境逐键逐值相同 |
| Workspace | 默认创建 `marivo.toml`、`models/`、`.marivo/` | install、Help、catalog、Skill load 对空 Workspace 零写入 |
| shell credential | 首次 shell inventory 全 Workspace datasource，并给每次 shell fresh-resolve 全部已知 refs | test 只做健康检查；显式 access 签发有界 foreground lease |
| Evidence | Tool text 不承载完整可读来源，prompt 抑制文本并依赖 Web panel | headless transcript 独立包含来源、状态和边界，Web 只增强同一结果 |
| Help | `targets=[]` 成功 no-op；模型正文包含 Runtime 路径与 fingerprint | 至少一个 target；正文只含版本、target、Help body 与失败/截断 |
| 报告意图 | 长回答或多个图表/表格可自动触发报告 | 只接受明确请求、接受提议或修改已有 bundle |
| report transport | adapter 仍包含部分 Marivo 领域枚举与再判断 | 只校验 transport 完整性；reader/audit 只投影公共字段 |

### 确定性门禁

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run check` | `passed` | 108 tests passed；Biome、依赖、TypeScript 均通过 |
| `npm run build` | `passed` | TypeScript build 与 client finalize 通过 |
| `npm run verify:plugin-package` | `passed` | 101 files；16 个 DSH peer；Marivo `0.5.2`；wheel 与浏览器 assets 通过 |
| sibling repo 依赖 | `passed` | 实施计划没有 sibling implementation phase 或未发布 API 门禁 |

阶段 0 只冻结现状和成功判据，不把上述 v1 checks 当作 v2 行为验收。

## v2 最终环境与确定性门禁

最终验收日期：2026-09-02。后续只校正 package SemVer，当前开发候选的 identity 为：

- `@deepseek-ai/dsh-data-analysis@0.1.1-dev.0`；
- DSH 与 16 个必需 peer：`0.1.1-rc.2`；
- shared Python：`$DSH_HOME/dsh-data-analysis/runtimes/marivo/.venv/bin/python`；
- Marivo：`0.5.3`；report-kit：`3.0.0`；
- Runtime marker：`dsh-data-analysis-runtime/v2`；
- subprocess policy：`direct-argv-inherited-env-snapshot-overlay-v2`。

开发候选包为 `artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.1-dev.0.tgz`，SHA-1
`1f3487e55f868152e24fe3ea55258fc74bc305be`。该版本仅用于开发与验收，正式发布时才去掉预发布标识。

| 检查 | 结果 | 终态证据 |
| --- | --- | --- |
| `npm run check` | `passed` | Biome、dependency tree、两组 TypeScript typecheck 与 124 tests 全部通过 |
| `npm run build` | `passed` | server/client build 与 finalize 通过 |
| `npm run verify:plugin-package` | `passed` | 65 files、326361 unpacked bytes、16 个 DSH peer、Marivo 0.5.3、wheel 与 assets 通过 |
| `git diff --check` | `passed` | 无 whitespace error |
| Markdown 相对链接检查 | `passed` | 16 个 Markdown 文件的全部相对目标存在；设计、当前架构和验收互链闭合 |
| package install | `unverified` | 新的 `0.1.1-dev.0` tarball 已通过隔离 consumer smoke，未仅为版本元数据更名重装真实 `web` / `headless` profile |
| Web Runtime | `passed` | 真实 `npx dsh web` 服务 `127.0.0.1:3080`，J08/J15 均由重新安装后的候选包执行 |

真实环境验证脚本全部使用上述 managed Python；`validate:runtime-workspace:real`、
`validate:environment-execution:real`、`validate:help-disclosure:real`、
`validate:datasource-credentials:real`、`validate:datasource-access:real`、
`validate:evidence-sources:real` 与 `validate:plugin-integration-delivery:real` 均为 `passed`。

## 真实 Agent terminal journeys

Prompt、Tool calls、关键 transcript 与 Session identity 保存在 DSH Session Store；可移植的模型验证结果保存在
`artifacts/plugin-integration-delivery-real-model.json`、`artifacts/datasource-access-real-model.json` 和
`artifacts/evidence-sources-real/.../validation.json`。Workspace 文件摘要及报告 bundle 位于
`artifacts/plugin-capability-optimization-real/`。这些路径是验收证据，不是 published/immutable Artifact。

| ID | 终态证据 | 结果 | 状态 |
| --- | --- | --- | --- |
| J01 | Headless Session `session-b3ecd7b0-a6fb-48b4-9475-064e1c2359c8` 加载 analysis 并调用 Help；空目录前后均无条目 | install、catalog、Skill 与 Help 可用且零写入 | `passed` |
| J02 | real-model `analysis-activation`、`semantic-activation`；root Help 分别只有 `analysis`、`authoring` | 两个 Skill 分别按需激活，ordinary journey 无注入 | `passed` |
| J03 | real-model `dual-skill-same-turn` 顺序为 analysis→authoring，`focused-help-dedup` 为 delivered→already-visible；真实 Agent lifecycle tests 覆盖 compaction、replacement、cancellation、atomic failure 与 shadow | 同轮原子有序、恢复/替换/取消/scope 全部得到终态 | `passed` |
| J04 | Headless Session `session-5d562079-cdcb-476b-9ba3-883157a1a6f3` 执行 `md.load()`/`ms.load()`；目录仍为空 | 受控 telemetry 下 zero-init 读取零写入 | `passed` |
| J05 | Headless Session `session-26aa1255-92be-4c7a-a18e-803e2c7ce549` | 只创建 `models/datasources/warehouse.py` | `passed` |
| J06 | Headless Session `session-05e8b94e-9c26-4d6e-9744-bd4ab18eb185`，Marivo Session `sess_7fd91a41230ff8eb3161c05f` | 只创建 `.marivo/analysis/session_store.db` 与该 Session metadata | `passed` |
| J07 | Headless Session `session-47cfd5ae-16d7-40f6-afe5-a11d5cb78519` | 无效显式 manifest 在 datasource admission fail closed，未被修复且无其他写入 | `passed` |
| J08 | Web Session `session-cc0cdef5-cf08-4300-a5bc-6f2d86126df2` | closed result 为 `needs-credentials`；空白 Web form 正常出现，未尝试连接、未输入或泄漏值；保存闭环另由 client terminal test 验证 | `passed` |
| J09 | real-model datasource access artifact，Session `datasource-access-real-mtk70teq`：`broken` 与 `a` 各一次 test | test 结果无 lease；失败与成功都不暗留执行权限 | `passed` |
| J10 | 同一真实 Agent 对 `a` 调用一次 access，复用同一 lease 运行七次 foreground Python 查询 | 七次查询均得 20，后续脚本之间没有 datasource test 或 access | `passed` |
| J11 | 同一真实 Agent 随后的普通 foreground query | 查询仍得 20，但 A/B canary 均不可见 | `passed` |
| J12 | leased executions 的 presence result | A user/password 可见，B 与 edge ref 不可见；七次均 fresh resolve | `passed` |
| J13 | 同一 Agent/ToolRuntime 的确定性 64/65 次与并发边界，并对 expired、wrong Workspace、background、persistent 做 pre-spawn 请求 | 拒绝路径均脱敏，非 claim 错误不消耗，persistent edge spawn count 为 0 | `passed` |
| J14 | Evidence real-model artifact：Session `sess_fc5abbdbe3040a1830b4c857` | headless transcript 独立包含 locator、excerpt、available/revalidation 状态和“不证明整个结论”边界 | `passed` |
| J15 | Web Session `session-61983476-198a-4698-88d8-c4492a24f5af`；Finding `fnd_fe484ae0e62589363bfa2be2` | Web 展开的是同一 closed result；locator、excerpt、revalidation 与 transcript 一致，无第二次读取 | `passed` |
| J16 | Headless Session `session-4c7c855e-44eb-4f77-81f4-884be597fb27` | 长中文分析在对话内完成，报告 Workspace 在此前后仍为空 | `passed` |
| J17 | Headless Session `session-23f41f8d-3ca9-40cb-afba-fac752bc5728`；`reports/j17-reader/index.html` | reader bundle 使用实际公共投影，浏览器运行时 `OK`，收入 20、identity 与 read boundaries 一致 | `passed` |
| J18 | Headless Session `session-6d5742ed-4378-44e4-8fd2-f73dc1ef18f3`；`reports/j18-audit/index.html` | audit bundle 显示精确 Session/Artifact/Run/Query identity 与全部 10 个公共 RunQuery 字段；独立浏览器复核并修正 `queries_omitted` 为按 Run 汇总 0 | `passed` |
| J19 | Headless Session `session-a82f23e4-4050-4ce8-8d64-60af8147778e`；`reports/j19-multi-session/index.html` | 两个 Session 分别投影、两个独立 Graph、20 项隔离检查 0 失败，无 Query 补造或跨 Session 边 | `passed` |
| J20 | 同一 J19/J20 headless terminal transcript | 无 `openPath` 仍交付精确可读路径，并明确 Produced Files 不是 ready/published/immutable | `passed` |
| J21 | 重装候选包后的 `dsh-test` 页面，datasource refs 为 `CDN_CH_USER` / `CDN_CH_PASSWORD` | 新 Web 表单显示原始名称；真实页面执行一次 test、一次 access，并由同一 lease 连续完成两次 `md.raw_sql` foreground 查询，中间无重复 test/access | `passed` |

J09–J13 的 Agent、ToolRuntime、有界 lease、foreground child process 与 Python 查询均为真实执行；
为避免把第三方数据库可用性混入 capability 验收，datasource connection success/failure bridge 使用确定性的测试实现。
因此这组证据证明的是 lease 的签发、隔离、消费与 fail-closed 边界，不声称验证某个外部数据库服务。

J17–J19 又由独立 in-app browser 通过本地静态服务器实际打开。页面标题、identity、KPI、Graph、boundary、
runtime self-check 与 console error count 均与 Headless transcript 一致；J18 的独立复核发现并修复一处只影响文案
的 `queries_omitted=undefined`，复测显示“按 Run 汇总 0”。这一步是最终浏览器事实，不使用 Agent 自报替代。

这组真实报告 fixture 调用 `session.observe(metrics=metric)` 时没有传 `analysis_purpose`，因此 Marivo Run 与
Artifact 的源字段均为 `null`；reader/audit transport 忠实保留 `null`，DAG label 按组件契约回退为
`capability_id=observe`。这不是投影丢字段，也不得由报告补造。非空 `analysis_purpose` 的 transport 与 label
由 checked-in contract fixture 和组件测试覆盖；需要真实目的文本时，分析动作必须在执行时传入
`session.observe(..., analysis_purpose="...")`。

## 阶段门禁

| 阶段 | 实现与 review | focused tests | 真实环境 | 状态 |
| --- | --- | --- | --- | --- |
| 0 基线与范围 | 冻结失败基线；范围只含本仓库 | v1 baseline 108 tests | 无 sibling 前置条件 | `passed` |
| 1 Runtime/Workspace/Help | zero-init、Runtime-level Help、exact Skill、Host env 零 mutation | runtime 13 + environment 22 + help 30 | J01–J07 与 real validators | `passed` |
| 2 bounded credential lease | test/access 解耦、Agent/Workspace/TTL/64 uses/foreground、fresh resolve | credential tests | J08–J13 与 real-model access artifact | `passed` |
| 3 Evidence 可移植化 | closed v2 result、Artifact-owned exact Finding、Web 只增强 | Evidence 12 | J14–J15 headless/Web | `passed` |
| 4 report-kit/Skill | schema v2、reader/audit、公共 RunQuery、无领域重判、显式报告意图 | report 9 | J16–J20 与三份实际浏览器报告 | `passed` |
| 5 文档、Package、真实 Agent | README/architecture/modules/plan/acceptance 同步；`0.1.1-dev.0` 开发包 | 全量 124 tests + build/package/link gates | 新版本 identity 未重装真实 profile | `unverified` |

## 安全 review 结论

阶段 2 的 shell injection 边界已明确接受：lease 只限制 secret 进入哪些有界 foreground Shell executions，不能
限制这些 executions 内代码读取环境变量。实现与文档不把它描述为 command-level sandbox；若未来要求结构化
datasource API 级隔离，应删除 Shell lease，而不是继续解析任意命令。

同时接受 token 进入 Session transcript 的剩余风险：token 最长 30 分钟、最多 64 次并绑定 Agent 与 Workspace，
不是 credential value；background/persistent 与错 scope 在 claim 前拒绝，credential resolve 失败会消耗一次。
真实验收产物会脱敏 token，且没有记录任何 credential value。

## 最终结论

本方案的实现、focused tests、专项 review、原候选包安装、J01–J21 terminal journeys 与独立浏览器复核全部
`passed`。当前 `0.1.1-dev.0` 已通过全量确定性检查、构建、打包和隔离 consumer smoke；精确该版本的真实
profile 重装保持 `unverified`。本记录不表示已正式发布。
