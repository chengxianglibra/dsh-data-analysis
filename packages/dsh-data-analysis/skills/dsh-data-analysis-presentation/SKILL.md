---
name: dsh-data-analysis-presentation
description: 创建或编辑分析报告、看板及可视化结果。尽早展示草稿，按组件独立准备数据并增量预览，优先使用 AnalysisFrameView，完成后保存一次；刷新已保存报告时只替换组件数据源。
---

# 增量创建报告与刷新数据

报告是分析过程中的持续交付物。用户需要报告或看板时，在准备组件数据前进入本流程；分析方法与结果正确性由文件分析或 Marivo 分析流程负责，本 Skill 负责组件拆分、草稿节奏、页面表达与保存。

## 组件与数据准备

每个承载分析数据的组件必须使用完全独立的 Python 脚本，通过各自的 `marivo_python` 调用读取输入、计算并输出结果。脚本须能在新进程中独立运行，不依赖其他组件的变量、临时表或执行顺序；可以读取相同的原始文件、数据源和共享语义定义。单个组件需要的计算链放在其脚本内，不把多个组件的结果合并到一次调用。

每个 `AnalysisFrameView` 或 `DatasetView` 使用独立命名语句、资源名和持久结果；新结果绑定该脚本回执的 `codeRef`。一个视图内部的图形、数据详情和 tooltip 属于同一组件。纯布局、静态标题和解释文字不需要 Python 数据任务；分析生成的 `Image` 也使用独立脚本，图片资源目前没有数据视图的 codeRef 绑定。

有合适的 governed 语义和公开分析能力时，优先持久化 AnalysisFrame 并用 `AnalysisFrameView` 呈现，保留分析结构和来源事实。纯文件计算或合法外部计算结果使用 `DatasetView`，不为选用 FrameView 强行建模，也不为画图把已有 Frame 转成 DataFrame。已有独立结果符合范围和时效时可复用；不为补脚本记录重算或声称缺少来源的结果满足脚本追溯。

首次交付持久结果时读[结果引用](references/capture.md)。组件和图形选择见[视图与布局](references/analysis-ui.md)，OpenUI Lang 参数以生成的[组件签名](references/analysis-catalog.md)为准。

首次 Marivo 分析或结果持久化前检查当前 Workspace 根目录的 `marivo.toml`。缺少时通过绑定 Runtime 执行 `marivo init --project-root <当前工作区>`，不使用 `--force`；具体调用见结果引用参考。不能误用父目录项目或手写 manifest 代替初始化。

## 新建报告：边分析边更新

1. 明确问题、已知范围和最小必要组件后，尽早调用 `marivo_present(surface:"tab", stage:"preview")` 展示草稿。初始 `program` 可以只有标题、范围和待回答的问题，`resources` 可以为空；不引用未就绪资源，不预写未验证结论。已有结果可立即加入，最迟在第一个组件数据就绪后展示，不等全部分析完成。
2. 按依赖、资源预算和 Harness 能力安排各组件的独立完整脚本，可并发计算。Frame/DataFrame 在同次调用内持久化，通过 `resultVariables` 导出该组件的准确引用；从回执取得 `resultRefs` 和对应 `codeRef`。
3. 每个组件数据就绪后及时 preview，不等全部计算完成。使用上一成功回执的 `draftId/draftRevision`，用 OpenUI Lang 提交本次新增或替换的完整命名语句，并更新布局使组件从 `root` 可达。提供 `resources` 时提交仍在使用的完整映射，它不是局部 patch。单组件展示失败时保留已有草稿，处理或说明问题，其他无依赖计算可继续。
4. 核对请求覆盖、数据与结论一致性及实质限制后，用最新草稿标识调用一次 `stage:"save"`。正式历史只新增一个版本，成功返回 `recordId`。未完成部分明确说明，不把预览成功当成正式保存。

报告和看板使用 `surface:"tab"`；聊天内的可视化工作稿可用 `surface:"tool"`。stage 与 surface 独立。Native 调用把 surface、stage、草稿和基版本标识放在 program 前，生成中的 Lang 是候选，新资源在调用校验成功后才显示。PTC 按实际工具 dispatch 更新。

preview 指调用工具校验并更新草稿，由前端自动展示；成功回执不证明浏览器已渲染，也不要求浏览器检查或用户确认。每个 Session 同时只有一个当前 Turn 草稿，对它的 preview/save 必须串行，计算不受此锁限制。草稿不跨 Turn 或 Host 重启保留；结束 Turn 前保存，或说明未保存及阻塞。缺上下文或冲突时读[恢复参考](references/recovery.md)，调用示例见[页面示例](references/examples.md)。

## 已保存报告：只刷新数据

用户要求更新已保存报告的数据时，直接按[数据刷新](references/data-update.md)执行，不要求用户再声明“保持布局”。锁定页面程序、组件数量/类型/顺序/嵌套、资源名、view/display、正文、标题、语言和列标签。逐组件独立计算并 preview 同名资源替换，最后保存一次。不能为通过校验换图形、删组件或改口径。

明确要求改布局或正文时，才进入页面编辑：读取准确基版本，保留未请求修改的内容，增量 preview 变更后统一保存。若还要新数据，其准备仍按组件独立执行。数据刷新不隐含页面编辑。

## 表达与完成

用 `TextContent` 写解释，数据视图呈现可核对的数值和图形，`Stack`、`Card`、`Tabs` 组织阅读。数据视图已有结果外壳，不为单个视图再加装饰性 Card。已有图片或不支持的图形可用 Image，需要核对原值时配独立数据视图。

草稿尚无结论时展示问题和证据缺口；结论成立后把结论、支持数据和影响解读的范围、分母、缺失项放在一起。比较、归因和覆盖检查见[叙事与证据](references/narrative.md)。成功保存后简短交付；失败时说明真实状态并给出已有支持的答案。
