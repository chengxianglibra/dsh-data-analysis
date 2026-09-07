# 展示 reader 与离线构建

## 责任与入口

S3 将 [S2 展示数据投影](presentation-projection.md)返回的 `PresentationDocument` 变成可读内容。
插件拥有展示组件、阅读／编辑草稿状态和自包含 HTML；Marivo 继续拥有分析语义与来源事实，Harness 继续拥有 Workspace
和交付生命周期。reader 只读取文档快照，展开来源不调用 Python、凭据、observe 或 revalidation。

实现入口为 [共享 reader](../../packages/dsh-data-analysis/src/client/presentation/reader.tsx)、
[Host entry](../../packages/dsh-data-analysis/src/client/presentation/host-entry.tsx)、
[portable entry](../../packages/dsh-data-analysis/src/client/presentation/portable-entry.tsx)和
[内部 builder](../../packages/dsh-data-analysis/src/presentation/build/index.ts)。
`client` 导出 `HostPresentationReader`；S4 的[展示交付](presentation-delivery.md)已接通 `marivo_present`、receipt、RPC、overlay 打开与下载。

## 共同的数据解释

五类 block 使用同一份 typed dataset 和保存的来源：

| Block | 展示行为 |
| --- | --- |
| Markdown | 基础只读正文，支持常用标题、列表、引用、代码和行内格式；原始 HTML 作为文本，不执行脚本或加载远程图片 |
| metric | 通过 dataset、column、rowIndex 唯一定位单元格，保留精确值、单位和 null；不默认取首行或聚合 |
| chart | 18 类图形及 bar/line 变体只绘制已有数据；统计字段显式绑定，保留 null 与原始精确值；支持当前页面探索 |
| table | 类型感知排序、分页、列顺序、精确数字和精简行数与截断提示 |
| source | 通过 cell 菜单查看已有语义对象、来源创建时间及实际问题；unavailable 保留原因 |

computed 来源表示作者声明，不能证明转换正确。int64/Decimal 的排序和表格显示不经浮点转换。
单位只使用文档已有字段，不猜测百分比、缩放倍数或业务口径。普通多系列图按单位分图；堆叠图与 heatmap 拒绝混合单位；
过长坐标标签缩略，刻度使用中文千分位与紧凑量级，极大或极小刻度使用科学计数法；完整值保留在 tooltip 和精确数据预览中。截断数据不派生全量 KPI、总计或排名。
普通阅读中的图形／字段切换、系列显隐、表格排序/分页和复制上下文是本地交互，不产生新分析。
编辑模式只保存明确提交的呈现字段；筛选永远是临时阅读状态。

## 图形与临时探索

图形合同见[chart 契约](../../packages/dsh-data-analysis/src/presentation/contracts/charts.ts)，
作者说明与完整样例见[图形配置](../../packages/dsh-data-analysis/skills/dsh-data-analysis-presentation/references/charts.md)。
bar 包括纵横、并列、堆叠和 100% 堆叠；line 固定 monotone，支持显式系列角色、实／虚／点线及数据点。
统计图的分箱边界、频数、五数摘要、占比、分母、排名、瀑布起止值均由分析阶段准备。
reader 只校验和绘制，不聚合、分箱、归一化、排序排名或重新累计。

普通阅读中，每个 chart 的“探索图表”面板只保留本次阅读状态；普通字段只在现有 dataset 中选择，
需要另一种统计结果时切换作者声明的 `preparedViews`。缺少所需字段的类型禁用并说明原因。
过滤与显隐保持原始行身份、比例分母和角度；来源预览和复制上下文使用当前绑定及过滤状态，
并保留原始快照 identity。恢复原图、切换 build 或重新打开恢复作者配置。
下载提供当前显示构建的已保存 HTML；打印及无脚本阅读使用已保存正文和精确数据表，不应用临时筛选或未保存草稿。

## 在线编辑与删除

Host 提供编辑、保存、取消和保存前的撤销／重做；独立草稿从已保存文档建立，普通探索不自动成为编辑内容。
支持报告标题、Markdown 正文、metric 标签、ChartExplorer 的图形／字段／系列／样式及 prepared view，
表格列选择与顺序（至少一列），全部 cell 的上移、下移和删除。按钮和表单支持键盘操作，继续使用自适应顺序排版。
source cell 只能移动或删除，引用和来源事实不可编辑。不新增 cell、任意布局或数据编辑。

删除立即更新草稿并可撤销；全部删空可保存，显示空报告提示，底层 datasets、sources、代码和 diagnostics 保留。
首次 Agent Draft 仍至少一个 block。保存成功清除编辑历史，失败保留草稿；主动关闭有未保存修改时提示放弃或继续。
保存协议和并发边界见[展示交付](presentation-delivery.md#rpc编辑与当前指针)。portable 不包含编辑／宿主保存入口。

## 同 dataset 联动筛选

`PresentationReader` 按实际 datasetId 管理共享 typed 值筛选。同字段多值为 OR，不同字段为 AND；
null、空字符串、int64 和 Decimal 保持原类型和值，不使用字符串化匹配或浮点等价判断。
全部 18 种 chart 共用命中集合，包含直方图、箱线图、散点图、热力图、饼／环形图、排行、漏斗和瀑布等特殊图形。
命中集合保留原始 rowIndex，交给使用该 dataset 的图表、表格及来源数据预览；排序与分页作用于命中行，
筛选变化重置分页。预备视图按实际 datasetId 联动，不推断不同 dataset 的关系。

metric 与正文保持原快照并明确提示不重算；比例、排名、分母等预计算值保留原值。截断提示区分已保存行与命中行。
筛选不标记编辑 dirty，不进入保存请求、文档、receipt、HTML、打印或浏览器存储；关闭或切换报告、build、Workspace 后清空。

## 通用阅读层级

正文使用单列文档布局；只有相邻 metric 合并为自适应指标行，不移动、合并或改写作者的正文和 block 顺序。
指标可以增加千分位，但不舍入、不缩放、不经过浮点转换；精确值仍保留在 tooltip、数据表和原文档中。
生成时间以带 UTC 标识的可读日期展示，原时间戳保留在 `time.dateTime` 和文档中。

每个 cell 右上角提供三点菜单，包含“复制上下文”；有数据或来源的 cell 同时提供“数据源”选项。“数据源”打开原生 modal，
按“概要 / 数据预览 / 代码”组织信息。概要仅呈现当前 cell 的指标、数据集、字段、报告生成时间、已有语义路径、
来源创建时间及实际问题；不会把生成时间当作查询执行时间。没有数据集的 source block 提供概要和代码。
代码 Tab 展示当前 dataset 关联的 Python 执行快照及所选来源保存的实际 SQL，保留原文并支持复制；
Python 关联由作者声明，界面明确说明这一边界。代码缺失和来源读取限制保留说明；不从当前定义或脚本文件重构历史代码。
概要不解析 SQL 来推断物理表、筛选值或历史定义。

数据预览保留精确原值、列顺序、排序和分页；chart 预览限制为当前 x/y 及辅助 bindings 绑定列。
图表正文只保留图形、多系列显隐及必要的截断/近似状态，单系列不显示切换图例。
“继续分析”、独立复制图标与图表下方“查看数据”入口已移除。复制内容限定当前 cell 的原文、字段绑定、指标精确值及其关联引用，
不附加整份报告或选中数据行；复制失败提供临时手动复制弹窗。

技术 identity、原始 JSON、成功检查、空事实和通用声明不进入阅读界面，完整来源与诊断仍原样保存在内嵌文档。
`definition_unavailable` 不再生成阅读提示；已在关联 cell 显示的截断、来源不可用状态不再重复放到页首。
其他诊断按 message 去重并保留原文，实际不可用原因和数据问题可以在数据源概要中查看。
菜单支持方向键、Escape 和外部点击；弹窗支持键盘 tab 切换、Escape 关闭及焦点返回触发按钮。

普通坐标图使用无外框的 320px 绘图区、极浅实线网格与自动宽度纵轴；sparkline 为 128px，统计 SVG 按内容布局并可在窄屏内横向滚动。
折线使用 monotone 插值；默认 `showPoints: auto` 只为单点和 null 两侧的孤立观测保留圆点，`always`/`never` 显式覆盖，null 之间不连线。
多系列图例位于图下。两个轴不显示额外轴线或短刻度线；横轴保留首尾刻度，原始分类文本在 tooltip 与数据预览中完整呈现。
柱状图通过零参考值参与自动 domain 与刻度计算，保证全负值及混合值均从零延伸；单柱最大宽 48px。
全部 18 类图形、绑定与适用配置由共享契约校验；环形图保留作者占比空位，箱线图完整绘制箱体、中位线及须线。

Markdown 支持基础标题、段落、行内格式、代码块、列表、引用和安全显式链接；不声明完整 CommonMark/GFM 兼容，
嵌套列表、Markdown 表格等扩展语法按基础文本保留。结构化表格使用 `table` block。

## 两个入口与构建产物

Host 与 portable 共用 `PresentationReader`、样式和数据模型。Host 外层接收调用方提供的动作；
portable 从内嵌 JSON 加载，包含自己的 React/Recharts，不依赖 DSH module loader。

`buildPresentation(document)` 校验并快照输入，返回生成文档、JSON 字节和 HTML 字节。
builder 不分配 Workspace/report/build identity，不登记文件、不创建目录、不生成 receipt；S4 唯一负责完整目录提交。
文档及 HTML 受 [S0 字节预算](../plan/marivo-analytics-presentation-s0-contracts.md#预算错误与文件身份)约束，超限明确失败。

HTML 同时保存完整文档、共享 reader 生成的静态正文和交互脚本。静态模式用原生 `details` 按需展开来源、保留必要数据行，
并用精确表格表达图形；代码也可通过原生折叠区展开和选择原文。仅在交互挂载成功后隐藏 fallback。打印显示精简来源概要，隐藏操作控件及长代码。
无脚本、脚本失败和打印均能读取正文、指标、必要表格及来源。静态图形当前仍为精确数据表，不宣称提供静态 SVG。
文本和内嵌 JSON 转义，CSP 禁止网络资源；文件不包含外部样式、字体、图片、模块加载或凭据依赖。

[client 构建](../../packages/dsh-data-analysis/scripts/build-client.mjs)将 Recharts 等非 Host 依赖打包，
仅将 DSH 和 React/ReactDOM 外部化。输入白名单拒绝 Node、Runtime、projection 和 Host 凭据服务模块，且检查 Host bundle
没有第二份 React。portable 不允许任何外部模块。

[presentation 构建](../../packages/dsh-data-analysis/scripts/build-presentation.mjs)预构建 portable 资产和
包含依赖的 Node 静态 renderer；运行已安装的 builder 不需要 esbuild 或源码。分发资产保留实际打包依赖的许可证，
Analytics App Core 只作为设计参考，不复制其封装源码。

## 验证与交付边界

```sh
npm run test:presentation-reader
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-reader:real
```

聚焦测试检查数字/排序、静态与交互共用数据、安全转义、预算和构建边界；真实浏览器检查实际 Host reader 与
portable 的数值/来源一致性、局部交互、窄屏/键盘/主题、断网、无脚本和打印。
S3 的真实 Web 验证只接入 reader，不代表 S4 Tool、receipt/RPC 或 S5 Agent 自动路由已实现。
代码快照、真实 Python/SQL 与离线阅读的边界见[数据源代码页验收](../plan/2026-09-07-presentation-source-code-acceptance.md)。
18 类图形、探索、下载和真实 Agent 的证据及限制见[图形与探索验收](../plan/2026-09-07-presentation-charts-acceptance.md)。

在线编辑、全部 18 种 chart 的联动与重启验证见[编辑与联动筛选验收](../plan/2026-09-07-presentation-editing-acceptance.md)。
