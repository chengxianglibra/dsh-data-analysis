# Python 前台预算与执行反馈验收

## 结果与边界

2026-09-09 完成插件内可配置前台超时与终态反馈。默认仍为 120 秒，插件默认最大值为 600 秒，
调用可通过 `timeoutMs` 请求预算；插件与 Harness Shell 依次应用上限。
新增 `execution` 摘要保留阶段、结束原因、请求/实际预算、单调时钟耗时与下一步。
接口及异常语义见[超时与执行反馈](modules/datasource-credentials.md#超时与执行反馈)。

未改动 Harness、Marivo、launcher 输出机制或现有服务配置；未增加实时进度 UI、后台任务、执行状态存储、
Artifact 自动盘点及恢复操作。验收过程未执行推送、发布、重装插件或重启服务。

## 单元与完整检查

覆盖配置默认值及安装入口透传、非法配置在 Host 访问前拒绝、非法参数在凭据读取前拒绝、两次预算截断、
准备失败/取消、Shell 非零退出/超时/取消/未知结果、凭据脱敏与释放、代码记录失败不改写执行成功、不重放。
原有真实 Code Mode 凭据等待测试继续验证外层时限。

工作过程中，共享检出出现其他任务的展示模块改动。原检出的 `npm run check` 当时被这些文件的格式错误阻断；
继续执行全量测试时，浏览器打包遇到 `host-module-in-browser:.../presentation/catalog-contracts.ts`；
随后构建遇到 `client/presentation/catalog-model.ts` 的 `erasableSyntaxOnly` 错误。本次未修正或回退这些并行改动。

完整门禁改在以 `4aca5a9` 为基线、只应用本次补丁的临时隔离检出中运行，使用 Node.js `24.18.0`：

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过，425 项测试通过、0 失败、9 项按环境条件跳过 |
| `npm run build` | 通过 |
| `npm run verify:plugin-package` | 通过，202 个分发文件、24 个 DSH peers，离线 builder 与包契约通过 |
| `git diff --check` | 通过 |

9 个跳过项包含本次 4 个 opt-in 真实执行场景和已有的 5 个环境依赖测试；本次 4 个场景另行验证如下。
这些结果证明本次独立补丁通过门禁，不代表同时变化的共享检出整体通过。

## 真实 Harness 与 Python

使用已安装的 Marivo `0.5.4` Runtime、Harness `0.1.1-rc.2`，运行真实 ToolRuntime、BashLocal、SubprocessLocal
及 Python launcher/worker。每个场景使用独立临时 Workspace 和 Host 目录，不调用模型或生产 Trino。

| 场景 | 结果 |
| --- | --- |
| Shell 3 秒预算终止长 Python | `executing` / `timed-out`，实际预算 3000 ms，无 `codeRef`；worker 及其子进程均已退出 |
| 调用方取消 | Harness 最终返回 aborted 错误，Shell 标记 `aborted=true`、`timedOut=false`；进程树已退出 |
| Code Mode 3 秒总时限，Python 请求 30 秒 | 外层 wall-clock 错误保留，Shell 被取消，进程树已退出；仅启动一次 |
| 超过 120 秒执行 | Python 实际执行约 121741.5 ms，调用总耗时约 121755.7 ms；请求 240000 ms，经测试 Shell 截断为 180000 ms；成功返回 `codeRef` 并核验原文，仅启动一次 |

真实用例位于 [python-execution-real.test.ts](../packages/dsh-data-analysis/tests/datasource-credentials/python-execution-real.test.ts)。
先将 `DSH_DATA_ANALYSIS_PYTHON` 指向精确匹配的受支持 Runtime，再执行：

```bash
DSH_DATA_ANALYSIS_VALIDATE_LONG_PYTHON=1 node --experimental-strip-types --test \
  packages/dsh-data-analysis/tests/datasource-credentials/python-execution-real.test.ts
```

不提供解释器时明确跳过；提供不兼容解释器时失败，不自动换 Runtime。
长时场景需显式 opt-in，日常测试不会等待 121 秒。

## 交付限制

摘要只确认插件边界和 Shell 结果，不表示查询进度或 Artifact 保存状态。硬超时仍可能丢失 launcher 中尚未输出的日志。
本地进程树退出不证明远端 Trino 已取消；外层 Code Mode 取消后，也不承诺完整插件摘要可到达调用方。
Windows 进程树行为本次未实机验收。
