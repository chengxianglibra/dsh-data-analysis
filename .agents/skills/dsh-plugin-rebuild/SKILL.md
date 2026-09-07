---
name: dsh-plugin-rebuild
description: Build, reinstall, reset local test state, and restart DSH Web when the user requests “发射插件” or this complete local rebuild workflow.
---

# DSH Plugin Rebuild

## 范围与授权

“发射插件”授权下述完整本地流程，沿用用户已指定的目标；只要求构建、审计或修改此 Skill 时，不执行清理与重启。
若用户要求保留会话或状态，不能运行这个始终清理状态的脚本，应按受限请求另行执行对应步骤。

运行前说明实际 profile、`DSH_HOME`、测试 Workspace 和清理范围；目标明确且已授权时直接推进。
该流程清空测试 Workspace 的 `.marivo/` 及整个 `$DSH_HOME/sessions/`，并删除
`$DSH_HOME/storages/workspace.json` 和 `session_projcache.json`。DSH 会话与注册表清理跨该 Home 的
所有 Workspace，并非仅目标 profile。保留目录本身、profile、凭据、settings 和其他工作区文件。
不发布 npm、不提交或推送 Git。

## 执行入口

从当前仓库根目录执行：

```sh
node .agents/skills/dsh-plugin-rebuild/scripts/rebuild-reinstall-restart.mjs
```

[脚本](scripts/rebuild-reinstall-restart.mjs) 是步骤与默认值的事实来源：校验清理路径 →
`npm run pack:plugin` → 对目标 profile 精确移除已登记的当前或旧 scope 插件依赖并安装当前
`@chengxianglibra/dsh-data-analysis` tarball → 停止已验证的进程组 → 清理状态 → detached 启动并核对监听。
默认 `web` 使用 `dsh web --no-open`；其他 profile 使用 `--profile` 启动。

仅在需要覆盖目标或排错时查阅这些参数：

| 环境变量 | 默认值或用途 |
| --- | --- |
| `DSH_PROFILE` | `web` |
| `DSH_HOME` | `~/.dsh`，已有真实目录 |
| `DSH_CLEAN_WORKSPACE` | `~/source/silin/dsh-test`，已有真实测试 Workspace |
| `DSH_URL` | `http://127.0.0.1:3080`；监听探测地址，不修改 DSH 服务配置 |
| `DSH_PACKAGE` / `DSH_LAUNCHER` | `@deepseek-ai/dsh` / `npx`；直接指定 `dsh` 时跳过 npx 参数 |
| `DSH_LOG_PATH` | 系统临时目录下的 profile 日志 |
| `DSH_START_TIMEOUT_MS` | `30000` |

`npx --no-install` 只避免下载启动器，不保证整个安装流程离线。

## 停止条件与验证

`DSH_URL` 必须是 loopback HTTP(S) 地址；托管进程 identity 保存在 `$DSH_HOME/dsh-data-analysis/`。
[进程身份校验](scripts/process-targeting.mjs) 要求托管 identity、目标命令、监听与仓库 cwd 一致；
接管旧实例还要求监听 PID 归属唯一进程组且监听进程匹配 DSH 命令。组内所有进程 cwd 必须属于当前仓库。
未知监听、身份不匹配或无法确认目标时停止，不用 `pkill`/`killall` 绕过校验。
[清理路径校验](scripts/clean-local-state.mjs) 拒绝根目录、缺失或符号链接 base，以及已存在但非真实目录的清理目标。

失败时报告已完成的阶段和剩余状态：profile 安装可能已完成，流程不具备整体回滚能力。
成功要求进程归属与 HTTP 可达；脚本接受 HTTP 错误状态作为“可达”，不能据此宣称页面或真实 Agent 功能验收通过。
交付 tarball、profile、已清理路径、URL、日志与验证结果，并对照执行前后的 Git 状态确认无关文件未被修改。
