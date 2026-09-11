# 导出完整 HTML

用户要求离线 HTML 文件时，调用 `marivo_export_html({"report_id":"实际 Report ID","build_id":"实际 Build ID","output_path":"reports/analysis.html"})`。从成功 receipt 或已读取报告取得身份；基于固定报告上下文时始终传 `build_id`，仅在用户要求当前版本时省略。路径相对于当前 Workspace，必须为新的 `.html` 文件，可自动创建父目录；已有文件不会覆盖，不能写入 `.dsh-data-analysis`。

成功后必须使用返回的实际 `path` 调用原生 `present({ files: [{ path, description: "离线 HTML 报告" }] })`，再给出最终回复；不把 JSON 路径当成 HTML，也不以仅提及路径代替文件交付。若当前 Agent 未提供 `present`，如实报告已导出文件和交付能力缺失，不宣称已生成文件卡片。

导出复用已保存快照，不访问 Python 或数据源，不更新报告，不包含未保存编辑或临时筛选。需要先修改内容时，先完成报告保存再导出对应 Build。导出不依赖发布配置，也不生成外部 URL；完整报告保留全部已保存筛选组合，不是数据权限隔离副本。
