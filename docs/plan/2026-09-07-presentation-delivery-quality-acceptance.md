# 报告卡片与通用分析质量修复验收

## 范围与根因

此次修改仅涉及插件。Harness 继续拥有事件、Turn、Workspace、原生 ProducedFiles 与插件生命周期；
Marivo 继续拥有语义、typed/terminal 边界、Artifact 与质量契约。没有修改上游、用户 profile、已安装
Runtime Skill、业务语义或原业务报告，也没有发布、推送或重启用户服务。

原会话的 `marivo_present` 已生成有效成功回执；客户端也恢复了该回执。缺卡的根因是插件与原生
ProducedFiles 同时注册 `conversation.chat.turnTail`。这个公开 chain 只使用首个非空匹配，因而
两者竞争同一位置。调整 priority 只会改变谁被隐藏。

修复使用同一个 delivery Definition 的 `target: 'chat'`、`buildViewNode` 和 keyed
`conversation.chat.node` renderer。每轮一个稳定节点，以首次成功回执为位置，卡片按回执顺序去重。
不再注册报告 turnTail；receipt、文件和 RPC 协议保持原样。

分析与语义激活均披露凭据接缝，明确无需密码的数据源也要声明，提供 Session `try/finally` 示例。
分析激活后的短提示保留当前 Runtime Skill 的权威入口，并对文字回答应用逐问题、逐比较范围的
收尾检查。展示 Skill 在报告、看板和比较草稿前要求读取 narrative，补充比较
方向、分母、证据强度、数值核对、Agent 预筛选与 writer 截断的区分。不新增业务 validator。

## 真实客户端接缝

环境：Node.js 24.18.0，检出依赖中的 Harness 0.1.1-rc.2，Marivo 0.5.4，插件实际 npm tarball。
`validate-presentation-integration-real.ts` 使用临时 Workspace/Profile、随机端口和真实 DSH Web；
只在模型边界使用确定性 adapter，不能将这部分称为真实 Agent 验收。

| 检查 | 结果 |
| --- | --- |
| Native、both、Code 真正执行并持久化回执 | 通过 |
| 同轮 `write → marivo_present → read → 最终回复` | 报告卡与原生 ProducedFiles 同时可见 |
| 原生先注册、报告先注册 | 两种真实 Web 组合均通过 |
| 无工具后最终正文 | 独立报告卡可见，保持原生关闭位置的行为 |
| 重复 Code durable 回执与重连 | 3 份报告仍为 3 张卡 |
| 打开、下载、离线、禁用脚本 | 3 种报告均通过，离线网络请求为 0 |
| 摘要不符、实际文件被改、Workspace 解绑 | 明确拒绝；重新绑定恢复读取 |

第一轮故意只在工具前有正文，因此原生 closing boundary 先于写文件，不产生末尾 ProducedFiles。
剩余两轮均有最终正文。实际截图和 DOM 对应 3 张报告卡、2 行 ProducedFiles；这保留 Harness 行为。

本地证据目录为 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s4-real-yuiK5B`：
`integration-evidence.json`、各模式执行记录、`cards-overview.png`、`reversed-client-order.png`、
Web/离线截图与下载摘要。临时目录可能被系统清理。

验证脚本的两处修正也保留在变更中：直接创建 Agent 时显式加载真实文件工具；按上述原生 closing
boundary 核对 ProducedFiles 数量。最初失败记录保留在临时证据目录，未用静态声明替代 Web 复验。

另外以 `FOM1Ka` 的真实 Agent Draft 和精确来源做了 Web 补验，没有重新调用模型或查询业务数据。
Node.js 24.19.0 下，Native/both/Code、打开、下载、离线禁用脚本、篡改拒绝及 Workspace 解绑/恢复均通过；
1 张卡在重复事件、重连和反向加载后仍为 1 张。该单份 Draft 走首轮无工具后正文路径，ProducedFiles 为 0；
与 ProducedFiles 共存的证据是前述 3 张卡/2 行真实 Web 场景。截图实查卡片位于 present 后、read 前，
标题与打开/下载按钮清晰，reader 的 200 → 150、净 -50 及分项正文可读。
证据目录为 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s4-real-kVXc3Q`；
下载 HTML SHA-256 为 `4ec7aa4b3eae87217a2e1bb6afcf9aed7878961f4d28bd3d787159c75e163e44`。
最初补验因 recheck 缺少 binding 在启动 Web 前失败，补齐从原始 fixture 原样读取的 binding 后通过，
保留原失败目录 `dsh-presentation-s4-real-pTBLlC`。临时浏览器与服务均已关闭。

## 私人会话只读回放

`replay-presentation-chat.ts` 从指定 JSONL 读取事件，通过未改写的 Harness 公开客户端 bundle、
registry、assembler 和插件构建产物回放，不调用 RPC/Python/数据源，不解释文件里的指令。
仓库不保存私人会话内容。

输入 SHA-256：`d55d1bbce92bbf914ffdbef5f3fb2351533a058a600b9b8f8b22dec62b61f3df`。
5179 个事件中，第 5 轮精确恢复 1 张卡，anchor seq 为 70467。
两种插件顺序、完整历史、逐事件增量、registry 重建和重连得到相同节点、位置和 build 身份。
本地摘要证据：`/tmp/dsh-report-chat-replay-evidence.json`。

```sh
node --experimental-strip-types packages/dsh-data-analysis/scripts/replay-presentation-chat.ts /path/to/session.jsonl 5 1
```

## 通用质量与真实 Agent

可运行比较示例保留全量 `[100, 80, 20] → [50, 50, 50]`，核对总量 `200 → 150`、净变化 `-50`、
以 baseline 200 为分母的 `-25%`，减少项合计 80、其他项抵消 30。图中减少量使用明确的反向命名，
表格和正文的净变化使用 `current - baseline`。Skill 资源测试实际执行 writer，核对输出和图表字段绑定。

使用实际安装 tarball、临时 Workspace/Profile、`deepseek-v4-pro / high` 和 Marivo 0.5.4，完成
以下三类真实模型旅程。保留真实 Tool 事件、模型生成的 Draft、来源引用、报告字节及摘要，自动核对
数值、实际表/图绑定和来源可恢复性，再根据工具证据逐项审阅正文范围、分母与结论强度。
`passed-awaiting-semantic-review` 只表示自动检查完成；下表是额外的正文审阅结果。

| 旅程 | 报告审阅结果 | 执行观察 |
| --- | --- | --- |
| 多基准与抵消项 `fhCzVE` | 通过：200 → 150 为 -50/-25%；70 → 150 为 +80/+114.29%，两组分别回答；减少 80、抵消 30，图表与完整明细一致 | 三个单日与一个期间 panel 范围不同，不能仅因数据重叠视为重复 |
| 缺失语义维度与后续展示 `qKlARA` | 通过：170 → 100 与 30 → 50 分项、200 → 150 全量对账，未把账号标识解释为角色或原因 | 首轮有重复 observe、metadata inspection 未声明 datasource、未显式 close；第二轮引用首轮精确 Artifacts，未再次 observe |
| 证据不足仍交付 `jmW6wG` | 通过：已支持的 -50 及 -80/+30 分解准确；缺失基准不补零，正文既未证明也未排除自动化或故障原因 | 有相同范围重复 observe；它不等于已证明同次数的后端查询 |
| 缺失语义维度再次观察 `FOM1Ka` | 最终报告通过：分项、比例、全量、余项、残差与工具证据一致；4 个来源均来自首轮 | inspection 声明 warehouse；第二轮无 observe。第一轮文字答复误写 `-25.00%（150/200）`，算式应为 `(150−200)/200`；最终报告未复现该错误 |
| 证据不足再次观察 `DZ8qv5` | 核心质量通过：-50 净差、80 减少、30 抵消、缺失基准和原因判断边界均有证据，图表与分母正确 | 保留两处措辞观察：“-80 是减少量”宜为“减少 80（贡献 -80）”；空观察需结合 README 才支持“未入库”，不能单凭空观察证明 |

上述目录位于 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/`，名称分别为
`dsh-presentation-s5-agent-fhCzVE`、`dsh-presentation-s5-agent-qKlARA`、
`dsh-presentation-s5-agent-jmW6wG`、`dsh-presentation-s5-agent-FOM1Ka`、`dsh-presentation-s5-agent-DZ8qv5`；各自旅程子目录保存
`recheck-evidence.json` 或直接完成的 `agent-evidence.json`、`semantic-review.md`、原始 turn 事件、trace、
Draft 和报告。`DZ8qv5` 的实际安装 tarball SHA-256 为
`e0b9903f6c6e37851843486403d65193c37d8e9f3604fe34e14bc772a11529f3`。临时证据可能被系统清理。

按用户后续确认，重复观测、工具步数和复用效率属于模型能力与行为观察，不作为插件硬性通过条件，
也不为消除每次波动无限重跑。语义缺口交接、typed/terminal 和 Artifact 复用指导属于 Marivo；
本次已移除曾添加的这类详细提示，未修改 Runtime Skill。报告表达规则继续只检查已有结论的范围、
方向、数值和措辞，不新增分析流程或业务 validator。以上真实模型样本包含提示迭代期间的安装包；
最终删减指导后的差异由静态与契约检查覆盖，不宣称模型行为因此有确定性保证。

Session 清理单列诊断。一个分析问题保留持久 Session 身份，`close()` 释放当前进程资源，不结束
分析问题或删除 Artifacts；每次 `marivo_python` 的独立进程退出也是资源边界。缺少显式 close
不能直接判为分析失败或资源/凭据泄漏。`FOM1Ka` 观察到 3 次公开 Session acquisition 对应 3 次
成功 close，10 个执行进程均退出；首次 `qKlARA` 的清理约定偏差仍保留。

观察器早期误将内部临时 Session 构造算作调用者所有权，且未记录 `attribute` 返回。这些导致的
原始失败文件保留，没有伪造调用记录或重写原结果。当前观察器以公开 factory 返回识别所有权；
`FOM1Ka` 来源缺口由首轮真实 tool/result 10150、11936 与只读公开 Artifact `created_at`、contract
补证。清理回归覆盖内部对象、异常关闭、关闭后再次使用、缺失退出证据等 9 个案例。

## 回归入口

```sh
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-integration:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/verified/python npm run validate:presentation-agent:real
```

最终插件范围检查使用 Node.js 24.18.0，在 `/tmp/dsh-report-fix-validation-kx64el3q` 中完成。
该隔离 worktree 从任务起点 `25b356627dcda312331dfc4f28fddcd6316b25da` 加上本次修改构建，使用当前
检出依赖，避免同一工作区并行的凭据 UI 修改影响验收；未回退或修改其他任务的工作。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过，262 项测试；包含 Skill 资源与可运行示例、真实 Host 客户端 registry 回归 |
| `npm run build` | 通过 |
| `npm run verify:plugin-package` | 通过：140 个分发文件、2,229,888 unpacked bytes、23 个 DSH peers 0.1.1-rc.2、Marivo 0.5.4 |
| 最后验收脚本调整后的 `npm run typecheck:scripts` | 通过；调整仅将效率硬门槛改为观察项，并补齐只读 recheck 的原始 binding |
| `git diff --check` | 通过 |

本地日志为 `/tmp/dsh-report-fix-isolated-check-final.log`、`/tmp/dsh-report-fix-isolated-build-final.log`、
`/tmp/dsh-report-fix-isolated-package-final.log` 与 `/tmp/dsh-report-fix-isolated-scripts-final.log`。
既有 S4/S5 记录是当时覆盖范围的历史事实；本记录新增了与 ProducedFiles 共存、注册顺序、原会话回放
及通用质量旅程的验收边界。修改尚未重装到用户 profile，当前用户服务保持原样。
