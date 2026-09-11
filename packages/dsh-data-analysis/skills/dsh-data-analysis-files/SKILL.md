---
name: dsh-data-analysis-files
description: 分析已上传或 Workspace 中的 CSV、JSON、Parquet、Excel 文件，使用 pandas 或 DuckDB 计算，按需导出 CSV、JSON、PNG 等普通文件或接入报告。无需先建立 Marivo datasource 或语义模型。
---

# 文件分析

使用 Harness 提供的当前附件可读路径，或用户指定的 Workspace 文件；同名附件按消息和完整路径区分。路径不可读时报告实际问题，不猜测 Host 缓存位置。

文件读取、计算和最终文件生成（包括 CSV、JSON、PNG）均通过 `marivo_python` 在绑定 Runtime 中执行，不改走 Bash 的 `python`／`python3` 或其他解释器。纯本地文件分析可直接使用 pandas 或原生 `duckdb`，传 `datasources: []`；按任务选择或组合使用，无需 `md.raw_sql`、Marivo 分析 Skill、live Help 或语义建模。只有实际访问 Marivo datasource 时才声明其精确名称并查询相关契约。

使用现有 reader，保留回答所需的 sheet、字段和解析范围；区分样本与全量。Excel `.xlsx` 可用 DuckDB `read_xlsx`，首次使用可能联网获取官方扩展；不承诺旧 `.xls` 或冷缓存离线读取，不临时安装 Python 依赖。

每次 `marivo_python` 都是独立进程。原生 DuckDB 连接可在本次调用内复用、创建临时表，并及时关闭；后续追问重新读取原文件或已有结果，不依赖上次内存状态。按问题控制读取和输出规模，SQL `LIMIT` 不代表仅扫描这些行。

## 按用户目标交付

普通答案直接用文字，不为结论额外创建文件。用户要求 CSV、JSON、PNG 等实际文件时，先通过 `marivo_python` 生成最终文件，优先写入当前绑定 Workspace；确认执行成功、文件存在后，调用当前实际可用的 Harness 原生 `present`，再回复用户。回复前分别核对文件生成与原生声明状态：生成文件、回复路径或展示代码块均不能替代原生交付。缺少 `present` 时，最终回复必须说明“文件已生成，原生交付能力不可用”，并提供准确路径；不能只说文件已生成。不猜测附件缓存或 Shell 私有临时目录。

需要交互图表、表格、报告或看板时加载 `dsh-data-analysis-presentation`，将 DataFrame 交给现有 writer，并关联实际返回的 `codeRef`，使用 `marivo_present` 保存固定 Build。在正文说明文件名与分析范围，不将文件结果冒充 Marivo Artifact 或 Evidence。普通 `present` 不赋予文件 Report/Build 或 Evidence 身份。

报告内部的 `presentation.json`、computed 数据和 receipt 不作为默认附件；只有用户另行要求实际文件且文件已经存在于 Session 文件系统可访问位置时，才调用 `present`。阅读器下载／发布 HTML 沿用现有流程，浏览器内生成的下载不伪装成 Session 文件。

## 能力与失败

遵循 Harness [present 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/fs/tool-present/README.md)，由工具验证路径和文件类型。当前工具集中缺少 `present` 时，明确说明“文件已生成，原生交付能力不可用”，提供实际准确路径供手动使用，不虚构卡片，不安装工具或改写 profile。

生成失败不声明成功；声明失败区分“文件已生成”和“交付未完成”，修复路径或可见性后只重试交付，不为补卡片重跑分析。响应不确定时先核对已有调用结果和事件，不盲目重复声明。原生打开失败时使用 Host 的预览或错误反馈，不绕过权限。

卡片打开当前源文件，不保存内容版本；修改、移动或删除会影响后续读取。成功声明的持久事件属于 Harness，即使 PTC 外层程序随后失败，也不撤销已成功的声明。子代理产物属于其调用 Session；父 Agent 如需交付，先确认自己能访问文件，再在父 Session 显式调用 `present`，不自动跨 Session 转投递。

需要起步代码时读[简短示例](references/examples.md)；其中提供无需额外依赖的 PNG 写入代码，也通过 `marivo_python` 执行。
