# 展示 Skill

## 职责与披露层次

[展示 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/SKILL.md) 拥有报告的组件拆分、早期草稿、增量编写、数据刷新与保存流程。用户要求报告或看板时，在准备组件数据前加载；普通单结果可以直接使用工具。分析方法与正确性由 Runtime 分析 Skill 或文件 Skill 拥有，展示保存不证明分析正确。

| 披露入口 | 所有内容 |
| --- | --- |
| 常驻 Host Prompt | 任务路由、绑定执行入口、显式输入与固定结果复用、早期预览、就绪更新和刷新保持页面的核心规则 |
| 插件 Skill | 任务流程与判断、组件粒度、数据源选择、停止条件 |
| Tool 与参数说明 | 输入、操作效果、返回身份、状态和调用限制 |
| references | 结果引用、视图选择、示例、数据刷新和冲突恢复的按需细节 |
| Marivo live Help | 公开计算、持久化和恢复 API 的实时事实 |
| 生成的组件签名 | OpenUI Lang 组件参数；不复制流程或 Marivo API |
| 引用上下文与错误 | 固定来源、覆盖范围、失败条件与修复边界，不授权页面编辑或重新查询 |

资源准入、保存与回执遵循[展示交付](presentation-delivery.md)。[结果引用](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/capture.md)说明插件的引用接缝，[恢复参考](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/recovery.md)只在缺上下文或失败时读取，正常 preview 不例行回读。

Skill 入口不超过 6 KiB、单份参考不超过 16 KiB、每个 Skill 全部资源不超过 48 KiB。这是披露体积上限，不等同于模型 token 数。

## 发现与责任边界

Plugin 激活时按嵌入当前工具构建的清单与摘要核验全部随包 Skill 资源，并用独立 filesystem provider `dsh-data-analysis-presentation` 挂载内容寻址的只读快照，正文与 resourceBase 引用同一快照；不扫描默认 roots、不监听目录变化。旧 Host 保留旧快照，重建不能混入新引用文件；构建不匹配明确失败，策略见[插件集成与交付](plugin-integration-delivery.md)。Runtime Skill 由 `dsh-data-analysis-marivo` provider 挂载，插件不改写其正文，也不新增报告 live Help target。当前 Marivo 包提供 marivo-analysis 与 marivo-semantic；Runtime 的可选 service Skill 支持仍由安装和披露模块拥有，常驻提示仅在绑定 Runtime 提供 marivo-service 时引导加载。

展示 Skill 激活不改变 Runtime Skill 的 Help 披露状态。工具入口见 [Agent scope surface](plugin-integration-delivery.md#agent-scope-surface)。

[文件 Skill](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md) 负责准确附件路径、读取计算、质量核对、共享语义交接及普通文件交付。文件报告在准备数据之前接入展示流程，按组件返回结果。普通文件无需为使用 FrameView 强行建立语义模型；真正需要的共享定义由 marivo-semantic 拥有。

## 固定结果复用与早期草稿

数据视图使用独立命名语句，但可共享一个准确固定资源或引用，保留原生产 codeRef，不按视图数量重复计算。新计算在独立进程中显式读取输入、计算和持久化，不依赖前次内存或临时表；可读取原始来源、governed 定义或公开固定结果。派生输出使用新持久引用与自己的代码记录。新 Frame/DataFrame 结果通过 resultVariables 导出并绑定生产调用 codeRef；这只证明执行导出关联，不证明完整依赖图。一个视图内部的图形、详情表和 tooltip 是同一组件；纯布局与静态文字没有 Python 数据任务。分析生成的图片也用独立脚本，但当前 image-file 声明不支持 codeRef。

适用的 governed 分析优先保留 AnalysisFrame 并使用 AnalysisFrameView；纯文件或合法外部结果使用 DatasetView。组件选择见[视图与布局](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-ui.md)，参数以生成的[组件签名](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/analysis-catalog.md)为准。

首次分析或持久化前，Agent 按[Workspace 契约](runtime-workspace.md#workspace-解析与-zero-init-binding)检查当前根目录的 manifest，缺少时用绑定 Runtime 显式初始化。结果引用参考提供该独立环境准备调用；它不是组件生产脚本，也不改变插件安装的 zero-init 行为。

已有结果且只需一次明确修改时可直接 save；需要继续分析的报告任务及已知问题、范围明确后，在数据准备和整页规划前先用已知问题/范围创建 stage:preview 草稿；不引用未就绪数据、不预写结论。结果就绪后及时更新同一草稿，同批已就绪相关视图可连贯提交，不等待完整分析。当前任意 Python 和草稿写入都保持 Harness exclusive 调度，不声明 isConcurrencySafe，也不承诺并发。同一草稿使用最新成功修订。携带 draftId 或 draftRevision 而省略 stage 时，在默认 save 应用前返回 analysis-draft-stage-required；仅无草稿身份的独立请求仍可省略 stage 直接保存。单组件展示失败保留已有草稿，处理或说明问题，不阻塞其他无依赖计算。resourcePatch 只携带新增、替换或删除的资源，program 使用可从 root 到达的命名语句 patch。最后核对内容并 stage:save 一次，只新增一个正式版本。

新报告固定在 Chat 的同一报告区展示，由读者点击“在边栏查看”图标后在同一原生 Tab 持续更新，Chat 隐藏正文、标题和链接，关闭后恢复；目录及版本入口始终在右侧打开。Agent 不传 surface，也不选择阅读位置。Native 参数前缀是未校验候选，PTC 按工具 dispatch 更新。preview 是工具校验并更新内存草稿，前端自动读取展示；成功回执不证明浏览器完成渲染，不要求浏览器检查或用户确认。草稿生命周期见[展示交付](presentation-delivery.md#报告草稿与正式保存)。

## 已保存报告的数据刷新

数据刷新锁定 program、组件组成、资源名、view/display、正文、标题、语言和列标签。先通过 marivo_ui_read 读取基版本和脚本；需要计算时展示该版本的草稿副本，再显式重算所需固定结果、preview 同名资源替换；共享输入结果的原有视图可复用同一新结果，最后保存一次。上下文和新结果已就绪的单次刷新可以直接 save。新数据必须满足原视图；错误修复不授权换图、删组件或改变口径。步骤见[数据刷新](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/data-update.md)。

明确要求页面编辑时，才按请求 patch 布局或内容。冲突恢复也区分两种目的：数据刷新基于审阅后的当前正式版本，只合并兼容资源并省略 program，不合入旧草稿布局。

早期交付与结果准备节奏属于 Agent 工作流规则，不是提前交付的服务端保证；草稿身份必须显式选择 stage 由 Tool 校验。Tool 仍支持一调用多个输出、可选 codeRef 和通用页面编辑；Host 验证执行导出与引用关联，不证明脚本独立或最初计算来源。相同声明复用旧快照或图片，不等于刷新。auto 及部分分析视图可能随数据结构调整内部布局；program 相同不保证视觉完全相同。TextContent 静态数字不随资源改写，明显失效结论需说明，不能冒充完整刷新。

## 配置元数据

Python 成功结果导出同时尽早交付有界 resultMetadata：Frame 直接读取准确持久结果的公开 schema，披露列、值和轴名，行数未知明确为 null；DataFrame 使用公开 read_dataframe 的 schema 与 row_count，该 API 会完整读取固定结果但不读业务来源。元数据失败独立标为 unavailable，不改变执行或引用导出状态。

marivo_present 的 resultMetadataJson 和模型渲染文本只披露本次新增或替换的已准入快照的列类型、轴、值和 coverage，不增加 Python 启动或业务读取；展示配置错误附有界实际元数据。通过它修复配置，不重放分析来取得列名。

## 表达与验证

[叙事与证据检查](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/narrative.md) 在分析推进时核对比较范围、方向、分母、缺失分支和证据强度，区分观测、贡献、解释与假设。Top N 与展示截断分别说明，全量归因保留全量基准与余项。数据视图已有结果外壳，不加仅作装饰的 Card；范围与限制贴近对应结论。

[示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/examples.md) 包含初始草稿、两个独立脚本、逐次 preview 和一次 save 的完整调用链，以及比较抵消、Frame 看板和图片明细。当前 Python 与草稿写入保持串行，示例不暗示 Host 提供并发调度。共享固定结果的示例展示一个结果支持多个视图。Skill 测试验证 frontmatter、链接、体积、签名和 Lang；展示集成测试执行文档中的调用链，通过实际展示工具验证草稿修订、单次保存和刷新程序保留，Python 结果使用受控回执，不替代真实模型/Runtime 验收。

分发检查验证随包资源。真实模型行为还需核对早期预览、独立脚本、就绪结果及时交付、草稿写入串行、正式历史与刷新不变项，区分工作流提示和实际 Host 调度行为，不能用关键词断言或静态检查代替。
