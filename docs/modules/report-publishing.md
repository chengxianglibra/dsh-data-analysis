# 报告 HTML 导出与发布（已移除）

HTML 导出与对象存储发布已从插件移除，`dsh.analysis-ui/v1` 分析文档不提供任何离线导出或发布能力。

已移除的内容包括：

- `marivo_export_html` 工具，以及 portable/static 离线 HTML 构建与报告内的导出菜单、当前视图导出；
- `marivo_publish_report` 工具、报告发布服务、“报告发布凭证”界面、`/dsh-report-publishing` RPC 和插件 `reportPublishing` 配置。

已上传的对象和已导出的 HTML 文件不受影响，也不会随插件更新。保存与呈现见[展示交付](presentation-delivery.md)，
阅读入口见[分析文档 reader](presentation-reader.md)。用户需要实际文件时，按文件分析流程生成 CSV、PNG 等并通过 Harness 原生 `present` 交付。
