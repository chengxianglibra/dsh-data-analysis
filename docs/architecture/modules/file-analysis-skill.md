# 文件分析 Skill

## 责任与入口

`dsh-data-analysis-files` 将已上传或 Workspace 中的文件接入现有 Python 执行与分析视图交付。
Harness 拥有附件存储、可读路径、原生 `present` 卡片／预览／持久事件与 Session 生命周期；pandas／DuckDB 拥有格式读取和计算；插件提供
Runtime/Workspace binding、执行记录及结果交付，不添加上传 Tool、文件解析器或语义模型。

入口是 [SKILL.md](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md)，仅保留接入规则；
[示例](../../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/references/examples.md)分别展示 pandas 和原生 DuckDB。
它随插件自带 Skill provider 分发，加载时不触发任何 Marivo Runtime Skill 的根 Help 披露。

## 执行与结果

Harness 可预览文本附件。分析按附件原路径读取数据；聊天中的预览不证明计算范围。纯本地文件使用 `marivo_python(datasources: [])`，Agent 按任务选择 pandas、原生 `duckdb` 或两者组合。
无需先调用 `md.raw_sql` 或查询 Marivo Help；访问 Marivo datasource 时仍须声明精确名称并遵守公开契约。
原生 DuckDB 连接在一次调用内可执行多条 SQL 和使用临时表；每次 Tool 使用独立 Python 进程，不保留跨调用内存状态。

普通文件预览使用 project=none，不创建项目；Marivo 项目分析或结果持久化使用 project=required，由插件按[Workspace 契约](runtime-workspace.md#workspace-解析与-zero-init-binding)准备准确根项目。无需因此建立 datasource 或业务语义。

文件流程覆盖 CSV、JSON／JSON Lines、Parquet、Excel `.xlsx`。`.xlsx` 复用 DuckDB 官方扩展，首次获取
需要联网；不新增 `openpyxl` 依赖，不承诺旧 `.xls`。这不限制 Skill 根据实际可用 reader 处理其他合适文件。

是否生成分析视图、增量展示和聊天收尾遵循[展示 Skill](presentation-skill.md)。按数据依赖组织 Python 执行，一次调用可持久化并导出多个 DataFrame。经 `resultVariables` 导出的完整 `results[name].resource` 原样交给 `marivo_report_write`，由它组织说明和快照。纯文件计算无需强行建模，适用的 governed 分析优先保留 AnalysisFrame。调用规则见[展示交付](presentation-delivery.md)。

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
分析视图的保存记录、快照和 receipt 不默认附加；分析视图 Tab 中的 HTML 下载属于浏览器文件，不自动成为 Session 文件，也不提供对象存储发布。
