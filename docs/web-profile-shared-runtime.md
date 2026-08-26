# Web Profile 共享 Marivo Runtime

## 作用与边界

`@deepseek-ai/dsh-data-analysis@0.1.0-rc.2` 作为 Web profile 的全局 Cordis 插件加载一次，
为该 profile 内所有 Session、Agent 和 Workspace 提供同一套 Marivo Runtime。插件负责
Runtime 安装、Workspace 最小初始化、逐 Workspace binding、live-help checkpoint 和共享
skills；Marivo 继续拥有项目、doctor、语义和 Evidence contract。

插件不会在 Workspace 安装 Python 包，不会运行完整 `marivo init`，也不会向
`.agents/`、`.claude/`、`.codex/` 或 `$DSH_HOME/skills` 写 skill 链接。

## 安装到 Web profile

```sh
npx @deepseek-ai/dsh plugin --profile web add \
  ./artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0-rc.2.tgz
npx @deepseek-ai/dsh web
```

第一次随 Web profile 启动时，插件调用本机 `uv`，在下面的位置安装一次共享 Runtime：

```text
$DSH_HOME/dsh-data-analysis/runtimes/marivo/
├── .venv/
├── skills/
│   ├── marivo-analysis/
│   └── marivo-semantic/
└── installation.json
```

插件安装不带版本约束的 `marivo[duckdb,trino,clickhouse]`，由 PyPI 在创建 Runtime 时
解析最新兼容版本。插件先要求 `uv` 准备受管 Python 3.10，再创建 `.venv`、验证
Python/Marivo/package identity、复制 Marivo 内置 skills，最后把实际 Marivo 版本写入
`installation.json`。并发启动使用安装锁；失败安装没有完成 marker，下一次启动会把
不完整 Runtime 移到 `.invalid-*` 诊断备份后重建。

已发布 marker 的 Runtime 继续复用并按记录版本验证，不会因每个 Session、Agent 或 Web
启动而联网升级。需要重新解析新的 PyPI 最新版本时，应使用新的 `runtimeRoot`，或由管理员
移走现有插件自有 Runtime 后重建；插件不会自动删除旧 Runtime。

本机必须已有可执行的 `uv`。需要管理员提供解释器时，可配置绝对路径
`pythonExecutable` 或环境变量 `DSH_DATA_ANALYSIS_PYTHON`；该解释器必须提供可导入的
Marivo。此模式跳过 uv 安装，记录解释器中的实际版本，并同步 skills 和发布 Runtime
marker。

## Workspace 行为

每个 Agent 默认使用自己的 `session.header.cwd`。显式 `projectRoot` 或
`DSH_DATA_ANALYSIS_PROJECT_ROOT` 会覆盖它。Workspace 首次收到直接用户消息时，插件幂等
补齐：

```text
marivo.toml
models/
.marivo/
```

最小 manifest 为：

```toml
[project]
name = "<workspace basename>"
```

已有文件和目录不覆盖。无效 manifest 或文件/目录冲突只使对应 Workspace 的 Agent
失败；其他 Workspace 的初始化和 binding 不受影响。同一 Workspace 的 Agent 复用一个
初始化/binding Promise，不同 Workspace 使用同一 Python 和 package path，但保留独立的
project root 和 fingerprint。Doctor report 只参与首次 binding admission，随后立即丢弃。
恢复 Session、fork 与进程内 subagent 都按自身
`session.header.cwd` 重新解析 Workspace。

## Skills 与工具模式

插件把 Runtime 的 `skills/` 作为隔离的全局 filesystem provider 挂载。项目级
`.dsh/skills` 与 `.agents/skills` 保持 DSH 原有更高优先级，因此可以覆盖共享同名 skill。

每个直接用户轮次先进入 help checkpoint：

- `native` 显示 `marivo_help`，并保留已有 `skill` 控制面；
- `code` 只显示 `run_code`，SDK 只声明 `marivo_help` 和已有 `skill`；
- `both` 显示 `run_code`、`marivo_help` 和已有 `skill`，SDK 同样只保留这两个控制面调用。

Checkpoint 保留 `skill`，避免把临时 Tool restriction 投影成空 skill catalog；普通分析工具仍
不可见且不可执行。Guard 同时拒绝其他直接工具和 `run_code` 中的非控制面子调用。成功 help 结果
只为下一次 Prompt 开放分析工具，执行门控在紧接着的 `agent/pre-step` 才解除，因此同一步
中的后续子调用仍会被拒绝。`run_code` 内不调用工具的纯计算无法检测，但不会完成
checkpoint。

## 配置与诊断

Cordis 配置支持：

- `projectRoot?`
- `pythonExecutable?`
- `runtimeRoot?`
- `uvExecutable?`（显式值必须是绝对路径）
- `installTimeoutMs?`（默认 600000 毫秒）
- `initializeWorkspace?`（默认 `true`）

对应 Runtime 环境变量为 `DSH_DATA_ANALYSIS_RUNTIME_ROOT`、
`DSH_DATA_ANALYSIS_UV` 和 `DSH_DATA_ANALYSIS_PYTHON`。诊断命令默认确保共享 Runtime、
初始化指定 Workspace，并执行相同的 doctor admission：

```sh
npx @deepseek-ai/dsh plugin --profile web exec dsh-data-analysis-env \
  --project-root /absolute/workspace
```
