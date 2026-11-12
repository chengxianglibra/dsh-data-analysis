# 分析视图阅读器

## 责任与入口

本模块把已保存的分析文档（新保存为 `dsh.analysis-ui/v3`）呈现在原生右侧 Tab 中，并在真实 Turn 的 Chat 节点保留入口。
插件拥有 Catalog/Renderer、阅读状态、分析视图目录与版本历史视图；Marivo 拥有分析语义与来源事实，
Harness 拥有 Workspace、Session、右侧 tab 生命周期与交付。reader 消费已保存文档及交付链路提供的当前 Turn 草稿和候选，
不调用 Python、凭据、observe 或 revalidation，也不执行分析、查询或保存。

保存、receipt 与 RPC 见[展示交付](presentation-delivery.md)；快照与文档投影见[展示数据投影](presentation-projection.md)。
实现入口为 [AnalysisSurface](../../../packages/dsh-data-analysis/src/client/analysis-ui/surface.tsx)、
[组件库](../../../packages/dsh-data-analysis/src/client/analysis-ui/library.tsx)、
[数据视图](../../../packages/dsh-data-analysis/src/client/analysis-ui/data-view.tsx)和
[右侧 tab 接入](../../../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)。

## 分析视图位置与阅读状态

分析视图正文固定在右侧 Tab，首次候选、后续修订和正式保存复用稳定的 report view。前台会话首次出现可展示候选时自动打开并选中 Tab；关闭或切换 Tab 后，后续更新不重新打开或抢焦点。Chat 保留可手动打开的入口；历史回放和后台会话不自动导航。目录与历史入口始终导航到右侧，重复点击由原生资源地址去重。

可见的视图标题由 program 中的正文负责，AnalysisSurface 不再自动添加主标题。`AnalysisDocument.title` 继续用于目录、原生 Tab、离线 HTML 的页面标题及视图的无障碍名称；没有正文标题时不补写。TextContent 的 Markdown 保留作者声明的 h1–h6 层级。生成动效独立显示，保存后不保留空标题行；右侧视图操作与正文首行并排，首个内容块为操作保留空间。

客户端 ReportViews 维护已准入文档和读者状态，Tabs 选择、表格排序/分页及表格横向滚动按稳定语句身份保留，包括生成期间的更新和保存。报告外层滚动由各自 Host 容器负责。新会话、Workspace 或连接 generation 不继承旧状态。Tab 的 Build 地址支持已保存内容重开；临时阅读状态不持久写入报告。

同一阅读实例中的交付回执只应用一次，Chat 重放旧回执不覆盖后续修订。Turn 结束后草稿失效；已有正式版本的报告恢复最后保存的 Build，未保存修订不再读取，Chat 保留草稿失效提示。


## 统一 AnalysisSurface 与候选预览

AnalysisSurface 使用固定 Catalog/Renderer 呈现 OpenUI Lang program；候选、草稿和保存结果
是准确调用及保存版本的薄适配器。候选与已保存文档共用 Renderer；Native 前缀通过 isStreaming 解析，不完整资源显示占位。
基版本经现有 RPC 核验后可读；生成期 patch 前缀只合并为候选；完整校验成功后才更新草稿或保存，失败保持旧成功版本。
候选保留 Tabs、展开、已准入快照表格的排序/分页与本地图表浏览；不调用业务读取、源码读取、语义导航、提问、导出、刷新或保存。
TextContent 的 Markdown 链接在候选中仅显示标签，正式 reader 才提供导航，不使用整页 `inert` 阻止阅读。
Surface 接收文档及已保存资源读取回调，领域组件通过普通 React context 取资源，不访问 Store、RPC、MCP 或 URL。
阅读状态属于所在视图。Stack、Card 和 TabItem 内容的具名子组件使用 statementId 及同名出现次数作为 React key；同层增删和重排不改变保留组件的身份，inline 节点仍按位置识别。改变组件类型或跨父容器移动允许重挂。

右侧 Tab 的报告候选和草稿使用同一 Renderer 和 Session/Turn 草稿状态。Native program 前缀在生成期间基于上一成功草稿合并为临时候选；工具执行期 Host 可逐项交付新资源，引用和组件配置匹配后立即在原位置显示，未就绪的资源局部等待。候选与已校验修订分开；成功修订在同一视图更新，失败或取消保留最后成功内容。报告顶部的轻量折线动效表示生成，已准入草稿的端点缓慢呼吸；资源和修订更新不触发整份报告淡入。正式保存后指示器消失，在当前阅读位置原位切换到 reader。普通生成和草稿状态不显示文字横幅；状态名称保留给辅助技术，真实失败仍有明确错误提示。遵循 prefers-reduced-motion，折线静态显示且禁用内容过渡。历史、导出和「就此提问」使用正式版本的固定 Build。

`resourcePatch` 区分 omitted、incomplete、complete：完整调用省略时继承基版本；完整 patch 按 put/remove 增量合并，保留未提及资源，替换项仅接入声明匹配的 Host 准入资源。
已有草稿的参数范围尚未确定时保留当前基版本，不再扫描资源配置依赖图；patch 明确后将已有定义和新语句依次交给 OpenUI streaming parser。适配层规范化分号/换行边界；program 字段仍在接收时只追加已由边界结束的语句，避免 `root = Sta` 一类尚未形成调用的前缀覆盖已有树。字段完整后交给上游解析其余语句，未闭合替换保留原定义。初次生成无基版本时允许部分文字和有效兄弟先出现。
Frame/Dataset/Image 的替换资源或配置未就绪时保留该组件上次可读的准确快照与配置，不把旧数据套入新配置，也不切成“待验证”横幅；新组件没有可读内容时才显示局部骨架。显式资源删除不恢复缓存，语句删除由 OpenUI 的树更新移除组件。缓存只属于当前阅读状态，不跨 Workspace/连接归属继承。
原始前缀仍标识未闭合的具名数据配置；未闭合 inline 资源调用在 autoClose 前暂隐，防止把半个 ref/view/display 误作最终值。显式无效配置不回退 auto，合法省略 view 的默认行为保留；候选局部配置暂不可用时沿用已有显示，正式 reader 仍明确报告资源或配置错误。Host 的完整程序、来源、视图及预算校验不变。

preview/save 回执触发文档读取时，已显示内容持续挂载，直到新文档读取成功才替换；读取失败保留内容并显示读取错误。正常 Turn 结束停止生成提示，不等同于保存失败。实际调用失败显示更新失败提示并保留此前成功草稿；尚无成功草稿时保留已显示的临时候选，但不声明其已保存。保存后的动作仅绑定已经读到的正式 Build。

## 组件与数据视图

对外组件为 AnalysisFrameView、DatasetView、SnapshotFilter、Stack、TextContent、Card、Tabs、TabItem、Image、DashboardGrid、DashboardGridItem、TextCallout、Accordion、AccordionItem。
[Catalog 生成器](../../../packages/dsh-data-analysis/scripts/generate-analysis-catalog.mjs)从组件库生成本地 TypeScript Catalog，并校验 Git 中的随包 Skill 签名。
OpenUI Lang / Renderer 负责分析视图编排；私有 Stack / Card / Tabs、主题、控件和共用结果外壳见[插件私有 UI 组件](custom-ui-components.md)。
DashboardGrid 使用 1–4 列和显式 item 跨列，按容器宽度缩减列数并保持内容顺序；span 不得超过声明列数。TextCallout 展示作者声明的静态提示；Accordion 每组单项展开且可全部折叠，展开选择属于当前阅读状态，具名组件按语句与出现次序识别，inline 组件按位置识别。DashboardGridItem 和 AccordionItem 只用于各自父组件的槽位。
AnalysisFrameView 和 DatasetView 内的普通图表统一使用 Recharts，配合 shadcn Chart 容器、主题与提示；领域视图组合相同组件和局部领域标记。
图表不使用 OpenUI 官方图表组件，也不保留旧通用 SVG 绘图引擎、兼容分支或按期间数、series 数、数值类型切换的路径。

- DatasetView 支持 auto/table/metric/line/area/bar/heatmap，与 Frame 共用结果卡片、图表样式和数据操作布局，
  复用 DatasetTable 的精确格式化、类型感知排序及本地分页，并提供选列与来源/范围详情。
  未配置格式时 int64、Decimal 与 null 保持精确显示。metric 要求完整单行；
  Dataset 的 auto 要求完整单行单列才显示 metric，其余按表格显示；Frame 的 auto 由下述结构与语义规则决定。
- Dataset 图表由 [dataset-view.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/dataset-view.ts) 校验列映射：
  line/area/bar 必填 `encoding: {axis, values, series?}`，heatmap 必填 `{x, y, value}`，名称均为保存列 ID。
  数值列必须为 float64/int64/decimal 且可转换为有限绘图坐标，快照必须完整；axis/series 或 x/y 组合须唯一，重复时明确失败，聚合由原分析负责。
  axis 成员按保存行首次出现顺序排列，日期也仅作为已保存的离散点，不推断期间、缺期、时区或分析语义。
  `encoding.series` 不限制类别数，`encoding.values` 可引用最多 64 列；数据和文档仍受快照预算限制。
  heatmap 展开网格最多 100,000 格；对应预算超限在保存时拒绝。展开后的系列仍全部呈现，不因色板长度静默截断数据。
  默认 auto/table/metric 判定不变。metric 与图表提供数据图标和详细表格弹窗，支持排序、分页和精确值读取；
  table 直接使用当前表格，不重复显示数据图标。
- Dataset 的 `display` 支持 `height`、`title`、`subtitle` 和 `formats`。格式目标是已保存的数值列 ID，重复、未知或非数值列在保存时拒绝；`percent` 将保存比例乘以 100，`currency` 使用保存单位。主表、指标卡及图形应用格式，详细数据保留精确值；排序、筛选和点选使用保存值。未配置时沿用原有标题与精确显示。
- Frame 与 Dataset 的适配层分别生成轻量 `ChartModel`；[共享图表](../../../packages/dsh-data-analysis/src/client/analysis-ui/charts/observation.tsx)
  只消费绘图模型，共用主题、图例、tooltip、缺失值路径和局部滚动。Frame 保留期间状态、广播参考线及既有领域交互。密集折线/面积保留全部路径点，省略逐点静态 DOM 时通过活动点与 Frame 键盘导航器读取和选择原始行字段；Dataset 继续提供精确数据入口。
  Frame 图表和提示使用可读数值格式，详细数据按默认字段语义呈现；Dataset 默认保留精确显示，作者指定格式时主视图按声明显示，详细数据仍保留精确值。int64/decimal 绘图位置可近似，引用仍使用保存值。
  共享图表与领域图表的悬停数据使用单一提示，时间游标只标记位置。日历轴按已知内置粒度呈现刻度和悬停标签，保留必要的期间范围说明；
  Dataset 的时间坐标省略小数秒末尾的零。图表摘要仍可由辅助技术读取，数据表与数据引用保留原始坐标。
- v2 Frame 由 [frame-view.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/frame-view.ts) 的
  `resolveFrameView` 先确定性分类（成员、分解、比较、对齐、相关、观察）与形状，再选择主视图；保存时校验与渲染使用同一函数。
  显式图表使用快照中的公开轴名和值名。table 的 `columns` 和显式 metric 的 `encoding.value` 使用保存列 ID。
  精确名称及配置失败回执见[展示投影](presentation-projection.md#首次结果元数据)。
  单行多组比较（单一比较、最多 8 个指标）默认按指标渲染本期/基期/Δ/Δ% 的头部数字块，更长或含多个比较时回退为指标 × 本期/基期/Δ/Δ% 转置表；带 `columns` 的显式 table 显示选定列。省略 `columns` 时，仅对存在比较目标的完整单行比较使用转置表。
  折线与面积图要求时间轴；柱图可用时间轴或普通类别轴，类别轴按保存行首次出现的顺序等距排布，不推断连续性。
  热力图以两个轴的完整原始键标识单元格；多个已保存行映射到同一单元格时，自动视图回退到表格，显式热力图返回目标不明确错误，不聚合或覆盖行。
- Frame 外壳在 [frame/](../../../packages/dsh-data-analysis/src/client/analysis-ui/frame/) 下：值名、上下文摘要、
  头部数字、主视图与图标行（数据、覆盖、期间对应、语义来源、Python）。普通折线、面积、柱图、横向柱图及热力图复用共享图表；
  比较、分解、对齐、相关和占比等领域视图使用 Recharts 坐标/图形与有限自定义 marks，按解析结果绘图或显示表格；显式 pie 使用完整的单分类轴快照，要求值非负且总量可确定；
  标题行显示至多一项时间上下文，作者提供的 `display.subtitle` 单独显示；受限范围、捕获范围与筛选匹配以短标签显示，完整状态保留给辅助技术。NA、缺期、不完整期、presence、restricted 与未捕获完整采用视觉编码及必要的短状态标签；
  不增加复述图种或数值的说明段落，compact 也不能隐藏影响解读的限制。
  数据图标与来源、Python 共用操作行及弹窗，展示已保存的详细数据；成员视图以紧凑标签预览完整、非空的单键成员，完整保存成员可从数据入口查看，复合键及空或截断结果直接显示表格。
  Frame 与 Dataset 的元信息入口统一为组件左下角的小图标，内容与图标行之间不加分隔线；
  完整与 compact 视图均保留本地化悬停提示和无障碍名称，不显示操作名称。
  显式指定 `display.dataTable: "visible"` 时详细数据默认内联展示，并可用同一图标收起；数据引用不显示行数和横向滚动图标，截断与空数据状态仍可见。
  比较结果按指标展示本期、基期及已有差值，而非平铺原始字段。
  单行比较按本期、基期、已保存的绝对差值和相对变化组织，单位与数字分开；多指标数字块等宽对齐，末行不拉伸。
  KPI 的变化率与差值使用本地化文字标签，增减方向保留三角标记，正值为红色、负值为绿色；零值与缺失值保持区分。
  已知非零但按两位小数会舍入为零的百分比显示为小于 0.01% 的范围；Decimal 的精确非零符号不因浮点下溢丢失。
  分类比较使用按数据范围定位零点的横向差值条，并同行显示基期、本期、差值与相对变化；列标题提供排序，初始按已保存差值的绝对幅度降序排列。
  缺少可绘制差值时仍显示保存的两端和缺失状态，不推算差值；显式 `style: "delta"` 仍要求差值字段。
  差值和变化率来自已保存字段，不从显示时舍入的值重算；缺席侧与缺失值不视为零。
  比较端点优先采用 `display.comparisonLabels` 显式声明的成对标签：提供 `alias` 时唯一匹配具名比较，省略 `alias` 时唯一匹配匿名比较；`reference` 字段前缀不代表匿名比较的具名 alias。未声明标签时使用完整捕获且可对应的期间或固定成员，
  缺少任一端时成对回退为本期与基期。比较数字块和转置表仅在有具体端点时显示端点标题；多个基期的选择器仍使用可区分的已保存别名。
  窄容器中的图表及比较表在局部横向滚动，滚动区域可通过键盘访问；行式图在右滚时保留可见的行标签轨道。
  Dataset 表格及两类组件的图表不显示横向滚动符号或提示文案，溢出时仍保留辅助技术可读的滚动说明。
  期间对应展示捕获的两端标签；日历期间仅在已捕获 step 1 的内置 month/year 粒度且 civil label 是合法期初日期时缩写为 `YYYY-MM`/`YYYY`，其他已保存 label 原样保留。历史记录缺少 label 但有 nominalStart 时按已知粒度格式化，粒度未知则保留 nominalStart；当前记录没有此边界时不推断。选择状态和 cutoff 沿用已保存事实，interval 显示保存的范围。
  热力图标明已绘制值的色阶范围；时间图按声明的单位分面，未知单位按字段分面；多指标类别图可切换指标并保留对应参考线，类别柱图以 NA 标记已保存的空数值，零值保持区分。
  paired-time alignment 按其他轴的原始键分面，同一完整坐标无法唯一定位时回退详细表；缺席侧不显示保存单元格中的值，不同量级可使用标明独立尺度的分面。
  热力图时间轴使用唯一匹配的已捕获期间标签及完整性状态。缺失或歧义时使用保存成员的显示值，已声明的时、分、秒粒度用于格式化时间；分组和选点始终使用原始键。
  变化分解在捕获贡献及两期端点时按已保存贡献的绝对幅度排列明细行，并列展示端点、贡献和已有贡献占比；贡献及占比使用本地化语义标题，窄容器中的金额保持单行并在需要时局部滚动。仅在分解身份、范围及已保存总量均可唯一对应时展示总体变化率。其余分解继续使用对应图形或表格。
  restricted 范围在完整和 compact 视图均明确提示，不能把父总计理解为所示明细的合计。
  占比的语义元数据确认单一分类轴构成完整整体、保存份额可构成全体且分类不超过八项时，以堆叠条及明细展示；其余情况保留原占比视图。
  报告可显式为符合 pie 完整性条件的分类值选择 `style: "stacked"`；其占比标识为基于所示值的计算结果，选点仍绑定保存值。
  Frame 的可选 display 可声明标题、字段格式、比较端点名称、柱图的原始轴键高亮、分类条或普通表格预览行数、记录坐标预览，以及归因的两期 level-total 字段；保存时按所引用的 Frame 校验。`rowLimit` 用于横向分类条和普通表格，不用于转置比较表或其他图形；表格先应用筛选再按保存顺序预览，数据入口显示筛选范围内全部已捕获行，清除筛选后可查看全部已捕获行。`rowLimit` 与 `recordPreview` 不能同时指定，记录预览使用其自身的 `limit`。`display.formats` 用于主视图，详细数据采用默认格式，引用保留保存值。
  单位与展示格式由 Harness 基于 Marivo 分析结果决定，插件不额外校验格式与单位是否匹配。浏览器能表达的 currency 使用本地化货币格式；其他单位（如 `USD/mile`）按指定小数位显示数值并保留原单位，不改写保存值或单位。
- 每组 Tabs 的 TabItem.value 必须唯一，Host 在保存前拒绝重复值；不同组可以复用相同值。
  候选仅接入真实 TabItem 节点、非空 value/trigger 和已形成的 content 数组；错误 slot 类型及重复 value 局部忽略，保留稳定 value 的当前有效选择。
  方向键、Home/End 只移动焦点，Enter/Space 激活；tab/panel 通过稳定 ID 关联，隐藏 panel 不可聚焦。
- 图片只显示已保存的 image 资源；TextContent 不加载远程图片。

已保存 Dataset 和 Frame 的可唯一定位图点、KPI 数字及支持的单元格可通过鼠标或键盘选择；选择后在选点右上方显示带 DSH 图标的“就此提问”操作，空间不足时允许避让。结果组件右上角的 DSH 图标直接引用整个组件，不再提供数据复制按钮。成功时引用追加到所属 Harness 会话的提问草稿，关闭相关浮层并把焦点交回输入框；失败时保留操作并提示，用户已切换焦点或会话时不抢焦点。比较结果的本期、基期、差值和变化率各自引用对应的已保存字段；空值、缺席侧及不能唯一绑定的值不可选。
按 Escape 关闭选点操作时焦点返回原选点；若用户随即重新打开操作，旧的延迟焦点恢复不会关闭新操作。
Frame 点引用绑定固定 Build、资源、行和字段；发送时由服务端重新读取并校验，缺席侧、无法唯一定位的字段及父组总计不能作为明细点引用。
发送给模型的上下文包含快照保存的 Marivo Session ID 和可空 Artifact ID，并区分 Harness Session。持久 Frame 可在原 Runtime 和项目及 Artifact 仍可用时通过 Marivo 公开 API 尝试恢复；内存 Frame 没有 Artifact ID，不能据此跨进程恢复原 Frame。快照数据仍是捕获时的结果，不代表实时查询或恢复成功。
复制、表格等直观操作使用带键盘焦点提示和本地化无障碍名称的图标；数据范围不完整及期间未捕获仍有明确状态。
Dataset 点引用绑定当前 Session、Workspace、固定 Build、资源、原始行和字段，独立于 Frame 的选点协议；准备和发送时由服务端读取保存快照并校验身份与内容摘要，发送所选精确值及有界同行上下文（最多 4,000 UTF-8 bytes，不根据列类型猜测哪些列是坐标）并标明省略，不执行新查询。

组件引用绑定相同会话与固定 Build，并校验保存 program 中匹配的组件类型、资源和原始视图配置；发送准确 saved ref、资源名、匹配的组件配置与保存的 Marivo resultRef，不展开数据行、完整报告 program 或语义元数据。同一配置可在多个位置复用，引用不声称唯一页面位置。持久资源直接携带原声明的 `marivo.frame_ref/v2` 或 `marivo.dataframe_ref/v2`，Agent 通过绑定 Runtime/project 的 Marivo 公开 API 读取并核验准确固定结果；`marivo_report_read` 继续只读取报告组织、声明和结构。旧快照没有完整结果引用时明确返回 resultRef=null，不拼造引用或自动重新分析。数据点同时携带可用的 resultRef。

候选预览不提供入口；输入不可用时插入失败并显示状态。reader 不提供跨资源筛选、动态指标、页面内编辑或撤销/重做；已保存版本可在报告 tab 中导出离线 HTML，见[导出契约](report-publishing.md)。

引用提交采用 `<marivo-selection>` 包裹的 `dsh-data-analysis-selection/v2` JSON，标签与输入框共用生成规则，数据内容中的分隔字符经 Unicode escape。插件使用 Harness 的 `uiConversation.userText` rule 和 `conversation.user.text.node` renderer 将发送回显、正式消息、队列和历史重载中的合法引用显示为同一标签 chip；模型收到原始引用 JSON。未闭合、无效或未知版本保留原文，普通消息不受影响。此规则只负责展示，不执行数据读取或赋予引用访问权限。

展示层直接读取 Frame 已有列中的指标、总计和差值。饼图按完整快照中各类别的保存值分配扇区，并在图例显示各扇区占圆的百分比。会被读成全体的视图在未捕获完整的快照上回退为表格或在保存时拒绝。

### 固定快照筛选

`SnapshotFilter` 以保存原值提供单选或多选，同一控件内为 OR、视图绑定的多个控件之间为 AND。只有同资源的普通 Dataset 表格、line/area/bar 和 Frame observation 表格及普通图表支持绑定；auto 在原始快照上解析。未绑定的视图、静态正文和 KPI 保持原值，筛选不发起 Host 请求或重新计算。表格、图表和数据详情消费相同原始行索引；排序、分页和点引用保留保存行身份，图表保留系列顺序与缺口。改变筛选条件时表格回到第一页，零匹配期间也保留有效排序。

筛选状态归属阅读实例和固定 Build：同一实例在生成和保存期间保留；独立重开、切换 Build 或离线打开从各自默认值开始。候选及草稿控件禁用，仅显示默认投影。候选替换未就绪时，已可读的组件保留上次的快照、视图和筛选投影，首次加载的组件显示局部等待。本地选择不写入历史或导出文件。

## 来源与范围详情

DataFrame 的“数据来源与范围”入口集中展示捕获时间，以及绑定 codeRef 可读时的执行 datasource 声明、backend 和 Python 源码；
Session、Call 和 codeRef 放在可展开的开发者区域。旧执行记录或未声明数据源时明示不可用，源码缺失、读取失败或摘要不一致时显示状态。Frame 不显示 Evidence、Finding 或计算过程；
来源固定为 Host 绑定的 codeRef：新 Frame/DataFrame 声明中的 codeRef 必须通过 Host 执行记录的结果引用登记校验；旧快照沿用原 provenance。来源详情经 `code/read` RPC 读取已保存脚本，只允许读取所读文档资源绑定的 codeRef。未提供 codeRef 的资源明确显示源码不可用，不从 Marivo Artifact 身份推断脚本。
sha256 标识完整 execution record，由 Host 校验记录，客户端核对返回摘要与绑定摘要。Frame 的摘要不一致或执行记录缺失时 Python 图标变灰；section 为 `unavailable`
时对应图标变灰，不显示为 0 项；图标可打开详情，说明已知原因及后续动作。在阅读界面中，Session/Artifact 只在 Frame Python 详情的开发者区出现。

语义来源为分析时的静态身份，展示去重后的具体对象，不展示 datasource 和 entity；在已保存结果的会话节点和报告 tab 中可经现有[语义浏览器](semantic-browser.md)打开当前定义，
并提示其可能已变化；候选预览不提供导航。

## 分析视图目录、版本历史与旧格式

分析视图目录按 Workspace 列出新格式记录，支持标题搜索，统一显示所有保存结果，不按 surface 分类。
报告地址为 `dsh-resource://marivo-report/<workspace>/<report>/current` 或 `.../build/<build>`；
打开时在右侧 tab 中显示对应版本；右上角的「分析视图操作」菜单提供数据更新、历史版本、HTML 导出和删除入口。版本历史列出同一报告的不可变 Build，展示发布时间、标题、来源会话、当前版本与正在查看的版本，可切换到历史版本或回到 current，也可关闭历史区域。
Host 内入口要求已有 Session，只访问该 Session 所属 Workspace，不隐式创建 Session。

「更新数据」只从已保存且仍为 current 的 Build 发起。插件通过 Host 按 Session、Workspace 和 Build 核验目标，取得准确 saved ref，再向所属 Harness Session 发送更新全部现有数据资源的请求；已有输入草稿和附件不受影响。连接、会话或 Workspace 不可用、会话忙碌，以及所看版本不再是 current 时不发送，并显示状态。发送被接纳只表示请求已提交；Agent 按既有 `refresh-data` 流程审阅来源、重算和保存，具体结果在会话中反馈。请求要求版本变化时停止，保存时仍依赖现有冲突检查；固定 Build 不会因新版本发布自动替换。候选预览和离线 HTML 不提供该操作。插件卸载后，尚未提交的请求失效，迟到的 Host 校验结果不会触发发送。

删除操作在确认后删除整个已保存分析视图及其历史；服务端核验 Workspace 和当前版本，冲突时不删除。删除后目录不再列出该视图，旧入口重新读取时不可用；不删除 Marivo 结果、数据源或已导出的 HTML。文件清理未完成时明确提示，不把视图已移除等同于文件已全部清除。连接或 Workspace 绑定在请求期间变化时，迟到响应不改变新绑定的阅读状态，结果按未确认处理。删除契约见[展示交付](presentation-delivery.md)。

Reader 接受 current v4 历史指针、受支持的文档和快照格式。读取时保留保存的 Catalog build 作为来源信息，不要求它与当前 build 相同；仍检查 Catalog ID、文档身份、资源和当前 Catalog 的程序与视图契约。当前 reader 无法支持的内容明确报错，不静默丢弃。通过校验表示当前 reader 可以呈现，不保证旧版组件的默认值或渲染语义与保存时完全一致。基于旧文档保存的新版本使用当前 Catalog，旧 Build 文件不改写。

current v2/v3 指针、Frame v1 和不受支持的旧报告格式仍被拒绝；文件保留但不可继续读取或更新。目录将不可读指针计入 unavailable，不猜测缺失的发布时间、Session 或 surface；可读指针对应的文档仍可能在打开时发现不兼容。需要相同内容时，从实际结果重新 `marivo_report_write` 新格式。

## 界面语言与报告语言

插件操作界面通过 Harness 的 `ctx.locale` 跟随系统语言，按功能注册类型化中英文词典。页面订阅语言 revision，
仅重新渲染文案，不重建凭证、语义或报告模型；操作提示保留稳定标识和安全参数，在展示时翻译。

分析文档的 `locale`（`zh-CN` 或 `en-US`）决定 Surface 内容、辅助说明和日期／数字格式；Host 控件使用系统语言。
业务正文、字段标识、单位、精确数值和原始语义事实不由插件翻译。

Surface 通过 Harness 的 `--dsw-*` token 继承背景、文字和边框；图表色板、网格、图例和标签遵循[数据视图统一规格](data-view-spec.md)，
色板通过 CSS 变量跟随 Host 已解析的明暗主题，脱离 Host 时回退到独立页面的显式主题或系统偏好。
Frame 提示按保存值格式化，Dataset 提示保留精确值；图形坐标的近似值不代替保存值。主题切换不重挂 Frame 或 Dataset 图表。

## 验证边界

聚焦测试覆盖 Catalog 准入、数据视图的精确值与 metric/auto 判定、Frame 分类与视图解析、真实 Marivo Frame 渲染、目录过滤及旧格式拒绝；运行所属测试与 `npm run check`。
真实浏览器验证记录在本地 `docs/testing/validation.md`；reader 验证不代替 Tool、receipt/RPC 或真实 Agent 自动路由验收。
