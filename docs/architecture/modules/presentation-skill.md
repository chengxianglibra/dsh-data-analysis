# 展示 Skill 模块

## 责任与入口

Host 常驻路由拥有分析视图的交付策略；随包 `dsh-data-analysis-presentation` 拥有视图编排、增量交付、数据刷新和最终回复约定。分析方法与 Marivo API 分别由分析 Skill 和 live Help 拥有。实现资源位于 `packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/`，接口见[展示交付](presentation-delivery.md)，数据边界见[展示投影](presentation-projection.md)。

Harness 的 Skill provider 与 `skill` 工具提供发现、加载与引用资源读取。插件通过生成的构建清单核验全部随包资源，挂载内容寻址的只读快照；正文和 resourceBase 采用同一快照，不扫描默认 roots，不监听目录变化。旧 Host 继续使用原快照，具体身份与失败策略见[插件集成](plugin-integration-delivery.md)。Runtime 的 marivo-analysis、marivo-semantic 和可选 marivo-service 由独立 provider 挂载，插件不修改其正文。

## 工作流与工具责任

全局路由在用户要求图表、报告、看板或分析视图时进入本流程。用户未指定形式时，只要图表或交互有助于理解、比较或核对结果，就创建能回答问题的最小分析视图。文字足以回答且视图没有额外价值时直接在 Chat 回复，用户指定只要文字或文件时采用指定格式。已知适合展示时在准备数据前加载本 Skill，分析中才确定时立即加载。Runtime 分析 Skill 的通用报告交付建议不替代本 Host 策略；分析方法、证据要求与停止条件仍由分析 Skill 拥有。

任务开始时已有可直接展示的结果或一次明确小修改可以直接 save。新视图仍需计算或准备数据时，在首次分析计算前 preview 已确认的问题与范围，结果就绪后及时更新同一草稿，最终保存一次；不能先完成本轮计算再将其视为已有就绪结果。候选、成功草稿与固定 Build 的事实分开，保存回执只确认已完成写入。

数据视图使用独立命名语句，可以共享准确固定结果。新计算显式读取输入并计算，按实际依赖组织执行，可导出多个结果或从准确固定输入派生，不依赖前次内存。Python 与草稿写入当前保持 Harness exclusive 调度，同一草稿使用最新成功 ref 串行修改。

项目准备、引用关联、版本组合和刷新校验由工具拥有。通过 `resultVariables` 直接声明已计算的 AnalysisFrame、DataFrame 或准确固定引用，省略 `project` 时工具会准备项目并负责必要的持久化。待计算 Frame 须先显式 compute。原样交付 `results[name].resource`；模型不编写初始化样板，不配对 kind/codeRef，不维护 draft ID 与 revision 两字段。所有报告写入显式指定 stage，preview/save 返回可直接续接的 ref。流程示例见[页面示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples.md)。

结果类型在计算前选择：governed 输入和受支持的类型化分析优先产生并保留 AnalysisFrame，使用 AnalysisFrameView，不要仅为展示转成 DataFrame。纯文件、外部计算或合适的表格明细可用 DatasetView，不为更换组件强行建模。脚本关联只证明导出事实，不能证明最初生产来源、完整 lineage 或计算正确性。来源或 metadata 失败不授权重跑业务计算；已有外部固定结果也不需补执行记录。

## 数据刷新与完成

用户要求刷新数据时，以 saved ref 开始 `mode:"refresh-data"`，保持页面与静态正文。工具禁止程序和元数据改动、remove 及新资源名，并验证完整文档和所有受影响视图；每批原子提交。可显式提交已经就绪的子集，答复必须说明仍用旧数据的范围；失败目标不能自动降为 pending。

相同声明返回 reused，不代表新计算。准确引用的共享别名由 reader 分组、writer 提示，更新范围由本次请求明确指定。auto 换成另一图形类型时拒绝，内部尺寸仍可随行数变化。静态正文不会随数据刷新自动改写。详细流程见[数据刷新](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/data-update.md)。

Skill 保留证据核对、解释与停止条件。每轮最终视图保存后提交准确 saved ref 的推荐或明确空状态，随后完成其他交付。最终 Chat 回复通常用一两句话说明核心结论和会改变解读的限制。完整证据和说明放在视图中，用户明确要求的文字内容仍直接回答。只有草稿或保存失败时，回复说明实际状态并给出已有证据支持的答案。API 参数与当前修复动作分别由 schema 和本次结构化错误提供。

## 披露归属

| 原指导 | 当前主要归属 |
| --- | --- |
| 初始化样板与根 manifest 检查 | project 意图及插件准备适配 |
| resultRefs/codeRef 手工配对 | Python 完整 resource 组装 |
| draftId/revision 组合与默认保存 | 单一 ref、必填 stage 的工具校验 |
| 只刷新资源的重复告诫 | refresh-data 服务端原子校验；Skill 保留范围判断 |
| 错误后的机械恢复 | 错误 code/phase/path/recovery |
| 选择分析视图、早期草稿与 Frame 优先策略 | Host 常驻路由；Skill description 提供发现条件 |
| 按策略进入展示流程 | 文件 Skill 与展示 Skill 入口；Harness 负责加载，不做关键词自动执行 |
| 内存结果导出与引用复用 | Python resultVariables；工具负责必要的持久化 |
| 视图编排、增量交付与聊天收尾 | 本 Skill |
| API 签名、持久化与读取语义 | 绑定 Runtime live Help |
| 展示位置、候选、Tab 和临时按钮 | Host/UI |

## 验证边界

Skill 契约测试检查 frontmatter、引用、篇幅、组件签名和 OpenUI Lang 示例解析；报告集成测试验证草稿修订、原子保存与刷新。真实 Runtime、隔离 Host Native/PTC、浏览器与真实模型行为分别验收，关键词或对象形状检查不代替运行证据。
