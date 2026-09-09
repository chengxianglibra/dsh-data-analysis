# DSH Data Analysis

`dsh-data-analysis` 将 [Marivo](https://github.com/chengxianglibra/marivo) 的数据分析能力接入
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 安装

请先安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并使用 Node.js 24 或更高版本。
将插件安装到需要使用的 Profile（以 `web` 为例）：

```bash
dsh plugin --profile web add @chengxianglibra/dsh-data-analysis
```

安装后重新启动该 Profile：

```bash
dsh --profile web
```

## 插件功能

- **安全**：以受控方式连接分析环境和数据源，保护敏感凭证，并让分析过程与结果保持清晰、可靠的边界。
- **易用**：Agent 可以直接开展数据分析，并在持续使用中逐渐沉淀可复用的业务语义，让后续分析更贴近业务、结果更一致。
- **来源**：分析可结合 persisted Artifact/Finding 的来源读取，语义与质量事实由 Marivo 提供。

插件通过唯一 `dsh-data-analysis-presentation` Skill 组织图表、表格、报告、看板和可读来源展示，
调用 `marivo_present` 生成展示快照和自包含 HTML，可从 DSH 原卡片打开最近保存结果、下载。
Agent 修改已有报告时可保留同一 Report 并发布新 Build，版本冲突会阻止覆盖其他已保存编辑。
Workspace「报告」入口支持按标题搜索、最近更新与来源会话查看；历史侧栏可只读查看并下载已确认发布的版本。
阅读器支持呈现编辑、cell 移动／删除、撤销与保存；同 dataset 联动筛选只影响当前展示，不改写报告数据。普通事实问答使用文字；
已有数据可直接展示，需要新分析时再加载 Marivo Runtime Skill 与实时 Help。
使用边界见[展示 Skill](docs/modules/presentation-skill.md)，编辑和筛选能力见[展示 reader](docs/modules/presentation-reader.md)。

## 引用语义对象

输入 `@` 可选择当前 Workspace 的 Marivo 对象；输入 `@"monthly revenue"` 可检索多词。选中后显示完整
`kind:path` 引用，空查询优先展示最近七天常用对象。引用使用执行时的语义定义；对象删除后分析会明确失败。
参见[使用说明](docs/modules/semantic-reference-input.md)。

在 DSH 会话标题旁点击“语义层”，默认浏览该会话所属 Workspace 的对象分类、业务定义、语义属性与对象关系。
支持搜索、复制引用和手动刷新；页面只读取对象元数据，不执行分析查询，也不要求 Agent 正在运行。
参见[语义层对象浏览器](docs/modules/semantic-browser.md)。

标题旁的“数据源与凭证”打开同一 Workspace 的管理面板，支持配置凭证和测试数据源连接。
两个面板内均可显式切换 Workspace；入口随 Harness 的会话标题显示，无会话或空会话时不显示，侧栏底部不保留入口。
参见[凭证模块](docs/modules/datasource-credentials.md)。

## 长查询执行

`marivo_python` 默认前台执行预算为 120 秒。较长步骤可传入 `timeoutMs`；管理员通过插件配置
`pythonTimeoutMs` 和 `pythonMaxTimeoutMs` 设置默认预算与上限，默认分别为 `120000` 和 `600000` 毫秒。
Harness Shell 还会应用自己的上限，结果中的 `execution.effectiveTimeoutMs` 表示实际 Shell 预算。
凭据等待发生在 Shell 计时之前，但外层 Code Mode 总时限与取消仍然生效。

执行摘要提供阶段、结束原因、耗时与失败后的下一步；超时不证明结果未保存或远端查询已取消。
参见[超时与执行反馈](docs/modules/datasource-credentials.md#超时与执行反馈)。

## License

本项目采用 [MIT License](packages/dsh-data-analysis/LICENSE)。
