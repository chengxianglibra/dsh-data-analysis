# 展示 Skill

## 当前入口与责任

[展示 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/SKILL.md) 指导 Agent 基于已有分析结果编写自定义报告和看板。它提供[视图选择](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-ui.md)、由 Catalog 生成的[组件签名](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-catalog.md)、[叙事与证据检查](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/narrative.md)和可直接改写的 [OpenUI Lang 页面示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples.md)。

`marivo_present` 的工具说明拥有面向 Agent 的调用契约。直接展示快照、修改标题或列显示名称时，Agent 只需使用工具。需要设计或调整页面内容和布局时，再加载 Skill。资源准入、保存、更新与回执遵循[展示交付契约](presentation-delivery.md)。

插件自有捕获 API 通过按需[捕获参考](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/capture.md)披露类型、预算与失败语义；首次捕获时加载展示 Skill 定位该参考，不从 Marivo live Help 获取插件 API。
上下文缺失或失败时读取[恢复参考](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/recovery.md)，正常调用不例行回读。常驻路由只保留职责和入口，工具说明保留调用契约，状态与下一步由实际回执提供。
Skill 入口不超过 6 KiB、单份参考不超过 16 KiB、每个 Skill 全部资源不超过 48 KiB，由随包契约测试检查；这些是披露体积上限，不等同于模型 token 数。捕获回执的字段摘要另受[展示数据投影](presentation-projection.md)中的每份与整次预算限制。

## 发现与路由

Plugin 用独立 filesystem provider `dsh-data-analysis-presentation` 读取包内 `skills/`，不扫描默认 roots，
不监听目录变化。Runtime 的 `marivo-analysis` 与 `marivo-semantic` 继续由 `dsh-data-analysis-marivo`
provider 读取当前 Runtime；展示 Skill 不复制这些内容，也不新增 live Help target。

展示 Skill 的激活不改变 Runtime Skill 的 Help 披露状态。工具入口随插件安装，完整清单见 [Agent scope surface](plugin-integration-delivery.md#agent-scope-surface)。

## 文件分析与展示的分工

[文件 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md)负责文件读取、计算和收尾：
核对粒度、单位、比较基准、缺失分支与证据强度，文字回答也适用。普通文件生成与原生声明分别确认；
[交付参考](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/references/delivery.md)集中说明缺失能力、
失败恢复、PTC 与跨 Session 文件边界。文件 Skill 还负责识别可复用语义候选，仅将当前所需或已授权的最小
缺口交给 `marivo-semantic`；范围外机会只在答复中说明，原问题完成或阻塞明确后停止。具体建模、复用和
验证仍由 Runtime Skill 拥有。展示 Skill 接收已有结果，核对表达一致性，缺数据时回到分析流程。

## 内容组织与数据边界

页面引用[展示投影](presentation-projection.md)已捕获的数据，使用八组件 OpenUI Lang 表达结论和布局。

自定义页面由 Agent 在 Harness 中为每个数据视图准备独立的 DataFrame 或 AnalysisFrame 快照。每个组件就绪后用 `marivo_present` 的 `stage: "preview"` 更新同一右侧草稿页。全部内容完成后用 `stage: "save"` 提交最新草稿，生成一个正式版本。草稿的 Session/Turn 绑定、并发及交付契约见[展示交付](presentation-delivery.md#报告草稿与正式保存)。

Frame 和 DataFrame 的数据展示优先使用对应的数据视图，由其自身结果外壳呈现；布局避免仅为单个
视图增加装饰性外框，也不以组件类型或数据形状的说明替代业务解读。影响解读的范围、分母和缺失信息
仍放在相关内容附近。图片资源及数据视图不支持的图形可以使用 Image，需要核对原值时配数据视图。

结论逐项对应用户问题与比较范围，每组比较明确两侧、方向和分母；缺失分支保留在正文，不能由另一组
成功比较替代。观测、贡献分解、解释和假设使用相应证据强度；边际分布不支持联合关系，原因或排除性
结论需要匹配证据。限制须落实到具体结论措辞，不能仅由末尾免责声明承担。

原值、差值、比例、合计和余项需要核对，正文与表格保持比较方向一致。Agent 预筛选与 capture 截断
分别披露；Top N 说明规则和范围，全量归因保留全量基准与其他项净贡献。Skill 随附通用比较
示例，以 200 → 150、减少项 80 和其他项抵消 30 演示数值关系，并由测试核对数值与 Lang 示例。
这些是表达和复核引导，不新增结论 schema、业务推理 validator 或审核服务。

来源 Quality/issues 仍属于
原 Artifact。reader 只读取保存快照及其捕获的来源与范围，不自动重新分析。
具体契约见[展示数据投影](presentation-projection.md)与[展示 reader](presentation-reader.md)。

## 验证

包验证检查 Skill 与 references 分发。`tests/presentation-skill/` 核对链接、frontmatter、组件签名、示例程序及比较数值。`tests/presentation-integration/` 验证工具保存、更新与标签的实际行为。
