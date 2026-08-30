# Environment 执行边界模块架构

## 作用

本模块把一个 Workspace、一个明确 Python 解释器和一份 Marivo import identity 固定成
`MarivoEnvironment`，并为插件自有 Python 调用提供统一的受限子进程策略和同进程 identity prelude。
它不拥有 Help、Datasource、Evidence 或 Report 的脚本、JSON shape 与解析器。

总体关系见[总体架构](../architecture.md)。实现集中在：

- `packages/dsh-data-analysis/src/environment/binding.ts`
- `packages/dsh-data-analysis/src/environment/source.ts`
- `packages/dsh-data-analysis/src/environment/doctor.ts`
- `packages/dsh-data-analysis/src/environment/subprocess.ts`
- `packages/dsh-data-analysis/src/environment/errors.ts`
- `packages/dsh-data-analysis/src/environment/summary.ts`
- `packages/dsh-data-analysis/src/bin/environment.ts`

## Binding 建立流程

`bindMarivoEnvironment()` 执行以下步骤：

1. 将 project root 解析为已存在目录的 canonical `realpath`。
2. 选择 Python。显式值必须是绝对路径；未提供时才选择 Workspace 内的 `.venv/bin/python`（Windows
   为 `.venv/Scripts/python.exe`）。共享 Runtime 模式始终显式传入其已验证 Python。
3. 创建一次 `FixedSubprocessPolicy`，冻结 `cwd` 与环境快照。
4. 直接执行 `python -m marivo doctor --project-root ... --format json`。
5. 严格解析 JSON shape，并执行 disclosure admission。
6. 从 project root、Python、Marivo version、package path 和 subprocess policy id 计算 SHA-256
   fingerprint，构造只读 binding。

模块不会从 `PATH`、父目录或系统 Python 做候选搜索，也不会在失败时切换安装。

## Doctor admission

doctor report 顶层 status 可以反映 Datasource 凭证、模型或其他项目诊断，因此不能直接等同于本插件
是否可披露 Help。当前准入只要求：

- report 的 `project_root` 与期望 project root 相同；
- report 的 `python_executable` 与选定 Python 相同；
- Marivo version 非空，package path 为绝对路径；
- `installation.python`、`installation.marivo`、`project.marivo_toml` 三项存在且为 `ok`。

doctor 即使以非零 exit code 返回，只要 stdout 是完整报告，仍按上述字段决定准入。JSON 无效、字段
缺失或身份不一致时明确失败；原始 doctor report 不进入长期缓存和 operator summary。

## 固定子进程策略

`FixedSubprocessPolicy` 的当前策略标识为
`direct-argv-inherited-env-snapshot-overlay-v2`，关键约束如下：

- `spawn(executable, args)` 使用 direct argv 和 `shell: false`；
- `cwd` 与基础环境在创建 binding 时一次冻结；
- 调用方只能提供 operation-scoped environment overlay；
- 无论基础环境和 overlay 如何设置，都强制 `MARIVO_PERSIST_CREDENTIALS=0`；
- 每次调用都有正整数 timeout、stdout/stderr byte 上限和终止 grace period；
- abort、timeout 或输出越界会终止整个 POSIX process group；Windows 使用 `taskkill /t /f`；
- stdin 关闭，stdout/stderr 只在上限内收集并返回。

该策略降低 shell 注入、失控子进程和意外凭证持久化风险，但不是通用 OS sandbox，也不限制任意
Agent 自己发起的 shell/Python 调用。

## 同进程身份复核

成功 binding 的身份字段为：

```text
projectRoot
pythonExecutable
marivoVersion
packagePath
subprocessPolicyId
fingerprint
```

`assertImportIdentity()` 可单独检查 import identity。通用 `runChecked()` 在每个领域 program 前注入固定
prelude，在同一个 Python 进程内先比较 `sys.executable`、`marivo.__version__` 和 `marivo.__file__`，
再把 argv 复原为领域参数并执行 program，避免 check/use 之间发生解释器或 package 漂移。

identity mismatch 使用专用 exit code `78`。一旦发现 mismatch，`MarivoEnvironment` 永久进入
`failed`；后续操作返回 `binding-failed`，不会用新值更新原 binding。普通的无效 Help target 或
Datasource 连接失败不会污染 binding。

## 通用 checked runner

| 方法 | 作用 | 附加约束 |
| --- | --- | --- |
| `assertImportIdentity()` | 仅 identity probe | mismatch 永久失败 |
| `runChecked(request)` | 执行一个 adapter 提供的 Python program | identity prelude、direct argv、资源 limits、abort、overlay 脱敏 |

`runChecked()` 不解释领域退出码或 JSON，只保留 identity exit `78`。普通非零退出返回 adapter；adapter
决定是业务结果、领域错误还是 fail-open。所有非空 overlay value 都会从 stdout/stderr 文本和 JSON
递归替换，Datasource adapter 仍保留领域内的第二次结果脱敏。

## 领域 Bridge 所有权

| Adapter | 所有的 Marivo 操作与投影 |
| --- | --- |
| `MarivoHelpBridge` | `marivo.help()` inventory、`marivo.help(target)` program、raw Help body 与错误映射 |
| `MarivoDatasourceBridge` | `md.describe/list/test` programs、凭证引用与测试结果解析 |
| `MarivoEvidenceBridge` | 精确 Finding 读取、双语 render、identity/order parser |
| `MarivoReportBridge` | Artifact/Session DAG program、strict report projection parser |

adapter 分别位于自己的 `disclosure/`、`datasource/`、`evidence/`、`report/` 目录。组合层按
`MarivoEnvironment` 缓存一组 adapter，但 Environment 本身不暴露领域属性或 forwarding methods。
当前 JSON 是插件 adapter 的私有投影协议，不声称是 Marivo 公共 schema；由 Marivo 提供版本化 projection
contract 或生成 schema 属于后续跨仓工作。

## 错误与诊断

`MarivoEnvironmentError` 以稳定 code 区分配置、安装、doctor、binding、子进程和 Workspace 错误。
adapter 可以将 identity 错误作为 trust-boundary failure，将普通领域 failure 映射为对应 Tool 错误，
而无需让 Tool 直接解析 subprocess result。

`dsh-data-analysis-env` 复用真实 Runtime、Workspace manager 和 binding 流程。成功时只输出稳定的
Runtime/Environment identity、fingerprint 和 status；不输出 doctor diagnostics 或凭证。失败时向
stderr 输出稳定 error code 和 message，并返回非零状态。

## 验证边界

核心确定性测试位于：

```text
packages/dsh-data-analysis/tests/environment-execution/environment-binding.test.ts
packages/dsh-data-analysis/tests/environment-execution/bridge-adapters.test.ts
```

测试应覆盖路径 canonicalization、doctor 非零状态、准入字段、identity 漂移、通用 runner argv、
timeout/cancel、输出上限、进程树终止、环境冻结、overlay 脱敏，以及四个 adapter 的参数与 parser 边界。

`npm run test:environment-execution` 执行确定性测试；`npm run validate:environment-execution:real` 绑定
真实 Marivo 安装，验证 doctor admission、import identity 和同进程 shadow 后的 fail-closed 状态。
