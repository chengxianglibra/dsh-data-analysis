---
name: dsh-plugin-rebuild
description: Build and package the current DSH data-analysis plugin, reinstall it into a clean local DSH and Marivo test state, and restart DSH Web when the user says “发射插件”.
---

# DSH Plugin Rebuild

触发短语是“发射插件”。该流程会修改被 Git 忽略的构建/打包产物和本机 DSH profile，并删除指定测试 Workspace 的 Marivo 状态与本机 DSH Workspace/会话数据；不会发布 npm 包、推送 Git 或清理其他工作区文件。

## 执行

必须从本仓库根目录运行：

```sh
node .agents/skills/dsh-plugin-rebuild/scripts/rebuild-reinstall-restart.mjs
```

脚本按以下顺序执行：

1. 运行 `npm run pack:plugin`，完成 check、build、package verification，并生成当前版本的 tarball。
2. 读取 `@deepseek-ai/dsh-data-analysis` 的版本，确认对应 tarball 存在。
3. 仅当目标 profile 已安装该插件时，先通过 DSH CLI 移除旧依赖，再添加新的绝对 tarball 路径。
4. 停止由本 skill 托管的目标进程组，或接管一个可精确验证的旧 DSH 进程组。接管时，配置 URL 的监听 PID 必须属于唯一进程组，监听进程本身必须匹配目标 DSH 命令，且组内所有进程 cwd 都必须等于当前仓库；随后等待端口释放。
5. 无条件清空测试 Workspace 的 `.marivo/` 内容和 `$DSH_HOME/sessions/` 内容，并删除 `$DSH_HOME/storages/workspace.json` 与派生缓存 `$DSH_HOME/storages/session_projcache.json`。保留目录本身、DSH profile、凭据、settings 及其他本地数据；DSH 启动后不恢复旧 Workspace 或会话。
6. 以 detached 方式启动 DSH，等待本机 DSH URL 可通过 HTTP 访问后才报告成功。

默认值：`DSH_PROFILE=web`、`DSH_URL=http://127.0.0.1:3080`、`DSH_PACKAGE=@deepseek-ai/dsh`。CLI 默认通过 `npx --no-install` 调用，避免流程隐式联网。

可选环境变量：

- `DSH_HOME`：profile 根目录；默认使用 `~/.dsh`。
- `DSH_CLEAN_WORKSPACE`：每次发射时重置 Marivo 状态的测试 Workspace；默认使用 `~/source/silin/dsh-test`。
- `DSH_LAUNCHER`：DSH 启动器；默认是 `npx`，设置为直接的 `dsh` 可执行文件时会跳过 npx 参数。
- `DSH_LOG_PATH`：后台 DSH stdout/stderr 文件；默认写入系统临时目录。
- `DSH_START_TIMEOUT_MS`：等待 DSH 启动的超时，默认 30000 毫秒。

安全边界：URL 必须是 loopback HTTP(S) 地址。脚本把自身启动的进程身份记录在 `$DSH_HOME/dsh-data-analysis/`。托管状态不匹配、监听 PID 无法归入唯一进程组、监听进程不匹配目标 DSH 命令、任一组内进程 cwd 不属于当前仓库、未知进程占用端口或无法确认 profile 时，脚本停止并报告；不会使用 `pkill`/`killall` 等宽泛终止命令。满足全部接管条件的旧 DSH 进程组会被直接终止并由新实例替换。`DSH_HOME` 与测试 Workspace 必须是已存在的真实目录而非符号链接，且不能是文件系统根目录；两个清理目录若已存在，也必须是真实目录。不满足时会在构建前停止。

完成后报告 tarball、profile、已清理路径、监听 URL 和日志路径，并再次检查 `git status --short`，确认没有误改动未纳入流程的文件。
