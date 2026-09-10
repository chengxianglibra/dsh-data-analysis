# 报告 Cell 引用标签验收

## 范围与责任

报告 Cell 的 Ask DSH 向 Harness 原生 composer 追加 `marivo-report-cell` 引用，输入框显示
`# <cell名称>`。插件提供显示名称、固定 Build 上下文和 codec；Harness 拥有引用编辑、附件、撤销和提交。
不扩展手动 `#` 搜索。复制和纯文本草稿持久化保留完整上下文；离线 HTML 继续复制上下文。

## 验收项目

- 显示标签与完整上下文分离，Cell 无 `label` 时回退到 ID；特殊字符 ID 仍精确定位。
- 当前显示的 Workspace、Report、Build、Cell，以及筛选、prepared view、图表覆盖和表格排序完整保留。
- 原有文本、语义引用和附件保留；沿用原生撤销分组，失败不改变草稿，成功重试只追加一次。
- 发送时经 Host codec 展开；Session/Workspace 失效、取消或非法引用明确失败。
- 12 KiB 上限与编辑期间禁用继续生效；离线复制与手动复制回退不变。
- 默认原生 Tab 和保留的对话框入口均注册 codec；卸载撤回注册及专用标记样式。

Harness alpha 会合并 1 秒内连续插入引用的撤销历史；Web 验收在该窗口结束后追加 Cell 引用，
验证撤销恢复此前的两条语义引用、文字与附件，不声称改变这一原生分组规则。

## 验证记录

验证日期：2026-09-10，Node.js 22.19.0。

- `npm run check`：通过，554 项测试中 550 通过、4 跳过；跳过项为需要显式
  `DSH_DATA_ANALYSIS_PYTHON` 的既有长时 Python 超时/取消测试，与本次输入引用改动无关。
- `npm run build`、`npm run verify:plugin-package`：通过；包验证含实际打包及报告构建器检查。
- `npm run validate:presentation-ask-dsh`：真实 Harness Web 对话框入口通过，确认 `#` 标签、
  Host codec、筛选和 prepared view、已有引用与附件、原生撤销、失败保留及离线复制。
- `npm run validate:right-tabs:web`：默认原生 Tab 完整验收通过，包括固定/current Build 身份、
  中文与特殊字符 Cell、筛选、排序、12 KiB 超限恢复、断连、切换及卸载。
  实际 Enter 提交的脚本模型请求包含两份完整报告上下文、用户问题、Workspace 和固定 Build 身份，
  并保留其中的筛选状态；输入框只显示两个 Cell 标签。
- 最后的脚本调整另通过 `npm run quality`、`npm run typecheck:scripts` 和 `git diff --check`；
  已检查相关文档相对链接和两张真实浏览器截图。

本地证据位于 `$TMPDIR/dsh-presentation-ask-dsh-4zevgi/` 与
`$TMPDIR/dsh-right-tabs-stage-one-rcxwbO/`；核心文件为 `ask-dsh-evidence.json`、
`context-reference-evidence.json`、`report-cell-model-request.json` 和 `report-cell-chips.png`。
测试使用隔离 profile 与脚本模型，验证真实 Host 提交链路；不声称真实模型分析质量验收。
本次未重装或重启用户日常运行的插件。

相关实现约定见 [报告阅读器](modules/presentation-reader.md#通用阅读层级)。
