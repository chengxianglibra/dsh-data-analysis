# Help 披露模块架构

## 作用

本模块让 Agent 从当前绑定的 Marivo 安装获取实时、可归因的 API Help。它同时提供显式 focused
`marivo_help` Tool，以及由 `marivo-analysis` / `marivo-semantic` Skill 激活的根 Help 注入。

模块不维护 Help target registry、不解析 Marivo Help 内容、不做 fuzzy replacement，也不通过工具
门禁强迫 Agent 先请求 Help。target 语义和正文由真实 `marivo.help(target)` 唯一拥有。

总体关系见[总体架构](../architecture.md)。实现集中在：

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
```

这只是集成触发点，不是 target inventory。完整 inventory 始终通过实时 `marivo.help()` 获取。

## `marivo_help` 读取流程

1. 使用插件启动时已验证的 shared Runtime `MarivoHelpBridge`，不解析或初始化 Workspace。
2. 对 `targets` 只做机械边界校验：必须是数组、数量/单项长度/总长度受限。
3. 按首次出现顺序去重；空数组在启动子进程前失败。
4. 对每个 target 调用 Help adapter；adapter 拥有 Python program，并通过 Environment 通用 checked runner
   在同一进程核对 import identity 后执行真实 `marivo.help(target)`。
5. 检查单 target timeout、stdout/stderr 上限、空 stdout 和批次总输出上限。
6. 计算正文 SHA-256 digest，并结合当前 prompt 可见性标记 `delivered`、`already-visible` 或
   `replacement`。
7. 整批成功后只向模型正文返回 Runtime 版本、target、Help body 与有界失败/截断；绝对路径和完整
   fingerprint 只用于 Host presentation metadata，不进入模型正文。

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

激活后，controller 在 `agent/pre-step` 中等待 Harness 先生成原 decision，再为进入模型的消息追加
根 Help。两个 Skill 同时待披露时按稳定顺序读取，并以一个批次交付；任一读取失败则不注入任何
根 Help，并记录 failure telemetry。

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

## 工具可见性边界

`marivo_help` 是 Agent scope Tool，但插件不调用 `tools.restrict()`，也不隐藏 `skill`、`run_code`、
bash 或其他 profile Tool。native、code 和 both 模式保持 Harness 原行为。当前设计只通过 Skill 内容
指导 focused Help 调用，不承诺在任意 bash/Python Marivo 执行前做拦截。

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

`npm run test:help-disclosure` 执行确定性测试；`npm run validate:help-disclosure:real` 在同一真实 binding
上验证实时 inventory、focused Help parity、无效 target 的原子失败，以及 Skill 激活后的根 Help 注入。
