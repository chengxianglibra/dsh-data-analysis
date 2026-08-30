# dsh-data-analysis Plugin

当前实现包含 Environment Binding、`marivo_help`、`marivo_test`、`marivo_evidence_sources`、
`marivo_report_render` 和 skill 激活式根 Help
披露，并在 `1.0.0` 提供 Web profile 共享 Marivo Runtime、逐 Workspace
binding、全局隔离 skills，以及 `native`、`code`、`both` 三种工具模式支持。`marivo_test`
按操作从 DSH `ctx.credentials` 解析 datasource 的全部 `*_env` 引用；缺失时由浏览器 Tool
View 收集并通过标准 `credentials.set()` 保存，成功后由用户手动重试。系统边界与模块关系见
[总体架构](../../docs/architecture.md)。

## 兼容性

这是未发布项目的唯一 v1 基线：插件 `1.0.0` 只支持 DSH `0.1.1-rc.2` peers 和 Marivo
`0.5.0`。所有 DSH peers 都是必需依赖，不使用 `*`；管理员提供的 Python 也必须安装同一 Marivo
版本。机器可读清单位于 `package.json` 的
`dshDataAnalysisCompatibility`，也可从 `@deepseek-ai/dsh-data-analysis/compatibility` 读取。
本版本不提供旧契约 alias、迁移或双读写。

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
  ./artifacts/npm/deepseek-ai-dsh-data-analysis-1.0.0.tgz
npx @deepseek-ai/dsh web
```

首次启动通过本机 `uv` 在
`$DSH_HOME/dsh-data-analysis/runtimes/marivo` 固定安装共享
`marivo[duckdb,trino,clickhouse]==0.5.0`。实际版本记录在
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

加载 `marivo-analysis` 后，普通分析不默认附加来源。只有用户明确要求来源、出处、审计或 provenance 时，
Agent 才调用 `marivo_evidence_sources({ session_id, finding_ids })`。固定 Python script 原子读取 1–20 个
精确 Finding 并通过公共 `Finding.render()` 获取双语陈述；工具不接受语言参数，不生成 handle、marker、
definition 或历史 registry。Native Tool result 与 Code Mode durable dispatch 只携带本次来源，Web 按 Turn
和 closing answer seq 恢复后显示默认折叠、按 Artifact 分组的来源面板。插件不截获最终回答，也不做
entailment、数字验证、`to_pandas` 用途判断或可信等级推断。详见
[Evidence 按需来源模块](../../docs/modules/evidence-sources.md)。

加载 `marivo-analysis` 后，Agent 仍默认在对话内回答；只有用户明确请求或接受耐久 HTML 报告时才调用
`marivo_report_render({ session_id?, document })`。Tool 校验完整 `dsh-data-analysis-report/v1`：先在 `document.data` 注册
Artifact 或 computed 数据源，再由 chart/table 使用 `data_ref`。computed 使用 `dsh-computed-data/v1` 的
`columns + rows` 标量 JSON 快照，直接随报告持久化；它不是 Marivo Artifact，也不声明 Python 执行证明或 lineage。
只有含 Artifact 数据源时才要求 `session_id`，并通过固定 checked bridge 对每个显式 Artifact 独立 revalidate；
computed-only 会跳过 bridge，mixed 请求只把 Artifact refs 传给 bridge。不调用 Finding compatibility、Finding
读取或 backing Artifact 发现。单项失败不阻止其他独立 Artifact，partial projection 继续检查可检查的图表。blocked 按
`document`、`source`、`visual`、`publish` 分组返回 `passed`、`failed`、`partial` 或 `skipped` check，以及
精确路径、修复和 omitted 数量。Agent 修复后必须再次提交位于 `document.sections[].blocks` 的完整文档。v1
只接受 `text`、`chart`、`table`，不接受 `finding_ids` 或 `evidence` block，也不读取任何其他版本输入；需要来源时使用独立的
`marivo_evidence_sources`。只有阻断性检查全部通过后才生成无远程依赖的
HTML/CSS/SVG，原子发布到 `$DSH_HOME/dsh-data-analysis/reports/`。页脚自动展示成功主 Artifact 分析过程的
Session DAG：Job 节点包含 intent、params 与 raw SQL，Artifact 节点包含最多 10 行持久化原序 preview。
固定交互脚本与样式使用精确 CSP hash；节点支持键盘、触摸、缩放和平移。报告以用户语言和答案优先的单列
阅读流呈现；不绑定 Finding，也不在 HTML 中生成 Evidence block 或 Finding 审计。它不会聚合、抽样、Top-N，
也不会为 preview 重新查询 datasource。
line/bar 不以点数或类别数作为硬门槛；日期、数值、通用列名和长标签图表使用读者友好的本地化展示。Tool 文本返回绝对路径；
Web Tool View 与 turn-tail 交付卡片从顶层 `tool/result.meta` 或 Code Mode 的耐久子调用 card block 恢复
完整路径；后者不依赖 Agent 的最终文字，用户点击后才通过 DSH `host.openPath` 在本机打开文件。插件不创建
HTTP URL，也不支持跨机器分享。含 Artifact 的 HTML 保留 Artifact/Job Session DAG 和 Artifact revalidation；computed-only 报告不生成 Session DAG，但不输出
Parquet 链接、`bind_params`、credential 或私有存储路径。真实补充验证使用仓库命令
`npm run validate:evidence-sources:real` 和 `npm run validate:html-report-rendering:real`，证据写入
忽略目录 `artifacts/evidence-sources-real/` 和 `artifacts/html-report-rendering-real/`；本次真实 runner 的模型 journey 已通过，外部 Web/Host opener/打印门禁
未运行，仍不替代正式外部验收。详见
[HTML 报告渲染模块](../../docs/modules/html-report-rendering.md)。
