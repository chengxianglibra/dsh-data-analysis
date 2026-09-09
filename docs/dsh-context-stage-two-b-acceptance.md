# 第二阶段 2b 报告 cell 精确引用验收

## 交付范围

基于 `077d949`，按 [第二阶段调研修订](dsh-context-stage-two-research.md#经实施讨论修订的-2b-范围)
将追问上下文从内容摘要改为固定 Build/cell 引用。Harness 拥有草稿、引用和附件生命周期；
插件只负责定位与页面临时状态，Marivo 的数据、来源及 Evidence 契约保持原有责任。

引用包含实际显示的 Workspace、Report ID、Build ID、Cell ID/类型与固定 Build 文件相对路径。
报告标题和已有 cell 标签最多 80 个 Unicode 码点。路径由浏览器与服务端共用纯契约模块生成；
没有新增 schema、Tool、RPC 或 package exports。

正文、指标值、单位、比较、列定义和来源详情不复制进问题。筛选只提供有效 filter/option ID 与短标签；
prepared view 使用 ID，仅当前配置偏离 authored/prepared view 时提供一份完整 ChartView，隐藏系列
单独记录。表格提供排序，引用范围是全部筛选结果，不限定当前分页。不新增细粒度选择入口。

在线与离线都在点击时生成，12 KiB UTF-8 上限包含包装及两个换行的预留；定位和临时状态不截断。
生成失败不改变草稿或剪贴板；剪贴板失败才显示手动复制弹窗。未保存编辑期间禁止引用。
原有 Session/Workspace 与 revision 校验、一次 Host 插入、重复点击重复追加规则继续生效。

## 读取路径与模型边界

固定 Build 的 `presentation.json` 是紧凑单行 JSON。安装的 Harness 默认 `read` 工具有单行上限，
不能把读取返回的截断行当成完整报告，也不能仅靠行分页取回剩余内容。Skill 参考文档已明确：
必要时使用现有 Workspace 文件能力只读解析目标 JSON 字段；不放宽 Host 限额、不新增读取工具。

隔离验收使用真实 Harness AgentLoop 与公开 `read`、`bash` 工具。Scripted adapter 先请求读取引用
路径，再通过只读 Node.js JSON 解析取出目标 cell、对应 dataset 和已声明的 slice 行索引，并在后续
真实请求 messages 中检查返回内容。这里验证的是工具与模型请求接线，不是真实模型理解能力或任务表现。
解释先读取引用 Build；修改前另读 current，沿用已有 `expected_build_id` 冲突规则，不静默替换目标。

## 确定性验证

新增测试覆盖存储路径一致性、引用与原文档共同恢复目标和筛选精确指标、prepared view 与自定义覆盖、
隐藏系列、恢复原图、排序及完整结果范围。无探索或仅 JSON key 顺序变化时不增加配置。

经 parser 验证的 5,000 行表格、空筛选结果、32,768 汉字 Markdown、64 个来源不会使引用展开数据或正文；
Unicode 标签按码点缩略。字节上限覆盖包装和分隔符，超限引用拒绝写入，用户已有长草稿不受裁剪。
既有 reader 的 decimal、int64、null、比较与排序精度测试继续执行。

## 运行结果

2026-09-09，Node.js `22.19.0`，Harness `0.1.5-alpha.1`，Marivo `0.5.4`，
Chrome `152.0.7977.83`。真实 Web 共 44 项检查通过，包括 Native/PTC、current/固定 Build、
新版本提示、筛选、prepared view、隐藏系列、表格排序、两个独立 chip、附件、一次撤销、重复追加、
写入失败保留与重试、超限生成失败、恢复后重试、离线复制和手动复制回退，以及原有生命周期场景。

两个独立新 Agent 仅凭引用，经公开 `read` 与 `bash` 返回的内容，分别取回筛选行 `[4]` 的字符串
`"150"` 和精确 int64 字符串 `"9007199254740993"`；两者均实际遇到 read 单行截断。
current 已更新后，再次读取旧引用仍取回同一固定 Build 和原值。

单次引用测量包含包装：带两个筛选条件的指标引用为 **810 字节**；32,768 汉字 Markdown 的引用为
**546 字节**。这只是合成 fixture 的 UTF-8 字节证据，不是模型 token 或认知成本的实测改善。
合法的 16 条参考线、每条 256 字符的保存配置不会扩大默认引用；修改数据点显示后，必须附上的完整
临时配置超过 12 KiB，在线草稿与离线剪贴板均保持原样，恢复原图后可成功重试。

本地证据为 [Web 检查与运行身份](../artifacts/dsh-context-stage-two-b/evidence.json)和
[2b 引用与读取结果](../artifacts/dsh-context-stage-two-b/context-reference-evidence.json)，被 Git 忽略；
关键结果已抄录于本文。原始运行目录标识为 `dsh-right-tabs-stage-one-qYkN9F`，临时 Workspace/profile
与测试服务已清理，证据独立保留。

构建和包验证通过：230 个分发文件，28 个 DSH peers 均为 `0.1.5-alpha.1`，打包的 presentation kit、
契约和 offline builder 验证通过。最终 `npm run check` 的 quality、依赖树、源码/脚本 typecheck 与
共 474 项测试，其中 470 项通过、4 项既有 Runtime 条件测试跳过。一次中间复验的既有 SQL 大文本 fixture 子进程停滞，终止该次测试进程后，
该文件独立重跑 13 项和最终完整检查均通过，未修改 SQL 实现或测试。真实 Web 安装包的 82 个生产 JS
模块摘要与最终构建一致。文档本地链接、Skill frontmatter 和 `git diff --check` 检查通过。

补充运行 `validate:presentation-ask-dsh`，使用打包客户端的公开 `installPresentation` 独立回退入口，
验证追加、编辑禁用、Session/写入失败、chip、附件、撤销与离线手动复制。旧验收脚本的默认入口已切换
为原生 Tab，因此测试配置显式选择保留的对话框入口；不改变生产默认行为。
[回退入口证据](../artifacts/dsh-context-stage-two-b/fallback-evidence.json)保留模型边界说明，临时状态已清理。

本切片不调用业务数据库或远端模型，不重装用户插件、不重启现有 Web，不提交、推送或发布。
隔离验收只创建合成数据与临时 Workspace/profile，停止并清理自身服务后保留证据。

## Review 修复：身份字段无歧义编码

2026-09-09，修复合法 Cell ID 含换行时可能误选同前缀 cell 的问题。`Workspace`、`Cell` 与
`Prepared view` 使用 JSON 字符串编码，读取时先解码再按完整 ID 匹配；报告标题加 `Report title`
字段名，避免标题冒充定位字段。原有报告 schema 和 ID 接受范围保持不变。

新增经 parser 验证的回归用例，覆盖同前缀 cell/prepared view，以及换行、回车、制表符、引号、
反斜杠和 Unicode；同时覆盖标题、Workspace 文本含 `Cell:` 的情况。原生 Tab 验收通过真实菜单生成
特殊字符引用，scripted adapter 经 Harness 公开 `read`、`bash` 工具取回完整 ID 对应的 cell，
没有误选 `foo`。读取约定与所有已有引用断言同步更新。

本次 Node.js `22.19.0` 的 `npm run check` 共 475 项测试，471 项通过，4 项既有 Runtime 条件测试
因未设置 `DSH_DATA_ANALYSIS_PYTHON` 跳过；构建与包验证通过。编码后的合成 fixture 引用含包装分别为
828 字节（多筛选指标）和 564 字节（长 Markdown），取回的精确值仍为 `150` 和 `9007199254740993`。
本次证据单独保留于 [修复后的引用读取结果](../artifacts/dsh-context-stage-two-b/review-fix-context-reference-evidence.json)。
完整原生 Web 的 44 项检查通过，覆盖离线复制、手动回退及草稿保留；
[修复后的 Web 证据](../artifacts/dsh-context-stage-two-b/review-fix-evidence.json)保留检查清单。
临时 Workspace/profile 与自建服务已清理，文档本地链接及 `git diff --check` 通过。
