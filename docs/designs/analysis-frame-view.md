# AnalysisFrameView 规范与展示设计

## 状态与依据

状态：已实施（2026-10-30），实现与本文的差异及验收见[验收记录](../testing/analysis-frame-view-2026-10-30.md)。创建日期：2026-10-30。

本文按 Marivo 不同分析产出的 AnalysisFrame 分类，定义 `AnalysisFrameView` 的 OpenUI Lang 签名、快照契约扩展和各类展示方案，
细化[统一分析 UI 设计](unified-analysis-ui.md)中的 Frame 部分。当前实现边界见
[展示数据投影](../modules/presentation-projection.md)和[分析文档 reader](../modules/presentation-reader.md)。

依据为 Marivo `79536a6d2c`（feat(analysis): add Frame result interpretation）的公开源码与文档：

- `marivo/analysis/core/frame_interpretation.py`：`unary_facts`、`comparison_facts`、`align_facts`、`decomposition_facts`
  决定各操作写入哪些解释事实
- `marivo/analysis/core/frame_schema.py`、`frame_page.py`、`attribute.py`
- `marivo/analysis/dsl/frame.py`、`frame_axis.py`、`frame_sources.py`、`column.py`
- `docs/architecture/analysis/analysis-frame.md`、`site/src/content/docs/zh-cn/docs/latest/analysis/` 下的 `dsl.mdx`、`results.mdx`

以上均为源码阅读结论，尚未用真实 Frame 运行验证。

## 原则

1. 所有 Frame 事实只从 `AnalysisFrame` 自身的公开类型化成员读取。不解析 `to_pandas().attrs`、
   内部 dataclass、私有 Store 或 `.show()` 文本，也不从值名、列名前缀推断角色。
   缺失的事实列入[上游缺口](#marivo-上游缺口)，不在插件侧推断。
2. 展示层只呈现，不计算。总计、Δ、Δ%、占比、贡献都必须是 Frame 中已有的列；前端不聚合、不补零、不补读历史。
3. 可以由结构确定的视图不交给模型选。模型只在需要偏离默认时声明 `view`，并且只引用公开的值名和轴名。
4. 元数据只解释数据本身的业务语义：是什么指标、什么范围和时间、与什么比较、按什么分组。
   不解释计算过程，方法、规则、读取和校验细节都不进入 UI。
5. 图表、数字和布局本身说明数据含义，不依赖解释性文字、警示横幅或脚注。
   容易误读的状态用视觉编码表达；会误导的视图在保存时拒绝，或由 `auto` 回退到表格。
   文字只用于短标签（值名、期间、成员、单位）和 tooltip 中的事实。
6. 能统一的统一：所有类别共用同一个外壳和同一套视觉编码，只有主视图和头部数字按类别区分。
7. 来源固定为生成结果的 Python 脚本（`codeRef`），由 Host 绑定，模型不能填写或隐藏来源。

## 责任边界

| 所有者 | 职责 |
| --- | --- |
| Marivo | Frame 的结构、比较、分解、统计上下文、期间和 lineage 的事实与有效性 |
| Harness | 决定回复用 markdown 还是 UI，以及 UI 由哪些组件组合 |
| 本插件 | 在原执行中捕获快照并绑定 codeRef；分类；校验 Lang；渲染确定性视图 |
| 随包 Skill | 何时使用 Frame 视图、何时显式声明 `view` 的判断；需单独授权修改 |

## AnalysisFrame 分类

### 各操作产出的结构与事实

| 操作 | 轴 | 值与 presence | 写入的解释事实 |
| --- | --- | --- | --- |
| `session.observe` | 由 `by` 决定：普通、identity、calendar、interval；`()` 为 0 轴 | 命名 Metric 值，numeric | 每个值一个 `FrameObservationContext`（subject、时间依据、窗口） |
| `session.read` | 一个 identity 轴 | 实体属性，任意标量类型 | 未核实是否写入 context，分类不依赖它 |
| `session.frame` | Population 的完整轴 | 无值 | 无 |
| `session.values` | 声明的普通或 identity 轴，或 0 轴 | 字面值，带 unit | 无 |
| `compare` | 本期的轴 | 本期值，以及 `<alias>.baseline/absolute/relative.<name>`；presence `current.present`、`<alias>.present` | `comparisons`；时间比较时值的时间依据改为 `FrameComparedTime`；清空 decompositions |
| `attribute` | 父级的轴 + `by` 的细分轴 | contribution、total、observed_total、contribution_share、detail、component、effect 系列 | 一个 `FrameDecomposition`（groups 为父级轴与父级 fixed 轴）；清空 value_contexts |
| `reduce` | 保留的 `by` 轴 | 统计值；presence 移除 | 每值 `FrameStatisticContext`，groups 等于保留的全部轴 |
| `correlate` | `by` 轴 | `coefficient`（float64，unit 1）、`n_pairs`（int64） | `FrameStatisticContext`：pearson/spearman 与 pair_count |
| `over`（在 select 中） | 不变 | 分区统计广播回每一行 | `FrameStatisticContext`，groups 是分区轴，少于当前全部轴 |
| `share`（在 select 中） | 不变 | 值除以分区和 | 无 context（见[上游缺口](#marivo-上游缺口)） |
| `align` | 成对的轴；两侧时间轴成对时为 paired 轴 | `left.<name>`、`right.<name>`；presence `left_present`、`right_present` | value_contexts 加 left/right 前缀；无 comparisons、decompositions |
| `select` | 不变 | 直接引用的值保留 context，计算列没有 | 输出被选中时保留 decomposition 并跟随改名 |
| `where` / `top` | 不变，行减少 | 不变 | 统计 context 与 decomposition 的 `row_scope` 变为 `restricted` |
| `fix` | 移除一个普通轴 | 不变 | `fixed_axes` 增加一项；分组改为 fixed group；未按该轴分组的 decomposition 变为 `restricted` |

同一个 Frame 往往经过多步操作，所以分类看的是最终 Frame 上的事实，不看最后一步是什么操作。

### 识别规则

分两个维度，按公开事实确定性识别。

语义类，按顺序取第一条匹配：

| 顺序 | 类 | 判定 | 典型来源 |
| --- | --- | --- | --- |
| 1 | 成员 | 没有值 | `session.frame`、`select({})` |
| 2 | 分解 | `decompositions` 非空 | attribute，及其后的 select/where/fix |
| 3 | 比较 | `comparisons` 中有 group 带非空 values | compare，及其后的 select/where/fix |
| 4 | 相关 | 有值的 statistic 为 pearson 或 spearman | correlate |
| 5 | 观察与统计 | 其余 | observe、reduce、values、read、align、计算列 |

形状，由轴决定，用于第 5 类的主视图，也用于其他类内部的排布：

| 形状 | 判定 |
| --- | --- |
| 标量 | 0 个轴 |
| 时间序列 | 1 个 calendar 或 interval 轴 |
| 类别 | 1 个普通轴（field 或 identity） |
| 时间 × 类别 | 1 个时间轴 + 1 个普通轴 |
| 矩阵 | 2 个普通轴 |
| 记录 | 有 identity 轴，且值中有非数值类型或数值超过 6 个 |
| 配对时间 | 有 paired 轴 |

值级修饰，不改变类别：

- 广播值：statistic context 的 groups 少于当前轴（来自 `over`），画成参考线，不画成独立的柱或序列。
- 统计值：值名前加统计符号，Σ（sum）、μ（mean）、#（row_count）、n（pair_count）。
- 主视图只画该类的值，其余值只出现在数据表中。

## 统一外壳

所有类别共用同一外壳，只有“头部数字”和“主视图”两块按类别区分。

```text
┌──────────────────────────────────────────────────────────────┐
│ revenue                                      [图|表] [⧉]     │  值名
│ 9 月各地区收入                                               │  description，弱化显示
│ 华东 · 近 30 期 · 日 · Asia/Shanghai                         │  上下文 chips
│                                                              │
│ 1.20M   1.05M   ▲150K   ▲14.3%                               │  头部数字（按类别）
│ 2026-09 2025-09                                              │  数字下方的端点标签
│ ╭──────────────────────── 主视图 ────────────────────────╮   │
│ │                                                        │   │
│ ╰────────────────────────────────────────────────────────╯   │
│ ▸ 表                                                         │
│ ◔ 1,000/5,321   ⇄   ◇ 3   </>                                │  图标行
└──────────────────────────────────────────────────────────────┘
```

上下文 chips，常驻显示，只用短标签：

| chip | 来源 | 写法 |
| --- | --- | --- |
| 固定成员 | `fixed_axes` | 成员标签，如“华东”；hover 显示轴名 |
| 窗口 | 观察 context 的 window | “近 30 期”“近 7 天”“年初至今”“自 2026-01-01”“全部历史” |
| 固定时间 | 观察 context 的 `FrameFixedTime` | “09-01 – 09-30” |
| 粒度与时区 | calendar/interval 轴 | “日 · Asia/Shanghai”；named grain 显示 level |

没有 context 时不显示 chip，也不写“全量”“无筛选”。

图标行，hover 或 focus 显示事实，点击打开详情：

| 图标 | hover 显示 | 点击 |
| --- | --- | --- |
| 覆盖（环形进度） | 已捕获 / 总行数、捕获时间 | — |
| 期间对应（仅时间比较） | 本期与基期的期间范围 | 期间对应表 |
| 语义来源 | 指标和维度的 path | 来源列表，可跳到语义浏览器 |
| Python | executionId、sha256 短值 | 只读代码块，可复制；sha256 不一致时图标变灰 |

section 是 `not-captured` 或 `unavailable` 时图标变灰，不当作“0 项”。`session_id`、`artifact_id` 只放在 Python 详情的开发者区。

## 各类展示

### 观察与统计

按形状选主视图：

| 形状 | 主视图 | 头部数字 |
| --- | --- | --- |
| 标量 | 数字卡；多值时并排，超过 4 个用表格 | 不另设 |
| 时间序列 | calendar 用折线，期间不超过 12 且只有一个值时用柱；interval 用区间柱，不连线 | 不设 |
| 类别 | 横条，按 Frame 行序；超过 30 类用表格 | 不设 |
| 时间 × 类别 | 多序列折线，序列超过 8 用热力图 | 不设 |
| 矩阵 | 热力图 | 不设 |
| 记录 | 表格，identity 键列冻结在左侧 | 不设 |
| 配对时间 | 表格（见[上游缺口](#marivo-上游缺口)） | 不设 |

- 时间刻度格式由 grain 决定，例如 day 显示 MM-DD，month 显示 YYYY-MM；named grain 直接用期间 label。
- 广播值画成所属分区的水平参考线，线端标数值；`by=()` 时整图一条线。where 之后参考线保持原值，柱达不到线，差距本身就说明范围被筛过。
- 普通观察值不画堆叠图，堆叠高度会被读成合计。

### 比较

头部数字：本期、基期、Δ、Δ%，依次取自 comparison group 中 current、baseline、absolute、relative 角色的列，缺哪个就不显示哪个。
数字下方是端点标签，用来说明比的是什么，不写“同比”“环比”：

- calendar/interval 比较：取 `read_periods(comparison)` 的期间 label，如“2026-09”和“2025-09”；多期时写首末期范围。
- ordinary 比较：取两端 fixed_axes 不同的成员，如“west”和“east”；没有差异时用 alias。

主视图按形状：

| 形状 | 主视图 |
| --- | --- |
| 标量 | 只有头部数字 |
| 时间序列 | 本期实线、基期同色虚线画在本期期间位置上；下方共享 x 轴的 Δ 细柱 |
| 类别 | 哑铃图：基期空心点到本期实心点，连线长度即 Δ，行尾是 Δ%；`style: "delta"` 改为 Δ 发散条 |
| 时间 × 类别 | 每类一张小图（不超过 8），否则表格 |
| 其他 | 表格 |

- 本期与基期使用同一色相，基期更浅或用虚线，图例直接是两个端点标签。
- 某一端 presence 为 false 时只画存在的那个点，不写“仅本期”。
- 基期为 0 时 relative 是 NA，Δ% 显示为“—”。
- 多个 alias 用分段控件切换，标签是端点标签。

`relative` 在 Marivo 中固定为 `(current − baseline) / |baseline|`，dtype 为 float64，`unit` 为 None
（`marivo/analysis/methods/frame_comparison.py`、`core/frame_expression.py`）。前端乘 100 显示为百分数，符号与 Δ 一致。

### 分解

数值全部来自 attribute 输出，前端不上卷。按 `FrameDecomposition` 组织：

- `groups` 中的轴分组对应父级，每个父级（如每个月）一张小图；fixed 分组是常量，进上下文 chip。
- target 为 `FrameChangeTarget` 时，标题前加 Δ，单位跟随目标；kind 为 relative 时按百分数格式化。
  target 为 `FrameLevelTarget` 时，是总量的构成。

头部数字：该父级的 `total`。

主视图按 outputs 的角色选择：

| 角色 | 主视图 |
| --- | --- |
| contribution + total | 瀑布：各组 contribution 依次浮动，末柱 total 从 0 画起，柱间有连接线。change 和 level 目标用同一画法 |
| effect_within / effect_mix / effect_entry_exit / effect_additive | 每组一根发散分段条，段是各效应，◆ 标出该组 contribution；图例为“组内”“结构”“进出”“可加” |
| `style: "share"` | contribution_share 画在带 0 和 100% 刻度的轨道上；份额可为负或超过 100%，轨道两侧可延伸 |

- 浮动柱的位置是布局，不作为数值显示；tooltip 和表格只显示各列原值。
- `row_scope = restricted` 时，末柱 total 与贡献柱之间不画连接线，并留出间隔，不加文字说明。
- 贡献之和与 total 不保证严格相等，照实画，不计算、不标注差值。
- 同一父级内 total 必须相同。捕获时校验，不一致就报错。
- `observed_total`、`contribution_std_error`、detail 列和 component 列只在 tooltip 与数据表中出现。

### 相关

- 每个 coefficient 画成固定 [−1, 1] 轴上的点，0 处有中线；n_pairs 在行尾用小号灰字显示。
  轴的范围固定，点的位置本身就说明方向和强度。
- 有 `by` 轴时每组一行，组成点阵。
- coefficient 为 NA 时不画点，数值显示为“—”，n_pairs 照常显示。
- 头部数字：0 轴时显示 r（spearman 显示 ρ）和 n。

### 成员

- 头部数字：成员数。
- 主视图：成员表格，复合键按完整元组分列显示。

## 通用视觉编码

所有类别遵守同一套编码：

| 状态 | 编码 |
| --- | --- |
| 数值 NA | 数字显示“—”；图上不画标记，折线断开 |
| 0 | 正常画出，柱高为 0 但保留基线刻度 |
| 缺期 | `read_periods` 中有、但没有数据行的期间保留刻度；折线断开，柱位留空 |
| 不完整期 | 实际边界与名义边界不一致：空心点、斜纹柱；tooltip 显示两组边界 |
| presence 为 false | 空心标记，或该侧不画 |
| 部分行（restricted） | 分解不画闭合连接线；广播参考线保持原值 |
| 数据未捕获完整（`has_more`） | 瀑布、份额、类别横条这类会被读成全体的视图在保存时拒绝，`auto` 回退到表格；表格底部和覆盖图标显示“1,000/5,321” |

- Δ 一律用中性色加 ▲/▼，不用红绿，因为 Marivo 没有指标方向语义。
- 数值带单位，紧凑显示（如 1.20M），tooltip 和表格保留精确值。decimal、int64 画图的近似只影响图形位置，不另加说明。

## 快照契约

### 捕获入口

新增 `capture_frame(frame)`，与 `capture_dataset` 对称：在原 `marivo_python` 执行中调用，回执返回 `snapshotRef`，
Host 自动绑定 codeRef、Session 和 call。资源声明为 `{kind: "frame-snapshot", snapshotRef}`。

现有 `{kind: "marivo-frame", sessionId, artifactId}` 由 Host 事后恢复读取，保留兼容，但没有脚本来源，Python 图标变灰。

`capture_frame` 只接受已完成的 Frame（持久，或 `compute()` 后的内存 Frame），待执行表达式明确报错，不隐式 compute。
Frame 经 `to_pandas()` 转换后继续处理得到的是 DataFrame，只能用 `capture_dataset` 和 `DatasetView` 展示，不显示任何 Frame 语义。

### schemaVersion 2 的 frame 部分

在现有 `FrameSnapshot`（`src/presentation/contracts/snapshot.ts`）上增加以下字段，均为 Marivo 公开事实的有界投影：

| 字段 | 来源 | 预算 |
| --- | --- | --- |
| `description` | `frame.description` | 2000 字符 |
| `axes[].variant` | 轴变体及 timezone、grain、paired 端点 | 随列预算 |
| `fixedAxes` | `schema.fixed_axes` 的轴名、显示键与 origins | 32 项 |
| `valueContexts` | `schema.value_contexts`，以当前值名为键；groups 解析为轴名或固定成员 | 随列预算 |
| `comparisons` | `schema.comparisons`，引用改为当前值名、轴名和 presence 名 | 16 个比较 |
| `decompositions` | `schema.decompositions`，outputs 保留 role 与当前列名 | 16 个分解 |
| `periods` | 每个时间轴及时间比较的 `read_periods` 页 | 与数据行预算相同（5000） |
| `source` | 增加 `code: {executionId, sha256}`；`marivo-frame` 路径无此项 | — |

现有的 `sections.evidence`、`sections.findings`、`sections.methods` 在 schemaVersion 2 中移除，
不再读取 `evidence()`、`findings()`、`method_facts`；读取旧快照时忽略这三项。

内部 ID 只在捕获时用于解析引用。快照保存解析后的公开名称，以及一个仅供校验的 `inputId`。
分类在渲染端由这些字段确定性计算，不另存类别字段。

每个 section 继续使用现有的 `not-captured` / `unavailable(reason)` / `captured` 三态。Runtime 缺少某个成员时
报 `runtime-incompatible`，不回退到其他读法。超出预算报 `budget`，不截断成看似完整的结构。

### 前置修复

插件的坐标 part 枚举与 Marivo 不一致：插件用 `actual_start/actual_end/timezone`（`snapshot.ts:33`、
`python/presentation-kit/src/dsh_data_analysis_presentation/_frame.py:337`），Marivo 是 `label/nominal_start/nominal_end`。
现在不传 `time_details`，所以没有触发错误，但开启后必然校验失败。按 Marivo 文档，`.start` 是实际观察起点，
名义起点是 `.nominal_start`。

## OpenUI Lang 规范

### 签名

```text
AnalysisFrameView(ref: string, view?: FrameView, display?: FrameDisplay)

FrameView =
    {chart: "auto"}
  | {chart: "table", columns?: string[]}
  | {chart: "metric", encoding?: {value: string}}
  | {chart: "line" | "area" | "bar", encoding?: {values?: string[], axis?: string, series?: string}}
  | {chart: "heatmap", encoding?: {x: string, y: string, value: string}}
  | {chart: "comparison", encoding?: {value: string}, style?: "auto" | "delta"}
  | {chart: "decomposition", encoding?: {value: string}, style?: "auto" | "share"}

FrameDisplay = {
  height?: number,                    // positive integer px, max 1200
  density?: "full" | "compact",       // default "full"
  dataTable?: "collapsed" | "visible" // default "collapsed"
}
```

- 与现有 Catalog 一样只用位置参数。`auto`、`table`、`metric` 的写法不变，旧 program 继续有效。
- 相关、成员、记录没有专门的 chart 值，由 `auto` 处理，需要时用 `table`。
- `encoding` 只引用快照里的公开值名和轴名，不接受 ID、表达式或聚合。
- `comparison` 和 `decomposition` 用其中任一输出列的值名定位所属的比较组或分解。
  省略 `encoding` 时，只有在 Frame 中恰好存在一个候选时才合法。
- `style: "auto"` 按上文规则选择（比较为折线或哑铃，分解为瀑布或效应分段）。
- `density: "compact"` 只保留值名、头部数字（没有头部数字时保留主视图）和一个汇总图标，用于 KPI 行和仪表盘。
  视觉编码在 compact 下不变。
- 图标行固定存在，不提供关闭参数。

### 示例

```text
root = Stack([kpis, trend, bridge]);
kpis = Stack([gmv, orders], "row");
gmv = AnalysisFrameView("gmv", {chart: "comparison"}, {density: "compact"});
orders = AnalysisFrameView("orders", {chart: "auto"}, {density: "compact"});
trend = AnalysisFrameView("daily");
bridge = AnalysisFrameView("by_region");
```

### 校验时机

`marivo_present` 在保存前，用资源感知的方式拿 `view` 和实际快照逐项校验：

- 引用的值名或轴名不存在
- dtype 不可绘制
- `comparison` 或 `decomposition` 找不到唯一对象，或缺少所需角色
- `metric` 不是完整的单行结果
- 时间图的 x 不是时间轴
- 会被读成全体的视图（瀑布、份额、类别横条）用在未捕获完整的快照上

不满足时返回结构化错误，不保存，不在渲染时静默降级。渲染阶段只处理候选态，以及旧版快照缺少 section 的情况。

## 组件复用

优先复用 `@openuidev/react-ui` 0.18.1（已是本包依赖）：

- 已在入口导出：`CardHeader`、`Charts`、`Table`、`TooltipWrapper`、`Tag`、`IconTag`、`CodeBlock`、`MetricIndicator`
- 图标：`lucide-react`

实施前需要核实：

- `Modal` 是否从包入口导出。
- Charts 能否画断点、空心点、斜纹、参考线、浮动柱和哑铃。做不到的由本插件在图表外层实现，不修改官方包。
- `MetricIndicator` 的 success/danger 配色不能用，只借用它的布局。

交互与可访问性：

- 图标做成可聚焦按钮并带 `aria-label`，focus 时和 hover 一样弹出 tooltip；触屏上点击即打开详情。
- tooltip 只放短事实，长内容（脚本、期间对应表）放在 Modal 里，可选中、可复制。
- 每个图都能切换到数据表，作为核对数值的方式和可访问的替代内容；图表另需 `aria` 文字摘要和色盲安全调色板。
- “复制数据”沿用现有 TSV 行为，复制当前可见列的精确值。

## Marivo 上游缺口

| 缺口 | 影响 | 建议 |
| --- | --- | --- |
| align 的两侧值对应 | `left.<name>`、`right.<name>` 没有类型化的配对关系，UI 只能把 align 结果当普通值，配对时间只能用表格 | 类似 `comparisons`，公开 align 的 left/right 值对应 |
| share 没有 context | share 是除法表达式，没有 statistic context，UI 无法把它画在 0–100% 轨道上，只能当普通值 | 为 `Column.share` 记录带 along 分组的 statistic context |
| correlate 的操作数 | coefficient 的 context 不带 x、y 的值名，标题写不出“谁和谁” | 在 `FrameStatisticContext` 上记录操作数值名 |
| 显示名（可选） | lineage 只有 kind/path/definition_id，标题只能用值名 | 按现状可接受 |
| 指标方向（可选） | 没有它就只能用中性色 | 按现状可接受 |

## 分阶段实施与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| F1 契约与捕获 | 修正 part 枚举；`capture_frame` 与 codeRef 绑定；schemaVersion 2 字段与预算；捕获 `read_periods` 页 | presentation-kit 单测覆盖各操作产出（observe、compare、attribute、reduce、correlate、align、fix/where 之后），以及 `runtime-incompatible` / `budget`；TS 契约测试；一次真实 Runtime 捕获 |
| F2 外壳与基础类 | 分类函数；外壳、chips、图标行、表格；观察与统计的全部形状、广播参考线、统计符号；相关；成员；保存时校验 | 分类函数对每个操作的真实快照有单测；组件测试覆盖通用视觉编码；Host UI 截图 |
| F3 比较 | 头部数字与端点标签、虚实双线与 Δ 细柱、哑铃、多 alias 切换 | calendar 与 ordinary 两种比较的真实 Frame |
| F4 分解 | 父级小图、瀑布、效应分段、份额轨道、restricted 断开 | 可加、rate/mix、Shapley 三类真实 attribute Frame，以及 where/fix 之后的 restricted |

各阶段需要同步修改：

- `src/presentation/contracts/analysis-catalog.ts` 中的签名
- `marivo_present` 的工具描述
- 模块文档：[展示数据投影](../modules/presentation-projection.md)、[分析文档 reader](../modules/presentation-reader.md)
- 随包 Skill：`skills/dsh-data-analysis-presentation/references/` 下的 `analysis-catalog.md`、`analysis-ui.md`、`examples.md`。这部分需要用户单独授权。

## 不做

- 展示 Evidence、Finding 和计算过程。
- 用横幅、脚注或说明句解释图表。
- 前端聚合、补零、求和、计算 Δ 或占比。
- 从值名、列名、dtype 或 Catalog 推断轴、比较、配对或可加性，或据此上卷。
- 把“同比/环比”“排名”“原因”写进组件文案。
- 用 SQL 作为来源（暂不考虑），或接受模型提供的来源文本。
- Frame 之间的联动、筛选器、在线续读。
