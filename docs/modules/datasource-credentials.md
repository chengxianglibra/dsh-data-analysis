# Datasource Credentials 模块

## 所有权与入口

DSH Credentials 保存、解析和描述凭证；Marivo 定义 datasource、凭证字段和连接失败语义；插件负责
Workspace 绑定、管理页面、等待中的调用和单次执行注入。凭证使用遵循 Marivo 公开的
`md.credential_scope(resolver)` 契约。

在 DSH 会话标题旁点击“数据源与凭证”，默认打开该会话所属 Workspace 的管理面板，面板内仍可显式切换 Workspace。
入口通过 `conversation.session.header.actions` 使用所属会话的 `workspaceId`，面板复用 `shell.overlay`；
无会话或空会话时 Harness 不显示会话标题，侧栏底部不保留入口。管理页不要求 live Agent，显示 datasource、
字段引用、是否配置、来源、是否可写和最近测试。页面支持填写或替换、删除和测试，不回显已保存的值。替换与删除需要明确确认。
同一原始引用跨 Workspace 共享；测试结果属于对应的环境和 datasource 定义，凭证更新后标记过期。
入口与“语义层”共用会话标题按钮样式；管理页按 Workspace、数据源列表、凭证配置与连接状态分区，
适配窄屏和深色模式。已结束的调用不再列入会话待办；当前打开的调用仍显示结束原因和返回管理入口。
页面只保留操作所需状态与反馈；常驻区域不重复解释安全机制、等待预算或连接测试的限定条件。

原始引用按 UTF-8 字节编码到 `DSH_DATA_ANALYSIS_CREDENTIAL_<HEX>`，区分大小写。只访问映射地址，
不回退到同名 Host credential。继续拒绝 `MARIVO_*`、`DSH_DATA_ANALYSIS_*` 和 Host 自有 Shell facts。

## 工具与自动续接

- `marivo_datasource_test({ name })`：执行真实 `md.test()`，同步管理页的 `lastTest/stale`。
- `marivo_python({ code, datasources })`：在本次调用内准备全部精确 datasource，再执行一次前台 Python。
  声明本次可能访问的全部精确 datasource 名称，包括无需密码的数据源；完全不访问数据源时才传空列表，
  仍安装拒绝未声明凭证请求的 resolver。

`marivo-analysis` 或 `marivo-semantic` 激活后均披露此执行接缝，提示在一次调用内创建/恢复 Session，
并在 `try/finally` 中显式 `session.close()`。插件不接管 Session 生命周期，也不拦截 Agent 代码。
这里关闭的是本次独立 Python 进程中的资源，不是结束分析问题或删除持久 Artifacts；后续调用继续恢复
同一 Session 身份。未显式关闭属于清理约定偏差，须结合子进程退出边界判断，不能直接推断分析错误或泄漏。
分析激活后另有简短收尾提示，普通文字回答也须逐项回应用户问题与比较范围，保留未完成分支。
分析语义、执行流程和 Artifact 复用指导仍由当前 Runtime Skill 与 Help 提供，插件不补写这类规则。

成功 `marivo_python` 会在 Host 的 `$DSH_HOME/dsh-data-analysis/python-executions/` 按 Workspace 隔离，
原子保存本次提交的 Python 原文，并返回 `codeRef: {executionId, sha256}`，供报告 dataset 显式关联。
读写位置由 Host 决定，不从 Workspace 接受作者自报的执行记录文件。
只保存代码和完成时间等执行记录，不包含 resolver、注入 wrapper 或 credential snapshot。
记录失败通过 `codeCaptureError` 单独返回，保留原执行结果；调用方不应因此重放已经成功的分析。
非零退出、超时或取消不签发成功执行引用。报告构建的精确引用读取见[展示数据投影](presentation-projection.md)。

默认 `credentialInteraction: 'web'`。缺失配置时，根 Agent 的 test/python 保持原调用等待，并在会话标题
显示待办入口。用户提交后先保存，再测试；成功继续原调用。测试失败保持表单，可修改后重试，或把 Marivo
的失败与修复信息交还 Agent。已经配置齐全时的测试失败直接返回 Agent，不制造缺失输入待办。

页面刷新只恢复 Host 待办和操作状态，不保存未提交值、不重放调用。用户取消、Agent 销毁或外层 Code Mode
超时后，原调用结束，晚到的提交不能复活它。`credentialInteraction: 'none'` 与 subagent 返回
`needs-credentials`，由调用方处理；不等待无人可见的表单。

## 单次凭证注入

固定 test bridge 和 `marivo_python` 都通过 stdin 传送 Host snapshot。Python 在任何用户代码执行前进入
公开 `md.credential_scope(resolver)`；resolver 校验 Workspace、datasource 定义和字段，返回
`md.SecretValue`。显式 resolver 内不回退到默认 env/cache，不创建或同步 `~/.marivo/secrets.toml`。
Session 和 reader 应在该 scope 内创建或恢复。固定测试沿用 snapshot 已校验的原始 definition，
不通过重新读取定义扩大 grant；定义漂移由 Python resolver 在返回凭证前拒绝。

每次 Python 执行先核验 Agent、Workspace、环境 fingerprint 和全部 datasource 定义。缺失配置全部补齐后，
再取得一次 fresh snapshot；配置齐全不额外测试连接。准备期间取消、凭证轮换、删除或上下文变化会终止
原调用，不自动使用新状态重试旧代码。启动后失败也不重放；已发生的外部效果不会因取消而回滚。
不发放跨调用 lease，不保留 TTL、次数额度或 access Tool。Agent 参数仅包含代码和 datasource 名称，
凭证值不返回 Agent。

Python 通过 DSH Shell 服务继承前台执行、沙箱策略、限制和取消能力；普通 Shell 不获得 datasource 值。
独立 launcher 在 DSH 输出落盘前捕获 worker 的 stdout/stderr，分别限制到 1 MiB 并执行 exact-value
脱敏，覆盖原始文件描述符输出和 traceback。快照不进入 argv、环境、日志或结果，结束时清理 Host 引用。
这保护正常执行中的凭证传递与意外输出；允许使用凭证的 Python 本身不是不可读取凭证的隔离边界。

## 管理操作与并发

私有 RPC 使用 Host generation、context token、凭证 version 和 operation ID。相同 ID 只执行一次；
响应丢失后仅查询，不重发秘密值。Client 按 operation ID 独立查询、展示与取消；刷新恢复全部未完成句柄，
一个操作结束或晚到的响应不覆盖另一个操作。Client 操作列表只展示进行中状态，结束后立即移除记录和
恢复句柄；对应数据源保留最近测试结果及必要的失败、取消或部分保存反馈，不累积历史操作列表。
Host 为响应丢失恢复而保留终态和待办 30 分钟，容量有界；Host 重启后明确不可恢复。
管理页关闭或刷新不取消正在保存的操作，显式取消才终止验证。已经成功保存的字段不会因为后续测试失败而回滚。

写入与 snapshot 解析串行，写入时使受影响的待执行快照失效。执行前后复核定义和 version，拒绝旧上下文的晚到动作。
外部 DSH credential 更新也使受影响的准备失效，并刷新等待表单的配置状态。准备、快照和连接测试期间的引用有单独的
计数跟踪，不依赖管理页；中途更新会使旧快照或测试结果失效，完成后释放跟踪。provider 错误只投影安全错误码；
原始值、异常详情不进入 RPC。只读来源由 DSH provider 拒绝写入，页面同时展示不可写状态。

## 验证

```bash
npm run test:datasource-credentials
npm run validate:datasource-credentials:real
npm run validate:datasource-execution:real
npm run validate:credentials:web
```

一次执行准入的验收与限制见 [S1 验收记录](../plan/marivo-analytics-presentation-s1-acceptance.md)。
此前的管理服务背景见 [凭证服务集成验收](../plan/2026-09-07-credential-service-acceptance.md)。
管理页布局与完成状态清理见 [凭证界面验收](../plan/2026-09-07-credentials-ui-acceptance.md)。
会话标题入口与独立待办监听验证见[入口验收](../acceptance/workspace-header-actions.md)。
