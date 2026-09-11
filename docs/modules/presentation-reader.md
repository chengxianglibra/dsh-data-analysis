# 展示 reader 与离线构建

## 责任与入口

本模块将[展示数据投影](presentation-projection.md)返回的 `PresentationDocument` 变成可读内容。
插件拥有展示组件、阅读／编辑草稿状态和自包含 HTML；Marivo 继续拥有分析语义与来源事实，Harness 继续拥有 Workspace
和交付生命周期。reader 只读取文档快照，展开来源不调用 Python、凭据、observe 或 revalidation。

实现入口为 [共享 reader](../../packages/dsh-data-analysis/src/client/presentation/reader.tsx)、
[Host entry](../../packages/dsh-data-analysis/src/client/presentation/host-entry.tsx)、
[portable entry](../../packages/dsh-data-analysis/src/client/presentation/portable-entry.tsx)和
[内部 builder](../../packages/dsh-data-analysis/src/presentation/build/index.ts)。
`client` 导出 `HostPresentationReader`；[展示交付](presentation-delivery.md)已接通 `marivo_present`、receipt、RPC、原生 Tab 打开与下载；默认 client 的阅读与编辑都在原生 Tab 内，不挂载报告弹出页。

## 共同的数据解释

五类 block 使用同一份 typed dataset 和保存的来源：

| Block | 展示行为 |
| --- | --- |
| Markdown | 基础只读正文，支持常用标题、列表、引用、代码和行内格式；原始 HTML 作为文本，不执行脚本或加载远程图片 |
| metric | 通过 dataset、column、rowIndex 唯一定位单元格，保留精确值、单位和 null；不默认取首行或聚合 |
| chart | 18 类图形及 bar/line 变体只绘制已有数据；统计字段显式绑定，保留 null 与原始精确值；支持当前页面探索 |
| table | 类型感知排序、分页、列顺序、精确数字和精简行数与截断提示 |
| source | 正文以紧凑列表显示来源名称、已有语义对象及实际问题；技术名称或名称缺失时显示来源序号，unavailable 保留原因；时间与相关查询保留在 cell 菜单详情中，Artifact 身份仅保留在底层引用中 |

computed 来源表示作者声明，不能证明转换正确。int64/Decimal 的排序和表格显示不经浮点转换。
单位只使用文档已有字段，不猜测百分比、缩放倍数或业务口径。普通多系列图按单位分图；堆叠图与 heatmap 拒绝混合单位；
过长坐标标签缩略，刻度使用中文千分位与紧凑量级，极大或极小刻度使用科学计数法；完整值保留在 tooltip 和精确数据预览中。截断数据不派生全量 KPI、总计或排名。
普通阅读中的图形／字段切换、系列显隐、表格排序/分页、复制上下文和“加入提问”草稿填入是本地交互，不产生新分析。
编辑模式只保存明确提交的呈现字段；筛选永远是临时阅读状态。

## 正文与发布配置加载

报告 receipt、身份、摘要和文档校验完成后立即显示正文并结束阅读加载。发布配置使用独立、可取消的
请求；`publishingLoading` 期间仅禁用两个 HTML 导出／发布操作，菜单显示“正在读取发布配置…”。
配置失败只禁用这两个操作，不阻塞正文、编辑或历史浏览。关闭、刷新、切换报告、连接变化及保存新 Build
使旧请求失效；晚到结果必须通过当前 generation 检查。该路径不缓存报告，也不放宽文件校验。

## 图形与临时探索

图形合同见[chart 契约](../../packages/dsh-data-analysis/src/presentation/contracts/charts.ts)，
作者说明与完整样例见[图形配置](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/charts.md)。
bar 包括纵横、并列、堆叠和 100% 堆叠；line 固定 monotone，支持显式系列角色、实／虚／点线及数据点。
统计图的分箱边界、频数、五数摘要、占比、分母、排名、瀑布起止值均由分析阶段准备。
reader 只校验和绘制，不聚合、分箱、归一化、排序排名或重新累计。

普通阅读中，每个 chart 的“探索图表”面板只保留本次阅读状态；普通字段只在现有 dataset 中选择，
需要另一种统计结果时切换作者声明的 `preparedViews`。缺少所需字段的类型禁用并说明原因。
组合切换与显隐保持原始行身份和预计算比例分母；来源预览和复制上下文使用当前绑定及过滤状态，
并保留原始快照 identity。恢复原图、切换 build 或重新打开恢复作者配置。
“下载完整报告”提供当前显示构建的 HTML：新报告从已校验 JSON 按需生成，历史含 HTML 的构建下载已保存文件；该文件的打印及无脚本阅读使用已保存正文和精确数据表，不应用临时筛选或未保存草稿。
“导出当前视图”提供固定当前阅读结果的无脚本 HTML，行为见[当前视图导出](#当前视图导出)。

## 当前视图导出

Host 和完整离线 HTML 的报告标题右侧使用导出图标，菜单提供“下载完整报告”和“导出当前视图”。
完整报告下载保留正在查看的 Build；Host 继续核验 receipt 绑定的字节，历史版本不切换为最新版本。
离线完整报告下载保留已保存正文、内嵌文档及运行脚本，移除当前交互 DOM，重新打开恢复默认筛选。

当前视图导出在点击时同步冻结 Reader 的组合筛选、图表类型／字段／prepared view／系列显隐及表格排序。
图表保留已绘制的内联 SVG 和静态图例；表格保留显示列及列顺序，输出筛选后的全部已保存行，分页不限制导出范围。
int64、Decimal 与 null 使用共享精确值解释；已截断数据仍提示已保存行数与范围，不能补取全量数据。
固定正文、固定指标及其“不随筛选变化”提示继续保留，不根据筛选改写叙述或重算比例。

文件页首包含筛选条件、来源 Build 和带时区的导出时间，不创建新 Build 或更新 current。
仅保留当前呈现和各 cell 的必要来源概要，不内嵌完整 datasets、其他 slices、执行代码或原始来源 JSON。
来源概要沿用保存的语义引用、创建时间、不可用原因与实际问题；它不构成独立分析快照或新的有效性证明。
导出是阅读副本，不作为报告编辑／导入格式；固定区域按原报告保留，因此不是按业务线隔离数据的权限机制。

当前视图文件不包含脚本、编辑、筛选、来源跳转或导出控件，可断网、禁用脚本阅读。
SVG 固定导出时的绘图坐标与标签，窄屏在图内滚动；重新打开文件不会恢复全量或重新运行分析。
该操作由插件浏览器端完成，不调用 RPC、Python、查询或保存；编辑模式禁用并提示先保存或取消。
图表尚未完成排版、生成失败或超出既有 HTML 字节预算时明确报错，不下载不完整结果。
本功能不增加打印、PDF、CSV 或单图下载入口。

## 在线编辑与删除

Host 提供编辑、保存、取消和保存前的撤销／重做；独立草稿从已保存文档建立，普通探索不自动成为编辑内容。
支持报告标题、Markdown 正文、metric 标签、ChartExplorer 的图形／字段／系列／样式及 prepared view，
表格列选择与顺序（至少一列），全部 cell 的上移、下移和删除。按钮和表单支持键盘操作，继续使用自适应顺序排版。
source cell 只能移动或删除，引用和来源事实不可编辑。不新增 cell、任意布局或数据编辑。

删除立即更新草稿并可撤销；全部删空可保存，显示空报告提示，底层 datasets、sources、代码和 diagnostics 保留。
首次 Agent Draft 仍至少一个 block。保存成功清除编辑历史，失败保留草稿。
Tab occurrence 拥有草稿、撤销／重做和保存状态，切换 Tab、Session、浮动／停靠重挂载不丢失草稿；重复打开编辑中的
资源只聚焦并保留编辑。刷新或取消修改前确认放弃，关闭 Tab 直接丢弃草稿，不拦截 Harness 的原生关闭行为。

报告标题行右侧展示实际 `buildId` 的前八位，完整标识放在 tooltip；三点菜单集中刷新、编辑报告、历史版本、
下载完整报告和导出当前视图。编辑时直接显示保存、取消、撤销和重做，禁用历史切换、“加入提问”和当前视图导出。
历史列表选取当前版本导航到 current；固定 Build 若仍为当前版本也可原位编辑。进入编辑重新核验 current，保存沿用
`expectedBuildId` 并发检查。current Tab 保存后直接展示新 Build；固定地址 Tab 保存后通过 Harness 的公开
`replaceTab` 在原面板、原位置接续 current，避免旧 Build 地址展示新 Build。真正历史版本仍只读。
保存协议和并发边界见[展示交付](presentation-delivery.md#rpc编辑与当前指针)。portable 不包含编辑／宿主保存入口。

## 可选全局筛选与动态 KPI

Agent 按报告需要显式声明 `interaction`，不声明时不生成控件或区域。声明包含固定筛选字段、选项、连续的
`blockIds` 和全部预计算 `slices`；每个字段单选，`allOptionId` 指定“全部”，多个字段共同选中唯一组合。
作者契约及完整合成数据示例见[全局筛选与动态指标](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/interaction.md)。

每个 slice 覆盖区域内全部 metric/chart/table 及 chart 的所有 `preparedViews`，绑定各 dataset 的原始
`rowIndices`。动态 metric 使用 `rowSelection: "slice"`，与固定 `rowIndex` 互斥，每个组合必须唯一命中一行。
图表、表格可声明空结果；缺失组合、遗漏 dataset、重复或越界索引、KPI 非唯一行均明确报错。全量、比例、排名及
分母在分析阶段准备，reader 不聚合、归一化或重新累计。统计图按每个 slice 分别校验顺序与占比，不能把不同组合
拼成同一条序列；饼图在当前 slice 内安排角度，仍保留作者占比余量。

统一胶囊筛选栏位于交互区顶部，支持搜索、选中标记、键盘和重置。共同响应的组件与固定内容同宽平铺，不使用整体包框或背景。
两类内容交界处用细分隔线隔开，前后都有固定内容时分别显示，空区域不产生分隔线；移动端、静态 HTML 与打印采用相同布局。
固定内容保留提示；区外即使引用同一 dataset 也不受影响。字段名称和选项由 Agent 指定，reader 不推断字段或 dataset 关系。
ChartExplorer 不再包含局部行过滤；图形切换、系列显隐和表格排序分页保留。切换组合同步更新全区及来源数据预览，
重置分页；复制上下文附稳定的筛选 ID 与 option ID，Agent 从固定 Build 读取 slice、行索引与精确 KPI。

宿主编辑只允许区域内移动和删除，不开放筛选声明。共享逻辑按删除结果裁剪区域及 dataset 映射，删除最后一个目标时
移除声明；撤销和重做通过原文档恢复，服务端再次校验。普通筛选选择不标记 dirty，不进入保存请求或浏览器存储；
重新打开、切换报告/build/Workspace 后恢复全“全部”。保存的声明和所有 slices 包含在 HTML 中，临时选择不进入完整报告下载，可通过“导出当前视图”单独固定。
完整报告的打印与无脚本阅读只显示默认 slice 和区外正文，不混排所有组合。

## 通用阅读层级

正文按作者顺序排版；相邻 metric 合并为自适应指标行，连续 chart 合并为可换行的图表组。
两种分组都不跨越固定区与交互区边界，也不跨过 Markdown、table 或 source；不重排或改写正文。
Host 预览与导出 HTML 共用流式宽度：reader 占满可用容器，水平内边距为 `clamp(20px,4%,64px)`，
没有固定的桌面最大宽度。Host 的默认阅读容器是原生右侧 Tab，分栏、全屏与浮窗由 Harness 管理；
浏览器容器按 pane 宽度调整间距与字号，阅读和编辑状态由 Tab occurrence 保存。Host 内入口要求已有 Session，
只访问该 Session 所属 Workspace；不提供无 Session 弹窗或跨 Workspace 选择器，不隐式创建 Session。离线 HTML 不依赖 Host 容器。
Markdown、表格和筛选区跟随完整内容宽度。KPI 按可用空间自动换行，单卡宽度为 `240–480px`，
容器不足 `240px` 时收至容器宽度；少量卡片靠左排列，行尾留白，不无限拉伸。
交互图表每行最多两张，按内容容器宽度而非屏幕断点换行；普通图最小卡宽 `560px`，环形图 `720px`，
图间距 `32px`。默认等分行宽，一张图需要更宽空间时先换行，末尾单图铺满整行；
窄容器按原顺序单列。缩放仅由 CSS 排布，保持组件 identity 和筛选／探索状态。
完整报告的无脚本与打印 chart 是精确数据表，保持单列；该规则不增加作者可配置的网格或 schema 字段。
窄屏保留紧凑间距和局部滚动；打印移除屏幕留白及正文宽度限制，按纸张宽度排版。
指标增加千分位；`float64` 主值及比较值四舍五入后最多展示三位小数，不补尾零，`int64` 和 `decimal` 保留精确文本，不缩放或转为浮点数。主值 tooltip、数据表和原文档保留完整值。
生成时间以带 UTC 标识的可读日期展示，原时间戳保留在 `time.dateTime` 和文档中。

每个 cell 右上角提供三点菜单，Host 包含“加入提问 / Add to question”（随 DSH 界面语言显示），离线 HTML 包含“复制上下文”；
有数据或来源的 cell 同时提供“数据源”选项。“数据源”打开原生 modal，
按“概要 / 数据预览 / 相关查询”组织信息。概要仅呈现当前 cell 的指标、数据集、字段、报告生成时间、已有语义路径、
来源创建时间及实际问题；不会把生成时间当作查询执行时间。没有数据集的 source block 提供概要和相关查询。
相关查询 Tab 展示当前 dataset 关联的 Python 执行快照及所选来源保存的实际 SQL，自动整理换行与缩进并提供语法高亮；
格式化仅生成展示文本，文档快照及复制内容保持执行原文。Python 使用内嵌 Ruff formatter，SQL 使用通用 SQL formatter；
快照未声明 SQL dialect 时不猜测方言。语法或方言不支持、formatter 不可用时显示原文。
Python 关联由作者声明；界面仅显示语言标题、代码和复制操作。代码缺失和来源读取限制保留说明；不从当前定义或脚本文件重构历史代码。
概要不解析 SQL 来推断物理表、筛选值或历史定义。

Host 数据源概要中的公开语义引用可点击打开同一 Workspace 的语义层卡片，按 `kind + path` 精确定位。
所有语义对象类型均使用此导航，包括 `entity`、`measure`、`relationship` 等；分类中文名称复用语义层标签，
未知类型保留其 canonical kind 并照常定位，不以标签表限制导航。
只链接来源保存的有效引用，不根据指标显示名称或字段猜测映射。每次跳转读取当前 Catalog，清除语义层旧筛选、
定位目标所在分页；缺失对象或加载失败明确提示，不展示缓存定义作为本次结果。
语义层显示当前定义，报告保留生成时的数据与来源快照。原生阅读页中的语义引用打开独立 Tab，并关闭来源弹窗；
原报告保留筛选与探索状态；Session 归属变化或 Workspace 撤销后旧内容失效。该连接只调用 metadata Catalog，
不执行分析、查询、重建或保存。portable、打印及无脚本正文保留语义路径文本，不提供宿主跳转。

数据预览保留精确原值、列顺序、排序和分页；chart 预览限制为当前 x/y 及辅助 bindings 绑定列。
图表正文只保留图形、多系列显隐及必要的截断/近似状态，单系列不显示切换图例。
“继续分析”、独立复制图标与图表下方“查看数据”入口已移除。上下文只提供固定 Build/cell 定位与未保存的显示状态，
正文、绑定、精确值和来源均由 Agent 按引用读取；剪贴板失败提供临时手动复制弹窗。

`PresentationReader` 和 `HostPresentationReader` 接收可选 `onAskDsh(payload: PresentationContext): void`；
Host 注入时菜单显示“加入提问”，无回调时保持复制上下文。回调将显示名称 `label` 与完整上下文 `context` 分开；上下文复用 `followUpContext`，包含当前筛选、图表探索和表格排序状态。

上下文包含 `Workspace / Report ID / Build ID / Cell`，全部来自正在显示的 document。current 页面提示
新版本但尚未刷新时仍引用旧 Build，刷新后引用新 Build，固定 Build 始终保留自身身份。标题仅用于阅读，
不代替 Report ID；报告标题与已有 cell 标签各最多 80 个 Unicode 码点。引用包含所属 Workspace 下的
固定 Build `presentation.json` 相对路径，明确按 `blocks[].id` 定位。
身份字段中的 `Workspace`、`Cell`、`Prepared view` 使用 JSON 字符串编码，读取时先解码再精确匹配；
标题以 `Report title` 标记，避免合法 ID 中的换行或标题文本被误认成另一个定位字段。筛选仅携带受影响 cell 的有效
filter ID、option ID 与简短标签，不展开行号。图表默认配置不输出；prepared view 使用 ID，隐藏系列
使用列 ID，仅偏离 authored/prepared 配置时附一份完整当前 ChartView。表格附排序列和方向，覆盖全部筛选
结果而非当前页，不携带滚动、悬停或选区。离线复制使用相同格式，文件仍位于原 Workspace。

Cell 引用不制作内容摘要，不复制 Markdown、指标原值、列定义、来源或备选视图全集。单次追加 UTF-8 上限为
12 KiB，包含包装与分隔符；离线生成同样预留两个换行。定位或临时状态超限时明确失败，不截断有效状态。
点击时生成引用并捕获失败，避免整个 reader 渲染失败；失败不改草稿或剪贴板，恢复后可重试。
在线与离线编辑期间均禁止引用未保存内容。Agent 的固定 Build 读取与 current 更新规则见
[报告读取约定](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/schema.md#从报告-cell-引用继续)。

Host adapter 在点击时核验报告、当前 Session 与 Workspace，使用 Harness 公开的 `sessions.scope`、
`conversation.input.for` 及 `slash/input-insert-reference`，按最新 `draftRev` 和原子引用坐标追加引用。
输入框仅显示 `# <cell名称>`；名称使用 Cell 的 `label`，缺失或空白时回退到 Cell ID，空白归一化并限制为 80 个 Unicode 码点。
插件的 `marivo-report-cell` source 只提供 codec，不提供候选菜单或手动 `#` 搜索。Harness alpha 的通用 chip 默认 `@` 标记，
通过仅限该 source 的样式隐藏，显示名称自带 `#`；引用编辑、撤销、提交继续由 Harness 拥有。
撤销沿用原生分组，1 秒内连续插入的引用可能一起撤销，与 `@` 引用一致。
引用内部冻结点击时的完整上下文；提交时 codec 校验所属 Session/Workspace 与取消状态，再展开
“【报告上下文】／【报告上下文结束】”包装的内容。复制和纯文本草稿持久化同样保留完整上下文，避免丢失定位。
保留已有文字、语义引用和图片附件，点击不自动提交或序列化引用；对话框入口在写入成功后关闭报告并恢复焦点，
原生 Tab 保持打开，写入失败显示提示，成功重试后清除提示。
会话或 Workspace 失效、写入失败时保留报告并显示错误，不改投其他会话。编辑模式的“加入提问”保持可见与键盘可聚焦，
但禁用执行并提示“请先保存或取消编辑”。共享 reader 不访问 DSH 服务；打印、无脚本正文不提供此动作。

数据源卡片显示可读来源名称；名称缺失或包含 Artifact ID 时显示来源序号。卡片不展示 Artifact ID 及其详情折叠区，完整引用仍保留在报告数据中用于追溯和校验；来源创建时间、语义链接与实际问题继续展示。
字段以独立表格展示当前 cell 使用的字段 ID、显示名称、类型和单位；计算结果明确标注来源类型，不推断字段与上游指标的映射。
弹窗不展示自动生成的副标题、重复的数据预览标题或探索状态套话。已有名称末尾包含同一单位时，不重复追加单位。
投影不检查或生成指标历史定义快照缺失提示，也不保留旧版提示的兼容分支。
已在关联 cell 显示的截断、来源不可用状态不再重复放到页首。
其他诊断按 message 去重并保留原文，实际不可用原因和数据问题可以在数据源概要中查看。
菜单支持方向键、Escape 和外部点击；弹窗支持键盘 tab 切换、Escape 关闭及焦点返回触发按钮。

普通坐标图使用无外框的 320px 绘图区、极浅实线网格与自动宽度纵轴；sparkline 为 128px。
统计 SVG 观察父容器实际宽度并重算横向坐标，SVG 宽高与 `viewBox` 使用相同的 CSS 像素尺寸，
字号、行高和纵向布局不随宽屏放大。普通统计图最小宽度为 `520px`；环形图保留 `720px` 固有布局并整体居中，
半径和图例尺寸保持稳定。窄屏在图内横向滚动，环形图的右侧图例同样可以滚动到达。
瀑布图柱体最大宽度为 `48px`，连接线和标签跟随柱体；直方图继续按数值区间绘制 bin 宽度。
折线使用 monotone 插值；默认 `showPoints: auto` 只为单点和 null 两侧的孤立观测保留圆点，`always`/`never` 显式覆盖，null 之间不连线。
多系列图例位于图下。两个轴不显示额外轴线或短刻度线；横轴保留首尾刻度，原始分类文本在 tooltip 与数据预览中完整呈现。
柱状图通过零参考值参与自动 domain 与刻度计算，保证全负值及混合值均从零延伸；单柱最大宽 48px。
全部 18 类图形、绑定与适用配置由共享契约校验；环形图保留作者占比空位，箱线图完整绘制箱体、中位线及须线。

Markdown 支持基础标题、段落、行内格式、代码块、列表、引用和安全显式链接；不声明完整 CommonMark/GFM 兼容，
嵌套列表、Markdown 表格等扩展语法按基础文本保留。结构化表格使用 `table` block。

## 两个入口与构建产物

Host 与 portable 共用 `PresentationReader`、样式和数据模型。Host 外层接收调用方提供的动作；
portable 从内嵌 JSON 加载，包含自己的 React/Recharts，不依赖 DSH module loader。
已生成 HTML 内嵌当时的样式与脚本；更新插件不会修改历史文件，新 Build 的按需 HTML 使用当前 renderer；既有 HTML 文件保持原样。

`buildPresentation(document)` 校验并快照输入，显式导出时返回生成文档、JSON 字节和 HTML 字节；发布路径传入 `{ html: false }` 仅构建 JSON。
builder 不分配 Workspace/report/build identity，不登记文件、不创建目录、不生成 receipt；[展示交付](presentation-delivery.md)负责完整目录提交。
文档及 HTML 受 [展示字节预算](presentation-projection.md#预算与错误)约束，超限明确失败。

HTML 同时保存完整文档、共享 reader 生成的静态正文和交互脚本。静态模式保留必要数据行，
并用精确表格表达图形；不再在报告末尾自动追加整份报告的“数据来源”折叠区，显式 `source` cell 仍按草稿顺序展示。
仅在交互挂载成功后隐藏 fallback。无脚本、脚本失败和打印均能读取正文、指标、必要表格及显式来源 cell；打印隐藏操作控件。
交互模式仍通过各 cell 的数据源入口读取保存的来源与代码。完整报告的静态图形仍为精确数据表；当前视图导出单独保留浏览器已绘制的 SVG 及各 cell 的来源概要。
文本和内嵌 JSON 转义，CSP 禁止网络资源；文件不包含外部样式、字体、图片、模块加载或凭据依赖。
Python formatter 的 WASM 字节随 reader 内嵌，使用 `wasm-unsafe-eval` 允许本地格式化，不允许 JavaScript `eval`；
格式化与高亮均不执行来源代码。

[client 构建](../../packages/dsh-data-analysis/scripts/build-client.mjs)将 Recharts 等非 Host 依赖打包，
仅将 DSH 和 React/ReactDOM 外部化。输入白名单拒绝 Node、Runtime、projection 和 Host 凭据服务模块，且检查 Host bundle
没有第二份 React。portable 不允许任何外部模块。

[presentation 构建](../../packages/dsh-data-analysis/scripts/build-presentation.mjs)预构建 portable 资产和
包含依赖的 Node 静态 renderer；运行已安装的 builder 不需要 esbuild 或源码。分发资产保留实际打包依赖的许可证，
Analytics App Core 只作为设计参考，不复制其封装源码。

## 验证与交付边界

```sh
npm run test:presentation-reader
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-reader:real
```

聚焦测试检查数字/排序、静态与交互共用数据、安全转义、预算和构建边界；真实浏览器检查实际 Host reader 与
portable 的数值/来源一致性、局部交互、窄屏/键盘/主题、断网、无脚本和打印。
reader 的真实 Web 验证不代替 Tool、receipt/RPC 或真实 Agent 自动路由验收。

## KPI 比较卡片

现有 `metric` 可声明 `description` 和最多四条 `comparisons`，使用同一选中行的数值列展示参考值、
绝对变化及变化率；见 [KPI 编写契约](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/schema.md#kpi-比较卡片)。
Marivo／分析作者负责周期、分母、差值、百分比与好坏方向；插件验证引用并格式化，不计算同比／环比。
比较数据跟随 `rowSelection: "slice"`，复制引用定位对应 cell，由 Agent 读取比较列和原值；静态 HTML 保留全部比较。
`sentiment` 独立于涨跌符号，默认中性；数值不经过浮点转换，缺失和持平分别显示。
卡片按内容容器自适应，宽度上限为 `480px`，常规最小宽度为 `240px`；更窄时使用容器全宽。
主值保持一行，极长精确值可横向滚动。

设计参考：[Power BI reference labels](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-card)、
[Looker Studio scorecard](https://cloud.google.com/looker/docs/studio/scorecard-reference)。

验收：契约／reader 回归覆盖多基准、精确数值、方向、空值、非法引用与筛选同一行；生产 builder
生成的示例 HTML 已检查 1100px、390px 和禁用 JavaScript 阅读。示例采用截图数值，不代表重查业务
数据或真实 Agent 验收；未重装本地插件、重启 Harness 或改写已有报告。

## 界面语言与报告语言

插件操作界面通过 Harness 的 `ctx.locale` 跟随系统语言，按功能注册类型化中英文词典。页面订阅语言 revision，仅重新渲染文案，不重建凭证、语义或报告模型；操作提示保留稳定标识和安全参数，在展示时翻译。

报告 Draft v2 与 Document v3 必须填写 `locale`（`zh-CN` 或 `en-US`），由 DSH 根据用户问题和明确要求决定。Reader 的内容、辅助说明和日期／数字格式使用报告语言；Host 的编辑、导出等操作使用系统语言。业务正文、字段标识、单位、精确数值和原始语义事实不由插件翻译。打印、静态 fallback、完整报告及当前视图 HTML 保留报告语言与对应 `lang`。编辑保存保留 locale；旧格式或缺失语言明确拒绝并要求重新生成，不修改或删除历史 Build。
