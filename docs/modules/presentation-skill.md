# 展示 Skill

## 责任与入口

`dsh-data-analysis-presentation` 是插件唯一自带的 Skill，负责把展示需求组织成可交付的 Draft：选择
已有数据、组织结论与图形、声明来源、调用 `marivo_present` 并解释结果。Marivo 拥有分析与来源事实，
Harness 拥有 Skill 发现和激活，插件的 projection、reader 与 delivery 分别拥有数据快照、阅读和文件交付。

Skill 入口是 [SKILL.md](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/SKILL.md)。
主文件只保留完整短流程；[schema](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/schema.md)、
[图形配置](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/charts.md)、
[叙事与证据检查](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/narrative.md)与
[示例说明](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples.md)放在 references。
报告、看板和比较型展示必须在写草稿前读取 narrative；其余资源按需读取。
可改写的 Draft、dataset 和 Python 示例随 Skill 一同分发。

## 发现与路由

Plugin 用独立 filesystem provider `dsh-data-analysis-presentation` 读取包内 `skills/`，不扫描默认 roots，
不监听目录变化。Runtime 的 `marivo-analysis` 与 `marivo-semantic` 继续由 `dsh-data-analysis-marivo`
provider 读取当前 Runtime；展示 Skill 不复制这些内容，也不新增 live Help target。

每个 Agent 的常驻 prompt 只保留短路由：

- 普通事实问答使用文字。
- 图表、表格、报告、看板和可读来源展示加载 `dsh-data-analysis-presentation`，通过 `marivo_present` 交付。
- 已有 Artifact 或 computed 数据无需先激活分析 Skill；需要新分析或语义编写时，按需加载 Runtime Skill 与 live Help。

展示 Skill 的激活不改变 Runtime Skill 的 Help 披露状态。当前可见 Tool 仍为 `marivo_help`、
`marivo_datasource_test`、`marivo_python` 和 `marivo_present`，没有展示 convenience Tool 或兼容入口。

## 内容组织与数据边界

Agent 按用途选择数据与表达：Artifact dataset 直接恢复持久化结果；computed dataset 读取 Python writer
生成的 typed JSON；只需解释来源时使用 source-only。来源在 Draft 声明，可为零到多个精确引用。
computed 不要求转换代码、转换分类或复算信息；可恢复来源只说明快照可读取，不能证明计算正确。

Draft 使用五类 block：Markdown、metric、支持 18 类图形的 chart、table 和 source。Agent 决定内容顺序、
图形类型、字段与标签，reader 负责自适应布局，没有网格配置。报告和看板共用同一数据契约与 reader，
不创建新的对象类型、模板协议或长期版本。

结论逐项对应用户问题与比较范围，每组比较明确两侧、方向和分母；缺失分支保留在正文，不能由另一组
成功比较替代。观测、贡献分解、解释和假设使用相应证据强度；边际分布不支持联合关系，原因或排除性
结论需要匹配证据。限制须落实到具体结论措辞，不能仅由末尾免责声明承担。

原值、差值、比例、合计和余项需要核对，正文、图和表保持比较方向一致。Agent 预筛选与 writer 截断
分别披露；Top N 说明规则和范围，全量归因保留全量基准与其他项净贡献。Skill 随附可运行的通用比较
示例，以 200 → 150、减少项 80 和其他项抵消 30 演示数值关系，并由测试核对 writer 输出与图表绑定。
这些是表达和复核引导，不新增结论 schema、业务推理 validator 或审核服务。

来源 Quality/issues 仍属于
原 Artifact。保留 unavailable 来源，不将 unavailable 写成成功验证；reader 与来源展开只读取保存快照，
不自动重新分析。
具体契约见[展示数据投影](presentation-projection.md)与[展示 reader](presentation-reader.md)。

## 交付与验证

Agent 将 Draft 保存为 Workspace 相对路径，调用 `marivo_present({ draft_path })`，依据实际 receipt
解释结果和交付位置。Tool 负责生成 JSON/HTML、完整提交与摘要校验；reader 来源展开只读保存快照。
流程和失败边界见[展示交付](presentation-delivery.md)。

包验证同时检查 Skill 主文件与 references 的实际分发；插件测试检查 provider 接线、短路由和现有
Runtime Skill 的独立性。可安装包实际注册结果、真实 Agent 路由与 Web/离线旅程的结果及限制见
[S5 验收记录](../plan/marivo-analytics-presentation-s5-acceptance.md)。
本次比较范围、证据强度、抵消项与执行收尾的通用修复见
[报告交付与质量修复验收](../plan/2026-09-07-presentation-delivery-quality-acceptance.md)。
