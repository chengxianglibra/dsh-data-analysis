# 报告 Cell 数据源弹窗验收

日期：2026-09-10。

## 范围与责任

按破坏性更新实施，不提供旧版定义快照提示的兼容分支。Marivo 继续拥有 Artifact 和语义契约；插件只读取已保存的来源与字段，不执行查询或推断字段与上游指标的映射。

## 结果

- 投影不检查或生成指标历史定义快照缺失提示，reader 删除对此诊断的专门处理。
- 概要区分 Artifact 与计算结果；字段表展示当前 Cell 使用的字段名、显示名称、类型和单位。
- Artifact ID 可点击展开已保存的 Session ID、Finding ID、类型和行数。该入口是本地详情折叠区，不是独立 Artifact 浏览页。
- 删除自动副标题、预览表重复标题、探索状态套话；重复单位不再追加。
- “代码”改为“相关查询”，移除作者关联、执行记录和格式化说明；保留复制原文、实际不可用原因及截断提示。

## 验证证据

- `npm run check` 通过。
- 最后修改后补跑 quality、typecheck、`test:presentation-reader`（108 项全部通过，包含 build）和 `verify:plugin-package`，均通过。
- 使用构建后的生产 portable reader，在隔离 Chromium 中验证 Artifact 身份展开、字段表、数据预览排序、相关查询、390px 窄屏与 Escape 关闭；无页面异常。
- 本次浏览器脚本：`/tmp/dsh-source-dialog-ui.mjs`；截图：`/tmp/dsh-source-overview.png`、`/tmp/dsh-source-preview.png`、`/tmp/dsh-source-queries.png`、`/tmp/dsh-source-mobile.png`。这些是本机临时证据，不属于分发包。

没有重装或重启运行中的 Harness，没有执行真实数据源查询。本次浏览器验收覆盖共享 reader，不声称已经更新用户当前打开的报告页面。
