# Marivo 分析展示 S1 执行准入验收记录

## 状态与范围

2026-09-07，实施[路线图 S1](marivo-analytics-presentation-roadmap.md#s1凭据准入并入一次执行)：
将凭据准入并入一次 `marivo_python` 调用，删除独立 access Tool 与跨调用 lease。
S1 已完成；S2–S5 的 presentation、helper、reader 和最终分发切换不在本阶段。

Harness 仍拥有 Credentials、Agent/Session、Shell、sandbox 与取消；Marivo 仍拥有 datasource 描述、
公开 resolver 与连接测试语义；插件只负责本次执行的完整准备、身份核验、stdin 注入和安全结果投影。
未修改 sibling 源码，未重装用户 profile，也未改变已有用户凭据或 Workspace 文件。

## 实施起点

| 项目 | 实际值 |
| --- | --- |
| 本仓库 HEAD | `0e13dcf10b6eff41c002ebb346a14c02a6fd84c3` |
| sibling Marivo HEAD | `e936a3433e2bfaae9db6c54423cd65b0a0310826`；已有 9 个 lazy-analysis 设计文档改动，未触碰 |
| sibling Harness HEAD | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；初检工作树无改动 |
| Node.js | `24.18.0` |
| bound Python | `/Users/lichengxiang/.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python` |
| 实际 Marivo | `0.5.4`；该 Runtime 的 `site-packages/marivo/__init__.py` |

开始时已有 `.agents/skills/dsh-plugin-rebuild/SKILL.md`、其 rebuild 脚本、`AGENTS.md`、
`docs/modules/plugin-integration-delivery.md` 和 report Skill 五个未提交文件。保留全部已有改动；
仅在模块文档中增量同步 S1 的执行与 disposal 责任。

## 实现与删除

[CredentialService](../../packages/dsh-data-analysis/src/datasource/service.ts) 的 `prepareExecution` 接收当前
exec、bound bridge resolver 和精确 datasource names。先绑定全部声明并跟踪凭据版本，缺失输入保持同一
调用等待；共享引用只收集一次。全部就绪后取得一次 fresh snapshot，配置齐全不附加连接测试。
表单提交仍保存并测试，成功才继续；诊断交接保留真实失败，不生成就绪结果。

准备结果中的 `assertCurrent` 在 Shell policy、environment 和 request 解析完成后、唯一一次
`shell.run` 之前同步核验取消、Agent/Workspace 和凭据版本。测试认可的版本随内部完成结果传递，
不把测试结束后发生的轮换当成已认可状态。最终 snapshot 前后复核 Runtime 与 datasource 定义；
空列表同样核验 Runtime 并安装空 resolver。准备结束释放引用跟踪与秘密值。

[Python Tool](../../packages/dsh-data-analysis/src/datasource/python.ts) 使用 DSH 前台 Shell 与原 sandbox
政策，通过 stdin 传递 snapshot；不把值放入 argv、环境或结果。非零退出与异常不内部重放。
[固定 Python 程序](../../packages/dsh-data-analysis/src/datasource/resolver-program.ts) 在用户代码开始前通过
公开 `md.describe` 再核对全部 grant 的名称与 definition，拒绝 Host snapshot 后发生的定义漂移。
同时保留每次 resolver 使用时的 datasource/Workspace/field/ref/definition 限制、raw fd/traceback 脱敏和
输出预算，并在异常或成功后清理值。
这些约束不把可使用凭据的 Python 变成无法读取凭据的隔离边界，也不回滚已经发生的外部效果。

`marivo_datasource_test` 与凭据 RPC/slots 保留，直接测试和管理页共用 `lastTest/stale`。
请求、操作与测试历史仍有界；删除 lease 的 TTL/次数不影响管理记录的保留窗口。
headless 与 subagent 缺凭据直接返回 `needs-credentials`，不等待不可见表单。
管理页同步移除后续执行授权的文案，明确更换或删除后，使用旧凭证等待执行的代码不会启动。

同阶段删除 `src/datasource/access.ts`、所有注册/导出/旧 prompt、`access-tool.test.ts` 和
`validate-datasource-access-real.ts`。根命令改为 `validate:datasource-execution:real`；Native 与
Code Mode、真实验证 fixture、管理浏览器脚本均已改用 `marivo_python`，不提供 access 转发或 alias。
包验证器同时检查 tarball 不含旧文件、公开 exports 无旧名称、CredentialService 不再暴露 `claim`。

当前实际插件注册面是 `marivo_help`、`marivo_datasource_test`、`marivo_python`、
`marivo_evidence_sources`。Evidence 的删除与 `marivo_present` 接线仍分别属于 S4；
不能把此处的四个 Tool 当作 S5 的最终目标集合。

## 检查与证据

聚焦回归包含：多数据源未齐零启动、补齐后一次启动、共享引用、无额外测试、取消/轮换/Workspace 与
definition 变化、空 resolver、非交互、Code Mode 预算内续接/超时、秘密清理与脱敏、test history stale。
实际 Harness 注册测试同时确认旧 access Tool 消失，disposal 保留 Host 原有 Tool。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过；Biome、依赖、source/scripts TypeScript、197 tests，0 failed、0 skipped；其中 datasource suite 55 tests |
| `npm run build` | 通过；生产入口和声明构建成功 |
| `npm run verify:plugin-package` | 通过；99 files、573,374 unpacked bytes、23 个 DSH peers；旧 access 文件、exports、claim 均不在可安装包 |
| `validate:datasource-credentials:real` | 通过；实际 Harness Tool/Shell、Marivo 和双源 HTTP；缺失/部分输入零启动，全齐一次；故意失败不内部重放 |
| `validate:datasource-execution:real` | 通过；真实 `deepseek-v4-flash` Agent，fixture 提供的 Python，仅一次 Tool 调用，补齐后原调用完成 |
| `validate:credentials:web` | 通过；真实 Chrome 中保存/删除、`lastTest` fresh/stale、并发操作恢复、刷新待办和一次 Python 启动 |

最终执行证据均使用补齐 grant preflight 后的代码，并记录完整 Runtime binding：

| 本机证据 | 实际证明的内容 |
| --- | --- |
| `/tmp/dsh-credential-s1-20260907-final/dsh-credential-integration-1S27al.json` | direct Tool 验证；双源结果各 30、无附加连接测试、失败不重放、未声明源拒绝、definition denial、raw fd/traceback 脱敏、环境 canary 与项目文件扫描 |
| `/tmp/dsh-credential-s1-20260907-final/dsh-credential-integration-Q0myyD.json` | 真实 Agent；唯一 `marivo_python` callId 为 `call_00_8Uw1J0ha5X1gsgKZH8kS9589`，`exitCode=0`、`stdout=AGGREGATE=30_EACH`、启动 1 次 |
| `/tmp/dsh-credential-web-s1-20260907-final/browser-evidence.json` | Chrome 管理与原调用续接；`pythonStarts=1`、fresh/stale 与刷新恢复均通过 |
| 同一 browser 目录的 `management.png`、`concurrent-operations.png`、`pending.png`、`mobile.png` | 实际页面与窄屏呈现；已查看布局及文案 |
| `/tmp/dsh-presentation-s1-check.log` | 最终全仓检查输出 |
| `/tmp/dsh-presentation-s1-build.log`、`/tmp/dsh-presentation-s1-package.log` | 最终构建与 npm tarball 检查输出 |

direct suite 的总启动数为 3，分别属于成功的双源程序、故意失败程序、未授权 datasource 拒绝程序；
缺失与部分输入的调用均未启动，不把多个独立用例的总启动数混成单次调用次数。真实 Agent 的两次连接测试
来自两个缺失凭据的表单提交；不是配置齐全后附加测试。两数据源共收到 6 次实际 HTTP 请求。

### 失败记录与验收限制

自然语言生成程序的模型尝试未通过单次 Tool 调用验收。首次仅记录到 `starts=2`，未持久保存轨迹，
无法还原原因；随后保持同一自然语言 prompt 的诊断运行保留了
`/tmp/dsh-credential-s1-20260907/dsh-credential-integration-OAMfWq.json`。
该记录包含三个不同 callId，退出码为 `[1, 1, 0]`：模型误用 Ibis `backend.execute(SQL string)` 和
`close()`，随后新建调用修正程序。每个 dispatch 只执行一次，没有发现插件内部重放。

最终 S1 模型验证明确给出已经直接验证的 Python，只证明真实 Agent 发起同一调用、等待两个凭据并续接
一次执行；不将其标为自然问题到正确分析代码的验收。完整 Skill/live Help 自动路由留给 S5。
Chrome 使用真实 client、service/RPC、Shell 与 Runtime，但外层为隔离 slots/HTTP transport；
不是用户 profile 的完整 DSH Web 部署验收。无关的 presentation、下载与离线浏览器场景未重跑。

审查还复现了最后一个 datasource 检查期间、先前 definition 变化的窗口，因此增加 worker 的
`exec` 前 preflight。真实 Python 协议回归确认 definition/name 漂移时副作用 marker 不存在；
最终三项真实接缝验证均在该修复后重新通过。

本轮涉及的 9 份文档共 79 个本地文件链接已核验，`git diff --check` 通过；同时修复了已失效的上游
凭据设计链接。S1 可以退出，后续按路线图进入 S2；本开发状态不重装用户现有 profile。

## 复现入口

以下命令从仓库根目录执行。真实验证需要明确指定已有、可绑定的 Runtime；不安装或回退解释器。
模型验证通过 Harness 读取已有 `DEEPSEEK_API_KEY`；datasource 值仅使用隔离 fixture store。

```sh
npm run test:datasource-credentials
npm run check
npm run build
npm run verify:plugin-package
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/runtime/bin/python npm run validate:datasource-credentials:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/runtime/bin/python npm run validate:datasource-execution:real
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/runtime/bin/python npm run validate:credentials:web
```

`DSH_DATA_ANALYSIS_VALIDATION_OUTPUT` 可指定执行验证 JSON 的独立输出目录。
浏览器验收使用隔离 Harness slots、构建后的 client、真实 RPC/service 与 Marivo；完整 DSH Web 部署及
最终 presentation/离线真实 Agent 旅程仍由 S4/S5 验收。
