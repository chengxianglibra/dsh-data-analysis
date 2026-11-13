# 视图选择与页面布局

## 选择数据来源与刷新契约

governed 输入和受支持的类型化分析优先保留 AnalysisFrame，用 AnalysisFrameView，不为画图或表格转成 DataFrame。纯文件、合法外部计算或合适的表格明细用 DatasetView，不为更换视图强行建模。同一结果的趋势图和明细表可共享资源，各自声明字段和样式。分批与草稿见[边分析边更新](../SKILL.md#边分析边更新)，结果复用与来源见[结果导出](capture.md)。

新建可刷新的分析视图时，按已核验字段尽量显式选择 chart 和 encoding；table 可明确 columns，避免列随数据变化。auto 适合探索草稿或只能由 Frame 结构判定的视图，不承诺刷新后形态固定。部分 comparison/decomposition 视图也会按结构调整布局。保持分析粒度、角色和字段契约并核对形态；不能新增空值、伪造行或改变业务口径来维持外观。

刷新已保存视图时锁定 view/display 和布局。数据不满足旧视图时修复输入或说明阻塞，不改图。以下建议用于新建或明确授权的页面编辑。

## Marivo Frame

`AnalysisFrameView("result")` 根据 Frame 结构选图。单行单组比较适合读本期值与变化；单行多组比较（单一比较、最多 8 个指标）默认每个指标一个数字块，依次展示本期、基期、Δ、Δ%；更多指标或多个 alias 回退为“指标 × 本期/基期/Δ/Δ%”对比表。省略 `columns` 的显式 `{chart:"table"}` 仅在有比较目标的完整单行比较时转置；指定 `columns` 显示选定列，多行比较按时间或类别组织。柱图可用于时间轴或普通类别轴（按保存行首次出现顺序等距排布），折线图和面积图要求时间轴。用 `{chart:"comparison", encoding:{value:"输出列名"}}` 可突出该组公开值。分解图使用 Frame 已有结果。

饼图适合观察型 Frame 的构成比较：快照完整、仅一个分类轴且类别键唯一；选非广播数值列，值非空、有限、非负且至少一个正值。用 `{chart:"pie", encoding:{axis:"轴名", value:"值名"}}` 指定字段，目标唯一时可省略映射。

堆叠构成条用 pie 的 `style:"stacked"`；比例按已展示的完整分类值计算并标记为计算值。原始数值和点选仍对应保存行，未指定 style 时为饼图。

作者按已核验口径声明 `display`：

- `title`、`subtitle` 用于说明图表；`formats:[{value:"已保存值名",format:"percent"|"number"|"currency",decimals:1}]` 只改变主视图显示，不改变原始值、复制或数据详情。百分比按保存比例乘以 100。
- 比较端点确有明确名称时，具名比较可用 `comparisonLabels:[{alias:"比较别名",current:"本期名称",baseline:"基期名称"}]`；匿名比较省略 `alias`，例如 `comparisonLabels:[{current:"本期 11-10",baseline:"基期 11-09"}]`。指定名称必须在快照中唯一匹配，省略 `alias` 只匹配唯一的匿名比较，不代表第一个比较；`reference` 列前缀不代表匿名比较的具名 alias。名称由作者负责核实，不能从字段名称或数值猜测。
- 时间柱图可用 `highlight:{axis:"轴名",key:[已保存的完整原始键]}` 强调特定期间；键必须逐项匹配快照。横向分类条和普通表格可用 `rowLimit` 预览前 N 条保存行；表格先应用筛选再按保存顺序截取，数据入口显示筛选范围内全部已捕获行，清除筛选后可查看全部已捕获行。转置比较表及其他图形不支持该选项。
- 表格可用 `recordPreview:{coordinates:["坐标列1","坐标列2"],values:["数值列"],limit:6,label:"组合坐标标题"}` 将坐标按声明顺序连接，数值和点选仍指向原行；完整结果见数据入口。`recordPreview.limit` 与 `rowLimit` 不能同时指定。
- 已核实分解的两期 level total 与所选变化属于同一分组和范围时，可用 `decompositionTotals:{current:"本期总量列",baseline:"基期总量列",currentLabel:"本期标题",baselineLabel:"基期标题"}` 展示保存总量。仅在每个总量在保存行中一致且非空时显示；不要自行求和替代缺失总量。

## DataFrame

`DatasetView` 按保存的列 ID 映射字段。表格可用 `{chart:"table", columns:["category", "amount"]}` 选择读者需要核对的列。指标卡使用完整单行结果中的一个标量，或按必选单选唯一定位完整快照中的保存行，支持文本；图表的数值映射仍须符合对应类型约束。折线图、面积图和柱图用 `{axis, values, series?}`，热力图用 `{x, y, value}`。这些图要求完整快照、数值列和唯一坐标组合，按快照中首次出现的顺序展示。趋势图应使用原分析已经按时间排好的数据。

`display.title` 和 `display.subtitle` 可说明表格、指标卡或图表；`display.formats` 按保存的数值列 ID 声明，如 `formats:[{value:"share",format:"percent",decimals:1}]`。支持 `percent`、`number`、`currency`，小数位 0–6；百分比把保存的比例乘以 100。货币单位来自列的 `unit`，不得猜测币种或将百分数再次标成比例。格式只改变主视图显示，排序、筛选、点选和数据详情仍用保存值；未显式格式化的列保持精确显示。不要仅依赖 Tab 标签说明表格内容。

## 固定快照筛选

读者筛选已保存行时使用具名 `SnapshotFilter`，`ref` 和 `field` 提供候选或日期范围来源。视图的 `filters` 用字符串绑定同资源同字段，或用 `{filter:"筛选器 ID",field:{kind:"column"|"axis",name:"目标字段"}}` 显式绑定消费字段；普通模式两端类型须相同。Dataset 使用保存列 ID，Frame 使用公开轴名。普通 single/multiple 匹配保存的 string、boolean、int64 或 date 原值，`null`、空字符串和精确 int64 保持各自身份。空数组表示全部，多选内部为 OR，多个筛选器之间为 AND。

`single` 的 `options:{allowAll:false,defaultPolicy:"latest"}` 选择最新保存日期：来源须为 date 或非 null 值均为严格有效日期字符串的字段。它仍按原值匹配；小时等资源须已有同类型 day 字段，不能从 datetime 或 calendar 自动派生日，也不要为控件强制转换 Frame。

`date-range` 的两个 `YYYY-MM-DD` 边界包含两端，可绑定严格日期字符串、date、已保存 datetime，或 builtin hour/day、step=1 的 Frame calendar 轴；后者按轴的业务时区解释日期。可指定同日、超出捕获范围的边界或 `defaultPolicy:"latest"`；选择只投影已保存数据。`allowAll:false` 要求有效非空默认值。刷新时 latest 按新 Build 捕获数据解析；显式普通默认成员失效则拒绝新版本。

普通表格和支持的 line/area/bar 观察视图可筛选。显式 metric 要求完整快照、所有绑定均为必选 single 且字段元组唯一，显示唯一保存行；零匹配显示无数据。multiple 和 date-range 不能绑定 metric 或让浏览器重算范围指标。auto 按原始快照选视图，饼图、热力图、比较和分解等限制不变。静态结论和未绑定视图不随选择变化；覆盖范围按原快照披露，离线 HTML 包含完整已保存数据并从默认值开始。


### 筛选范围与布局

新建或编辑时按筛选绑定展示范围：局部筛选用默认 Card 框住控件、应用/重置操作和受影响视图，其余放框外；只有一个视图也要框住。影响所有数据视图且其他内容不会被误认为联动时，控件放页面开头，以分析视图为范围，无需再套 Card。静态标题和一般说明不必变化。

相同范围可共用框；交叉且无法准确嵌套时，用文字标明各自影响，不画误导性的共同框或重复展示。Card 仅作视觉分组，须在受影响视图显式声明 `filters`，保存前核对绑定与展示一致。静态结论、图片和未绑定视图不会联动。仅刷新数据时保持原布局。


## OpenUI Lang 布局

从 `root` 组合页面，组件按[签名](analysis-catalog.md)接受位置参数。初始草稿可仅含标题、问题与范围，不使用未就绪资源。每个数据视图用独立命名语句，结果就绪后连同 root/父布局 patch 加入草稿，保留其他组件。结论和必要范围说明也用命名语句，便于增量更新。数据视图已有卡片，不要只为单个视图添加装饰性 Card；Card 可组织共同主题。控制看板列宽用 DashboardGrid 与 DashboardGridItem，按阅读顺序排列，窄容器自动减少列数。简单并排可用带 row 和 wrap 的 Stack。

编辑时以 `name = null;` 删除命名语句，同一 program patch 须改写父语句移除引用，如 `root = Stack([heading]); chart = null;`；页面仍需合法 root。删除资源声明用 `resourcePatch.remove`，并移除程序中的引用；`marivo_report_delete` 永久删除整个已保存视图及历史。失败时按错误阶段和修复信息处理语法、引用或草稿状态；失败不会应用 patch。

TextCallout 说明已核实的范围、假设或限制；Accordion 用于补充内容，重要限制须直接可见。二者文本是静态叙述，不随数据刷新。数据视图仍引用已保存结果，不把数值复制进静态提示充当可刷新指标。

已有图片或数据视图不支持的图形用 Image 资源名引用，提供说明内容的替代文字；需要核对原值时配数据视图。不满足数据视图条件时选择合适表格或说明限制，不用图片或文字掩盖缺失或不完整数据。
