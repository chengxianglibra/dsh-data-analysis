# Marivo 分析展示 S5 验收记录

## 结果与范围

2026-09-07，S5 已完成实现与最终验收。唯一插件 Skill `dsh-data-analysis-presentation`、短展示路由、
包内资源与真实 Agent 验证入口已接入；248 项持续测试、实际安装包、真实模型和 Web/离线旅程通过。
S0–S5 的本次 MVP 已完成，仍是未发布开发状态。

Marivo 继续拥有分析语义、Artifact、Finding、Quality 和 lineage；Harness 拥有 Agent、Session、Tool/Skill、
Workspace、凭据和执行政策。插件负责展示指导、公开读取、文件提交及 reader 交付。
没有第二次 Runtime 切换或新增 Help target；两个 Runtime Skill 保持原样挂载。

## 基线与修改

开始时本仓库 HEAD 为 `0a30ba74373e2c7a4bb3f868b43d2ff876f74d95`，工作区干净；Node.js 为 `24.18.0`。
Harness checkout 为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，工作区干净。
Marivo checkout 为 `5b1fa9aca9b0ddc53755c527d9716720b7e72253`，已有 lazy Dataset 未提交工作；本次未修改 sibling 仓库。
真实执行使用重新校验过的隔离已安装 Marivo 0.5.4，而非 sibling 的未提交源码。

| 范围 | 修改与证据边界 |
| --- | --- |
| `skills/dsh-data-analysis-presentation/` | 主流程按需加载 schema、charts、narrative、examples；有效 Artifact/computed/source-only 草稿及 Python 示例 |
| `src/plugin.ts` | 独立 filesystem provider、普通事实文字回答/展示加载 Skill 的短路由；与 Tool 和 prompt 同生命周期卸载 |
| `package.json` 与 verifier | 仅分发新插件 Skill；在实际 tarball 中通过 Harness registry 加载它，递归验证资源路径并检查卸载；保留 wheel/reader/旧面缺席检查 |
| 持续测试 | 新 `test:presentation-skill` 验证示例真实 parser/helper；profile 测试读取实际 Tool/Skill registry 并验证卸载 |
| 真实验证 | 新 `validate:presentation-agent:real` 使用官方模型 adapter 和实际 npm 解包插件；Web runner 同样改为实际 tarball 安装 |
| 当前文档 | 两份 README、总体架构、Skill/集成/投影/交付/执行模块与路线图同步；历史验收保留原时点事实 |

本次没有发布 npm、推送、重装用户 profile、重启用户服务或删除用户会话、报告、凭据。

## 分发与持续检查

Skill frontmatter 校验、所有本地资源链接、生产 Draft/Document parser 示例和真实 Python helper 输出均已通过。
新 Skill 有一个主入口，图表、报告和看板共享同一交付流程；reader 自适应布局，没有草稿网格配置字段。
computed 只声明来源，不提交转换证明；available 表示可恢复性，不证明计算正确。

`npm run check` 通过 248 项测试，Biome、source/scripts TypeScript 与依赖树检查通过；`npm run build`
与 `npm run verify:plugin-package` 通过。实际包为 `0.1.2-dev.0`，135 个文件、2,217,017 解包字节；
23 个 DSH peers 保持 `0.1.1-rc.2`。日志为 `/tmp/dsh-s5-check.log`、`/tmp/dsh-s5-build.log`、
`/tmp/dsh-s5-package.log`。后续 Skill 文案修订再通过 3 项聚焦测试及 quick_validate；真实 runner 增加
`--agent` 后 source/scripts TypeScript 与全仓 Biome 再次通过。

## 凭据不足与管理

本次重新运行 `validate:datasource-credentials:real` 与 `validate:credentials:web`：

- 多 datasource 执行准入、无附加连接测试、已启动失败不重放、定义漂移拒绝、原始输出脱敏和项目 secret scan 通过。
- 浏览器管理页保存、删除、连接测试及 fresh/stale 状态通过；刷新恢复待办时不回填秘密。
- 补齐前不启动，全部就绪后原调用启动一次；并行操作分别恢复，取消/轮换边界由持续回归覆盖。

证据为 `/tmp/dsh-s5-credentials/dsh-credential-integration-lniTOb.json`、
`/tmp/dsh-s5-credentials-web/browser-evidence.json`，日志为 `/tmp/dsh-s5-credentials.log` 与
`/tmp/dsh-s5-credentials-web.log`。已查看实际管理页截图。
凭据浏览器 runner 使用真实 client、service/RPC、Shell 和 Runtime，外层是隔离 slots/HTTP transport，
不将它描述为完整 DSH Web 部署验收。

## 真实 Agent 与 Web 旅程

实际官方模型 `deepseek-v4-flash` 从 6 行原始订单与语义定义开始，在实际解包插件和独立 profile 中
自主完成 `skill(presentation)` → `skill(marivo-analysis)` → live Help → `marivo_python` → 草稿 →
一次成功的 `marivo_present` → 最终解释。没有预置分析代码、草稿、receipt 或模型响应。

成功证据根为
`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s5-agent-4f3XlC/`。
`registration-evidence.json` 读取实际 `apply` 后的 4 个 Tool 与 3 个 Skill（1 个插件 + 2 个 Runtime），
确认新 Skill 的 resourceBase 来自解包目录；`agent-evidence.json` 与 `agent-trace.json` 保存工具轨迹、
receipt、最终解释和包身份，JSONL transcript 保留实际 Session events。

此次耗时 140679 ms，共 35 次工具调用；按区域核对华东 200、华南 100、华北 50 USD，
柱状图与表格绑定同一份 computed 数据，并附实际 Artifact 原表和 available 来源。
生成 build 为 `a6915f6c-580b-44ec-9bcb-559fb5e74a77`，JSON 为 5309 字节，HTML 为 603415 字节。
模型期间自行修正了错误 datasource 名、无效 Help target 和一次缺失文件读取；present 没有重试。
本例证明可完成该旅程，不代表任意模型或问题都不需要发现和纠错。

首轮严格验收失败：模型把 Session name 用作 `sessionId`，生产 present 明确拒绝身份不匹配；
模型自行改正后用了两次 present。证据保留在同级 `dsh-presentation-s5-agent-ziDtPH/`。
根据此实际问题，Skill/schema 增加取实际 `session.id` 与 `artifact.ref` 的说明，随后以上新一轮完整通过。
未放松一次 present 断言或增加身份猜测。独立审阅另修复 verifier 的测试 consumer 缺失 Skill registry 依赖链接，
以及 charts 文档的 tooltip 精度表述；不增加生产 peer。

Web/Native/Code/headless 与下载离线检查独立记录，不把预设 adapter 的 Host 验证充作模型自主规划。

## 三类交付、Host 模式和离线文件

最终 npm tarball 由 Web runner 实际解包安装，证据根为
`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s4-real-QvpMGa/`。
`integration-evidence.json` 与保留的 JSONL transcript 记录以下新一轮验证：

- Native/both/Code 各执行 Artifact、computed、source-only 和重复 Artifact，共 12 个独立 build。
- 实际 DSH Web 的三种卡片均打开并下载；computed 同时显示两个可恢复来源与一个 unavailable 来源，
  精确 Decimal/int64 和截断提示保持一致；source-only 不生成 dataset。
- 三份下载后的实际 HTML 在断网和禁用 JavaScript 下可读，网络请求为零；打印采用相同静态内容。
- 同一 receipt 的重复 durable event 与页面重连不增加卡片，不串 Turn；headless 文本保留路径和 digest。
- 文件 digest 不符、实际 JSON 被修改、Workspace Session 解除归属均明确拒绝；恢复归属后重新可读。

Chrome 为 `152.0.7977.77`，page errors 为零。已查看实际 computed、source-only 和 Artifact 离线截图；
生产模块共 56 份，摘要保留在 `web-attempt-eCmdJy/production-module-digests.json`；
`final-package-identity.json` 逐份核对全部 135 个已安装文件与最终包源码/构建字节一致。验证结束已停止自有
CLI 和浏览器。此 runner 的工具请求由预设 adapter 发出，证明实际 Host/Web 接缝，真实模型证据另列。

## 模型草稿的 Web 与打印复验

在校验模型草稿 SHA-256 未改变后，用 `--agent` 将同一草稿和真实 Artifact/computed 输入接入实际
Native/both/Code 与 DSH Web。证据根为
`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s4-real-5TlamJ/`。
`integration-evidence.json` 记录报告打开、实际下载、JSON/HTML 数值与来源一致、断网零请求、
无脚本可读、重复事件/重连去重及身份失败检查；已查看报告页和单独的柱状图截图。

该复验由预设 adapter 再次调用生产 Tool，生成新的 build `8ed6b807-f4ec-4019-8ea3-850d116249d2`，
不是重放原模型 Session，也没有手工插入卡片。模型原轮只有一次 present；复验中的额外调用只用于
验证不同 Host 模式。`final-package-identity.json` 核对模型、Web 两份安装包的全部 135 个文件均与
最终包源码/构建逐字节一致。

另在 Chrome print media 中检查三种 fixture 和模型报告的四份实际下载 HTML：静态 reader 与来源可见，
无网络请求，并实际输出 A4 PDF；证据在两个 Web 根目录的 `print-evidence.json`、`.print.png` 和
`.print.pdf`。这补充打印路径，PDF 仅作为本地验收产物，不是插件新增交付格式。

## 重跑与限制

```bash
npm run check
npm run build
npm run verify:plugin-package
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/checked-isolated-runtime/python npm run validate:presentation-agent:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/checked-isolated-runtime/python npm run validate:presentation-integration:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/checked-isolated-runtime/python npm run validate:presentation-integration:real -- --agent /absolute/path/to/agent-evidence.json
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/checked-isolated-runtime/python npm run validate:datasource-credentials:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/checked-isolated-runtime/python npm run validate:credentials:web
```

模型验证需要已有 Harness 模型 credential reference；只读解析，不启动用户目录上的可写 provider。
所有新状态、凭据 fixture、npm 解包和会话证据均位于隔离临时目录。未指定正确 Runtime 或缺少模型凭据时明确失败，
不修改默认解释器或用户 profile。临时目录证据仅在本机保留，不能作为随包分发内容。
