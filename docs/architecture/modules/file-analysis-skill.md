# 文件分析 Skill

## 责任与入口

`dsh-data-analysis-files` 将已上传或 Workspace 中的文件接入现有 Python 执行与分析视图交付。
Harness 拥有附件存储、可读路径、原生 `present` 卡片／预览／持久事件与 Session 生命周期；pandas／DuckDB 拥有格式读取和计算；插件提供
Runtime/Workspace binding、执行记录及结果交付，不添加上传 Tool、文件解析器或语义模型。

入口是 [SKILL.md](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md)，仅保留接入规则；
[示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/references/examples.md)分别展示 pandas 和原生 DuckDB。
它随插件自带 Skill provider 分发，加载时不触发任何 Marivo Runtime Skill 的根 Help 披露。文件结果适合图表或交互理解、比较、核对时主动进入展示流程，无需用户明确要求报告；准备数据前加载展示 Skill，分析中才确定时立即加载。新视图在首次分析计算前展示问题与范围，结果就绪即更新同一草稿；尊重纯文字和纯文件要求。

## 执行与结果

Harness 可预览文本附件。分析按附件原路径读取数据；聊天中的预览不证明计算范围。纯本地文件使用 `marivo_python(datasources: [])`，Agent 按任务选择 pandas、原生 `duckdb` 或两者组合。
无需先调用 `md.raw_sql` 或查询 Marivo Help；访问 Marivo datasource 时仍须声明精确名称并遵守公开契约。
原生 DuckDB 连接在一次调用内可执行多条 SQL 和使用临时表；每次 Tool 使用独立 Python 进程，不保留跨调用内存状态。

普通文件预览可省略 `project`，跳过项目准备。声明 `resultVariables` 持久化结果时，插件按[Workspace 契约](runtime-workspace.md#workspace-解析与-zero-init-binding)准备准确根项目。只在代码中访问项目且没有声明数据源或结果导出时，显式传 `project:"required"`。无需因此建立 datasource 或业务语义。

文件流程覆盖 CSV、JSON／JSON Lines、Parquet、Excel `.xlsx`。`.xlsx` 复用 DuckDB 官方扩展，首次获取
需要联网；不新增 `openpyxl` 依赖，不承诺旧 `.xls`。这不限制 Skill 根据实际可用 reader 处理其他合适文件。

是否生成分析视图、增量展示和聊天收尾遵循[展示 Skill](presentation-skill.md)。按数据依赖组织 Python 执行，一次调用可通过 resultVariables 直接声明多个已计算对象或固定引用，工具负责必要的持久化；待计算 Frame 先显式 compute。经 `resultVariables` 导出的完整 `results[name].resource` 原样交给 `marivo_report_write`，由它组织说明和快照。governed 输入和受支持的类型化分析优先产生并保留 AnalysisFrame，用 AnalysisFrameView 展示，不为画图转成 DataFrame；纯文件或外部结果可用 DatasetView，无需强行建模。调用规则见[展示交付](presentation-delivery.md)。

用户要求查看已有表格文件，或要求 CSV、TSV、JSON、PNG 等实际文件时，确认文件存在且可访问后调用当前可用的 Harness 原生 `present`。CSV、TSV、XLSX 的只读文件预览由 Harness 提供。最终文件优先写入绑定 Workspace，普通声明不获得 Report/Build 或 Evidence 身份。
正文说明文件与分析范围，执行/codeRef 由 Host 绑定，不把文件结果声明成 Marivo Evidence。

## 验证边界

资源检查验证 Skill frontmatter、引用和打包；集成测试验证发现、加载、释放及独立 Help 披露。
真实验收使用打包插件、隔离 profile／Workspace 和原生附件 receipt，由模型自行取得文件路径并选择执行方式；
覆盖四格式、两种执行方式、报告、同名附件、追问与恢复。未完成的真实环境用例必须单独标明，不能以静态测试代替。

执行 `npm run validate:file-analysis:real` 验证报告用户旅程；设置 `DSH_DATA_ANALYSIS_VALIDATION_SUITE=files`
验证普通文件，`DSH_DATA_ANALYSIS_VALIDATION_FILE_CASES` 可选择 `delivery`、`failures` 或默认 `all`。
S2 已完成的真实模型、预览、恢复及受控故障证据记录在本地 `docs/testing/validation.md`。

## 普通文件交付边界

插件不注册通用交付 wrapper 或表格 renderer，不复制 [Harness present 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/deliverables/tool-present/README.zh.md)的 schema、路径授权或事件存储。
缺少工具时提供准确路径并说明原生交付不可用；生成失败、声明失败与后续打开失败分别诊断。
声明失败修复后只补交付；响应不确定先核对调用和事件，避免重复声明。

卡片读取当前源文件，修改、移动或删除会影响打开。PTC 外层失败不撤销已完成的声明；
子 Session 的产物需要父 Agent 确认可访问后自行声明，不自动跨 Session 转投递。
分析视图的保存记录、快照和 receipt 不默认附加。发布关闭时，分析视图 Tab 的 HTML 下载属于浏览器文件，不自动成为 Session 文件。发布开启时，可通过报告菜单或独立的[对象存储发布接口](report-publishing.md#对象存储发布)交付已保存版本。
