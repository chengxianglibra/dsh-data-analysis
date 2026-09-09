# 第二阶段 2a 当前请求规则与报告身份验收

## 交付范围

本切片对应 [第二阶段调研](dsh-context-stage-two-research.md#建议切成四个独立交付) 中的 2a。
基于 `a63dcfc` 实施，插件只修改 disclosure 接缝与 reader 上下文身份：Harness 继续拥有 prompt
组装、Session、工具及输入生命周期，Marivo 继续拥有 Skill、实时 Help、分析与 Evidence 契约。

显式 invocation 在 system prompt 组装后激活时，根 Help 整批成功后追加带插件来源的执行规则。
凭据规则与 analysis 收尾规则从原定义提取，正文逐字保持不变；`plugin.ts` 的既有凭据规则导出保持兼容。
新增模块属于内部共享实现，不增加 Tool、RPC、报告 schema 或 package exports。

Review 修复将补发 hook 的注册移至 `installMarivoPlugin`。公开的 `installMarivoDisclosure` 继续只提供
实时 Help，不向未安装执行工具或凭据服务的调用方下发完整插件规则；未增加公共配置字段。

报告上下文增加 `Report ID`，与 Workspace、Build、Cell 一起取自实际显示的 document，在线 Ask DSH
和离线复制共用此路径。2a 不实施上下文预算、语义对象插入、规则精简或 runtime context 实验。

真实 Web 失败注入发现原生 Tab 的 Ask DSH 异常直接冒泡、没有页面提示；本切片复用 Tab 既有 action
错误处理显示失败原因，并在成功重试后清除提示，草稿仍只通过原 Host 输入操作追加。

## 请求级确定性证据

使用安装的 Harness `0.1.5-alpha.1` 真实 Agent loop、生产 `installMarivoPlugin`、fixture Help 子进程
与 mock adapter 捕获实际请求 messages；不调用远端模型。修改前新增的 5 项测试全部失败，证明
两类显式激活首请求与双 Skill 场景缺少规则补发，随后用同一组测试验证修复。

覆盖直接 inbox、下游 pre-step producer、analysis/semantic、同轮双 Skill、semantic 后新增 analysis、
重复激活和后续请求。额外覆盖 focused root Help 已可见、`startsRequestSeries` 保留、普通问题、
Agent-local 同名 Tool shadow、拒绝、双 Skill 原子失败、取消、dispose、compaction 和 controller 恢复。
失败路径断言没有请求或部分规则/Help 入账，恢复路径断言实际请求重新具备规则和实时 Help。

新增四项 Help-only 回归覆盖 inbox/waterfall × analysis/semantic，修复前全部失败，修复后要求首请求
和后续请求都有 root Help、没有执行规则，工具集合保持 `marivo_help / ordinary / skill`。

补发只针对当次新增的规则需求；后续由原 system sections 提供规则。首次补发保留在历史中，
与后续 section 存在有限重复，不删除历史、不改变 Help digest 和 delivery 统计。此项是正确性修复，
没有 token 成本优化或模型任务表现的结论。

## 报告与真实 Web 验收

formatter 测试覆盖同标题不同 Report、Workspace 与 Build 身份；Tab 生命周期测试断言 current
提示新版本但尚未刷新时引用旧 Build，刷新后引用新 Build，固定 Build 继续引用自身。既有精确值、
筛选、来源、chip 坐标和失败保留测试继续执行。

扩展 `validate:right-tabs:web`，通过真实原生 Tab 的 cell 菜单检查实际 composer 草稿中的完整身份，
并验证写入失败保留 reader 与完整草稿、重试成功。该流程采用隔离 Workspace/profile、打包的生产
客户端及真实 Runtime，模型边界为 scripted adapter；不重装用户插件、不重启现有服务。

## 验证结果与限制

2026-09-09 初次实现使用 Node.js `22.19.0` 完成以下检查：

- `npm run check`：quality、依赖树、源码/脚本 typecheck 与全部 467 项测试通过。
- `npm run build`：通过。
- `npm run verify:plugin-package`：通过；227 个文件，28 个 DSH peers 均为 `0.1.5-alpha.1`，
  打包的 presentation kit、契约与 offline builder 均通过验证。
- 两段执行规则的定义与基线逐字比较相同；文档本地链接目标检查与 `git diff --check` 通过。

隔离 Web 使用 Harness `0.1.5-alpha.1`、Marivo `0.5.4` 和 Chrome `152.0.7977.83`，
41 项检查通过，包括 Native/PTC、上述身份和失败路径，以及断线重连、Workspace 撤销、延迟返回和无 Session 浏览。
逐次点击审计额外确认没有新增 submit/send/serialize RPC。该次验收包的全部生产 JS 模块摘要与当时
构建一致。本地 evidence 为 [2a Web evidence](../artifacts/dsh-context-stage-two-a-web-JE6GVD.json)
（被 Git 忽略）；原始运行目录标识为 `dsh-right-tabs-stage-one-JE6GVD`。临时测试 Workspace/profile
已由脚本清理，证据独立保留；以上关键结果同时写入本文，避免依赖本地 artifact 才能了解验收结论。

## Review 修复复验

Help-only 兼容性修复后，`npm run test:help-disclosure` 的 47 项测试通过：完整插件保留首请求
补发与全部失败恢复断言，独立安装保持原有工具集合和 Help 行为。

`npm run validate:help-disclosure:real` 使用实际安装的 Marivo `0.5.4` 和真实 Harness loop，
通过实时 inventory、focused Help、模型调用 Skill 及新增的两次显式激活验证。每个显式激活只有
一个模型请求，工具集合均为 `marivo_help / ordinary / skill`，没有插件执行规则；模型 adapter
仍为 scripted，不调用远端模型或业务数据库。
[Review 实时 Help evidence](../artifacts/dsh-context-stage-two-a-review-help.json) 仅记录身份和汇总结果，
不复制请求或 Help 正文。

Review 修复后的 `npm run check` 全部通过（471 项测试，含 quality、依赖树和 typecheck）；
其中 reader 验证执行的 `npm run build` 通过。`npm run verify:plugin-package` 也通过：227 个文件，
28 个 DSH peers，presentation kit、契约与 offline builder 均通过验证。`git diff --check` 和文档
本地链接检查通过。

此修复未改 reader/client，不重复初次 Web 验收；安装边界通过生产 `installMarivoPlugin` 的
请求级回归及上述真实 Help 路径验证。

本切片不调用业务数据库、不运行远端模型 A/B，也不提交、推送或发布。
