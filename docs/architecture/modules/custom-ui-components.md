# 插件私有 UI 组件

## 责任与入口

插件以官方 shadcn/ui radix-nova 源码组件为内容区域设计、布局与风格基准，拥有其局部适配和结果阅读部件，Harness 拥有导航、原生 Tab、会话输入、设置外框及服务生命周期。
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
- 普通图共用原值/几何/行字段绑定模型，由 Recharts 和 shadcn Chart 呈现；比较、分解、对齐、相关和份额保留领域结构，不变成通用业务计算器。

Dataset 不因共用外壳或图表获得 Frame context 或期间推断；数据点提问使用 Dataset 自己保存的行与字段。精确值使用已有 codec / formatCell / exact 路径，
浮点近似只用于绘图位置。area 与 bar 的数值域包含零，null 继续断开图形，不补算总计、差值或比例。

## 主题与容器

[UI_STYLES](../../../packages/dsh-data-analysis/src/client/ui/theme.ts) 注册由 [theme.css](../../../packages/dsh-data-analysis/src/client/ui/theme.css) 和组件源码编译的作用域样式，集中定义界面、控件、状态和受控 fallback。
构建、依赖和类型检查及依赖样式的测试入口会生成本地 `styles.generated.ts`。该文件由 Git 忽略，浏览器通过客户端 bundle 加载编译后的样式。
直接运行源码夹具前可执行 `npm run prepare:source` 生成样式和 Catalog，再用 `npm run check:ui-styles` 核对本地样式。
Host 已解析主题优先，独立渲染再使用显式主题或 OS；报告与业务内容消费同一组 shadcn semantic tokens。
数据色使用同一组明暗 chart tokens，操作 accent、业务状态与数据系列互不替代。

主题变化通过 CSS 生效，不重挂图表。Surface、Card 和结果拥有明确容器作用域，窄容器重排正文和操作行，
图表与表格在自己的滚动区保留可读字号；Stack 仍遵守声明的 direction / wrap，不按视口重写 program。
页面外边距只由一个内容根负责，clear Card 不增加装饰外框。

## 控件与弹层

Button / IconButton 使用加入项目的 shadcn Button 源码及其组合，优先采用官方 variant/size，具备可见焦点。
普通 disabled 与需要解释的 unavailable 分开；后者保留可聚焦的 aria-disabled 入口和原因，阻止动作。
通用控件只消费调用者提供的本地化标签，业务状态不由控件推断。

Tooltip、Tabs、Table、Card、表单、反馈和图表配套部件来自 `client/ui/primitives/` 中的官方 shadcn 源码，
允许为 Host、精确值及可访问性做必要修改。组件结构、标题层级、间距、尺寸、圆角、边框、图标和状态外观遵循同一 radix-nova 基准；
页面级样式主要负责布局，不恢复旧页面的独立视觉体系。通用交互使用 Radix 公开能力，不维护第二套定位或键盘引擎。Tooltip 在祖先滚动时按基础库行为关闭，避免保留过期定位。

[DetailsDialog](../../../packages/dsh-data-analysis/src/client/ui/overlays.tsx) 统一内容、关闭按钮、尺寸与主题桥接。
独立 Renderer 使用 shadcn/Radix Dialog；[HostOverlayProvider](../../../packages/dsh-data-analysis/src/client/ui/host-overlays.tsx)
只在 [lazy-surface](../../../packages/dsh-data-analysis/src/client/analysis-ui/lazy-surface.tsx) 接入处注入 Harness 的公开 Modal headless 外壳。
纯 Catalog / Renderer 不依赖 Host primitives 的完整运行时入口；Host 内只有一层 modal 生命周期，保留原生快捷键和焦点协调。

Portal 内容从所属阅读作用域取得角色和数据色，随主题变化同步；不依赖 Surface 的 DOM 祖先选择器。
所有弹层关闭后返回触发点焦点，精确表格与代码在弹层内部滚动。图表 Tooltip 读取原始保存单元格，SVG title 作为补充；详细数据提供键盘与触摸可达的等价精确值入口。

Coverage 在图标行只显示比例圆环，行数比例通过悬停提示读取；点击或键盘激活后通过同一 DetailsDialog 阅读捕获行数、总行数与快照时间。
详情明确区分已保存行范围与未知的业务覆盖，只消费当前快照；full / compact 共用入口，候选预览不打开详情。

CopyData 的反馈绑定当前数据及有序选列。数据或选列变化时清除旧反馈，重新选回原列也不恢复；
新复制开始时重新建立反馈周期，旧请求的异步回执不能覆盖当前状态。TSV 继续使用当前选列和精确保存值。

## 报告布局与阅读状态

对外提供布局、提示、折叠和数据视图组件，组件签名、schema 与 build 由[组件库](../../../packages/dsh-data-analysis/src/client/analysis-ui/library.tsx)生成。
Frame 的可选展示参数及 build 准入见[分析文档 reader](presentation-reader.md)。OpenUI Lang / Renderer 负责声明与编排，
私有 Stack 和 shadcn Card / Tabs 组合负责实际布局与交互；内部基础组件不暴露为任意 DSL props。

Tabs 将焦点项与激活项分开：方向键和 Home/End 移动焦点，Enter/Space 激活，Tab 离开标签组。
tab / panel 使用稳定 ID 关联；隐藏 panel 不进入焦点序列，切换保留已有阅读状态。
激活 panel 提供 Tab 焦点入口，离开标签组后重新进入时聚焦激活项；标签组为焦点环保留边距。
私有 Tabs 由调用方传入本地化名称；Catalog 适配器使用文档 locale 的报告分区名称，不增加公开参数。

DashboardGrid 使用有限列数和跨列值，按容器宽度折叠列数；DashboardGridItem 保留声明顺序和嵌套组件的阅读行为。TextCallout 只展示作者写入的静态提示。Accordion 使用可折叠的单项展开与键盘可访问的 trigger，隐藏内容不参与焦点序列；实例的展开状态由当前报告阅读状态持有，inline 实例按位置识别。

排序、页码、选列、详情和局部滚动属于视图实例；稳定报告视图内的更新保留已有组件状态，独立 reader 在准确 recordId 改变时重置，主题或 locale 变化不重挂。
表格与图点始终保留原始保存行和字段身份，不以显示顺序生成引用。候选不构造本地复制或 Host 操作入口，
候选中的业务操作由 callbacks 缺省及各操作的身份校验禁止，本地展开、排序和分页仍可使用。

Frame compact 可以隐藏辅助内容及已有规则允许的主图，但截断、期间不可用和受限成员等影响解读的状态保持可见。
Dataset 不新增 density/dataTable 参数。主视图已经是表格时不重复提供数据详情入口。

## 业务页面与验证

数据源、语义浏览器、报告目录/历史、Python 工具内容及设置复用基础层，不依赖结果阅读组件。
原有凭据授权、连接测试、配置 revision、代码原文复制和执行状态保持各自契约；统一样式不改变 Host 外框。

聚焦测试覆盖 Catalog、原始数值、图形 domain、容器布局、主题优先、Tabs、dialog、候选和跨 Build 状态。
真实 Host 的 Portal、快捷键、目录及来源/草稿动作另行验证，独立组件测试不代替安装或模型验收。
