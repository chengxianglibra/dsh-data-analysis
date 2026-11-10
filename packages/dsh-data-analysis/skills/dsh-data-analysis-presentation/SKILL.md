---
name: dsh-data-analysis-presentation
description: 创建或编辑分析报告、看板及可视化结果。尽早展示草稿，复用准确固定结果并增量预览，优先使用 AnalysisFrameView，完成后保存一次；刷新已保存报告时只替换组件数据源。
---

# 增量创建报告与刷新数据

报告或看板任务在准备数据前进入本流程。分析正确性由文件分析或 Marivo 分析流程负责，本 Skill 负责展示与保存。已有结果且只需一次明确修改时，可直接用 `stage:"save"` 提交修改；需要持续计算的报告按以下流程增量预览。

## 组件与数据准备

多个视图可复用同一准确固定结果和生产 `codeRef`，不为不同图形重复计算。新计算在新进程中显式读取原始来源、共享定义或准确固定结果，计算并持久化；不依赖前次内存或临时表。派生结果使用新输出和自己的代码记录；`codeRef` 不证明完整依赖图。

每个数据视图使用独立命名语句；相同结果可共享资源名，不同标签可用同一引用的不同资源名。新结果原样使用 Python 返回的完整 resource；文字和布局无需 Python，Image 不支持 codeRef。

适用时优先持久化 AnalysisFrame 并用 `AnalysisFrameView` 保留分析结构；纯文件或合法外部结果使用 `DatasetView`，不为选用 FrameView 强行建模或转换已有 Frame。可复用符合范围和时效的固定结果；不为补脚本记录重算，不把缺少来源说成可追溯。

通过 Python `results[name].metadata` 选择准确列、值和轴；`marivo_report_write` 的结构化 `resultMetadata` 和配置错误提供准入快照的覆盖与候选名。配置修复只改展示，不为取元数据重跑业务计算。首次交付持久结果时读[结果引用](references/capture.md)。组件和图形选择见[视图与布局](references/analysis-ui.md)，OpenUI Lang 参数以生成的[组件签名](references/analysis-catalog.md)为准。

项目分析或持久化使用 `marivo_python(project:"required")`，插件准备绑定 Workspace 根项目，具体失败按回执处理。

## 新建报告：边分析边更新

1. 明确是报告任务及已知问题、范围后，在准备数据和完整页面规划前调用 `marivo_report_write(stage:"preview")` 展示草稿。初始 `program` 可以只有标题、范围和待回答的问题，省略 `resourcePatch`；不引用未就绪资源，不预写未验证结论。不等完整分析。
2. 按实际依赖与资源预算安排新计算，优先复用已有准确结果。任意 Python 和草稿写入当前由 Harness 串行调度，不承诺并发。Frame/DataFrame 在生产调用内持久化，通过 `resultVariables` 导出准确引用；保留完整的 `results[name].resource` 及独立的来源/元数据状态。
3. 结果就绪后及时 preview，不等全部计算；同批相关视图可合并更新。使用上一成功回执的 `ref`，提交新增或替换的完整命名语句，并使组件从 `root` 可达。`resourcePatch.put` 新增或替换资源，`resourcePatch.remove` 删除资源；未提及的保留。候选在完整身份和 patch 到达后才能更新；参数顺序不影响最终正确性。单组件失败保留草稿并处理或说明，其他无依赖计算可继续。
4. 核对请求覆盖、数据与结论一致性及实质限制后，用最新草稿标识调用一次 `stage:"save"`，可同时提交最后一批修改。正式历史只新增一个版本，成功返回 saved `ref`。未完成部分明确说明，不把预览成功当成正式保存。

报告位置由读者管理，不传 surface。流式内容是未保存候选，成功 preview/save 才确认版本；PTC 按实际 dispatch 更新。

preview 校验并更新草稿，由前端自动展示；成功回执不证明浏览器已渲染。每个 Session 同时只有一个当前 Turn 草稿，对它的 preview/save 必须串行。所有写入必须显式指定 stage。草稿不跨 Turn 或 Host 重启保留；结束 Turn 前保存，或说明未保存及阻塞。缺上下文或冲突时读[恢复参考](references/recovery.md)，调用示例见[页面示例](references/examples.md)。

## 已保存报告：只刷新数据

用户要求更新已保存报告的数据时，使用 `mode:"refresh-data"` 按[数据刷新](references/data-update.md)执行，不要求用户再声明“保持布局”。保留页面程序、组件、资源名、view/display、正文、标题、语言和标签；auto 换图由工具拒绝，内部几何仍可随行数变化。按实际固定结果显式重算并 preview 同名资源替换，同一新结果可以供多个原有视图使用，最后保存一次。不能为通过校验换图形、删组件或改口径。

明确要求改布局或正文时，才进入页面编辑：读取准确基版本，保留未请求修改的内容，增量 preview 变更后统一保存。若还要新数据，其准备仍使用显式输入和新持久输出。数据刷新不隐含页面编辑。

## 表达与完成

用 `TextContent` 写解释，数据视图呈现可核对的数值和图形，`Stack`、`Card`、`Tabs` 组织阅读。数据视图已有结果外壳，不为单个视图再加装饰性 Card。已有图片或不支持的图形可用 Image，需要核对原值时配独立数据视图。

草稿尚无结论时展示问题和证据缺口；结论成立后把结论、支持数据和影响解读的范围、分母、缺失项放在一起。比较、归因和覆盖检查见[叙事与证据](references/narrative.md)。每轮最终报告保存后，用准确 saved ref 提交本轮新的下一步推荐，明确无建议可提交 no-suggestions，推荐不结束 Turn，继续完成其他交付；上一轮曾推荐但未执行不等于已经回答。用户明确不要推荐时，以 `items:[]`、`emptyReason:"declined"` 尊重其要求；无合适推荐不应冒称用户拒绝。失败时说明真实状态并给出已有支持的答案。
