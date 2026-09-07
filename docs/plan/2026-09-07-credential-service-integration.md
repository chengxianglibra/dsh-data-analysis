# 凭证服务集成实施计划

状态：实施完成，验收结果见 [集成验收](../plan/2026-09-07-credential-service-acceptance.md)。依据 [凭证管理设计](marivo-credentials-design.md) 和
[Marivo 公开 resolver 契约](../../../marivo/docs/superpowers/specs/2026-09-05-injectable-datasource-credentials-design.md)。

## 确定的执行边界

- DSH Credentials 保持唯一值存储，原引用到映射地址的规则保持；同引用跨 Workspace 共享。
- 固定测试 bridge 与新 `marivo_python` 使用 stdin snapshot 和 `md.credential_scope`；不通过环境变量或 argv 传值。
- 新 Python Tool 使用 DSH Shell 执行服务的前台、沙箱与取消契约；Host 校验执行授权，Agent 只提交代码和 datasource 名称。
- 每次执行 fresh-resolve，单次短进程内 snapshot 固定。Session/reader 必须在同一 resolver 下创建或恢复。
- access 签发绑定 Agent、environment、datasource 定义与引用的 Python 执行授权；不再向 Shell 发放秘密环境变量。
- 管理操作、任务等待、长轮询和终态查询由插件拥有，DSH 与 Marivo 源码不修改。

## 实施顺序与文件责任

1. `environment/`、`datasource/`：管道输入、公开 resolver、定义身份、前台 Python 执行和有界授权。
2. `datasource/`：管理服务、操作去重、输入等待、取消和 RPC；接入 test/access。
3. `client/credentials/`、`client.tsx`：常驻管理页、待办入口、状态恢复、可更换表单；移除历史结果自动弹窗。
4. 定向回归、完整 check/build/package、真实 Python 与 Host 组装验证；更新当前文档和验收记录。

## 验收重点

秘密值不进入环境、argv、普通结果、日志与持久化；显式 resolver 不访问默认 env/cache。
错误与越权 fail closed；变更定义或 Workspace 后拒绝旧动作与授权。
保存与验证分开记账；重复 operation ID 不再次写入或测试；响应丢失仅查询。
原调用存活时保存验证后继续，外层取消后不复活；页面刷新不取消 Host 调用。
轮换、删除、取消、dispose 竞争不泄漏、不混合 snapshot，不宣称撤回已接受执行。

不使用 mock 或端口健康替代真实 Agent/Web 续接验收；不可用环境在验收记录中明确标记。
