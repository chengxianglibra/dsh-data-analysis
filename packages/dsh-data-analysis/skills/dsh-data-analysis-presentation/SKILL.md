---
name: dsh-data-analysis-presentation
description: 创建或编辑分析报告、看板及可视化结果。尽早展示草稿，复用准确固定结果并增量预览，优先使用 AnalysisFrameView，完成后保存一次；刷新已保存报告时只替换组件数据源。
---

# 增量创建报告与刷新数据

报告或看板任务在准备数据前进入本流程。分析正确性由文件分析或 Marivo 分析流程负责，本 Skill 负责展示与保存。已有结果且只需一次明确修改时，可直接用 `stage:"save"` 提交修改；需要持续计算的报告按以下流程增量预览。

## 组件与数据准备

多个视图可复用同一准确固定结果和生产 `codeRef`，不为不同图形重复计算。新计算在新进程中显式读取原始来源、共享定义或准确固定结果，计算并持久化；不依赖前次内存或临时表。派生结果使用新输出和自己的代码记录；`codeRef` 不证明完整依赖图。

每个 `AnalysisFrameView` 或 `DatasetView` 使用独立命名语句；相同结果可共享资源名，需不同标签时可声明同一引用的不同资源名。新结果绑定其生产脚本回执的 `codeRef`。纯布局与文字无需 Python；分析生成的 Image 目前不支持 codeRef 绑定。

有合适的 governed 语义和公开分析能力时，优先持久化 AnalysisFrame 并用 `AnalysisFrameView` 呈现，保留分析结构和来源事实。纯文件计算或合法外部计算结果使用 `DatasetView`，不为选用 FrameView 强行建模，也不为画图把已有 Frame 转成 DataFrame。已有独立结果符合范围和时效时可复用；不为补脚本记录重算或声称缺少来源的结果满足脚本追溯。

通过 `resultMetadata` 选择准确列、值和轴；`marivo_present` 的 `resultMetadataJson` 和配置错误提供准入快照的覆盖与候选名。配置修复只改展示，不为取元数据重跑业务计算。首次交付持久结果时读[结果引用](references/capture.md)。组件和图形选择见[视图与布局](references/analysis-ui.md)，OpenUI Lang 参数以生成的[组件签名](references/analysis-catalog.md)为准。

首次分析或持久化前按结果引用参考核对当前 Workspace 的 `marivo.toml`，缺少时显式初始化；不继承父项目或手写 manifest。

## 新建报告：边分析边更新

1. 明确是报告任务及已知问题、范围后，在准备数据和完整页面规划前调用 `marivo_present(surface:"tab", stage:"preview")` 展示草稿。初始 `program` 可以只有标题、范围和待回答的问题，省略 `resourcePatch`；不引用未就绪资源，不预写未验证结论。不等完整分析。
2. 按实际依赖与资源预算安排新计算，优先复用已有准确结果。任意 Python 和草稿写入当前由 Harness 串行调度，不承诺并发。Frame/DataFrame 在生产调用内持久化，通过 `resultVariables` 导出准确引用；保留 `resultRefs`、生产 `codeRef` 和有界 `resultMetadata`。
3. 结果就绪后及时 preview，不等全部计算完成；同批已就绪、相关的视图可一次连贯更新。使用上一成功回执的 `draftId/draftRevision`，用 OpenUI Lang 提交本次新增或替换的完整命名语句，并更新布局使组件从 `root` 可达。`resourcePatch.put` 只提交新增或替换的资源，`resourcePatch.remove` 显式删除资源；未提及的资源保留。单组件展示失败时保留已有草稿，处理或说明问题，其他无依赖计算可继续。
4. 核对请求覆盖、数据与结论一致性及实质限制后，用最新草稿标识调用一次 `stage:"save"`，可同时提交最后一批修改。正式历史只新增一个版本，成功返回 `recordId`。未完成部分明确说明，不把预览成功当成正式保存。

报告和看板使用 `surface:"tab"`；聊天内的可视化工作稿可用 `surface:"tool"`。stage 与 surface 独立。Native 调用把 surface、stage、草稿和基版本标识放在 program 前，生成中的 Lang 是候选，新资源在调用校验成功后才显示。PTC 按实际工具 dispatch 更新。

preview 校验并更新草稿，由前端自动展示；成功回执不证明浏览器已渲染。每个 Session 同时只有一个当前 Turn 草稿，对它的 preview/save 必须串行。携带草稿标识必须显式指定 stage。草稿不跨 Turn 或 Host 重启保留；结束 Turn 前保存，或说明未保存及阻塞。缺上下文或冲突时读[恢复参考](references/recovery.md)，调用示例见[页面示例](references/examples.md)。

## 已保存报告：只刷新数据

用户要求更新已保存报告的数据时，直接按[数据刷新](references/data-update.md)执行，不要求用户再声明“保持布局”。锁定页面程序、组件数量/类型/顺序/嵌套、资源名、view/display、正文、标题、语言和列标签。按实际固定结果显式重算并 preview 同名资源替换，同一新结果可以供多个原有视图使用，最后保存一次。不能为通过校验换图形、删组件或改口径。

明确要求改布局或正文时，才进入页面编辑：读取准确基版本，保留未请求修改的内容，增量 preview 变更后统一保存。若还要新数据，其准备仍使用显式输入和新持久输出。数据刷新不隐含页面编辑。

## 表达与完成

用 `TextContent` 写解释，数据视图呈现可核对的数值和图形，`Stack`、`Card`、`Tabs` 组织阅读。数据视图已有结果外壳，不为单个视图再加装饰性 Card。已有图片或不支持的图形可用 Image，需要核对原值时配独立数据视图。

草稿尚无结论时展示问题和证据缺口；结论成立后把结论、支持数据和影响解读的范围、分母、缺失项放在一起。比较、归因和覆盖检查见[叙事与证据](references/narrative.md)。成功保存后简短交付；失败时说明真实状态并给出已有支持的答案。
