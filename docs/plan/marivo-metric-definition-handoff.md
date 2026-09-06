# Marivo 指标口径可视化接口交接

## 状态与目标

- 日期：2026-09-05。
- 状态：交接原稿保留；2026-09-06 已接入 Marivo 新公共 `details().definition.to_dict()`，实际行为见[模块说明](../modules/semantic-browser.md)。下文接口草案不是当前 schema，当前 schema 以 Marivo 公共实现为准。
- 接收方：Marivo；消费方：`dsh-data-analysis` 的[只读语义层浏览器](../modules/semantic-browser.md)。
- 核对基线：本机已安装 Marivo 0.5.3；相邻 Marivo checkout 的 `pyproject.toml` 为 0.5.3.dev0。下述相关 Catalog 定义在两者中均已核对。
- 目标：让用户仅通过已加载 Catalog 理解指标“算什么、怎么算、按什么时间算、有哪些限制”，不执行分析或预览。

本交接只要求补足公开、结构化、可序列化的语义读取能力。界面布局、中文标签、解释模板和交互仍由插件实现。
不修改当前 Marivo 指标计算、时间边界、有效性判定和执行契约，也不建立插件侧语义注册表。

## 触发案例与成功标准

项目：`/Users/lichengxiang/source/oss/marivo-ecommerce-demo`。

指标：`metric:growth.retail_quarter_to_date_campaign_spend`。

定义见 [campaign_performance.py](../../../marivo-ecommerce-demo/models/semantic/growth/campaign_performance.py)：

- 第 112–128 行：`ms.cumulative`，基础指标是 `growth.campaign_spend`，时间轴是 `growth.campaign_performance_daily.activity_date`。
- 累计起点为 `grain_to_date`；粒度由 `commerce.retail_calendar` 的 `retail_quarter` 层级决定。
- 第 81–92 行：基础指标对 `campaign_spend` 度量执行 `sum`，单位为 CNY。
- 第 56–67 行：度量取 `spend_cny` 并转换为 `float64`。
- 第 4–38 行：实体主键是 `activity_date + campaign_id`，时间维度是日粒度、Asia/Shanghai，候选维度为 `campaign_id`。
- 指标的业务限制为已记录的每日支出，不代表摊销支出或开票支出。
- [commerce/temporal.py](../../../marivo-ecommerce-demo/models/semantic/commerce/temporal.py) 声明该零售日历及其层级、边界时区和覆盖范围。

用户应能沿以下路径逐层展开，并跳转到相关对象：

```text
当前指标：零售季度累计
  ├─ base → growth.campaign_spend：求和
  │           └─ measure → campaign_performance_daily.campaign_spend
  │                           └─ 已支持时展示：spend_cny 转 float64
  ├─ over → campaign_performance_daily.activity_date
  └─ anchor → grain_to_date
                └─ calendar → commerce.retail_calendar
                     level → retail_quarter
```

自然语言摘要应有结构化依据，例如“按所属零售季度累计已记录营销支出，单位 CNY”。
在未提供观察时间和过滤条件时，不得声称“截至今天”、固定季度起止日期或具体结果。
零售季度不能按名称推断为自然季度；具体边界仍由 Marivo 的时间契约与对应日历确定。

## 现状：已具备的能力与实际缺口

| 项目 | 当前公开能力 | 缺口与归属 |
|---|---|---|
| 对象身份和业务说明 | Ref、名称、域、业务定义、guardrails、源码位置和 Python 符号 | 无需新建；插件应展示并保留说明的来源对象 |
| 简单聚合 | `SimpleMetricDetails` 提供 aggregation、target、measure、filter、weighted mean inputs 等 | 已有信息应保留类型；不要由插件先转成字符串再解析回来 |
| 派生组成关系 | `DerivedMetricDetails` 提供 composition、components、linear_terms | 可恢复基础组成关系；缺少统一且有操作参数的公开定义节点 |
| 累计规则 | 内部 `CumulativeComposition` 有 base、over、anchor | **P0 缺口**：Details 没有公开 over 和 anchor 的结构化内容 |
| 表达式树 | Details 的终端显示可输出 expression_tree | 数据来自私有 `_expression_tree_rows`；`render()` 返回文本，不能作为机器协议解析 |
| 候选分析范围 | effective_entities、candidate_dimensions、candidate_time_dimensions、measure_lineage | 已有；候选时间轴不等于实际累计时间轴，候选维度不代表任意组合已通过校验 |
| 叶子度量/维度表达式 | Details 有实体、单位、类型等；内部保留部分列映射和表达式相关信息 | **P1 缺口**：缺少统一的公开、受控表达式读取，难以解释到物理列及变换 |
| 半可加性 | Metric Details 有分类、fold、status_time_dimension；Measure Details 只有分类 | **P1 缺口**：度量层应可读到时间轴和折叠规则，不能只显示 semi_additive |
| 周期日历 | `PeriodCalendarDetails` 提供层级、时区、覆盖和快照状态等 | 优先复用；需要从累计定义明确关联到 calendar + level，不应另建日历规则 |

内部代码仅用来确认已有权威信息所在位置，不能成为插件的调用依赖。

## P0：公开结构化计算定义

### 1. 累计定义参数

至少提供以下信息，采用公开 Ref 和现有时间类型的受支持序列化方式：

| 字段概念 | 必须保留的语义 |
|---|---|
| base | 精确的基础 Metric Ref |
| over | 显式时间轴 Ref；未声明时明确标记使用默认选择，不用第一个候选轴代替 |
| anchor | 区分 all_history、grain_to_date、trailing |
| grain_to_date 的 grain | 区分内置粒度与语义日历粒度；后者包含日历 Ref 和 level |
| trailing 的参数 | 数量与单位；不得折算后丢失声明含义 |
| 时间选择状态 | 区分声明值、已有权威规则可确定的值、需要查询上下文才能决定的值 |

是否暴露已解析时间轴，由 Marivo 根据现有契约决定；不能为了浏览而替用户选择时间轴。
包含/排除边界、重置、空值和补点等语义由 Marivo 定义。必要的静态说明应引用现有契约，不从示例结果反推。

### 2. 统一的定义节点与带角色引用

推荐在 `entry.details()` 上提供类型化的计算定义值，让列表、详情和关系都能来自同一次 Catalog 加载。
最终字段名和类型名由 Marivo 决定；以下是能力建议，不是要求照搬的新 DSL：

- aggregate：操作及参数、目标 Ref、目标类型、声明过滤条件。
- weighted mean：value 和 weight 的 Ref；复用当前语义，不自行推导空值或分母为零的行为。
- ratio：numerator、denominator 的 Ref。
- linear：保持原顺序的项，每项含正负号和 Metric Ref；重复引用也不能合并丢失。
- cumulative：base、over 和完整 anchor。
- 自定义函数体：显式区分为表达式型定义；若不能安全结构化说明，标记说明不可用并保留对象及定义位置。

优先“一对象一个直接定义节点 + 带角色 Ref”。消费端可在同一快照中逐层展开已有对象，避免给每个指标重复复制整棵闭包。
如 Marivo 另提供闭包读取，应说明去重、顺序、深度/数量限制、缺失节点和截断状态，不静默给出看似完整的树。
共享子表达式的身份使用现有 Ref；不建立第二套对象 ID。

### 3. 公共序列化与可用性契约

- 提供受支持的 JSON 安全序列化；操作、参数、角色、Ref 和过滤值保持结构化类型。
- 区分“不适用”“未声明/使用默认”“不支持说明”“读取失败”，避免全部变成 `null` 或 `—`。
- 复用 Catalog definition fingerprint 作为本次定义快照标识；不把它解释成数据新鲜度或分析 readiness。
- 未知定义类型显式标记或失败，不能降级成错误公式。
- 同步类型文档、live help 和终端展示；终端 expression_tree 与新结构化定义应共享投影来源。
- 不要求通用 `asdict` 导出整个 Details、IR、Registry 或 Python 对象。

建议数据形态示意（非正式 schema；Ref 的实际编码必须复用 `RefPayloadV1`）：

```json
{
  "kind": "cumulative",
  "base": {"kind": "metric", "path": "growth.campaign_spend"},
  "over": {
    "selection": "explicit",
    "ref": {"kind": "time_dimension", "path": "growth.campaign_performance_daily.activity_date"}
  },
  "anchor": {
    "kind": "grain_to_date",
    "grain": {
      "kind": "semantic",
      "calendar": {"kind": "period_calendar", "path": "commerce.retail_calendar"},
      "level": "retail_quarter"
    }
  }
}
```

## P1：补齐叶子口径与重聚合解释

### 4. 度量、维度和自定义表达式

为列映射和可支持的表达式提供公开、安全的定义描述，例如：

```text
campaign_spend = cast(column(spend_cny), float64)
```

必须由 Marivo 从其已有权威定义生成，插件不读取源码、不遍历私有 AST、不编译 SQL 推测语义。
先明确支持范围，例如列、转换、算术与条件表达式；不要求首版反编译任意 Python 函数。
不支持时返回明确状态及 source location，不能把用户写的业务说明冒充为已验证的计算表达式。
表达式中的常量需要有公开的数据披露边界，不能因为出现在函数体中就自动当作可公开值。

### 5. 可加性与时间折叠

复用现有 `SemiAdditive` 与时间折叠契约，公开度量的 over/fold，并明确区分：

- 度量声明的规则。
- 指标的覆盖规则及最终采用规则（仅在加载阶段可确定时提供）。
- 当前上下文尚不能判断的重聚合能力。

不要把 `non_additive` 自动翻译成“所有维度都不能求和”，也不要把累计值按时间再求和。
浏览器解释只能采用 Marivo 明确提供的含义。

## 职责边界与读取约束

**Marivo 负责**：结构化定义、操作参数、默认值语义、类型化关联、表达式支持范围、精确 Ref、可用性状态与序列化。

**插件负责**：中文标签和固定解释模板、口径卡、计算树、对象跳转、技术属性折叠、来源标注、长名称与窄屏适配。
插件保留原始业务说明；展示译文或建议别名时，应与项目正式名称区分。

已有 guardrails 应按所属对象展示，不由 Marivo 或插件无差别汇总成当前指标的新约束。
用户作者声明的业务含义、从结构化定义生成的解释、运行结果和校验状态必须区分。
`parity_status=verified` 不能展示成业务口径已审批、数据正确或当前查询可执行。

新定义读取在已加载 Catalog 上完成，不调用 observe、preview、连接测试、凭证解析、分析 Session 创建或 readiness。
不新增数据扫描、认证日历、源码读取、SQL 编译或项目文件写入。已有 Python 模型加载的副作用仍需按原加载契约单独对待，
不能宣称新增读取接口能隔离任意作者代码的副作用。

不输出数据源凭证、完整连接配置、原始源码、SQL provenance 内容或任意对象 repr。
如既有公共字段并非安全展示字段，应继续由白名单限制，不扩大导出范围。

## 实施顺序与交付物

1. Marivo 确认 P0 的公开读取入口、定义类型和序列化设计，使用触发案例审查字段是否完整。
2. 实现 P0、公共接口测试、live help 和终端展示一致性测试；验证不增加执行侧依赖。
3. 插件接入公开字段，完成口径卡和可展开计算定义；用真实 Runtime 与浏览器验收。
4. P1 独立交付；其未完成时明确标注叶子表达式不可用，不能声称已展示完整物理列口径。

交付应包含：公共类型与序列化说明、支持矩阵、示例 payload、无执行副作用证据，以及插件可安装验证的版本。
本文不授权修改或发布 Marivo；后续实施任务需明确仓库范围和版本安排。

## 验收清单

| 用例 | 预期 |
|---|---|
| 本文零售季度累计支出 | 准确给出 base、over、grain_to_date、calendar、level；可追溯到 sum 和度量 |
| 默认 over | 保留默认选择含义；不把 candidate_time_dimensions 第一项当成权威答案 |
| all_history / 内置 grain_to_date / trailing | 保留各自类型及全部参数，不互相混淆 |
| ratio / weighted mean / linear | 区分输入角色；线性项符号、顺序及重复引用不丢失 |
| 聚合目标与过滤 | 区分实体计数、度量聚合、参数化聚合；保留声明过滤值类型及其语义 |
| 多层组合、共享输入、跨域日历 | 精确 Ref、可追溯角色和一致的快照身份；不将所有边都标成同一种依赖 |
| 自定义函数与不支持表达式 | 显式说明支持状态，保留定位，不生成猜测公式 |
| 半可加度量及指标覆盖 | 区分声明与有效规则，不丢失 over/fold |
| 中文、长说明、恶意文本 | 业务说明按文本显示，不执行 HTML；不泄漏源代码或凭证 |
| 只读边界 | 已加载 Catalog 的定义读取不触发数据访问、Session 或文件写入；测试替身禁止相关入口 |
| 真正端到端 | 当前项目在真实 Runtime 和浏览器中可查看口径及跳转；不能只用组件测试代替 |

P0 验收不要求得到具体日期的累计金额，也不要求执行 readiness 或认证日历。

## 实现定位与参考

- [Marivo Catalog](../../../marivo/marivo/semantic/catalog.py)：`SimpleMetricDetails`、`DerivedMetricDetails`、`MeasureDetails`、`_metric_expression_row`、`_metric_analysis_metadata`、`_build_metric_object`。下划线函数仅作为维护者定位信息。
- [Marivo semantic IR](../../../marivo/marivo/semantic/ir.py)：`CumulativeComposition`、`RatioComposition`、`LinearComposition`、`WeightedMeanAggregation`、`SemiAdditive`。内部定义不是消费者接口。
- [Marivo 文本渲染协议](../../../marivo/marivo/render.py)：`RenderableResult.render()` / `.show()`；不作为 JSON 协议。
- [插件 Python 投影](../../packages/dsh-data-analysis/src/semantic-browser/program.ts)：当前字段白名单及字符串化逻辑。
- [插件展示协议](../../packages/dsh-data-analysis/src/semantic-browser/contracts.ts)：当前 `DisplayField.value` 为字符串；接入新定义时需保留计算结构。
- [插件验收记录](../acceptance/semantic-browser.md)。

加载错误的安全诊断是另一个已观察到的问题，可单独立项；它不应阻塞或扩张本次指标口径接口交付。
