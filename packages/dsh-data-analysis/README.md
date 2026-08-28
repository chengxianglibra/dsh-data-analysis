# dsh-data-analysis Plugin

当前实现包含 Environment Binding、`marivo_help`、`marivo_test`、`marivo_evidence_sources`、
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
`installation.json` 中并供后续启动校验和复用；Runtime 必须公开 `finding-render-v1` capability。每个 Agent 默认按自己的
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
`marivo_report_render({ session_id, document })`。Tool 校验完整 `ReportDocument v1`，通过固定 checked
bridge 对可安全识别的 Finding group、Finding 和 Artifact 逐项返回 outcome；单项失败不阻止其他独立对象，
有效 partial projection 继续检查可检查的图表。blocked 按 `document`、`marivo`、`visual`、`publish` 分组返回
`passed`、`failed`、`partial` 或 `skipped` check，以及精确路径、修复和 omitted 数量。Agent 修复后必须再次提交位于 `document.sections[].blocks` 的完整
文档。每个 block 最多引用 20 个 Finding，全文最多引用 100 个唯一 Finding；普通 `text`、`chart`、`table`
block 可用省略字段或 `finding_ids: []` 表示没有精确 Finding 支撑，空数组会规范化为省略，`evidence` block
则必须提供 1–20 个 Finding。bridge 会继续恢复可识别的 Finding 及其 backing Artifact 并 revalidate 完整来源；
只有阻断性检查全部通过后才生成无远程依赖的
HTML/CSS/SVG，原子发布到 `$DSH_HOME/dsh-data-analysis/reports/`。页脚自动展示成功主 Artifact 分析过程的
Session DAG：Job 节点包含 intent、params 与 raw SQL，Artifact 节点包含最多 10 行持久化原序 preview，
Finding 审计合并到 backing Artifact。固定交互脚本与样式使用精确 CSP hash；节点支持键盘、触摸、缩放和平移。
报告以用户语言和答案优先的单列阅读流呈现；普通 block 不显示来源角标或浮层，`finding_ids` 仍作为来源元数据参与投影，
Finding/Artifact 原始身份与 JSON 留在页脚 Session DAG；需要在正文直接展示事实时使用显式 `evidence` block。需要来源时，Agent 为对应 block 选择
最小充分、不重复的 Finding 集；renderer 忠实展示传入的 Finding，不自行推断证据等价性。
line 至少需要八个点，bar 至少四个类别；日期、数值、通用列名和长标签图表使用读者友好的本地化展示。Tool 文本返回绝对路径；
Web Tool View 与 turn-tail 交付卡片从顶层 `tool/result.meta` 或 Code Mode 的耐久子调用 card block 恢复
完整路径；后者不依赖 Agent 的最终文字，用户点击后才通过 DSH `host.openPath` 在本机打开文件。插件不创建
HTTP URL，也不支持跨机器分享。HTML 使用 Finding 双语 render 和完整 Session DAG，但不输出 Parquet
链接、`bind_params`、credential 或私有存储路径，也不会为 preview 重新查询 datasource。真实补充验证使用仓库命令
`npm run validate:evidence-sources:real` 和 `npm run validate:html-report-rendering:real`，证据写入
忽略目录 `artifacts/evidence-sources-real/` 和 `artifacts/html-report-rendering-real/`；真实模型结果不替代确定性测试，当前 Web/打印门禁仍
blocked。详见
[HTML 报告渲染模块](../../docs/modules/html-report-rendering.md)。
