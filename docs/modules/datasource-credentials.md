# Datasource Credentials 模块

## 作用

本模块把 datasource 凭证的健康检查与执行授权拆成两个明确边界：

- `marivo_datasource_test({ name })` 完成缺失凭证闭环并执行真实 connection test；
- `marivo_datasource_access({ name })` 只检查凭证并签发有界 foreground Shell lease，不执行连接测试。

Datasource/table metadata inspection 不属于这两个 Tool；Agent 直接调用 Marivo 公共
`md.inspect(datasource_ref, source)`。

## 凭证闭环

两个 Tool 都先运行 `md.describe(name)`，验证并去重原始引用，然后只从映射后的 DSH Credentials 地址
resolve。缺失时返回相同的 `needs-credentials` 结构，Web 表单展示原始名称，但 `credentials.describe/set`
始终使用映射地址。保存后只提示重试来源 Tool，不自动重放调用。

Datasource 的 `*_env` 字段可以使用任意合法 POSIX 环境变量名；`MARIVO_*` 与
`DSH_DATA_ANALYSIS_*` 是插件控制面保留名称；`DSH_HOME`、`DSH_SHELL`、`DSH_SESSION_ID` 与
`DSH_SESSION_JSONL` 是 Host 自有 Shell facts，也不能作为 datasource 引用。每个引用按原始字节确定性编码到
`DSH_DATA_ANALYSIS_CREDENTIAL_<HEX>`，编码区分大小写。插件不读取、迁移或回退到原始 Host credential
地址。

## Test 是健康检查

每次 `marivo_datasource_test` 开始都会撤销当前 Agent、Workspace、datasource 的活动 lease。凭证齐全时，
插件把值按原始名称放入仅属于 `md.test()` 子进程的 overlay，并固定
`MARIVO_PERSIST_CREDENTIALS=0`。成功结果只有：

```json
{
  "status": "ok",
  "name": "warehouse",
  "latency_ms": 12
}
```

missing、failed 与成功都不会隐式保留旧执行权限。

## Access 是执行授权

`marivo_datasource_access` 不调用 `md.test()`。凭证齐全时，它撤销同作用域旧 lease，再签发随机 token，绑定
Agent、Workspace fingerprint、datasource 与去重引用。成功结果中的 `shell_lease` 固定包含：

- 最长 30 分钟；
- 最多 64 次 foreground Shell；
- `bounded-foreground-shell-lease` usage；
- 完整 `bash_prelude` 与 `pwsh_prelude`。

Prelude 首行是：

```text
# dsh-marivo-credential-lease:<opaque-token>
```

后续行把 Shell registry 中的映射变量复制到原始环境变量名，清除内部变量，并设置
`MARIVO_PERSIST_CREDENTIALS=0`。Agent 原样复用同一 prelude，不自行推导映射。

每次 claim 先校验 token、TTL、Agent、Workspace 与 foreground 类型，再原子扣减一次，最后 fresh-resolve
映射凭证并创建只属于该 `ToolExecution` 的 snapshot。resolve 失败也消耗本次额度；格式错误、错作用域、
background 与 persistent 在 resolve 前拒绝且不消耗。第 64 次仍可执行，第 65 次明确要求重新 access。
snapshot 在 settle、cancel、error、Agent/plugin dispose 后清除。

Lease 只限制 secret 进入哪些 foreground Shell executions，不限制获授权 execution 内代码读取环境变量。普通
Shell 不 inventory Workspace datasource，也不获得 datasource credential。secret 不进入 argv、Tool Result、
日志或 telemetry，stdout/stderr 与结构化错误执行 exact-value redaction。

## Agent 指导

- datasource 新建、修改、凭证轮换、连接失败或用户明确要求时调用 `marivo_datasource_test`；
- `needs-credentials` 后等待用户在 Web 保存，再重试同一个来源 Tool；
- 开始 datasource-backed 分析时调用一次 `marivo_datasource_access`，后续脚本复用同一 prelude；
- lease 过期或耗尽时只续签 access，不在每个分析脚本前 test；
- 不在聊天、命令、源文件或报告中索取或写入 secret；
- source metadata 问题直接运行 `md.inspect(...)`。

## 验证

```bash
npm run test:datasource-credentials
npm run validate:datasource-credentials:real
npm run validate:datasource-access:real
```

测试覆盖 Host/Client 映射一致性、旧直连地址 canary、保留名拒绝、missing/partial、双 Tool Web 弹窗、
30 分钟 TTL、64 次原子消费、续签与 test 撤销、轮换 fresh resolve、snapshot 清理、脱敏和固定持久化策略。
