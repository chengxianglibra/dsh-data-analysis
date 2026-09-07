# Marivo 分析展示 S4 验收记录

## 结果与范围

2026-09-07，S4 已完成实现及阶段验收。`marivo_present` 一次调用生成独立 build 的
`presentation.json` 与自包含 `index.html`，以同一 receipt 支持 Native/both、Code 和 headless。
生产 Web 卡片使用共享 reader 打开快照，并下载完整 HTML。持续检查、实际包验证和隔离真实 Host/Web 旅程均通过。

Marivo 继续拥有分析和来源事实；Harness 拥有 Session/Turn、Workspace 成员关系与持久事件。
插件只拥有投影接线、文件提交、receipt 和只读交付。新 presentation Skill 与真实 Agent 自动路由留在 S5。

## 基线与修改

开始时 HEAD 为 `c674c5d`，已有 S3 和协作规则未提交修改。本次保留并沿用；期间它们分别由其他工作
提交为 `d3ac9f5` 与 `87b2ffc`。本阶段未发布、推送、重装用户 profile 或修改 sibling 仓库。
Marivo checkout 为 `e936a3433e2bfaae9db6c54423cd65b0a0310826`，Harness 为
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，执行 Node.js `24.18.0`。

| 范围 | 结果 |
| --- | --- |
| `src/presentation/` | Tool、文件提交、统一 receipt、Code durable delivery、固定 asset 只读 RPC |
| `src/client/presentation/` | 卡片、Turn 聚合与去重、文件字节校验、reader overlay 和下载 |
| `plugin.ts` / `bridges.ts` / `index.ts` / `client.tsx` | 使用 Harness 当前 Workspace 成员关系接线，同一 bound Runtime，RPC 不启动 Python |
| 旧 Evidence | 删除 Tool、bridge、prompt、metadata/card/delivery、client parser、公共导出和旧真实验证脚本；无历史解码路径 |
| 测试 | 身份/脱敏保留在 projection，补未知字段与来源顺序；新增 integration/RPC/client/lifecycle 回归和真实验证入口 |
| 分发与文档 | Browser 白名单只新增纯 receipt 模块，移除 `./evidence`；verifier 检查新资产与旧目录缺席，同步模块/README/路线图 |

## 检查与真实证据

最终全仓检查通过 245 项测试，其中 presentation integration 为 22 项；source/scripts TypeScript、Biome、
依赖树检查均通过。`npm run build` 与 `npm run verify:plugin-package` 通过，实际 tarball 为
`0.1.2-dev.0`，124 个文件、2,196,913 解包字节，23 个 DSH peers 固定为 `0.1.1-rc.2`。
Verifier 从解包后的 consumer 执行 presentation-kit、contracts 和自包含 HTML builder，并拒绝旧 Evidence 目录。

日志：`/tmp/dsh-s4-check-final.log`、`/tmp/dsh-s4-build-final.log`、
`/tmp/dsh-s4-package-final.log`。真实 Native/both/Code 共 12 次生产 present 已通过，
隔离真实 Web 的三类产物交付和下载也已通过。

用户现有默认 Runtime 未安装新 presentation helper，未修改它。真实验证显式选择 S2 留存的隔离
Runtime，由生产 `ensureSharedMarivoRuntime` 重新核验解释器、Marivo/helper 版本和 import identity。
所有验证产物及 profile 位于独立临时目录；仅关闭本验证启动的 Host/浏览器。

## 真实 Host 与 Web

证据根目录为本机隔离临时目录
`/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s4-real-9baSvq/`。

`host-evidence.json` 记录真实 Harness AgentLoop、完整生产插件注册、WorkspaceRegistry/attachSession、
ToolRuntime、worker Code dispatch 和 JSONL persistence。Native/both/Code 三种模式各执行
Artifact、computed、source-only 和重复 Artifact 共四次 present，12 个 build 相互独立，文本均包含完整路径和 digest。
第一轮在 present 之前有 Assistant 文本，Tool 成功后没有新的 Assistant 文本；receipt 来自真实 Tool result/dispatch。

Web 使用独立 DSH CLI/profile，从最终构建复制的生产包和原样 client bundle 加载；验证 wrapper 只调用生产 apply，
不手工插入最终卡片。实际三类卡片已通过打开/下载；第一张来自 worker Code，代码丢弃返回值且没有后续 Assistant 文本。
下载文件的 digest、JSON 身份、精确数值和来源一致，断网与禁用 JavaScript 均可读。
实际改动 presentation JSON 字节与解除 Workspace Session 成员关系均触发拒绝。

同一个真实 Code receipt 的额外 durable event 与页面重连后仍只显示三张卡片；重复事件仅作为健壮性 fixture，
首次成功产物及 receipt 全部来自实际生产 Tool。Chrome `152.0.7977.77` 没有 page errors，三份下载文件的网络请求均为零。
验证使用确定性模型 adapter 提供预设工具请求；
它证明实际 Host/Web 接缝，不证明真实 LLM 自主规划或自动路由，后者明确留在 S5。

机器结果为 `integration-evidence.json`，实际 UI 截图为 `cards-overview.png`、`0-web.png`、`1-web.png`、
`2-web.png`，离线截图为 `0-offline.png` 至 `2-offline.png`；已实际查看卡片总览、computed 精确
Decimal/int64 表格和三类来源展开。12 次 Host 调用与三次 Web 调用均保留 JSONL transcript。

`final-build-identity.json` 核对真实 Web 加载的 56 个 JS 模块与最终 build，逐份 SHA-256 全部相同。
生产 client 的 SHA-256 为 `e0647d83e59e59c47a097845d9776f635fd3350a13c4391a961c4be94a149994`；
最终包验证使用相同构建字节。成功 Web snapshot 的 profile 为
`web-attempt-toMhmQ/isolated-dsh-home/profiles/web`，验证结束已停止自有 CLI 和 Chrome。

重跑入口：

```sh
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/checked-isolated-runtime/python npm run validate:presentation-integration:real
```

不指定解释器时校验当前默认 Runtime；缺少新 helper 会明确失败，不自动替换或修改用户 Runtime。
脚本支持 `--resume-web <completed-host-evidence-root>`，仅在保留输入与已经通过的 Host 证据一致时
重跑新的隔离 Web profile。最终脚本修改后已再次通过 Biome、全仓 TypeScript 与 `git diff --check`。

## 独立审阅修复

- Host Turn tail 的 anchor 可以指向 Tool 前的 Assistant 文本。客户端改为读取完整已归属 Turn 的交付，
  避免 present 成功后模型空文本、失败或取消使卡片丢失；Native/Code 都增加回归。
- 缺失文件与无法解析当前 Workspace 分别返回安全的 asset-missing/workspace-unavailable，
  不泄漏 provider 路径，也不误报为连接失败。
- Tool 注册卸载会 abort 在途构建；每个阶段核对 Runtime status 和 binding identity。
  内部提交对文档/字节取快照，拒绝不一致输入；同步两份文件和目录，再返回 receipt。

## 文件与生命周期边界

目录提交先在新临时目录完整写入两文件并同步，再一次 rename；成功 receipt 前重读校验字节。
仅清理本次拥有且目录身份未改变的构建。普通修改、换路径、符号链接、非普通文件、预算溢出、digest 变化、
Workspace/Runtime 漂移、取消和卸载均有失败边界；不提供持久版本索引、latest 或 CAS。

该实现不承诺防御拥有同一 Workspace 写权限的本地攻击者在每个 filesystem syscall 之间进行的任意 rename 竞态；
路径和 inode 前后复核不等于内核目录句柄隔离。离线文件是本次数据和来源快照，来源可恢复性不证明 computed 正确。
