# 设计计划文档

本目录存放设计方案与保留的历史决策记录。后续新增设计文档统一放在 `docs/plan/`，使用 lowercase
kebab-case 文件名，并在本页登记入口。

已实现且反映当前代码事实的总体与模块架构继续维护在 `docs/architecture.md` 和 `docs/modules/`；设计完成
并落地后，应把稳定契约同步到对应架构文档，再决定是否保留原设计作为历史记录。

## 待实施交接

- [Marivo 指标口径可视化接口交接](marivo-metric-definition-handoff.md)（需求与接口建议；含 P0/P1 缺口、职责边界和验收用例）

## 已实施设计

- [Marivo 凭证配置、使用与管理设计](marivo-credentials-design.md)（已实现凭证管理、resolver 注入与原调用续接；[实施计划](2026-09-07-credential-service-integration.md)，[验收记录](2026-09-07-credential-service-acceptance.md)）

- [语义对象引用输入 MVP 设计](semantic-reference-input-mvp-design.md)（已实施并通过本机验收；复用 `@` 的 Catalog 候选、
  七日热度、分层词法检索与原子 ref）
- [插件能力优化设计](plugin-capability-optimization-design.md)（已实施；仅限本仓库 `0.1.1-dev.0` 开发线的能力收窄与 clean break）

## 历史设计

- [Agent 原生报告增强能力设计](agent-native-report-primitives-design.md)（历史；报告触发、transport 和 credential 边界已被当前 `0.1.1-dev.0` 设计替换）
- [HTML 分析报告最小实现设计](html-report-rendering-mvp-design.md)（历史设计；已被破坏性替换）

## 验收记录

- [插件能力优化 v2 验收记录](../acceptance/plugin-capability-optimization-v2.md)（已通过；阶段门禁与 J01–J20 terminal journeys）
