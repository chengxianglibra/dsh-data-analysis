# @chengxianglibra/dsh-data-analysis

由个人维护的 DeepSeek Harness 社区插件，并非 DeepSeek 官方发行或维护的软件包。

DeepSeek Harness 的 Marivo 集成插件。当前包提供：

- 精确 Marivo 0.5.4 共享 Runtime 与 zero-init per-Workspace binding；
- `marivo_help` 实时公共 Help transport；
- 会话标题旁的“语义层”对象浏览器：Workspace 分类搜索、只读详情与局部关系图；
- `marivo_datasource_test` 的 DSH Credentials 收集与显式 connection test；
- `marivo_python` 的本次执行准入与单次 resolver 凭证注入；
- 会话标题旁的“数据源与凭证”管理、测试与缺失输入提交后的原调用续接；
- `marivo_present({ draft_path })` 的一次文件提交、结果卡片、打开与离线 HTML 下载；
- 唯一插件 Skill `dsh-data-analysis-presentation`，组织图表、表格、报告、看板与可读来源展示；
- `dsh_data_analysis_presentation.write_dataset(frame, path)` 的 computed typed JSON writer；
- 内部 Artifact/computed/source-only 数据投影，保存精确来源及 unavailable 状态。

共享 reader、离线 builder、`marivo_present` 和展示 Skill 提供统一的展示交付；
两个 Marivo Runtime Skill `marivo-analysis`、`marivo-semantic` 继续从当前 Runtime 挂载。
旧 report-kit、report Skill、经典 JS 与 Evidence 卡协议不再分发。升级说明见
[0.1.2 发布说明](../../docs/releases/0.1.2.md)。

## Compatibility

包内 `dshDataAnalysisCompatibility` 是唯一运行时兼容声明：

- DSH distribution 与所有必需 peer 精确使用 `0.1.1-rc.2`；
- Runtime 通过 pip 安装已发布的 Marivo 0.5.4；版本约束为 `marivo[duckdb,trino,clickhouse]==0.5.4`；
- 项目自有 Runtime marker 为 `dsh-data-analysis-runtime/v3`；
- 子进程策略为 `direct-argv-inherited-env-snapshot-overlay-v2`。

管理员解释器的 `marivo.__version__` 与 package identity 必须精确匹配；不使用 capability/version matrix。

## Tool contracts

```text
marivo_help({ targets: string[] })
marivo_datasource_test({ name: string })
marivo_python({ code: string, datasources: string[], timeoutMs?: number })
marivo_present({ draft_path: string, report_id?: string, expected_build_id?: string })
```

`marivo_datasource_test` 只拥有缺失 Credentials 的 DSH/Web 闭环和显式连接测试；
`marivo_python` 在本次调用内等待全部数据源凭证就绪、核验身份并取得 fresh snapshot，再通过 DSH 前台
执行服务与 Marivo 公开 resolver 启动一次代码。配置齐全时不额外测试；普通 Shell 不获得凭证。
缺失输入时默认等待 Web 表单，提交测试成功后继续原调用；取消、轮换或 Workspace 变化终止旧准备，
已启动代码失败不重放。无 Web 场景配置 `credentialInteraction: 'none'`，subagent 同样不等待表单。
详见[凭证模块](../../docs/modules/datasource-credentials.md)。`md.inspect(...)`、
Session recovery、Artifact revalidation、Quality、Evidence 读取、Session Graph 与 `to_pandas()` 都直接使用
Marivo 公共 API，不增加 convenience Tool。

## Python 超时配置

插件配置 `pythonTimeoutMs` 默认 `120000`，`pythonMaxTimeoutMs` 默认 `600000`，单位为毫秒。
两者必须是 `1..2147483647` 内的整数，默认值不能超过上限；非法配置在 Runtime 安装及 Tool 注册前拒绝。
单次调用可以请求更长预算，例如：

```ts
await tools.marivo_python({ code: 'print("ready")', datasources: [], timeoutMs: 300000 })
```

请求先经过插件上限，再由 Harness Shell 应用自身上限；省略参数时使用插件默认值。
`execution.requestedTimeoutMs` 保留截断前的请求，`execution.effectiveTimeoutMs` 是解析后的 Shell 预算。
凭据等待不占该预算；外层 Code Mode 总时限包含等待与其他步骤，仍可能更早取消调用。

执行摘要只描述插件阶段和已知终态，不表示查询进度。失败时遵循 `execution.nextAction` 检查既有效果，
不要自动重放。`codeRef` 仅表示成功执行的代码记录；代码记录失败仍保留执行成功，超时也不证明没有已保存结果。
字段与错误通道详见[超时与执行反馈](../../docs/modules/datasource-credentials.md#超时与执行反馈)。

## 语义层对象浏览器

点击 DSH 会话标题旁的“语义层”，默认查看该会话所属 Workspace，也可在面板内显式切换 Workspace。
可按业务域和类型筛选，搜索名称、引用与业务定义，
复制对象引用、查看定义位置，并在对象关系中逐层浏览。桌面采用三栏布局，窄屏支持列表与详情切换。

页面不要求 live Agent，只读取 Marivo Catalog 元数据，不执行 `observe`、数据预览或连接测试。
打开和手动刷新重新加载；读取失败时明确标注上次成功内容。数据源连接配置、凭证值与原始源码不展示。
使用及验收边界见[模块说明](../../docs/modules/semantic-browser.md)。

“数据源与凭证”位于同一会话标题旁，打开时同样使用该会话所属 Workspace，面板内保留 Workspace 选择。
两个入口随 Harness 的会话标题显示，无会话或空会话时不显示，侧栏底部不保留入口。

## 分析与展示

普通事实问答使用文字。图表、表格、报告、看板和可读来源展示加载 `dsh-data-analysis-presentation`，
按 Skill 编写 Workspace 相对 Draft，再调用 `marivo_present`。已有 Artifact 或 computed 数据无需先激活
`marivo-analysis`；需要新分析或语义编写时，按需加载对应 Runtime Skill 与 live Help。
Skill 只指导内容组织、声明来源和交付，不承担分析计算或来源有效性判断；布局由 reader 自适应。
完整流程见[展示 Skill](../../docs/modules/presentation-skill.md)。

Python helper 的可选 `labels={列名: 展示名}` 设置中文表头、图例和 tooltip，字段绑定仍使用原列名。
Python helper 只接受 pandas DataFrame，写入 `schemaVersion: 1` 的 typed JSON；int64/Decimal 保留精确字符串，
null 保留缺失含义，datetime 必须带时区。它不保存来源或转换代码；来源在展示 Draft 中声明。
固定 projection 从同一 bound Workspace 恢复 persisted Artifact 和可选 Finding，不自动 observe、revalidate 或读取凭据。
直接 Artifact dataset 缺必要数据会失败，computed 和 source-only 可以保留 unavailable 来源。

共享 reader 展示 Markdown、metric、18 类 chart、table 和 source，保留精确值、单位、截断与 unavailable 来源。chart 支持 bar/line 变体与当前页面的字段、图形及过滤探索；统计量由分析阶段准备，探索不改写保存快照。
`marivo_present` 读取 Workspace 相对 Draft 路径，生成不可变新 build 的 JSON/自包含 HTML。
默认创建新 Report；修改已有报告时成对传入 `report_id` 与本次修改所基于的 `expected_build_id`，以完整 Draft 更新同一 Report。
版本冲突时读取当前保存内容并合并需保留的编辑，不强行覆盖，也不回退新建。
原卡片通过 reportId 打开最近保存结果；阅读器可编辑标题、正文、指标标签、图表和表格配置，以及移动／删除 cell（允许删空），支持撤销／重做和保存／取消。
保存生成同报告的新 build，保留底层数据、来源和代码，不运行 Agent 或 Python。
Workspace「报告」列表支持标题搜索、最近更新和来源会话入口；历史版本只读，下载固定为正在查看的版本。
报告读取无需来源 Session 存活；旧 current 缺少早期发布记录时只展示可确认的版本，不猜测历史。
全部 18 种 chart 与同 dataset 的表格和数据预览共享临时筛选；筛选不重算指标、不标记编辑修改、不进入保存、下载或打印。
文档、receipt 与 delivery 使用 schema v2，Draft 和 typed dataset 保持 v1；旧报告不读取、不迁移，旧文件保留。文本始终包含两份文件的位置、digest 和字节数，headless 也能取得交付物。
展开来源仅使用保存的快照；文件变化、缺失或 Workspace 归属变化会明确失败。
实现与验收见[展示数据投影](../../docs/modules/presentation-projection.md)、[展示 reader](../../docs/modules/presentation-reader.md)、
[展示交付](../../docs/modules/presentation-delivery.md)。

## 验证

```bash
npm run check
npm run build
npm run verify:plugin-package
```

当前架构与验收边界见仓库根目录的[总体架构](../../docs/architecture.md)和
[展示交付](../../docs/modules/presentation-delivery.md)。

## 语义对象引用

在 Web 输入框输入 `@` 选择当前 Workspace 的 Marivo 对象；多词检索使用 `@"monthly revenue"`。
选中后显示完整 `kind:path`，提交只携带精确 ref。最近七个自然日热度保存在 DSH profile；候选缓存为 30 秒。
对象有效性由执行时 Marivo Catalog 验证，删除对象不会被相似对象自动替换。


## 草稿静态预检

在 Workspace 根目录运行 `dsh-data-analysis-presentation-lint analysis/presentation.draft.json`，
或通过 `--project-root PATH` 显式指定 Workspace。CLI 复用 present 的草稿与 TypedDataset 校验及文件边界，
检查草稿结构和引用的 computed JSON；不启动 Runtime、不执行分析、不生成报告文件。
输出 JSON 的 `ok` 仅表示这些静态检查通过；`deferredChecks` 列出仍由 `marivo_present` 完成的
Artifact 可用性与数据、codeRefs、投影后文档与渲染检查。退出码为 0（通过）、1（校验失败）、2（参数错误）。
草稿结构通过后逐份检查 computed 文件，每份保留首个错误，修正后可再次预检。

int64 单元格必须是精确整数字符串，例如 `"42"`；JSON number `42` 也不接受。
诊断保留 JSON pointer，并显示 `column query_count type=int64`、原因与修复建议。
超过 JS 安全整数范围的 number 可能已舍入，不能转成字符串来恢复精度；应从原始精确数据重写，
或使用绑定 Runtime 中的 `write_dataset`。预检通过不等于成功交付，仍需 present 的成功 receipt。
