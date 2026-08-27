# dsh-data-analysis Plugin

当前实现包含 Environment Binding、`marivo_help`、`marivo_test`、`marivo_evidence_cite`、
`marivo_report_render` 和 skill 激活式根 Help
披露，并在 `0.1.0` 提供 Web profile 共享 Marivo Runtime、逐 Workspace
binding、全局隔离 skills，以及 `native`、`code`、`both` 三种工具模式支持。`marivo_test`
按操作从 DSH `ctx.credentials` 解析 datasource 的全部 `*_env` 引用；缺失时由浏览器 Tool
View 收集并通过标准 `credentials.set()` 保存，成功后由用户手动重试。系统边界与模块关系见
[总体架构](../../docs/architecture.md)。

## 构建和打包

从仓库根目录运行：

```sh
npm install
npm run check
npm run build
npm run verify:plugin-package
npm run pack:plugin
```

构建生成 Node.js ESM 和 `.d.ts` 到 `lib/`；受控 tarball 输出到 `artifacts/npm/`，不包含
`src/`、`tests/`、验证脚本或 TypeScript 构建配置。

## 安装和环境

安装到 Web profile，一次服务所有 Session、Agent 和 Workspace：

```sh
npx @deepseek-ai/dsh plugin --profile web add \
  ./artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0.tgz
npx @deepseek-ai/dsh web
```

首次启动通过本机 `uv` 在
`$DSH_HOME/dsh-data-analysis/runtimes/marivo` 安装不带版本约束的共享
`marivo[duckdb,trino,clickhouse]`，由 PyPI 解析当时最新兼容版本。实际版本记录在
`installation.json` 中并供后续启动校验和复用。每个 Agent 默认按自己的
`session.header.cwd` 初始化 `marivo.toml`、`models/` 和 `.marivo/`，不会创建 Workspace
`.venv` 或 skill 链接。两个 Marivo skills 从共享 Runtime 全局提供，项目同名 skill 保持
更高优先级。

`dsh-data-analysis-env --project-root <path>` 检查共享 Runtime 和指定 Workspace。管理员
可通过绝对路径 `DSH_DATA_ANALYSIS_PYTHON` 提供已安装可导入 Marivo 的共享解释器。
`native`、`code` 和 `both` 工具模式都保留原有工具可见性。加载 `marivo-semantic` 或
`marivo-analysis` 后，插件分别注入实时 `authoring` 或 `analysis` 根 Help；`marivo_test`
不再因用户轮次切换而隐藏。

Datasource 的所有 `*_env` 必须引用 `DSH_*` 名称。`md.test()` 所需凭证只经单次环境 overlay
传入，不进入 argv、日志、Tool Result 或 telemetry；使用 Harness `ctx.shellEnv` 的标准一次性
`bash`/`pwsh` 每次也会从 DSH Credentials 重新解析当前 Workspace 已登记的引用，并通过 `dshEnv`
注入。Shell 启动的 Python 因而可由 Marivo 原生读取环境并构建 backend。Persistent Shell 不提供
per-execution environment seam；已解析 datasource 凭证存在时插件会明确拒绝执行并要求切换到
standard、code 或 cordis preset。插件活动期间及所有插件自有 Marivo 子进程
固定使用 `MARIVO_PERSIST_CREDENTIALS=0`，不写 `~/.marivo/secrets.toml`。加载
`marivo-semantic` 后，System Prompt 会要求 datasource 注册或修改后立即调用 `marivo_test`，由
`needs-credentials` 触发 Web 表单。

加载 `marivo-analysis` 后，短 system prompt 会要求所有由精确、已持久化 Finding 支撑的关键事实默认
通过 `marivo_evidence_cite` 引用；解释、建议、假设或没有精确 Finding 支撑的事实不强制引用。工具使用
固定 Python script 读取 Finding，按 DSH Session 签发 `F1` 至 `F100`，并把完整
registry 写入标准 `tool/result.meta`。Agent 原样输出标准 Markdown marker/definition；Web client 从
Session 历史解析并在 turn tail 展示来源卡片。插件不截获最终回答、不新增自定义 Session event，也不做
entailment、`to_pandas` 用途判断、可信等级或强制 state 复盘。详见
[Evidence 轻量引用模块](../../docs/modules/evidence-citations.md)。

加载 `marivo-analysis` 后，Agent 仍默认在对话内回答；只有用户明确请求或接受耐久 HTML 报告时才调用
`marivo_report_render({ session_id, document })`。Tool 校验完整 `ReportDocument v1`，通过固定 checked
bridge 恢复并 revalidate 精确 Artifact、按 block 检查 Finding compatibility，随后生成无 JavaScript、
无远程依赖的 HTML/CSS/SVG 并原子发布到 `$DSH_HOME/dsh-data-analysis/reports/`。Tool 文本返回绝对路径；
Web Tool View 从顶层 `tool/result.meta` 或 Code Mode 的耐久子调用 card block 恢复报告卡片，用户点击后才通过
DSH `host.openPath` 打开文件。Slice 3 的真实环境与视觉验收尚未执行。详见
[HTML 报告渲染模块](../../docs/modules/html-report-rendering.md)。
