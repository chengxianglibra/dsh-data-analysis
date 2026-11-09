# 分析文档 reader

## 责任与入口

本模块把已保存的分析文档（`dsh.analysis-ui/v1`）呈现在会话级 Chat 节点与原生右侧 tab 中。
插件拥有 Catalog/Renderer、阅读状态、报告目录与版本历史视图；Marivo 拥有分析语义与来源事实，
Harness 拥有 Workspace、Session、右侧 tab 生命周期与交付。reader 只读取保存的文档快照，
不调用 Python、凭据、observe 或 revalidation，也不执行分析、查询或保存。

保存、receipt 与 RPC 见[展示交付](presentation-delivery.md)；快照与文档投影见[展示数据投影](presentation-projection.md)。
实现入口为 [AnalysisSurface](../../../packages/dsh-data-analysis/src/client/analysis-ui/surface.tsx)、
[组件库](../../../packages/dsh-data-analysis/src/client/analysis-ui/library.tsx)、
[数据视图](../../../packages/dsh-data-analysis/src/client/analysis-ui/data-view.tsx)和
[右侧 tab 接入](../../../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)。

## 统一 AnalysisSurface 与候选预览

AnalysisSurface 使用固定 Catalog/Renderer 呈现 OpenUI Lang program；工具调用候选、默认结果的会话节点和报告 tab
是准确调用及保存版本的薄适配器。候选与已保存文档共用 Renderer；Native 前缀通过 isStreaming 解析，不完整资源显示占位。
基版本经现有 RPC 核验后可读；patch 完整前不合并，失败保持旧成功版本。候选不执行业务读取、动作或保存。
Surface 接收文档及已保存资源读取回调，领域组件通过普通 React context 取资源，不访问 Store、RPC、MCP 或 URL。
阅读状态属于所在视图，位置切换可以重挂。

报告草稿页使用同一 Renderer 读取已校验的临时文档和快照。新修订在同一页替换内容，已显示的快照在读取下一次修订期间保持可见。草稿标明尚未保存，正式版本成功保存后原位切换到报告 reader。历史、导出和「就此提问」使用正式版本的固定 Build。

## 组件与数据视图

对外仅八组件：AnalysisFrameView、DatasetView、Stack、TextContent、Card、Tabs、TabItem、Image；
[Catalog 生成器](../../../packages/dsh-data-analysis/scripts/generate-analysis-catalog.mjs)从组件库生成本地 TypeScript Catalog，并校验 Git 中的随包 Skill 签名。
OpenUI Lang / Renderer 负责报告编排；私有 Stack / Card / Tabs、主题、控件和共用结果外壳见[插件私有 UI 组件](custom-ui-components.md)。
AnalysisFrameView 和 DatasetView 内的普通图表统一使用 Recharts，配合 shadcn Chart 容器、主题与提示；领域视图组合相同组件和局部领域标记。
图表不使用 OpenUI 官方图表组件，也不保留旧通用 SVG 绘图引擎、兼容分支或按期间数、series 数、数值类型切换的路径。

- DatasetView 支持 auto/table/metric/line/area/bar/heatmap，与 Frame 共用结果卡片、图表样式和数据操作布局，
  复用 DatasetTable 的精确格式化、类型感知排序及本地分页，并提供选列与来源/范围详情。
  int64、Decimal 与 null 不经浮点转换。metric 要求完整单行；
  Dataset 的 auto 要求完整单行单列才显示 metric，其余按表格显示；Frame 的 auto 由下述结构与语义规则决定。
- Dataset 图表由 [dataset-view.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/dataset-view.ts) 校验列映射：
  line/area/bar 必填 `encoding: {axis, values, series?}`，heatmap 必填 `{x, y, value}`，名称均为保存列 ID。
  数值列必须为 float64/int64/decimal 且可转换为有限绘图坐标，快照必须完整；axis/series 或 x/y 组合须唯一，重复时明确失败，聚合由原分析负责。
  axis 成员按保存行首次出现顺序排列，日期也仅作为已保存的离散点，不推断期间、缺期、时区或分析语义。
  `encoding.series` 列的类别数最多为 8，`encoding.values` 可引用最多 64 列；这不是展开后绘图总序列数的统一上限。
  heatmap 展开网格最多 100,000 格；对应预算超限在保存时拒绝。展开后的系列仍全部呈现，不因色板长度静默截断数据。
  默认 auto/table/metric 判定不变。metric 与图表提供数据图标和详细表格弹窗，支持排序、分页和精确值读取；
  table 直接使用当前表格，不重复显示数据图标。
- Frame 与 Dataset 的适配层分别生成轻量 `ChartModel`；[共享图表](../../../packages/dsh-data-analysis/src/client/analysis-ui/charts/observation.tsx)
  只消费绘图模型，共用主题、图例、tooltip、缺失值路径和局部滚动。Frame 保留期间状态、广播参考线及既有领域交互。密集折线/面积保留全部路径点，省略逐点静态 DOM 时通过活动点与 Frame 键盘导航器读取和选择原始行字段；Dataset 继续提供精确数据入口。
  Frame 图表和提示使用可读数值格式，详细数据按默认字段语义呈现；Dataset 保留精确显示。int64/decimal 绘图位置可近似，引用仍使用保存值。
  折线图悬停使用单一数据提示并直接定位，不叠加浏览器原生图表摘要提示或位移动画；图表摘要仍可由辅助技术读取。
- v2 Frame 由 [frame-view.ts](../../../packages/dsh-data-analysis/src/presentation/contracts/frame-view.ts) 的
  `resolveFrameView` 先确定性分类（成员、分解、比较、对齐、相关、观察）与形状，再选择主视图；保存时校验与渲染使用同一函数。
  显式 `view` 只引用快照中的公开值名和轴名，不满足时 `marivo_present` 返回结构化错误，不保存。
  单行多组比较（单一比较、最多 8 个指标）默认按指标渲染本期/基期/Δ/Δ% 的头部数字块，更长或含多个比较时回退为指标 × 本期/基期/Δ/Δ% 转置表；显式 `table` 始终是转置表。
  折线与面积图要求时间轴；柱图可用时间轴或普通类别轴，类别轴按保存行首次出现的顺序等距排布，不推断连续性。
  热力图以两个轴的完整原始键标识单元格；多个已保存行映射到同一单元格时，自动视图回退到表格，显式热力图返回目标不明确错误，不聚合或覆盖行。
- Frame 外壳在 [frame/](../../../packages/dsh-data-analysis/src/client/analysis-ui/frame/) 下：值名、上下文摘要、
  头部数字、主视图与图标行（数据、覆盖、期间对应、语义来源、Python）。普通折线、面积、柱图、横向柱图及热力图复用共享图表；
  比较、分解、对齐、相关和占比等领域视图使用 Recharts 坐标/图形与有限自定义 marks，按解析结果绘图或显示表格；显式 pie 使用完整的单分类轴快照，要求值非负且总量可确定；
  NA、缺期、不完整期、presence、restricted 与未捕获完整采用视觉编码及必要的短状态标签；
  不增加复述图种或数值的说明段落，compact 也不能隐藏影响解读的限制。
  数据图标与来源、Python 共用操作行及弹窗，展示已保存的详细数据；成员视图以紧凑标签预览完整、非空的单键成员，完整保存成员可从数据入口查看，复合键及空或截断结果直接显示表格。
  Frame 与 Dataset 的元信息入口统一为组件左下角的小图标，内容与图标行之间不加分隔线；
  完整与 compact 视图均保留本地化悬停提示和无障碍名称，不显示操作名称。
  显式指定 `display.dataTable: "visible"` 时详细数据默认内联展示，并可用同一图标收起；数据引用不显示行数和横向滚动图标，截断与空数据状态仍可见。
  比较结果按指标展示本期、基期及已有差值，而非平铺原始字段。
  单行比较按本期、基期、已保存的绝对差值和相对变化组织，单位与数字分开；多指标数字块等宽对齐，末行不拉伸。
  KPI 的变化率与差值使用本地化文字标签，增减方向保留三角标记；零值与缺失值保持区分。
  已知非零但按两位小数会舍入为零的百分比显示为小于 0.01% 的范围；Decimal 的精确非零符号不因浮点下溢丢失。
  分类比较使用按数据范围定位零点的横向差值条，并同行显示基期、本期、差值与相对变化；列标题提供排序，初始按已保存差值的绝对幅度降序排列。
  缺少可绘制差值时仍显示保存的两端和缺失状态，不推算差值；显式 `style: "delta"` 仍要求差值字段。
  差值和变化率来自已保存字段，不从显示时舍入的值重算；缺席侧与缺失值不视为零。
  比较端点优先采用 `display.comparisonLabels` 为对应比较显式声明的成对标签。省略时使用完整捕获且可对应的期间或固定成员，
  缺少任一端时成对回退为本期与基期。比较数字块和转置表仅在有具体端点时显示端点标题；多个基期的选择器仍使用可区分的已保存别名。
  窄容器中的图表及比较表在局部横向滚动，滚动区域可通过键盘访问；行式图在右滚时保留可见的行标签轨道。
  Dataset 表格及两类组件的图表不显示横向滚动符号或提示文案，溢出时仍保留辅助技术可读的滚动说明。
  期间对应展示捕获的两端标签；日历期间显示保存的选择状态和 cutoff，不推断未捕获的时间边界，interval 则显示保存的范围。
  热力图标明已绘制值的色阶范围；时间图按声明的单位分面，未知单位按字段分面；多指标类别图可切换指标并保留对应参考线；alignment 的缺席侧不显示保存单元格中的值，不同量级可使用标明独立尺度的分面。
  热力图时间轴使用唯一匹配的已捕获期间标签及完整性状态，缺失或歧义时显示原始键；分组和选点始终使用原始键。
  变化分解在捕获贡献及两期端点时按已保存贡献的绝对幅度排列明细行，并列展示端点、贡献和已有贡献占比；仅在分解身份、范围及已保存总量均可唯一对应时展示总体变化率。其余分解继续使用对应图形或表格。
  restricted 范围在完整和 compact 视图均明确提示，不能把父总计理解为所示明细的合计。
  占比的语义元数据确认单一分类轴构成完整整体、保存份额可构成全体且分类不超过八项时，以堆叠条及明细展示；其余情况保留原占比视图。
  报告可显式为符合 pie 完整性条件的分类值选择 `style: "stacked"`；其占比标识为基于所示值的计算结果，选点仍绑定保存值。
  Frame 的可选 display 可声明标题、字段格式、比较端点名称、柱图的原始轴键高亮、分类条预览行数、记录坐标预览，以及归因的两期 level-total 字段；保存时按所引用的 Frame 校验。`display.formats` 用于主视图，详细数据采用默认格式，引用保留保存值。
  单位与展示格式由 Harness 基于 Marivo 分析结果决定，插件不额外校验格式与单位是否匹配。浏览器能表达的 currency 使用本地化货币格式；其他单位（如 `USD/mile`）按指定小数位显示数值并保留原单位，不改写保存值或单位。
- 每组 Tabs 的 TabItem.value 必须唯一，Host 在保存前拒绝重复值；不同组可以复用相同值。
  方向键、Home/End 只移动焦点，Enter/Space 激活；tab/panel 通过稳定 ID 关联，隐藏 panel 不可聚焦。
- 图片只显示已保存的 image 资源；TextContent 不加载远程图片。

已保存 Dataset 和 Frame 的可唯一定位图点、KPI 数字及支持的单元格可通过鼠标或键盘选择；选择后在选点右上方显示带 DSH 图标的“就此提问”操作，空间不足时允许避让。结果组件右上角的 DSH 图标直接引用整个组件，不再提供数据复制按钮。成功时引用追加到所属 Harness 会话的提问草稿，关闭相关浮层并把焦点交回输入框；失败时保留操作并提示，用户已切换焦点或会话时不抢焦点。比较结果的本期、基期、差值和变化率各自引用对应的已保存字段；空值、缺席侧及不能唯一绑定的值不可选。
按 Escape 关闭选点操作时焦点返回原选点；若用户随即重新打开操作，旧的延迟焦点恢复不会关闭新操作。
Frame 点引用绑定固定 Build、资源、行和字段；发送时由服务端重新读取并校验，缺席侧、无法唯一定位的字段及父组总计不能作为明细点引用。
发送给模型的上下文包含快照保存的 Marivo Session ID 和可空 Artifact ID，并区分 Harness Session。持久 Frame 可在原 Runtime 和项目及 Artifact 仍可用时通过 Marivo 公开 API 尝试恢复；内存 Frame 没有 Artifact ID，不能据此跨进程恢复原 Frame。快照数据仍是捕获时的结果，不代表实时查询或恢复成功。
复制、表格等直观操作使用带键盘焦点提示和本地化无障碍名称的图标；数据范围不完整及期间未捕获仍有明确状态。
Dataset 点引用绑定当前 Session、Workspace、固定 Build、资源、原始行和字段，独立于 Frame 的选点协议；准备和发送时由服务端读取保存快照并校验身份与内容摘要，发送所选精确值及有界同行上下文并标明截断，不执行新查询。组件引用绑定相同会话与固定 Build，并校验保存 program 中匹配的组件类型、资源和原始视图配置；发送有界数据、报告与语义上下文及截断标记。同一配置可在多个位置复用，引用不声称唯一页面位置。候选预览不提供入口；输入不可用时插入失败并显示状态。reader 不提供全局筛选、动态指标、页面内编辑或撤销/重做；已保存版本可在报告 tab 中导出离线 HTML，见[导出契约](report-publishing.md)。
展示层直接读取 Frame 已有列中的指标、总计和差值。饼图按完整快照中各类别的保存值分配扇区，并在图例显示各扇区占圆的百分比。会被读成全体的视图在未捕获完整的快照上回退为表格或在保存时拒绝。

## 来源与范围详情

DataFrame 的“数据来源与范围”入口集中展示捕获时间、本次执行声明的数据源与 backend，以及已保存的 Python 源码；
Session、Call 和 codeRef 放在可展开的开发者区域。旧执行记录或未声明数据源时明示不可用，源码缺失、读取失败或摘要不一致时显示状态。Frame 不显示 Evidence、Finding 或计算过程；
来源固定为 Host 绑定的 codeRef：来源详情经 `code/read` RPC 读取已保存脚本，只允许读取所读文档资源绑定的 codeRef。
sha256 标识完整 execution record，由 Host 校验记录，客户端核对返回摘要与绑定摘要。Frame 的摘要不一致或执行记录缺失时 Python 图标变灰；section 为 `unavailable`
时对应图标变灰，不显示为 0 项；在阅读界面中，Session/Artifact 只在 Frame Python 详情的开发者区出现。

语义来源为分析时的静态身份，展示去重后的具体对象，不展示 datasource 和 entity；在已保存结果的会话节点和报告 tab 中可经现有[语义浏览器](semantic-browser.md)打开当前定义，
并提示其可能已变化；候选预览不提供导航。

## 报告目录、版本历史与旧格式

报告目录按 Workspace 列出新格式记录，支持标题搜索，并按 surface 区分 tool 与 tab 结果。
报告地址为 `dsh-resource://marivo-report/<workspace>/<report>/current` 或 `.../build/<build>`；
打开时在右侧 tab 中显示对应版本；右上角的报告操作菜单提供历史版本和 HTML 导出入口。版本历史列出同一报告的不可变 Build，展示发布时间、标题、来源会话、当前版本与正在查看的版本，可切换到历史版本或回到 current，也可关闭历史区域。
Host 内入口要求已有 Session，只访问该 Session 所属 Workspace，不隐式创建 Session。

Reader 接受 current v4 历史指针、当前快照及当前 Catalog build。其他 Catalog build、current v2/v3、Frame v1 与旧报告内容均明确拒绝，
文件保留但不可继续读取或更新；目录将不可读指针计入 unavailable，不猜测缺失的发布时间、Session 或 surface。
需要相同内容时，从实际结果重新 `marivo_present` 新格式。

## 界面语言与报告语言

插件操作界面通过 Harness 的 `ctx.locale` 跟随系统语言，按功能注册类型化中英文词典。页面订阅语言 revision，
仅重新渲染文案，不重建凭证、语义或报告模型；操作提示保留稳定标识和安全参数，在展示时翻译。

分析文档的 `locale`（`zh-CN` 或 `en-US`）决定 Surface 内容、辅助说明和日期／数字格式；Host 控件使用系统语言。
业务正文、字段标识、单位、精确数值和原始语义事实不由插件翻译。

Surface 通过 Harness 的 `--dsw-*` token 继承背景、文字和边框；图表色板、网格、图例和标签遵循与 analysis-ui 一致的视觉规则，
色板通过 CSS 变量跟随 Host 已解析的明暗主题，脱离 Host 时回退到独立页面的显式主题或系统偏好。
Frame 提示按保存值格式化，Dataset 提示保留精确值；图形坐标的近似值不代替保存值。主题切换不重挂 Frame 或 Dataset 图表。

## 验证边界

聚焦测试覆盖 Catalog 准入、数据视图的精确值与 metric/auto 判定、Frame 分类与视图解析、真实 Marivo Frame 渲染、目录过滤及旧格式拒绝；运行所属测试与 `npm run check`。
真实浏览器验证记录在本地 `docs/testing/validation.md`；reader 验证不代替 Tool、receipt/RPC 或真实 Agent 自动路由验收。
