# 展示 Skill

## 当前入口与责任

presentation Skill 负责已有结果的表达与交付，Marivo 拥有分析事实，Harness 拥有 Skill 生命周期。
单 Frame/DataFrame 快照直接调用 marivo_present，无需额外 Skill 或回读；自定义布局按需读取同 Catalog 生成的
[八组件签名](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-catalog.md)及
[Lang、capture 与更新示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-ui.md)。
Native 自定义 Lang 消费真实参数前缀，更新使用准确 basedOnRecordId 与变化语句。resources 省略继承，
提供则替换完整表；纯展示修改不重新读取快照。成功不默认回读，不强制先大纲后补全。

入口为 [SKILL.md](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/SKILL.md)。
Frame v2 的 AnalysisFrameView 按结构自动选择视图，也可从已验证的图形类型中显式选择；DatasetView 支持
auto/table/metric 及显式列映射的 line/area/bar/heatmap，不定义分析语义。Frame 在原分析中由 `capture_frame` 捕获并以 `frame-snapshot` 引用。Skill 不包含全局筛选、Draft、HTML 导出或发布资源。
[叙事与证据检查](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/narrative.md)与
[完整示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples.md)按需读取。

## 发现与路由

Plugin 用独立 filesystem provider `dsh-data-analysis-presentation` 读取包内 `skills/`，不扫描默认 roots，
不监听目录变化。Runtime 的 `marivo-analysis` 与 `marivo-semantic` 继续由 `dsh-data-analysis-marivo`
provider 读取当前 Runtime；展示 Skill 不复制这些内容，也不新增 live Help target。

每个 Agent 的常驻 prompt 只保留短路由：

- Marivo 分析报告/dashboard 统一使用 `marivo_present`，把结论、解释、限制、建议与数据放在同一份文档中，
  成功后最终文字尽量只写一句总结。
- 普通事实问答与简短比较表格可留在聊天中；明确指定的 CSV、JSON、PNG 等文件使用原生 `present`。
- 已捕获的单个 Frame 或 DataFrame 快照直接通过 `marivo_present` 交付；自定义 Lang 或需要格式指导时加载
  `dsh-data-analysis-presentation`。Frame 优先使用 `AnalysisFrameView`，通过 `TextContent` 与布局组件组合说明。
- 直接文件分析加载 `dsh-data-analysis-files`，使用 pandas 或原生 DuckDB；已有 Frame 或已捕获快照无需先激活分析 Skill。涉及 Marivo 分析语义或建模时，按需加载 Runtime Skill 与相关 live Help。

展示 Skill 的激活不改变 Runtime Skill 的 Help 披露状态。工具入口随插件安装，完整清单见 [Agent scope surface](plugin-integration-delivery.md#agent-scope-surface)。

## 文件分析与展示的分工

[文件 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md)负责文件读取、计算和收尾：
核对粒度、单位、比较基准、缺失分支与证据强度，文字回答也适用。普通文件生成与原生声明分别确认；
[交付参考](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/references/delivery.md)集中说明缺失能力、
失败恢复、PTC 与跨 Session 文件边界。文件 Skill 还负责识别可复用语义候选，仅将当前所需或已授权的最小
缺口交给 `marivo-semantic`；范围外机会只在答复中说明，原问题完成或阻塞明确后停止。具体建模、复用和
验证仍由 Runtime Skill 拥有。展示 Skill 接收已有结果，核对表达一致性，缺数据时回到分析流程。

## 内容组织与数据边界

Frame 使用准确 Session/Artifact 引用。文件分析及 SQL 结果在原进程转成 DataFrame 后 capture，成功回执返回 snapshotRef，
执行归属及 codeRef 由 Host 绑定，不要求模型手填。SQL 转换可能改变 NULL/整数类型并损失捕获前精度，helper 不修复。
不强制每条 SQL 捕获，不为呈现重新执行结束的分析，不给 Dataset 补造 Artifact、Evidence 或来源。

展示只使用八组件 Lang 与已保存资源。

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

## 交付与验证

默认 tool，明确要求报告/dashboard 用 tab；参数建议先交付位置和基版本，再 resources、title、program。
半截 patch 不正式合并；保存冲突后核对当前版本与意图，不只替换 ID 重试。缺少准确定义时才 marivo_ui_read。
已有快照不证明当前数据新鲜度。交付、失败与格式边界见[展示交付](presentation-delivery.md)。

包验证检查 Skill 与 references 分发；`tests/presentation-skill/` 核对链接、frontmatter、Catalog 签名一致性、
已移除能力不再出现，以及示例符合当前 `marivo_present` 输入与 Lang 契约；真实模型核对路由、披露量和调用轨迹。
