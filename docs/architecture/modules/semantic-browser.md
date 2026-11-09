# 只读语义层对象浏览器

## 使用方式

在 DSH 会话标题旁点击“语义层”，打开原生右侧 Tab，仅展示该会话所属 Workspace，不提供 Workspace 筛选项。
切换会话保留各 Tab 的状态，Workspace 绑定撤销后使旧页失效。入口随 Harness 的会话标题显示，无会话或空会话时不显示，侧栏底部不保留入口。
浏览器不要求 live Agent，不自动创建会话。标题右侧显示最近更新时间，页面不展示项目路径和 Catalog fingerprint。

报告来源中的语义引用打开独立资源 Tab，按报告所属 Workspace 和完整 `kind + path` 定位；页内对象、定义链接与关系图跳转使用当前 Catalog 快照并保留浏览历史。语义层详情不提供另开标签页按钮。
首次打开重新读取 Catalog，展示当前定义及快照边界提示；原报告保留阅读状态。语义浏览统一使用原生 Tab，不再注册语义弹窗。
入口适用于全部语义对象类型，包括 `entity`；没有指标或维度类型白名单。
对象已不存在时保留目标引用并明确提示，包括当前 Catalog 为空的情况。

对象类型导航的“全部对象”及各类型数量按当前业务域统计；选择类型或输入搜索词不改变分类计数，当前业务域下没有对象的类型显示 0。

对象分类与业务域筛选位于顶部，类型数量始终可见；桌面下方提供对象列表和详情两栏，窄栏通过“返回列表”切换。可以组合业务域与类型筛选，并搜索名称、
规范引用和完整业务定义。列表每页 40 个对象，详情不沿用输入框候选的 240 字符摘要上限。

详情包含：

- **概览**：业务定义、所属域、核心属性和使用约束；所属业务域可直接跳转。
- **定义**：计算口径、未在概览展示的公共属性、Python 符号和 Catalog 记录的来源位置；来源位置由 Marivo 提供，不保证指向用户模型代码。属性中的对象引用按 Catalog 为该字段声明的完整 Ref 渲染为链接，保留列表、映射和重复引用；目录缺失对象时禁用并明确提示，不按普通文字猜测链接。
- **关系**：公共字段对应的对象关联按字段分组，可折叠查看对象名称和完整引用，并可复制引用、点击跳转和返回；业务定义在对应对象的概览查看。同一对象只显示一张卡片，其他关联字段和原始顺序以标签保留。支持一跳关系图、逐层展开、缩放、平移、键盘跳转。

列表优先显示对象名称和业务定义；概览按类型突出来源、时间、连接键等已声明信息。概览已展示的属性不再出现在定义页；
纯引用字段仅在关系分组能保留完整引用、顺序及数量时集中到关系页，否则仍在属性或计算口径中展示。包含额外结构信息的连接键等仍保留原有结构；公式中的引用及可跳转的引用对象列表继续提供计算上下文。对象详情、关系图节点、关联对象和引用对象列表共用同一类型图标，
属性和关系分组使用一致的语义图标。
结构化属性按列表和层级键值展示，较长列表可展开余项。计算口径保留原始表达式；度量的单位与可加性在定义页作为独立属性行直接展示，与定义事实同级，不再收进补充属性；时间绑定直接展示绑定的时间维度引用，空值规则先简要展示各类规则，不同计算分支的适用关系可按需展开，其他计算事实按需展开；可完整表达的声明依赖集中在关系页。
关系优先按更具体的声明字段分组并显示本组卡片数量；多个关联共享对象时，标签中的序号保留原字段内的顺序。规范引用仍可用于区分同名对象和定位缺失对象；计算类对象的补充属性与来源位置集中折叠，
其他对象的语义属性直接展示。

关系图最多显示 60 个节点，达到上限时明确提示；关系列表保留完整关联。图上的箭头按公共字段的引用方向显示，
同一对对象的多个关系合并绘制，标签的 `+N` 表示还有其他关系，可通过悬停或图中关系列表查看。
这是对象声明关系，不是某次查询的执行血缘；候选维度不代表任意查询组合已通过验证。

覆盖 Marivo 0.6.4.dev0 的 8 种对象：业务域、数据源、实体、维度、度量、时间维度、指标和关系。未填写的定义有明确提示，不猜测口径。数据源只展示引擎类型和通用对象信息；
实体展示来源类型、表身份、版本属性与已声明的默认时间。文件或远程来源地址、请求参数、连接配置、凭证值和原始源码不投影到页面。

## 所有权与读取边界

DSH 的 `conversation.session.header.actions`、`sidebarRightTabs` 与正文 slot 提供入口和容器，入口使用所属会话的
`workspaceId`，`workspaceRegistry` 提供项目身份。
插件提供界面、受控读取和展示投影；Marivo Catalog 拥有对象内容与关系语义。

现有语义引用 transport 在 Harness `/api` 下注册 `/api/dsh-data-analysis/semantic-browser/catalog` 精确认证路由，请求仅接受
`{ workspaceId }`。Host 从注册表解析路径，保留 `config.projectRoot`、`DSH_DATA_ANALYSIS_PROJECT_ROOT` 的显式覆盖，
然后使用 Workspace 路径。读取使用实际绑定路径，不接受浏览器传入任意目录。

Catalog 投影带有插件自有的格式版本；界面与服务格式不一致时明确提示同步加载插件，不猜测字符串中的 JSON 类型。

每次加载在一次 checked Python 调用内执行 `ms.load(workspace_dir=...)`，使用空查询 `catalog.search(limit=100, cursor=...)` 完整分页、
`entry.to_dict()` 与 `entry.related(...)`。返回 Workspace identity、Environment fingerprint、Catalog definition
fingerprint、加载时间、对象摘要、白名单详情字段和关联引用。全部视图使用同一快照。

不调用 `observe`、preview、readiness、连接测试、凭证解析或分析 Session 创建。禁用本次读取的 Marivo telemetry
及 Python 字节码写入；不额外读取源码。模型本身仍由 Marivo 按其 Python 加载契约处理。

单次 Catalog 调用限时 30 秒，stdout 上限 32 MiB、stderr 上限 8 KiB。超过上限明确失败，不发布残缺目录。
模型加载期间的普通打印直接丢弃，不累计到无界内存缓冲。Marivo 返回的语义模型诊断保留错误类型、正文、引用和修复提示，
不再统一包装成同一条失败文案；未知 Python 异常和 traceback 仍不直接回传，使用固定兜底诊断。

## 加入提问

列表详情和独立对象 Tab 均提供“加入提问”。仅在页面所属 Workspace 与当前 Session 输入归属明确时可用；
页面没有可用的所属会话输入时，按钮禁用。操作使用浏览快照的 ref 和 Environment fingerprint，经显式 `prepare` 后在草稿末尾
插入一个与 `@` 相同的原生 chip，不复制完整定义、不自动发送，也不提前 serialize。引用协议见[语义输入模块](semantic-reference-input.md)。

准备期间禁止重复点击；完成后再次点击表示再次追加。页面关闭、导航、刷新或快照替换、Session 切换、Workspace 撤销与连接
重置均阻止迟到结果写入。命令进入提交、普通发送清空草稿或手动清空都会取消准备，新草稿不会接收迟到引用。
`plain` 与 `claimed` 状态均沿用原生引用插入能力；完成时重新读取最新草稿，通过 Host 的 detect 坐标和 `draftRev` 插入一次，沿用原生撤销。
失败保留页面、草稿、已有引用及附件并允许重试；常用计数失败不回滚成功插入。

## 状态与刷新

标题行提供一个“刷新语义层”图标按钮，加载期间禁用。首次打开和手动刷新时读取 Catalog；搜索、筛选、详情及关系图操作只使用当前快照。没有后台轮询、文件监听
或跨页面持久化。页面内筛选和浏览历史按 Workspace 隔离。

刷新成功时整体替换快照；失败时保留并标明上次成功内容。空项目、空搜索、首次加载失败、所选对象删除和 Workspace
不可用分别提示。关闭、切换、插件卸载取消请求；即使底层请求迟到，也不能更新其他项目或关闭后的页面。
Host 连接重置清除绑定数据，从会话入口重新打开。Workspace 删除后不再提供旧项目内容。

## 验证

```bash
npm run test:semantic-browser
npm run check
npm run build
npm run verify:plugin-package
```

浏览器验收使用独立临时项目和 loopback 服务，执行真实 Marivo 读取与 Chromium 渲染，不修改正在运行的 DSH Profile：

```bash
DSH_DATA_ANALYSIS_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
npm run validate:semantic-browser:web
```

可通过 `DSH_DATA_ANALYSIS_TEST_PYTHON` 指定目标 Marivo 0.6.4.dev0 Python，通过 `DSH_DATA_ANALYSIS_BROWSER_OUTPUT`
指定截图及结果记录目录。浏览器工具默认查找可导入的 `playwright`，其 Chromium 必须已安装。

该夹具复用生产 Tab 正文与模型，模拟 Workspace transport；不等同于当前已安装 DSH Profile 的
端到端验收。

如需检查本地 Yellow Taxi 模型，可设置 `DSH_DATA_ANALYSIS_YELLOW_TAXI_ROOT` 与
`DSH_DATA_ANALYSIS_TEST_PYTHON`，先运行 `npm run build:ui-styles`，再运行
`node --experimental-strip-types packages/dsh-data-analysis/scripts/validate-semantic-browser-yellow-taxi.ts`。
该验收将配置与模型复制到临时 Workspace，使用真实 Catalog 和 Chromium；不读取业务数据，也不替代已安装 Host 验收。

## 指标计算口径

定义页使用公共 Entry 的 captured `definition`：Metric 显示 `formula`，字段显示 `expression`，并展示
`reductions`、`conditions`、`time_bindings`、`null_rules` 与 `facts`。不再消费旧 `semantic_definition/v1` 公式树，
不自行解析或重建 Marivo 表达式。公式、空值规则、定义条件与源聚合使用当前对象及其递归 `dependencies` 中 Catalog 声明的完整对象引用，转换为可跳转的短名称；原始表达式可完整复制，未声明的文本保持原样。递归按对象身份去重，缺失对象的已声明引用仍显示为禁用链接。

引用对象列表沿公开 `dependencies` 关系递归收集有可展示计算信息的对象，最多 40 个，超限提示继续点击对象；对象项直接跳转，不在当前页展开重复定义。无法识别的空值规则保留原文，不推测其语义；多种规则的简要展示保留按分支查看的对应关系。
唯一源聚合与已展示公式完全相同时不重复展示；其他源聚合和定义条件可展开查看。定义条件仅在展示时按原文完全匹配去重，保留首次出现顺序，不改写 Catalog 快照或合并语义相似的条件。
补充属性保留源实体、解析与采样间隔等声明。Metric 的 `time_bindings` 显示显式字段、实体默认时间或无贡献时间及其来源；实体默认时间直接来自 Catalog，浏览器不自行推断。投影必须匹配对象身份和 Catalog fingerprint。

## 搜索缓存边界

Marivo 0.6 的公开搜索在 `.marivo/semantic/search/results/` 保存分页缓存，即使是空查询。
浏览不会读取业务数据、解析凭据或创建分析 Session，但不能再承诺 Workspace 零写入。
测试限制新增路径为此缓存目录，并逐项验证已有文件未修改；插件不访问私有索引或清理缓存。
