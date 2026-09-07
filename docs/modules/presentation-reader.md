# 展示 reader 与离线构建

## 责任与入口

S3 将 [S2 展示数据投影](presentation-projection.md)返回的 `PresentationDocument` 变成可读内容。
插件拥有展示组件、局部阅读状态和自包含 HTML；Marivo 继续拥有分析语义与来源事实，Harness 继续拥有 Workspace
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
| chart | line/bar 只绘制已有行，保留 null 断点；近似绘图明确标注，tooltip 和配套表格保留原值 |
| table | 类型感知排序、分页、列顺序、精确数字和完整行数/写入行数/截断提示 |
| source | 展开保存的 Artifact、Session、可选 Finding 和公开文本事实；unavailable 保留原因 |

computed 来源表示作者声明，不能证明转换正确。int64/Decimal 的排序和表格显示不经浮点转换。
单位只使用文档已有字段，不猜测百分比、缩放倍数或业务口径。不同单位的系列分图展示；
过长坐标标签缩略、大数坐标使用科学计数法，完整值保留在 tooltip、坐标选择和精确表格中。截断数据不派生全量 KPI、总计或排名。
系列显隐、表格排序/分页和复制追问上下文都是本地阅读交互，不产生新分析，也不直接发送消息。

Markdown 支持基础标题、段落、行内格式、代码块、列表、引用和安全显式链接；不声明完整 CommonMark/GFM 兼容，
嵌套列表、Markdown 表格等扩展语法按基础文本保留。结构化表格使用 `table` block。

## 两个入口与构建产物

Host 与 portable 共用 `PresentationReader`、样式和数据模型。Host 外层接收调用方提供的动作；
portable 从内嵌 JSON 加载，包含自己的 React/Recharts，不依赖 DSH module loader。

`buildPresentation(document)` 校验并快照输入，返回生成文档、JSON 字节和 HTML 字节。
builder 不分配 Workspace/build identity，不登记文件、不创建目录、不生成 receipt；S4 唯一负责完整目录提交。
文档及 HTML 受 [S0 字节预算](../plan/marivo-analytics-presentation-s0-contracts.md#预算错误与文件身份)约束，超限明确失败。

HTML 同时保存完整文档、共享 reader 生成的静态正文和交互脚本。静态模式展开来源、保留必要数据行，并用精确表格
表达图形；仅在交互挂载成功后隐藏 fallback。无脚本、脚本失败和打印均能读取正文、指标、必要表格及来源。
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
