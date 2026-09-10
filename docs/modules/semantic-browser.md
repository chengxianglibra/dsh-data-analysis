# 只读语义层对象浏览器

## 使用方式

在 DSH 会话标题旁点击“语义层”，打开原生右侧 Tab，仅展示该会话所属 Workspace，不提供 Workspace 筛选项。
切换会话保留各 Tab 的状态，Workspace 绑定撤销后使旧页失效。入口随 Harness 的会话标题显示，无会话或空会话时不显示，侧栏底部不保留入口。
浏览器不要求 live Agent，不自动创建会话。标题右侧显示最近更新时间，页面不展示项目路径和 Catalog fingerprint。

报告来源中的语义引用打开独立资源 Tab，按报告所属 Workspace 和完整 `kind + path` 定位；页内对象、定义链接与关系图跳转使用当前 Catalog 快照并保留浏览历史；仅显式“在独立标签页打开”创建资源 Tab。
首次打开重新读取 Catalog，展示当前定义及快照边界提示；原报告保留阅读状态。语义浏览统一使用原生 Tab，不再注册语义弹窗。
入口适用于全部语义对象类型，包括 `entity`；没有指标或维度类型白名单。
对象已不存在时保留目标引用并明确提示，包括当前 Catalog 为空的情况。

对象类型导航的“全部对象”及各类型数量按当前业务域统计；选择类型或输入搜索词不改变分类计数，当前业务域下没有对象的类型显示 0。

对象分类横铺于 Tab 顶部，业务域筛选与类型数量始终可见；桌面下方提供对象列表和详情两栏，窄栏通过“返回列表”切换。可以组合业务域与类型筛选，并搜索名称、
规范引用和完整业务定义。列表每页 40 个对象，详情不沿用输入框候选的 240 字符摘要上限。

详情包含：

- **概览**：业务定义、所属域、核心属性和使用约束；所属业务域、实体和数据源引用可直接跳转。
- **定义**：按对象类型展示的公共属性、Python 符号和定义位置。属性中的对象引用按 Catalog 为该字段声明的完整 Ref 渲染为链接，保留列表、映射和重复引用；目录缺失对象时禁用并明确提示，不按普通文字猜测链接。累计公式中的语义日历也支持直接跳转。
- **关系**：公共字段对应的对象关联、点击跳转和返回；支持一跳关系图、逐层展开、缩放、平移、键盘跳转。

关系图最多显示 60 个节点，达到上限时明确提示；关系列表保留完整关联。图上的箭头按公共字段的引用方向显示，
同一对对象的多个关系合并绘制，标签的 `+N` 表示还有其他关系，可通过悬停或图中关系列表查看。
这是对象声明关系，不是某次查询的执行血缘；候选维度不代表任意查询组合已通过验证。

覆盖 Marivo 0.5.4 的 13 种对象：业务域、数据源、实体、维度、度量、时间维度、指标、关系、事件、状态模型、
周期日历、时间集合和工作日程。未填写的定义有明确提示，不猜测口径。数据源只展示引擎类型和通用对象信息；
实体展示来源类型、表身份与版本属性。文件或远程来源地址、请求参数、连接配置、凭证值和原始源码不投影到页面。

## 所有权与读取边界

DSH 的 `conversation.session.header.actions`、`sidebarRightTabs` 与正文 slot 提供入口和容器，入口使用所属会话的
`workspaceId`，`workspaceRegistry` 提供项目身份。
插件提供界面、受控读取和展示投影；Marivo Catalog 拥有对象内容与关系语义。

现有语义引用 transport 在 Harness `/api` 下注册 `/api/dsh-data-analysis/semantic-browser/catalog` 精确认证路由，请求仅接受
`{ workspaceId }`。Host 从注册表解析路径，保留 `config.projectRoot`、`DSH_DATA_ANALYSIS_PROJECT_ROOT` 的显式覆盖，
然后使用 Workspace 路径。读取使用实际绑定路径，不接受浏览器传入任意目录。

每次加载在一次 checked Python 调用内执行 `ms.load(workspace_dir=...)`，使用 `catalog.items(kind)`、
`entry.details()` 和公开 Ref 序列化。返回 Workspace identity、Environment fingerprint、Catalog definition
fingerprint、加载时间、对象摘要、白名单详情字段和关联引用。全部视图使用同一快照。

不调用 `observe`、preview、readiness、连接测试、凭证解析或分析 Session 创建。禁用本次读取的 Marivo telemetry
及 Python 字节码写入；不额外读取源码。模型本身仍由 Marivo 按其 Python 加载契约处理。

单次 Catalog 调用限时 30 秒，stdout 上限 32 MiB、stderr 上限 8 KiB。超过上限明确失败，不发布残缺目录。
模型加载期间的普通打印直接丢弃，不累计到无界内存缓冲。浏览器错误仅包含固定诊断，不回传 Python traceback。

## 加入提问

列表详情和独立对象 Tab 均提供“加入提问”。仅在页面所属 Workspace 与当前 Session 输入归属明确时可用；
页面没有可用的所属会话输入时，按钮禁用。操作使用浏览快照的 ref 和 Environment fingerprint，经显式 `prepare` 后在草稿末尾
插入一个与 `@` 相同的原生 chip，不复制完整定义、不自动发送，也不提前 serialize。引用协议见[语义输入模块](semantic-reference-input.md)。

准备期间禁止重复点击；完成后再次点击表示再次追加。页面关闭、导航、刷新或快照替换、Session 切换、Workspace 撤销与连接
重置均阻止迟到结果写入。命令进入提交、普通发送清空草稿或手动清空都会取消准备，新草稿不会接收迟到引用。
`plain` 与 `claimed` 状态均沿用原生引用插入能力；完成时重新读取最新草稿，通过 Host 的 detect 坐标和 `draftRev` 插入一次，沿用原生撤销。
失败保留页面、草稿、已有引用及附件并允许重试；常用计数失败不回滚成功插入。

## 状态与刷新

标题行右上角仅提供一个“刷新语义层”图标按钮，加载期间禁用。首次打开和手动刷新时读取 Catalog；搜索、筛选、详情及关系图操作只使用当前快照。没有后台轮询、文件监听
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

可通过 `DSH_DATA_ANALYSIS_TEST_PYTHON` 指定正式 Marivo 0.5.4 Python，通过 `DSH_DATA_ANALYSIS_BROWSER_OUTPUT`
指定截图及结果记录目录。浏览器工具默认查找可导入的 `playwright`，其 Chromium 必须已安装。

该夹具复用生产 Tab 正文与模型，模拟 Workspace transport；不等同于当前已安装 DSH Profile 的
端到端验收。详见[验收记录](../acceptance/semantic-browser.md)。
会话标题入口迁移与 Workspace 绑定验证见[入口验收](../acceptance/workspace-header-actions.md)。

## 指标计算口径

概览仅展示业务定义、关键属性和使用约束。Metric 定义页使用公共 `entry.details().definition.to_dict()` 展示计算口径；度量、维度和时间维度的定义页也使用同一接口。
计算卡直接展示 `sum`、`mean`、`last`、`percentile(q=…)`、`weighted_mean` 等函数名，不翻译为中文聚合名称。
计算卡支持聚合、加权平均、比率、线性组合、累计和表达式，保留重复线性项、过滤值类型、隐藏常量与不支持状态。
累计显示明确时间轴、起点、内置周期或语义日历层级；默认轴显示需要上下文，不从候选轴猜测。

定义页依次展示当前对象公式、引用对象定义、数据来源、补充属性和定义位置，全部直接展开。
引用定义按精确 Ref 去重后平铺，公式中的重复项和顺序原样保留；引用对象最多展示 40 个，超限明确提示点击对象继续查看。
不重复附加各引用对象的业务说明；其实际使用约束和声明的时间规则保留在对应对象下，支持点击跳转和返回。
补充属性省略空值、已由公式展示的计算字段和关系页中的引用列表；时间规则区分声明、覆盖和有效规则。页面不把 `verified` 解释为业务审批或数据可用性。
Marivo 0.5.4 的 `temporal.effective.status` 直接决定展示：`not_applicable` 且没有声明或覆盖时不显示时间折叠区；
`component_defined` 显示“由计算公式及组成对象确定”，组成对象的规则保留在下方引用定义中；
`resolved` 展示精确时间轴和 fold（包括 percentile 的 `q`）。插件不根据可加性或子对象规则推导统一 fold。
累计节点 `node.over` 的默认轴 `context_required` 仍单独提示需要上下文，与有效折叠规则的状态无关。
结构化定义必须匹配对象 Ref 和 Catalog fingerprint；插件只接受公开 payload 字段，不解析终端文本或私有 IR。
此次浏览并未执行 observe、认证日历、编译 SQL 或额外读取源码。


Ibis 叶子表达式使用 Marivo 公共 payload 的 `node.display.text` 直接展示为代码块，右上角提供复制图标，不在插件内遍历表达式树生成文字或代码。
代码区标注“规范化形式”，显示 `bindings` 中别名对应的 Ref，并按 `redacted_literals` 提示隐藏常量。
代码不是原始源码，也不是独立脚本；缺少展示文本时明确提示，不回退到插件自建的表达式翻译。
累计、聚合、比率等指标组合层保留口径说明及公式内的对象链接。

表达式文本是否可展示独立于结构化解析的 `status`；`.sum()`、`.count()` 等 Ibis 调用不要求先拆解为语义节点。
页面优先展示公共 `display`；仅在缺少显示文本时呈现不可用原因，统一标注为“Ibis 表达式”。
