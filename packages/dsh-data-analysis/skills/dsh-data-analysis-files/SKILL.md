---
name: dsh-data-analysis-files
description: 分析已上传或 Workspace 中的 CSV、JSON、Parquet、Excel 文件，使用 pandas 或 DuckDB 计算并按需接入报告。适用于直接分析文件内容，无需先建立 Marivo datasource 或语义模型。
---

# 文件分析

使用 Harness 提供的当前附件可读路径，或用户指定的 Workspace 文件；同名附件按消息和完整路径区分。路径不可读时报告实际问题，不猜测 Host 缓存位置。

通过 `marivo_python` 在绑定 Runtime 中执行。纯本地文件分析可直接使用 pandas 或原生 `duckdb`，传 `datasources: []`；按任务选择或组合使用，无需 `md.raw_sql`、Marivo 分析 Skill、live Help 或语义建模。只有实际访问 Marivo datasource 时才声明其精确名称并查询相关契约。

使用现有 reader，保留回答所需的 sheet、字段和解析范围；区分样本与全量。Excel `.xlsx` 可用 DuckDB `read_xlsx`，首次使用可能联网获取官方扩展；不承诺旧 `.xls` 或冷缓存离线读取，不临时安装 Python 依赖。

每次 `marivo_python` 都是独立进程。原生 DuckDB 连接可在本次调用内复用、创建临时表，并及时关闭；后续追问重新读取原文件或已有结果，不依赖上次内存状态。按问题控制读取和输出规模，SQL `LIMIT` 不代表仅扫描这些行。

普通答案直接用文字。需要图表或报告时加载 `dsh-data-analysis-presentation`，将 DataFrame 交给现有 writer，并关联实际返回的 `codeRef`；在正文说明文件名与分析范围，不将文件结果冒充 Marivo Artifact 或 Evidence。

需要起步代码时读[简短示例](references/examples.md)。
