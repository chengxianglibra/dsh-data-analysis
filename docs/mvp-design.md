# dsh-data-analysis MVP 设计

状态：MVP 已实现并完成 Slice 1–4 验收

实现验收：[Slice 1](slice-1-acceptance.md)、[Slice 2](slice-2-acceptance.md)、
[Slice 3](slice-3-acceptance.md)、[Slice 4](slice-4-acceptance.md)

上位设计：[设计愿景](design-vision.md)

## 一句话范围

MVP 只证明两件事：DeepSeek Harness 能为当前 Agent Session 绑定一个真实、可复核的
Marivo 环境；LLM 在每个直接用户分析 turn 开始时，必须先声明需要哪些 live-help targets，
并在下一 step 收到该环境生成的原始 `marivo.help(...)` 文本。

MVP 不实现分析路由、Marivo API 使用检查、raw fallback policy、执行记录、Evidence UI 或
semantic promotion。

## MVP 核心证明

### 环境一致性

Plugin 自己执行的以下操作必须来自同一个 Environment Binding：

- `doctor`；
- canonical target inventory；
- focused help。

Binding 不只记录配置中的解释器路径。每个 help 子进程还必须复核实际 import 后的
`sys.executable`、`marivo.__version__` 和 `marivo.__file__`，防止当前目录、`PYTHONPATH` 或
其他 import shadowing 改变实际 Marivo package。

Plugin 把已验证的 project root 和绝对解释器路径写入 context，要求 Agent 后续使用该环境。
由于 MVP 不包装或检查分析执行，Agent 是否真的遵守属于 E2E 观察，不是 Plugin contract。

### Help declaration 可靠发生

每个直接用户 turn 的第一个分析 step 前，LLM 必须调用：

```text
marivo_help(targets=[...])
```

`targets=[]` 合法，表示 LLM 明确判断当前不需要新的 API 信息。Plugin 只检查调用是否存在、
输入结构和资源边界是否合法，不判断 target 选择质量，也不建立 target membership registry。

### Help 文本可靠进入下一 step

每个非空 target 使用当前绑定解释器执行真实 `marivo.help(target)`。Marivo 自己负责 target
解析与 invalid-target 错误；Plugin 捕获原始 stdout，并通过标准 Tool Result 交给下一模型
step。

### LLM 保持分析自主性

LLM 自己决定：

- 请求哪些 targets；
- 是否先请求 root 或 surface help；
- 是否一次请求多个候选；
- 是否在后续 step 请求更多 help；
- 是否实际使用收到的 API 信息。

MVP 不根据用户 objective 推断或补选 API。

## 产品边界

### 包含

- 本地、单用户、单 Agent；
- 一个明确 project root；
- 一个 native Tool presentation profile；
- profile/config 显式解释器与常规项目 `.venv` 解析；
- `marivo doctor --format json` 环境探测与 disclosure admission；
- import identity 复核；
- 当前 Marivo 的 canonical string target inventory；
- data-analysis system prompt；
- 一个 model-facing `marivo_help` Tool；
- 每个直接用户 turn 一次强制 help checkpoint；
- 有界 declaration repair 和 help 调用预算；
- 原始 help stdout 捕获和标准 Tool Result；
- Headless 真实模型 E2E；
- disclosure 正确性、token、step 和延迟报告。

### 不包含

- Marivo analysis execution wrapper；
- one-tool-per-Marivo-API；
- objective-to-API planner、router 或 `analysis.focus`；
- Plugin 侧 target registry 或 help inventory parser；
- Python AST、import 或 API usage 检查；
- Marivo-first execution admission；
- raw SQL/Python fallback；
- datasource connector；
- focused-help cache 或自动 environment watcher；
- Artifact、Finding、Evidence 或 Quality projection；
- semantic authoring、SemanticCandidate 或自动 promotion；
- Session recovery、analysis-aware compaction、multi-agent、schedule 或专用 UI；
- 容器、microVM 或非受信任 Python 隔离。

## 当前 Marivo public contract

当前 Marivo 已提供：

```python
marivo.help("targets")
```

它打印当前安装版本完整、确定性的 canonical string target inventory，并返回 `None`。Inventory
包含：

- global topics；
- `datasource`、`semantic`、`analysis`、`ontology` surface roots；
- fully-qualified capability targets；
- public type targets；
- public error targets。

它排除 object/callable/ref/result/error instance、alias、歧义 unqualified name 和 private
descriptor identity。

### Inventory 是文本契约

MVP 将 `marivo.help("targets")` 的原始 stdout 作为 context 提供给 LLM，不把它解析成 Plugin
自己的 target set，也不复制成静态 fixture。输入 target 是否真实存在，由后续真实
`marivo.help(target)` 调用决定。

Inventory 与 focused help 使用不同预算。当前完整 inventory 可以超过 focused-help 的行数和
codepoint 上限；MVP 为 inventory stdout 设置独立、固定、非模型可控的安全上限。超过上限时
checkpoint 失败并报告 upstream inventory size，不静默截断 target 名称空间。

`datasource.targets`、`semantic.targets`、`analysis.targets`、`ontology.targets` 等分段入口
当前不是 MVP 依赖。如果 counterfactual 证明完整 inventory 成本不可接受，再单独讨论 Marivo
侧 surface index。

### Focused help 仍由 Marivo 约束

每个 inventory 中的 canonical target 应能通过 public `marivo.help(target)` 路由。Focused
help 的内容、预算、错误和 repair 文本全部由 Marivo 拥有；Plugin 不读取 private registry，
也不解析 help body 重建 API contract。

## Marivo Environment Binding

### 配置

MVP profile 接受：

```text
projectRoot
pythonExecutable?  # 未设置时只检查 projectRoot/.venv
```

`projectRoot` 和 `pythonExecutable` 都解析为绝对路径。相对解释器路径、PATH 中第一个
`python` 和系统 Python 不能成为静默 fallback。

### 解析顺序

```text
读取 Plugin/profile 配置
→ 解析 projectRoot
→ 使用显式 pythonExecutable
   或 projectRoot/.venv/bin/python
   或 Windows projectRoot/.venv/Scripts/python.exe
→ 验证解释器存在且可执行
→ 使用固定 subprocess policy 运行 doctor
→ 解析 disclosure admission checks
→ 建立 binding
```

MVP 不扫描父目录、pyenv、conda、全局 site-packages 或其他项目 `.venv`。

### Subprocess policy

`doctor`、target inventory 和 focused help 必须使用相同启动策略：

- 直接以 argv 启动，不经过 shell；
- `cwd` 固定为 `projectRoot`；
- 使用同一明确的环境变量投影策略；
- 不在不同调用之间切换 `PYTHONPATH` 或 user-site policy；
- timeout/cancel 必须终止整个子进程组；
- stdout/stderr 都有固定 byte 上限。

环境变量投影策略可以继承部署所需的普通变量，但必须对三个调用完全相同。Plugin 不把
变量值写入 context、fingerprint 或 telemetry。

### Doctor probe 与准入矩阵

使用候选解释器运行：

```sh
<python> -m marivo doctor --project-root <projectRoot> --format json
```

即使进程退出码非零，Plugin 也先尝试解析完整 JSON。Disclosure admission 只要求：

- `python_executable` 与候选解释器 identity 一致；
- Marivo installation check 成功；
- `marivo.version` 和 `marivo.package_path` 存在；
- `project_root` 与请求的绝对 project root 一致；
- 项目 identity 可识别，至少 `project.marivo_toml` 成功。

以下检查只作为 bounded 诊断，不阻止 API disclosure：

- Agent skill 是否安装；
- datasource 配置或连接；
- credentials/secrets；
- semantic readiness；
- analysis state/store readiness。

因此 top-level `doctor.status=fail` 不自动拒绝 binding；Plugin 根据上述准入检查的具体结果决定。
MVP 不默认运行 `--semantic` 或 `--connect`。

### Binding identity

Binding 保存：

```text
project_root
python_executable
marivo_version
package_path
subprocess_policy_id
doctor_overall_status  # 仅诊断
fingerprint
```

`fingerprint` 只由 project root、解释器、Marivo version、package path 和 subprocess policy
identity 计算，不包含凭据、环境变量值或整体 doctor status。

### 每次 help 的 identity assertion

Target inventory 和 focused help runner 在调用 `marivo.help(...)` 前复核：

```text
resolved sys.executable == binding.python_executable
resolved marivo.__file__ == binding.package_path
marivo.__version__ == binding.marivo_version
```

任一不一致时不渲染 help，Environment Binding 进入 failed 状态，并要求显式 rebind。MVP 不在
旧 binding 上自动切换解释器或 package。

## System prompt contract

Plugin 向 data-analysis Agent 增加一段短、稳定的 system prompt：

```text
Before the next analysis action, declare which installed Marivo live-help
targets you need by calling marivo_help.

- Choose targets yourself from the provided canonical target inventory.
- Request a root or surface target when exact detail is not yet known.
- Request zero, one, or multiple targets.
- Use targets=[] when no additional API information is needed.
- Do not execute analysis code in the same help-decision step.
- After the Tool Result arrives, decide and execute the analysis yourself.
```

System prompt 不包含 API 列表副本、推荐分析流程、objective-to-target 映射、raw fallback
判断或 copied Marivo help prose。

每个直接用户 turn 的 checkpoint context 动态提供：

- 最新 target inventory 原始文本；
- 绑定的绝对 `project_root` 和 `python_executable`；
- Marivo version、package path 和 bounded doctor 诊断摘要。

## `marivo_help` Tool

### Input

```text
MarivoHelpRequest
  targets: string[]
```

Plugin 只校验机械资源边界：

- `targets` 必填且必须是数组；
- 允许空数组；
- 每个值必须是非空字符串；
- 一次请求内按首次出现顺序去重；
- target 数量、单个字符串长度和总字符数有固定上限。

Plugin 不校验 membership，不要求 reason、objective、working set、Artifact refs 或 capability
IDs。

### Execution

对每个 target，Tool 使用绑定 subprocess policy 执行等价代码：

```python
import marivo
marivo.help(target)
```

执行前必须完成 binding identity assertion。一个多 target 请求只有在所有 target 都成功时才
作为成功 Tool Result 返回；任一 target 失败时，Plugin 丢弃本批尚未交付的 stdout，返回
target-specific、bounded failure，避免把部分成功误认为 checkpoint 已完成。

### Output

模型可见成功结果是带边界的文本：

```text
Marivo environment: <version and bounded identity>

Target: analysis.observe
<exact captured help stdout body>

Target: analysis.compare
<exact captured help stdout body>
```

`targets=[]` 返回一条短确认，不渲染 help。Plugin 可以记录 target、environment fingerprint、
字节数、耗时和 outcome，但不能从 help body 提取参数、约束或 continuation。

## Help checkpoint

### Harness profile 前提

MVP profile 必须使用 `native` Tool presentation mode。`run_code` 是 Code Mode 中不可过滤的
保留 transport，因此 `code` 和 `both` 不属于 MVP checkpoint contract。

Profile 还必须保证：

- `marivo_help` 是 checkpoint scope 唯一的 scope-local Tool；
- 普通 Agent Tools 从 global/ancestor layer 继承；
- checkpoint 通过 scoped `ctx.tools.restrict({allow: []})` 隐藏继承工具；
- restriction disposer 在合法 Tool Result 后立即恢复普通 Tool 集合。

如果 Agent preset 已注册其他 scope-local Tools，Plugin 拒绝启动该 MVP profile，而不是声称
能够隐藏它们。

### 状态

MVP 只有两个状态：

```text
needs-help-declaration
analysis-step
```

`needs-help-declaration`：

- 重新运行 `marivo.help("targets")`，取得当前 inventory；
- inventory 和环境摘要进入 context；
- 当前 model-facing Tool 集合只有 `marivo_help`；
- `targets=[]` 或全部 target 成功完成 checkpoint。

`analysis-step`：

- `marivo_help` Tool Result 已进入 context；
- Harness 恢复普通 Tool 集合；
- Plugin 不限制或检查实际使用的 API；
- `marivo_help` 保持可见，LLM 可以主动再次调用。

MVP 只在每个直接用户消息开始的新 turn 强制建立一次 checkpoint。不在每个 Tool Result、
structured error 或普通模型 step 后自动重新建立。

### 有界 repair

MVP 使用固定、非模型可控的预算：

- 一个 checkpoint 最多允许 2 次 missing-declaration steering repair；
- 一个用户 turn 最多允许 8 次 `marivo_help` 调用；
- invalid target、render failure 和输入错误都计入调用预算；
- 超限时以明确 Plugin error 结束当前 turn，不替 LLM 选择 target；
- user cancel 立即终止当前 turn，不触发 repair steering。

具体数值可以在 MVP 评估后调整，但不能在同一运行中由 LLM 修改。

## Failure contract

| Failure | 行为 |
| --- | --- |
| project root 不存在 | 拒绝建立 binding，报告绝对路径。 |
| 解释器不存在或不可执行 | 拒绝，不回退系统 Python。 |
| doctor JSON 无效 | 拒绝 binding，返回 bounded stderr。 |
| disclosure admission check 失败 | 拒绝并报告具体 check，不使用整体 status 代替。 |
| 非准入 doctor check 失败 | 建立 binding，context 中只给 bounded 诊断摘要。 |
| inventory 超过独立上限 | checkpoint 失败，不截断或猜测 target。 |
| target 不存在 | 返回 Marivo 自己产生的 bounded target failure。 |
| target help 渲染失败 | 返回 target-specific failure，不把空文本当成功。 |
| help stdout 超限 | 失败并报告 size limit，不静默截断 API contract。 |
| timeout | 终止子进程组，计入调用预算，允许有界 repair。 |
| user cancel | 终止子进程组和当前 turn，不再 steering。 |
| import identity 改变 | binding 失败，要求显式 rebind。 |
| LLM 未调用 `marivo_help` | 最多 steering repair 2 次，之后终止 turn。 |

MVP 不把 help failure 解释为 Marivo 不支持某个分析方法，也不自动授权 raw fallback。

## 状态与持久化

MVP 不缓存 target inventory 或 focused help：

- 每个直接用户 turn 的 checkpoint 重新读取 inventory；
- 每个非空 `marivo_help` 调用重新执行真实 focused help；
- 相同 Session 内的 Tool Result 由 Harness 正常持久化；
- 环境变化通过 identity assertion 失败并要求显式 rebind。

这避免 editable install、相同 dev version 或原地源码变化使 Plugin 返回旧 help。只有实测证明
subprocess 成本不可接受后，才设计带可信 build identity 的缓存。

Context 和 telemetry 不保存 credentials、完整 environment、datasource connection strings、
doctor 原始敏感字段或业务数据。

## 架构与仓库所有权

MVP 只新增一个 Plugin package：

```text
packages/dsh-data-analysis/
  environment     # resolver、doctor admission、identity assertion
  disclosure      # prompt、context、Tool、checkpoint、repair
  telemetry       # disclosure 成本和 outcome
```

Marivo 拥有 canonical inventory、target routing、focused help、public API、Skill 和 runtime
contract。DeepSeek Harness 保持通用 Tool/context/Session seam。

实现优先使用 `ctx.tools.register()`、`ctx.tools.restrict()`、dynamic system-prompt context 和
`agent/turn-stopping`。若当前 extension point 无法满足上述 invariant，应记录精确 upstream
blocker，不在 Plugin 中复制 Agent loop。

## 实现切片

### Slice 1：Environment Binding

- config 和解释器解析；
- subprocess policy；
- doctor admission matrix；
- binding fingerprint；
- per-help import identity assertion；
- failure contract。

退出条件：doctor、inventory、focused help 的实际 interpreter/version/package path 一致；
缺失 datasource secret 不会单独阻止 disclosure。

### Slice 2：Help Tool

- 验证既有 `marivo.help("targets")` public contract；
- `marivo_help` schema；
- empty/multiple/duplicate/invalid targets；
- multi-target all-or-nothing delivery；
- raw stdout body capture；
- timeout、size 和 cancel；
- standard Tool Result。

退出条件：每个成功 target 的 Tool Result body 与相同 binding 直接运行
`marivo.help(target)` 的 stdout 一致；Plugin 不解析 inventory 或 focused help。

### Slice 3：Checkpoint

- native-mode Headless profile；
- system prompt 和 inventory context；
- scoped Tool restriction；
- two-state transition；
- bounded missing-declaration repair；
- per-turn help call budget；
- disclosure telemetry。

退出条件：普通 Tools 在 checkpoint 不可见；合法 Tool Result 后恢复；缺失声明和 invalid
target 都不能产生无限 turn。

### Slice 4：真实模型验收

- 一个已知 Marivo analysis task；
- 一个需要多次 help 的 task；
- 一个 `targets=[]` task；
- 一个 invalid-target repair task；
- 一个 missing-declaration 超限 task；
- 一个 datasource credentials 缺失但 disclosure 可用的 task。

退出条件：所有轨迹满足 disclosure protocol，并与直接 `Marivo skill + Python` 基线比较成本
和可靠性。

## 验收旅程

### E1：有非准入 doctor failure 的环境

给定 Marivo 可 import、项目 identity 有效，但 datasource secret 缺失：

- doctor top-level status 可以是 `fail`；
- Plugin 识别 failure 来自非准入 check；
- binding 成功；
- inventory 与 focused help 正常工作。

### E2：从 inventory 请求 focused help

- checkpoint 提供完整原始 inventory；
- LLM 调用 `marivo_help`；
- Plugin 不预检 target membership；
- Marivo 成功解析 target；
- exact stdout body 进入下一 step。

### E3：错误 target

- LLM 请求一个不存在的 target；
- Plugin 实际调用 Marivo；
- Marivo target failure 作为 bounded Tool failure 返回；
- checkpoint 不完成；
- LLM 从仍可见的 inventory 自己重选；
- Plugin 不做字符串相似度替换。

### E4：明确不需要 help

- LLM 返回 `targets=[]`；
- checkpoint 合法完成；
- Tool Result 只确认没有请求；
- Plugin 不强制添加 root help。

### E5：repair 有界

- LLM 连续忽略 `marivo_help`；
- Plugin 最多 steering 两次；
- 再次缺失时当前 turn 以明确错误结束；
- user cancel 不触发新的 step。

### E6：环境 shadowing

- 测试环境通过 cwd 或 `PYTHONPATH` 提供另一个 Marivo package；
- help runner 的 import identity 与 binding 不一致；
- Plugin 拒绝输出 help 并要求 rebind。

## 验证

### Deterministic tests

- project root/interpreter resolution matrix；
- doctor JSON parsing 与 admission matrix；
- non-gating secret/datasource/skill failure；
- subprocess cwd/environment policy；
- interpreter/version/package identity mismatch；
- current inventory passthrough without parsing；
- Tool schema 和 mechanical input bounds；
- empty/multiple/duplicate/invalid target behavior；
- multi-target all-or-nothing delivery；
- stdout/stderr/timeout/process-group cancel bounds；
- native-mode Tool restriction install/dispose；
- missing declaration repair limit；
- per-turn help call limit；
- user cancel does not steer；
- no private registry import；
- no focused-help or inventory cache；
- no system-Python fallback。

### Real-model tests

Plugin telemetry 至少报告：

- 是否返回合法 HelpRequest；
- requested targets；
- help success/failure 次数；
- empty declaration 次数；
- steering repair 次数；
- help text tokens；
- 额外模型 steps；
- disclosure latency；
- 最终是否完成用户任务。

LLM 后续实际使用了哪些 API、是否使用绑定解释器，只能通过 E2E transcript 的离线人工或测试
标注观察，不属于 Plugin runtime telemetry 或 contract gate。

### Counterfactual

同一任务比较：

```text
Marivo skill + Python
vs
Marivo skill + dsh-data-analysis disclosure protocol + Python
```

必须比较漏查 help、invalid/remembered target、过期签名、任务完成率，以及总 token、step、
latency 和重试。

MVP 不因协议更完整就自动判定成功。如果可靠性没有提高，或额外模型 step 成本不可
接受，应停止该方向，而不是继续增加 checkpoint、cache 或 planner。

## MVP 退出标准

MVP 完成必须同时满足：

1. Plugin 验证并原样提供当前 Marivo 的 target inventory；
2. doctor admission 不受非准入 datasource/secret failure 错误阻断；
3. doctor、inventory 和 focused help 的实际 import identity 一致；
4. native-mode checkpoint 只暴露 `marivo_help`；
5. `targets=[]` 被正确接受；
6. 非空 target 的原始 help stdout body 完整进入下一 step；
7. invalid target 由 Marivo 自己判定，Plugin 没有 membership registry；
8. missing declaration、invalid call、timeout 和 cancel 都有明确终止边界；
9. Plugin 不缓存 help、不包含 objective-to-API 规则或 API usage checker；
10. deterministic tests 通过；
11. 真实模型旅程通过 disclosure contract；
12. counterfactual 报告给出可靠性与成本结果。

## 已知限制

- LLM 可能选择错误、不完整或过多 target；
- LLM 可能请求 help 后仍不使用；
- 完整 inventory 会占用显著 context；
- 强制 user-turn checkpoint 会增加模型 step 和延迟；
- Plugin 不保证 Agent 后续使用绑定解释器；
- Plugin 不保证 Marivo-first execution 或 raw fallback 时机；
- Plugin 不评价分析结果可信度或正确性；
- MVP 不沉淀 semantic layer，也不投影 Marivo Evidence。

这些限制是当前职责边界，不应通过 Plugin 猜测 API 或检查 Python 来静默填补。

## 后续扩展

只有 MVP 证明 disclosure 有增量价值后，才评估：

- surface-specific target index；
- 带可信 build identity 的 help cache；
- 基于真实轨迹增加 checkpoint 触发点；
- help Tool Result 的 analysis-aware compaction；
- Marivo Artifact/Evidence 的原生 UI；
- semantic authoring handoff 与 promotion；
- 明确、独立设计的 fallback execution policy。

## 源码与契约锚点

- 上位愿景：[设计愿景](design-vision.md)
- Harness Agent loop：
  [DeepSeek Harness architecture](../../deepseek-harness/docs/architecture.md)
- Harness Tool restriction：
  [Tools subsystem](../../deepseek-harness/docs/subsystems/tools.md)
- Harness prompt/context：
  [System prompt subsystem](../../deepseek-harness/packages/core/system-prompt/README.md)
- Marivo target inventory 和 unified help：
  [`marivo.help(...)`](../../marivo/marivo/_help/render.py)
- Marivo target inventory renderer：
  [`render_targets()`](../../marivo/marivo/_help/topics.py)
- Marivo doctor：
  [`marivo doctor`](../../marivo/marivo/doctor.py)
- Marivo analysis skill：
  [`marivo-analysis`](../../marivo/marivo/skills/marivo-analysis/SKILL.md)
