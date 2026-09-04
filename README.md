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
- **丰富**：不仅提供分析结论，还可结合证据、溯源和 HTML 报告等形式，满足从快速探索到完整交付的不同需求。

## License

本项目采用 [MIT License](packages/dsh-data-analysis/LICENSE)。
