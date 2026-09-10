# 项目验证指南

## 验证原则

根目录 [package.json](../package.json) 是验证命令入口。模块文档描述应验证的契约；测试通过记录必须绑定实际代码、安装包和环境，不能由设计文档、旧截图或脚本路径推断。

本地构建使用 `.nvmrc` 指定的 Node.js 22.19.0。可执行变更运行相关测试及 `npm run check`；exports、client、包元数据或分发内容变化时，再运行 `npm run build` 与 `npm run verify:plugin-package`。纯文档变更检查相对链接、标题锚点、Markdown 渲染和 `git diff --check`。

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
