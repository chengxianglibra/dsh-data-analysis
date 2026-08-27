# Environment 执行边界模块架构

## 作用

本模块把一个 Workspace、一个明确 Python 解释器和一份 Marivo import identity 固定成
`MarivoEnvironment`，并为插件自有 Python 调用提供统一的受限子进程策略。它是 Help 与 Datasource
模块共同依赖的信任边界。

总体关系见[总体架构](../architecture.md)。实现集中在：

- `packages/dsh-data-analysis/src/environment/binding.ts`
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

`assertImportIdentity()` 可单独检查 import identity。Help、Datasource describe 和 Datasource test
使用 checked script，在执行真实操作的同一个 Python 进程内先比较 `sys.executable`、
`marivo.__version__` 和 `marivo.__file__`，避免 check/use 之间发生解释器或 package 漂移。

identity mismatch 使用专用 exit code `78`。一旦发现 mismatch，`MarivoEnvironment` 永久进入
`failed`；后续操作返回 `binding-failed`，不会用新值更新原 binding。普通的无效 Help target 或
Datasource 连接失败不会污染 binding。

## 支持的受控操作

| 方法 | Marivo 操作 | 附加约束 |
| --- | --- | --- |
| `assertImportIdentity()` | 仅 identity probe | mismatch 永久失败 |
| `runCheckedHelpTarget()` | `marivo.help(target)` | stdout 作为 live Help 返回 |
| `runCheckedDatasourceDescribe()` | `md.describe(name)` | 只投影 datasource name 与凭证引用名 |
| `runCheckedDatasourceTest()` | `md.test(name)` | 凭证仅经环境 overlay；Python 与 TypeScript 两层脱敏 |

Datasource test script 捕获库 stdout/stderr，只输出受控 JSON。异常只投影类型和稳定错误边界，不把
任意异常正文直接交付。返回值在 Python 层按 secret values 递归替换，Node 层再次对 stdout/stderr
和 JSON 字段脱敏。

## 错误与诊断

`MarivoEnvironmentError` 以稳定 code 区分配置、安装、doctor、binding、子进程和 Workspace 错误。
调用模块可以将 identity 错误作为 trust-boundary failure，将普通 target/test failure 映射为对应
Tool 错误，而无需匹配字符串。

`dsh-data-analysis-env` 复用真实 Runtime、Workspace manager 和 binding 流程。成功时只输出稳定的
Runtime/Environment identity、fingerprint 和 status；不输出 doctor diagnostics 或凭证。失败时向
stderr 输出稳定 error code 和 message，并返回非零状态。

## 验证边界

核心确定性测试位于：

```text
packages/dsh-data-analysis/tests/environment-execution/environment-binding.test.ts
```

测试应覆盖路径 canonicalization、doctor 非零状态、准入字段、identity 漂移、timeout/cancel、输出
上限、进程树终止、环境冻结和凭证持久化变量不可覆盖。

`npm run test:environment-execution` 执行确定性测试；`npm run validate:environment-execution:real` 绑定
真实 Marivo 安装，验证 doctor admission、import identity 和同进程 shadow 后的 fail-closed 状态。
