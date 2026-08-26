# dsh-data-analysis

`dsh-data-analysis` 是运行在 DeepSeek Harness（DSH）中的 Marivo 数据分析插件。它让
Web profile 内的所有 Session、Agent 和 Workspace 共享一套受管 Marivo Runtime，同时
保留每个 Workspace 独立的项目配置、Environment Binding 和分析上下文。

## 项目目标

插件负责把 DSH 的 Agent 编排与 Marivo 的分析能力连接起来：

- 在 `$DSH_HOME` 下按 PyPI 最新可用版本安装并复用一个 Marivo Runtime；
- 按 Agent 的 `session.header.cwd` 识别 Workspace；
- 为新 Workspace 创建最小 Marivo 项目结构；
- 全局提供 `marivo-analysis` 和 `marivo-semantic` skills；
- 在 Agent 加载 `marivo-semantic` 或 `marivo-analysis` 后注入对应的实时根 Help；
- 通过 `marivo_test` 和 DSH 凭证服务完成 datasource 连接测试；
- 通过 `marivo_evidence_cite` 为精确 Finding 签发标准 Markdown 角标，并在 Web 展示来源卡片；
- 支持 DSH 的 `native`、`code` 和 `both` 工具模式。

插件不在每个 Workspace 重复安装 Python、Marivo 或 skills，也不替代 Marivo 对项目、
语义模型、Evidence、质量和 lineage contract 的管理。

## 架构文档

- [总体架构](docs/architecture.md)
- [Runtime 与 Workspace 模块](docs/modules/runtime-workspace.md)
- [Environment 执行边界模块](docs/modules/environment-execution.md)
- [Help 披露模块](docs/modules/help-disclosure.md)
- [Datasource 与凭证模块](docs/modules/datasource-credentials.md)
- [Evidence 轻量引用模块](docs/modules/evidence-citations.md)
- [Plugin 集成与交付模块](docs/modules/plugin-integration-delivery.md)

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

正常向 DSH Web 中的 Agent 提交任务即可，不需要手动初始化 Marivo。`skill`、`marivo_help`
和普通工具从第一步起始终可见，插件不再按用户轮次设置工具门禁：

- 加载 `marivo-semantic` 后，下一次模型请求自动包含实时 `marivo.help("authoring")`；
- 加载 `marivo-analysis` 后，下一次模型请求自动包含实时 `marivo.help("analysis")`；
- 两个 skill 同一步加载时，两份根 Help 按稳定顺序原子注入；
- 具体 API 的 focused Help 继续由 skill 指导 Agent 显式调用 `marivo_help`。

相同环境、target 和正文 digest 已在当前 Prompt 可见时不会重复注入；环境变化或 compaction
隐藏原内容时会替换或恢复。插件不解析任意 bash/Python 来判断是否间接进入 Marivo，因此在
没有结构化 Marivo 执行入口时，不承诺具体 focused Help 的执行前强制门禁。

### 测试 datasource 连接

分析阶段可以调用 `marivo_test({ name })`。插件先通过绑定解释器读取
`md.describe(name).env_refs`，再按引用名从 DSH `ctx.credentials` 逐项解析凭证；不会缓存
凭证值。缺少引用时不执行连接，Web 工具视图会为本次 Tool call 自动打开一次输入框。

输入框不回显已有值，只显示引用名和“已配置／未配置”状态。保存使用标准
`credentials.set()`；保存成功后关闭弹窗并提示“凭证已保存，请重试 marivo_test”，不会
自动重放原 Tool call。取消或部分写入失败不会改写原来的 `needs-credentials` Tool Result。

凭证只作为单次受控子进程的环境 overlay 传给真实 `md.test()`，不进入 argv、日志、Tool
Result 或 telemetry。插件启动的 doctor、help、describe 和 test 等 Marivo 子进程都固定注入
`MARIVO_PERSIST_CREDENTIALS=0`，并为旧版兼容同时注入 `MARIVO_PERSIST_SECRETS=0`，因此不会写
`~/.marivo/secrets.toml`。这个保证只覆盖插件自有子进程；Agent 通过 bash 或 Python 直接调用
Marivo 不在此边界内。所有 datasource 的
`*_env` 引用（包括 `user_env`）都由 DSH 凭证服务管理。

### 引用 Marivo Evidence

加载 `marivo-analysis` 后，Agent 可以在精确 Finding 来源确有价值时调用
`marivo_evidence_cite({ session_id, finding_ids })`。工具每次接受 1–20 个唯一 Finding ID，在当前
binding 中通过 `mv.session.resume(..., use_datasources=False)` 和 `session.evidence.finding()` 整批读取，
并签发 `F1` 等稳定 handle。相同 Environment、Marivo Session 和 Finding 在同一 DSH Session 内复用
handle；每个 DSH Session 最多 100 个，跨 Session 隔离。

Agent 把工具返回的 `[^mv-f1]` 放在结论后，并在答案末尾原样放置对应 definition。CLI/Headless 可直接
阅读标准 Markdown footnote；Web 会从标准 `tool/result.meta` 和最终 `assistant/message` 回放出“Marivo
来源”卡片。插件不截获或重写原回答，也不新增自定义 Session event。

这个角标只确认 Finding 来源身份，不验证整句话、数字推理或业务判断。轻量版本不做自然语言
entailment、`to_pandas` 用途判断、可信等级、强制 analysis state 复盘，也不会要求所有简单分析都调用
引用工具。完整边界见 [Evidence 轻量引用模块](docs/modules/evidence-citations.md)。

### 检查环境

使用下面的命令检查共享 Runtime、Workspace binding、Marivo identity 和 doctor admission：

```sh
npx @deepseek-ai/dsh plugin --profile web exec \
  dsh-data-analysis-env --project-root /absolute/path/to/workspace
```

命令输出稳定的 Runtime/Binding identity 和 admission 状态，不保留或输出 doctor status 与
diagnostics。需要检查当前项目状态时，使用绑定解释器直接运行实时 `marivo doctor`。

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
