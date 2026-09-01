# 设计计划文档

本目录存放尚未完整实现或仍在评审中的设计方案。后续新增设计文档统一放在 `docs/plan/`，使用
lowercase kebab-case 文件名，并在本页登记入口。

已实现且反映当前代码事实的总体与模块架构继续维护在 `docs/architecture.md` 和 `docs/modules/`；设计完成
并落地后，应把稳定契约同步到对应架构文档，再决定是否保留原设计作为历史记录。

## 当前设计

- [Workspace 报告 Bundle 工具链设计](report-bundle-tooling-design.md)（已实施；提供 turn-scoped 静态 Checker Tool、Artifact-aware Python report kit、最小技术 Starter、Skill 内容原则与标准 Session trace appendix）
- [Agent 原生报告增强能力设计](agent-native-report-primitives-design.md)（已实施；正式 Marivo 0.5.1 已发布，真实环境验收已通过并持续作为发布门禁）
- [HTML 分析报告最小实现设计](html-report-rendering-mvp-design.md)（历史设计；已被破坏性替换）
