# 展示 Skill

## 职责与披露层次

[展示 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/SKILL.md) 拥有报告的组件拆分、早期草稿、增量编写、数据刷新与保存流程。用户要求报告或看板时，在准备组件数据前加载；普通单结果可以直接使用工具。分析方法与正确性由 Runtime 分析 Skill 或文件 Skill 拥有，展示保存不证明分析正确。

| 披露入口 | 所有内容 |
| --- | --- |
| 常驻 Host Prompt | 任务路由、绑定执行入口、独立组件脚本、早期预览、逐组件更新和刷新保持页面的核心规则 |
| 插件 Skill | 任务流程与判断、组件粒度、数据源选择、停止条件 |
| Tool 与参数说明 | 输入、操作效果、返回身份、状态和调用限制 |
| references | 结果引用、视图选择、示例、数据刷新和冲突恢复的按需细节 |
| Marivo live Help | 公开计算、持久化和恢复 API 的实时事实 |
| 生成的组件签名 | OpenUI Lang 组件参数；不复制流程或 Marivo API |
| 引用上下文与错误 | 固定来源、覆盖范围、失败条件与修复边界，不授权页面编辑或重新查询 |

资源准入、保存与回执遵循[展示交付](presentation-delivery.md)。[结果引用](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/capture.md)说明插件的引用接缝，[恢复参考](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/recovery.md)只在缺上下文或失败时读取，正常 preview 不例行回读。

Skill 入口不超过 6 KiB、单份参考不超过 16 KiB、每个 Skill 全部资源不超过 48 KiB。这是披露体积上限，不等同于模型 token 数。

## 发现与责任边界

Plugin 用独立 filesystem provider `dsh-data-analysis-presentation` 读取包内 `skills/`，不扫描默认 roots，不监听目录变化。Runtime Skill 由 `dsh-data-analysis-marivo` provider 挂载，插件不改写其正文，也不新增报告 live Help target。当前 wheel 提供 marivo-analysis 与 marivo-semantic；Runtime 的可选 service Skill 支持仍由安装和披露模块拥有，常驻提示仅在绑定 Runtime 提供 marivo-service 时引导加载。

展示 Skill 激活不改变 Runtime Skill 的 Help 披露状态。工具入口见 [Agent scope surface](plugin-integration-delivery.md#agent-scope-surface)。

[文件 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md) 负责准确附件路径、读取计算、质量核对、共享语义交接及普通文件交付。文件报告在准备数据之前接入展示流程，按组件返回结果。普通文件无需为使用 FrameView 强行建立语义模型；真正需要的共享定义由 marivo-semantic 拥有。

## 独立组件与早期草稿

每个数据视图使用独立命名语句、资源名、持久结果与 Python 调用。脚本在新进程中完成该组件的输入读取、计算和持久化，不依赖其他组件的内存、临时表或执行顺序，可以共享原始输入与 governed 定义。新 Frame/DataFrame 结果通过 resultVariables 导出并绑定该调用 codeRef。一个视图内部的图形、详情表和 tooltip 是同一组件；纯布局与静态文字没有 Python 数据任务。分析生成的图片也用独立脚本，但当前 image-file 声明不支持 codeRef。

适用的 governed 分析优先保留 AnalysisFrame 并使用 AnalysisFrameView；纯文件或合法外部结果使用 DatasetView。组件选择见[视图与布局](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-ui.md)，参数以生成的[组件签名](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-catalog.md)为准。

首次分析或持久化前，Agent 按[Workspace 契约](runtime-workspace.md#workspace-解析与-zero-init-binding)检查当前根目录的 manifest，缺少时用绑定 Runtime 显式初始化。结果引用参考提供该独立环境准备调用；它不是组件生产脚本，也不改变插件安装的 zero-init 行为。

报告流程先展示有意义的草稿，组件数据就绪后及时 stage:preview，不等待全部计算完成。最初可以是空资源映射及仅含标题、范围和待回答问题的 Lang 程序；不引用尚未就绪的数据，不预写结论。Harness 按依赖、能力和资源预算安排独立计算，可以并发；同一草稿的 preview/save 必须串行并使用最新成功修订。单组件展示失败保留已有草稿，处理或说明问题，不阻塞其他无依赖计算。完整资源映射随新增组件提交，program 使用可从 root 到达的命名语句 patch。最后核对内容并 stage:save 一次，只新增一个正式版本。

报告用右侧 tab，聊天可视化工作稿可用 tool。Native 参数前缀是未校验候选，PTC 按工具 dispatch 更新。preview 是工具校验并更新内存草稿，前端自动读取展示；成功回执不证明浏览器完成渲染，不要求浏览器检查或用户确认。草稿生命周期见[展示交付](presentation-delivery.md#报告草稿与正式保存)。

## 已保存报告的数据刷新

数据刷新锁定 program、组件组成、资源名、view/display、正文、标题、语言和列标签。先通过 marivo_ui_read 读取基版本和脚本，展示该版本的草稿副本，再逐组件独立计算、preview 同名资源替换，最后保存一次。新数据必须满足原视图；错误修复不授权换图、删组件或改变口径。步骤见[数据刷新](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/data-update.md)。

明确要求页面编辑时，才按请求 patch 布局或内容。冲突恢复也区分两种目的：数据刷新基于审阅后的当前正式版本，只合并兼容资源；现有 rebase 接口要求 program 时传准确、未改动的当前程序，不合入旧草稿布局。

这些是 Agent 工作流规则，不是新增服务端强约束。Tool 仍支持一调用多个输出、可选 codeRef 和通用页面编辑；Host 验证执行导出与引用关联，不证明脚本独立或最初计算来源。相同声明复用旧快照或图片，不等于刷新。auto 及部分分析视图可能随数据结构调整内部布局；program 相同不保证视觉完全相同。TextContent 静态数字不随资源改写，明显失效结论需说明，不能冒充完整刷新。

## 表达与验证

[叙事与证据检查](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/narrative.md) 在分析推进时核对比较范围、方向、分母、缺失分支和证据强度，区分观测、贡献、解释与假设。Top N 与展示截断分别说明，全量归因保留全量基准与余项。数据视图已有结果外壳，不加仅作装饰的 Card；范围与限制贴近对应结论。

[示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples.md) 包含初始草稿、两个独立脚本、逐次 preview 和一次 save 的完整调用链，以及比较抵消、Frame 看板和图片明细。顺序计算示例是一种可行安排，不是所有任务的调度约束。Skill 测试验证 frontmatter、链接、体积、签名和 Lang；展示集成测试执行文档中的调用链，通过实际展示工具验证草稿修订、单次保存和刷新程序保留，Python 结果使用受控回执，不替代真实模型/Runtime 验收。

分发检查验证随包资源。真实模型行为还需核对早期预览、独立脚本、就绪结果及时交付、草稿写入串行、正式历史与刷新不变项，不限定独立计算的启动顺序，不能用关键词断言或静态检查代替。
