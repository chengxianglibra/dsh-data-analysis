# 统一分析 UI P2 验收

日期：2026-10-28。范围：[P2 实施任务](../designs/unified-analysis-ui-implementation.md#p2统一保存组件与双位置呈现)。
仅修改本插件；保留已有 AGENTS.md 修改、未跟踪的 dsh-0.2.0-integration 设计，以及工作期间并行更新的两份 unified-analysis-ui 设计内容。未提交、未推送、未重装或重启用户服务。
P2 是静态呈现闭环；P3 的真实参数流、patch 和外部模型使用策略验收尚未完成，首期 S1 未标为完成。

## 实现与责任

- 新文档 `schemaVersion:"dsh.analysis-ui/v1"` 的单一声明位于 analysis-document.ts。documentId/revision 复用 reportId/buildId，
  recordId 为 `marivo-ui:<reportId>:<buildId>`；完整 program、Catalog identity、资源声明、实际快照及绑定内嵌于 Build 的 presentation.json。
  这是一份 Build 管理的完整文件，不依赖原捕获目录，也不建立新 ID 数据库或文件服务。
- marivo_present 新写入只接受引用/Lang，单 Frame/DataFrame 默认生成领域视图。默认 tool，显式报告为 tab。
  发布历史按本次 surface 分类，默认报告目录只列 tab，“对话结果”入口列 tool；
  两个适配器使用同一 AnalysisSurface；组件从 React context 读取已保存资源，不访问 Store、RPC、MCP 或任意 URL。
- 两类数据视图支持 auto/table/metric，复用 DatasetTable 的精确排序/分页，补充选列、复制、范围和来源详情。
  完整单行单列才自动显示单值；显式 metric 也要求完整单行。Frame 完整坐标、实际 layout 与来源保留；DataFrame 不补造 SQL、文件或语义来源。
- 图片只准入所属 Workspace 的 PNG/JPEG/GIF/WebP 普通文件，沿用读取预算、路径/符号链接/身份检查，保存内嵌字节。
  Image.src 是资源名。TextContent 使用既有安全 Markdown，不自动请求远程图片。
- 保存、历史、current 条件更新和冲突沿用现有服务。新旧格式明确分派；新格式 HTML 导出/发布及旧编辑入口明确 unavailable。
  旧 Document v3 Reader、既有旧格式呈现编辑和 HTML 代码继续保留，不自动迁移。
- marivo_ui_read 只接收准确 recordId，返回 program、必要 schema、范围及同 Catalog 签名，不返回 rows，也不依赖 Runtime 或启动 Python。
  presentation Skill 的新入口和生成的紧凑签名已同步；文件 Skill 的完整流程及历史示例清理按计划留在 P3。

## 固定身份与入口

| 项目 | 实际身份 |
| --- | --- |
| Node.js | 22.19.0 |
| Harness | 本仓库安装的 0.2.1-rc.2 |
| 插件 | 0.2.4-dev.0，本地构建及打包候选 |
| OpenUI | lang-core/react-lang 1.0.1，react-headless/react-ui 0.18.1 |
| Catalog build | 1a44a0f6d396019deeaa4ed94c8320b98cd70fae0ee0a24883111b085c712fe6 |
| Marivo | Python 3.14.4，distribution 0.6.0.dev0；实际安装路径见下方 |
| Helper | presentation-kit 1.2.0，未在 P2 修改 |

Runtime 使用 `/private/tmp/dsh-unified-ui-p1-runtime/bin/python`；实际包为
`/private/tmp/dsh-unified-ui-p1-runtime/lib/python3.14/site-packages/marivo/__init__.py`。
wheel 为本地 `marivo/dist/pypi/marivo-0.6.0.dev0-py3-none-any.whl`，SHA-256
`6ddc5a3dd8bc45b356936dab206c30a6373a8a0cde9f9eca77e635ea79b8c777`。

```sh
DSH_DATA_ANALYSIS_PYTHON=/absolute/p1-runtime/bin/python \
DSH_DATA_ANALYSIS_MARIVO_WHEEL=/absolute/marivo.whl \
npm run validate:unified-analysis-ui:p2

DSH_DATA_ANALYSIS_PYTHON=/absolute/p1-runtime/bin/python \
node --experimental-strip-types packages/dsh-data-analysis/scripts/unified-analysis-ui/web.ts --p2

# 关闭该隔离 Host 后，以输出的同一目录冷重启，复用原成功 producer：
DSH_DATA_ANALYSIS_PYTHON=/absolute/p1-runtime/bin/python \
node --experimental-strip-types packages/dsh-data-analysis/scripts/unified-analysis-ui/web.ts --p2 --reuse /absolute/outputRoot
```

Web 入口复用 P0 driver，P2 使用生产 Tool、Client、右栏和真实 Runtime；模型边界为 scripted adapter，
没有安装 Intelligent UI，没有调用外部模型。冷重启走公开 AgentLoop.resume，不重跑 producer。

## 自动化与真实 Runtime

模块测试覆盖默认引用、Frame 单次读取、Host 捕获归属、精确值、组合/slot 准入、合法图片、错误资源、
截断 metric 拒绝、准确历史读取、取消/冲突不改 current、删除捕获文件后的冷服务恢复、旧格式分派及新格式不支持入口。
既有表格 codec、排序、分页、保存锁、文件安全及 PTC 归属测试继续复用。

真实 Runtime 复用 P1 小样例：Frame 保留 region 坐标、Decimal、大整数及 NULL；DataFrame 保留相同精确载体。
两个结果只传引用完成保存，删除 captures 后新启动的 Node 进程通过生产文件服务读取完整 Build，未读取原数据源。
最终 Runtime 机器证据：
`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p1-1ADRws/runtime-evidence.json`。

最终检查见本文末尾。新增目录分类与原调用/codeRef 详情按工作期间更新后的 P2 计划补齐；目录过滤的代表用例复用生产 Tool 和目录服务。

## 浏览器验证

使用 ego-browser，隔离 Host 的 loopback HTTP 地址；桌面实际视口 1920×975，窄屏 390×844。
验收流程为：真实 Tool 保存 → 展开所属调用 → 读取精确表格 → 排序/翻页/选列/复制 → 同版本打开 tab → 组合报告 → 删除输入并冷重启 → 准确版本重开。

| 检查 | 结果与证据 |
| --- | --- |
| 页面身份与非空 | DeepSeek Harness，会话为 Show P2 dataset；实际出现新格式正文，无框架错误覆盖层 |
| 默认位置 | dataset 默认 tool，无自动 tab；所属 Native 调用显示已保存结果 |
| 同版本双位置 | tool 和手动打开的 tab 均为 record `marivo-ui:231a0f41-6b1d-4030-b1d5-358a5348b992:47ad1d34-f116-449f-b7f9-c9bd9d148de2`；各自本地排序状态独立 |
| 精确值与交互 | 保留 `9007199254740993`、`12345678901234.5678`、`2.3400` 和 NULL；升序首项 1，45 行分 3 页；隐藏 account 后只剩 amount；复制反馈为已复制 |
| 显式 tab | 当前顶层 ToolResultMessage 适配后，组合报告产生一次 automatic open，无错误；历史 baseline 自动打开次数为 0 |
| 八组件组合 | Stack/Card/TextContent/Tabs/TabItem/AnalysisFrameView/DatasetView/Image 实际呈现；切换指标页显示 `123.4500`，保存 PNG complete=true/naturalWidth=1 |
| 目录用途 | 新增并行要求由模块回归验证：生产 Tool 保存的 source.surface=tool 只在“对话结果”筛选出现，surface=tab 在默认报告列表出现；追加分类控件未另跑浏览器 |
| 窄屏 | 390px 视口、正文 pane 389px、document scrollWidth=390；表格在自身区域横向滚动，控件和正文可读 |
| 旧格式 | legacy-p2/legacy-build 使用旧 pr-reader，显示 Legacy Document v3 remains readable；没有进入新 Surface |
| 冷重启 | 删除 captures、sample.png，原数据库已不存在；关闭再启动独立 Host，重开准确 record 后 Decimal、大整数和图片均可读，无重新分析 |
| 控制台与异常 | 交互期间 adapter audit.errors 为空；未完整采集初始加载控制台，不据此声称所有日志均无警告 |

最终冷重开 record 为
`marivo-ui:7d1dd024-7fec-4f32-8e74-1998b93e390d:42873620-8736-4da9-b60f-7ddbf6da477f`。
机器证据目录：
`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p2-web-vfUimV`，
包括 host-events.json、p2-evidence.json、cold-restart-scope.json；浏览器冷重开断言为 `/tmp/dsh-p2-browser-cold.json`。
截图为 `/tmp/dsh-p2-tool-desktop.png`、`/tmp/dsh-p2-tab-desktop.png`、`/tmp/dsh-p2-composition-wide.png`、
`/tmp/dsh-p2-narrow.png`、`/tmp/dsh-p2-cold-reopen.png`。原始产物不纳入分发。

## 发现的接缝及文档差异

- Harness 当前 ToolResultMessage 将 toolCallId/isError 放在 message 顶层；旧观察器只认内层 tool-result block。
  已按安装代码适配，同时保留历史事件的明确分支，校验 call、Turn、Session 和失败状态；补充当前格式回归。
- 原文件读取 helper 错把 Workspace 根目录文件的空相对父路径视为越界；已修正并以根目录图片走真实保存验证，原符号链接/摘要边界保留。
- OpenUI 传递依赖在有 window、无 document 的注册表测试环境会提前初始化 DOM；已延后到实际 Surface 渲染，保留非渲染安装检查。
- 架构、模块、README 和 presentation Skill 原先将 Draft/右栏/旧图形导出写作统一新建路径；已区分 P2 与旧格式，签名由同 Catalog 生成。
  文件分析 Skill 及以 Draft 为输入的旧综合验证 driver 仍为历史路径，P3 才统一清理；本次新格式使用上述 P2 driver，不将旧脚本当作通过证据。
- 计划原使用“旧只读 Reader”措辞，现有旧格式 Reader/API 仍有呈现编辑；已将计划改为保留已有呈现编辑兼容，只明确禁用新格式的旧编辑入口。presentation Skill 的历史操作入口也已移除已删除更新参数的调用指引。
- 部分 OpenUI 传递 npm 包缺少完整许可证文件，已在既有 notices 构建入口固定补齐上游文本；未增加依赖或绕过包校验。
- 一轮原有 300ms Code Mode 截止时间测试在并行构建负载下超时，独立复跑通过，未修改阈值或断言。

## 剩余范围

不把本次模块测试、真实 Runtime 和 scripted Host/UI 验收上推为真实外部模型验收。
流式参数、patch、更新资源复用、完整文件 Skill 与示例清理，以及 Native/PTC 首期综合策略验收属于 P3。
新格式图表、Evidence/Findings 完整浏览与离线 HTML 分别留在后续阶段。


## 最终检查

- Node.js 22.19.0 下 `npm run check` 通过：696 项，692 通过，4 项按原真实运行条件默认跳过，0 失败。
  其中 Python codec/helper、类型、依赖树、Catalog 生成、P2 保存、目录分类、发布拒绝及既有旧格式模块均通过。
- `npm run build`、`npm run verify:plugin-package` 通过：344 files / 20484168 unpacked bytes；
  37 个 DSH peers，打包 helper、contracts 与隔离旧格式 offline builder 校验通过。
- `npm run validate:unified-analysis-ui:p2` 最终真实 Runtime 复跑通过，机器证据为上列 1ADRws 目录。
- presentation Skill 使用 skill-creator 的 quick_validate.py 通过，生成签名一致性及资源可达性由仓库检查通过。
- 修改文档的本地链接目标与 `git diff --check` 通过。浏览器证据与追加分类控件的模块证据按上表分别记录。

原 300ms 截止时间用例最终完整检查通过，未调整断言或时限。隔离 Host 与 ego-browser TaskSpace 已关闭，
保留临时机器证据供复查；未进行社区包发布、用户 profile 安装、提交或推送。

## P2 review 修复

- Frame auto 按 axes 与 value 角色选择单值展示：坐标或 presence 单列保持表格，零轴单 value 可忽略辅助 presence 字段；Dataset 完整单行单列和截断预览行为保留。
- Host 在保存前拒绝同组重复 TabItem.value，检查覆盖嵌套组，不限制不同组复用相同值。
- 新增实际 React 静态渲染回归及 Lang 准入回归；同步 Reader 契约、旧格式编辑兼容说明与 presentation Skill 的历史入口。
- Node.js 22.19.0 下本轮 `npm run check` 通过：698 项，694 通过、4 项默认跳过、0 失败；其中 `test:presentation-reader` 执行 `npm run build` 并通过。
- `npm run verify:plugin-package` 通过：344 files / 20485704 unpacked bytes；Skill quick_validate、修改文档链接目标及 `git diff --check` 通过。
- 本轮新增证据为 Host 准入与实际 React 静态渲染回归，未追加真实 Runtime 或浏览器运行。
