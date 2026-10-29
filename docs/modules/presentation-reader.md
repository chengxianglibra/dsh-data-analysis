# 分析文档 reader

## 责任与入口

本模块把已保存的分析文档（`dsh.analysis-ui/v1`）呈现在 tool view 与原生右侧 tab 中。
插件拥有 Catalog/Renderer、阅读状态、报告目录与版本历史视图；Marivo 拥有分析语义与来源事实，
Harness 拥有 Workspace、Session、右侧 tab 生命周期与交付。reader 只读取保存的文档快照，
不调用 Python、凭据、observe 或 revalidation，也不执行分析、查询或保存。

保存、receipt 与 RPC 见[展示交付](presentation-delivery.md)；快照与文档投影见[展示数据投影](presentation-projection.md)。
实现入口为 [AnalysisSurface](../../packages/dsh-data-analysis/src/client/analysis-ui/surface.tsx)、
[组件库](../../packages/dsh-data-analysis/src/client/analysis-ui/library.tsx)、
[数据视图](../../packages/dsh-data-analysis/src/client/analysis-ui/data-view.tsx)和
[右侧 tab 接入](../../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)。

## 统一 AnalysisSurface 与候选预览

AnalysisSurface 使用固定 Catalog/Renderer 呈现 OpenUI Lang program；工具调用候选、默认结果的会话节点和报告 tab
是准确调用及保存版本的薄适配器。候选与已保存文档共用 Renderer；Native 前缀通过 isStreaming 解析，不完整资源显示占位。
基版本经现有 RPC 核验后可读；patch 完整前不合并，失败保持旧成功版本。候选不执行业务读取、动作或保存。
Surface 接收文档及已保存资源读取回调，领域组件通过普通 React context 取资源，不访问 Store、RPC、MCP 或 URL。
阅读状态属于所在视图，位置切换可以重挂。

## 组件与数据视图

对外仅八组件：AnalysisFrameView、DatasetView、Stack、TextContent、Card、Tabs、TabItem、Image；
签名由[生成的 Catalog](../../packages/dsh-data-analysis/src/presentation/contracts/analysis-catalog.ts)定义。

- 两类数据视图只支持 auto/table/metric，复用 DatasetTable 的精确格式化、类型感知排序及本地分页，
  并提供选列、复制已保存数据与来源/范围详情。int64、Decimal 与 null 不经浮点转换。
- metric 要求完整单行；auto 对 Frame 要求完整单行、零轴且恰好一个 value 字段，presence 字段不计为值；
  Dataset 要求完整单行单列，预览不会误判。其余结果按表格显示。
- 每组 Tabs 的 TabItem.value 必须唯一，Host 在保存前拒绝重复值；不同组可以复用相同值。
- 图片只显示已保存的 image 资源；TextContent 不加载远程图片。

reader 不提供图形类型、图表探索、全局筛选、动态指标、页面内编辑、撤销/重做、来源代码弹窗、
从报告 cell 加入提问或任何导出入口。展示层不聚合、不计算总计或比例，截断数据不派生全量结论。

## 来源与范围详情

Frame 保留结构、坐标和 Session/Artifact；DataFrame 明示 SQL、数据源和文件来源未捕获，业务覆盖未知。
Frame 来源详情另显示快照内保存的 Evidence、Findings、方法说明与语义来源，每项注明已读条数与总数、
首页之外未检索、省略内容及不可用原因；P4 之前保存的快照显示未捕获。记录只有自身完整坐标精确匹配已保存行时
才标为该行，部分坐标、无坐标或行外坐标分别说明，不推断点级证明。

语义来源为分析时的静态身份，在 tool view 和报告 tab 中可经现有[语义浏览器](semantic-browser.md)打开当前定义，
并提示其可能已变化；候选预览不提供导航。

## 报告目录、版本历史与旧格式

报告目录按 Workspace 列出新格式记录，支持标题搜索，并按 surface 区分 tool 与 tab 结果。
报告地址为 `dsh-resource://marivo-report/<workspace>/<report>/current` 或 `.../build/<build>`；
打开时在右侧 tab 中显示对应版本，版本历史列出同一报告的不可变 Build，可切换到历史版本或回到 current。
Host 内入口要求已有 Session，只访问该 Session 所属 Workspace，不隐式创建 Session。

旧格式保存记录（Document v3 及更早）留在磁盘上，但不进入报告目录或版本历史；直接打开旧地址显示
`marivo.presentation.unsupported-report` 错误，不回退到旧 reader，也不修改或删除历史文件。
需要相同内容时，从实际结果重新 `marivo_present` 新格式。

## 界面语言与报告语言

插件操作界面通过 Harness 的 `ctx.locale` 跟随系统语言，按功能注册类型化中英文词典。页面订阅语言 revision，
仅重新渲染文案，不重建凭证、语义或报告模型；操作提示保留稳定标识和安全参数，在展示时翻译。

分析文档的 `locale`（`zh-CN` 或 `en-US`）决定 Surface 内容、辅助说明和日期／数字格式；Host 控件使用系统语言。
业务正文、字段标识、单位、精确数值和原始语义事实不由插件翻译。

## 验证边界

聚焦测试覆盖 Catalog 准入、数据视图的精确值与 metric/auto 判定、目录过滤及旧格式拒绝；运行所属测试与 `npm run check`。
真实浏览器验证见[验证指南](../validation.md)；reader 验证不代替 Tool、receipt/RPC 或真实 Agent 自动路由验收。
