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

当前开发分支正在实施展示重构，已切换 S2 数据投影和 Python helper；旧报告 Skill 已删除，新的 reader 与
`marivo_present` 尚待后续阶段接入，见[路线图](docs/plan/marivo-analytics-presentation-roadmap.md)。

## 引用语义对象

输入 `@` 可选择当前 Workspace 的 Marivo 对象；输入 `@"monthly revenue"` 可检索多词。选中后显示完整
`kind:path` 引用，空查询优先展示最近七天常用对象。引用使用执行时的语义定义；对象删除后分析会明确失败。
参见[使用说明](docs/modules/semantic-reference-input.md)。

在 DSH 侧栏底部点击“语义层”，按 Workspace 浏览对象分类、业务定义、语义属性与对象关系。
支持搜索、复制引用和手动刷新；页面只读取对象元数据，不执行分析查询，也不要求 Agent 正在运行。
参见[语义层对象浏览器](docs/modules/semantic-browser.md)。

## License

本项目采用 [MIT License](packages/dsh-data-analysis/LICENSE)。
