---
name: dsh-data-analysis-presentation
description: 当图表或交互有助于理解、比较或核对结果，或用户要求图表、报告、看板、分析视图及其编辑或刷新时使用。准备数据前加载，尽早展示草稿并持续更新；适用的 governed 分析优先使用 AnalysisFrameView。
---

# 创建分析视图与刷新数据

主动选择能回答问题的最小分析视图，不等用户明确要求报告。用趋势图看变化、对比或贡献图定位差异、数据视图核对精确值；一张图足够时就交付一张图。文字已足够且视图没有额外价值时直接回答，遵循用户明确的纯文字或纯文件要求。

Host 拥有交付形式与流程，文件或 Marivo 分析 Skill 拥有分析方法、正确性与停止条件。已知适合展示时在准备数据前加载本 Skill；分析中才确定时立即加载。新视图需要准备数据时，在首次分析计算前展示问题与范围草稿。只有任务开始时已有就绪结果或一次明确小修改可直接 `stage:"save"`，不要先完成本轮计算再套用此例外。

## 组件与数据准备

在计算前选择结果类型：governed 输入和受支持的类型化分析优先产生并保留 AnalysisFrame，用 `AnalysisFrameView` 展示，不要仅为画图或表格转成 DataFrame。纯文件、外部计算或合适的表格明细可用 `DatasetView`，不为更换视图强行建模。复用符合范围和时效的固定结果及其 codeRef。

新计算显式读取输入，不依赖前次进程内存。用 `marivo_python` 的 `resultVariables` 声明已计算的 Frame、DataFrame 或准确固定引用，工具负责必要的持久化和 resource 关联。待计算 Frame 先显式 compute；执行、导出、来源及 metadata 状态分别核对。原样交付 `results[name].resource`，不手工配对 kind/codeRef。首次交接读[结果导出](references/capture.md)。

每个数据视图使用独立命名语句；多个视图可共享准确固定结果，不为不同展示重复计算。文字和布局无需 Python，已有外部结果缺少脚本时说明来源缺口，不补执行记录。

按 `results[name].metadata` 和 writer 的 `resultMetadata` 选择准确字段；配置失败用结构化错误修复展示，不重跑业务计算。组件选择见[视图与布局](references/analysis-ui.md)，参数以生成的[组件签名](references/analysis-catalog.md)为准。

## 边分析边更新

1. 新视图仍需计算或准备数据时，先用 `marivo_report_write(stage:"preview")` 展示已确认的问题与范围。初始 program 可只有标题、范围和待回答问题，省略 resourcePatch；不引用未就绪资源，不提前编写结论。
2. 按实际依赖与预算计算并导出结果。任意 Python 和草稿写入当前由 Harness 串行调度，不承诺并发；不为每个视图重复读取或计算相同数据。
3. 结果就绪即 preview，同批相关视图可合并更新，不等全部计算。使用上一成功回执的 ref，提交变化的命名语句与资源，使新增组件从 root 可达。单组件失败保留已有草稿，处理或说明失败，继续无依赖工作。
4. 核对请求覆盖、数据与结论一致性及实质限制后，用最新草稿 ref 调用一次 `stage:"save"`，可含最后一批修改。正式历史新增一个版本；未完成部分明确说明，不把预览成功当成正式保存。

每个 Session 有一个当前 Turn 草稿；preview/save 串行并显式指定 stage。回执确认写入状态，草稿在 Turn 结束或 Host 重启时失效。缺上下文或冲突时读[恢复参考](references/recovery.md)，调用见[页面示例](references/examples.md)。

## 刷新已保存视图的数据

用户要求更新数据时按[数据刷新](references/data-update.md)使用 `mode:"refresh-data"`，不要求用户再声明保持布局。保留页面程序、组件、资源名、view/display、正文、标题、语言和标签。显式准备新结果，逐批 preview 同名资源替换，最后保存一次。auto 换图由工具拒绝，内部尺寸仍可随行数变化；不能为通过校验换图、删组件或改口径。

明确要求改布局或正文时才进入 edit：读取准确基版本，保留未请求修改的内容，增量 preview 后统一保存。数据刷新不隐含页面编辑；静态结论与新数据冲突时说明限制，不能声称正文已更新。

## 表达与完成

用 TextContent 写解释，数据视图呈现可核对的数值和图形。按阅读需要用 Stack、DashboardGrid、Card、Tabs 和 Accordion 组织；单个数据视图已有外壳，无需再加装饰性 Card。TextCallout 说明范围和假设。已有图片或不支持的图形可用 Image，需要核对原值时配独立数据视图。

无结论时展示问题与证据缺口；结论成立后将结论、支持数据和影响解读的范围、分母、缺失项放在一起。比较、归因和覆盖检查见[叙事与证据](references/narrative.md)。

每轮最终保存后，用准确 saved ref 提交新的下一步推荐或 no-suggestions，随后继续其他交付。用户明确不要推荐时提交 `items:[]`、`emptyReason:"declined"`；无合适推荐不等于用户拒绝，上一轮未执行的推荐不等于已经回答。

保存成功后，最终聊天通常用一两句话给出核心结论和实质限制，可提示从右侧打开分析视图。完整证据留在视图中，用户明确要求的聊天内容仍直接回答。只有草稿或保存失败时，说明实际状态并给出已有证据支持的答案。
