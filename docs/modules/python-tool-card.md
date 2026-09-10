# Python 工具卡片

## 所有权与接线

插件客户端通过 Harness 公开 `tool.call.toolview` 注册 `marivo_python` 专用视图。
注册使用 `slots.inject`，由 Host 管理延迟接线与卸载清理，不接管其他工具的展示。
Harness 拥有调用、结果、取消、轨迹和持久化记录；卡片仅消费 `ToolCallViewProps` 中的冻结快照，
不读取 Workspace、请求凭据、执行 Python 或重新查询结果。

## 展示行为

默认折叠，标题显示工具名、首个非空代码行和状态。展开后使用 Harness `CodeBlock` 展示 Python，
保留原始代码与字面量转义；不调用 formatter。仅展开时挂载代码组件，复制须保留完整原文。
`datasources` 与显式 `timeoutMs` 独立展示；实际预算和耗时仅来自已有执行摘要。

输出将返回 JSON 中的 `stdout`、`stderr` 分开展示，使用等宽字体及横向滚动保留文本表格对齐。
代码与输出区域限高 360 px；原始输入和输出保留折叠入口。准备阶段、历史或未知格式结果直接显示
可用原文；参数不完整时也不会丢失输入。查看按钮调用 Host 提供的 `inspect`。

成功必须具有明确的退出与取消标志，不能由 Tool 已结束推断。非零退出、超时、取消、未执行和
未确认结果分别标识；代码保存失败或输出截断显示警告，并保留已有 `nextAction`。
文案使用插件 `marivo.python` 中英文命名空间，不改变工具的输入 schema、输出或存储协议。

`MarivoPythonExecutionError` 经 Harness 规范化后仅保留错误文本。卡片在单个错误文本块中校验
`; execution=` 后缀的完整摘要，保留未执行、结果未知、取消与超时状态，以及已有耗时和 `nextAction`。
未知或不完整摘要回退为调用失败并保留原文；错误中的成功声明不能覆盖 Host 的失败标记。

## 验证

`npm run test:python-tool` 覆盖原文解析、状态优先级、旧记录、未知结果、预算和警告。
`test:right-tabs` 使用打包客户端与真实 Harness slot registry 验证仅注册指定 key 及卸载清理。
`npm run validate:python-tool:web` 使用当前安装的 Harness primitives 与固定数据，在隔离 Chromium 中
验证高亮、复制、输出、交互和布局，保留截图与 `evidence.json`；不访问运行中的用户 profile。

本模块的浏览器 fixture 验证不等同于真实分析、完整 Host Session 接线或已安装 Web profile 验收。
执行边界见 [Environment 执行](environment-execution.md)，验收入口见 [验证指南](../validation.md)。
