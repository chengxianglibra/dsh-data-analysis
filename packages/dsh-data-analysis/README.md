# dsh-data-analysis Plugin

当前实现包含 Environment Binding、`marivo_help` Tool、raw inventory loader 和
help checkpoint，并在 `0.1.0-rc.2` 增加 Web profile 共享 Marivo Runtime、逐 Workspace
binding、全局隔离 skills，以及 `native`、`code`、`both` 三种工具模式支持。早期 Slice 4
最小样本没有证明相对直接 Skill 基线的可靠性增益；详见
`../../docs/slice-4-acceptance.md`。

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
Checkpoint 支持 `native`、`code` 和 `both` 工具模式。
