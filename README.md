# dsh-data-analysis

`dsh-data-analysis` 是运行在 DeepSeek Harness（DSH）中的 Marivo 数据分析插件。它让
Web profile 内的所有 Session、Agent 和 Workspace 共享一套受管 Marivo Runtime，同时
保留每个 Workspace 独立的项目配置、doctor 状态和分析上下文。

## 项目目标

插件负责把 DSH 的 Agent 编排与 Marivo 的分析能力连接起来：

- 在 `$DSH_HOME` 下按 PyPI 最新可用版本安装并复用一个 Marivo Runtime；
- 按 Agent 的 `session.header.cwd` 识别 Workspace；
- 为新 Workspace 创建最小 Marivo 项目结构；
- 全局提供 `marivo-analysis` 和 `marivo-semantic` skills；
- 要求 Agent 在每个直接用户轮次开始分析前声明所需的 Marivo live help；
- 支持 DSH 的 `native`、`code` 和 `both` 工具模式。

插件不在每个 Workspace 重复安装 Python、Marivo 或 skills，也不替代 Marivo 对项目、
语义模型、Evidence、质量和 lineage contract 的管理。

## 安装

### 前置条件

- Node.js 24 或更高版本；
- `pnpm`，供 DSH 管理 Web profile 插件；
- 本机可执行的 `uv`，供插件首次启动时安装共享 Python 和 Marivo。

```sh
node --version
pnpm --version
uv --version
```

### 构建插件包

在仓库根目录运行：

```sh
npm install
npm run pack:plugin
```

生成的安装包位于：

```text
artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0-rc.2.tgz
```

### 安装到 Web profile

插件只需安装一次。使用绝对 tarball 路径可避免 profile 工作目录带来的路径歧义：

```sh
npx @deepseek-ai/dsh plugin --profile web add \
  "$(pwd)/artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0-rc.2.tgz"
```

这里只需要安装一次。插件属于 Web profile，后续所有 Session、Agent 和 Workspace 都会
加载它，不需要在每个 Workspace 重复安装 Marivo 或 skills。

启动 Web：

```sh
npx @deepseek-ai/dsh web
```

第一次启动时，插件通过 `uv` 创建：

```text
$DSH_HOME/dsh-data-analysis/runtimes/marivo/
├── .venv/
├── skills/
│   ├── marivo-analysis/
│   └── marivo-semantic/
└── installation.json
```

创建 Runtime 时安装不带版本约束的 `marivo[duckdb,trino,clickhouse]`，由 PyPI 动态解析
当时最新的兼容版本。`installation.json` 记录实际安装版本；后续启动会验证 marker、
Python、该版本和 package identity，然后直接复用 Runtime，不会在每次 Session 启动时
联网升级。并发启动通过安装锁串行化；失败安装不会发布完成 marker。

## 使用

### 选择 Workspace

在 DSH Web 中创建或恢复任务时选择工作目录。插件默认使用每个 Agent 的
`session.header.cwd`，因此不同 Session、fork 和进程内 subagent 可以绑定不同
Workspace，同时共享同一个 Marivo Python。

### 开始分析

正常向 DSH Web 中的 Agent 提交分析任务即可，不需要手动初始化 Marivo。每个直接用户
轮次开始时，插件会先向 Agent 暴露 `marivo_help` checkpoint：

- `native` 模式只显示 `marivo_help`；
- `code` 模式只显示 `run_code`，其 SDK 只声明 `marivo_help`；
- `both` 模式只显示 `run_code` 和 `marivo_help`。

合法 help 结果会在下一个 Agent step 开放其他分析工具。同一步中的其他直接工具调用及
`run_code` 内的非 help 子调用会被拒绝。

### 检查环境

使用下面的命令检查共享 Runtime、Workspace binding、Marivo identity 和 doctor admission：

```sh
npx @deepseek-ai/dsh plugin --profile web exec \
  dsh-data-analysis-env --project-root /absolute/path/to/workspace
```

命令输出不包含凭证或原始 doctor 详情。

### 可选配置

| 配置 | 环境变量 | 作用 |
| --- | --- | --- |
| `projectRoot` | `DSH_DATA_ANALYSIS_PROJECT_ROOT` | 覆盖所有 Agent 的 Workspace 根目录 |
| `pythonExecutable` | `DSH_DATA_ANALYSIS_PYTHON` | 已安装可导入 Marivo 的管理员共享 Python |
| `runtimeRoot` | `DSH_DATA_ANALYSIS_RUNTIME_ROOT` | 覆盖共享 Runtime 根目录 |
| `uvExecutable` | `DSH_DATA_ANALYSIS_UV` | 指定本机 `uv` 的绝对路径 |
| `installTimeoutMs` | — | 安装和等待锁的超时，默认 600000 毫秒 |
| `initializeWorkspace` | — | 是否创建最小 Workspace 结构，默认 `true` |

通常不需要设置这些选项。未设置 `projectRoot` 时，应让每个 Agent 使用自己的
`session.header.cwd`。

## 开发

项目实现位于 `packages/dsh-data-analysis/`，使用 Node.js 内置 TypeScript stripping 运行
测试，并通过 `tsc` 生成发布用 ESM 和类型声明。

```sh
npm install
npm run typecheck
npm test
npm run build
npm run verify:plugin-package
npm run pack:plugin
```
