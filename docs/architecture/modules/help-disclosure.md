# Help 披露模块架构

## 作用

本模块让 Agent 从当前绑定的 Marivo 安装获取实时、可归因的 API Help。它同时提供显式 focused
`marivo_help` Tool，以及由绑定 Runtime 提供的 Marivo Skill 激活的根 Help 注入。

模块不维护 Help target registry、不解析 Marivo Help 内容、不做 fuzzy replacement，也不通过工具
门禁强迫 Agent 先请求 Help。target 语义和正文由真实 `marivo.help(target)` 唯一拥有。

总体关系见[总体架构](../README.md)。实现集中在：

- `packages/dsh-data-analysis/src/disclosure/help.ts`
- `packages/dsh-data-analysis/src/disclosure/bridge.ts`
- `packages/dsh-data-analysis/src/disclosure/activation.ts`
- `packages/dsh-data-analysis/src/disclosure/index.ts`

## 两类披露入口

| 入口 | 触发方式 | 目标 | 交付位置 |
| --- | --- | --- | --- |
| 根 Help | 成功加载 Marivo Skill，或用户显式 Skill invocation | `analysis` / `authoring` | 下一模型请求前注入 DSH user message |
| Focused Help | Agent 调用 `marivo_help({ targets })` | 一到多个 canonical string target | Tool Result |

Skill 与根 target 的映射是插件拥有的唯一小型映射：

```text
marivo-analysis  -> analysis
marivo-semantic  -> authoring
marivo-service   -> analysis
```

这只是集成触发点，不是 target inventory。完整 inventory 始终通过实时 `marivo.help()` 获取。
`marivo-service` 仅在绑定 Runtime 提供该 Skill 时可用。若它与 `marivo-analysis` 同时激活，
两者分别保留可核验的 Skill 身份，共用一个当前可见的 `analysis` 根 Help 正文。

## `marivo_help` 读取流程

1. 使用插件启动时已验证的 shared Runtime `MarivoHelpBridge`，不解析或初始化 Workspace。
2. 对 `targets` 只做机械边界校验：必须是数组、数量/单项长度/总长度受限。
3. 按首次出现顺序去重；空数组在启动子进程前失败。
4. 对每个 target 调用 Help adapter；adapter 拥有 Python program，并通过 Environment 通用 checked runner
   在同一进程核对 import identity 后执行真实 `marivo.help(target)`。
5. 检查单 target timeout、stdout/stderr 上限、空 stdout 和批次总输出上限。
6. 计算正文 SHA-256 digest，并结合当前 prompt 可见性标记 `delivered`、`already-visible` 或
   `replacement`。
7. 整批成功后向模型正文返回 Runtime 版本、target 与原样 Help body。插件附加的完整 fingerprint
   只用于 Host presentation metadata；Marivo 自身 Help 正文可能包含 Python/Package 绝对路径，透传层不删除或改写这些正文事实。

多 target 读取是 all-or-nothing：任何 target 失败都使 Tool call 失败，不返回其他 target 的部分正文。
模块不把 invalid target 替换成相近名称；Marivo 的真实错误经稳定 `target-failed` 边界返回。

默认资源边界由 `DEFAULT_MARIVO_HELP_LIMITS` 统一定义。调用方可以缩小或调整正整数限制，但不能
关闭超时、输出上限或 Tool 总 timeout。

## Skill 激活式根 Help

每个 Agent 有一个 `MarivoDisclosureController`。它观察两类结构化事件：

- inherited `skill` Tool 的成功结果；
- source 为 `skill-invocation` 的显式用户消息。

只有真实 inherited 全局 `skill` Tool 被观察；若 Agent scope 覆盖了同名 Tool，插件不把其结果当成
可信 Skill 激活。普通文本、bash 命令和 Python 内容不会被猜测为 Skill 激活。

根 Help 注入前，插件核对实际加载的 Skill 正文与绑定 Runtime 包的同名 Skill 正文。不同 provider
但正文相同可以通过；正文不一致或来源无法验证时明确拒绝，提示对齐并重新加载。用户显式 invocation
通过 Harness 公开 Skill registry 与实际消息内容核对；模型调用同时核对最终呈现内容。若冲突正文
仍在 Session 的 model-visible surface 中，即使重新加载也不能混用，需开启新 Session 或由 Host
管理上下文后再继续；插件不删除旧记录。插件不更改 Harness 的同名 Skill 优先级，也不修改 Workspace
Skill。该检查不验证 Skill 附带的其他资源。

激活后，controller 在 `agent/pre-step` 中等待 Harness 先生成原 decision，再为进入模型的消息追加
根 Help。多个 Skill 同时待披露时按稳定顺序读取，并以一个批次交付；任一读取失败则不注入任何
根 Help，并记录 failure telemetry。

公开的 `installMarivoDisclosure` 仅安装 Help。完整插件另行注册常驻任务路由，该 section 在首次请求、显式 Skill invocation 和会话恢复时均可见。路由在报告数据准备前指向展示 Skill，并保留独立组件脚本、早期草稿、逐组件 preview、最终一次 save 和数据刷新保持页面的核心规则；具体流程见[展示 Skill](presentation-skill.md)。这些提示不增加工具门禁，也不改写 Runtime Skill 的分析方法。Skill 激活只向允许进入模型的 decision 追加实时根 Help，保留原 decision 的其他字段。披露失败、取消及释放均不交付部分 Help。

常驻 Host 提示要求 Marivo API Help 只通过 `marivo_help` 获取，并将 Skill 或 Help 中的
`marivo help TARGET` 示例映射为 `marivo_help({"targets":["TARGET"]})`。不通过 Workspace 的
`.venv/bin/marivo`、PATH 中的 `marivo`、`python -m marivo` 或其他解释器读取 Help，避免使用另一份
Marivo 安装。Tool 不可用或失败时报告具体错误，不切换安装。该映射只规定 Host 调用入口，不改写
上游 Skill 或实时 Help 正文。

## Prompt 可见性与恢复

controller 不把“历史上曾经发送”当成“当前模型可见”。每个 pre-step 都从 DSH Session surface
重建当前可见 Help：

- 根 Help 从带 `marivo-disclosure` source 的 user events 识别；
- focused Help 从 Tool Result 的 `presentationMeta` 识别；
- 当前待进入模型的 messages 也参与可见性计算。

可见身份由 `environmentFingerprint + target + bodyDigest` 组成。三者相同则只返回
`already-visible`，避免在同一 prompt 重复正文；环境变化、正文变化或 compaction 将原内容移出
surface 时，controller 生成 replacement/recovery 消息。插件不跨 prompt 缓存 Help 正文，因此
editable source 即使版本和 package path 未变，重新读取仍能产生新 digest。

根 Help message 带结构化 source：Skill、target、Environment fingerprint、body digest 和是否更新。
Session 恢复时 controller 从已有 events 恢复激活 Skill，但仍按当前 surface 决定是否需要再次披露。
新产生的披露事件另记录已核验的 Skill 正文 digest；恢复时重新核对当前绑定 Runtime 的正文。
旧事件缺少 digest、后续成功加载的 Skill 身份未知，或正文已变化时，要求重新加载对应 Skill，
保留历史 Session；不会将当前 registry 的选择推断为历史加载的正文。
Harness 的历史 Tool 事件不包含注册身份。没有可信激活记录时，插件不能仅凭名为 `skill` 的历史调用
推断激活，因为它可能是 Agent 自有的同名 Tool。因而首次 Skill 调用成功后、插件记录核验结果前若中断，
恢复时无法从旧事件判断该调用来源；此窗口需要 Harness 提供可持久化的 Tool 身份才能彻底消除。
已有可信激活记录后再次出现无法归因的同名成功调用时，插件保守地要求重新加载；若该调用实际来自
Agent 自有的同名 Tool，也可能出现一次不必要的重载提示。
已有可信激活后的 canonical Skill 渲染可按正文检测可见冲突，但被改写为非 canonical 格式、且缺少可信注册身份的
历史结果无法可靠归因；不能将此校验宣称为对任意历史结果的完整验证。
Code Mode 中嵌套 Skill 使用 log-only 的 `tool/ptc-dispatch`，外层 `run_code` 可以重新投影结果；
现有事件不足以恢复哪些正文进入外层消息，也不能完整验证单次 PTC 内多次载入的所有正文。

## 工具可见性边界

`marivo_help` 是 Agent scope Tool，但插件不调用 `tools.restrict()`，也不隐藏 `skill`、`run_code`、
bash 或其他 profile Tool。native 与 ptc 模式保持 Harness 原行为（当前基线不再提供 both）。插件通过常驻 Host 提示
明确 Help 调用入口，Skill 负责流程指导；提示不构成执行拦截，不承诺在任意 bash/Python Marivo 执行前做拦截。

这一区分避免把“实时能力披露”扩大为通用命令解析器或安全沙箱。

## 状态与 telemetry

controller 的可变状态仅限单 Agent：

- active Skills；
- pending root Help；
- 当前 prompt 可见 Help 投影；
- activation、root Help 和 failure telemetry。

telemetry 记录 Skill/target、fingerprint、digest、delivery、原因、正文 byte 数和 latency，不记录凭证。
controller dispose 时 abort 未完成读取，注销 Tool 与 hooks，并清空内存状态。

## 失败边界

- input shape 或机械资源边界错误：`invalid-request`；
- Marivo target、timeout、cancel 或普通子进程错误：`target-failed`；
- 空 stdout：`empty-help`；批次总输出越界：`combined-output-limit`；
- Environment identity mismatch：保持原 `MarivoEnvironmentError`，并使 binding fail closed；
- Skill 正文不匹配或无法确认来源：根 Help 不注入，提示处理冲突或重新加载；
- 根 Help 批次失败：`MarivoDisclosureError`，不产生部分 prompt 注入。

## 公共接口与验证

`packages/dsh-data-analysis/src/disclosure/index.ts` 导出 `MarivoHelpBridge`、Tool builder/registration、
读取函数、limits、controller 和结构化类型。关键测试位于：

```text
packages/dsh-data-analysis/tests/help-disclosure/help-tool.test.ts
packages/dsh-data-analysis/tests/help-disclosure/activation.test.ts
```

测试重点包括空数组拒绝、重复/multi target、raw stdout parity、无 shadow registry、原子失败、Skill 激活、
compaction 恢复、Environment 替换、普通工具持续可见和 controller dispose。

生产安装路径的请求级测试另覆盖两类显式激活首请求、后续请求的稳定路由、已可见 focused root Help、
`startsRequestSeries` 保留、拒绝、失败、取消及恢复。

`npm run test:help-disclosure` 执行确定性测试；`npm run validate:help-disclosure:real` 在同一真实 binding
上验证实时 inventory、focused Help parity、无效 target 的原子失败，以及 Skill 激活后的根 Help 注入。
