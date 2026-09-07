# Datasource Credentials 模块

## 所有权与入口

DSH Credentials 保存、解析和描述凭证；Marivo 定义 datasource、凭证字段和连接失败语义；插件负责
Workspace 绑定、管理页面、等待中的调用和单次执行注入。上游契约见
[Marivo injectable credentials](../../../marivo/docs/superpowers/specs/2026-09-05-injectable-datasource-credentials-design.md)。

侧栏“数据源与凭证”不要求 live Agent。选择 Workspace 后显示 datasource、字段引用、是否配置、来源、
是否可写和最近测试。页面支持填写或替换、删除和测试，不回显已保存的值。替换与删除需要明确确认。
同一原始引用跨 Workspace 共享；测试结果属于对应的环境和 datasource 定义，凭证更新后标记过期。

原始引用按 UTF-8 字节编码到 `DSH_DATA_ANALYSIS_CREDENTIAL_<HEX>`，区分大小写。只访问映射地址，
不回退到同名 Host credential。继续拒绝 `MARIVO_*`、`DSH_DATA_ANALYSIS_*` 和 Host 自有 Shell facts。

## 工具与自动续接

- `marivo_datasource_test({ name })`：撤销当前 Agent 同作用域授权，执行真实 `md.test()`。
- `marivo_datasource_access({ name })`：配置齐全时只发放内部执行授权，不测试；有效期 30 分钟、最多 64 次。
- `marivo_python({ code, datasources })`：使用已授权 datasource 执行前台 Python。无凭证代码可传空列表。

默认 `credentialInteraction: 'web'`。缺失配置时，根 Agent 的 test/access 保持原调用等待，并在会话标题
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

每次 Python 执行都校验 Agent、环境 fingerprint、datasource 定义、期限和次数，先消费一次额度，再
fresh-resolve。单次执行使用固定 snapshot；轮换或删除撤销后续授权，不承诺撤回已经接受的执行。
Agent 参数仅包含代码和 datasource 名称，授权 token 与凭证值都不返回 Agent。

Python 通过 DSH Shell 服务继承前台执行、沙箱策略、限制和取消能力；普通 Shell 不获得 datasource 值。
独立 launcher 在 DSH 输出落盘前捕获 worker 的 stdout/stderr，分别限制到 1 MiB 并执行 exact-value
脱敏，覆盖原始文件描述符输出和 traceback。快照不进入 argv、环境、日志或结果，结束时清理 Host 引用。
这保护正常执行中的凭证传递与意外输出；允许使用凭证的 Python 本身不是不可读取凭证的隔离边界。

## 管理操作与并发

私有 RPC 使用 Host generation、context token、凭证 version 和 operation ID。相同 ID 只执行一次；
响应丢失后仅查询，不重发秘密值。Client 按 operation ID 独立查询、展示与取消；刷新恢复全部未完成句柄，
一个操作结束或晚到的响应不覆盖另一个操作。终态和待办保留 30 分钟，容量有界；Host 重启后明确不可恢复。
管理页关闭或刷新不取消正在保存的操作，显式取消才终止验证。已经成功保存的字段不会因为后续测试失败而回滚。

写入与 snapshot 解析串行，写入前撤销相关授权。执行前后复核定义和 version，拒绝旧上下文的晚到动作。
外部 DSH credential 更新也撤销授权，并刷新等待表单的配置状态。解析快照和连接测试期间的引用有单独的
计数跟踪，不依赖管理页或已有授权；中途更新会使快照或测试结果失效，完成后释放跟踪。provider 错误只投影安全错误码；
原始值、异常详情不进入 RPC。只读来源由 DSH provider 拒绝写入，页面同时展示不可写状态。

## 验证

```bash
npm run test:datasource-credentials
npm run validate:datasource-credentials:real
npm run validate:datasource-access:real
npm run validate:credentials:web
```

真实验收、运行前提和范围见 [凭证服务集成验收](../plan/2026-09-07-credential-service-acceptance.md)。
