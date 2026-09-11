# 文件分析 Skill

## 责任与入口

`dsh-data-analysis-files` 将已上传或 Workspace 中的文件接入现有 Python 执行与报告流程。
Harness 拥有附件存储、可读路径、原生 `present` 卡片／预览／持久事件与 Session 生命周期；pandas／DuckDB 拥有格式读取和计算；插件提供
Runtime/Workspace binding、执行记录及结果交付，不添加上传 Tool、文件解析器或语义模型。

入口是 [SKILL.md](../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md)，仅保留接入规则；
[示例](../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/references/examples.md)分别展示 pandas 和原生 DuckDB。
它随插件自带 Skill provider 分发，加载时不触发 `marivo-analysis`／`marivo-semantic` 根 Help 披露。

## 执行与结果

纯本地文件使用 `marivo_python(datasources: [])`，Agent 按任务选择 pandas、原生 `duckdb` 或两者组合。
无需先调用 `md.raw_sql` 或查询 Marivo Help；访问 Marivo datasource 时仍须声明精确名称并遵守公开契约。
原生 DuckDB 连接在一次调用内可执行多条 SQL 和使用临时表；每次 Tool 使用独立 Python 进程，不保留跨调用内存状态。

文件流程覆盖 CSV、JSON／JSON Lines、Parquet、Excel `.xlsx`。`.xlsx` 复用 DuckDB 官方扩展，首次获取
需要联网；不新增 `openpyxl` 依赖，不承诺旧 `.xls`。这不限制 Skill 根据实际可用 reader 处理其他合适文件。

普通答案使用文字；用户要求 CSV、JSON、PNG 等实际文件时，执行成功后调用当前可用的 Harness 原生 `present`。
最终文件优先写入绑定 Workspace，普通声明不获得 Report/Build 或 Evidence 身份。报告复用[展示 Skill](presentation-skill.md)、computed writer 和实际 `codeRef`。
正文说明文件与分析范围；没有 Artifact 时 `sourceIds` 为空，不把文件结果声明成 Marivo Evidence。

## 验证边界

资源检查验证 Skill frontmatter、引用和打包；集成测试验证发现、加载、释放及独立 Help 披露。
真实验收使用打包插件、隔离 profile／Workspace 和原生附件 receipt，由模型自行取得文件路径并选择执行方式；
覆盖四格式、两种执行方式、报告、同名附件、追问与恢复。未完成的真实环境用例必须单独标明，不能以静态测试代替。

执行 `npm run validate:file-analysis:real` 验证报告用户旅程；设置 `DSH_DATA_ANALYSIS_VALIDATION_SUITE=files`
验证普通文件，`DSH_DATA_ANALYSIS_VALIDATION_FILE_CASES` 可选择 `delivery`、`failures` 或默认 `all`。
S2 已完成的真实模型、预览、恢复及受控故障证据见[验证指南](../validation.md#普通文件原生交付验收)。

## 普通文件交付边界

插件不注册通用交付 wrapper，不复制 [Harness present 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/fs/tool-present/README.md)的 schema、路径授权或事件存储。
缺少工具时提供准确路径并说明原生交付不可用；生成失败、声明失败与后续打开失败分别诊断。
声明失败修复后只补交付；响应不确定先核对调用和事件，避免重复声明。

卡片读取当前源文件，修改、移动或删除会影响打开。PTC 外层失败不撤销已完成的声明；
子 Session 的产物需要父 Agent 确认可访问后自行声明，不自动跨 Session 转投递。
报告内部 JSON、computed 数据和 receipt 不默认附加；HTML 下载／发布保持原有流程。
