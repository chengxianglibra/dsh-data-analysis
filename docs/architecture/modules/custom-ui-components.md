# 插件私有 UI 组件

## 责任与入口

插件拥有内容区域的主题角色、控件、布局和结果阅读部件，Harness 拥有导航、原生 Tab、会话输入、设置外框及服务生命周期。
Marivo 拥有分析语义；组件只展示已保存事实。报告协议、快照与保存流程分别见[分析文档 reader](presentation-reader.md)、
[展示数据投影](presentation-projection.md)和[展示交付](presentation-delivery.md)。

基础层位于 [client/ui](../../../packages/dsh-data-analysis/src/client/ui/)，报告布局位于
[layout.tsx](../../../packages/dsh-data-analysis/src/client/analysis-ui/layout.tsx)，结果阅读部件位于
[components/result.tsx](../../../packages/dsh-data-analysis/src/client/analysis-ui/components/result.tsx)。
这些实现不作为新的公共 exports 或 Catalog 组件。

## 分层与数据边界

依赖方向为 Host 接入 → 领域呈现 → 阅读部件 → 基础控件与样式。

- Host 接入提供保存文档、资源、语义导航、代码读取和草稿准备能力；负责 Workspace / Build 身份和请求失效。
- Frame / Dataset 分别消费 `resolveFrameView` / `resolveDatasetView`，不增加另一份自动分类规则。
- ResultCard、ResultHeader、MetricGroup 和 DataActions 只组织标题、数字、主体与动作，不接收 Runtime、凭据或 RPC。
- 普通图共用 ChartModel 与 React/SVG；比较、分解、对齐、相关和份额保留领域结构，不变成通用业务计算器。

Dataset 不因共用外壳或图表获得 Frame context、期间推断或数据点提问。精确值使用已有 codec / formatCell / exact 路径，
浮点近似只用于绘图位置。area 与 bar 的数值域包含零，null 继续断开图形，不补算总计、差值或比例。

## 主题与容器

[UI_STYLES](../../../packages/dsh-data-analysis/src/client/ui/theme.ts) 在 `.mv-ui` 下集中定义界面、控件、状态和受控 fallback。
Host 已解析主题优先，独立渲染再使用显式主题或 OS；pr/mc/sb/rt/pd 局部变量桥接同一角色。
数据色继续由现有 chart-palette 提供，操作 accent、业务状态与数据系列互不替代。

主题变化通过 CSS 生效，不重挂图表。Surface、Card 和结果拥有明确容器作用域，窄容器重排正文和操作行，
图表与表格在自己的滚动区保留可读字号；Stack 仍遵守声明的 direction / wrap，不按视口重写 program。
页面外边距只由一个内容根负责，clear Card 不增加装饰外框。

## 控件与弹层

Button / IconButton 使用插件私有原生控件，普通按钮至少 32px、图标 16px 且命中区 32px，具备可见焦点。
普通 disabled 与需要解释的 unavailable 分开；后者保留可聚焦的 aria-disabled 入口和原因，阻止动作。
通用控件只消费调用者提供的本地化标签，业务状态不由控件推断。

[Tooltip](../../../packages/dsh-data-analysis/src/client/ui/tooltip.tsx) 使用浏览器 Popover API 的 manual 顶层绘制，
保留原 DOM 祖先与主题继承，不向 body 搬移提示、不创建新的 Host 弹层服务。
键盘聚焦立即显示，指针悬停延迟显示，触发点与提示之间保留短暂移入宽限；提示自身可悬停。
位置按视口边界夹取并在上方空间不足时翻转；滚动或尺寸变化时重新定位，触发点离开可视区域或窗口失焦时关闭。
Escape 先关闭可见提示并保留焦点，随后一次 Escape 仍由原生 dialog 或 Host Modal 处理。
相同标签不重复加入描述，额外提示与调用方的 `aria-describedby` 合并。
此实现要求浏览器支持 [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)。

[DetailsDialog](../../../packages/dsh-data-analysis/src/client/ui/overlays.tsx) 统一内容、关闭按钮、尺寸与主题桥接。
独立 Renderer 使用浏览器原生 dialog；[HostOverlayProvider](../../../packages/dsh-data-analysis/src/client/ui/host-overlays.tsx)
只在 [lazy-surface](../../../packages/dsh-data-analysis/src/client/analysis-ui/lazy-surface.tsx) 接入处注入 Harness 的公开 Modal headless 外壳。
这样纯 Catalog / Renderer 不依赖 Host primitives 的完整运行时入口，Host 内弹层保留原生快捷键和焦点协调。

Portal 内容从所属阅读作用域取得角色和数据色，随主题变化同步；不依赖 Surface 的 DOM 祖先选择器。
所有弹层关闭后返回触发点焦点，精确表格与代码在弹层内部滚动。图表数值提示仍使用 SVG title，详细数据提供等价精确值入口。

## 报告布局与阅读状态

对外仍只有原有八组件，复用已有 schema、refs、签名与 Catalog build。OpenUI Lang / Renderer 负责声明与编排，
私有 Stack / Card / Tabs 负责实际布局与交互；不新增 DSL 参数。

Tabs 将焦点项与激活项分开：方向键和 Home/End 移动焦点，Enter/Space 激活，Tab 离开标签组。
tab / panel 使用稳定 ID 关联；隐藏 panel 不进入焦点序列，切换保留已有阅读状态。
激活 panel 提供 Tab 焦点入口，离开标签组后重新进入时聚焦激活项；标签组为焦点环保留边距。
私有 Tabs 由调用方传入本地化名称；Catalog 适配器使用文档 locale 的报告分区名称，不增加公开参数。

排序、页码、选列、详情和局部滚动属于视图实例；准确 recordId 改变时重置，主题或 locale 变化不重挂。
表格与图点始终保留原始保存行和字段身份，不以显示顺序生成引用。候选不构造本地复制或 Host 操作入口，
外层 inert 和 callbacks 缺省共同保证安全预览。

Frame compact 可以隐藏辅助内容及已有规则允许的主图，但截断、期间不可用和受限成员等影响解读的状态保持可见。
Dataset 不新增 density/dataTable 参数。主视图已经是表格时不重复提供数据详情入口。

## 业务页面与验证

数据源、语义浏览器、报告目录/历史、Python 工具内容及设置复用基础层，不依赖结果阅读组件。
原有凭据授权、连接测试、配置 revision、代码原文复制和执行状态保持各自契约；统一样式不改变 Host 外框。

聚焦测试覆盖 Catalog、原始数值、图形 domain、容器布局、主题优先、Tabs、dialog、候选和跨 Build 状态。
真实 Host 的 Portal、快捷键、目录及来源/草稿动作另行验证，独立组件测试不代替安装或模型验收。
