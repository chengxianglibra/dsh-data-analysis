# dsh-data-analysis

`dsh-data-analysis` 是运行在 DeepSeek Harness（DSH）中的 Marivo 数据分析插件。它让
Web profile 内的所有 Session、Agent 和 Workspace 共享一套受管 Marivo Runtime，同时
保留每个 Workspace 独立的项目配置、Environment Binding 和分析上下文。

## 项目目标

插件负责把 DSH 的 Agent 编排与 Marivo 的分析能力连接起来：

- 在 `$DSH_HOME` 下固定安装并复用 Marivo 0.5.0 Runtime；
- 按 Agent 的 `session.header.cwd` 识别 Workspace；
- 为新 Workspace 创建最小 Marivo 项目结构；
- 全局提供 `marivo-analysis` 和 `marivo-semantic` skills；
- 在 Agent 加载 `marivo-semantic` 或 `marivo-analysis` 后注入对应的实时根 Help；
- 通过 `marivo_test` 和 DSH 凭证服务完成 datasource 连接测试；
- 仅在用户明确要求来源时通过 `marivo_evidence_sources` 附加精确 Finding，并在 Web 展示折叠来源面板；
- 通过 `marivo_report_render` 把完整分析文档编译为可离线打开、打印和追溯的不可变 HTML；
- 支持 DSH 的 `native`、`code` 和 `both` 工具模式。

插件不在每个 Workspace 重复安装 Python、Marivo 或 skills，也不替代 Marivo 对项目、
语义模型、Evidence、质量和 lineage contract 的管理。

## 架构文档

- [总体架构](docs/architecture.md)
- [Runtime 与 Workspace 模块](docs/modules/runtime-workspace.md)
- [Environment 执行边界模块](docs/modules/environment-execution.md)
- [Help 披露模块](docs/modules/help-disclosure.md)
- [Datasource 与凭证模块](docs/modules/datasource-credentials.md)
- [Evidence 按需来源模块](docs/modules/evidence-sources.md)
- [HTML 报告渲染模块](docs/modules/html-report-rendering.md)
- [Plugin 集成与交付模块](docs/modules/plugin-integration-delivery.md)

设计与后续 Slice：

- [设计计划文档索引](docs/plan/README.md)
- [HTML 分析报告最小实现设计](docs/plan/html-report-rendering-mvp-design.md)

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
artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0.tgz
```

### 安装到 Web profile

插件只需安装一次。使用绝对 tarball 路径可避免 profile 工作目录带来的路径歧义：

```sh
npx @deepseek-ai/dsh plugin --profile web add \
  "$(pwd)/artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0.tgz"
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

创建 Runtime 时固定安装 `marivo[duckdb,trino,clickhouse]==0.5.0`。`installation.json` 记录实际安装版本和所需 capability；后续启动会验证 marker、
Python、该版本、package identity 和 `finding-render-v1`，然后直接复用 Runtime，不会在每次 Session 启动时
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
凭证值。所有 `*_env` 必须引用 `DSH_*` 名称，其他名称会在连接前明确报错。缺少引用时不执行
连接，Web 工具视图会为本次 Tool call 自动打开一次输入框。加载 `marivo-semantic` 后，插件通过
System Prompt 要求 Agent 在 `md.register()` 或手工修改 datasource 文件后立即调用
`marivo_test`，而不是在聊天、命令或项目文件中索取或填写凭证值。

输入框不回显已有值，只显示引用名和“已配置／未配置”状态。保存使用标准
`credentials.set()`；保存成功后关闭弹窗并提示“凭证已保存，请重试 marivo_test”，不会
自动重放原 Tool call。取消或部分写入失败不会改写原来的 `needs-credentials` Tool Result。

`marivo_test` 的凭证只作为单次受控子进程的环境 overlay 传给真实 `md.test()`，不进入 argv、
日志、Tool Result 或 telemetry。对于使用 Harness `ctx.shellEnv` 的标准一次性 `bash`/`pwsh`，插件按
Workspace 缓存 datasource 名称和 `DSH_*` 引用名，并重新调用 `ctx.credentials.resolve()` 形成当次
`dshEnv` 快照；Shell 启动的 Python 会继承这些变量，Marivo 再按原生流程解析并构建 backend。缺失值
不注入，也不阻断 Agent 修复配置。Harness persistent Shell 没有 per-execution environment seam；存在
已解析 datasource 凭证时插件会明确拒绝该调用，避免在未注入凭证的情况下继续执行，用户需切换到
standard、code 或 cordis preset。插件活动期间及插件自有子进程都固定使用
`MARIVO_PERSIST_CREDENTIALS=0`，因此不会由
Marivo 自动写入 `~/.marivo/secrets.toml`。Shell 中的脚本本身可以读取已注入变量，仍须避免主动
打印或持久化它们。

### 按需查看 Marivo Evidence 来源

普通分析不默认调用来源工具，也不显示角标、Footnotes、来源卡片或固定证据附录。正文只保留会影响解释的
口径、质量、时效和限制；没有实质边界时不生成模板化说明。

只有用户明确要求来源、出处、审计或 provenance 时，Agent 才调用：

```text
marivo_evidence_sources({ session_id, finding_ids })
```

工具每次接受 1–20 个唯一 Finding ID，在当前 binding 中通过
`mv.session.resume(..., use_datasources=False)` 和 `session.evidence.finding()` 原子读取，并调用公共
`Finding.render()` 获取双语事实陈述。成功结果只把本次来源写入标准 `tool/result.meta`；Code Mode nested
call 写入等价的耐久 ContentBlock。Web 按当前 Turn 和 closing answer seq 恢复来源，默认只显示折叠的
“数据来源”摘要，展开后按 Artifact 分组，机器身份位于二级审计详情。

工具不再接受语言参数或生成 handle、marker、definition 和历史 registry。来源只确认 Finding 身份，不验证
整句话、数字推理或业务判断。完整边界见
[Evidence 按需来源模块](docs/modules/evidence-sources.md)。

### 生成 HTML 分析报告

普通分析默认直接在对话中回答。只有用户明确请求耐久 HTML、接受 Agent 的报告提议，或要求修改本次对话
中已经生成的报告时，Agent 才调用：

```text
marivo_report_render({ session_id, document })
```

`document` 必须是完整的 `dsh-data-analysis-report/v2`，由 1–20 个 section 组成，并且只使用 `text`、`chart`、
`table` 三类 block。chart 支持 `auto`、`line` 和 `bar`；每个 chart/table 必须引用精确 Artifact；block
必须位于 `document.sections[].blocks`，不能只提交 `document.blocks`。v2 不接受 `finding_ids` 或 `evidence`
block；需要持久化来源时，单独调用 `marivo_evidence_sources`。
修订会生成另一份完整、不可变的报告，不读取或 patch 上一份文档。

工具执行无副作用的 best-effort preflight：文档、Marivo 与视觉问题按 check 分组聚合；单个 Artifact 失败不阻止
其他独立目标，有效 partial projection 继续检查可检查的图表。若多处失败，一次返回精确路径、原因和跳过边界，
Agent 修复指定位置后仍需重新提交完整文档。仅被图表或表格显式引用的 Artifact 才投影 rows；Session DAG
仍保留 Artifact/Job 的受控审计信息。HTML 只包含 semantic
HTML、内联 CSS 和 SVG，不运行 JavaScript、不加载远程资源。Tool 文本返回绝对 `index.html` 路径；Web
Tool View 与最终回答下方的耐久交付卡片都从顶层 meta 或 Code Mode 耐久子调用 block 恢复标题、披露和
完整路径，不依赖 Agent 是否在收尾文字中正确复述。用户点击“打开报告”后才调用 DSH `host.openPath`；
不创建 HTTP URL，也不支持跨机器分享。打开失败不改变原 Tool Result。完整边界见
[HTML 报告渲染模块](docs/modules/html-report-rendering.md)。

默认产物目录为：

```text
$DSH_HOME/dsh-data-analysis/reports/<environment-fingerprint>/<report-digest>/
```

路径和 digest 不是 Marivo Evidence；报告页脚也明确说明 `admissible` 不等于 datasource fresh，且不包含
Parquet 链接或 Marivo 私有存储路径。

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
测试，并通过 Biome 检查格式、lint 和 import，通过 `tsc` 检查 TypeScript、TSX 与构建脚本。
依赖解析固定在 `package-lock.json`；CI 使用 Node.js 24 和 `npm ci --ignore-scripts` 复现同一依赖图。

```sh
npm install
npm run quality
npm run quality:fix
npm run deps:check
npm run typecheck
npm test
npm run check
npm run test:html-report-rendering
npm run validate:html-report-rendering:real
npm run build
npm run verify:plugin-package
npm run pack:plugin
```

`quality` 是只读门禁，同时执行 Biome formatter、linter 和 import organizing 检查；
`quality:fix` 只写入安全修复，不启用 `--unsafe`。`deps:check` 通过 `npm ls --all` 验证锁定后的
完整依赖树与 peer dependencies。`typecheck` 同时检查 `src/`、测试、真实验证 runner 和 `.mjs`
构建脚本。由于 DSH Web client 的声明由运行时 module table 组合，源码类型检查跳过上游依赖包内部
`.d.ts` 校验，但仍执行本项目模块解析；直接 import 的依赖另外由 Biome
`noUndeclaredDependencies` 强制声明。
