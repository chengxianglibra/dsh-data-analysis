---
name: dsh-data-analysis-files
description: 分析附件或 Workspace 中的 CSV、JSON、Parquet、Excel 数据，回答问题或交付 CSV、JSON、PNG 文件。可接续报告展示，无需先建立 Marivo datasource 或语义模型。
---

# 文件分析

本 Skill 负责文件读取、计算、分析核对与普通文件交付。按用户问题选择方法；需要保存报告或交互展示时，完成分析后交给 `dsh-data-analysis-presentation`。

## 确认输入与执行

使用 Harness 提供的当前附件可读路径，或用户指定的 Workspace 文件；同名附件按消息和完整路径区分。路径不可读时报告实际问题，不猜测 Host 缓存位置。
在实际读取代码中使用该完整路径，使执行记录保留输入身份；不为缩短路径而复制成 Workspace 同名文件，以免覆盖或在后续追问中读到旧副本。

文件读取、计算和最终文件生成均通过 `marivo_python` 在绑定 Runtime 中执行，不改走 Bash 的 `python`／`python3` 或其他解释器。纯本地文件分析可直接使用 pandas 或原生 `duckdb`，传 `datasources: []`；无需 `md.raw_sql`、Marivo 分析 Skill、live Help 或语义建模。只有实际访问 Marivo datasource 时才声明其精确名称并查询相关契约。

使用现有 reader，保留回答所需的 sheet、字段和解析范围；区分样本与全量。Excel `.xlsx` 可用 DuckDB `read_xlsx`，首次使用可能联网获取官方扩展；不承诺旧 `.xls` 或冷缓存离线读取，不临时安装 Python 依赖。

每次 `marivo_python` 都是独立进程。原生 DuckDB 连接可在本次调用内复用、创建临时表，并及时关闭；后续追问重新读取原文件或已有结果，不依赖上次内存状态。按问题控制读取和输出规模，SQL `LIMIT` 不代表仅扫描这些行。

## 计算与核对

按问题确认粒度、单位、时间范围与比较基准；检查会影响计算的解析类型、缺失值、重复记录及连接基数。合并同名文件、筛选或去重时说明实际规则，不把缺失值当零，不把样本当全量。

完成文字答案或生成交付物前，逐项核对用户问题及各比较分支。保留比较两侧、变化方向和比例分母，从原值核对差值、比例与合计；Top N 或子集不能替代全量结论。观测和数值贡献不自动证明原因；结论措辞应体现实际证据强度。
最后核对解释文字中的比较名称与涨跌方向是否和表中同一项一致；基准不同可以解释比率差异，本身不能证明业务变化的原因。

某个基准或分支缺数据时，交付已有支持的答案，并明确缺失范围及影响，不用另一项成功比较替代。所需答案已有支持或已明确阻塞时结束，不为完善展示额外扩展分析。

## 按用户目标交付

普通答案和简短比较表格直接在聊天中回答，不额外创建文件。用户要求 CSV、JSON、PNG 等实际文件时，先读[文件交付](references/delivery.md)，通过 `marivo_python` 生成最终文件，优先写入当前绑定 Workspace；确认执行成功、文件存在后，调用实际可用的 Harness 原生 `present`，再回复用户。文件生成和原生声明分别核对，路径或代码块不能替代交付。

需要交互图表、表格、报告或看板时加载 `dsh-data-analysis-presentation`，将 DataFrame 交给现有 writer，关联实际返回的 `codeRef`，用 `marivo_present` 保存固定 Build。在正文说明文件名与分析范围，不将文件结果冒充 Marivo Artifact 或 Evidence。普通 `present` 不赋予文件 Report/Build 或 Evidence 身份。

需要起步代码时读[简短示例](references/examples.md)；其中提供无需额外依赖的 PNG 写入代码，也通过 `marivo_python` 执行。
