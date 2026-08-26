# dsh-data-analysis — 设计愿景

状态：愿景

Marivo 侧相关 canonical 契约：

- [Agent-friendly public surface](../../marivo/docs/specs/agent-friendly-public-surface.md)
- [Python analysis design](../../marivo/docs/specs/analysis/python-analysis-design.md)
- [Evidence access surface](../../marivo/docs/specs/analysis/evidence-access-surface.md)
- [Semantic authoring workflow](../../marivo/docs/specs/semantic/authoring-workflow.md)

## 核心命题

`dsh-data-analysis` 是 DeepSeek Harness 的 Marivo-native 数据分析插件。它首先解决的不是
如何包装 Marivo Python API，也不是如何替 LLM 决定下一步分析方法，而是如何把当前已安装
Marivo 版本的 public API 信息可靠、按需、渐进地提供给 LLM。

Marivo 已经通过 `marivo-analysis`、`marivo-semantic`、`marivo.help(...)`、Artifact
`.show()` / `.contract()` 和 structured error 提供完整的 Agent-facing 使用路径。但 live
help 是否进入模型上下文，仍依赖 Agent 是否想起调用、是否知道正确 target，以及是否
使用了当前项目实际选定的 Python 环境。Skill 中要求“先看 help”不能保证这个动作真的
发生。

Plugin 将这条自觉行为改造成一个 Runtime 协议：

```text
新的分析决策轮次
→ Runtime 提供当前 Marivo 环境与 canonical help target 清单
→ System prompt 要求 LLM 声明本轮需要哪些 help targets
→ Runtime 检查声明是否存在、结构与资源边界是否合法
→ 使用同一已验证解释器执行 marivo.help(target)
→ 将原始 help 文本作为下一 step 的 context
→ LLM 自主选择、编写和执行普通 Marivo Python
```

LLM 负责把用户目标映射到可能需要的 API 信息。Marivo 没有自然语言推理责任；Plugin 也
不构造规则或 planner 替 LLM 选择 API。Plugin 只保证 target 名称空间、当前环境和 help
文本之间的可靠传递。

## 无插件基线与独立价值

直接使用 `Marivo skill + Python` 是明确基线。它已经能够：

- 教授分析和语义建模方法；
- 通过 `marivo.help(...)` 提供当前版本的精确 public contract；
- 通过普通 Python 执行 typed analysis；
- 通过 Artifact、Finding、Evidence、Quality 和 Lineage 保存可信结果；
- 通过 `.show()`、`.contract()` 和 structured error 支持观察、继续和修复；
- 将 reusable semantic gap 交给 `marivo-semantic`。

Plugin 不复制这些能力。它的独立价值只来自当前基线中不可靠的 Host 集成环节：

1. 绑定 DeepSeek Harness Session 与一个明确的 Marivo project root、解释器和安装版本；
2. 从该环境取得 Marivo 自己发布的 canonical help target 清单；
3. 强制每个规定的分析决策轮次先收到 LLM 的 help 需求声明；
4. 使用同一环境执行 help，避免系统 Python、其他虚拟环境或 remembered API 混入；
5. 让 help Tool Result 自然进入下一模型 step，而不是依赖 Agent 自己运行打印命令；
6. 记录 disclosure 轨迹，用于评价 Agent 是否获得了足够 API 信息以及协议成本。

如果 Plugin 只是复制 skill、增加一套 API 文档、把每个 Marivo API 包成 Tool，或者执行与
普通 Python 完全相同的脚本，它没有独立产品价值。

## 责任边界

四方分工如下：

> Marivo 拥有 API 与 help 真相；LLM 拥有分析推理和 API 信息选择；Plugin 拥有披露协议与
> 环境一致性；Harness 拥有模型 step、Tool、context 和 Session 生命周期。

### Marivo

Marivo 负责：

- public Python API；
- Skill、live help、Artifact contract 和 structured error；
- semantic、Artifact、Finding、Evidence、Quality、Lineage 和 Recovery 契约；
- 当前安装版本的 canonical help resolver 与 discovery index；
- 对每个 focused target 渲染 bounded、可复制、版本一致的 help 文本；
- 通过独立预算输出 canonical discovery index。

Marivo 不负责：

- 理解用户自然语言目标；
- 判断业务上应该使用哪个 API；
- 对候选 API 排名；
- 决定 Agent 是否应该继续当前 Artifact，还是分析其他数据。

### LLM

LLM 负责：

- 理解用户问题；
- 判断本轮是否需要 API 信息；
- 从当前版本 target 清单中选择零个、一个或多个 target；
- 根据 help、当前 Artifact 和用户目标决定实际分析步骤；
- 在结果出现后重新选择 API 信息或改变探索方向；
- 决定何时需要 semantic authoring、何时需要显式 terminal/raw 方法。

LLM 可以返回空 target 列表，表示它明确判断本轮不需要新的 API 信息。Plugin 接受这个
判断，不替它补选 target。

### dsh-data-analysis

Plugin 负责：

- 解析配置并选择一个精确 Marivo environment；
- 验证 project root、解释器、package path 和版本；
- 获取并提供 canonical target 清单；
- 注册 data-analysis system prompt、`marivo_help`，以及只负责凭证接缝的窄范围
  `marivo_test` Tool；
- 在 help-decision checkpoint 检查 LLM 是否返回结构与资源边界合法的声明；
- 调用真实 `marivo.help(...)` 并捕获 stdout；
- 将原始 help 文本作为标准 Tool Result 返回；
- 在每个直接用户 turn 刷新 target inventory，并复核实际 import identity；
- 为缺失声明、无效 target、timeout 和 cancel 提供明确终止边界；
- 记录 target 请求、成功、失败、文本大小、step 和延迟。

Plugin 不负责：

- 根据 objective 选择 target；
- 判断 LLM 是否漏选了 API；
- 判断所选 API 是否适合业务问题；
- 解析 target inventory 或预检 target membership；
- 检查 LLM 后续是否实际使用了请求的 API；
- 解析 help prose 以重建 API schema；
- 读取 Marivo private registry 或 private persistence；
- 建立第二套 Marivo capability、semantic 或 evidence authority。

### DeepSeek Harness

Harness 负责：

- 每个 step 的 system prompt、dynamic context 和 Tool schema 组装；
- `marivo_help` Tool Call 的结构化输入校验和 Tool Result 持久化；
- help-decision checkpoint 的 step/turn 编排；
- Session、恢复、取消、错误和 UI 展示。

## 当前版本的 canonical discovery index

LLM 不应猜 help target。当前 Marivo 通过现有 help 入口公开安装版本的稳定发现入口：

```python
marivo.help("targets")
```

它输出：

- global topics；
- `datasource`、`semantic`、`analysis`、`ontology` surface roots；
- 各 surface 的 direct capability 和 grouped drill-down targets。

清单只包含 canonical string form，例如：

```text
datasource.inspect
semantic.metric
analysis.observe
analysis.compare
analysis.recovery
ontology.authoring
```

它不包含：

- object、callable、`Ref`、Artifact 或 error instance；
- legacy alias；
- 可能歧义的 unqualified short name；
- private registry identity；
- public type、public error、receiver member 和 grouped leaf target；
- Plugin 自己推导或维护的 target。

被省略的 type、error、member 和 grouped leaf 仍可由 Marivo focused help 解析；Agent 可以从
group page、live result、`.show()`、`.contract()` 或 structured error 获得这些 target。

`dsh-data-analysis` 从当前绑定环境取得这份清单，不能把某个开发版本的列表写死在 Plugin。
Inventory 是 Marivo 拥有的文本契约；Plugin 将原始 stdout 提供给 LLM，不解析成自己的
membership set。输入 target 是否存在，由后续真实 `marivo.help(target)` 调用判定。

Discovery index 只暴露有界导航名称而不暴露完整签名，因此保留渐进披露。Inventory 使用
与 focused help 分离的安全预算。MVP 在每个直接用户 turn 的 checkpoint 重新读取一次，
不在普通模型 step 重复注入，也不缓存旧 inventory。

## Marivo 环境集成

Help 只有在来自实际执行分析的环境时才有意义。Plugin 为每个 Agent Session 解析一个
environment binding：

```text
MarivoEnvironmentBinding
  project_root
  python_executable
  marivo_version
  package_path
  subprocess_policy_id
  fingerprint
```

选择规则应简单、显式且可审计：

1. 优先使用 profile 或 Plugin 配置中明确指定的 project root 和解释器；
2. 未指定解释器时，只检查 project root 的常规 `.venv` 位置；
3. 不扫描整台机器，也不静默回退到系统 Python；
4. 使用所选解释器运行 `python -m marivo doctor --project-root ... --format json`；
5. 只用 installation 和 project identity checks 决定 disclosure admission，不因 datasource
   secret、skill 或 state failure 单独拒绝 binding；
6. `doctor`、inventory 和 focused help 使用相同 `cwd=project_root` 与 subprocess policy；
7. 每次 help 前复核 `sys.executable`、Marivo version 和 package path；
8. 任一 import identity 不一致时拒绝输出 help，并要求显式 rebind。

Doctor report 只用于第 4–5 步的一次性 admission；无论 top-level status 为何，都不进入
Environment Binding、checkpoint context、telemetry 或 Session。

Binding 是 API disclosure 的环境依据，不是 Marivo semantic 或 evidence identity。MVP 不缓存
inventory 或 focused help；每个直接用户 turn 重新读取 inventory，每次 Tool 调用重新执行
focused help。这样 editable install 或相同 dev version 的源码变化不会命中旧 help cache。

## Help-decision checkpoint

渐进披露不是 Plugin 猜测“下一步应该暴露什么”，而是一个 LLM 参与的两阶段协议。

### Help request step

System prompt 要求 LLM 先调用：

```text
marivo_help(targets=[...])
```

规则是：

- LLM 自己选择 target；
- 不知道具体名称时，先请求 root 或 surface target；
- 可以一次请求多个 target；
- 已有信息足够时返回 `targets=[]`；
- 当前 step 不同时执行分析代码。

Plugin 只检查声明是否存在、结构和资源边界是否有效，不预检 target membership，也不检查
选择质量。Target 是否存在由 Marivo 自己判定。

MVP checkpoint 只支持 Harness `native` Tool presentation mode：`marivo_help` 是该 scope 唯一
新增的 local Tool；已有 inherited `skill` 作为控制面保持可见，避免临时 restriction 被误报成
空 skill catalog。其他普通 Tools 由 scoped restriction 临时隐藏，合法 Tool Result 后立即释放。
缺失声明最多 steering repair 两次；超限或 user cancel 都必须结束当前 turn，不能形成无限 step。

### Help delivery step

Tool 使用绑定解释器依次运行：

```python
import marivo
marivo.help(target)
```

返回值是带 target 边界的原始 stdout。Plugin 不把 help 文本转成自己的 descriptor、schema
或 contract。Harness 将标准 Tool Result 放入下一 step context，随后 LLM 恢复普通分析行为。

### 后续 disclosure

LLM 可以在任何后续 step 再次调用 `marivo_help`。MVP 只在新的直接用户 turn 强制建立
checkpoint；是否为 structured error、Tool Result 或 Session resume 增加新 checkpoint，必须
由真实轨迹证明价值后再设计。

## 渐进披露的含义

这里的 progressive disclosure 是：

```text
canonical discovery index
→ LLM 选择少量 targets
→ 只加载这些 targets 的完整 help
→ LLM 根据新状态继续选择或停止请求
```

Discovery index 不等于完整 resolver 名称空间或完整 API 暴露。它只提供稳定导航入口；参数、
约束、示例、细粒度 target 和边界仍然只在请求具体 target 或读取 live object 后进入上下文。

当前 Artifact 的 `.contract()` 可以作为 LLM 已获得的信息之一，但它只描述该 Artifact 的
机械 continuation，不限制 Agent 重新选择 semantic root、数据、方法或其他 help target。

## Marivo-first 行为与诚实边界

Plugin 的 system prompt 应明确要求：优先使用 Marivo public API 完成受治理分析；只有 LLM
根据当前 help、structured error 和用户目标判断 Marivo 不能表达所需数据或方法时，才使用
raw SQL、Python 或其他手段。

但当前设计不检查实际 API 使用，也不实施 execution admission。因此它能可靠保证的是：

- LLM 看到了当前版本真实存在的 target 名称空间；
- LLM 明确声明了本轮需要的 help；
- 请求的 help 来自实际绑定环境；
- help 文本完整进入下一模型 step。

它不能机械保证：

- LLM 选择了最佳或完整的 target；
- LLM 后续确实使用了所请求 API；
- 只有 Marivo 不支持时才发生 fallback；
- LLM 最终分析结论正确。

这些属于模型行为和端到端评估。如果未来产品需要硬性 fallback 控制，应单独设计 execution
policy，不能把它悄悄塞进 API disclosure MVP。

## 可信结果与语义复利

可靠 disclosure 的产品意义在于提高 Agent 正确进入 Marivo public path 的概率。进入后，
可信和可追溯能力仍完全由 Marivo Artifact、Finding、Evidence、Quality 和 Lineage 提供；
Plugin 不复制或重新命名这些对象。

同样，分析中发现的 reusable business meaning 应通过 `marivo-semantic` 和 Marivo semantic
authoring workflow 沉淀。Plugin 可以在后续阶段改善 semantic help 的披露和 authoring
handoff，但不能根据 physical schema 自动创造 reusable business authority。

长期复利路径是：

```text
更可靠地发现 Marivo public API
→ 更多问题进入 typed analysis 与 semantic authoring
→ 更多可信 Artifact 和经权威确认的业务语义
→ 后续 Agent 更容易复用现有 Marivo 能力
```

MVP 只验证第一步，不声称已经完成 evidence-native delivery 或 semantic promotion。

## 用户价值

用户将获得：

- Plugin 的 inventory 和 focused help 使用与项目绑定一致的 Marivo 解释器和安装版本；
- LLM 在分析前看到当前版本真实存在的 help targets，不再猜 target；
- LLM 自己决定需要哪些 API 信息，探索空间不被 Plugin 规则缩窄；
- 请求的 live help 自动进入下一模型 step，不依赖 Agent 自己运行打印命令；
- 普通 Marivo Python 使用方式保持不变；
- Marivo typed result、Evidence 和 semantic layer 继续保持唯一权威；
- disclosure 轨迹可以测量可靠性、token 和延迟成本。

## 架构不变量

1. Marivo 是 public API、help target、help 文本和分析契约的唯一权威。
2. Target inventory 必须来自当前绑定的 Marivo 环境，Plugin 不复制、写死或解析成 membership
   registry。
3. LLM 独立选择需要的 target；Plugin 不进行 objective-to-API 推理。
4. Plugin 只检查 help 需求声明是否存在和可执行，不检查后续 API 使用。
5. Help 内容按原始文本传递；Plugin 不解析 prose 重建 contract。
6. 所有 help 调用使用同一 project root、subprocess policy、解释器、Marivo version 和 package
   path，并在执行前复核实际 import identity。
7. MVP 不缓存 inventory 或 focused help；未来 cache 必须先具备可信 build identity。
8. 除连接测试与 DSH credential seam 所需的 `marivo_test` 外，不增加 one-tool-per-API 包装；
   普通分析仍使用 public Python。
9. `targets=[]` 是合法、明确的 LLM 判断，不由 Plugin 覆盖。
10. Skill 继续拥有 workflow boundary；live help 继续拥有精确 API 信息。
11. Marivo Artifact/Evidence 和 semantic source 不被 Harness 复制为第二套 authority。
12. API disclosure 与 execution admission 是不同问题；MVP 只实现前者。
13. 强制 checkpoint 必须有 repair、调用和 cancel 终止边界，不能无限 steering。

## 非目标

本项目不应成为：

- one-tool-per-Marivo-API wrapper；
- Plugin 自己维护的 capability registry；
- objective-to-API 规则路由器；
- 替 LLM 选择 API 的确定性 `analysis.focus`；
- API usage checker 或 Python AST admission gate；
- raw SQL/Python fallback policy 的隐式实现；
- `.show()`、`.contract()` 或 help prose parser；
- 第二套 semantic catalog、Artifact store、Evidence ledger 或 Claim model；
- 用 target 列表替代 focused help 的完整 API dump；
- 自动从 physical schema 生成 reusable business meaning 的系统。

## 最高杠杆起点

最高杠杆是一个尽可能小的 Disclosure Kernel：

```text
EnvironmentBinding
+ current-version canonical target list
+ data-analysis system prompt
+ mandatory HelpRequest
+ marivo_help Tool
+ raw live-help Tool Result
+ disclosure telemetry
```

先证明它相对直接 `Marivo skill + Python` 显著降低漏查 help、猜错 target 和使用过期 API 的
概率，并把 token、额外 step 和延迟控制在可接受范围。只有这条基础链路成立后，才讨论
更强的 execution policy、evidence UI、semantic promotion、multi-agent 或 continuous
monitoring。

## 北极星产品

目标产品是一个 Marivo-native DeepSeek Harness Data Agent：它不替模型做分析推理，而是
保证模型每次都能从当前安装版本的真实 API 名称空间中自主选择所需信息，并在同一环境
获得精确 live help。Agent 随后继续使用普通 Marivo Python，让可信结果和业务语义仍然
沉淀在 Marivo 自己的 Artifact、Evidence 和 semantic layer 中。

## 源码锚点

- DeepSeek Harness 插件、Scope、Tool、Session 和 Agent loop：
  [DeepSeek Harness architecture](../../deepseek-harness/docs/architecture.md)
- 每 step 的 system prompt、dynamic context 与 Tool schema：
  [System prompt subsystem](../../deepseek-harness/packages/core/system-prompt/README.md)
- Tool schema、执行和 canonical Tool Result：
  [Tools subsystem](../../deepseek-harness/docs/subsystems/tools.md)
- Marivo unified live-help public boundary：
  [`marivo.help(...)`](../../marivo/marivo/_help/render.py)
- Marivo environment diagnosis：
  [`marivo doctor`](../../marivo/marivo/doctor.py)
- Marivo packaged analysis skill：
  [`marivo-analysis`](../../marivo/marivo/skills/marivo-analysis/SKILL.md)
- Marivo packaged semantic skill：
  [`marivo-semantic`](../../marivo/marivo/skills/marivo-semantic/SKILL.md)
