# 文件交付与恢复

用户要求查看或交付 CSV、TSV、XLSX、JSON、PNG 等实际文件时读取本页。生成或确认文件后，按当前 Harness 原生 `present` 工具契约交付；不猜测附件缓存或 Shell 私有临时目录。工具拥有路径与类型校验，契约见 Harness `dsh-v0.1.7-rc.1/packages/deliverables/tool-present/README.zh.md`。

## 生成与声明

只交付用户要求的最终文件。报告内部的 `presentation.json`、computed 数据和 receipt 不作为默认附件；用户另行要求时，先确认实际文件已经存在且当前 Session 可访问。浏览器内生成的下载不伪装成 Session 文件；报告 HTML 交给展示 Skill 的导出或发布流程。

文件生成成功，或用户要求预览且已有文件确认可访问后，调用 `present`，分别核对生成与声明结果。CSV、TSV、XLSX 由 Harness 原生表格预览读取文件，契约见 `dsh-v0.1.7-rc.1/packages/client/ui-sidebar-documentpreview/README.zh.md`；这是只读文件视图，不是 Marivo Report/Build，也不代表插件支持写入 XLSX 或分析旧 `.xls`。当前缺少 `present` 时，说明文件实际状态和原生交付能力不可用，并提供准确路径；不虚构卡片，不安装工具或改写 profile。

## 失败与再次交付

生成失败不声明成功；声明失败区分“文件已生成”和“交付未完成”。修复路径或可见性后只重试交付，不为补卡片重跑分析。响应不确定时先核对已有调用结果和事件，不盲目重复声明。原生打开失败时使用 Host 的预览或错误反馈，不绕过权限。

卡片读取当前源文件，不保存内容版本；修改、移动或删除会影响后续读取。成功声明的持久事件属于 Harness，即使 PTC 外层程序随后失败，也不撤销已成功的声明。子代理产物属于其调用 Session；父 Agent 如需交付，先确认自己能访问文件，再在父 Session 显式调用 `present`，不自动跨 Session 转投递。
