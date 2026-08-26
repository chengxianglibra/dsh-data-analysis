# dsh-data-analysis Plugin

当前实现包含 Environment Binding、`marivo_help`、`marivo_test` 和 skill 激活式根 Help
披露，并在 `0.1.0-rc.2` 增加 Web profile 共享 Marivo Runtime、逐 Workspace
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
  ./artifacts/npm/deepseek-ai-dsh-data-analysis-0.1.0-rc.2.tgz
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

所有插件自有 Marivo 子进程固定使用 `MARIVO_PERSIST_CREDENTIALS=0`，并为旧版兼容同时使用
`MARIVO_PERSIST_SECRETS=0`。`md.test()` 所需凭证只经单次环境 overlay 传入，不写
`~/.marivo/secrets.toml`，也不进入 argv、日志、Tool Result 或 telemetry。任意 bash/Python
直调不属于该保证范围。
