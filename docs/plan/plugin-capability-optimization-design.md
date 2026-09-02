# 插件能力优化设计

## 状态与结论

> 已于 2026-09-02 按阶段实施并完成 `2.0.0` clean break；不保留旧配置、别名、双读、双写或运行时迁移。
> 当前契约以[总体架构](../architecture.md)、[模块文档](../modules/)和
> [v2 验收记录](../acceptance/plugin-capability-optimization-v2.md)为准，本文保留为设计与决策记录。

本方案只允许修改 `dsh-data-analysis` 仓库。当前已发布的 Marivo `0.5.3` 和 DSH `0.1.1-rc.2` 公共接口
是不可变约束；方案不得要求 sibling 仓库先增加 CLI、schema、Tool 参数、Skill、报告 helper 或生命周期能力。

插件最终仍只公开三个 Agent Tool：

- `marivo_help`：读取精确 Marivo Runtime 的实时公共 Help；
- `marivo_datasource_test`：验证一个 datasource，并为一次前台 shell 执行签发短时授权；
- `marivo_evidence_sources`：按精确 Finding identity 恢复可读来源，Web 只作为增强展示。

原 [Agent 原生报告增强能力设计](agent-native-report-primitives-design.md) 已标记为历史；其中报告触发、领域投影
校验和凭据生命周期由本次已落地的 v2 边界取代。

## 项目范围

### 可以修改

- 本插件的 TypeScript Runtime、Workspace binding、Tool、prompt、client 与 presentation；
- 本插件分发的 Python report-kit、JSON schemas、JavaScript assets 和 Skills；
- 本插件的 package、测试、验证脚本、文档与 acceptance records；
- 本插件通过当前 DSH `tools/pre-execute`、`shellEnv`、credentials、file、Produced Files 和 Host 能力建立的适配。

### 不可以修改

- Marivo 的 CLI、公共对象、schema、Artifact/Session/Evidence/Quality/Lineage 语义；
- DSH 的 Tool schema、shell runtime、`shellEnv` API、credential service、Produced Files 或 Host API；
- sibling 仓库的版本、发布计划或默认 Skill；
- 任何只有修改上游才能成立的 publisher、ready、replay、share 或 command-level secret sandbox。

跨仓库改进只能记录为非阻塞的未来建议，不得进入实施阶段、依赖图、完成定义或发布门禁。

## 第一性原理

### 能力保留条件

一项能力只有满足以下条件才保留在插件中：

1. 它直接服务 Marivo 在 DSH 中的可用性；
2. 它可以只依赖当前已发布公共接口实现；
3. 它不把插件投影升级为 Marivo 事实权威；
4. 它不把 DSH 路径或 UI 能力夸大为业务状态；
5. 它的权限与生命周期能够由本插件真实执行和测试；
6. 无法消除的限制会进入 Tool result、文档和验收，而不是隐藏在 prompt 中。

### 处理优先级

遇到上游能力缺口时，按以下顺序处理：

1. 使用现有公共接口建立薄适配；
2. 收窄功能并接受明确的剩余风险；
3. 删除或降级无法安全提供的能力。

禁止通过解析任意业务命令、复制上游私有 schema、静默切换 Runtime 或伪造 Host 能力填补缺口。

### 对 Agent 暴露能力的方式

- Tool 只用于结构化调用、credential boundary 或确定性 Host 行为；
- Skill 用于无需新权限、可由 Agent 完成的分析与报告工作流；
- Python/shell/file/browser 继续由 DSH 通用能力执行，插件不包装第二套通用执行器；
- 绝对路径、完整安装 fingerprint 与 secret value 默认不进入模型正文；
- Web client 不能成为 Tool 语义的唯一承载；
- Produced Files 只表示 DSH 识别到的路径，不表示 ready、published、immutable 或 replayable。

### Marivo Skill 加载原则

`marivo-analysis` 与 `marivo-semantic` 是 Marivo `0.5.3` 发布包提供的两个正式 Agent Skill。插件必须保证它们
可被 DSH catalog 发现并按需加载，但不能把 Skill body 或配套 root Help 常驻注入每个请求：

- shared Runtime admission 同时验证两个 `SKILL.md` 存在；
- 插件从精确 Runtime 原子同步并挂载两个 Skill，不向 Workspace 写 Skill 链接；
- 未调用 Skill 时，只允许 DSH 正常暴露 catalog metadata，不注入 Skill body、root Help 或关联 prompt；
- 加载 `marivo-analysis` 后，才激活 analysis root Help、Evidence 与报告指导；
- 加载 `marivo-semantic` 后，才激活 authoring root Help 与 datasource credential 指导；
- 同时加载两个 Skill 时，按稳定顺序原子发布两份 root Help，不能只成功一半；
- DSH 当前 Agent-visible definition、继承 preset 与 project override 规则继续有效，同名局部 shadow 不能伪造激活；
- prompt compaction 后恢复已激活 Skill 的完整 Help；Runtime identity 或 Help body 变化时替换旧内容；
- Skill reload 不重复注入未变化正文；取消、失败或 dispose 不发布延迟内容。

## 当前问题与本地处置

| 当前问题 | 影响 | 本项目内处置 |
| --- | --- | --- |
| 插件生命周期修改 `process.env` | 跨 Agent/Workspace 污染 Host | 删除全局修改，只保留 subprocess-local policy |
| 插件默认预创建 Workspace layout | 抢占 Marivo `0.5.3` 的 lazy materialization 所有权 | 删除初始化器，空目录直接绑定 |
| 每次 shell inventory 并注入全部 datasource secret | secret authority 过宽且可进入后台任务 | 改为 datasource test 签发的短时、单次 foreground grant |
| Help 向模型暴露安装路径和 fingerprint | 无分析价值并增加 Host 信息面 | 只显示版本、target、Help 与 truncation |
| Evidence 依赖 Web panel 承载来源 | headless/remote 不完整 | Tool 文本成为可读交付，Web 使用同一结果增强 |
| 报告触发包含“长回答/多个图表” | 未经用户确认改变交付介质 | 只按明确请求、接受提议或修改已有 bundle 触发 |
| report-kit 二次解释 Marivo 领域语义 | 形成事实副本和版本漂移 | 保留投影 adapter，但只拥有传输完整性，不拥有领域有效性 |
| `emit_computed` 容易被误认为 Marivo Artifact | 语义混淆 | 保留实用能力，但明确为 plugin-owned computed snapshot |
| Produced Files/openPath 被误解为发布 | 交付承诺失真 | 明确只报告实际路径和已执行检查 |

## 目标架构

```text
Agent
  |
  |-- DSH current public capabilities
  |      |-- Tool / Skill / session lifecycle
  |      |-- bash / pwsh / file / browser
  |      |-- credentials + shellEnv per-execution resolution
  |      `-- Produced Files + conditional host.openPath
  |
  |-- dsh-data-analysis 2.0 integration seam
  |      |-- exact shared Marivo Runtime
  |      |-- explicit per-Workspace policy and binding
  |      |-- live Help adapter
  |      |-- datasource test -> one-shot shell grant
  |      |-- exact Finding -> readable Evidence + optional Web
  |      `-- bounded report transport + Marivo browser components
  |
  `-- Marivo 0.5.3 current public contracts
         |-- analysis / Artifact / Evidence / Quality / Lineage truth
         |-- SessionGraph public read surface
         `-- datasource describe / test / Help
```

插件可以投影 Marivo 公共对象，但投影只是为 DSH Workspace 报告服务的版本化 transport snapshot。Marivo 对象
仍是唯一领域权威；插件不能用投影判断一个 Artifact、Finding、Quality、Lineage 或 Session 是否在领域上有效。

## 目标能力矩阵

| 能力 | 是否保留 | Agent 接口 | 插件拥有 | 插件不拥有 |
| --- | --- | --- | --- | --- |
| Shared Runtime | 保留 | 无独立 Tool | 精确安装、identity、重建 | Marivo package 语义 |
| Workspace binding | 保留并收窄 | session cwd / loader config | 精确 root binding | layout 创建与 `marivo init` |
| Marivo Skills | 保留并强化 | DSH `skill` 按需加载 | 精确同步、挂载、激活监听 | Skill 内容与通用 lifecycle |
| Live Help | 保留 | `marivo_help` | 调用、预算、呈现 | Help 内容 |
| datasource test | 保留并扩展 | `marivo_datasource_test` | credential overlay、grant lifecycle | datasource 连接语义 |
| shell credential bridge | 重构 | `bash`/`pwsh` command grant marker | 单次执行授权与注入 | 通用 shell access control |
| Evidence sources | 保留并简化 | `marivo_evidence_sources` | identity adapter、文本/Web 呈现 | Finding/Evidence 语义 |
| Artifact dataset | 保留并收窄 | report-kit | 有界编码、原子写入、transport schema | Artifact 有效性 |
| computed dataset | 保留并澄清 | report-kit | DataFrame 有界 serialization | Artifact/Evidence/Quality/Lineage |
| Session trace | 保留并收窄 | report-kit | transport integrity、预算、引用闭合 | Session lifecycle 解释 |
| 报告 Skill/assets | 保留并收窄 | `dsh-data-analysis-report` | Workspace bundle 工作流 | publisher/ready/replay/share |

## 目标契约

### Shared Runtime

保留一个 Host 级 shared Runtime，并继续要求：

- 精确 Marivo version、distribution 与 interpreter identity；
- administrator Python 不满足精确依赖时 fail closed，不静默修改；
- managed Runtime 安装使用 lock、临时目录和原子 marker；
- 旧 marker 或 identity 不匹配时重建，不迁移；
- direct argv、timeout、cancellation、stdout/stderr budget 与 redaction；
- 不切换到 PATH、system Python、sibling checkout 或其他 project environment。

删除 runtime marker 中不参与 Runtime admission 的 presentation 细节。report-kit 仍随插件分发并参与 package smoke；
它可以继续参与 administrator Python admission，因为插件报告能力需要精确 consumer contract，但必须在 marker 中
明确标记为 integration adapter，不命名为 Marivo contract。

### Zero-init Workspace binding

Marivo `0.5.3` 已把 `marivo init` 改为可选：不存在 `marivo.toml` 时使用目录名作为默认项目名；不存在
`models/` 时加载空 datasource/semantic catalog；需要 authoring 或 analysis state 时，Marivo 自己只创建对应路径。

因此插件删除整个 Workspace 初始化面：

- 从 public config 删除 `initializeWorkspace`，不增加替代的 `workspacePolicy`；
- 删除 `initializeMarivoWorkspace()`、manifest 模板、临时 manifest 和目录创建代码；
- Workspace manager 只验证传入 root 是已存在目录、canonicalize identity，并绑定精确 shared Runtime；
- 空目录、缺少 `marivo.toml`、缺少 `models/` 和缺少 `.marivo/` 都是合法初始状态；
- 显式存在但内容无效的 `marivo.toml` 仍由 Marivo admission fail closed，插件不修复或覆盖；
- 插件 install、Help、Skill catalog discovery 和 Skill load 都不能创建 Workspace 文件；
- `md.load()`、`ms.load()` 等读取能力遵循 Marivo `0.5.3` 的 zero-init 行为；
- `md.register(...)`、Session 创建或 telemetry 等首次需要持久状态的操作，由 Marivo 在该操作内部创建最小路径；
- `marivo.toml` 只在用户显式执行可选 `marivo init` 时创建，插件永不自动调用该命令。

插件继续显式传递每个 Agent 的 Workspace root，不能因为缺少 manifest 就向上搜索并意外绑定另一个 Workspace。
同一 shared Runtime 下，不同空目录的配置、datasource、Session、Artifact 和 state identity 必须保持隔离。

### Host 环境与 subprocess policy

删除插件生命周期和 shell credential bridge 中对 Host `process.env` 的写入。具体包括：

- 删除 `acquirePersistencePolicy()`；
- 删除 `prepareExecution()` 中的 `process.env[MARIVO_PERSIST_CREDENTIALS_ENV]`；
- 测试证明安装、多个 Agent、dispose 和异常路径前后 Host 环境完全一致。

插件自己启动的 Marivo subprocess 继续在局部 overlay 中设置：

```text
MARIVO_PERSIST_CREDENTIALS=0
```

插件通过当前 `shellEnv` 注册非敏感、per-execution 的 `DSH_DATA_ANALYSIS_PYTHON`，其值是 shared Runtime 的
精确 interpreter 路径。该 standing fact 不包含 secret，不要求修改 DSH，也不写入 Host `process.env`。

通过 DSH `bash`/`pwsh` 启动 Marivo 时，Skill 要求命令显式带上这个非秘密策略变量。插件不得依赖修改 Host
环境把策略悄悄传给所有 shell。

### `marivo_help`

输入：

- `targets` 必填，长度至少为 1；
- 去重并保留首次出现顺序；
- 维持单 target、combined output、timeout 和 cancellation 预算；
- 删除 `targets=[]` 的成功 no-op。

执行：

- 从 shared Runtime 创建 Help-only checked runner；
- 直接调用当前精确版本的公共 `marivo.help()`；
- 不要求 Workspace manifest、doctor 或 datasource binding；
- inventory 继续每次实时读取，不建立 shadow registry。

模型可见正文只包含：

- Marivo version；
- target；
- 原始 Help body；
- 明确的 truncation 或失败。

Python 路径、site-packages、完整 fingerprint 和 Runtime root 只进入有界 `presentationMeta` 或 Host 日志。

### 两个 Marivo Skill 的按需生命周期

shared Runtime 从精确 Marivo `0.5.3` package path 同步：

- `marivo-analysis/SKILL.md`；
- `marivo-semantic/SKILL.md`。

同步使用 staging directory 和原子替换；任一 Skill 缺失、frontmatter 名称不匹配或不可读时，Runtime admission
失败，不能只挂载另一个 Skill。插件继续通过现有 DSH skill-filesystem provider 挂载 Runtime skill root，并保留
DSH 的 catalog、project override、preset inheritance 和显式 invocation 规则。

按需加载必须满足：

- plugin install 后，两个 Skill 都能在 catalog 中发现；
- 未调用时，system prompt 不包含两个 Skill 的正文、root Help 或条件型 Evidence/datasource/report 指导；
- `skill(name="marivo-analysis")` 或等价显式用户 invocation 完成后，在下一次 model request 前注入该 Skill 的
  `analysis` root Help；
- `skill(name="marivo-semantic")` 完成后，在下一次 model request 前注入该 Skill 的 `authoring` root Help；
- 条件型 prompt 只由对应已激活 Skill 打开，不因 catalog 可见或另一个 Skill 激活而打开；
- 同一轮加载两个 Skill 时，要么两份 root Help 按固定顺序一起可见，要么本轮失败且都不标记 delivered；
- compaction 隐藏完整正文后，在下一次需要时恢复；`already-visible` receipt 不能阻止恢复；
- Runtime/Help identity 改变时替换正文，重复加载未变化 Skill 只返回 receipt；
- inherited Agent-preset 的可见 `skill` Tool 可以激活；Agent-local 同名 shadow、普通文本提及或其他 Tool 不能激活；
- cancellation、Help failure 和 plugin dispose 会取消 sibling work，不产生延迟注入或 telemetry。

Workspace zero-init 与 Skill lifecycle 相互独立：发现或加载两个 Skill 不创建 `marivo.toml`、`models/`、
`.marivo/`、`.agents/skills/` 或 `.codex/skills/`。

### `marivo_datasource_test`

保持当前调用顺序：

1. 使用当前 Workspace binding 执行 `describe(name)`；
2. 验证所有 refs 使用 DSH credential namespace；
3. 通过 DSH credential provider operation-scoped resolve；
4. 缺失时返回 `needs-credentials` 并触发现有 Web credential form；
5. 凭据齐全时只给 datasource test subprocess 注入 overlay；
6. 对结果、错误和 stderr 做 exact-value redaction。

失败或 `needs-credentials` 不签发 shell grant。只有真实 connection test 成功后才签发。

成功结果增加：

```json
{
  "status": "ok",
  "name": "sales",
  "latency_ms": 12,
  "shell_grant": {
    "token": "opaque-one-shot-token",
    "expires_in_ms": 60000,
    "usage": "one-foreground-shell"
  }
}
```

`token` 不是 credential value；它只是本插件内短时 capability。它会进入当前 Tool result，因此必须满足：

- 至少 128 bit 随机性；
- 绑定 Agent identity、Workspace binding identity 和当前 datasource refs；
- 只存储非秘密 ref names，不缓存 resolved values；
- 最长 60 秒；
- 一次 claim 后立即失效，包括后续 credential resolve 失败；
- plugin/Agent/Workspace dispose 时全部清除；
- 日志只记录 grant lifecycle 和 datasource name，不记录 token 全文。

### 单次 shell credential grant

需要 datasource secret 的前台 shell 命令必须以严格的首行注释 marker 开头。bash 形状为：

```bash
# dsh-marivo-credential-grant:<opaque-token>
MARIVO_PERSIST_CREDENTIALS=0 \
"$DSH_DATA_ANALYSIS_PYTHON" analysis.py
```

pwsh 形状为：

```powershell
# dsh-marivo-credential-grant:<opaque-token>
$env:MARIVO_PERSIST_CREDENTIALS = '0'
& $env:DSH_DATA_ANALYSIS_PYTHON analysis.py
```

marker 只供插件把 grant 绑定到本次 `ToolExecution`；shell 将其视为注释，因此 token 不进入目标子进程环境。

这是本插件在当前 DSH API 下能够实现的最窄授权。实现规则：

- `tools/pre-execute` 只处理当前 Agent 的 `bash` 和 `pwsh`；
- 从结构化 `execution.arguments.command` 的第一行完整匹配固定 marker，不搜索任意命令正文；
- 没有 marker 的 shell 不解析、不注入任何 datasource credential；
- marker 格式错误、未知、过期、已使用或 Workspace 不匹配时 fail closed；
- `run_in_background: true` 在 resolve 之前拒绝；
- 当前已知 persistent bash/pwsh definition 在 resolve 之前拒绝；
- grant 在异步 credential resolve 前原子 claim，避免并发复用；
- 只 fresh-resolve grant 绑定的 refs，并写入这个 `ToolExecution` 的 WeakMap；
- `shellEnv.resolve(execution)` 只为该 execution 返回这些值；
- Tool settle、取消或错误后删除 execution snapshot；
- Code Mode nested `bash`/`pwsh` 同样经过现有 `tools/pre-execute`，不得建立旁路。

不得继续执行全 Workspace datasource inventory，也不得因为一次 datasource test 成功，让后续所有 shell 持续获得
secret。多个 datasource 的一次命令需要分别成功 test，并由插件签发一个显式的组合 grant；第一版若不能安全
支持组合，则 fail closed 并要求拆分命令，不自动合并授权。

#### 安全边界

grant 约束的是 secret 何时进入哪个 shell execution，不约束该 shell execution 内的任意代码。获得 grant 的
Agent 可以在该次执行中读取环境变量，这是运行 Marivo datasource 所必需的能力。

如果验收要求“secret 只能用于某个结构化 datasource API，不能被 shell 代码读取”，当前 DSH 通用 shell 无法
提供这个边界。本项目不得声称已经解决；唯一可行策略是完全删除 shell credential injection，只保留
`marivo_datasource_test`。发布前必须由安全 review 明确接受上述一次执行边界，否则执行删除策略。

### `marivo_evidence_sources`

输入继续使用精确 identity：

- `session_id`；
- `artifact_ref`；
- `finding_id`。

插件验证 Finding 属于目标 Artifact/Session，禁止用相似文本、数组位置或显示序号匹配。

Tool 文本成为所有 client 都能读取的权威交付，至少包含：

- Finding identity 的有界人类可读标签；
- 每个来源的 title、locator 和有界 excerpt；
- missing、unsupported、truncated 与 revalidation 状态；
- “来源 identity 不证明整个结论或业务判断正确”的边界。

Web panel 继续使用同一个结构化 result 提供折叠、分组和导航。它不重新读取 Evidence，也不产生第二套事实。
无 Web、远程、headless 或 client 不识别 metadata 时，Tool 文本仍完整可用。

prompt 收敛为：

1. 用户明确请求来源、引用、provenance 或 audit 时才调用；
2. 只针对精确持久化 Finding；
3. 来源存在不等于结论被来源蕴含；
4. 无精确 Finding 或来源不可恢复时如实说明。

删除“不要复述”“不要提 panel”“最终只能回复一句”等依赖 UI 成功的抑制规则。

### Report-kit 定位

由于不能要求 Marivo 新增 report projection，Python report-kit 继续由本插件拥有和分发。它被定义为：

> 将当前精确 Marivo 公共对象或 pandas DataFrame 编码成 DSH Workspace 报告可消费的有界、版本化 transport
> snapshot；它不是 Marivo Artifact、Session、Evidence、Quality、Lineage 或 freshness authority。

保留三个 emitter：

- `emit_dataset(BaseFrame, target, revalidation=...)`；
- `emit_computed(DataFrame, target)`；
- `emit_session_trace(SessionGraph, target, report_artifact_refs=...)`。

#### 可以校验

- 输入是当前锁定 Marivo 版本的公共对象或准确 pandas DataFrame；
- public attributes 可以闭合读取；
- identity 引用在本次 snapshot 内存在；
- 行、列、节点、边、字符串和文件大小预算；
- JSON/script encoding、atomic replace 与 receipt；
- schema version 和浏览器 consumer 所需的 transport shape；
- 显式 revalidation 的 Artifact identity 与目标 Artifact 相同。

#### 不可以校验或推断

- Artifact 在 Marivo 领域上是否有效；
- Quality level、Issue severity、Lineage kind 或 Run lifecycle 是否语义正确；
- 未公开 Query、co-input、edge 或 private Store 状态；
- datasource 当前 freshness；
- 一个 Finding 是否真的支撑报告叙事；
- 多个 Session 之间的合并 Graph 或因果边。

当前 `_trace.py` 中复制的 family/lifecycle/materialization 枚举与领域规则应逐项分类：

- 浏览器安全消费所需的 closed transport enum 可以保留，但必须使用插件 namespace；
- 仅用于重判 Marivo 领域有效性的规则删除；
- 无法从 Marivo 公共对象直接得到的字段删除或显式标记 omitted；
- 必须保留的版本耦合用 exact Marivo fixture 和 package compatibility test 证明。

transport schema 继续使用 `dsh-data-analysis-*` namespace。结构发生破坏性变化时升 schema version，不使用
`marivo.*` 名称，也不宣称能被 Marivo 或其他 consumer 通用读取。

### Reader 与 audit 输出

不要求 Marivo 新增 `reader/audit` API；由插件在 transport 层提供两个闭合 profile：

- `reader`：默认，只保留读者理解报告所需的类型、semantic shape、行数、有界 preview、实质质量/Evidence/
  revalidation 提示和 truncation；
- `audit`：用户明确请求审计、Lineage、质量详情或可追溯性时，投影公共对象已经提供的完整可公开字段。

profile 只决定 transport 包含哪些已公开字段，不能改变或重算字段含义。`emit_dataset` 和
`emit_session_trace` 增加 `detail="reader" | "audit"`，默认 `reader`。

`emit_computed` 不接受 `detail`，因为它始终只是 computed snapshot；输出必须明确：

- `source.kind = "computed"`；
- 不包含 Artifact ref、Evidence、Quality、Lineage、revalidation 或 freshness；
- 图表或叙事需要的计算来源说明由 Agent 编写，不能伪造成 Marivo metadata。

### 报告 Skill 与浏览器组件

继续分发 `dsh-data-analysis-report`，因为当前 DSH 没有等价的通用报告 Skill。它只服务本插件的报告 bundle，
不声明自己是 DSH 平台标准。

报告只在以下情况触发：

1. 用户明确要求 HTML、Web 页面或耐久报告文件；
2. Agent 提议生成耐久报告且用户接受；
3. 用户要求修改已有 Workspace 报告 bundle。

删除“多个图表/表格或长回答自动生成报告”。普通分析默认在对话中回答。

Skill 保留：

- 如何使用三个 emitter；
- reader/audit 的选择；
- 资源先写、`index.html` 最后写；
- 相对资源、离线加载、响应式、键盘、无脚本、打印和浏览器检查原则；
- Produced Files 与 `host.openPath` 的真实边界；
- 未执行检查必须标记未验证。

Skill 不提供：

- publisher、report registry、ready state、immutable identity、share URL 或历史 byte replay；
- Marivo 领域事实判断；
- 静态模板、强制主题或限制 Agent 表达的 chart DSL。

保留 `report-data.js`、`marivo-artifact.js` 和 `marivo-session-dag.js`。JavaScript 只校验 transport schema、预算和
引用闭合；未知 version 显示 unsupported 并停止渲染，不能猜测。

## Clean break 清单

### 删除

- `initializeWorkspace` boolean、`initializeMarivoWorkspace()` 及所有 manifest/directory 创建代码；
- 插件生命周期和 shell bridge 的 Host `process.env` 修改；
- datasource inventory 驱动的全量 shell credential 注入；
- datasource describe 即永久注册可用凭据的行为；
- background/persistent shell 的 credential path；
- `marivo_help targets=[]` success no-op；
- Help 模型正文中的绝对路径和完整 fingerprint；
- 依赖 Evidence Web panel 的 prompt 抑制规则；
- “长回答/多个图表或表格”自动触发报告；
- report-kit 中仅用于二次裁决 Marivo 领域有效性的规则。

### 新增或替换

- Marivo `0.5.3` zero-init Workspace binding；
- Runtime-level Help checked runner；
- 两个 Marivo Skill 的原子同步、按需激活与 zero-write regression coverage；
- datasource test 成功后的短时 one-shot shell grant；
- grant marker、claim、expiry、foreground 与 Workspace validation；
- Evidence 可读文本 renderer；
- report transport 的 `reader`/`audit` profile；
- 与精确 Marivo `0.5.3` 公共对象绑定的 adapter fixtures。

### 保留但重新定义

- report-kit wheel：plugin-owned transport adapter；
- report contracts：plugin consumer schema，不是 Marivo schema；
- `emit_computed`：generic computed snapshot，不是 Marivo Artifact；
- `dsh-data-analysis-report`：本插件 Workspace 报告 Skill，不是 DSH 平台通用 Skill；
- Produced Files/openPath：路径与导航能力，不是发布能力。

### 不迁移

- 旧 config 不保留 alias；
- 旧 runtime/package compatibility 不双读；
- 旧 grant 不存在迁移问题，插件 restart 后全部失效；
- 破坏性变化的 report transport 升 version，不双写旧 payload；
- 已生成的用户报告 bundle 不删除，但不保证由新插件升级或 replay。

## 实施计划

每个阶段只修改本仓库。必须完成实现、focused tests、review 和验收证据后，才能进入依赖它的阶段。

### 阶段 0：冻结基线与范围

所有者：文档与 acceptance，不改变运行行为。

工作：

- 记录当前三个 Tool、两个 Marivo Skill、报告 Skill、runtime marker 和 package 内容；
- 固定 Marivo `0.5.3` 与 DSH `0.1.1-rc.2` 为本方案不可修改的外部约束；
- 为现有全局环境、自动 Workspace 写入、全量凭据和 Web-only Evidence 建立失败基线；
- 删除设计中的所有 sibling repo implementation phase；
- 定义每条真实 Agent 旅程的 terminal success/failure。

门禁：

- `npm run check`、`npm run build`、`npm run verify:plugin-package` 通过；
- 当前真实环境未执行项标记 `unverified`；
- 没有任何完成条件依赖 Marivo/DSH 新版本或未发布能力。

### 阶段 1：Runtime、Workspace 与 Help

所有者：`src/environment/`、`src/disclosure/`、`src/plugin.ts` 及对应测试。

工作：

- 删除全局 persistence policy；
- 将 policy 固定到 checked subprocess overlay；
- 将 package/runtime 精确 Marivo 依赖升级到 `0.5.3`；
- 删除 Workspace 初始化器和配置；
- 让空目录直接建立精确 Workspace binding；
- 拆出 Runtime-level Help runner；
- 保留两个 Marivo Skill 的原子 Runtime 同步与 DSH 按需加载；
- 收紧 Help targets 和模型可见结果；
- 更新 runtime/package compatibility version。

门禁：

- plugin install/dispose 前后 Host environment byte-for-byte 相同；
- 空 Workspace install、Help、Skill catalog 和 Skill load 全部零文件写入；
- 缺少 `marivo.toml`、`models/`、`.marivo/` 时 binding 成功；
- 显式无效 manifest 在 Marivo admission 内 fail closed 且不产生其他路径；
- 两个 Skill 都可发现、可分别按需激活，未激活 Skill 不进入 prompt；
- 两 Skill 同轮激活、compaction、replacement、cancellation 和 shadow scope tests 通过；
- 两个 Workspace 共享 Runtime 但 binding/error 状态隔离；
- focused tests 和 root check 通过。

### 阶段 2：一次性 credential grant

所有者：`src/datasource/`、相关 prompt/client 与测试。

工作：

- 删除 inventory-first shell bridge；
- datasource test 只在成功后创建 grant；
- 实现 token、TTL、Agent/Workspace/ref binding 和 atomic claim；
- 严格解析 command 前缀 marker；
- 检查 `run_in_background` 与 persistent definition；
- 每次 shell fresh-resolve grant refs；
- settle/cancel/dispose 后清理状态；
- 更新 credential form retry 与 Agent 使用指导。

门禁：

- 普通 shell 永远看不到 datasource canary；
- 成功 test 之前没有 grant；
- grant 只能使用一次且只进入一个 foreground execution；
- 错 Agent、错 Workspace、过期、复用、background、persistent 全部在 spawn 前失败；
- 只注入目标 datasource refs，其他 datasource canary 不可见；
- Code Mode nested shell 服从同一规则；
- token 全文和 secret value 不进入 Host 日志、错误或 telemetry；
- credential threat model 通过专项安全 review，否则删除 shell injection。

### 阶段 3：Evidence 可移植化

所有者：`src/evidence/`、client/presentation、prompt 与测试。

工作：

- 保留 exact Finding ownership validation；
- 新增有界文本 renderer；
- Web client 改为同一结果的 progressive enhancement；
- 简化 prompt；
- 对未知 metadata 安全忽略，不提供旧 replay。

门禁：

- headless Tool transcript 单独可回答来源问题；
- Web 和文本消费同一个 closed result；
- identity mismatch fail closed；
- missing/unsupported/truncated/revalidation 清晰可见；
- 来源不会被描述为整个结论已证实。

### 阶段 4：Report-kit 与 Skill 收窄

所有者：`python/report-kit/`、`report-contracts/`、report Skill/assets 与测试。

工作：

- 分类 `_dataset.py`、`_trace.py` 中的 transport 与 domain validation；
- 删除 domain re-judgement，保留安全编码、预算和引用完整性；
- 引入 reader/audit profile；
- 澄清 computed snapshot；
- 收窄报告触发条件；
- 更新 schemas、fixtures、Python tests 与 JavaScript consumer；
- 更新 package marker 对 report-kit 的描述。

门禁：

- `emit_dataset` 只接受当前 Marivo `BaseFrame` 公共边界；
- `emit_computed` 不生成任何 Marivo identity/semantic metadata；
- `emit_session_trace` 不读取 Store、不打开 Session、不补造 Query、不跨 Session 合并；
- reader 默认最小，audit 只投影公共字段；
- unknown schema/version fail closed；
- wheel smoke、schemas、Python tests、client tests 和 package allowlist 通过；
- 普通长回答不生成文件，明确 HTML 请求才执行 Skill。

### 阶段 5：文档、Package 与真实 Agent 验收

所有者：README、architecture/modules、acceptance、package 与 release。

工作：

- 发布 `2.0.0`；
- 更新 README、package README、architecture 与模块文档；
- 把稳定契约从本文迁入当前架构；
- 将旧设计标记为历史；
- 更新 package allowlist、compatibility manifest 和 breaking changes；
- 安装发布候选到真实 DSH profile，执行完整旅程。

门禁：

- `npm run check`、`npm run build`、`npm run verify:plugin-package` 通过；
- `git diff --check`、文档链接与 Markdown 渲染通过；
- package 不含未声明能力；
- 所有真实旅程获得 terminal Runtime 证据；
- 任何 blocked/unexecuted 检查保持 `unverified`，不得标记 ready。

## 真实 Agent 验收

至少执行以下旅程：

1. 空 Workspace：plugin install、Help 和 Skill catalog 可用且零写入；
2. Skill 按需加载：分别调用 `marivo-analysis`、`marivo-semantic`，只注入对应 Skill、root Help 和条件型指导；
3. Skill 生命周期：同轮双加载、重复加载、compaction 恢复、Runtime replacement 和局部 shadow 拒绝；
4. zero-init 读取：在受控 telemetry 设置下 `md.load()`、`ms.load()` 不创建 manifest、models 或 analysis state；
5. lazy datasource authoring：首次 `md.register(...)` 只创建所需 `models/datasources/...`，不创建 manifest；
6. lazy analysis state：首次 Session 操作创建所需 `.marivo/analysis/...`，不创建 manifest 或 models；
7. 无效显式 manifest：在任何其他写入前 fail closed；
8. datasource 缺凭据：Web form 正常，结果无 secret；
9. datasource test 失败：不签发 grant；
10. datasource test 成功：签发单次 grant，前台查询成功；
11. 普通 shell：无 grant 时看不到任何 datasource secret；
12. grant 隔离：A grant 看不到 B datasource secret；
13. grant 生命周期：复用、过期、错 Workspace、background、persistent 全部失败；
14. Evidence headless：仅 transcript 即可理解来源与限制；
15. Evidence Web：增强视图与 transcript 一致；
16. 普通长分析：不自动生成报告；
17. 明确 HTML 请求：生成 reader bundle、实际检查、Produced Files 显示路径；
18. 明确 audit 请求：输出公共 audit 字段并维持精确 identity；
19. 多 Session 报告：分别投影，不合并或推断边；
20. remote/headless：没有 local openPath 时仍诚实完成可用交付。

每条旅程保存 prompt、Tool calls、版本 identity、关键 transcript、文件摘要、检查结果和最终状态。Host 启动、端口
健康、测试 harness、AM dispatch、Web panel 出现或 Produced Files 路径都不能单独替代 terminal journey。

## 验收矩阵

| 风险边界 | 确定性测试 | 真实环境证据 |
| --- | --- | --- |
| Host 环境污染 | install/dispose/error environment snapshot | 多 Agent profile 前后环境检查 |
| 插件抢占 lazy materialization | before/after filesystem tests | zero-init、authoring、Session 三条旅程 |
| Skill 按需加载 | catalog/activation/compaction/scope tests | 两 Skill 分别与同轮加载旅程 |
| Runtime identity | marker/interpreter/version tests | 发布候选真实 Help |
| credential ambient exposure | canary、grant、TTL、foreground tests | test + one-shot query transcript |
| background secret lifetime | pre-spawn rejection tests | background/persistent Agent 请求 |
| Evidence portability | text/Web contract fixtures | headless 与 Web 两条旅程 |
| report semantic overreach | public-object fixtures、forbidden-field tests | 真实 Artifact/Graph reader/audit 报告 |
| report intent | disclosure/prompt regression tests | 长回答不产文件、明确请求产文件 |
| delivery honesty | package/Produced Files assertions | local 与 remote/headless 结果 |
| Workspace isolation | two-root concurrency tests | 两个真实 Workspace 交叉验证 |

## 剩余风险

### Marivo operation 会按需写入 Workspace

插件 install、Help 和 Skill load 必须零写入，但这不意味着整个分析流程只读。Marivo `0.5.3` 会在 datasource
authoring、Session、Artifact 或 telemetry 首次需要时创建对应路径。这些 mutation 由具体 Marivo 操作拥有；
插件文档必须区分“插件不预创建”与“后续分析永不写入”。测试应控制 telemetry 设置，避免把 telemetry 写入
误判为插件初始化。

### shell grant 不是结构化查询 sandbox

grant 只能把 secret lifetime 收窄到一次 foreground shell，不能限制该 shell 内的代码。该限制必须进入安全
review 和用户文档。如果产品要求更强边界，则删除该能力；不得宣称通过 prompt 或 command parsing 获得了
command-level least privilege。

### report transport 仍与 Marivo 公共对象耦合

由于 Marivo 不提供 report projection，插件必须维护 adapter。通过 exact Marivo version、公共对象 fixture、
plugin namespace 和删除 domain re-judgement 控制漂移。transport snapshot 不能作为恢复 Marivo 对象的输入。

### 通用报告指导仍由插件分发

当前 DSH 没有通用报告 Skill。本插件可以为自身 bundle 提供必要指导，但不得宣传为平台规范，也不得扩展到
非本插件工作流。内容只保留实际报告交付所需原则。

### Tool result 中存在短时 grant token

token 会进入 session transcript，因此必须是单次、短时并绑定 Agent/Workspace。它不是 credential value，但在
有效期内属于 capability。若 transcript 生命周期不满足安全 review，则取消 token 方案并删除 shell injection。

## 提交顺序

建议使用以下单一职责提交：

1. `docs: constrain capability optimization to this repository`；
2. `refactor(runtime)!: adopt Marivo 0.5.3 zero-init workspaces`；
3. `fix(runtime): remove host environment mutation`；
4. `refactor(help): preserve on-demand skills and zero-write help`；
5. `refactor(datasource)!: replace ambient credentials with one-shot grants`；
6. `refactor(evidence): make source results headless-readable`；
7. `refactor(report)!: separate transport integrity from Marivo semantics`；
8. `docs!: document v2 boundaries and real acceptance`；
9. `release!: dsh-data-analysis 2.0.0`。

每次 review 检查：是否修改 sibling repo、是否扩大 secret lifetime、是否产生隐藏 Workspace 写入、是否新增
Marivo 事实副本、是否依赖 Web/路径夸大完成状态，以及是否用 deterministic health 替代真实 Runtime 证据。

## 完成定义

本方案只有同时满足以下条件才算完成：

- 所有实现只修改本仓库，不依赖未发布的 Marivo/DSH 能力；
- 插件公开 Tool 仍且仅有三个；
- Host `process.env` 在 plugin lifecycle 中不被修改；
- 插件不包含 Workspace layout 初始化器或初始化配置；
- 缺少 `marivo.toml`、`models/`、`.marivo/` 的空目录可以直接绑定；
- plugin install、Help、Skill catalog 和 Skill load 不创建 Workspace 文件；
- `marivo-analysis` 与 `marivo-semantic` 都能被发现并分别按需加载，未激活内容不常驻 prompt；
- 两个 Skill 的 root Help、条件指导、compaction 恢复、replacement、cancellation 和 scope isolation 已验证；
- datasource secret 只进入一次已授权 foreground shell execution；
- background、persistent、过期、复用和错 Workspace grant 全部 fail closed；
- 若一次 shell 的安全边界未获接受，shell credential injection 已被删除；
- Help 在空 Workspace 零写入可用；
- Evidence 在无 Web 环境完整可读；
- report-kit 明确是 plugin transport adapter，不重判 Marivo 领域有效性；
- `emit_computed` 不声明任何 Marivo 语义；
- 报告只按明确用户意图触发；
- Produced Files/openPath 始终只按当前 DSH 能力描述；
- deterministic checks、package verification 和真实 Agent terminal journeys 全部通过；
- 架构、模块、README、package 和 acceptance 文档描述同一套当前事实；
- 没有旧 config alias、双路实现或迁移代码。

## 非阻塞的未来上游机会

以下能力如果未来由 sibling 项目独立提供，可另立设计评估是否简化插件，但不属于本方案：

- Marivo 发布稳定的 reader/audit report projection；
- DSH shell 原生支持显式敏感环境引用和 background policy；
- DSH 提供通用报告数据 helper 或平台级报告 Skill。

在这些能力实际发布并成为本项目当前依赖之前，代码、测试、文档和完成定义不得引用它们。
