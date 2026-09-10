# 只读语义层浏览器验收记录

## 范围

初始实施仅包含插件代码、测试、包配置与文档变更，不修改上游 DSH、Marivo。后续按用户“发射插件”请求安装到本地 Profile；本次计数修复更新该安装，不发布 npm。
实现边界见[模块说明](../modules/semantic-browser.md)。

## 已验证行为

- 真实 Marivo 0.5.3 能读取全部 13 种对象，保留完整业务定义、定义位置和精确关联引用。
- 真实测试将 `observe`、preview、readiness、连接测试与分析 Session 入口替换为禁止调用函数，读取成功。
- 空项目、正常模型与失败模型的读取前后文件摘要一致；不生成数据库、分析 Artifact 或项目文件。
- 数据源配置标记未出现在展示投影；模型错误不会经浏览器诊断泄漏原始信息。
- 确定性测试覆盖迟到响应、刷新竞态、关闭和卸载取消、Workspace 删除、输入边界、跨项目隔离和刷新失败。
- Chromium 夹具使用真实 Catalog 与生产页面，验证分页、中文搜索、域与类型筛选（类型数量随业务域变化，搜索和类型选择不缩减分类计数）、恶意文本作为纯文本展示、
  引用与定义位置复制、关系图逐层展开／缩放／平移／键盘导航，以及返回。
- Chromium 验证刷新失败保留旧快照、空项目、空搜索、390px 窄屏、Escape 关闭和焦点回到入口。

## 证据与限制

本次验证结果：`npm run check` 通过（158 项测试，0 失败、0 跳过，其中浏览器模块专项 10 项），
`npm run build`、`npm run verify:plugin-package` 与 `git diff --check` 均通过。
安装包检查确认 84 个文件、21 个精确匹配的 DSH peers；模块文档及 README 的 17 个本地链接检查通过。

可复现命令为 `npm run test:semantic-browser` 与 `npm run validate:semantic-browser:web`。
浏览器脚本输出 `result.json`、`desktop-overview.png`、`desktop-relations.png` 和 `mobile-detail.png`。
默认结果目录为系统临时目录下的 `dsh-semantic-browser-validation`，可通过环境变量覆盖。

浏览器脚本的 Host/slot 部分为隔离夹具；此外，2026-09-05 在实际 `http://127.0.0.1:3080/` 的 web Profile 上完成计数修复验收：

- `dsh-test` 从全部业务域切换到 `trino`、`mcdn` 再返回全部业务域，总数依次为 65、21、42、65，实体数依次为 2、1、1、2；各次均与对象列表一致。
- 真实浏览器没有页面异常，截图保存为 `/tmp/dsh-semantic-count-live.png`。
- 已安装客户端与构建产物 SHA-256 一致。更新只替换插件并重启已核实归属的 DSH 进程组，未运行状态清理；Workspace 注册文件摘要不变，3 个现有会话文件均保留。

## 2026-09-06：源码 wheel 与指标口径接入

Marivo 依赖切换到随插件打包的 `0.5.3.dev0` wheel，源码基于 commit `f93493f32bfa881f40b3a41b5cfbf0962f378f40`。
wheel SHA-256：`026c9ef70f1cb1c9c61e37400e1adbd45092a2571201237edec13c928003a574`。
从干净源码副本构建；检查 wheel 不含 `__pycache__` 或 `.pyc`，并由独立 managed Runtime 实际安装验证来源。

新增定义传输测试覆盖快照/Ref 身份、不支持状态、未知字段、不可序列化值与嵌套上限；真实 Catalog 夹具覆盖累计日历、
比率、加权平均、重复线性项和叶子表达式。原有禁止数据操作与项目目录读前读后对比继续执行。
同版本不同 wheel marker 必须重新安装，避免使用旧开发包；管理员 Python 也必须具有该 wheel 的安装来源。

浏览器夹具验证累计规则、显式时间轴、日历跳转/返回及比率角色，继续覆盖业务域计数、搜索、图谱、窄屏和复制。
使用真实 ecommerce 项目读取到 140 个对象，目标指标结构化定义中的 base、over、calendar 和 level 与声明一致。


本次专项及全量验证完成：`npm run check` 共 161 项测试通过，0 失败、0 跳过；构建、包校验和 `git diff --check` 通过。
新安装包为 88 个文件，包含源码 wheel 及来源记录，已安装客户端与构建产物 SHA-256 相同。
本地 web Profile 已更新，真实共享 Runtime marker 的版本与 wheel SHA-256 均匹配。
真实 Chromium 验证目标指标的累计起点、`day / Asia/Shanghai`、基础 `sum`、`spend_cny` 转 `float64`、
日历跳转与返回，页面异常为 0；桌面与 390px 窄屏截图保存在 `/tmp/dsh-metric-definition-desktop.png` 和
`/tmp/dsh-metric-definition-mobile.png`。新 Runtime 初始化完成后重新打开页面验收通过，未用 HTTP ready 代替插件就绪。
本地更新没有执行状态清理，Workspace 注册文件摘要未变，4 个原有会话文件均保留。

## 2026-09-06：Ibis 表达式直接展示

叶子表达式使用 Marivo 公共 `node.display` 文本，不再由插件遍历表达式树翻译。
保留指标累计、聚合、比率和时间口径展示，新增规范化 Ibis 代码、别名对象跳转、复制和常量隐藏提示。
文本展示独立于结构化解析状态，`.sum()`、`.count()` 等调用可直接显示；缺少或超限的描述才显示不可用原因。
这不是原始源码展示；统一使用“Ibis 表达式”标签，避免将聚合表达式误标为行级计算。

更新的 `0.5.3.dev0` wheel SHA-256 为
`ea93683e2d70c5cd577f297f24cc5720ba1a31c6c442e7bf48c9be7215e6f25a`。
构建基于上述源码 commit，仅叠加表达式显示及 live-help 四个文件的改动；逐文件摘要记录于
`python/marivo/source.json`，未包含 Marivo 工作区中其他凭证改动。

Marivo `make check-agent` 通过（5,555 项测试）；专门验证规范化语法、运算顺序、别名和字面量隐藏。
插件在 Node.js 24.18.0 下通过 `npm run check`（161 项测试，0 失败、0 跳过）、构建和包校验（88 个文件）。
真实 Catalog 浏览器夹具验证叶子代码 `t1["amount"]` 与剪贴板完全一致，并继续通过累计/比率、导航、
恶意文本、关系图、刷新、Workspace 隔离和 390px 布局验证。

本地 web Profile 与共享 Runtime 已更新，已安装客户端和 wheel 摘要均与构建产物一致。
实际 ecommerce 项目目标指标显示 `t1['spend_cny'].cast('float64')`，复制结果完全一致；
累计起点、时间轴、基础求和、日历跳转和返回均通过，页面异常为 0。
首次打开遇到 Runtime 初始化，未在等待时限内加载；marker 就绪后重新打开通过。
桌面与窄屏证据为 `/tmp/dsh-ibis-expression-desktop.png` 和 `/tmp/dsh-ibis-expression-mobile.png`。
更新未执行状态清理，Workspace 注册文件摘要未变，原有会话文件保留；会话压缩文件在正常重启时发生写入。

截图反馈的 `operations.cancellation_rate` 已在实际 web Profile 回归：分子为
`t1['is_cancelled'].cast('int64').sum()`，分母为 `t1['order_id'].count()`，两者代码与剪贴板一致。
390px 下表达式无横向溢出，页面异常为 0；桌面证据为 `/tmp/dsh-ibis-cancellation-desktop.png`。
完整 ecommerce Catalog 共 140 个对象，其中 80 个表达式全部具有展示文本。
最后一次安装在 Runtime marker 就绪后打开验收；Workspace 与会话文件摘要均保持不变。

## 2026-09-06：详情界面精简

Ibis 代码块右上角使用通用复制图标，保留辅助名称、键盘操作及复制反馈；删除定义位置复制操作，位置文本继续展示。
按用户要求移除表达式下方的固定解释段落和计算卡底部的 Catalog 说明。

Node.js 24 下 `npm run check`（161 项测试）、构建、包校验及 `git diff --check` 均通过。
真实 Catalog 浏览器夹具通过键盘复制与已删除界面元素检查。
本地 web Profile 更新后，以 `dimension:commerce.order_items.product_id` 验证右上角图标位置、
Enter 复制内容、定义位置保留、两段说明删除，以及 390px 下代码无溢出；页面异常为 0。
截图为 `/tmp/dsh-ibis-copy-icon-desktop.png` 和 `/tmp/dsh-ibis-copy-icon-mobile.png`。
已安装客户端摘要与构建产物一致，Workspace 与会话文件摘要未变。

## 2026-09-06：概览与定义分离、定义平铺

概览仅保留业务定义、关键属性和使用约束；计算详情集中在定义页。
定义页移除折叠交互，按当前公式、引用对象定义、数据来源、补充属性和定义位置分区展示。
引用对象按精确 Ref 去重后平铺，保留公式中的重复项与顺序、对象使用约束和已声明或已解析的时间规则。
省略重复业务说明、空属性、已展示的计算字段及关系页中的引用列表。

`npm run check`（161 项测试）、构建、包校验和 `git diff --check` 通过。
浏览器夹具验证概览不含计算卡、定义页无 `details`、重复引用只出现一份定义、线性公式仍保留重复项，
并继续通过累计日历、比率、复制、导航和 Workspace 生命周期测试。
本地 web Profile 的 `commerce.gross_margin_rate` 验证 12 个引用定义均不重复，公式跳转/返回保持定义页，
Ibis 复制和 390px 布局正常，页面异常为 0。已安装客户端摘要匹配，Workspace 与会话摘要未变。
截图为 `/tmp/dsh-definition-overview-desktop.png`、`/tmp/dsh-definition-flat-desktop.png` 和
`/tmp/dsh-definition-flat-mobile.png`。

## 2026-09-07：Marivo 0.5.4 时间规则状态

接入 Marivo issue #2 修复后的公共 `temporal.effective` 状态，不在插件内推导 fold。
无声明、无覆盖且 `not_applicable` 时省略时间折叠区；`component_defined` 显示“由计算公式及组成对象确定”，
并保留引用对象下的明确规则。`resolved` 继续展示精确时间轴、分位数参数和指标覆盖。
累计默认轴的 `node.over.resolution=context_required` 独立保留，不再用于解释有效 fold。
未知状态明确显示不支持，避免误标为“不适用”。

在独立安装的正式 Marivo 0.5.4 Runtime 中验证：

- 真实 Catalog 夹具覆盖全部 13 种对象；普通聚合和加减返回 `not_applicable`，比率、累计和含时间折叠输入的线性组合返回 `component_defined`。
- 声明、度量继承和指标覆盖的 `resolved` payload 保留 source、精确 over Ref、percentile `q=0.95` 及 `last`。
- 禁止 observe、preview、readiness、连接测试与分析 Session 创建的测试通过，项目目录读取前后摘要一致。
- ecommerce 项目成功读取 140 个对象：`commerce.gross_profit` 无独立折叠；`commerce.gross_margin_rate` 与
  `growth.retail_quarter_to_date_campaign_spend` 由组成定义决定；`operations.sellable_inventory` 明确沿
  `operations.inventory_daily.snapshot_date` 取末值。
- Chromium 夹具通过时间规则展示、默认累计轴提示、公式重复项与引用去重、Ibis 复制、对象导航、过滤、刷新失败和窄屏验证。
  证据保存于 `/tmp/dsh-temporal-054-browser/result.json` 和 `temporal-component-defined.png`。

Node.js 24.18.0 下专项 12 项测试通过，`npm run check` 共 153 项测试通过，0 失败、0 跳过。
`npm run build`、`npm run verify:plugin-package` 和 `git diff --check` 通过。
浏览器使用生产页面和真实 Catalog，Host/slot 为隔离夹具；本次未重装或重启正在使用的 DSH Profile。

## 2026-09-09：统一语义层 Tab

语义层只使用原生 Tab，删除旧的 `shell.overlay` 注册、dialog 生命周期和专用样式。
分类改为顶部横向排列并保留业务域筛选、类型计数；下方沿用完整对象列表、概览、定义、关系图、复制与加入提问功能。
标题行仅保留一个刷新图标；标题右侧显示最近更新时间，移除项目路径和 Catalog fingerprint。
独立对象 Tab 的内部导航与目录 Tab 一致，使用当前快照和浏览历史；仅显式打开独立标签页才导航到资源地址。

验证证据：

- Node.js 22.19.0 下 `npm run check`、`npm run build`、`npm run verify:plugin-package` 通过。
- 新增目录与对象 `TabPage` 回归测试：对象切换、返回与同 revision 的 Host 重挂载不重读；显式刷新保留搜索、分类和选中对象。
- `validate:semantic-browser:web` 使用真实 Marivo Catalog 与 Chromium，验证定义、复制、关系图、分类计数、请求次数、刷新失败保留旧快照、宽屏与 390px 布局。
  标题右侧更新时间、最右侧单一刷新图标、项目路径与 Catalog SHA 缺席均通过 DOM/几何断言。
  证据目录为 `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-semantic-browser-validation`。
- `validate:right-tabs:web` 使用打包插件与隔离真实 Harness，验证顶部分类在窄栏可见、重复入口保留筛选、对象关联导航不换 Tab 或 Catalog 快照、历史返回和报告来源导航。
  证据目录为 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-right-tabs-stage-one-rJGA9M`。
- `validate:semantic-ask-dsh:web` 通过原生 chip 插入、撤销、附件保留、Session 切换取消、提交边界和 Workspace 重建验证。
  证据目录为 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-semantic-ask-dsh-pYfIta`。

旧的弹窗叠放与关闭焦点验收随弹窗移除；`validate:presentation-semantic-navigation` 转到原生 Tab 验收入口。
原生 Host 验收覆盖导航及输入行为；最终标题信息布局另由正文夹具验证。所有环境均隔离，未重装或重启当前使用的 DSH Profile。

## 2026-09-10：概览与定义属性引用跳转

概览与定义属性复用 Catalog 的字段关联，将完整 Ref 渲染为可跳转链接；所属业务域按当前目录中的 domain 对象定位。
累计公式中的语义日历名称同样可跳转。独立 Tab 入口保留，用于同时保留多个对象页面及各自的筛选、浏览历史。

`npm run validate:semantic-browser:web` 使用真实 Marivo Catalog 与隔离 Chromium 夹具通过：业务域、实体、数据源、
事件来源、日历层级和累计公式日历可跳转并返回；跳转前后 Catalog 请求数不变。渲染回归覆盖映射标签、重复引用、
相似路径不误匹配、缺失对象禁用和普通文字转义。本次没有重装插件或重启正在运行的 DSH Profile。

完整 `npm run check` 通过：552 项通过、0 失败、4 项因未配置对应真实运行环境变量而跳过。
`npm run build`、`npm run verify:plugin-package`、文档相对链接检查与 `git diff --check` 均通过。

## 2026-09-10：保留 Marivo 语义模型诊断

语义层 Catalog 加载失败时，Marivo 的语义错误类型、正文、引用和提示通过受控 error envelope 展示，
不再统一包装为“无法加载语义层”；未知异常仍不回传 Python traceback。错误区域保留换行，便于阅读多行引用和修复提示。
凭据值仍不进入 RPC/UI 结果。

专项 `npm run test:semantic-browser` 验证 Marivo 诊断穿透、未知异常兜底、Workspace 归属和现有只读边界；
本次未重装或重启正在使用的 DSH Profile。
