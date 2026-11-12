---
name: dsh-data-analysis-files
description: 分析附件或 Workspace 中的 CSV、JSON、Parquet、Excel 数据，回答问题、准备分析视图数据或交付实际文件。普通文件计算无需先建立 Marivo datasource 或语义模型。
---

# 文件分析

负责文件身份、读取计算、分析核对与普通文件交付。图表或交互有助于理解、比较或核对结果时，主动使用分析视图，不等用户明确要求报告；在准备数据前加载 `dsh-data-analysis-presentation`，分析中才确定时立即加载。新视图在首次分析计算前展示问题与范围，再随结果更新草稿。文字已足够且视图无额外价值时直接回答；尊重纯文字、纯文件要求。

## 输入与执行

使用 Harness 提供的当前附件可读路径，或用户指定的 Workspace 文件。同名附件按消息和完整路径区分；路径不可读时说明实际问题，不猜缓存位置。在读取代码中保留准确路径，不为缩短路径复制成 Workspace 同名文件。

Harness `read` 可预览文本，但计算仍需通过 `marivo_python` 从原路径读取。计算和最终文件生成使用绑定 Runtime，不切换 Bash 的 python/python3 或其他解释器。纯本地文件使用 pandas 或原生 DuckDB，传 `project:"none"`、`datasources: []`，无需 `md.raw_sql`、Marivo 分析 Skill、live Help 或语义建模。实际访问 Marivo datasource 时声明精确名称并查询相关契约。

按实际输入选择 reader、sheet、字段和解析范围，区分样本与全量。Excel `.xlsx` 可用 DuckDB `read_xlsx`，首次获取官方扩展可能联网；不承诺旧 `.xls` 或冷缓存离线读取，不临时安装 Python 依赖。

每次调用是独立进程。本次调用内可以复用原生 DuckDB 连接和临时表并及时关闭，后续调用不依赖这些状态。控制读取和输出规模；SQL LIMIT 不等于扫描预算。

项目分析、datasource 访问或持久化结果时传 `project:"required"`，由插件准备绑定 Workspace 的项目。根据本次返回处理无效项目或准备失败。

## 计算与证据

确认粒度、单位、时间范围和比较基准；检查影响答案的解析类型、缺失、重复和连接基数。合并、筛选或去重时说明规则，不把缺失当零或样本当全量。

逐项核对用户问题及比较分支，保留比较两侧、变化方向和比例分母。从原值核对差值、比例、全量合计与余项；Top N 不能替代全量结论。核对正文中的名称、大小和涨跌方向与同一项数据一致。不同基准可以解释比率差异，本身不能证明业务原因；观测和数值贡献不自动建立因果。

缺少基准或分支时，交付已有支持的答案并说明缺失范围及影响，不用其他成功比较替代。答案已有支持或阻塞已明确时停止，不为完善展示扩大分析。

## 分析视图数据

遵循展示 Skill 的增量流程，结果就绪后及时更新同一草稿。governed 输入和受支持的类型化分析优先产生并保留 AnalysisFrame，使用 AnalysisFrameView，不要仅为展示转成 DataFrame。纯文件或外部结果可用 DatasetView，不为更换视图强行建模。

新计算显式读取准确输入；通过 `project:"required"`、`resultVariables` 直接导出已计算的 Frame、pandas DataFrame 或准确固定引用。待计算 Frame 先显式 compute，工具负责必要的持久化。原样把 `results[name].resource` 交给 marivo_report_write，kind 和 codeRef 由插件关联；来源或 metadata 失败不使有效资源失效，不授权重跑。

相同固定结果可供多个视图使用，保留原 resource/codeRef。确需派生时显式读取准确固定输入并导出新结果，不依赖前次内存。stdout 不用于发现引用，外部结果缺脚本时说明缺口，不补执行记录。首次交接读展示 Skill 的结果导出参考，Marivo API 约束以 live Help 为准。视图说明输入与范围，刷新按仅资源替换流程保留布局和正文。

## 可复用语义与停止条件

区分共享业务定义与本次计算：指标定义、维度含义和业务关系可成为语义候选；观测数值、临时筛选和未验证假设不自动成为共享定义。

只有当前问题需要共享定义或用户已授权语义沉淀时，加载 `marivo-semantic`，携带复用用途、依据、范围和未决含义，优先复用已有对象，只处理最小必要缺口。授权与业务含义已明确则继续，实质歧义交给语义流程澄清。

得到经验证的对象后继续原问题。范围外机会只简述用途与依据，不自动建模、另建记录或扩展相邻业务域；展示流程不承担语义沉淀。

## 普通文件交付

用户要求查看或交付已有 CSV、TSV、XLSX 等文件时，先确认当前 Session 可访问，再按[文件交付](references/delivery.md)调用 Harness 原生 `present`。其只读表格预览不等同于 Marivo 报告，也不扩大插件的读取或写入格式能力。

用户要求生成 CSV、TSV、JSON、PNG 等文件时，用 `marivo_python` 生成到当前绑定 Workspace；确认执行成功和文件存在后再声明交付。生成与声明分别核对，路径和代码块不能代替文件卡片。不承诺插件能写入 XLSX，也不把 Harness 对旧 `.xls` 的预览当作插件可分析 `.xls`。

聊天中金额使用 USD 等货币代码或名称，避免美元符号被解析为数学定界符。需要起步代码时读[文件示例](references/examples.md)，只交付用户要求的文件。
