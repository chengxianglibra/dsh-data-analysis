# Slice 3 验收：Checkpoint

状态：通过

日期：2026-08-26

规格来源：[MVP 设计](mvp-design.md#slice-3checkpoint)

前置验收：[Slice 1](slice-1-acceptance.md)、[Slice 2](slice-2-acceptance.md)

## 独立范围

本 Slice 实现：

- 单 Agent、native Tool presentation profile；
- 稳定 system prompt 和每个直接用户 turn 的最新 raw inventory context；
- checkpoint 期间只暴露、只允许执行 scope-local `marivo_help`；
- `needs-help-declaration` / `analysis-step` 两状态转换；
- 最多 2 次 missing-declaration steering repair；
- 每 turn 最多 8 次 help 调用，schema error、invalid target 和失败调用都计数；
- user cancel 不 steering；
- inventory、help call、stdout 大小、latency、repair 和额外 step telemetry。

本 Slice 没有运行真实模型，也没有评价 Agent 最终分析结果；这些属于 Slice 4。

## 开发结果

实现位于 `packages/dsh-data-analysis/src/checkpoint/`。安装函数接收一个已创建的 Agent 和
Slice 1 Environment Binding：

- 明确声明 agent-scoped `native` presentation；已有其他声明则拒绝 profile；
- 启动前拒绝已有 scope-local Tool 或全局同名 `marivo_help`；
- `marivo_help` 是唯一 scope-local Tool；
- checkpoint 使用 `tools.restrict({ allow: [] })` 隐藏所有 inherited Tools；
- 合法 Tool Result 的同步 `tools/result` 边界立即解除 restriction；
- Tool 保持 scope-local，因此 analysis step 仍可主动请求更多 help；
- 第 9 次调用先由 guard 拒绝，下一 pre-step 以明确 Plugin error 终止，不会无限循环。

## 独立审查

初版把 restriction 和 inventory 加载放在 `agent/pre-step`。真实 AgentLoop 测试发现首请求仍
看见 ordinary Tool。源码核对确认 Harness 的实际顺序是：

```text
inbox.claim
→ systemPrompt.assemble
→ agent/pre-step
→ model request
```

因此 `pre-step` 对当前 assembly 已经太晚。验收前改为：

```text
agent/inbox/claimed（同步建立 restriction，启动 inventory）
→ scoped system-prompt/assemble（等待 inventory，保留 downstream assembly）
→ agent/pre-step（只执行预算 gate）
```

这个修复使用 Harness 公开 extension points，没有复制 Agent loop。`system-prompt/assemble`
listener 始终调用 `next()`，保留 downstream sections、contexts、tools 和 variables，只替换本
Plugin 拥有的 context name。取消 signal 在等待 inventory 前即绑定到 subprocess。

审查还确认：

- ordinary Tool 即使被模型猜中，也按 registry restriction 返回 unknown tool；
- invalid target 不解除 restriction，后续合法结果才完成 checkpoint；
- missing declaration 恰好 steering 两次，第三次明确终止；
- schema input error 计入调用预算；
- Runtime telemetry 记录 help text bytes/codepoints；真实 tokenizer token/总 input token 由
  Slice 4 的模型/provider usage 报告，不用字符数冒充 token。

## 确定性验收

```text
npm run typecheck   -> pass
npm run test:slice3 -> 7 passed, 0 failed
```

测试使用真实 `AgentLoop`、`AgentRegistry`、`ToolRuntime`、`SystemPrompt`、`SessionStore` 和
scripted Headless LLM adapter，覆盖：

- 首请求只见 `marivo_help`，成功结果后 ordinary Tool 恢复；
- 每个直接用户 turn 重新运行 inventory；
- 幻觉调用 hidden ordinary Tool 不能绕过 checkpoint；
- missing declaration repair 上限；
- invalid target repair；
- schema error/call budget 终止；
- scope-local Tool/native profile 冲突；
- user cancel 不增加 repair step。

## 本地 Marivo 源码验收

`npm run validate:slice3:real` 使用 editable `../marivo` 和真实 Headless AgentLoop：

```text
Marivo source commit: 219337844187384514dc3736430fc9fecbc50004
Marivo version: 0.4.13.dev0
First request tools: marivo_help
Second request tools: marivo_help, ordinary
Inventory stdout: 15,560 bytes
analysis.observe stdout: 6,732 bytes
Inventory latency: 2,298 ms
Focused help latency: 1,801 ms
Additional model steps: 1
```

首请求包含 raw inventory runtime-context snapshot；`analysis.observe` 的标准 Tool Result 已写入
Session，controller 最终状态为 `analysis-step`。

## 结论

Slice 3 退出条件满足，可以进入 Slice 4。Slice 4 只能做设计列出的六条真实模型旅程和
counterfactual 成本/可靠性报告，不得在验收阶段增加 planner、cache 或 API usage checker。
