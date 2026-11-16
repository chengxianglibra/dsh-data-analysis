# 视图选择与页面布局

## 选择数据来源与刷新契约

governed 输入和受支持的类型化分析用 AnalysisFrameView，保留原 AnalysisFrame。纯文件、合法外部计算和表格明细可用 DatasetView。同一结果的图表和明细可共享资源。分批见[边分析边更新](../SKILL.md#边分析边更新)，复用与来源见[结果导出](capture.md)。

新建可刷新的视图时，按已核验字段显式声明 chart、encoding 和必要的 columns。auto 按原始快照选图，筛选不会改变图种。刷新时锁定 view、display、筛选和页面布局。解析出的图种变化会拒绝刷新，比较或分解内部布局可随结果结构变化。数据不合约时修复输入或说明阻塞，保留原粒度和口径，不能伪造行或空值来维持外观。

## Marivo Frame

图表 encoding 用公开轴名和值名，table 的 columns 和 metric 的 encoding.value 用保存列 ID。折线和面积图要求时间轴，柱图可用时间轴或普通类别轴。类别按保存行首次出现排序。

完整单行比较可显示本期、基期、Δ、Δ%。同一比较最多 8 个指标时可各用一个数字块，更多指标或多个 alias 回退为对比表。完整单行比较有比较目标时，省略 columns 的 table 可转置。显式 columns 展示选定列。用 comparison 的 encoding.value 选择比较组中的公开值。分解使用保存的分解事实。

饼图要求完整的观察型 Frame、唯一分类轴与类别键，以及非广播的数值列。值须有限、非空、非负且至少一个为正。用 pie 的 encoding.axis/value 指定字段，目标唯一时可省略。style:"stacked" 显示堆叠构成条。

Frame 的 display 可用以下选项：

- title、subtitle 说明结果。formats 示例见下方。
- comparisonLabels 用 `[{alias:"比较别名",current:"本期名称",baseline:"基期名称"}]` 标记核验过的两端。alias 必须唯一匹配已保存的比较，省略只匹配唯一匿名比较。reference 列前缀不代表 alias。
- 时间柱图用 `highlight:{axis:"轴名",key:[已保存的完整原始键]}`。普通表格和横向条形图可用 rowLimit 预览。表格先筛选再按保存顺序截取，数据入口显示全部匹配行。
- 普通表格用 `recordPreview:{coordinates:["坐标列1","坐标列2"],values:["数值列"],limit:6,label:"组合坐标标题"}`。坐标按声明顺序连接，详情见数据入口。recordPreview 与 rowLimit 互斥。
- 已核实分解两期 level total 同组同范围时，用 `decompositionTotals:{current:"本期总量列",baseline:"基期总量列",currentLabel:"本期标题",baselineLabel:"基期标题"}`。总量在保存行中一致且非空才展示，缺失时保留缺失。

## DataFrame

DatasetView 按保存列 ID 配置。table 用 columns，metric 用 encoding.value 且支持文本。未绑定的 metric 要求完整单行。折线、面积、柱图用 `{axis,values,series?}`，热力图用 `{x,y,value}`。图表要求完整快照及可绘制数值，坐标按保存顺序首次出现。时间趋势应先在分析中按时间排序。

两类视图均可用 title、subtitle 和 `display.formats:[{value:"share",format:"percent",decimals:1}]`。格式支持 percent、number、currency，小数位 0–6。percent 按保存比例乘以 100，currency 使用保存单位。格式只改主视图，排序、筛选、点选和详情基于保存原值。用视图标题说明表格内容。

## 固定快照筛选

`marivo_report_write.selectionSources` 声明来源，提供时整体替换，省略则继承。数据视图的第四个参数 filters 显式绑定 `[{source:"region",selection:$region}]`。来源 ID 以字母开头，只用字母、数字和下划线，不能以 `source_` 开头；label 用报告语言且与控件一致，省略时用来源 ID。跨资源或换字段时显式声明 `field:{kind:"column"|"axis",name:"目标字段"}`。Dataset 用列 ID，Frame 用公开轴名。

- single/multiple 匹配保存原值，支持 string、boolean、int64、date、datetime 和允许的 null。Frame 使用 ordinary 单键轴或 calendar 单键轴。两端须为同一业务维度、同类型同编码；datetime 按完整保存文本匹配。多个 calendar 轴的时区、精确匹配粒度须一致。可用 `options.requireTargetCoverage:true` 要求候选覆盖各目标的已捕获成员。目标可以缺少来源成员，零匹配显示无数据。筛选摘要标注部分快照的候选来源。
- date-range 包含两端 `YYYY-MM-DD`，可选同日，也可选超出捕获范围的边界。支持严格日期字符串、date、datetime 和 builtin hour/day、step=1 的 calendar 单键轴。datetime 用保存文本的日期，calendar 用轴的业务时区，绑定的 calendar 轴须同一时区。DatePicker 导航为 1900–2100 年。见[跨资源日期示例](examples.md#跨资源日期筛选)。
- 多选内部为 OR，多个筛选器之间为 AND。allowAll:false 要求有效默认值。single 的 defaultPolicy:"latest" 适用于 date 或非空值均为严格日期的 string 字段；date-range 的 latest 选最新的一天。刷新重新解析 latest，失效的显式普通默认值会拒绝新版本。

枚举用 `FilterChips("region", $region)`，两个参数必须引用同一来源 ID。组件读取来源的 label、mode、默认值和 allowAll，候选来自固定快照。选择、移除、清除和恢复默认即时生效，禁止移除必选筛选的最后一项。`$region = "a";` 用于初始化单选占位，`$region = {};` 用于多选。运行时优先使用来源默认值。候选多时可展开搜索。

日期范围用 DatePicker，选完整范围后写入 `$source_<ID长度>_<ID>_draft`。用 `@SelectionOrCurrent(current,draft,[],"date-range",allowAll)` 校验后通过 `@Set` 应用。恢复默认时将 `_default` 写入已应用值和草稿。

### 各视图的筛选准入

| 视图 | 绑定条件与多选结果 |
| --- | --- |
| 普通表格、记录预览、成员 | 筛选已捕获行，可用部分快照。统计列保留原保存口径。 |
| 折线、面积、柱图、区间柱图、横向条形图、热力图 | 图点用 axis/series，热力格用 x/y，可加必选单选目标字段共同构成唯一键。多选或范围字段不会固定维度，必要时补 series 或调整上游粒度。 |
| 显式 metric | 完整快照，全部目标字段的匹配键元组唯一（范围模式按日）。纯单选绑定须全部必选。含多选或日期范围时，每个匹配键显示一个保存结果。 |
| 饼图、堆叠构成条 | 按匹配类别展示保存数值，比例以匹配项合计为分母。合计为零时比例无定义。 |
| 比较、对齐 | 按保存行保留两端及 presence。比较的统计端点要求整组，趋势或小多图要求完整坐标唯一。单行比较数字块仍要求单行。 |
| 已保存份额、分解、相关性 | 快照完整且所用事实为完整组范围。每个绑定的目标键在每组内必须一致，涵盖所有允许的选择。保留原分母、总量与贡献、相关系数与样本。 |

筛选使用原始行索引，图表、详情和点选共用匹配行。业务聚合与指标重算由原分析负责。Frame 除普通表格和成员视图外要求捕获 interpretation。普通图表、metric 和饼图使用有明确值上下文的独立值。广播值可用普通表格核对。份额、配对统计及比较、对齐、分解的专用输出按相应视图的规则准入。不能用默认值刚好唯一或碰巧选中整组来通过准入。

每日每地区一行的趋势用 day 作 axis、region 作 series，地区多选可同时展示多条趋势。控件与明细绑定见[地区多选示例](examples.md#多选维度筛选)。

### 月度指标与完整统计组多选示例

`monthly` 保存每月唯一一行的 total，month 为 datetime。`regionalShare` 是 Frame，每月包含全部地区，份额按 month 分组、沿 region 归一化。两端 month 采用相同保存键。将下列来源和 program 一起提交。

```json
{"month":{"ref":"monthly","field":{"kind":"column","name":"month"},"label":"月份","mode":"multiple","options":{"requireTargetCoverage":true}}}
```

```openui
$month = {};
root = Stack([monthInput, totals, shares, details]);
monthInput = FilterChips("month", $month);
totals = DatasetView("monthly", {chart:"metric",encoding:{value:"total"}}, {}, [{source:"month",selection:$month}]);
shares = AnalysisFrameView("regionalShare", {chart:"auto"}, {}, [{source:"month",field:{kind:"axis",name:"month"},selection:$month}]);
details = AnalysisFrameView("regionalShare", {chart:"table"}, {}, [{source:"month",field:{kind:"axis",name:"month"},selection:$month}]);
```

选一月和三月时显示两个月各自的指标和份额组。地区键在一个月内变化，因此地区控件可筛普通明细，不能绑定该份额视图来切掉分母内的部分地区。保存的月度分解若也以 month 为完整父组，可用相同绑定配 `{chart:"decomposition"}`。

### 筛选范围与布局

只影响部分视图时，用默认 Card 框住控件、应用和恢复默认操作以及所有受影响视图。影响全部数据视图且其余内容不会被误认为联动时，控件放页面开头。相同范围可共用框，交叉范围无法准确嵌套时，用文字标明各自影响的视图。联动由显式 filters 决定。静态结论、图片和未绑定视图保持固定。选择属于阅读状态，离线 HTML 携带保存的快照并从默认值开始。

## OpenUI Lang 布局

用 root 组合页面，参数位置见[组件签名](analysis-catalog.md)。初始草稿可先写标题、问题和范围；数据就绪后用独立命名语句加入视图，同一 patch 更新父布局并保留其他组件。结论和范围说明也用独立语句。DashboardGrid 配 DashboardGridItem 控制列宽，简单并排用可换行 Stack。删除语句时用 `name = null;` 并移除父引用；删除资源用 resourcePatch.remove，同时移除程序引用。marivo_report_delete 删除整个报告及历史。

TextCallout 放已核实的静态说明，Accordion 放补充内容，重要限制应直接可见。可刷新指标直接引用保存结果。Image 引用已存图片并提供替代文字。需要核对原值时配数据视图。图种达不到要求时用表格或说明限制。
