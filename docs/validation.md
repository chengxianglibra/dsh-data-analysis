# 项目验证指南

## 验证原则

根目录 [package.json](../package.json) 是验证命令入口。模块文档描述应验证的契约；测试通过记录必须绑定实际代码、安装包和环境，不能由设计文档、旧截图或脚本路径推断。

本地构建使用 `.nvmrc` 指定的 Node.js 22.19.0。可执行变更运行相关测试及 `npm run check`；exports、client、包元数据或分发内容变化时，再运行 `npm run build` 与 `npm run verify:plugin-package`。纯文档变更检查相对链接、标题锚点、Markdown 渲染和 `git diff --check`。

## 数据源操作结果白屏修复验收

2026-09-11 在真实 Chrome 捕获数据源右侧 Tab 的 `Cannot read properties of undefined (reading 'replace')`，
堆栈对应 `OperationOutcome`：`data-error` 布尔值误传入翻译函数。修复该属性与同组件文件中的
`data-tone` 翻译误用，新增生产面板渲染回归，覆盖保存失败、无详情失败、取消、凭证删除和连接失败。
Node.js 22.19.0 下 `npm run check`、`npm run build`、`npm run verify:plugin-package` 和 `git diff --check` 通过。

当前已安装前端保留备份后仅应用这两处属性修复，由 Harness 原生 HMR 恢复页面，服务未重启。
真实页面恢复后显示原先的连接拒绝错误；用户将端口从 `79` 修正为 `80` 后，连接测试成功，
页面显示“验证完成，原调用继续”，原会话继续执行并成功访问目标表。本次未代填凭证或更改连接配置。
上述真实验收证明面板恢复和原调用续跑，不代表后续带宽分析结论已验收。

## 报告旧入口清理验收

2026-09-11 移除 `presentation/install.tsx` 的旧报告卡片、弹窗和安装入口，并将其单元测试及 Web
验收迁移至默认 `apply` 安装的原生右侧 Tabs。Host 内报告入口要求已有 Session；离线 HTML 继续独立使用。
同时清理旧来源摘要组件、图标、样式、翻译及卡片缓存；公开 API 移除清单见
[报告交付](modules/presentation-delivery.md#客户端旧入口移除)。持久报告和历史事件契约未变化。

Node.js 22.19.0 下 `npm run check` 通过（652 项通过、4 项默认跳过），`npm run build` 和
`npm run verify:plugin-package` 通过。迁移后的验收脚本另通过类型与格式检查。
包验证会调用 `prepack` 重建 `lib`，应先完成构建和包验证，再启动 Web 验收，避免打包读取中间产物。

最终生产模块的 Ask DSH（19 项）、报告目录（12 项）、原生 Tabs（49 项）及图表交互／离线 HTML
验收通过；完整集成 Web 复验也通过，覆盖原生编辑、历史 Build、保存冲突、引用与撤销、
Session／Workspace 失效、多宽度图表、两种客户端安装顺序及同 profile 重启恢复。
完整集成复用本次已通过的 Native／both／Code headless 证据，Web 部分以最终打包模块重新执行。
本地证据保存在 `artifacts/report-tab-cleanup/`，各 Web 证据中的模块摘要均与最终 `lib` 逐项核对。
客户端 `client.js` SHA-256 为 `7f250aeac7e56e829484b40dafabdb1ffe6076ff49c172b848bf1ddcdcd9434a`。

验收使用独立 profile、真实 Harness／Marivo 和 Chrome，模型边界使用脚本适配器；不代表远端模型自主分析验收。
未修改用户运行中的 profile 或服务，未重装、提交或发布。

## DSH rc.1 基线验收

2026-09-11 完成 [升级设计](designs/dsh-rc-upgrade-ux.md) 的 S1。开发 distribution 与直接 DSH 开发依赖
固定为 `0.1.5-rc.1`，初次验收时 31 个 DSH peers 与 compatibility 为 `^0.1.5-rc.1`；lockfile 的 234 个 DSH
条目及实际解析图均为 rc.1，Host 单实例检查通过。范围内未来版本不视为已经验收。

Node.js 22.19.0 下 `npm run check` 通过（648 项通过、4 项默认跳过），`npm run build`、
`npm run verify:plugin-package` 通过。另设置 `DSH_DATA_ANALYSIS_PYTHON` 和
`DSH_DATA_ANALYSIS_VALIDATE_LONG_PYTHON=1`，单独运行 `python-execution-real.test.ts`：4 项全部通过，
覆盖真实超时、调用方取消、PTC 外层截止和超过 120 秒执行后只捕获一次代码。最终验收脚本另通过类型与格式检查。

`validate:right-tabs:web` 使用打包插件、隔离 `web` profile、真实 Harness／Marivo 和 Chrome，49 项断言通过：
目录去重，Report/Build 新建、保存冲突及重开，Ask DSH 原生引用与完整上下文、附件和撤销，语言切换，
窄屏滚动与全屏进出，数据源和凭据交互，分页与 PTC 去重，关闭／替换／Session 切换的迟到响应，
真实断线重连，Workspace 撤销和客户端卸载。`validate:presentation-ask-dsh`、`validate:locale`、
`validate:plugin-lifecycle:real` 也通过，分别保留独立证据。

验收固定使用 `right-tabs-<scenario>/deterministic-seam` 脚本模型适配器；具体 provider 清单记录于证据。
这证明真实 Host、工具、Runtime 和浏览器接缝，不代表远端模型自主分析验收。Runtime 为已有 Marivo 0.5.5，
实际解释器、packagePath、binding fingerprint、profile、固定输入及逐项断言记录在本地
`artifacts/dsh-rc1-s1/candidate.json` 和 `right-tabs.json`；该目录同时保留日志、截图、候选 diff 与 tarball。

- 候选基于 `d629d514f6a6416a8d46684d18f15b4836dc5fad`；非 Markdown 改动的 `git diff --binary HEAD` SHA-256：
  `e9d9c452e7b6331bd1bd1244028a57748a42712328203ca2e086480a2243dc93`，具体路径清单见 `candidate.json`。
- 打包产物 SHA-256：`d45a86001d6ac5203a4ee423f411c41d64c7204872a88b8c16383212f3cf6709`。
  最终重新打包的 SHA-512 integrity 与真实 Web 使用的包完全一致。

本次仅更新依赖、兼容声明和验收接缝：rc.1 原生 deliverables 的 `produced/presented` 返回结构与新增原生
`present` 工具视图在测试中按 Host 契约读取；补齐 client-store 验证需要的 Zustand／Immer 开发依赖及
生命周期 fixture 的 `typert` 前提，并更新当前界面定位和错误 key 断言。生产插件无需更改 slot 或执行协议。
该次 S1 不包含 S2 文件交付与 S3 guide 入口；当前用户 profile、运行服务、模型默认值和 Marivo 安装未改动，未发布。

同日按用户要求将对外 DSH peer／compatibility 范围扩大为 `>=0.1.5-rc.1`，允许更高的稳定版本（包括 `0.2.x`、`1.x`），并保持 npm 默认预发布匹配规则。开发与真实 Web 验收版本仍固定为 rc.1。上面的候选和包摘要保留为初次 Web 验收证据，不作为扩大范围后的最终包指纹。 范围调整后重新执行 `npm run check`（649 项通过、4 项跳过）、`npm run build` 和 `npm run verify:plugin-package`，全部通过；兼容性测试明确接受 `0.2.0`、`1.0.0` 和 `2.0.0`，这些版本未作真实 Web 验收。

## 普通文件原生交付验收

`validate:file-analysis:real` 默认保留报告流程；设置
`DSH_DATA_ANALYSIS_VALIDATION_SUITE=files` 单独运行 S2 普通文件流程。两者均使用打包插件和隔离 Web。
普通文件可用 `DSH_DATA_ANALYSIS_VALIDATION_FILE_CASES=delivery|failures|all` 选择验收组（默认 `all`）。
`delivery` 验证自主生成、预览与恢复；`failures` 验证能力缺失及受控故障，并预置用于补交付的 CSV，
该预置文件不算模型生成证据。

```sh
DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/verified/python \
DSH_DATA_ANALYSIS_VALIDATION_SUITE=files \
DSH_DATA_ANALYSIS_VALIDATION_FORMATS=csv \
npm run validate:file-analysis:real
```

模型使用 `DSH_DATA_ANALYSIS_VALIDATION_MODEL`（默认 `deepseek-v4-pro`）和
`DSH_DATA_ANALYSIS_VALIDATION_EFFORT`（默认 `high`）；凭据读取现有 Harness 引用，不记录 secret。
验证脚本仅管理本次临时目录下的 profile、preset、Workspace 和 Host。

普通文件流程覆盖同名附件 CSV、PNG 原生预览、文字回答、Native／PTC 持久事件与隔离 Host 重启恢复，
并分别记录缺少 `present` 的自定义 preset、生成失败、声明失败、PTC 外层失败及源文件删除。
自然文件请求与指定调用方式的受控故障 prompt 分开记录；`delivery-progress.json` 保存逐项完成情况，
`result.json`、调用记录与截图保存实际证据。人工审阅项必须核对后才能作为完整通过记录。

2026-09-11 S2 验收完成。Node.js 22.19.0、Harness 0.1.5-rc.1、已有 Marivo 0.5.5，
真实模型固定为 `deepseek-official/deepseek-v4-pro`、`high`。同一打包产物 SHA-256：
`e7b26573da0d164af702fcecce1ea1ccdbc37b494f7412343aebf91517ad91ed`。

- `delivery`：模型自主加载文件 Skill，通过绑定 Runtime 合并两个同名附件，输出 5 行／总额 371 的 CSV；
  PTC 生成 PNG 并原生声明；文字回答无新交付；Native／PTC 的 Session、Turn、调用和持久事件对应，重启恢复无重复投递。
- `failures`：缺少 `present` 时生成正确 JSON、提供准确路径并明确原生交付不可用；生成非零退出、错误路径均无成功声明；
  正确路径补声明不重跑分析；PTC 内已完成声明不因外层失败撤销；删除源文件后保留卡片并显示 Host 文件不存在错误。
  生成失败按 Python 返回内容的 `exitCode`／`stderr` 验证，不误用 Tool 协议的 `isError`。
- 报告回归：首次文件、同名替换、重启后重读首个文件分别得到 3／71、2／300、3／71 的正确报告与实际 `codeRef`，
  三次快照均没有把报告内部文件声明为普通附件。
- 已人工核对 CSV／PNG 桌面和 390 px 窄屏预览、缺失能力回复与删除源文件错误截图。
  这些是固定输入的一次通过记录，不代表所有模型运行均会自动遵循 Skill。

`npm run check` 通过（649 项通过、4 项默认跳过），build、包验证、最终验收脚本类型／格式检查通过；
CSV／PNG 示例已用实际 Runtime 执行，PNG 签名和各 chunk CRC 校验通过。Skill 资源、相对链接和差异空白检查通过。
证据保存在本地 `artifacts/dsh-rc1-s2/acceptance.json`、`delivery`／`failures` 的 `candidate.json`、各组 `result.json`、调用记录、截图与 tarball。
各组保留自身脚本指纹；成功组完成后仅修正失败断言以读取 Python 非零退出，生产 tarball 保持完全相同。最终打包复用验收过的 helper wheel；验证构建重生成 wheel 的 ZIP 容器摘要曾变化，逐成员比较确认内容完全相同，记录见 `wheel-reproducibility.json`。

早期候选中模型绕过绑定 Runtime 或遗漏交付能力说明的尝试未计为通过，已据此强化 Skill 并重新验收。
本次仅覆盖 S2；S3、发布及用户现有环境的重装／重启不在本次交付内。

### S2 验收脚本 review 修正

CSV 断言现在通过 Harness `fileAddressFor` 定位所属 Session／文件的原生预览，再核对完整内容，
桌面与窄屏均重新检查。PTC 外层失败通过声明的 `callId` 找到 dispatch 的 `rootCallId`，
核对同一 `run_code` 的失败结果、Turn／Step 及事件顺序。候选结束检查重新读取 HEAD、变更路径集合、
内容摘要和文件模式，支持新增路径、删除及带换行／中文的文件名。

`file-delivery-guards.test.ts` 随 `test:plugin-integration-delivery` 运行，覆盖聊天代码块冒充预览、
错误 Session／文件／内容、窄屏隐藏、无关 PTC 失败和候选漂移。已有真实 PTC 日志已通过新断言回放。
本次修正未重跑远端模型；原临时 Host 已清理，CSV 本轮使用浏览器正反例验证。
上述真实模型记录与包摘要仍属于原候选，不作为新脚本的完整真实环境复验记录。

修正后使用 Node.js 22.19.0 完成 `npm run check`（652 项通过、4 项默认跳过）、
`npm run build`、`npm run verify:plugin-package` 及 `git diff --check`，均通过。

## 按模块验证

下表列出常用入口；完整参数、前提和失败边界见对应[模块文档](architecture.md#模块导航)及脚本。

| 范围 | 确定性测试 | 真实环境入口 |
| --- | --- | --- |
| Runtime/Workspace | `test:runtime-workspace` | `validate:runtime-workspace:real` |
| Environment | `test:environment-execution` | `validate:environment-execution:real` |
| Help | `test:help-disclosure` | `validate:help-disclosure:real` |
| Datasource/Credentials | `test:datasource-credentials` | `validate:datasource-credentials:real`、`validate:datasource-execution:real`、`validate:credentials:web` |
| 数据源配置与删除 | `test:datasource-credentials` | `validate:datasource-configuration:real`、`validate:datasource-configuration:web`、`validate:datasource-configuration:model`、`validate:datasource-removal:web` |
| 语义引用与浏览 | `test:semantic-reference-input`、`test:semantic-browser` | `validate:semantic-ask-dsh:web`、`validate:semantic-browser:web` |
| 展示契约与投影 | `test:presentation-s0`、`test:presentation-projection` | `validate:presentation-projection:real`、`validate:presentation-browser:real` |
| reader 与交互 | `test:presentation-reader`、`test:right-tabs` | `validate:presentation-reader:real`、`validate:presentation-interaction`、`validate:presentation-export`、`validate:right-tabs:web` |
| 报告导航与引用 | `test:presentation-integration` | `validate:report-catalog:web`、`validate:presentation-semantic-navigation`、`validate:presentation-ask-dsh` |
| 展示与文件 Skill | `test:presentation-skill`、`test:plugin-integration-delivery` | `validate:presentation-agent:real`、`validate:file-analysis:real` |
| 插件交付与关闭 | `test:plugin-integration-delivery`、`test:presentation-surface`、`test:presentation-integration` | `validate:plugin-integration-delivery:real`、`validate:presentation-integration:real`、`validate:plugin-lifecycle:real` |
| 三页面报告读取与连接排队 | `test:datasource-credentials`、`test:presentation-integration` | `validate:report-read-latency` |
| 报告对象存储发布 | `test:presentation-integration` | `validate:report-publishing` |

表中名称均通过 `npm run <名称>` 执行。`test:presentation-s0` 是仍由 package.json 使用的历史命令名，负责纯展示契约测试，不表示项目仍处于该阶段。

## 证据与环境边界

Python 工具卡片：`npm run test:python-tool` 验证原文和状态解析，`test:right-tabs` 验证打包客户端的
定向注册与卸载；`npm run validate:python-tool:web` 验证安装依赖中的真实 `CodeBlock` 与专用卡片。
浏览器脚本启动临时 HTTP 服务与 Chromium，保留截图和 `evidence.json`，不启动分析或操作当前 profile。
该结果只证明生产组件在固定调用数据下的展示，不证明运行中的 DSH 已加载新插件。

2026-09-11 卡片隔离验收通过：Node.js 22.19.0，桌面 1200 px 与窄屏 390 px；Python 高亮、原文复制
（含无末尾换行、多末尾换行与 CRLF）、输出表格、键盘折叠、查看回调、中英文切换、警告和原文回退
均通过。长代码区域限高 360 px，窄屏文档宽度仍为 390 px，浏览器无未捕获错误。

同日 review 修复验收覆盖实际 `MarivoPythonExecutionError` 的规范化文本：`not-started` 与 `unknown`
分别显示“未执行”和“执行结果未确认”，耗时及禁止自动重放的 `nextAction` 可见，原始错误保持完整。
无效摘要、非错误输出中的相同后缀，以及错误中的成功声明均有回归覆盖。

- 契约与确定性测试证明输入、身份、状态转换和失败处理；模拟 transport 或固定数据不证明真实服务可用。
- Runtime 验证应记录实际解释器和包身份、隔离 Workspace、生成与恢复过程；跨进程恢复不能以同一进程缓存代替。
- Web 验证应记录实际加载的 client、Host 接线及用户操作结果。生产组件加 fixture 不等于已安装 profile 验收；HTML 需要覆盖离线、无脚本、打印和数值保真。
- 模型验证应使用真实 Tool/Skill 路由、请求与 Session 事件，区分模型自动选择和脚本强制调用。
- 对象存储的本地签名 PUT fixture 不证明真实 Bucket 权限、服务商兼容性、持久性、CDN 或公网访问。

真实环境操作按任务授权和前提执行；重装、重启、清理状态、发布或推送不由验证命令的存在自动授权。缺失前提、跳过项和未确认结果须单独报告，不把本地检查写成已发布能力。记录不包含凭据值、完整环境或无关用户数据。

## 三页面报告读取验收

设置 `DSH_DATA_ANALYSIS_PYTHON` 为已安装 Marivo 的解释器绝对路径，使用 Node.js 22.19.0 执行
`npm run validate:report-read-latency`。脚本创建隔离 Workspace、profile 和打包插件的真实 Harness Web，
在同一 Chrome context 打开三个页面，并保留原生 HMR SSE。脚本关闭自己启动的浏览器及 Host，
不重装当前插件或改变当前 Workspace；临时输出保留 `results.json` 和隔离环境证据。

预热后每页五次刷新列表并打开报告，校验样本包含实际 resolve 与文件读取请求。记录 UI 操作到可读状态、
Resource Timing 的 `requestStart - fetchStart` 及协议；发送前等待 p95 要求小于 250 ms，
列表和正文可读 p95 要求小于 1 s。另验证首次凭证快照、不传 cursor、25 秒复核期间无额外 HTTP watch、
重连快照，以及挂起发布配置时正文可读、仅两个 HTML 操作禁用。该验收不覆盖更多页面下 Harness HMR SSE 的连接上限。

2026-09-10 隔离验收通过：Node.js 22.19.0、同一 Chrome context 三页面、保留 3 条 HMR SSE，
预热后共 30 个可读耗时样本、60 个列表／resolve／文件请求。发送前等待 p95 为 0.8 ms，
列表可读 p95 为 65.8 ms，正文可读 p95 为 601.8 ms。26 秒空闲期间无新增 HTTP watch，
重连后取得新快照；发布配置挂起时正文可读且编辑／历史操作可用。
候选 `lib/client.js` SHA-256 为 `0d4bc2868f2daef848efe9269d2c86f28dc9a888435b8a272e19c9b4b99cd612`；
测量原始结果与全部模块摘要保留在本次脚本输出目录的 `results.json`、`web/production-module-digests.json`。
此记录是隔离环境验收，不表示当前运行的 DSH 已重装或升级。

Review 修复后，Node.js 22.19.0 下 `npm run check`（636 项测试）、构建与包验证通过。
新增回归覆盖临时凭证状态错误恢复、重试等待取消、契约错误终止，以及 Harness 原生 RemoteStream
等待重连期间的晚到响应隔离。另在真实隔离 Host 就绪后注入 Chrome 启动失败：脚本按预期失败，
Host 及本次启动的全部子进程均已退出；浏览器启动和关闭异常均位于 Host 清理边界内。

补充运行 `validate:credentials:web` 时，首次待办、并发操作恢复、重载后继续原调用以及 Python 仅启动一次的断言通过。
完整脚本随后在 `clickhouse_in_card` 的 390 px 窄屏标题区域触发水平溢出断言，未通过全部 UI 布局验收；
该断言仍保留，布局修复不属于此次报告连接优化范围。

## 插件界面与报告语言分离验收

2026-09-10 使用 Node.js 22.19.0 验证破坏性语言契约：Draft v2、Document v3 必须携带
`zh-CN` 或 `en-US`；Receipt 保持原有结构。旧版本、缺失及非法语言明确拒绝并要求重新生成，
不提供默认语言、兼容读取或迁移，不删除旧文件或覆盖不可变 Build。

`test:presentation-reader` 的语言测试覆盖词典 key／参数一致性、保留提示的即时翻译、精确 decimal／int64
数值、UTC 时间及静态导出；`test:presentation-projection` 覆盖两种语言原样投影和旧 Draft 在 Runtime
读取之前被拒绝；`test:presentation-integration` 覆盖两种语言的发布、编辑保存、重新打开、完整 HTML
导出及原 Build 字节不变。

`npm run validate:locale` 使用已安装 Harness 的真实 `LocaleRuntime` 和生产 React 组件，在隔离
Playwright 页面运行系统中文／英文 × 报告中文／英文四种组合。验证凭证提示更新、
凭证输入／语义搜索／报告标题编辑草稿保留、中英文语义类型搜索有效，以及切换时无额外数据读取。
Host 打印区域、当前视图 HTML、独立交互 Reader 和关闭 JavaScript 的 fallback 均保留报告语言；
离线页面使用相反的浏览器语言并补充 print media 检查。作者正文及筛选项标签不由插件翻译。
脚本输出临时证据目录，保存四种组合截图、编辑状态截图及当前视图 HTML；测试输入仅为固定 canary。

本轮 `npm run check` 通过（638 项通过，4 项跳过）；构建及 `npm run verify:plugin-package` 通过。
四项跳过是既有真实 Python timeout／cancellation／deadline／长运行验证，要求显式指定
`DSH_DATA_ANALYSIS_PYTHON`，不计作真实 Runtime 验收。另补充运行双语保存导出回归。

上述浏览器验收使用固定数据和模型端口，证明语言订阅与生产组件行为，不等于当前已安装 DSH profile
的端到端验收。真实模型根据用户问题选择语言、当前 profile 的原生设置切换及新报告生成仍待验证；
本轮未发布、重装、重启或清理现有环境。

语言 Review 修复补充：三个目录页为 `sidebar.right.pane.tab.title` 注册动态标题组件，避免
Harness 的打开时标题快照在切换语言后继续显示旧文案。回归使用真实 SlotRegistry 查找并渲染注册的
标题组件，覆盖三个目录的中英文标题；不以再次调用 tab definition 的 title 函数代替该检查。
当前视图导出在写入来源 reason／notice 前使用报告词典解析；Finding 诊断按稳定 code 本地化，
未知上游诊断保留原文。语言矩阵增加含不可用来源和 Finding 诊断的 computed 报告，验证导出
不含内部翻译 key 或固定英文 Finding 提示，静态 fallback 另有双语回归覆盖。

Review 修复后，Node.js 22.19.0 下 `npm run check` 通过（640 项通过、4 项因上述 Runtime 前提跳过），
`npm run build`、`npm run verify:plugin-package`、`npm run validate:locale` 与 `git diff --check` 通过。
真实 DSH profile／模型生成验收边界不变。

提交前另以仅包含语言改动的隔离候选验证，剥离工作区已有凭证通知与读取性能改动：Node.js 22.19.0
下 `npm run check` 为 621 项通过、4 项跳过，构建、语言矩阵与分发包验证通过。

## 空白首页工作区快捷入口验收

2026-09-11，Node.js 22.19.0 与 Harness 0.1.5-rc.1 下 `npm run check` 通过（653 项通过、4 项因既有 Runtime 前提跳过）。最终布局的 build、包验证、quality 与脚本类型检查通过。

`npm run validate:workspace-shortcuts:web` 使用打包后的插件、真实隔离 Host 和浏览器，验证无 Session 不显示、空白首页显示三个入口、键盘打开目录、重复打开复用 Tab、当前 Session 改变时旧点击被拦截并显示可恢复错误、草稿正文／语义引用／图片附件保持不变、中英文切换，以及 390px 下文字可见且按钮可点击。首轮后入口隐藏，原顶栏继续打开目录；切到另一个空白 Session 后入口重新出现。入口组左对齐，并以内容缩进对齐首页 Workspace 标签。

模型边界为脚本化 adapter，首轮由隔离验收工具驱动；该证据不表示真实模型自主选择，也不表示用户当前 profile 已重装。

最终候选 `lib/client.js` SHA-256：`bf7d8725fb83406cf6f68b83884c7162eca2b89b867eff4770c5218d99791558`。证据目录 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-homepage-shortcuts-cWvPbD` 保留 `results.json`、宽屏／窄屏截图、打包身份与 Runtime binding。

扩展的完整 `validate:right-tabs:web` 曾通过首页与首轮隐藏检查，随后进程以 137 退出，未计作完整回归通过；最终首页验收由上述聚焦脚本独立通过。早期全量检查遇到生成资源缺失，按先构建再测试顺序重跑后通过。未升级依赖、修改 Harness、发布、重装或重启用户当前服务。

## Agent HTML 导出与原生文件交付验收

2026-09-11 新增 `marivo_export_html`。工具与阅读器共用固定 receipt 的 HTML 校验／生成路径，
仅从已保存快照导出。新增回归覆盖 JSON 构建、历史已存 HTML、current 并发更新后仍保留原 Build、
历史 Build 精确选择、摘要损坏、路径与符号链接拒绝、拒绝覆盖、字节预算、Workspace 变更、取消及卸载排空。

`npm run validate:html-export` 使用临时 Workspace、真实 Harness AgentLoop／ToolRuntime／WorkspaceRegistry
及原生 `present`，模型边界使用确定性适配器；不启动 Python、不访问数据源，不代表远端模型自主调用验收。
已验证导出成功后的实际路径用于 `present`，同一 Session 产生一条 `deliverables/presented` 记录。
随后 Chromium 断网打开实际导出文件，切换日期与集群并显示图表；禁用脚本时仍可阅读正文与精确数据表。
两种截图均已检查。命令输出的临时目录保留 `events.json`、`evidence.json`、HTML 及两种浏览器截图。
此验收不把工具文件位置当成交付完成，不证明用户当前 Web 的文件卡片已经打开。

Node.js 22.19.0 下 `npm run check` 通过（662 项通过、4 项默认跳过），
`npm run build` 与 `npm run verify:plugin-package` 通过；新增 Skill 参考页已纳入分发验证。
未修改用户当前 profile，未重装、重启、提交或发布。

Review 修复后，导出暂存文件使用同一文件系统内的最上层 Workspace 祖先目录；失败时保留文件句柄，
先清空本次 inode 的内容，再清理能够确认身份的路径。新增回归覆盖暂存后／落盘后移动输出目录，
以及原路径被其他文件替换的情况：替换文件不受影响，暂存文件被清理，移走的最终文件只保留空文件。
不扫描未知位置删除文件。7 项导出回归和 `validate:html-export` 的真实 Harness／离线浏览器复验通过。
Node.js 22.19.0 下 `npm run check` 再次通过（663 项通过、4 项默认跳过），构建和包验证通过。


## 系统提示与 Skill 分工验收

常驻路由、Host 执行边界与两个插件 Skill 的职责见
[Prompt 与 Skill 激活](modules/plugin-integration-delivery.md#prompt-与-skill-激活)和
[文件分析与展示的分工](modules/presentation-skill.md#文件分析与展示的分工)。
确定性检查覆盖激活首请求、恢复、两个 Skill 的资源可达性、示例契约与实际包分发；它们不证明模型会正确选路。

设置已验证的 `DSH_DATA_ANALYSIS_PYTHON`，通过 `npm run validate:file-analysis:real` 运行隔离模型验收：

- `DSH_DATA_ANALYSIS_VALIDATION_SUITE=files`、`DSH_DATA_ANALYSIS_VALIDATION_FILE_CASES=routing`、
  `DSH_DATA_ANALYSIS_VALIDATION_FORMATS=csv`：使用自然请求检查 CSV、PNG 的原生交付、文字续问和简短
  比较表格。CSV/PNG 请求不提示“不要报告”或具体实现方法。路由模式保留计算与交付事件检查，
  不覆盖原生预览或 Host 重启；完整 `delivery` / `all` 模式继续保留这些检查。
- 比较题包含 A 区域同比 +50%、环比 -25%，B 区域环比 +20% 且缺同比基准。
  `comparison-review.json` 保存独立预期与真实事件，需人工核对最终回答中的方向、分母、归属和缺失分支；
  不以回复出现某个数值或固定措辞代替结论检查。
- `DSH_DATA_ANALYSIS_VALIDATION_SUITE=reports`、`DSH_DATA_ANALYSIS_VALIDATION_FORMATS=csv`：验证文件分析
  接入保存报告、同名附件替换与隔离 Host 恢复后的继续分析。

`delivery-scope.json` 和 `result.json` 明确记录模式与边界。模型可用性、Tool receipt、数值复核和浏览器
预览分别记录，不将局部通过写成完整 UI 验收。


2026-09-12 验证记录：Node.js 22.19.0，Harness 0.1.5-rc.1，Marivo 0.5.5，模型
`deepseek-v4-pro` / `high`。`npm run check` 共 672 项，668 通过、4 项需显式 Runtime 的进程测试按原条件跳过；
`npm run build`、`npm run verify:plugin-package`、两个 Skill 的 frontmatter 校验通过。最终 Skill 补强后重跑
5 项 Skill 契约测试与包验证，最终验收脚本通过 typecheck。

- 文件路由模式通过 CSV 原生交付、文字续问、聊天比较表与 PNG PTC 交付。人工复核确认同比／环比的数值、
  方向、分母与 B 的缺失基准均正确，解释与表格一致；生成的 PNG 经图像检查确认标签和数值可读。
- 报告模式通过初始 CSV（3 行、71）、同名替换附件（2 行、300）以及隔离 Host 重启后恢复首份附件
  （3 行、71），每个结果关联本次实际读取原附件完整路径的执行记录。此处通过指保存内容与执行记录，
  `web.png` 仍显示宿主初始提示，不作为报告阅读器视觉验收证据。
- 初轮发现比较解释误写同比／环比标签，以及复制附件后读取同名副本未通过原路径追溯检查；据此补强文件
  Skill 的最终文字核对与直接使用附件完整路径指导，以上通过结果来自补强后的候选。
- 完整 `delivery` 模式的 CSV 文件内容与原生交付事件通过，但原生 CSV 预览 locator 超时；原因未在本次
  范围内确认。路由模式不绕过或改写完整模式的预览断言，不能据此宣称完整原生预览验收通过。

证据在本机临时验收目录 `dsh-file-analysis-real-YMZou8`（`result.json`、`comparison-review.json`、
`comparison-manual-review.json`、`files-png.json`）和 `dsh-file-analysis-real-xVQPam`
（`result.json`、三个真实回合记录与 `web.png`）；目录由脚本输出绝对路径，各记录保留候选文件摘要与包摘要。
原生预览失败记录为 `dsh-file-analysis-real-ZC7GQ3`。本次验证未重装当前用户插件、修改用户 profile 或重启
当前服务；只运行并关闭隔离 Host。模型样例通过不保证所有任务的分析判断均正确。


## 有界语义交接验收

系统提示仅增加可复用业务定义或语义缺口的交接入口；文件 Skill 规定当前所需／已授权范围、已有对象优先、
最小必要缺口、返回原问题和停止条件。范围外机会只在答复中说明；具体对象编写与验证由 Runtime 的
`marivo-semantic` 拥有。没有自动持久化、递归建模或新的工具门禁。

文件路由验收的比较问题带有“以后每月都会按同样口径比较”的复用背景，同时要求本次先回答文件问题。
使用前述 `files` / `routing` 模式运行：检查文字比较、计算和缺失基准，并明确断言不因此加载
`marivo-analysis` / `marivo-semantic` 或查询 Marivo Help。数值与最终解释仍需人工复核。
这验证范围外机会不会强制触发语义流程；不等同于已授权语义建模的端到端验收。


2026-09-12 本次验证：最终 `npm run check` 为 668 项通过、4 项按原条件跳过；构建、包验证、Skill
frontmatter 和本地链接检查通过。首轮现有语义目录测试出现子进程超时，单独复跑约 6 秒通过，最终完整
检查也通过，未改变超时阈值或断言。

`deepseek-v4-pro` / `high`、Marivo 0.5.5、Harness 0.1.5-rc.1 的隔离路由验收通过。首轮模型绕过了
文件 Skill，仅读取后回答；系统入口据此明确简短聊天比较也先加载文件 Skill。最终样例加载该 Skill 并
通过 `marivo_python` 成功计算，A 同比 +50%、环比 -25%，B 环比 +20%、缺同比基准；只在答复中提出未来
复用建议，没有进入语义建模或另建记录文件。CSV、文字续问与 PNG 原生交付回归也通过。
证据目录为脚本输出的 `dsh-file-analysis-real-H0KuZB`，保留 `result.json`、`comparison-review.json` 和
人工复核 `semantic-scope-review.json`。本次不覆盖已授权语义对象创建、原生预览或生产服务升级。
