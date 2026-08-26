# Slice 2 验收：Help Tool

状态：通过

日期：2026-08-25

规格来源：[MVP 设计](mvp-design.md#slice-2help-tool)

前置验收：[Slice 1 Environment Binding](slice-1-acceptance.md)

## 独立范围

本 Slice 只实现：

- 当前 binding 下的原始 `marivo.help("targets")` inventory loader；
- native `marivo_help` Tool schema 和标准 Harness Tool Result；
- empty/multiple/duplicate/invalid target 行为；
- multi-target all-or-nothing 交付；
- focused help 的 timeout、cancel、单 target/组合 stdout 和 stderr 上限；
- help 渲染前同一 Python 子进程内的 import identity assertion。

本 Slice 没有实现 per-turn checkpoint、Tool restriction、steering repair、调用预算或
telemetry；这些属于 Slice 3。

## 开发结果

实现位于 `packages/dsh-data-analysis/src/disclosure/`，并直接使用当前 DeepSeek Harness
`@deepseek-ai/dsh-tools@0.1.1-rc.2` 的 `defineTool()` 和 Tool Runtime：

- 输入 schema 只有必填 `targets: string[]`；`targets=[]` 合法；
- Plugin 只检查数量、单 target 长度、总字符数和非空字符串，不预检 membership；
- 重复 target 按首次出现顺序去重；
- 每个 target 实际运行 `marivo.help(target)`，成功 canonical value 保存原始 stdout body；
- 只有全部 target 成功后才生成 Tool Result，失败不交付本批之前的 stdout；
- inventory 使用独立 1 MiB 上限，每次调用都重新运行，不解析、不缓存；
- identity mismatch 使用专用 exit 进入 binding `failed`，普通 invalid target 不污染 binding。

## 独立审查

审查发现 timeout、cancel 和 stdout overflow 最初直接透传 environment error，缺少 target
identity。验收前已统一包装为 target-specific bounded failure；identity mismatch 和已经失败的
binding 仍保留明确的 rebind 错误。

审查同时确认：

- Tool schema 不暴露 host-side timeout；
- canonical output 与 Native render 分离；
- 没有 private Marivo registry、inventory parser 或 focused-help cache；
- multi-target 顺序执行，交付语义明确，不声称回滚 Marivo 自身 telemetry side effect；
- `targets=[]` 不启动 focused-help 子进程；正常 checkpoint 会先由 Slice 3 注入新 inventory。

## 确定性验收

```text
npm run typecheck   -> pass
npm run test:slice2 -> 9 passed, 0 failed
```

测试使用真实 Harness `Context`、`SystemPrompt` 和 `ToolRuntime`，验证 schema、标准
`isError`、raw body、去重、all-or-nothing、输入/输出边界、timeout/cancel、inventory no-cache
和 binding fail-closed。

## 本地 Marivo 源码验收

继续使用 Slice 1 建立的 editable source environment：

```text
Marivo source commit: 219337844187384514dc3736430fc9fecbc50004
Marivo version: 0.4.13.dev0
Inventory stdout: 15,560 bytes
analysis.observe stdout: 6,732 bytes
analysis.compare stdout: 5,447 bytes
```

`npm run validate:slice2:real` 完成以下实测：

1. inventory 连续两次调用 byte-for-byte 相同且均真实执行；
2. `analysis.observe`、`analysis.compare` Tool canonical body 与同 binding 直接
   `marivo.help(target)` stdout 完全相同；
3. duplicate target 只执行一次，`targets=[]` 成功；
4. invalid target 产生标准 `isError`，不包含本批先前成功 stdout；
5. doctor 后在 project cwd 注入 shadow `marivo` package，下一次 inventory 在渲染前拒绝，
   binding 状态变为 `failed`。

## 结论

Slice 2 退出条件满足，可以进入 Slice 3。Slice 3 必须直接注册本 Slice 的 ToolDefinition，
checkpoint 只负责编排可见工具和 step 状态，不得复制 help runner 或重新解释 target 内容。
