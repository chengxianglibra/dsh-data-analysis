# Agent 原生报告增强能力设计

## 状态与结论

> 当前已实施。插件只提供 Artifact/pandas 数据读取与 Marivo 专属组件，不提供页面模板、chart helper、
> 可视化 DSL、HTML Checker、通用 renderer 或 publisher。

这是一次 clean break。已删除的 Starter、snippets、完整示例、chart helper、静态 Checker Tool/CLI/export 与
turn-scoped disclosure 不保留 alias 或迁移路径。旧 HTML renderer/ReportDocument 仍维持已删除状态。

## 所有权边界

| 所有者 | 职责 |
| --- | --- |
| Marivo | Session、Run、Session Graph、Artifact、Quality、Evidence、Lineage、revalidation 与公共读取语义 |
| 本插件 | Runtime/Workspace binding、实时 Help、credential-safe seam、Evidence UI adapter、数据读取与 Marivo 专属组件 |
| `dsh-data-analysis-report` Skill | 内容组织、布局、样式、检查和文件交付原则 |
| Agent | 报告叙事、页面结构、图表、CSS、交互、通用数据处理与实际检查 |
| DSH | Tool/Skill/session lifecycle、文件 mutation、Produced Files、Host opening |

本插件不得把 Agent 展示选择升级为 Marivo 事实，也不得复制 Marivo 私有 Store、重新执行分析、拥有页面
schema，或把路径存在解释为报告 ready。

## 报告增强面

Python report-kit 公开三个边界明确的 emitter：

- `emit_dataset(BaseFrame, target, revalidation=...)`：读取 `BaseFrame` 的公开 contract、metadata 与
  `to_pandas()` terminal boundary，输出有界 Artifact snapshot；普通 pandas DataFrame 明确拒绝；
- `emit_computed(DataFrame, target)`：输出有界 computed snapshot，不声明 Artifact、Evidence、Quality、
  revalidation、Lineage 或 freshness；
- `emit_session_trace(SessionGraph, target, report_artifact_refs=...)`：忠实投影调用方已取得的有界
  `SessionGraph`；不打开 Session、不读取 Store、不合并 graph。当前固定 Marivo 0.5.2 的 Run 未公开 Query，
  因此投影固定包含空 `queries` 与 `query_bind_values: "omitted"`，不接受调用方补造 Query。

Skill assets 分成数据读取与两个 Marivo 组件：

- `assets/report-data.js`：校验、冻结、注册并读取 Artifact/computed snapshot；
- `assets/marivo-artifact.js`：输出读者导向的精简 Artifact 摘要。正常时只有类型、semantic shape、行数和
  生成时间；仅对截断、Evidence、revalidation、质量检查或 issues 的实质状态追加提示；
- `assets/marivo-session-dag.js`：校验、冻结、注册并按需展示 Session DAG snapshot；Frame 节点显示
  family 与行数，按 `session_id + artifact_ref` 精确关联 preview，并复用 Artifact 摘要组件。

这些文件是实现资产，不是示例或模板。它们不提供颜色系统、页面 shell、KPI、通用 chart、章节或业务
叙事。图表库、类型、DOM/SVG/Canvas 实现、布局、主题和交互完全由 Agent 决定。

一次分析使用多个 Marivo Session 时，每个 Session 独立调用 `session.graph(...)` 和
`emit_session_trace(...)`，浏览器运行时用 `renderSessionGraphs(...)` 分 Session 展示全部 trace。插件不跨
Session 合并节点或推断边；需要 Frame preview 时，Agent 另行恢复该 Session 中的精确 Artifact 并执行
`emit_dataset(...)`。

## 投影契约

`report-contracts/` 只保留 emitter 所需的 common、Artifact/computed dataset、revalidation 与 Session trace
schemas 及测试 fixtures；不恢复 Checker rule registry。

投影必须保留：

- Artifact identity、schema、row count、bounded rows/columns、Quality、issues、Lineage 与显式
  identity-matched revalidation；
- Session Graph 的 Run lifecycle、Artifact summary、edge kind、root/head、failed/incomplete、truncation 与
  boundary identities；
- 有界预算、原子文件替换、脚本安全转义与稳定 receipt。

投影不是 Artifact、Finding、Evidence、当前 semantic authority、完整 Session 历史或 datasource freshness。
需要当前权威时，调用方仍必须显式执行 `session.revalidate(ref)`。

## Skill-only 展示指导

Skill 用原则而非代码示例指导 Agent：

- 内容从受众、决策问题和重要证据出发，区分事实、推断和建议；
- 布局保持明确层级、响应式单列降级、语义结构、对比度和不依赖颜色的表达；
- 图表与表格必须说明问题、单位、时间、缺失、截断和决策含义；
- 页面检查覆盖内容一致性、资源闭合、敏感信息、窄屏、键盘、无脚本、打印、控制台与错误状态；
- 没有浏览器能力时明确未执行视觉检查，任何必需检查失败都保持未完成；
- 资源先写、`index.html` 最后写；Produced Files 与 Host opening 只是导航能力。

插件不再用静态规则替 Agent 判断 HTML、CSS、JavaScript、安全、可访问性或视觉质量。需要机械检查时，
Agent 使用任务环境已有的通用 lint、测试、文件和浏览器能力。

## Package 与运行时

Shared Runtime 同时验证精确 Marivo 与 report-kit identity。npm package 分发 report-kit wheel、四类投影
schema、原则型 Skill、`ReportData` runtime 和两个 Marivo components；不分发 Starter、chart helper、
Checker CLI/export、HTML/CSS shell 或报告示例。

公开 DSH Tool surface 仍只有：

- `marivo_help`
- `marivo_datasource_test`
- `marivo_evidence_sources`

Artifact/DAG emitter 是绑定 Python 中的增强库，不增加 DSH Tool，不承担通用 Artifact inspection/export。

## 验收

确定性门禁必须证明：

- `emit_dataset` 拒绝 DataFrame，`emit_computed` 接受有界 pandas DataFrame；
- Artifact、computed 与 Session Graph emitter 通过 schemas、Python tests 与 wheel smoke；
- `ReportData` 接受两类 dataset；Artifact component 隐藏机器 metadata 并只显示实质提示；DAG 拒绝悬空 identity；
- package 不含 Starter、示例、HTML/CSS、Checker source/types/bin/export 或 rule registry；
- Skill 资源树只有 `SKILL.md`、数据 runtime 与两个 Marivo components，且不包含 chart helper；
- `npm run check`、`npm run build`、`npm run verify:plugin-package` 通过。

真实页面的视觉、键盘、打印、Produced Files 与 Host opening 由具体报告任务按 Skill 原则在实际环境验收；
本项目不再维护一份伪造通用页面质量的报告专用 runner。
