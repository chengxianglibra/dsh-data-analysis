# Marivo 分析展示 S3 验收记录

## 结果与范围

2026-09-07，S3 已完成共享 reader 与离线 HTML builder。五类 block、line/bar、来源面板、精确数值、
排序/分页、系列显隐、tooltip 和复制追问上下文均使用同一展示文档。Host 与 portable 使用相同组件和数据解释。

本阶段只生成内存中的文档/HTML 字节；不登记文件、不发 receipt、不注册 `marivo_present`，不启动新分析。
S4 负责目录完整提交、Tool/receipt/RPC、打开与下载；S5 负责新 Skill 与真实 Agent 自动路由。
没有重装现有用户 profile、清理用户文件、发布或推送。

## 实施边界与代码

本仓库基线为 `c674c5d`（S2）；开始时已有 S1/S2 工作，随后 S2 在并行任务中提交，本任务保留其结果。
已有 AGENTS、rebuild Skill 和脚本改动不属于本次修改。Marivo checkout 为 `e936a3433e2bfaae9db6c54423cd65b0a0310826`，
Harness checkout 为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；未修改 sibling 仓库。

| 范围 | 结果 |
| --- | --- |
| `src/client/presentation/` | 独立 reader、Markdown、类型化模型、metric、line/bar、表格、来源、复制、共享样式与两个入口 |
| `src/presentation/build/` | `buildPresentation(document)` 返回 `document`、`documentBytes`、`htmlBytes`，保持输入快照与共享 contracts 错误身份 |
| `scripts/build-presentation.mjs` | 预构建 portable 资产与 Node static renderer，已安装包不依赖 esbuild 或源码 |
| `scripts/presentation-build/` | browser 白名单、Host React 去重、外部依赖检查与实际打包依赖完整许可证 |
| `build-client.mjs` / `finalize-build.mjs` / `client.tsx` | 生产 client 导出 Host reader，打包 Recharts，复用 Host React；移除未使用的浏览器 JS 散件 |
| 根脚本与 package verifier | 新增 reader 测试/真实验收入口；验证实际 tarball 的 portable/static 资产和隔离 builder 执行 |
| 文档 | 更新总体架构、reader/projection/交付模块、README 与路线图，保留 S4/S5 的未完成边界 |

参考本机 Analytics App Core `0.2.10-13ceeea1f599` 的 ChartRenderer、chart-transforms、DataTable、
AnalyticsLayoutCanvas、DataSourceDetails/ArtifactReader 和 portable builder；仅借鉴组件分工、快照与 fallback 方式，
没有复制其 proprietary 封装源码。Recharts `3.8.1` 及实际打包依赖的完整 licenses/notices 随资产保留，
缺失许可证会使构建失败。未增加新的图表或 Markdown 依赖。

## 数据解释与离线行为

- int64/Decimal 显示原字符串，排序不经过 Number；datetime 排序保留时区和微秒。
- metric 必须定位显式 rowIndex/column；null、空字符串与零分别显示，null 指标仍保留单位信息。
- line/bar 只使用已有行，null 保留断点，重复 X 标签通过行身份保持独立。不同单位分图，近似绘图明确标注。
- 大数/极小坐标用科学计数法，过长坐标标签仅在轴上缩略；tooltip、选择项与精确表格保留原值。
- computed 只显示声明来源；available/unavailable 仍表示快照可恢复性，不证明计算正确。
- 表格排序/分页、系列显隐和复制都是本地交互；没有全局筛选、编辑或直接消息提交。
- 静态模式展示全部保存行和来源，以精确表格表达图形；无脚本、脚本失败和打印保持可读。
- HTML 内嵌完整 JSON、JS、CSS 与许可证；数据转义、脚本 SHA-256 CSP 和资源限制阻止内容执行与网络依赖。
- 文档和 HTML 超出共享预算明确失败。builder 不修改调用方数据、不分配身份、不读取数据源或取得凭据。

Host adapter 通过实际 DSH `--dsw-alias-*` tokens 跟随主题，portable 使用系统主题；打印使用独立白底样式。
portable 专属选择器限定在其 body 标记下，避免共享样式影响 Host 同名元素。

## 持续检查与安装包

以下检查通过：

```sh
npm run check
npm run build
npm run verify:plugin-package
npm run quality
npm run typecheck
```

S3 最终 19 项测试覆盖精确排序、日期/空值、唯一 metric、数值准入、轴缩略、来源、静态内容、安全 Markdown、
预算、模块身份、browser 构建边界和无开发依赖执行。新增 32,768 字符未闭合链接回归，避免失败匹配的重复扫描；
深层 blockquote 有递归上限并完整保留剩余文本。原 Evidence client 的 5 项回归继续通过。
Host 主题、窄屏 tooltip 与 Markdown 扫描边界修复后的最终 source/scripts typecheck、Biome 和 reader tests 已单独复验。

实际 tarball 为 `0.1.2-dev.0`，114 个文件、2,192,649 解包字节；23 个 DSH peers 为 `0.1.1-rc.2`。
verifier 从打包解包后的 builder 生成 source-only HTML，验证 JSON identity、fallback 和 Buffer 输出；
该 consumer 只连接正式 dependencies/peers，未提供 esbuild、Recharts 或 ReactDOM 等开发依赖。
独立测试还将 builder/assets/contracts 复制到完全无 node_modules 的目录执行。

日志为 `/tmp/dsh-s3-check.log`、`/tmp/dsh-s3-package.log`、`/tmp/dsh-s3-reader-final.log`、
`/tmp/dsh-s3-quality.log` 和 `/tmp/dsh-s3-typecheck.log`。

## 真实浏览器证据与限制

真实验收加载生产 `lib/client.js` 原字节，通过隔离 DSH Web 的实际 module loader 与 Host React 渲染。
临时 overlay 只注入文档快照，没有生产 presentation Tool/receipt/RPC 或自制第二套 renderer。
portable 由生产 builder 生成，在 Chromium 的 `file://`、offline、禁用 JavaScript 和 print 环境分别验证。

输入包括三份 S0 fixtures、三份 S2 留存的真实投影快照以及独立的 25 行交互/安全样例。
S2 输入来自已有 `projection-evidence.json`，在本次逐份重新校验并渲染；没有重新调用 Runtime，
因此它是 S2 → S3 的数据接入证据，不是本次新分析执行证据。

验收命令：

```sh
npm run validate:presentation-reader:real -- --projection-evidence /path/to/projection-evidence.json
```

默认不传参数时检查仓库 fixtures 和交互样例。脚本创建隔离目录并保留 JSON、HTML、截图、打印 PDF 与机器证据，
无论成功或失败均关闭自身浏览器和验证 Host。真实 Agent、Native/Code receipt、DSH 下载和用户 profile 安装均留在 S4/S5。

Markdown 为基础只读子集，不宣称完整 CommonMark/GFM 兼容；不支持的扩展语法保留文本，结构化表格使用 table block。

## 最终浏览器结果与文件身份

最终证据目录为本机临时隔离目录
`/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s3-reader-4u6Jkr/`。
其中 `reader-evidence.json` 记录实际 Chrome `152.0.7977.77`、Host React `18.3.1` 和 `loaderMode: live`。

| 验收项 | 实际结果 |
| --- | --- |
| 3 份 S0 + 3 份 S2 快照 | Host/portable 的 metric、表格、图形原值、单位、来源一致；source-only 不生成 dataset |
| 25 行交互样例 | Decimal 精确排序、两页分页、系列显隐、键盘选择、鼠标 tooltip 与真实剪贴板均通过 |
| Host 主题 | 通过真实 ThemeRuntime 和 ThemePresenter，OS light + Host dark、OS dark + Host light 均按 Host 设置渲染 |
| 窄屏 | 375px 页面与 scrollWidth 均为 375；line/bar tooltip 位于可视区域，大数轴和完整精确提示均经截图检查 |
| Dark | 背景 rgb(25,36,40)、正文 rgb(226,237,239)，正文对比度 13.285 |
| 离线与无脚本 | 七份文件的网络请求均为零，正文/指标/必要表格/保存来源可读 |
| 打印与安全 | print PDF 已生成并实际渲染检查；没有页面脚本错误、XSS 执行或远程图片请求 |

实际检查了 `interactions-narrow-dark-line.png`、`interactions-narrow-dark-approximate.png`、
`host-manual-dark.png` 与 `s0-computed-print-page1.png`。验证过程中发现并修复了窄屏 tooltip 越界，
未放松几何断言。

`build-artifact-identity.json` 连接最终包构建和浏览器证据：生产 client 的 SHA-256 为
`9e4f54502593cdebc174698b76768986c5fe78964fa74d1ebeb56c4439d04d91`，与浏览器加载字节相等。
最终 builder 从七份保存 JSON 重建的 HTML/JSON 与浏览器验证文件逐字节一致；同一证据还记录 portable/static/builder
资产的 SHA-256，没有用源码路径或旧版截图代替最终运行文件。
